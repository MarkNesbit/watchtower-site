-- WT-WORKSPACE-TEAM-005/006-FIX-002 modal bulk review confirmation.
-- Bulk confirmation records per-proposal WT-006 decisions and freezes the
-- approved set for WT-007. It never mutates membership, profile, auth or
-- invitation data.

alter table public.workspace_membership_audit_events
  drop constraint if exists workspace_membership_audit_events_event_type_check,
  add constraint workspace_membership_audit_events_event_type_check
    check (event_type in (
      'membership_invited',
      'invitation_expired',
      'membership_activated',
      'membership_suspended',
      'membership_deactivated',
      'membership_reactivated',
      'profile_identity_corrected',
      'membership_import_proposed',
      'membership_import_uploaded',
      'membership_import_validation_failed',
      'membership_import_validated',
      'membership_import_stale_detected',
      'membership_import_superseded_rejected',
      'membership_import_applied',
      'membership_import_failed',
      'membership_export_generated',
      'membership_export_read_only_generated',
      'membership_export_taken_over',
      'membership_export_superseded',
      'workspace_membership_csv_checkout_released',
      'membership_change_approved',
      'membership_change_excluded',
      'membership_deactivation_kept_active',
      'membership_change_decision_revised',
      'membership_change_blocked',
      'membership_change_no_longer_required',
      'membership_change_set_confirmed',
      'workspace_membership_change_selection_confirmed'
    ));

create or replace function public.confirm_workspace_membership_selected_change_set(
  target_import_run_id uuid,
  selected_import_row_ids uuid[],
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
      when decision_row.import_row_id = any(coalesce(selected_import_row_ids, array[]::uuid[])) then 'approved'
      when decision_row.proposed_change_type = 'deactivation' then 'keep_active'
      else 'excluded'
    end;

    perform public.record_workspace_membership_change_decision(
      decision_row.decision_id,
      requested_decision,
      reason_clean
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
        'new_decision', requested_decision,
        'batch_correlation_id', batch_correlation_id,
        'applies_changes', false
      ),
      reason_clean,
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

revoke all on function public.confirm_workspace_membership_selected_change_set(uuid, uuid[], text) from public;
grant execute on function public.confirm_workspace_membership_selected_change_set(uuid, uuid[], text) to authenticated, service_role;

comment on function public.confirm_workspace_membership_selected_change_set(uuid, uuid[], text) is
  'Bulk confirms selected Workspace Team import proposals by recording controlled WT-006 decisions and freezing the approved set. This function never applies membership/profile/auth changes.';
