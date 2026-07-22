-- WT-WORKSPACE-TEAM-006 change comparison and individual approval.
-- This records review decisions and freezes an approved change set only.
-- It deliberately does not create auth users, invitations, memberships, profile updates,
-- deactivations, reactivations, role changes or reassignment actions.

alter table public.workspace_membership_import_runs
  add column if not exists review_status text not null default 'not_started',
  add column if not exists review_started_at timestamptz,
  add column if not exists review_completed_at timestamptz,
  add column if not exists review_completed_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_change_set_version integer not null default 0,
  add column if not exists approved_change_set_snapshot_version bigint,
  add column if not exists approved_change_set jsonb not null default '[]'::jsonb,
  add column if not exists approved_change_set_summary jsonb not null default '{}'::jsonb,
  add column if not exists approval_locked_at timestamptz,
  add column if not exists approval_locked_by uuid references auth.users(id) on delete set null;

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
      'applied',
      'failed',
      'superseded',
      'cancelled'
    )),
  drop constraint if exists workspace_membership_import_runs_review_status_check,
  add constraint workspace_membership_import_runs_review_status_check
    check (review_status in ('not_started', 'in_review', 'ready_for_application', 'review_blocked', 'superseded')),
  drop constraint if exists workspace_membership_import_runs_approved_set_shape_check,
  add constraint workspace_membership_import_runs_approved_set_shape_check
    check (
      approved_change_set_version >= 0
      and (approved_change_set_snapshot_version is null or approved_change_set_snapshot_version > 0)
      and jsonb_typeof(approved_change_set) = 'array'
      and jsonb_typeof(approved_change_set_summary) = 'object'
      and (status <> 'approved_for_application' or (review_completed_at is not null and approval_locked_at is not null))
    );

alter table public.workspace_membership_change_decisions
  add column if not exists previous_decision text,
  add column if not exists decision_version integer not null default 1,
  add column if not exists decision_history jsonb not null default '[]'::jsonb,
  add column if not exists live_recalculation_status text not null default 'valid',
  add column if not exists live_recalculated_at timestamptz,
  add column if not exists live_snapshot_version bigint,
  add column if not exists live_values jsonb not null default '{}'::jsonb,
  add column if not exists recalculated_proposed_values jsonb not null default '{}'::jsonb,
  add column if not exists impact_counts jsonb not null default '{}'::jsonb,
  add column if not exists is_current boolean not null default true,
  add column if not exists finalised_at timestamptz,
  add column if not exists finalised_by uuid references auth.users(id) on delete set null;

alter table public.workspace_membership_change_decisions
  drop constraint if exists workspace_membership_change_decisions_decision_check,
  add constraint workspace_membership_change_decisions_decision_check
    check (decision in ('pending', 'approved', 'excluded', 'keep_active', 'blocked', 'superseded', 'no_longer_required', 'rejected', 'skipped')),
  drop constraint if exists workspace_membership_change_decisions_previous_decision_check,
  add constraint workspace_membership_change_decisions_previous_decision_check
    check (previous_decision is null or previous_decision in ('pending', 'approved', 'excluded', 'keep_active', 'blocked', 'superseded', 'no_longer_required', 'rejected', 'skipped')),
  drop constraint if exists workspace_membership_change_decisions_history_shape_check,
  add constraint workspace_membership_change_decisions_history_shape_check
    check (
      decision_version > 0
      and jsonb_typeof(decision_history) = 'array'
      and jsonb_typeof(live_values) = 'object'
      and jsonb_typeof(recalculated_proposed_values) = 'object'
      and jsonb_typeof(impact_counts) = 'object'
      and (live_snapshot_version is null or live_snapshot_version > 0)
    ),
  drop constraint if exists workspace_membership_change_decisions_recalculation_status_check,
  add constraint workspace_membership_change_decisions_recalculation_status_check
    check (live_recalculation_status in ('valid', 'changed_since_upload', 'no_longer_required', 'blocked', 'requires_revalidation', 'superseded')),
  drop constraint if exists workspace_membership_change_decisions_decided_check,
  add constraint workspace_membership_change_decisions_decided_check
    check ((decision = 'pending' and decided_at is null) or (decision <> 'pending' and decided_at is not null));

create unique index if not exists workspace_membership_change_decisions_current_row_key
  on public.workspace_membership_change_decisions (import_row_id)
  where is_current;

