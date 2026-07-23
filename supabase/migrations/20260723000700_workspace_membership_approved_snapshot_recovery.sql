-- 20260723000700 WT-WORKSPACE-TEAM-006/007-FIX-001 approved snapshot recovery.
-- Forward-only repair for exact approved live snapshot capture and deliberate
-- re-review of already-approved imports whose snapshot is missing or stale.

alter table public.workspace_membership_import_runs
  add column if not exists approved_live_snapshot_version text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

alter table public.workspace_membership_import_runs
  drop constraint if exists workspace_membership_import_runs_status_check,
  add constraint workspace_membership_import_runs_status_check
    check (status in (
      'uploaded',
      'parsing',
      'validated',
      'stale_review_required',
      'validation_failed',
      'comparison_completed',
      'approval_pending',
      'approved_for_application',
      'application_failed_pending_review',
      'applied',
      'failed',
      'superseded',
      'cancelled'
    )),
  drop constraint if exists workspace_membership_import_runs_approved_set_shape_check,
  add constraint workspace_membership_import_runs_approved_set_shape_check
    check (
      approved_change_set_version >= 0
      and (approved_change_set_snapshot_version is null or approved_change_set_snapshot_version > 0)
      and (approved_live_snapshot_version is null or approved_live_snapshot_version ~ '^[1-9][0-9]*$')
      and jsonb_typeof(approved_change_set) = 'array'
      and jsonb_typeof(approved_change_set_summary) = 'object'
      and (status <> 'approved_for_application' or (review_completed_at is not null and approval_locked_at is not null))
    );

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
      'membership_change_set_reconfirmed',
      'workspace_membership_change_selection_confirmed',
      'membership_addition_applied',
      'profile_identity_correction_applied',
      'membership_deactivation_applied',
      'membership_reactivation_applied',
      'membership_change_application_failed',
      'membership_change_set_applied',
      'membership_change_set_drift_detected'
    ));

-- Regression sentinel: 894187232527701972 must be transported as text, not JSON number.

create or replace function public.workspace_membership_recalculate_import_row(
  import_row public.workspace_membership_import_rows,
  actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_membership public.organisation_members;
  current_profile public.profiles;
  import_run public.workspace_membership_import_runs;
  source_export public.workspace_membership_export_runs;
  recalculation_status text := 'valid';
  messages jsonb := '[]'::jsonb;
  proposed_email text := lower(nullif(btrim(coalesce(import_row.proposed_values->>'email', import_row.normalised_values->>'email')), ''));
  proposed_role text := lower(nullif(btrim(coalesce(import_row.proposed_values->>'workspace_role', import_row.normalised_values->>'workspace_role')), ''));
  current_values jsonb := '{}'::jsonb;
  revised_values jsonb := coalesce(import_row.proposed_values, '{}'::jsonb);
  impact jsonb := '{}'::jsonb;
  other_active_owner_count integer := 0;
  duplicate_contact_count integer := 0;
  corrected_difference_count integer := 0;
begin
  select *
    into import_run
  from public.workspace_membership_import_runs wir
  where wir.id = import_row.import_run_id
    and wir.organisation_id = import_row.organisation_id;

  if not found or import_run.status not in ('validated', 'stale_review_required', 'approval_pending', 'approved_for_application', 'application_failed_pending_review') then
    recalculation_status := 'blocked';
    messages := messages || jsonb_build_array(jsonb_build_object('message', 'Import run is not eligible for review.'));
  end if;

  if import_run.source_export_id is not null then
    select *
      into source_export
    from public.workspace_membership_export_runs wer
    where wer.id = import_run.source_export_id
      and wer.organisation_id = import_run.organisation_id;

    if not found or source_export.status = 'superseded' or source_export.superseded_at is not null or import_run.source_superseded then
      recalculation_status := 'superseded';
      messages := messages || jsonb_build_array(jsonb_build_object('message', 'Source export has been superseded.'));
    end if;
  end if;

  if import_row.validation_state = 'error' or import_row.proposed_change_type = 'invalid' then
    recalculation_status := 'blocked';
    messages := messages || jsonb_build_array(jsonb_build_object('message', 'Invalid or protected validation conflicts cannot be approved.'));
  elsif import_row.is_unchanged then
    recalculation_status := 'no_longer_required';
    messages := messages || jsonb_build_array(jsonb_build_object('message', 'No material change remains for this row.'));
  end if;

  if import_row.proposed_change_type = 'addition' then
    if proposed_role is null then
      proposed_role := 'viewer';
      revised_values := revised_values || jsonb_build_object('workspace_role', 'viewer');
    end if;

    if proposed_role not in ('member', 'viewer') then
      recalculation_status := 'blocked';
      messages := messages || jsonb_build_array(jsonb_build_object('message', 'CSV review can only approve Member or Viewer additions.'));
    end if;

    if proposed_email is not null then
      select count(*)
        into duplicate_contact_count
      from public.organisation_members om
      join public.profiles p on p.id = om.user_id
      where om.organisation_id = import_row.organisation_id
        and lower(coalesce(p.contact_email, '')) = proposed_email;

      if duplicate_contact_count > 0 then
        if recalculation_status = 'valid' then
          recalculation_status := 'changed_since_upload';
        end if;
        messages := messages || jsonb_build_array(jsonb_build_object('message', 'Current workspace data already contains this contact email.'));
      end if;
    end if;
  elsif import_row.proposed_change_type in ('identity_correction', 'deactivation', 'reactivation') then
    select *
      into current_membership
    from public.organisation_members om
    where om.id = import_row.supplied_membership_id
      and om.organisation_id = import_row.organisation_id;

    if not found then
      recalculation_status := 'blocked';
      messages := messages || jsonb_build_array(jsonb_build_object('message', 'Membership no longer exists in this workspace.'));
    elsif current_membership.user_id is distinct from import_row.supplied_user_id then
      recalculation_status := 'blocked';
      messages := messages || jsonb_build_array(jsonb_build_object('message', 'Membership and user pairing has changed since upload.'));
    else
      select *
        into current_profile
      from public.profiles p
      where p.id = current_membership.user_id;

      current_values := jsonb_build_object(
        'workspace_membership_id', current_membership.id,
        'user_id', current_membership.user_id,
        'workspace_role', current_membership.role,
        'membership_status', current_membership.status,
        'first_name', current_profile.first_name,
        'last_name', current_profile.last_name,
        'email', current_profile.contact_email,
        'accepted_at', current_membership.accepted_at,
        'joined_at', current_membership.joined_at,
        'deactivated_at', current_membership.deactivated_at,
        'reactivated_at', current_membership.reactivated_at
      );

      if current_membership.role in ('owner', 'admin') then
        recalculation_status := 'blocked';
        messages := messages || jsonb_build_array(jsonb_build_object('message', 'Owner and Admin memberships are protected from CSV approval.'));
      end if;

      if import_row.proposed_change_type = 'identity_correction' then
        if import_row.proposed_values ? 'first_name'
           and coalesce(import_row.proposed_values->>'first_name', '') is distinct from coalesce(current_profile.first_name, '') then
          corrected_difference_count := corrected_difference_count + 1;
        end if;
        if import_row.proposed_values ? 'last_name'
           and coalesce(import_row.proposed_values->>'last_name', '') is distinct from coalesce(current_profile.last_name, '') then
          corrected_difference_count := corrected_difference_count + 1;
        end if;
        if import_row.proposed_values ? 'email'
           and coalesce(lower(import_row.proposed_values->>'email'), '') is distinct from coalesce(lower(current_profile.contact_email), '') then
          corrected_difference_count := corrected_difference_count + 1;
        end if;

        if corrected_difference_count = 0 and recalculation_status = 'valid' then
          recalculation_status := 'no_longer_required';
          messages := messages || jsonb_build_array(jsonb_build_object('message', 'The proposed profile correction has already been made.'));
        elsif (current_values is distinct from coalesce(import_row.live_values, '{}'::jsonb)) and recalculation_status = 'valid' then
          recalculation_status := 'changed_since_upload';
          messages := messages || jsonb_build_array(jsonb_build_object('message', 'Current profile or membership values changed since upload.'));
        end if;
      elsif import_row.proposed_change_type = 'deactivation' then
        impact := public.workspace_membership_known_responsibility_counts(import_row.organisation_id, current_membership.user_id);

        if current_membership.user_id = actor_user_id then
          recalculation_status := 'blocked';
          messages := messages || jsonb_build_array(jsonb_build_object('message', 'Users cannot approve their own deactivation.'));
        elsif current_membership.status = 'deactivated' then
          recalculation_status := 'no_longer_required';
          messages := messages || jsonb_build_array(jsonb_build_object('message', 'This membership is already deactivated.'));
        elsif current_membership.status <> 'active' and recalculation_status = 'valid' then
          recalculation_status := 'requires_revalidation';
          messages := messages || jsonb_build_array(jsonb_build_object('message', 'Membership is no longer active and requires revalidation before approval.'));
        elsif (current_values is distinct from coalesce(import_row.live_values, '{}'::jsonb)) and recalculation_status = 'valid' then
          recalculation_status := 'changed_since_upload';
          messages := messages || jsonb_build_array(jsonb_build_object('message', 'Current membership values changed since upload.'));
        end if;

        if current_membership.role = 'owner' and current_membership.status = 'active' then
          select count(*)
            into other_active_owner_count
          from public.organisation_members om
          where om.organisation_id = current_membership.organisation_id
            and om.id <> current_membership.id
            and om.role = 'owner'
            and om.status = 'active';

          if other_active_owner_count = 0 then
            recalculation_status := 'blocked';
            messages := messages || jsonb_build_array(jsonb_build_object('message', 'The final active Owner cannot be approved for deactivation.'));
          end if;
        end if;
      elsif import_row.proposed_change_type = 'reactivation' then
        impact := public.workspace_membership_known_responsibility_counts(import_row.organisation_id, current_membership.user_id);

        if current_membership.status = 'active' then
          recalculation_status := 'no_longer_required';
          messages := messages || jsonb_build_array(jsonb_build_object('message', 'This membership is already active.'));
        elsif current_membership.status not in ('deactivated', 'suspended') and recalculation_status = 'valid' then
          recalculation_status := 'requires_revalidation';
          messages := messages || jsonb_build_array(jsonb_build_object('message', 'Membership state no longer matches a reactivation proposal.'));
        elsif (current_values is distinct from coalesce(import_row.live_values, '{}'::jsonb)) and recalculation_status = 'valid' then
          recalculation_status := 'changed_since_upload';
          messages := messages || jsonb_build_array(jsonb_build_object('message', 'Current membership values changed since upload.'));
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'status', recalculation_status,
    'messages', messages,
    'current_live_values', current_values,
    'recalculated_proposed_values', revised_values,
    'impact_counts', impact,
    'recalculated_at', now()
  );
