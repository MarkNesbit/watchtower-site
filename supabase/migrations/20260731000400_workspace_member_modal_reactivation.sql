-- WT-WORKSPACE-TEAM-009C individual member reactivation with explicit role decision.
--
-- Reactivation restores only the workspace membership. It reuses the existing
-- profile/Auth identity, keeps deactivation evidence intact and does not
-- automatically restore risks, actions, project roles or other responsibilities.

create or replace view public.workspace_member_admin_directory
as
select
  om.organisation_id,
  om.id as organisation_membership_id,
  p.id as profile_id,
  p.display_name,
  p.first_name,
  p.last_name,
  p.login_name,
  p.contact_email,
  p.email as auth_email,
  om.role,
  om.status as membership_status,
  om.invited_at,
  om.accepted_at,
  om.suspended_at,
  om.deactivated_at,
  om.reactivated_at,
  invitation.id as invitation_id,
  invitation.status as invitation_status,
  invitation.delivered_at as invitation_delivered_at,
  invitation.opened_at as invitation_opened_at,
  invitation.accepted_at as invitation_accepted_at,
  invitation.cancelled_at as invitation_cancelled_at,
  invitation.superseded_at as invitation_superseded_at,
  invitation.delivery_attempt_count as invitation_delivery_attempt_count,
  invitation.last_delivery_attempt_at as invitation_last_delivery_attempt_at,
  invitation.expires_at as invitation_expires_at,
  invitation.failure_code as invitation_failure_code,
  invitation.failure_message as invitation_failure_message,
  invitation.delivery_strategy as invitation_delivery_strategy,
  om.joined_at,
  om.auth_user_id,
  p.last_login_at,
  om.updated_at,
  om.deactivated_by,
  public.workspace_member_editor_display_name(om.deactivated_by) as deactivated_by_display_name,
  om.deactivation_reason,
  om.reactivated_by,
  om.reactivation_reason
from public.organisation_members om
join public.profiles p on p.id = om.user_id
left join public.workspace_membership_invitations invitation
  on invitation.membership_id = om.id
  and invitation.organisation_id = om.organisation_id
  and invitation.is_current = true
where public.has_real_active_organisation_role(om.organisation_id, array['owner', 'admin']);

