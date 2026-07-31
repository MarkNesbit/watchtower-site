-- WT-WORKSPACE-TEAM-009B-FIX-001: keep modal deactivation audit targets in the Auth UUID domain.
--
-- workspace_membership_audit_events.target_user_id references auth.users(id).
-- Active historical/demo memberships can be retained without an auth_user_id, so
-- individual deactivation must not fall back to the Watchtower profile UUID for
-- that column. The profile/person UUID remains recorded in audit JSON payloads.

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
    v_updated.auth_user_id,
    v_actor.actor_user_id,
    'membership_deactivated',
    v_target.status,
    v_updated.status,
    public.workspace_membership_json(v_target) || jsonb_build_object(
      'previous_role', v_target.role,
      'profile_id', v_target.user_id,
      'target_auth_user_id', v_target.auth_user_id
    ),
    public.workspace_membership_json(v_updated) || jsonb_build_object(
      'previous_role', v_target.role,
      'deactivation_reason', v_reason,
      'deactivated_by', v_actor.actor_user_id,
      'deactivated_at', v_updated.deactivated_at,
      'profile_id', v_updated.user_id,
      'target_auth_user_id', v_updated.auth_user_id,
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

revoke all on function public.deactivate_workspace_member_from_modal_api(uuid, uuid, text, uuid, text) from public;
grant execute on function public.deactivate_workspace_member_from_modal_api(uuid, uuid, text, uuid, text) to anon, authenticated, service_role;

comment on function public.deactivate_workspace_member_from_modal_api(uuid, uuid, text, uuid, text) is
  'Atomically deactivates an eligible active workspace member from the individual member modal. Audit target_user_id stays in the auth.users UUID domain; identity-less profile memberships are identified through JSON payload profile_id evidence.';

notify pgrst, 'reload schema';