end;
$$;

create or replace function public.confirm_workspace_membership_change_set(target_import_run_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  import_run public.workspace_membership_import_runs;
  actor record;
  current_snapshot bigint;
  current_snapshot_text text;
  pending_count integer := 0;
  blocked_approved_count integer := 0;
  approved_set jsonb := '[]'::jsonb;
  summary jsonb := '{}'::jsonb;
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
    raise exception 'WT_MEMBERSHIP_IMPORT_REVIEW_STATUS: Import run is not eligible for final confirmation.' using errcode = '23514';
  end if;
  if import_run.source_superseded or (
    import_run.source_export_id is not null and exists (
      select 1
      from public.workspace_membership_export_runs wer
      where wer.id = import_run.source_export_id
        and wer.organisation_id = import_run.organisation_id
        and (wer.status = 'superseded' or wer.superseded_at is not null)
    )
  ) then
    raise exception 'WT_MEMBERSHIP_IMPORT_SUPERSEDED: Superseded imports cannot be confirmed.' using errcode = '23514';
  end if;

  perform public.recalculate_workspace_membership_change_proposals(target_import_run_id);
  current_snapshot_text := public.current_workspace_membership_snapshot_version_text(import_run.organisation_id);
  if current_snapshot_text is null or current_snapshot_text !~ '^[1-9][0-9]*$' then
    raise exception 'WT_MEMBERSHIP_CHANGE_SET_SNAPSHOT: Approved live snapshot could not be captured.' using errcode = '23514';
  end if;
  current_snapshot := current_snapshot_text::bigint;

  select count(*)
    into pending_count
  from public.workspace_membership_import_rows wir
  left join public.workspace_membership_change_decisions wcd on wcd.import_row_id = wir.id and wcd.is_current
  where wir.import_run_id = import_run.id
    and wir.organisation_id = import_run.organisation_id
    and public.workspace_membership_import_requires_decision(wir)
    and coalesce(wcd.decision, 'pending') = 'pending';

  if pending_count > 0 then
    raise exception 'WT_MEMBERSHIP_CHANGE_SET_PENDING: Every valid proposal requires a decision before confirmation.' using errcode = '23514';
  end if;

  select count(*)
    into blocked_approved_count
  from public.workspace_membership_change_decisions wcd
  join public.workspace_membership_import_rows wir on wir.id = wcd.import_row_id
  where wcd.import_run_id = import_run.id
    and wcd.organisation_id = import_run.organisation_id
    and wcd.is_current
    and wcd.decision = 'approved'
    and wcd.live_recalculation_status in ('blocked', 'superseded', 'requires_revalidation', 'no_longer_required');

  if blocked_approved_count > 0 then
    raise exception 'WT_MEMBERSHIP_CHANGE_SET_BLOCKED: Approved proposals include blocked or no-longer-required rows.' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'decision_id', wcd.id,
    'decision_version', wcd.decision_version,
    'import_row_id', wir.id,
    'source_row_number', wir.source_row_number,
    'proposal_type', wir.proposed_change_type,
    'decision', wcd.decision,
    'proposed_values', wir.proposed_values,
    'recalculated_proposed_values', wcd.recalculated_proposed_values,
    'current_live_values', wcd.live_values,
    'impact_counts', wcd.impact_counts,
    'live_recalculation_status', wcd.live_recalculation_status,
    'decided_by', wcd.decided_by,
    'decided_at', wcd.decided_at
  ) order by wir.source_row_number), '[]'::jsonb)
    into approved_set
  from public.workspace_membership_change_decisions wcd
  join public.workspace_membership_import_rows wir on wir.id = wcd.import_row_id
  where wcd.import_run_id = import_run.id
    and wcd.organisation_id = import_run.organisation_id
    and wcd.is_current
    and wcd.decision in ('approved', 'excluded', 'keep_active');

  select jsonb_build_object(
    'approved_additions', count(*) filter (where wir.proposed_change_type = 'addition' and wcd.decision = 'approved'),
    'approved_identity_corrections', count(*) filter (where wir.proposed_change_type = 'identity_correction' and wcd.decision = 'approved'),
    'approved_name_corrections', count(*) filter (
      where wir.proposed_change_type = 'identity_correction'
        and wcd.decision = 'approved'
        and (wir.proposed_values ? 'first_name' or wir.proposed_values ? 'last_name')
    ),
    'approved_email_corrections', count(*) filter (
      where wir.proposed_change_type = 'identity_correction'
        and wcd.decision = 'approved'
        and wir.proposed_values ? 'email'
    ),
    'approved_deactivations', count(*) filter (where wir.proposed_change_type = 'deactivation' and wcd.decision = 'approved'),
    'approved_reactivations', count(*) filter (where wir.proposed_change_type = 'reactivation' and wcd.decision = 'approved'),
    'excluded_changes', count(*) filter (where wcd.decision = 'excluded'),
    'kept_active', count(*) filter (where wcd.decision = 'keep_active'),
    'invalid_rows_not_included', import_run.invalid_row_count,
    'known_impact_totals', jsonb_build_object(
      'active_risks_owned', coalesce(sum((wcd.impact_counts->>'active_risks_owned')::integer), 0),
      'non_terminal_actions_assigned', coalesce(sum((wcd.impact_counts->>'non_terminal_actions_assigned')::integer), 0),
      'non_terminal_approvals_held', coalesce(sum((wcd.impact_counts->>'non_terminal_approvals_held')::integer), 0),
      'active_project_roles', coalesce(sum((wcd.impact_counts->>'active_project_roles')::integer), 0)
    ),
    'approved_live_snapshot_version', current_snapshot_text,
    'live_snapshot_version', current_snapshot_text,
    'confirmed_by', actor.actor_user_id,
    'confirmed_at', now(),
    'applies_changes', false
  )
    into summary
  from public.workspace_membership_change_decisions wcd
  join public.workspace_membership_import_rows wir on wir.id = wcd.import_row_id
  where wcd.import_run_id = import_run.id
    and wcd.organisation_id = import_run.organisation_id
    and wcd.is_current;

  update public.workspace_membership_change_decisions
    set finalised_at = now(),
        finalised_by = actor.actor_user_id
  where import_run_id = import_run.id
    and organisation_id = import_run.organisation_id
    and is_current;

  update public.workspace_membership_import_runs
    set status = 'approved_for_application',
        review_status = 'ready_for_application',
        review_completed_at = now(),
        review_completed_by = actor.actor_user_id,
        approval_locked_at = now(),
        approval_locked_by = actor.actor_user_id,
        approved_change_set_version = approved_change_set_version + 1,
        approved_live_snapshot_version = current_snapshot_text,
        approved_change_set_snapshot_version = current_snapshot_text::bigint,
        approved_at = now(),
        approved_by = actor.actor_user_id,
        approved_change_set = approved_set,
        approved_change_set_summary = summary
  where id = import_run.id;

  perform public.record_workspace_membership_audit_event(
    import_run.organisation_id,
    null,
    null,
    actor.actor_user_id,
    'membership_change_set_confirmed',
    import_run.status,
    'approved_for_application',
    jsonb_build_object('import_run_id', import_run.id, 'review_status', import_run.review_status),
    jsonb_build_object(
      'import_run_id', import_run.id,
      'approved_change_set_version', import_run.approved_change_set_version + 1,
      'approved_live_snapshot_version', current_snapshot_text,
      'summary', summary,
      'live_snapshot_version', current_snapshot_text,
      'applies_changes', false
    ),
    'Workspace Team CSV changes approved for later application. No membership, profile or auth change was applied.',
    'workspace_team_change_review',
    import_run.id
  );

  return import_run.id;