create or replace function public.workspace_member_reactivation_authority_message(
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
    when actor_role not in ('owner', 'admin') then 'Only active Workspace Owners and Admins can reactivate workspace members.'
    when target_membership.auth_user_id = actor_user_id
      or (target_membership.auth_user_id is null and target_membership.user_id = actor_user_id)
      then 'Users cannot reactivate their own workspace membership through this modal.'
    when target_membership.status <> 'deactivated' then 'Only deactivated memberships can be reactivated through this modal.'
    when target_membership.role not in ('viewer', 'member', 'admin', 'owner') then 'The previous workspace role could not be confirmed.'
    when actor_role = 'owner' then 'Owners can reactivate a deactivated member as Viewer, Member, Admin or Owner.'
    when actor_role = 'admin' and target_membership.role in ('viewer', 'member') then 'Admins can reactivate former Viewers and Members as Viewer or Member.'
    when actor_role = 'admin' and target_membership.role = 'admin' then 'Only a Workspace Owner may reactivate a former Admin.'
    when actor_role = 'admin' and target_membership.role = 'owner' then 'Admins cannot reactivate a former Owner.'
    else 'This member cannot be reactivated through this modal.'
  end;
$$;

create or replace function public.workspace_member_reactivation_can_reactivate(
  actor_role text,
  actor_user_id uuid,
  target_membership public.organisation_members,
  target_role text,
  deactivated_in_error boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_membership.status = 'deactivated'
    and actor_role in ('owner', 'admin')
    and target_membership.role in ('viewer', 'member', 'admin', 'owner')
    and not (
      target_membership.auth_user_id = actor_user_id
      or (target_membership.auth_user_id is null and target_membership.user_id = actor_user_id)
    )
    and (
      (deactivated_in_error and (
        actor_role = 'owner'
        or (actor_role = 'admin' and target_membership.role in ('viewer', 'member'))
      ))
      or (
        not deactivated_in_error
        and target_role in ('viewer', 'member', 'admin', 'owner')
        and (
          actor_role = 'owner'
          or (actor_role = 'admin' and target_membership.role in ('viewer', 'member') and target_role in ('viewer', 'member'))
        )
      )
    );
$$;

create or replace function public.start_workspace_member_edit_session(
  p_organisation_id uuid,
  p_membership_id uuid
)
returns table(
  can_edit boolean,
  session_id uuid,
  expires_at timestamptz,
  locked_by_display_name text,
  message text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_target public.organisation_members;
  v_existing public.workspace_member_edit_sessions;
  v_new public.workspace_member_edit_sessions;
  v_can_edit boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_membership_id::text, 9009));
  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);

  select *
    into v_target
  from public.organisation_members om
  where om.id = p_membership_id
    and om.organisation_id = p_organisation_id
  for update;

  if not found or v_target.status not in ('active', 'deactivated') then
    raise exception 'WT_MEMBER_MODAL_OPEN_ACTIVE_OR_DEACTIVATED: Only active or deactivated memberships can be opened for individual administration.' using errcode = '23514';
  end if;

  v_can_edit := case
    when v_target.status = 'active' then public.workspace_member_role_can_edit(v_actor.actor_role, v_actor.actor_user_id, v_target)
    else public.workspace_member_reactivation_can_reactivate(v_actor.actor_role, v_actor.actor_user_id, v_target, null, true)
  end;
  if not v_can_edit then
    can_edit := false;
    session_id := null;
    expires_at := null;
    locked_by_display_name := null;
    message := case
      when v_target.status = 'active' then public.workspace_member_role_authority_message(v_actor.actor_role, v_actor.actor_user_id, v_target)
      else public.workspace_member_reactivation_authority_message(v_actor.actor_role, v_actor.actor_user_id, v_target)
    end;
    return next;
    return;
  end if;

  perform public.expire_workspace_member_edit_sessions(p_organisation_id, p_membership_id);

  select *
    into v_existing
  from public.workspace_member_edit_sessions session
  where session.organisation_id = p_organisation_id
    and session.organisation_membership_id = p_membership_id
    and session.status = 'active'
    and session.released_at is null
    and session.expires_at > now()
  order by session.started_at asc
  limit 1
  for update;

  if v_existing.id is not null and v_existing.editing_by <> v_actor.actor_user_id then
    can_edit := false;
    session_id := null;
    expires_at := v_existing.expires_at;
    locked_by_display_name := public.workspace_member_editor_display_name(v_existing.editing_by);
    message := 'This member is currently being viewed by ' || coalesce(locked_by_display_name, 'another Workspace administrator') || ' and cannot be edited.';
    return next;
    return;
  end if;

  if v_existing.id is not null then
    update public.workspace_member_edit_sessions session
       set expires_at = greatest(session.expires_at, now() + interval '15 minutes')
     where session.id = v_existing.id
     returning * into v_new;
  else
    insert into public.workspace_member_edit_sessions (
      organisation_id,
      organisation_membership_id,
      editing_by,
      status,
      started_at,
      expires_at
    )
    values (
      p_organisation_id,
      p_membership_id,
      v_actor.actor_user_id,
      'active',
      now(),
      now() + interval '15 minutes'
    )
    returning * into v_new;
  end if;

  can_edit := true;
  session_id := v_new.id;
  expires_at := v_new.expires_at;
  locked_by_display_name := null;
  message := case
    when v_target.status = 'deactivated' then 'You can reactivate this workspace member.'
    else 'You can edit this member role.'
  end;
  return next;
end;
$$;

