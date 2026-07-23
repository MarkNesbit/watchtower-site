-- 20260723000800 WT-WORKSPACE-TEAM-006/007-FIX-002 draft review state.
-- Persists in-progress bulk review selections on the existing decision rows and
-- keeps approved import recalculation eligible for Team-page re-review loading.

alter table public.workspace_membership_change_decisions
  add column if not exists review_selected boolean not null default true,
  add column if not exists review_draft_reason text,
  add column if not exists review_draft_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists review_draft_updated_at timestamptz;

alter table public.workspace_membership_change_decisions
  drop constraint if exists workspace_membership_change_decisions_draft_reason_check,
  add constraint workspace_membership_change_decisions_draft_reason_check
    check (review_draft_reason is null or btrim(review_draft_reason) <> '');

create index if not exists workspace_membership_change_decisions_draft_idx
  on public.workspace_membership_change_decisions (import_run_id, review_selected, review_draft_updated_at desc)
  where is_current;

create or replace function public.ensure_workspace_membership_change_decisions(target_import_run_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  import_run public.workspace_membership_import_runs;
  actor record;
  inserted_count integer := 0;
begin
  select *
    into import_run
  from public.workspace_membership_import_runs wir
  where wir.id = target_import_run_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_IMPORT_NOT_FOUND: Import run was not found.' using errcode = '42501';
  end if;

  select * into actor from public.workspace_membership_require_admin_actor(import_run.organisation_id);

  if import_run.status not in ('validated', 'stale_review_required', 'approval_pending', 'approved_for_application', 'application_failed_pending_review') then
    raise exception 'WT_MEMBERSHIP_IMPORT_REVIEW_STATUS: Import run is not eligible for review.' using errcode = '23514';
  end if;
  if import_run.source_superseded then
    raise exception 'WT_MEMBERSHIP_IMPORT_SUPERSEDED: Superseded imports cannot be reviewed.' using errcode = '23514';
  end if;
  if import_run.source_export_id is not null and exists (
    select 1
    from public.workspace_membership_export_runs wer
    where wer.id = import_run.source_export_id
      and wer.organisation_id = import_run.organisation_id
      and (wer.status = 'superseded' or wer.superseded_at is not null)
  ) then
    raise exception 'WT_MEMBERSHIP_IMPORT_SUPERSEDED: Superseded source exports cannot be reviewed.' using errcode = '23514';
  end if;

  insert into public.workspace_membership_change_decisions (
    import_row_id,
    import_run_id,
    organisation_id,
    decision,
    decision_version,
    decision_history,
    live_recalculation_status,
    review_selected
  )
  select
    wir.id,
    wir.import_run_id,
    wir.organisation_id,
    'pending',
    1,
    '[]'::jsonb,
    'valid',
    true
  from public.workspace_membership_import_rows wir
  where wir.import_run_id = target_import_run_id
    and wir.organisation_id = import_run.organisation_id
    and public.workspace_membership_import_requires_decision(wir)
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  if import_run.status in ('validated', 'stale_review_required', 'approval_pending') then
    update public.workspace_membership_import_runs
      set review_status = case when review_status = 'not_started' then 'in_review' else review_status end,
          review_started_at = coalesce(review_started_at, now())
    where id = import_run.id;
  end if;

  return inserted_count;
end;
$$;

create or replace function public.recalculate_workspace_membership_change_proposals(target_import_run_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  import_run public.workspace_membership_import_runs;
  actor record;
  import_row public.workspace_membership_import_rows;
  decision_record public.workspace_membership_change_decisions;
  recalculation jsonb;
  output_rows jsonb := '[]'::jsonb;
  current_snapshot bigint;
begin
  select *
    into import_run
  from public.workspace_membership_import_runs wir
  where wir.id = target_import_run_id;

  if not found then
    raise exception 'WT_MEMBERSHIP_IMPORT_NOT_FOUND: Import run was not found.' using errcode = '42501';
  end if;

  select * into actor from public.workspace_membership_require_admin_actor(import_run.organisation_id);

  perform public.ensure_workspace_membership_change_decisions(target_import_run_id);
  current_snapshot := public.current_workspace_membership_snapshot_version(import_run.organisation_id);

  for import_row in
    select *
    from public.workspace_membership_import_rows wir
    where wir.import_run_id = target_import_run_id
      and wir.organisation_id = import_run.organisation_id
      and (
        public.workspace_membership_import_requires_decision(wir)
        or wir.validation_state = 'error'
        or wir.proposed_change_type = 'invalid'
      )
    order by wir.source_row_number
  loop
    recalculation := public.workspace_membership_recalculate_import_row(import_row, actor.actor_user_id);

    select *
      into decision_record
    from public.workspace_membership_change_decisions wcd
    where wcd.import_row_id = import_row.id
      and wcd.is_current
    limit 1;

    if found then
      update public.workspace_membership_change_decisions
        set live_recalculation_status = recalculation->>'status',
            live_recalculated_at = now(),
            live_snapshot_version = current_snapshot,
            live_values = coalesce(recalculation->'current_live_values', '{}'::jsonb),
            recalculated_proposed_values = coalesce(recalculation->'recalculated_proposed_values', '{}'::jsonb),
            impact_counts = coalesce(recalculation->'impact_counts', '{}'::jsonb)
      where id = decision_record.id
      returning * into decision_record;

      if decision_record.decision = 'pending'
         and (recalculation->>'status') in ('blocked', 'superseded', 'requires_revalidation', 'no_longer_required') then
        update public.workspace_membership_change_decisions
          set previous_decision = 'pending',
              decision = case
                when recalculation->>'status' = 'superseded' then 'superseded'
                when recalculation->>'status' = 'no_longer_required' then 'no_longer_required'
                else 'blocked'
              end,
              decided_by = actor.actor_user_id,
              decided_at = now(),
              reason = case
                when recalculation->>'status' = 'superseded' then 'Source export or import was superseded during live recalculation.'
                when recalculation->>'status' = 'no_longer_required' then 'Live recalculation found this proposal is no longer required.'
                else 'Live recalculation blocked this proposal from approval.'
              end,
              decision_version = decision_version + 1,
              review_selected = false,
              decision_history = coalesce(decision_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'actor_user_id', actor.actor_user_id,
                'previous_decision', 'pending',
                'new_decision', case
                  when recalculation->>'status' = 'superseded' then 'superseded'
                  when recalculation->>'status' = 'no_longer_required' then 'no_longer_required'
                  else 'blocked'
                end,
                'reason', 'Live recalculation updated the decision state.',
                'decided_at', now(),
                'live_recalculation_status', recalculation->>'status',
                'live_snapshot_version', current_snapshot
              ))
        where id = decision_record.id
        returning * into decision_record;

        perform public.record_workspace_membership_audit_event(
          decision_record.organisation_id,
          import_row.supplied_membership_id,
          import_row.supplied_user_id,
          actor.actor_user_id,
          case
            when decision_record.decision = 'no_longer_required' then 'membership_change_no_longer_required'
            else 'membership_change_blocked'
          end,
          'pending',
          decision_record.decision,
          jsonb_build_object('import_run_id', import_run.id, 'import_row_id', import_row.id),
          jsonb_build_object('live_recalculation_status', recalculation->>'status', 'live_snapshot_version', current_snapshot),
          decision_record.reason,
          'workspace_team_change_review',
          import_run.id
        );
      end if;
    end if;

    output_rows := output_rows || jsonb_build_array(jsonb_build_object(
      'row_id', import_row.id,
      'decision_id', decision_record.id,
      'source_row_number', import_row.source_row_number,
      'supplied_membership_id', import_row.supplied_membership_id,
      'supplied_user_id', import_row.supplied_user_id,
      'proposed_change_type', import_row.proposed_change_type,
      'validation_state', import_row.validation_state,
      'validation_messages', import_row.validation_messages,
      'source_export_values', import_row.source_export_values,
      'upload_live_values', import_row.live_values,
      'current_live_values', recalculation->'current_live_values',
      'proposed_values', import_row.proposed_values,
      'recalculated_proposed_values', recalculation->'recalculated_proposed_values',
      'field_differences', import_row.field_differences,
      'live_recalculation_status', recalculation->>'status',
      'live_recalculation_messages', recalculation->'messages',
      'impact_counts', recalculation->'impact_counts',
      'live_snapshot_version', current_snapshot,
      'decision', coalesce(decision_record.decision, 'blocked'),
      'decision_version', decision_record.decision_version,
      'decision_history', coalesce(decision_record.decision_history, '[]'::jsonb),
      'decided_by', decision_record.decided_by,
      'decided_at', decision_record.decided_at,
      'decision_reason', decision_record.reason,
      'review_selected', coalesce(decision_record.review_selected, true),
      'review_draft_reason', decision_record.review_draft_reason,
      'review_draft_updated_by', decision_record.review_draft_updated_by,
      'review_draft_updated_at', decision_record.review_draft_updated_at
    ));
  end loop;

  return output_rows;
end;
$$;

create or replace function public.save_workspace_membership_review_draft_selection(
  target_import_row_id uuid,
  requested_review_selected boolean,
  review_draft_reason text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  import_row public.workspace_membership_import_rows;
  decision_row public.workspace_membership_change_decisions;
  import_run public.workspace_membership_import_runs;
  actor record;
  reason_clean text := nullif(btrim(review_draft_reason), '');
begin
  select *
    into import_row
  from public.workspace_membership_import_rows wir
  where wir.id = target_import_row_id;

  if not found then
    raise exception 'WT_MEMBERSHIP_IMPORT_ROW_NOT_FOUND: Import row was not found.' using errcode = '42501';
  end if;

  select *
    into import_run
  from public.workspace_membership_import_runs wir
  where wir.id = import_row.import_run_id
    and wir.organisation_id = import_row.organisation_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_IMPORT_NOT_FOUND: Import run was not found.' using errcode = '42501';
  end if;

  select * into actor from public.workspace_membership_require_admin_actor(import_run.organisation_id);

  if import_run.status not in ('validated', 'stale_review_required', 'approval_pending') then
    raise exception 'WT_MEMBERSHIP_IMPORT_REVIEW_STATUS: Import run is not eligible for draft review changes.' using errcode = '23514';
  end if;
  if import_run.source_superseded then
    raise exception 'WT_MEMBERSHIP_IMPORT_SUPERSEDED: Superseded imports cannot receive draft review changes.' using errcode = '23514';
  end if;
  if not public.workspace_membership_import_requires_decision(import_row) then
    raise exception 'WT_MEMBERSHIP_DECISION_ROW_STATE: Invalid or unchanged rows cannot receive draft review changes.' using errcode = '23514';
  end if;

  perform public.ensure_workspace_membership_change_decisions(import_run.id);

  select *
    into decision_row
  from public.workspace_membership_change_decisions wcd
  where wcd.import_row_id = import_row.id
    and wcd.import_run_id = import_run.id
    and wcd.organisation_id = import_run.organisation_id
    and wcd.is_current
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_DECISION_NOT_FOUND: Decision was not found.' using errcode = '42501';
  end if;
  if decision_row.decision not in ('pending', 'approved', 'excluded', 'keep_active') then
    raise exception 'WT_MEMBERSHIP_DECISION_LOCKED: Live recalculation has locked this proposal state.' using errcode = '23514';
  end if;

  update public.workspace_membership_change_decisions
    set review_selected = requested_review_selected,
        review_draft_reason = reason_clean,
        review_draft_updated_by = actor.actor_user_id,
        review_draft_updated_at = now()
  where id = decision_row.id;

  update public.workspace_membership_import_runs
    set review_status = 'in_review',
        review_started_at = coalesce(review_started_at, now())
  where id = import_run.id;

  return decision_row.id;
end;
$$;

create or replace function public.confirm_workspace_membership_selected_change_set(
  target_import_run_id uuid,
  selected_import_row_ids uuid[] default null,
  batch_reason text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  import_run public.workspace_membership_import_runs;
  actor record;
  decision_row record;
  requested_decision text;
  reason_clean text := coalesce(nullif(btrim(batch_reason), ''), 'Bulk review modal confirmation.');
  selected_count integer := 0;
  excluded_count integer := 0;
  kept_active_count integer := 0;
  batch_correlation_id uuid := gen_random_uuid();
begin
  select *
    into import_run
  from public.workspace_membership_import_runs wir
  where wir.id = target_import_run_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_IMPORT_NOT_FOUND: Import run was not found.' using errcode = '42501';
  end if;

  select * into actor from public.workspace_membership_require_admin_actor(import_run.organisation_id);

  if import_run.status in ('approved_for_application', 'application_failed_pending_review') then
    return public.reconfirm_workspace_membership_approved_change_set(target_import_run_id, selected_import_row_ids, batch_reason);
  end if;

  if import_run.status not in ('validated', 'stale_review_required', 'approval_pending') then
    raise exception 'WT_MEMBERSHIP_IMPORT_REVIEW_STATUS: Import run is not eligible for bulk confirmation.' using errcode = '23514';
  end if;
  if import_run.source_superseded then
    raise exception 'WT_MEMBERSHIP_IMPORT_SUPERSEDED: Superseded imports cannot be confirmed.' using errcode = '23514';
  end if;

  perform public.ensure_workspace_membership_change_decisions(target_import_run_id);
  perform public.recalculate_workspace_membership_change_proposals(target_import_run_id);

  for decision_row in
    select
      wcd.id as decision_id,
      wcd.decision as current_decision,
      coalesce(wcd.review_selected, true) as review_selected,
      wcd.review_draft_reason,
      wir.id as import_row_id,
      wir.proposed_change_type,
      wir.supplied_membership_id,
      wir.supplied_user_id
    from public.workspace_membership_change_decisions wcd
    join public.workspace_membership_import_rows wir on wir.id = wcd.import_row_id
    where wcd.import_run_id = import_run.id
      and wcd.organisation_id = import_run.organisation_id
      and wcd.is_current
      and public.workspace_membership_import_requires_decision(wir)
    order by wir.source_row_number
  loop
    requested_decision := case
      when selected_import_row_ids is null and decision_row.review_selected then 'approved'
      when selected_import_row_ids is null and decision_row.proposed_change_type = 'deactivation' then 'keep_active'
      when selected_import_row_ids is null then 'excluded'
      when decision_row.import_row_id = any(coalesce(selected_import_row_ids, array[]::uuid[])) then 'approved'
      when decision_row.proposed_change_type = 'deactivation' then 'keep_active'
      else 'excluded'
    end;

    perform public.record_workspace_membership_change_decision(
      decision_row.decision_id,
      requested_decision,
      coalesce(decision_row.review_draft_reason, reason_clean)
    );

    perform public.record_workspace_membership_audit_event(
      import_run.organisation_id,
      decision_row.supplied_membership_id,
      decision_row.supplied_user_id,
      actor.actor_user_id,
      'workspace_membership_change_selection_confirmed',
      decision_row.current_decision,
      requested_decision,
      jsonb_build_object(
        'audit_scope', 'proposal',
        'import_run_id', import_run.id,
        'import_row_id', decision_row.import_row_id,
        'proposal_type', decision_row.proposed_change_type,
        'previous_decision', decision_row.current_decision
      ),
      jsonb_build_object(
        'audit_scope', 'proposal',
        'import_run_id', import_run.id,
        'import_row_id', decision_row.import_row_id,
        'proposal_type', decision_row.proposed_change_type,
        'selected', requested_decision = 'approved',
        'draft_selected', decision_row.review_selected,
        'new_decision', requested_decision,
        'batch_correlation_id', batch_correlation_id,
        'applies_changes', false
      ),
      coalesce(decision_row.review_draft_reason, reason_clean),
      'workspace_team_change_review_bulk_proposal',
      batch_correlation_id
    );

    if requested_decision = 'approved' then
      selected_count := selected_count + 1;
    elsif requested_decision = 'keep_active' then
      kept_active_count := kept_active_count + 1;
      excluded_count := excluded_count + 1;
    else
      excluded_count := excluded_count + 1;
    end if;
  end loop;

  if selected_count = 0 then
    raise exception 'WT_MEMBERSHIP_BULK_CONFIRM_EMPTY: Select at least one valid proposal before confirming.' using errcode = '23514';
  end if;

  perform public.confirm_workspace_membership_change_set(target_import_run_id);

  perform public.record_workspace_membership_audit_event(
    import_run.organisation_id,
    null,
    null,
    actor.actor_user_id,
    'workspace_membership_change_selection_confirmed',
    import_run.status,
    'approved_for_application',
    jsonb_build_object('audit_scope', 'batch', 'import_run_id', import_run.id),
    jsonb_build_object(
      'audit_scope', 'batch',
      'selected_count', selected_count,
      'excluded_count', excluded_count,
      'kept_active_count', kept_active_count,
      'used_persisted_draft_selection', selected_import_row_ids is null,
      'batch_correlation_id', batch_correlation_id,
      'applies_changes', false
    ),
    reason_clean,
    'workspace_team_change_review_bulk',
    batch_correlation_id
  );

  return target_import_run_id;
end;
$$;

revoke all on function public.save_workspace_membership_review_draft_selection(uuid, boolean, text) from public;
grant execute on function public.save_workspace_membership_review_draft_selection(uuid, boolean, text) to authenticated, service_role;

revoke all on function public.confirm_workspace_membership_selected_change_set(uuid, uuid[], text) from public;
grant execute on function public.confirm_workspace_membership_selected_change_set(uuid, uuid[], text) to authenticated, service_role;

comment on column public.workspace_membership_change_decisions.review_selected is
  'Persisted draft bulk-review selection. It is converted to approved/excluded/keep_active only during final confirmation and does not apply workspace changes.';
comment on column public.workspace_membership_change_decisions.review_draft_reason is
  'Optional draft exclusion/comment text saved during bulk review before final WT-006 confirmation.';
comment on function public.save_workspace_membership_review_draft_selection(uuid, boolean, text) is
  'Persists one Workspace Team review draft selection/comment through the existing decision row. This never applies membership/profile/auth changes.';
comment on function public.confirm_workspace_membership_selected_change_set(uuid, uuid[], text) is
  'Bulk confirms selected Workspace Team import proposals, using persisted draft selection when selected_import_row_ids is null. This function never applies membership/profile/auth changes.';