end;
$$;

create or replace function public.reconfirm_workspace_membership_approved_change_set(
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
  reason_clean text := coalesce(nullif(btrim(batch_reason), ''), 'Approved Workspace Team change set re-reviewed for snapshot recovery.');
  current_snapshot_text text;
  current_snapshot bigint;
  previous_version integer;
  previous_snapshot text;
  approved_set jsonb := '[]'::jsonb;
  summary jsonb := '{}'::jsonb;
  blocked_approved_count integer := 0;
  selected_count integer := 0;
  excluded_count integer := 0;
  reconfirmed_at timestamptz := now();
  correlation_id uuid := gen_random_uuid();
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

  if import_run.status not in ('approved_for_application', 'application_failed_pending_review') then
    raise exception 'WT_MEMBERSHIP_IMPORT_RECONFIRM_STATUS: Import run is not eligible for approved-set reconfirmation.' using errcode = '23514';
  end if;
  if import_run.applied_at is not null then
    raise exception 'WT_MEMBERSHIP_IMPORT_RECONFIRM_APPLIED: Applied imports cannot be reconfirmed.' using errcode = '23514';
  end if;
  if import_run.source_superseded or (
    import_run.source_export_id is not null and exists (
      select 1
      from public.workspace_membership_export_runs wer
      where wer.id = import_run.source_export_id
        and wer.organisation_id = import_run.organisation_id
        and (wer.status = 'superseded' or wer.superseded_at is not null)
    )
  ) then
    raise exception 'WT_MEMBERSHIP_IMPORT_SUPERSEDED: Superseded imports cannot be reconfirmed.' using errcode = '23514';
  end if;

  previous_version := import_run.approved_change_set_version;
  previous_snapshot := import_run.approved_live_snapshot_version;

  perform public.ensure_workspace_membership_change_decisions(target_import_run_id);
  perform public.recalculate_workspace_membership_change_proposals(target_import_run_id);

  for decision_row in
    select
      wcd.id as decision_id,
      wcd.decision as current_decision,
      wcd.decision_version,
      wcd.decision_history,
      wcd.live_recalculation_status,
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
      when selected_import_row_ids is null then decision_row.current_decision
      when decision_row.import_row_id = any(coalesce(selected_import_row_ids, array[]::uuid[])) then 'approved'
      when decision_row.proposed_change_type = 'deactivation' then 'keep_active'
      else 'excluded'
    end;

    if requested_decision = 'approved' and decision_row.live_recalculation_status in ('blocked', 'superseded', 'requires_revalidation', 'no_longer_required') then
      raise exception 'WT_MEMBERSHIP_CHANGE_SET_BLOCKED: Approved proposals include blocked or no-longer-required rows.' using errcode = '23514';
    end if;

    if requested_decision = 'approved' then
      selected_count := selected_count + 1;
    else
      excluded_count := excluded_count + 1;
    end if;

    if decision_row.current_decision is distinct from requested_decision then
      update public.workspace_membership_change_decisions as wcd
        set previous_decision = decision_row.current_decision,
            decision = requested_decision,
            decided_by = actor.actor_user_id,
            decided_at = reconfirmed_at,
            reason = reason_clean,
            decision_version = decision_row.decision_version + 1,
            decision_history = coalesce(wcd.decision_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
              'actor_user_id', actor.actor_user_id,
              'previous_decision', decision_row.current_decision,
              'new_decision', requested_decision,
              'reason', reason_clean,
              'decided_at', reconfirmed_at,
              'reconfirmation', true
            )),
            finalised_at = reconfirmed_at,
            finalised_by = actor.actor_user_id
      where wcd.id = decision_row.decision_id;
    else
      update public.workspace_membership_change_decisions as wcd
        set finalised_at = coalesce(wcd.finalised_at, reconfirmed_at),
            finalised_by = coalesce(wcd.finalised_by, actor.actor_user_id)
      where wcd.id = decision_row.decision_id;
    end if;
  end loop;

  if selected_count = 0 then
    raise exception 'WT_MEMBERSHIP_CHANGE_SET_EMPTY: At least one proposal must be approved before reconfirmation.' using errcode = '23514';
  end if;

  select count(*)
    into blocked_approved_count
  from public.workspace_membership_change_decisions wcd
  join public.workspace_membership_import_rows wir on wir.id = wcd.import_row_id
  where wcd.import_run_id = import_run.id
    and wcd.organisation_id = import_run.organisation_id
    and wcd.is_current
    and wcd.decision = 'approved'
    and wcd.live_recalculation_status in ('blocked', 'superseded', 'requires_revalidation', 'no_longer_required');

  if blocked_approved_count > 0 then
    raise exception 'WT_MEMBERSHIP_CHANGE_SET_BLOCKED: Approved proposals include blocked or no-longer-required rows.' using errcode = '23514';
  end if;

  current_snapshot_text := public.current_workspace_membership_snapshot_version_text(import_run.organisation_id);
  if current_snapshot_text is null or current_snapshot_text !~ '^[1-9][0-9]*$' then
    raise exception 'WT_MEMBERSHIP_CHANGE_SET_SNAPSHOT: Approved live snapshot could not be captured.' using errcode = '23514';
  end if;
  current_snapshot := current_snapshot_text::bigint;

  select coalesce(jsonb_agg(jsonb_build_object(
    'decision_id', wcd.id,
    'decision_version', wcd.decision_version,
    'import_row_id', wir.id,
    'source_row_number', wir.source_row_number,
    'proposal_type', wir.proposed_change_type,
    'decision', wcd.decision,
    'proposed_values', wir.proposed_values,
    'recalculated_proposed_values', wcd.recalculated_proposed_values,
    'current_live_values', wcd.live_values,
    'impact_counts', wcd.impact_counts,
    'live_recalculation_status', wcd.live_recalculation_status,
    'decided_by', wcd.decided_by,
    'decided_at', wcd.decided_at
  ) order by wir.source_row_number), '[]'::jsonb)
    into approved_set
  from public.workspace_membership_change_decisions wcd
  join public.workspace_membership_import_rows wir on wir.id = wcd.import_row_id
  where wcd.import_run_id = import_run.id
    and wcd.organisation_id = import_run.organisation_id
    and wcd.is_current
    and wcd.decision in ('approved', 'excluded', 'keep_active');

  select jsonb_build_object(
    'approved_additions', count(*) filter (where wir.proposed_change_type = 'addition' and wcd.decision = 'approved'),
    'approved_identity_corrections', count(*) filter (where wir.proposed_change_type = 'identity_correction' and wcd.decision = 'approved'),
    'approved_name_corrections', count(*) filter (
      where wir.proposed_change_type = 'identity_correction'
        and wcd.decision = 'approved'
        and (wir.proposed_values ? 'first_name' or wir.proposed_values ? 'last_name')
    ),
    'approved_email_corrections', count(*) filter (
      where wir.proposed_change_type = 'identity_correction'
        and wcd.decision = 'approved'
        and wir.proposed_values ? 'email'
    ),
    'approved_deactivations', count(*) filter (where wir.proposed_change_type = 'deactivation' and wcd.decision = 'approved'),
    'approved_reactivations', count(*) filter (where wir.proposed_change_type = 'reactivation' and wcd.decision = 'approved'),
    'excluded_changes', count(*) filter (where wcd.decision = 'excluded'),
    'kept_active', count(*) filter (where wcd.decision = 'keep_active'),
    'invalid_rows_not_included', import_run.invalid_row_count,
    'approved_live_snapshot_version', current_snapshot_text,
    'live_snapshot_version', current_snapshot_text,
    'confirmed_by', actor.actor_user_id,
    'confirmed_at', reconfirmed_at,
    'reconfirmed', true,
    'applies_changes', false
  )
    into summary
  from public.workspace_membership_change_decisions wcd
  join public.workspace_membership_import_rows wir on wir.id = wcd.import_row_id
  where wcd.import_run_id = import_run.id
    and wcd.organisation_id = import_run.organisation_id
    and wcd.is_current;

  update public.workspace_membership_import_runs
    set status = 'approved_for_application',
        review_status = 'ready_for_application',
        review_completed_at = reconfirmed_at,
        review_completed_by = actor.actor_user_id,
        approval_locked_at = reconfirmed_at,
        approval_locked_by = actor.actor_user_id,
        approved_at = reconfirmed_at,
        approved_by = actor.actor_user_id,
        approved_change_set_version = approved_change_set_version + 1,
        approved_live_snapshot_version = current_snapshot_text,
        approved_change_set_snapshot_version = current_snapshot_text::bigint,
        approved_change_set = approved_set,
        approved_change_set_summary = summary,
        failure_code = null,
        failure_message = null
  where id = import_run.id
    and organisation_id = import_run.organisation_id;

  perform public.record_workspace_membership_audit_event(
    import_run.organisation_id,
    null,
    null,
    actor.actor_user_id,
    'membership_change_set_reconfirmed',
    import_run.status,
    'approved_for_application',
    jsonb_build_object(
      'import_run_id', import_run.id,
      'previous_approved_change_set_version', previous_version,
      'previous_approved_live_snapshot_version', previous_snapshot,
      'previous_snapshot', previous_snapshot
    ),
    jsonb_build_object(
      'import_run_id', import_run.id,
      'new_approved_change_set_version', previous_version + 1,
      'new_approved_live_snapshot_version', current_snapshot_text,
      'new_approved_snapshot', current_snapshot_text,
      'selected_count', selected_count,
      'excluded_count', excluded_count,
      'applies_changes', false
    ),
    'Approved Workspace Team change set reconfirmed after live snapshot recovery. No membership, profile, auth or invitation delivery changes were applied.',
    'workspace_team_change_review_reconfirmation',
    correlation_id
  );

  return import_run.id;