create or replace function public.reactivate_workspace_member_from_modal(
  p_organisation_id uuid,
  p_membership_id uuid,
  p_target_role text,
  p_deactivated_in_error boolean,
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
  v_target_role text;
  v_deactivated_in_error boolean := coalesce(p_deactivated_in_error, false);
  v_current_snapshot text;
  v_correlation_id uuid := gen_random_uuid();
begin
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);
  perform pg_advisory_xact_lock(hashtextextended(p_membership_id::text, 9009));
  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'WT_MEMBER_REACTIVATION_REASON_REQUIRED: Reactivation reason is required.' using errcode = '23514';
  end if;
  if length(v_reason) > 500 then
    raise exception 'WT_MEMBER_REACTIVATION_REASON_TOO_LONG: Reactivation reason must be 500 characters or fewer.' using errcode = '22001';
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
  if v_target.status <> 'deactivated' then
    raise exception 'WT_MEMBER_REACTIVATION_DEACTIVATED_ONLY: Only deactivated memberships can be reactivated through this modal.' using errcode = '23514';
  end if;
  if v_target.accepted_at is null and v_target.joined_at is null then
    raise exception 'WT_MEMBER_REACTIVATION_ACCEPTED_ONLY: Only previously accepted memberships can be reactivated through this modal.' using errcode = '23514';
  end if;
  if v_target.auth_user_id is null
     or not exists (select 1 from auth.users auth_user where auth_user.id = v_target.auth_user_id) then
    raise exception 'WT_MEMBER_REACTIVATION_AUTH_IDENTITY_MISSING: Existing Auth identity is required for workspace reactivation.' using errcode = '23503';
  end if;
  if v_target.auth_user_id = v_actor.actor_user_id
     or (v_target.auth_user_id is null and v_target.user_id = v_actor.actor_user_id) then
    raise exception 'WT_MEMBER_REACTIVATION_SELF_DENIED: Users cannot reactivate their own workspace membership through this modal.' using errcode = '42501';
  end if;
  if v_target.role not in ('viewer', 'member', 'admin', 'owner') then
    raise exception 'WT_MEMBER_REACTIVATION_PREVIOUS_ROLE_UNAVAILABLE: Previous role is not reliable for reactivation.' using errcode = '23514';
  end if;

  v_target_role := case
    when v_deactivated_in_error then v_target.role
    else lower(btrim(coalesce(p_target_role, '')))
  end;
  if v_target_role not in ('viewer', 'member', 'admin', 'owner') then
    raise exception 'WT_MEMBER_REACTIVATION_INVALID_TARGET: Requested workspace role is not valid.' using errcode = '23514';
  end if;
  if v_actor.actor_role = 'admin' and v_target.role in ('admin', 'owner') then
    raise exception 'WT_MEMBER_REACTIVATION_ADMIN_TARGET_DENIED: Admins can reactivate only former Viewer and Member memberships.' using errcode = '42501';
  end if;
  if v_actor.actor_role = 'admin' and v_target_role in ('admin', 'owner') then
    raise exception 'WT_MEMBER_REACTIVATION_ADMIN_ASSIGN_DENIED: Admins cannot assign Admin or Owner roles.' using errcode = '42501';
  end if;
  if not public.workspace_member_reactivation_can_reactivate(v_actor.actor_role, v_actor.actor_user_id, v_target, v_target_role, v_deactivated_in_error) then
    raise exception 'WT_MEMBERSHIP_PERMISSION_DENIED: This actor cannot reactivate the selected membership.' using errcode = '42501';
  end if;

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
      raise exception 'WT_MEMBER_REACTIVATION_LOCKED: Member is currently being edited by another Workspace administrator.' using errcode = '55P03';
    end if;
    raise exception 'WT_MEMBER_REACTIVATION_SESSION: Active member edit session is required.' using errcode = '42501';
  end if;

  v_current_snapshot := public.current_workspace_membership_snapshot_version(p_organisation_id)::text;
  if nullif(btrim(p_expected_snapshot_version), '') is null
     or v_current_snapshot <> btrim(p_expected_snapshot_version) then
    raise exception 'WT_MEMBER_REACTIVATION_STALE: Membership data changed after the modal opened.' using errcode = '40001';
  end if;

  update public.organisation_members om
     set status = 'active',
         role = v_target_role,
         reactivated_at = now(),
         reactivated_by = v_actor.actor_user_id,
         reactivation_reason = v_reason,
         updated_by = v_actor.actor_user_id
   where om.id = v_target.id
     and om.organisation_id = p_organisation_id
   returning * into v_updated;

  perform public.record_workspace_membership_audit_event(
    p_organisation_id,
    v_updated.id,
    v_updated.auth_user_id,
    v_actor.actor_user_id,
    'membership_reactivated',
    v_target.status,
    v_updated.status,
    public.workspace_membership_json(v_target) || jsonb_build_object(
      'previous_role', v_target.role,
      'profile_id', v_target.user_id,
      'target_auth_user_id', v_target.auth_user_id,
      'deactivated_at', v_target.deactivated_at,
      'deactivated_by', v_target.deactivated_by,
      'deactivation_reason', v_target.deactivation_reason
    ),
    public.workspace_membership_json(v_updated) || jsonb_build_object(
      'previous_role', v_target.role,
      'new_role', v_updated.role,
      'deactivated_in_error', v_deactivated_in_error,
      'reactivation_reason', v_reason,
      'reactivated_by', v_actor.actor_user_id,
      'reactivated_at', v_updated.reactivated_at,
      'profile_id', v_updated.user_id,
      'target_auth_user_id', v_updated.auth_user_id,
      'responsibilities_restored_automatically', false,
      'project_roles_restored_automatically', false
    ),
    v_reason,
    case
      when v_deactivated_in_error then 'workspace_member_modal_reactivation_correction'
      else 'workspace_member_modal_reactivation'
    end,
    v_correlation_id
  );

  update public.workspace_member_edit_sessions session
     set status = 'released',
         released_at = now(),
         released_by = v_actor.actor_user_id,
         release_source = 'save_reactivation_completed'
   where session.id = v_session.id;

  return v_updated.id;