create index if not exists workspace_membership_change_decisions_recalculation_idx
  on public.workspace_membership_change_decisions (import_run_id, live_recalculation_status, decision);

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
      'membership_change_approved',
      'membership_change_excluded',
      'membership_deactivation_kept_active',
      'membership_change_decision_revised',
      'membership_change_blocked',
      'membership_change_no_longer_required',
      'membership_change_set_confirmed'
    ));

create or replace function public.workspace_membership_import_requires_decision(import_row public.workspace_membership_import_rows)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select import_row.validation_state in ('valid', 'warning')
    and import_row.is_unchanged = false
    and import_row.proposed_change_type in ('addition', 'identity_correction', 'deactivation', 'reactivation');
$$;

create or replace function public.workspace_membership_known_responsibility_counts(
  target_organisation_id uuid,
  target_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  risks_owned integer := 0;
  risk_actions integer := 0;
  actions_assigned integer := 0;
  approvals_held integer := 0;
  submitted_approvals integer := 0;
  project_roles integer := 0;
begin
  select count(*) into risks_owned
  from public.project_risks pr
  where pr.organisation_id = target_organisation_id
    and pr.owner_id = target_user_id
    and pr.archived_at is null
    and pr.deleted_at is null
    and pr.status <> 'closed';

  select count(*) into risk_actions
  from public.project_risks pr
  where pr.organisation_id = target_organisation_id
    and pr.actioner_id = target_user_id
    and pr.archived_at is null
    and pr.deleted_at is null
    and pr.status in ('open', 'monitoring', 'mitigating');

  select count(*) into actions_assigned
  from public.project_actions pa
  where pa.organisation_id = target_organisation_id
    and pa.actioner_id = target_user_id
    and pa.status not in ('complete', 'cancelled');

  select count(*) into approvals_held
  from public.project_actions pa
  where pa.organisation_id = target_organisation_id
    and pa.acceptance_owner_id = target_user_id
    and pa.status not in ('complete', 'cancelled');

  select count(*) into submitted_approvals
  from public.project_actions pa
  where pa.organisation_id = target_organisation_id
    and pa.acceptance_owner_id = target_user_id
    and pa.status = 'submitted';

  select count(*) into project_roles
  from public.project_people pp
  where pp.organisation_id = target_organisation_id
    and pp.user_id = target_user_id
    and pp.status = 'active';

  return jsonb_build_object(
    'active_risks_owned', risks_owned,
    'active_risk_actions_assigned', risk_actions,
    'non_terminal_actions_assigned', actions_assigned,
    'non_terminal_approvals_held', approvals_held,
    'submitted_actions_awaiting_approval', submitted_approvals,
    'active_project_roles', project_roles,
    'risk_mitigations_awaiting_owner_approval', 0,
    'assessment_scope', 'preliminary',
    'full_assessment_pending_slice', 'WT-WORKSPACE-TEAM-010'
  );
end;
$$;

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

  if not found or import_run.status not in ('validated', 'stale_review_required', 'approval_pending') then
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

  if import_run.status not in ('validated', 'stale_review_required', 'approval_pending') then
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
    live_recalculation_status
  )
  select
    wir.id,
    wir.import_run_id,
    wir.organisation_id,
    'pending',
    1,
    '[]'::jsonb,
    'valid'
  from public.workspace_membership_import_rows wir
  where wir.import_run_id = target_import_run_id
    and wir.organisation_id = import_run.organisation_id
    and public.workspace_membership_import_requires_decision(wir)
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  update public.workspace_membership_import_runs
    set review_status = case when review_status = 'not_started' then 'in_review' else review_status end,
        review_started_at = coalesce(review_started_at, now())
  where id = import_run.id;

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
      'decision_reason', decision_record.reason
    ));
  end loop;

  return output_rows;
end;
$$;