end;
$$;

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

create or replace function public.apply_workspace_membership_change_set(
  p_organisation_id uuid,
  p_import_run_id uuid,
  p_operation_key uuid default gen_random_uuid()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_import public.workspace_membership_import_runs;
  v_existing_application public.workspace_membership_change_application_runs;
  v_application public.workspace_membership_change_application_runs;
  v_source_export public.workspace_membership_export_runs;
  v_item jsonb;
  v_decision public.workspace_membership_change_decisions;
  v_row public.workspace_membership_import_rows;
  v_membership public.organisation_members;
  v_updated_membership public.organisation_members;
  v_profile public.profiles;
  v_new_profile_id uuid;
  v_new_membership public.organisation_members;
  v_proposed_values jsonb;
  v_current_values jsonb;
  v_impact_counts jsonb;
  v_proposal_type text;
  v_decision_text text;
  v_first_name text;
  v_last_name text;
  v_contact_email text;
  v_workspace_role text;
  v_login_name text;
  v_auth_email text;
  v_display_name text;
  v_failure_code text := null;
  v_failure_message text := null;
  v_current_snapshot bigint;
  v_current_snapshot_text text;
  v_approved_snapshot_text text;
  v_after_snapshot bigint;
  v_duplicate_count integer := 0;
  v_additions integer := 0;
  v_corrections integer := 0;
  v_deactivations integer := 0;
  v_reactivations integer := 0;
  v_handoffs integer := 0;
  v_correlation_id uuid := gen_random_uuid();
  v_operation_key uuid := coalesce(p_operation_key, gen_random_uuid());
begin
  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);

  perform pg_advisory_xact_lock(hashtextextended(p_import_run_id::text, 7007));

  select *
    into v_existing_application
  from public.workspace_membership_change_application_runs as ar
  where ar.organisation_id = p_organisation_id
    and ar.import_run_id = p_import_run_id
    and ar.operation_key = v_operation_key
  order by ar.created_at desc
  limit 1;

  if found then
    return v_existing_application.id;
  end if;

  select *
    into v_import
  from public.workspace_membership_import_runs as ir
  where ir.id = p_import_run_id
    and ir.organisation_id = p_organisation_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_IMPORT_NOT_FOUND: Import run was not found.' using errcode = '42501';
  end if;

  if v_import.status = 'applied' then
    select *
      into v_existing_application
    from public.workspace_membership_change_application_runs as ar
    where ar.organisation_id = p_organisation_id
      and ar.import_run_id = p_import_run_id
      and ar.status = 'applied'
    order by ar.completed_at desc nulls last, ar.created_at desc
    limit 1;

    if found then
      return v_existing_application.id;
    end if;

    insert into public.workspace_membership_change_application_runs (
      organisation_id,
      import_run_id,
      approved_change_set_version,
      operation_key,
      requested_by,
      started_at,
      completed_at,
      status,
      expected_counts,
      applied_counts,
      failure_code,
      failure_message
    )
    values (
      p_organisation_id,
      p_import_run_id,
      greatest(v_import.approved_change_set_version, 1),
      v_operation_key,
      v_actor.actor_user_id,
      now(),
      now(),
      'already_applied',
      coalesce(v_import.approved_change_set_summary, '{}'::jsonb),
      '{}'::jsonb,
      'already_applied',
      'This approved Workspace Team change set has already been applied.'
    )
    returning * into v_existing_application;

    return v_existing_application.id;
  end if;

  if v_import.status <> 'approved_for_application' then
    raise exception 'WT_MEMBERSHIP_APPLICATION_STATUS: Import run is not approved for application.' using errcode = '23514';
  end if;
  if v_import.approved_change_set_version <= 0 or jsonb_array_length(coalesce(v_import.approved_change_set, '[]'::jsonb)) = 0 then
    raise exception 'WT_MEMBERSHIP_APPLICATION_APPROVED_SET: Approved change set evidence is missing.' using errcode = '23514';
  end if;
  v_approved_snapshot_text := nullif(btrim(v_import.approved_live_snapshot_version), '');
  if v_approved_snapshot_text is null then
    raise exception 'WT_MEMBERSHIP_APPLICATION_SNAPSHOT: Approved change set snapshot is missing.' using errcode = '23514';
  end if;
  if v_approved_snapshot_text !~ '^[1-9][0-9]*$' then
    raise exception 'WT_MEMBERSHIP_APPLICATION_SNAPSHOT: Approved change set snapshot is not canonical decimal text.' using errcode = '23514';
  end if;

  insert into public.workspace_membership_change_application_runs (
    organisation_id,
    import_run_id,
    approved_change_set_version,
    operation_key,
    requested_by,
    started_at,
    status,
    expected_counts
  )
  values (
    p_organisation_id,
    p_import_run_id,
    v_import.approved_change_set_version,
    v_operation_key,
    v_actor.actor_user_id,
    now(),
    'applying',
    coalesce(v_import.approved_change_set_summary, '{}'::jsonb)
  )
  returning * into v_application;

  if v_import.source_superseded then
    v_failure_code := 'source_superseded';
    v_failure_message := 'The source export has been superseded since approval.';
  elsif v_import.source_export_id is not null then
    select *
      into v_source_export
    from public.workspace_membership_export_runs as er
    where er.id = v_import.source_export_id
      and er.organisation_id = p_organisation_id
    for update;

    if not found or v_source_export.status = 'superseded' or v_source_export.superseded_at is not null then
      v_failure_code := 'source_superseded';
      v_failure_message := 'The source export has been superseded since approval.';
    end if;
  end if;

  v_current_snapshot_text := public.current_workspace_membership_snapshot_version_text(p_organisation_id);
  if v_current_snapshot_text is null or v_current_snapshot_text !~ '^[1-9][0-9]*$' then
    raise exception 'WT_MEMBERSHIP_APPLICATION_SNAPSHOT: Current live snapshot could not be captured.' using errcode = '23514';
  end if;
  v_current_snapshot := v_current_snapshot_text::bigint;

  if v_failure_code is null and v_current_snapshot_text is distinct from v_approved_snapshot_text then
    update public.workspace_membership_change_application_runs as ar
      set status = 'drift_detected',
          completed_at = now(),
          live_snapshot_before = v_current_snapshot,
          failure_code = 'snapshot_drift',
          failure_message = 'Live Workspace Team data changed after approval. Re-upload or re-review before applying.'
    where ar.id = v_application.id
    returning * into v_application;

    update public.workspace_membership_import_runs as ir
      set status = 'application_failed_pending_review',
          failure_code = 'snapshot_drift',
          failure_message = 'Live Workspace Team data changed after approval. Re-upload or re-review before applying.'
    where ir.id = v_import.id
      and ir.organisation_id = p_organisation_id;

    perform public.record_workspace_membership_audit_event(
      p_organisation_id,
      null,
      null,
      v_actor.actor_user_id,
      'membership_change_set_drift_detected',
      'approved_for_application',
      'drift_detected',
      jsonb_build_object(
        'import_run_id', v_import.id,
        'approved_change_set_version', v_import.approved_change_set_version,
        'approved_live_snapshot_version', v_approved_snapshot_text
      ),
      jsonb_build_object(
        'application_run_id', v_application.id,
        'live_snapshot_version', v_current_snapshot_text,
        'applies_changes', false
      ),
      'Live Workspace Team data changed after approval. No membership, profile or auth change was applied.',
      'workspace_team_membership_application',
      v_correlation_id
    );

    return v_application.id;
  end if;

  if v_failure_code is null then
    select count(*)
      into v_duplicate_count
    from (
      select lower(nullif(value#>>'{proposed_values,email}', '')) as contact_email
      from jsonb_array_elements(v_import.approved_change_set) as approved(value)
      where value->>'decision' = 'approved'
        and value->>'proposal_type' = 'addition'
      group by lower(nullif(value#>>'{proposed_values,email}', ''))
      having count(*) > 1
    ) as duplicate_additions
    where duplicate_additions.contact_email is not null;

    if v_duplicate_count > 0 then
      v_failure_code := 'duplicate_addition_contact_email';
      v_failure_message := 'Approved additions contain duplicate contact email values.';
    end if;
  end if;

  if v_failure_code is null then
    select count(*)
      into v_duplicate_count
    from (
      select value#>>'{current_live_values,workspace_membership_id}' as membership_id
      from jsonb_array_elements(v_import.approved_change_set) as approved(value)
      where value->>'decision' = 'approved'
        and value->>'proposal_type' in ('identity_correction', 'deactivation', 'reactivation')
      group by value#>>'{current_live_values,workspace_membership_id}'
      having count(*) > 1
    ) as duplicate_targets
    where duplicate_targets.membership_id is not null;

    if v_duplicate_count > 0 then
      v_failure_code := 'duplicate_target_membership';
      v_failure_message := 'Approved changes contain duplicate target memberships.';
    end if;
  end if;

  if v_failure_code is null then
    for v_item in
      select approved.value
      from jsonb_array_elements(v_import.approved_change_set) as approved(value)
    loop
      v_decision_text := v_item->>'decision';
      v_proposal_type := v_item->>'proposal_type';
      v_proposed_values := case
        when jsonb_typeof(v_item->'recalculated_proposed_values') = 'object'
             and v_item->'recalculated_proposed_values' <> '{}'::jsonb
          then v_item->'recalculated_proposed_values'
        else coalesce(v_item->'proposed_values', '{}'::jsonb)
      end;

      select *
        into v_decision
      from public.workspace_membership_change_decisions as d
      where d.id = (v_item->>'decision_id')::uuid
        and d.import_run_id = v_import.id
        and d.organisation_id = p_organisation_id
        and d.import_row_id = (v_item->>'import_row_id')::uuid
        and d.is_current
      for update;

      if not found then
        v_failure_code := 'decision_drift';
        v_failure_message := 'Approved decision evidence no longer matches the stored change set.';
        exit;
      end if;

      if v_decision.decision is distinct from v_decision_text
         or v_decision.decision_version is distinct from (v_item->>'decision_version')::integer
         or v_decision.finalised_at is null then
        v_failure_code := 'decision_drift';
        v_failure_message := 'Approved decision evidence changed after final confirmation.';
        exit;
      end if;

      if v_decision_text <> 'approved' then
        continue;
      end if;

      select *
        into v_row
      from public.workspace_membership_import_rows as r
      where r.id = (v_item->>'import_row_id')::uuid
        and r.import_run_id = v_import.id
        and r.organisation_id = p_organisation_id
      for update;

      if not found or v_row.validation_state = 'error' or v_row.proposed_change_type is distinct from v_proposal_type then
        v_failure_code := 'row_drift';
        v_failure_message := 'Approved import row evidence no longer matches the stored change set.';
        exit;
      end if;

      if v_proposal_type = 'addition' then
        v_first_name := nullif(btrim(v_proposed_values->>'first_name'), '');
        v_last_name := nullif(btrim(v_proposed_values->>'last_name'), '');
        v_contact_email := lower(nullif(btrim(v_proposed_values->>'email'), ''));
        v_workspace_role := lower(coalesce(nullif(btrim(v_proposed_values->>'workspace_role'), ''), 'viewer'));

        if v_first_name is null or v_last_name is null or v_contact_email is null or v_workspace_role not in ('member', 'viewer') then
          v_failure_code := 'invalid_addition';
          v_failure_message := 'Approved addition no longer has valid name, contact email and role values.';
          exit;
        end if;
        if v_row.supplied_membership_id is not null or v_row.supplied_user_id is not null then
          v_failure_code := 'invalid_addition_identity';
          v_failure_message := 'Approved addition contains an existing membership or user identifier.';
          exit;
        end if;
        if exists (
          select 1
          from public.organisation_members as om
          join public.profiles as p on p.id = om.user_id
          where om.organisation_id = p_organisation_id
            and lower(coalesce(p.contact_email, '')) = v_contact_email
        ) then
          v_failure_code := 'duplicate_contact_email';
          v_failure_message := 'Current workspace data already contains an approved addition contact email.';
          exit;
        end if;
      elsif v_proposal_type in ('identity_correction', 'deactivation', 'reactivation') then
        select *
          into v_membership
        from public.organisation_members as om
        where om.id = v_row.supplied_membership_id
          and om.organisation_id = p_organisation_id
        for update;

        if not found or v_membership.user_id is distinct from v_row.supplied_user_id then
          v_failure_code := 'target_drift';
          v_failure_message := 'Target membership no longer matches the approved change set.';
          exit;
        end if;

        select *
          into v_profile
        from public.profiles as p
        where p.id = v_membership.user_id
        for update;

        if not found then
          v_failure_code := 'target_profile_missing';
          v_failure_message := 'Target profile no longer exists.';
          exit;
        end if;

        v_current_values := jsonb_build_object(
          'workspace_membership_id', v_membership.id,
          'user_id', v_membership.user_id,
          'workspace_role', v_membership.role,
          'membership_status', v_membership.status,
          'first_name', v_profile.first_name,
          'last_name', v_profile.last_name,
          'email', v_profile.contact_email,
          'accepted_at', v_membership.accepted_at,
          'joined_at', v_membership.joined_at,
          'deactivated_at', v_membership.deactivated_at,
          'reactivated_at', v_membership.reactivated_at
        );

        if v_current_values is distinct from coalesce(v_item->'current_live_values', '{}'::jsonb) then
          v_failure_code := 'target_drift';
          v_failure_message := 'Current membership or profile values changed after approval.';
          exit;
        end if;
        if v_membership.role in ('owner', 'admin') then
          v_failure_code := 'protected_role';
          v_failure_message := 'Owner and Admin memberships cannot be applied from CSV.';
          exit;
        end if;
        if v_proposal_type = 'identity_correction' then
          if v_proposed_values ? 'workspace_role' or v_proposed_values ? 'membership_status' or v_proposed_values ? 'login_name' then
            v_failure_code := 'invalid_profile_correction';
            v_failure_message := 'Profile corrections may only change first name, last name and contact email.';
            exit;
          end if;
        elsif v_proposal_type = 'deactivation' then
          v_impact_counts := coalesce(v_item->'impact_counts', '{}'::jsonb);
          if v_membership.user_id = v_actor.actor_user_id then
            v_failure_code := 'self_deactivation';
            v_failure_message := 'Users cannot apply their own deactivation.';
            exit;
          end if;
          if v_membership.status <> 'active' then
            v_failure_code := 'target_drift';
            v_failure_message := 'Target membership is no longer active.';
            exit;
          end if;
          if coalesce((v_impact_counts->>'active_risks_owned')::integer, 0) > 0
             or coalesce((v_impact_counts->>'non_terminal_actions_assigned')::integer, 0) > 0
             or coalesce((v_impact_counts->>'non_terminal_approvals_held')::integer, 0) > 0
             or coalesce((v_impact_counts->>'active_project_roles')::integer, 0) > 0 then
            v_failure_code := 'responsibility_impact';
            v_failure_message := 'Approved deactivation still has known responsibility impact.';
            exit;
          end if;
        elsif v_proposal_type = 'reactivation' and v_membership.status not in ('deactivated', 'suspended') then
          v_failure_code := 'target_drift';
          v_failure_message := 'Target membership is no longer eligible for reactivation.';
          exit;
        end if;
      else
        v_failure_code := 'unsupported_proposal_type';
        v_failure_message := 'Approved change set contains an unsupported proposal type.';
        exit;
      end if;
    end loop;
  end if;

  if v_failure_code is not null then
    update public.workspace_membership_change_application_runs as ar
      set status = case when v_failure_code in ('source_superseded', 'target_drift', 'row_drift', 'decision_drift') then 'drift_detected' else 'failed' end,
          completed_at = now(),
          live_snapshot_before = v_current_snapshot,
          failure_code = v_failure_code,
          failure_message = v_failure_message
    where ar.id = v_application.id
    returning * into v_application;

    update public.workspace_membership_import_runs as ir
      set status = 'application_failed_pending_review',
          failure_code = v_failure_code,
          failure_message = v_failure_message
    where ir.id = v_import.id
      and ir.organisation_id = p_organisation_id;

    perform public.record_workspace_membership_audit_event(
      p_organisation_id,
      null,
      null,
      v_actor.actor_user_id,
      case when v_application.status = 'drift_detected' then 'membership_change_set_drift_detected' else 'membership_change_application_failed' end,
      'approved_for_application',
      v_application.status,
      jsonb_build_object('import_run_id', v_import.id, 'approved_change_set_version', v_import.approved_change_set_version),
      jsonb_build_object('application_run_id', v_application.id, 'failure_code', v_failure_code, 'applies_changes', false),
      v_failure_message,
      'workspace_team_membership_application',
      v_correlation_id
    );

    return v_application.id;
  end if;

  for v_item in
    select approved.value
    from jsonb_array_elements(v_import.approved_change_set) as approved(value)
    where approved.value->>'decision' = 'approved'
    order by coalesce((approved.value->>'source_row_number')::integer, 0)
  loop
    v_proposal_type := v_item->>'proposal_type';
    v_proposed_values := case
      when jsonb_typeof(v_item->'recalculated_proposed_values') = 'object'
           and v_item->'recalculated_proposed_values' <> '{}'::jsonb
        then v_item->'recalculated_proposed_values'
      else coalesce(v_item->'proposed_values', '{}'::jsonb)
    end;

    select *
      into v_row
    from public.workspace_membership_import_rows as r
    where r.id = (v_item->>'import_row_id')::uuid
      and r.import_run_id = v_import.id
      and r.organisation_id = p_organisation_id
    for update;

    if v_proposal_type = 'addition' then
      v_new_profile_id := gen_random_uuid();
      v_first_name := nullif(btrim(v_proposed_values->>'first_name'), '');
      v_last_name := nullif(btrim(v_proposed_values->>'last_name'), '');
      v_contact_email := lower(nullif(btrim(v_proposed_values->>'email'), ''));
      v_workspace_role := lower(coalesce(nullif(btrim(v_proposed_values->>'workspace_role'), ''), 'viewer'));
      v_display_name := public.workspace_membership_application_display_name(v_first_name, v_last_name, v_contact_email);
      v_login_name := public.workspace_profile_next_login_name(v_display_name, v_new_profile_id);
      v_auth_email := public.workspace_membership_pending_auth_email(v_login_name, v_new_profile_id);

      insert into auth.users (
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        invited_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      )
      values (
        v_new_profile_id,
        'authenticated',
        'authenticated',
        v_auth_email,
        null,
        null,
        now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        jsonb_build_object(
          'watchtower_pending_workspace_invitation', true,
          'organisation_id', p_organisation_id,
          'import_run_id', v_import.id,
          'import_row_id', v_row.id
        ),
        now(),
        now()
      );

      insert into public.profiles (
        id,
        email,
        display_name,
        first_name,
        last_name,
        login_name,
        contact_email,
        created_by,
        updated_by
      )
      values (
        v_new_profile_id,
        v_auth_email,
        v_display_name,
        v_first_name,
        v_last_name,
        v_login_name,
        v_contact_email,
        v_actor.actor_user_id,
        v_actor.actor_user_id
      );

      insert into public.organisation_members (
        organisation_id,
        user_id,
        role,
        status,
        invited_by,
        invited_at,
        joined_at,
        updated_by
      )
      values (
        p_organisation_id,
        v_new_profile_id,
        v_workspace_role,
        'invited',
        v_actor.actor_user_id,
        now(),
        null,
        v_actor.actor_user_id
      )
      returning * into v_new_membership;

      insert into public.workspace_membership_invitation_handoffs (
        organisation_id,
        application_run_id,
        import_run_id,
        import_row_id,
        profile_id,
        organisation_membership_id,
        contact_email,
        status
      )
      values (
        p_organisation_id,
        v_application.id,
        v_import.id,
        v_row.id,
        v_new_profile_id,
        v_new_membership.id,
        v_contact_email,
        'pending'
      );

      update public.workspace_membership_import_rows as r
        set apply_status = 'applied',
            applied_at = now(),
            application_run_id = v_application.id,
            apply_message = 'Addition applied as invited membership pending invitation delivery.'
      where r.id = v_row.id;

      perform public.record_workspace_membership_audit_event(
        p_organisation_id,
        v_new_membership.id,
        v_new_profile_id,
        v_actor.actor_user_id,
        'membership_addition_applied',
        null,
        'invited',
        jsonb_build_object('import_run_id', v_import.id, 'import_row_id', v_row.id),
        jsonb_build_object(
          'application_run_id', v_application.id,
          'profile_id', v_new_profile_id,
          'workspace_role', v_workspace_role,
          'contact_email', v_contact_email,
          'login_name', v_login_name,
          'auth_email_is_placeholder', true,
          'invitation_delivery_pending', true
        ),
        'Approved Workspace Team CSV addition applied as invited membership.',
        'workspace_team_membership_application',
        v_correlation_id
      );

      v_additions := v_additions + 1;
      v_handoffs := v_handoffs + 1;
    elsif v_proposal_type = 'identity_correction' then
      select *
        into v_membership
      from public.organisation_members as om
      where om.id = v_row.supplied_membership_id
        and om.organisation_id = p_organisation_id
      for update;

      select *
        into v_profile
      from public.profiles as p
      where p.id = v_membership.user_id
      for update;

      update public.profiles as p
        set first_name = case when v_proposed_values ? 'first_name' then nullif(btrim(v_proposed_values->>'first_name'), '') else p.first_name end,
            last_name = case when v_proposed_values ? 'last_name' then nullif(btrim(v_proposed_values->>'last_name'), '') else p.last_name end,
            contact_email = case when v_proposed_values ? 'email' then lower(nullif(btrim(v_proposed_values->>'email'), '')) else p.contact_email end,
            updated_by = v_actor.actor_user_id
      where p.id = v_membership.user_id
      returning * into v_profile;

      update public.workspace_membership_import_rows as r
        set apply_status = 'applied',
            applied_at = now(),
            application_run_id = v_application.id,
            apply_message = 'Profile identity correction applied.'
      where r.id = v_row.id;

      perform public.record_workspace_membership_audit_event(
        p_organisation_id,
        v_membership.id,
        v_membership.user_id,
        v_actor.actor_user_id,
        'profile_identity_correction_applied',
        v_membership.status,
        v_membership.status,
        jsonb_build_object(
          'import_run_id', v_import.id,
          'import_row_id', v_row.id,
          'first_name', v_item#>>'{current_live_values,first_name}',
          'last_name', v_item#>>'{current_live_values,last_name}',
          'contact_email', v_item#>>'{current_live_values,email}'
        ),
        jsonb_build_object(
          'application_run_id', v_application.id,
          'first_name', v_profile.first_name,
          'last_name', v_profile.last_name,
          'contact_email', v_profile.contact_email,
          'auth_email_unchanged', true,
          'login_name_unchanged', true
        ),
        'Approved Workspace Team CSV profile identity correction applied.',
        'workspace_team_membership_application',
        v_correlation_id
      );

      v_corrections := v_corrections + 1;
    elsif v_proposal_type = 'deactivation' then
      select *
        into v_membership
      from public.organisation_members as om
      where om.id = v_row.supplied_membership_id
        and om.organisation_id = p_organisation_id
      for update;

      update public.organisation_members as om
        set status = 'deactivated',
            deactivated_at = now(),
            deactivated_by = v_actor.actor_user_id,
            deactivation_reason = 'Applied from approved Workspace Team CSV change set.',
            updated_by = v_actor.actor_user_id
      where om.id = v_membership.id
      returning * into v_updated_membership;

      update public.workspace_membership_import_rows as r
        set apply_status = 'applied',
            applied_at = now(),
            application_run_id = v_application.id,
            apply_message = 'Membership deactivation applied.'
      where r.id = v_row.id;

      perform public.record_workspace_membership_audit_event(
        p_organisation_id,
        v_updated_membership.id,
        v_updated_membership.user_id,
        v_actor.actor_user_id,
        'membership_deactivation_applied',
        v_membership.status,
        v_updated_membership.status,
        public.workspace_membership_json(v_membership),
        public.workspace_membership_json(v_updated_membership) || jsonb_build_object('application_run_id', v_application.id, 'import_run_id', v_import.id, 'import_row_id', v_row.id),
        'Approved Workspace Team CSV deactivation applied.',
        'workspace_team_membership_application',
        v_correlation_id
      );

      v_deactivations := v_deactivations + 1;
    elsif v_proposal_type = 'reactivation' then
      select *
        into v_membership
      from public.organisation_members as om
      where om.id = v_row.supplied_membership_id
        and om.organisation_id = p_organisation_id
      for update;

      update public.organisation_members as om
        set status = 'active',
            reactivated_at = now(),
            reactivated_by = v_actor.actor_user_id,
            reactivation_reason = 'Applied from approved Workspace Team CSV change set.',
            updated_by = v_actor.actor_user_id,
            joined_at = coalesce(om.joined_at, now()),
            accepted_at = coalesce(om.accepted_at, now())
      where om.id = v_membership.id
      returning * into v_updated_membership;

      update public.workspace_membership_import_rows as r
        set apply_status = 'applied',
            applied_at = now(),
            application_run_id = v_application.id,
            apply_message = 'Membership reactivation applied.'
      where r.id = v_row.id;

      perform public.record_workspace_membership_audit_event(
        p_organisation_id,
        v_updated_membership.id,
        v_updated_membership.user_id,
        v_actor.actor_user_id,
        'membership_reactivation_applied',
        v_membership.status,
        v_updated_membership.status,
        public.workspace_membership_json(v_membership),
        public.workspace_membership_json(v_updated_membership) || jsonb_build_object('application_run_id', v_application.id, 'import_run_id', v_import.id, 'import_row_id', v_row.id),
        'Approved Workspace Team CSV reactivation applied.',
        'workspace_team_membership_application',
        v_correlation_id
      );

      v_reactivations := v_reactivations + 1;
    end if;
  end loop;

  v_after_snapshot := public.current_workspace_membership_snapshot_version(p_organisation_id);

  update public.workspace_membership_change_application_runs as ar
    set status = 'applied',
        completed_at = now(),
        live_snapshot_before = v_current_snapshot,
        live_snapshot_after = v_after_snapshot,
        applied_counts = jsonb_build_object(
          'additions', v_additions,
          'identity_corrections', v_corrections,
          'deactivations', v_deactivations,
          'reactivations', v_reactivations
        ),
        invitation_handoff_count = v_handoffs
  where ar.id = v_application.id
  returning * into v_application;

  update public.workspace_membership_import_runs as ir
    set status = 'applied',
        applied_at = now(),
        applied_by = v_actor.actor_user_id,
        failure_code = null,
        failure_message = null
  where ir.id = v_import.id;

  perform public.record_workspace_membership_audit_event(
    p_organisation_id,
    null,
    null,
    v_actor.actor_user_id,
    'membership_change_set_applied',
    'approved_for_application',
    'applied',
    jsonb_build_object(
      'import_run_id', v_import.id,
      'approved_change_set_version', v_import.approved_change_set_version,
      'approved_live_snapshot_version', v_approved_snapshot_text
    ),
    jsonb_build_object(
      'application_run_id', v_application.id,
      'applied_counts', v_application.applied_counts,
      'invitation_handoff_count', v_application.invitation_handoff_count,
      'live_snapshot_before', v_current_snapshot_text,
      'live_snapshot_after', v_after_snapshot::text
    ),
    'Approved Workspace Team CSV change set applied transactionally.',
    'workspace_team_membership_application',
    v_correlation_id
  );

  return v_application.id;
exception
  when others then
    if v_application.id is null then
      raise;
    end if;

    insert into public.workspace_membership_change_application_runs (
      id,
      organisation_id,
      import_run_id,
      approved_change_set_version,
      operation_key,
      requested_by,
      started_at,
      completed_at,
      status,
      expected_counts,
      applied_counts,
      live_snapshot_before,
      failure_code,
      failure_message
    )
    values (
      v_application.id,
      p_organisation_id,
      p_import_run_id,
      greatest(coalesce(v_import.approved_change_set_version, 0), 1),
      v_operation_key,
      v_actor.actor_user_id,
      coalesce(v_application.started_at, now()),
      now(),
      'rolled_back',
      coalesce(v_import.approved_change_set_summary, '{}'::jsonb),
      '{}'::jsonb,
      v_current_snapshot,
      'transaction_rolled_back',
      'The membership application rolled back after an unexpected database error. No partial membership changes were committed.'
    )
    on conflict (id) do update
      set completed_at = excluded.completed_at,
          status = 'rolled_back',
          failure_code = excluded.failure_code,
          failure_message = excluded.failure_message;

    update public.workspace_membership_import_runs as ir
      set status = 'application_failed_pending_review',
          failure_code = 'transaction_rolled_back',
          failure_message = 'The membership application rolled back after an unexpected database error. No partial membership changes were committed.'
    where ir.id = p_import_run_id
      and ir.organisation_id = p_organisation_id;

    perform public.record_workspace_membership_audit_event(
      p_organisation_id,
      null,
      null,
      v_actor.actor_user_id,
      'membership_change_application_failed',
      'approved_for_application',
      'rolled_back',
      jsonb_build_object(
        'import_run_id', p_import_run_id,
        'approved_change_set_version', coalesce(v_import.approved_change_set_version, 0)
      ),
      jsonb_build_object(
        'application_run_id', v_application.id,
        'failure_code', 'transaction_rolled_back',
        'sqlstate', sqlstate,
        'applies_changes', false
      ),
      'The membership application rolled back after an unexpected database error. No partial membership changes were committed.',
      'workspace_team_membership_application',
      v_correlation_id
    );

    return v_application.id;
end;
$$;

revoke all on function public.reconfirm_workspace_membership_approved_change_set(uuid, uuid[], text) from public;
grant execute on function public.reconfirm_workspace_membership_approved_change_set(uuid, uuid[], text) to authenticated, service_role;

revoke all on function public.confirm_workspace_membership_change_set(uuid) from public;
revoke all on function public.confirm_workspace_membership_selected_change_set(uuid, uuid[], text) from public;
revoke all on function public.apply_workspace_membership_change_set(uuid, uuid, uuid) from public;
grant execute on function public.confirm_workspace_membership_change_set(uuid) to authenticated, service_role;
grant execute on function public.confirm_workspace_membership_selected_change_set(uuid, uuid[], text) to authenticated, service_role;
grant execute on function public.apply_workspace_membership_change_set(uuid, uuid, uuid) to authenticated, service_role;

comment on column public.workspace_membership_import_runs.approved_live_snapshot_version is
  'Canonical WT-006 approved live workspace snapshot as decimal text for WT-007 application gating. Existing bigint snapshot storage is legacy compatibility only.';
comment on function public.reconfirm_workspace_membership_approved_change_set(uuid, uuid[], text) is
  'Deliberately re-reviews an already-approved Workspace Team change set, preserves or revises selected/excluded decisions, records the exact approved live snapshot as text and never mutates membership/profile/auth/invitation delivery records.';
comment on function public.apply_workspace_membership_change_set(uuid, uuid, uuid) is
  'Applies only the frozen approved Workspace Team CSV change set after live revalidation against approved_live_snapshot_version. The operation is transactional, creates pending Auth identities for additions without invitation delivery, preserves evidence rows and does not apply excluded proposals.';
