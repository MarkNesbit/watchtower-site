-- WT-WORKSPACE-TEAM-009B individual member deactivation and responsibility impact.
--
-- This slice adds modal-scoped deactivation for active memberships only. It
-- preserves the CSV workflow, profile identity, Auth users and historical
-- responsibility links.

create or replace function public.workspace_member_deactivation_authority_message(
  actor_role text,
  actor_user_id uuid,
  target_membership public.organisation_members
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when actor_role not in ('owner', 'admin') then 'Only active Workspace Owners and Admins can deactivate workspace members.'
    when target_membership.auth_user_id = actor_user_id
      or (target_membership.auth_user_id is null and target_membership.user_id = actor_user_id)
      then 'Users cannot deactivate their own workspace membership through this modal.'
    when actor_role = 'owner' then 'Owners can deactivate another active workspace member after reviewing current responsibilities.'
    when actor_role = 'admin' and target_membership.role in ('viewer', 'member') then 'Admins can deactivate Viewers and Members after reviewing current responsibilities.'
    when actor_role = 'admin' and target_membership.role = 'admin' then 'Only a Workspace Owner may deactivate an Admin.'
    when actor_role = 'admin' and target_membership.role = 'owner' then 'Admins cannot deactivate an Owner.'
    else 'This member cannot be deactivated through this modal.'
  end;
$$;

create or replace function public.workspace_member_deactivation_can_deactivate(
  actor_role text,
  actor_user_id uuid,
  target_membership public.organisation_members
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_membership.status = 'active'
    and actor_role in ('owner', 'admin')
    and not (
      target_membership.auth_user_id = actor_user_id
      or (target_membership.auth_user_id is null and target_membership.user_id = actor_user_id)
    )
    and (
      actor_role = 'owner'
      or (actor_role = 'admin' and target_membership.role in ('viewer', 'member'))
    );
$$;

create or replace function public.workspace_member_deactivation_impact_counts(
  p_organisation_id uuid,
  p_profile_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'active_risks_owned', (
      select count(*)::integer
      from public.project_risks risk
      where risk.organisation_id = p_organisation_id
        and risk.owner_id = p_profile_id
        and risk.status in ('open', 'monitoring', 'mitigating')
        and risk.archived_at is null
        and risk.deleted_at is null
    ),
    'active_risk_actions_assigned', (
      select count(*)::integer
      from public.project_risks risk
      where risk.organisation_id = p_organisation_id
        and risk.actioner_id = p_profile_id
        and risk.status in ('open', 'monitoring', 'mitigating')
        and risk.archived_at is null
        and risk.deleted_at is null
    ),
    'outstanding_actions_assigned', (
      select count(*)::integer
      from public.project_actions action
      where action.organisation_id = p_organisation_id
        and action.actioner_id = p_profile_id
        and action.status not in ('complete', 'cancelled')
    ),
    'actions_awaiting_approval', (
      select count(*)::integer
      from public.project_actions action
      where action.organisation_id = p_organisation_id
        and action.acceptance_owner_id = p_profile_id
        and action.status = 'submitted'
    ),
    'project_roles_available', false,
    'project_roles_unavailable_reason', 'Project-role responsibility counts are not presented as reliable while WT-PROJECT-TEAM-DEFECT-001 remains open.',
    'responsibilities_are_informational', true,
    'reassignment_is_automatic', false
  );
$$;

create or replace function public.workspace_member_deactivation_impact_summary_api(
  p_organisation_id uuid,
  p_membership_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_target public.organisation_members;
  v_counts jsonb;
  v_can_deactivate boolean;
begin
  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);

  select *
    into v_target
  from public.organisation_members om
  where om.id = p_membership_id
    and om.organisation_id = p_organisation_id;

  if not found or v_target.status <> 'active' then
    raise exception 'WT_MEMBER_DEACTIVATION_ACTIVE_ONLY: Only active memberships can be reviewed for individual deactivation.' using errcode = '23514';
  end if;

  v_can_deactivate := public.workspace_member_deactivation_can_deactivate(v_actor.actor_role, v_actor.actor_user_id, v_target);
  v_counts := public.workspace_member_deactivation_impact_counts(p_organisation_id, v_target.user_id);

  return v_counts || jsonb_build_object(
    'can_deactivate', v_can_deactivate,
    'authority_message', public.workspace_member_deactivation_authority_message(v_actor.actor_role, v_actor.actor_user_id, v_target),
    'membership_id', v_target.id,
    'current_role', v_target.role,
    'membership_status', v_target.status,
    'impact_loaded_at', now()
  );
end;
$$;

create or replace function public.deactivate_workspace_member_from_modal_api(
  p_organisation_id uuid,
  p_membership_id uuid,
  p_expected_snapshot_version text,
  p_edit_session_id uuid,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_target public.organisation_members;
  v_updated public.organisation_members;
  v_session public.workspace_member_edit_sessions;
  v_reason text;
  v_current_snapshot text;
  v_impact_counts jsonb;
  v_correlation_id uuid := gen_random_uuid();
begin
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);
  perform pg_advisory_xact_lock(hashtextextended(p_membership_id::text, 9009));
  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'WT_MEMBER_DEACTIVATION_REASON_REQUIRED: Deactivation reason is required.' using errcode = '23514';
  end if;
  if length(v_reason) > 500 then
    raise exception 'WT_MEMBER_DEACTIVATION_REASON_TOO_LONG: Deactivation reason must be 500 characters or fewer.' using errcode = '22001';
  end if;

  select *
    into v_target
  from public.organisation_members om
  where om.id = p_membership_id
    and om.organisation_id = p_organisation_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_NOT_FOUND: Membership not found.' using errcode = '42501';
  end if;
  if v_target.status <> 'active' then
    raise exception 'WT_MEMBER_DEACTIVATION_ACTIVE_ONLY: Only active memberships can be deactivated through this modal.' using errcode = '23514';
  end if;
  if v_target.auth_user_id = v_actor.actor_user_id
     or (v_target.auth_user_id is null and v_target.user_id = v_actor.actor_user_id) then
    raise exception 'WT_MEMBER_DEACTIVATION_SELF_DENIED: Users cannot deactivate their own workspace membership through this modal.' using errcode = '42501';
  end if;
  if v_actor.actor_role = 'admin' and v_target.role in ('admin', 'owner') then
    raise exception 'WT_MEMBER_DEACTIVATION_ADMIN_TARGET_DENIED: Admins can deactivate only Viewer and Member memberships.' using errcode = '42501';
  end if;
  if not public.workspace_member_deactivation_can_deactivate(v_actor.actor_role, v_actor.actor_user_id, v_target) then
    raise exception 'WT_MEMBERSHIP_PERMISSION_DENIED: This actor cannot deactivate the selected membership.' using errcode = '42501';
  end if;

  perform public.workspace_membership_assert_not_final_owner(v_target);
  perform public.expire_workspace_member_edit_sessions(p_organisation_id, p_membership_id);

  select *
    into v_session
  from public.workspace_member_edit_sessions session
  where session.organisation_id = p_organisation_id
    and session.organisation_membership_id = p_membership_id
    and session.status = 'active'
    and session.released_at is null
    and session.expires_at > now()
  order by session.started_at asc
  limit 1
  for update;

  if v_session.id is null
     or p_edit_session_id is null
     or v_session.id <> p_edit_session_id
     or v_session.editing_by <> v_actor.actor_user_id then
    if v_session.id is not null and v_session.editing_by <> v_actor.actor_user_id then
      raise exception 'WT_MEMBER_DEACTIVATION_LOCKED: Member is currently being edited by another Workspace administrator.' using errcode = '55P03';
    end if;
    raise exception 'WT_MEMBER_DEACTIVATION_SESSION: Active member edit session is required.' using errcode = '42501';
  end if;

  v_current_snapshot := public.current_workspace_membership_snapshot_version(p_organisation_id)::text;
  if nullif(btrim(p_expected_snapshot_version), '') is null
     or v_current_snapshot <> btrim(p_expected_snapshot_version) then
    raise exception 'WT_MEMBER_DEACTIVATION_STALE: Membership data changed after the modal opened.' using errcode = '40001';
  end if;

  v_impact_counts := public.workspace_member_deactivation_impact_counts(p_organisation_id, v_target.user_id);

  update public.organisation_members om
     set status = 'deactivated',
         deactivated_at = now(),
         deactivated_by = v_actor.actor_user_id,
         deactivation_reason = v_reason,
         updated_by = v_actor.actor_user_id
   where om.id = v_target.id
     and om.organisation_id = p_organisation_id
   returning * into v_updated;

  perform public.record_workspace_membership_audit_event(
    p_organisation_id,
    v_updated.id,
    coalesce(v_updated.auth_user_id, v_updated.user_id),
    v_actor.actor_user_id,
    'membership_deactivated',
    v_target.status,
    v_updated.status,
    public.workspace_membership_json(v_target) || jsonb_build_object(
      'previous_role', v_target.role,
      'profile_id', v_target.user_id
    ),
    public.workspace_membership_json(v_updated) || jsonb_build_object(
      'previous_role', v_target.role,
      'deactivation_reason', v_reason,
      'deactivated_by', v_actor.actor_user_id,
      'deactivated_at', v_updated.deactivated_at,
      'profile_id', v_updated.user_id,
      'responsibility_counts', v_impact_counts
    ),
    v_reason,
    'workspace_member_modal_deactivation',
    v_correlation_id
  );

  update public.workspace_member_edit_sessions session
     set status = 'released',
         released_at = now(),
         released_by = v_actor.actor_user_id,
         release_source = 'save_deactivation_completed'
   where session.id = v_session.id;

  return v_updated.id;
end;
$$;

revoke all on function public.workspace_member_deactivation_authority_message(text, uuid, public.organisation_members) from public;
revoke all on function public.workspace_member_deactivation_can_deactivate(text, uuid, public.organisation_members) from public;
revoke all on function public.workspace_member_deactivation_impact_counts(uuid, uuid) from public;
revoke all on function public.workspace_member_deactivation_impact_summary_api(uuid, uuid) from public;
revoke all on function public.deactivate_workspace_member_from_modal_api(uuid, uuid, text, uuid, text) from public;

grant execute on function public.workspace_member_deactivation_authority_message(text, uuid, public.organisation_members) to service_role;
grant execute on function public.workspace_member_deactivation_can_deactivate(text, uuid, public.organisation_members) to service_role;
grant execute on function public.workspace_member_deactivation_impact_counts(uuid, uuid) to service_role;
grant execute on function public.workspace_member_deactivation_impact_summary_api(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.deactivate_workspace_member_from_modal_api(uuid, uuid, text, uuid, text) to anon, authenticated, service_role;

comment on function public.workspace_member_deactivation_impact_summary_api(uuid, uuid) is
  'Returns a workspace-scoped high-level responsibility summary for the individual member deactivation modal. Project-role counts are marked unavailable while WT-PROJECT-TEAM-DEFECT-001 remains open.';
comment on function public.deactivate_workspace_member_from_modal_api(uuid, uuid, text, uuid, text) is
  'Atomically deactivates an eligible active workspace member from the individual member modal with Owner/Admin authority, advisory session ownership, optimistic concurrency, mandatory reason and audit evidence.';

notify pgrst, 'reload schema';