create or replace function public.record_workspace_membership_change_decision(
  target_decision_id uuid,
  requested_decision text,
  decision_reason text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_decision public.workspace_membership_change_decisions;
  import_row public.workspace_membership_import_rows;
  import_run public.workspace_membership_import_runs;
  actor record;
  recalculation jsonb;
  reason_clean text := nullif(btrim(decision_reason), '');
  old_decision text;
  event_name text;
  current_snapshot bigint;
begin
  select *
    into current_decision
  from public.workspace_membership_change_decisions wcd
  where wcd.id = target_decision_id
    and wcd.is_current
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_DECISION_NOT_FOUND: Decision was not found.' using errcode = '42501';
  end if;

  select * into import_row
  from public.workspace_membership_import_rows wir
  where wir.id = current_decision.import_row_id
    and wir.import_run_id = current_decision.import_run_id
    and wir.organisation_id = current_decision.organisation_id;

  select * into import_run
  from public.workspace_membership_import_runs wir
  where wir.id = current_decision.import_run_id
    and wir.organisation_id = current_decision.organisation_id;

  select * into actor from public.workspace_membership_require_admin_actor(current_decision.organisation_id);

  if import_run.status not in ('validated', 'stale_review_required', 'approval_pending') then
    raise exception 'WT_MEMBERSHIP_IMPORT_REVIEW_STATUS: Import run is not eligible for decisions.' using errcode = '23514';
  end if;
  if import_run.source_superseded then
    raise exception 'WT_MEMBERSHIP_IMPORT_SUPERSEDED: Superseded imports cannot receive decisions.' using errcode = '23514';
  end if;
  if requested_decision not in ('approved', 'excluded', 'keep_active') then
    raise exception 'WT_MEMBERSHIP_DECISION_VALUE: Unsupported decision.' using errcode = '23514';
  end if;
  if current_decision.decision in ('blocked', 'superseded', 'no_longer_required') then
    raise exception 'WT_MEMBERSHIP_DECISION_LOCKED: Live recalculation has locked this proposal state.' using errcode = '23514';
  end if;
  if not public.workspace_membership_import_requires_decision(import_row) then
    raise exception 'WT_MEMBERSHIP_DECISION_ROW_STATE: Invalid or unchanged rows cannot be decided.' using errcode = '23514';
  end if;
  if import_row.proposed_change_type = 'deactivation' and requested_decision not in ('approved', 'keep_active') then
    raise exception 'WT_MEMBERSHIP_DECISION_VALUE: Deactivation proposals require approve deactivation or keep active.' using errcode = '23514';
  elsif import_row.proposed_change_type <> 'deactivation' and requested_decision = 'keep_active' then
    raise exception 'WT_MEMBERSHIP_DECISION_VALUE: Keep active is only available for deactivation proposals.' using errcode = '23514';
  end if;

  current_snapshot := public.current_workspace_membership_snapshot_version(import_run.organisation_id);
  recalculation := public.workspace_membership_recalculate_import_row(import_row, actor.actor_user_id);

  if requested_decision = 'approved' and (recalculation->>'status') in ('blocked', 'superseded', 'requires_revalidation', 'no_longer_required') then
    raise exception 'WT_MEMBERSHIP_DECISION_BLOCKED: This proposal cannot currently be approved.' using errcode = '23514';
  end if;

  if (
    requested_decision = 'keep_active'
    or (requested_decision = 'approved' and import_row.validation_state = 'warning')
    or (requested_decision = 'approved' and import_run.status = 'stale_review_required')
    or (current_decision.decision <> 'pending' and current_decision.decision is distinct from requested_decision)
  ) and reason_clean is null then
    raise exception 'WT_MEMBERSHIP_DECISION_REASON_REQUIRED: A reason is required for this decision.' using errcode = '23514';
  end if;

  old_decision := current_decision.decision;
  event_name := case
    when requested_decision = 'approved' then 'membership_change_approved'
    when requested_decision = 'keep_active' then 'membership_deactivation_kept_active'
    else 'membership_change_excluded'
  end;

  update public.workspace_membership_change_decisions
    set previous_decision = old_decision,
        decision = requested_decision,
        decided_by = actor.actor_user_id,
        decided_at = now(),
        reason = reason_clean,
        decision_version = current_decision.decision_version + 1,
        decision_history = coalesce(current_decision.decision_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'actor_user_id', actor.actor_user_id,
          'previous_decision', old_decision,
          'new_decision', requested_decision,
          'reason', reason_clean,
          'decided_at', now(),
          'live_recalculation_status', recalculation->>'status',
          'live_snapshot_version', current_snapshot
        )),
        live_recalculation_status = recalculation->>'status',
        live_recalculated_at = now(),
        live_snapshot_version = current_snapshot,
        live_values = coalesce(recalculation->'current_live_values', '{}'::jsonb),
        recalculated_proposed_values = coalesce(recalculation->'recalculated_proposed_values', '{}'::jsonb),
        impact_counts = coalesce(recalculation->'impact_counts', '{}'::jsonb)
  where id = current_decision.id;

  update public.workspace_membership_import_runs
    set review_status = 'in_review',
        review_started_at = coalesce(review_started_at, now())
  where id = import_run.id;

  if old_decision <> 'pending' and old_decision is distinct from requested_decision then
    perform public.record_workspace_membership_audit_event(
      current_decision.organisation_id,
      import_row.supplied_membership_id,
      import_row.supplied_user_id,
      actor.actor_user_id,
      'membership_change_decision_revised',
      old_decision,
      requested_decision,
      jsonb_build_object('import_run_id', import_run.id, 'import_row_id', import_row.id),
      jsonb_build_object('reason', reason_clean, 'proposal_type', import_row.proposed_change_type),
      reason_clean,
      'workspace_team_change_review',
      import_run.id
    );
  end if;

  perform public.record_workspace_membership_audit_event(
    current_decision.organisation_id,
    import_row.supplied_membership_id,
    import_row.supplied_user_id,
    actor.actor_user_id,
    event_name,
    old_decision,
    requested_decision,
    jsonb_build_object('import_run_id', import_run.id, 'import_row_id', import_row.id),
    jsonb_build_object(
      'proposal_type', import_row.proposed_change_type,
      'decision_version', current_decision.decision_version + 1,
      'live_recalculation_status', recalculation->>'status',
      'live_snapshot_version', current_snapshot
    ),
    reason_clean,
    'workspace_team_change_review',
    import_run.id
  );

  return current_decision.id;
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
  current_snapshot := public.current_workspace_membership_snapshot_version(import_run.organisation_id);

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
    'live_snapshot_version', current_snapshot,
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
        approved_change_set_snapshot_version = current_snapshot,
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
      'summary', summary,
      'live_snapshot_version', current_snapshot,
      'applies_changes', false
    ),
    'Workspace Team CSV changes approved for later application. No membership, profile or auth change was applied.',
    'workspace_team_change_review',
    import_run.id
  );

  return import_run.id;