end;
$$;

create or replace function public.reactivate_workspace_member_from_modal_api(
  p_organisation_id uuid,
  p_membership_id uuid,
  p_expected_snapshot_version text,
  p_edit_session_id uuid,
  p_target_role text,
  p_deactivated_in_error boolean,
  p_reason text
)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  select public.reactivate_workspace_member_from_modal(
    p_organisation_id,
    p_membership_id,
    p_target_role,
    coalesce(p_deactivated_in_error, false),
    p_expected_snapshot_version,
    p_edit_session_id,
    p_reason
  );
$$;

revoke all on function public.workspace_member_reactivation_authority_message(text, uuid, public.organisation_members) from public;
revoke all on function public.workspace_member_reactivation_can_reactivate(text, uuid, public.organisation_members, text, boolean) from public;
revoke all on function public.start_workspace_member_edit_session(uuid, uuid) from public;
revoke all on function public.reactivate_workspace_member_from_modal(uuid, uuid, text, boolean, text, uuid, text) from public;
revoke all on function public.reactivate_workspace_member_from_modal_api(uuid, uuid, text, uuid, text, boolean, text) from public;

grant execute on function public.start_workspace_member_edit_session(uuid, uuid) to authenticated, service_role;
grant execute on function public.workspace_member_reactivation_authority_message(text, uuid, public.organisation_members) to service_role;
grant execute on function public.workspace_member_reactivation_can_reactivate(text, uuid, public.organisation_members, text, boolean) to service_role;
grant execute on function public.reactivate_workspace_member_from_modal(uuid, uuid, text, boolean, text, uuid, text) to authenticated, service_role;
grant execute on function public.reactivate_workspace_member_from_modal_api(uuid, uuid, text, uuid, text, boolean, text) to anon, authenticated, service_role;

comment on function public.reactivate_workspace_member_from_modal(uuid, uuid, text, boolean, text, uuid, text) is
  'Atomically reactivates an eligible deactivated workspace member from the individual member modal. Requires a deliberate role decision or an authorised Deactivated in error restoration, mandatory audit reason, advisory session ownership and optimistic snapshot concurrency.';
comment on function public.reactivate_workspace_member_from_modal_api(uuid, uuid, text, uuid, text, boolean, text) is
  'REST-visible wrapper for individual workspace member reactivation. Delegates to the secure modal reactivation transaction.';

notify pgrst, 'reload schema';