end;
$$;

revoke insert, update on public.workspace_membership_change_decisions from authenticated;
revoke update on public.workspace_membership_import_runs from authenticated;

revoke all on function public.workspace_membership_import_requires_decision(public.workspace_membership_import_rows) from public;
revoke all on function public.workspace_membership_known_responsibility_counts(uuid, uuid) from public;
revoke all on function public.workspace_membership_recalculate_import_row(public.workspace_membership_import_rows, uuid) from public;
revoke all on function public.ensure_workspace_membership_change_decisions(uuid) from public;
revoke all on function public.recalculate_workspace_membership_change_proposals(uuid) from public;
revoke all on function public.record_workspace_membership_change_decision(uuid, text, text) from public;
revoke all on function public.confirm_workspace_membership_change_set(uuid) from public;

grant execute on function public.ensure_workspace_membership_change_decisions(uuid) to authenticated, service_role;
grant execute on function public.recalculate_workspace_membership_change_proposals(uuid) to authenticated, service_role;
grant execute on function public.record_workspace_membership_change_decision(uuid, text, text) to authenticated, service_role;
grant execute on function public.confirm_workspace_membership_change_set(uuid) to authenticated, service_role;

grant execute on function public.workspace_membership_import_requires_decision(public.workspace_membership_import_rows) to service_role;
grant execute on function public.workspace_membership_known_responsibility_counts(uuid, uuid) to service_role;
grant execute on function public.workspace_membership_recalculate_import_row(public.workspace_membership_import_rows, uuid) to service_role;

comment on column public.workspace_membership_import_runs.approved_change_set is
  'Versioned WT-006 approved proposal evidence for WT-007. This is an intent set only and no membership/profile/auth changes are applied by WT-006.';
comment on column public.workspace_membership_change_decisions.decision_history is
  'Auditable decision revisions for one current proposal decision. The current decision row remains mutable until the import run is confirmed for application.';
comment on function public.confirm_workspace_membership_change_set(uuid) is
  'Freezes a versioned Workspace Team import change set after live revalidation. This function never mutates profiles, auth users, organisation_members, invitations or reassignment records.';
