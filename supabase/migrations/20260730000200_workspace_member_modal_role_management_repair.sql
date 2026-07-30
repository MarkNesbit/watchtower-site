-- WT-WORKSPACE-TEAM-009A production repair.
--
-- The original 20260730000100 migration may already be recorded as applied in
-- hosted environments. Re-apply the corrected member-modal view shape and
-- advisory edit-session RPC with a new migration version so db push has real
-- work to do.

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
  om.updated_at
from public.organisation_members om
join public.profiles p on p.id = om.user_id
left join public.workspace_membership_invitations invitation
  on invitation.membership_id = om.id
  and invitation.organisation_id = om.organisation_id
  and invitation.is_current = true
where public.has_real_active_organisation_role(om.organisation_id, array['owner', 'admin']);

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
  v_existing_id uuid;
  v_existing_editing_by uuid;
  v_existing_expires_at timestamptz;
  v_new_id uuid;
  v_new_expires_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_membership_id::text, 9009));
  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);

  select *
    into v_target
  from public.organisation_members om
  where om.id = p_membership_id
    and om.organisation_id = p_organisation_id
  for update;

  if not found or v_target.status <> 'active' then
    raise exception 'WT_MEMBER_ROLE_ACTIVE_ONLY: Only active memberships can be opened for role management.' using errcode = '23514';
  end if;

  if not public.workspace_member_role_can_edit(v_actor.actor_role, v_actor.actor_user_id, v_target) then
    can_edit := false;
    session_id := null;
    expires_at := null;
    locked_by_display_name := null;
    message := public.workspace_member_role_authority_message(v_actor.actor_role, v_actor.actor_user_id, v_target);
    return next;
    return;
  end if;

  perform public.expire_workspace_member_edit_sessions(p_organisation_id, p_membership_id);

  select session.id,
         session.editing_by,
         session.expires_at
    into v_existing_id,
         v_existing_editing_by,
         v_existing_expires_at
  from public.workspace_member_edit_sessions session
  where session.organisation_id = p_organisation_id
    and session.organisation_membership_id = p_membership_id
    and session.status = 'active'
    and session.released_at is null
    and session.expires_at > now()
  order by session.started_at asc
  limit 1
  for update;

  if v_existing_id is not null and v_existing_editing_by <> v_actor.actor_user_id then
    can_edit := false;
    session_id := null;
    expires_at := v_existing_expires_at;
    locked_by_display_name := public.workspace_member_editor_display_name(v_existing_editing_by);
    message := 'This member is currently being viewed by ' || coalesce(locked_by_display_name, 'another Workspace administrator') || ' and cannot be edited.';
    return next;
    return;
  end if;

  if v_existing_id is not null then
    update public.workspace_member_edit_sessions session
       set expires_at = greatest(session.expires_at, now() + interval '15 minutes')
     where session.id = v_existing_id
     returning session.id, session.expires_at into v_new_id, v_new_expires_at;
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
    returning workspace_member_edit_sessions.id, workspace_member_edit_sessions.expires_at into v_new_id, v_new_expires_at;
  end if;

  can_edit := true;
  session_id := v_new_id;
  expires_at := v_new_expires_at;
  locked_by_display_name := null;
  message := 'You can edit this member role.';
  return next;
end;
$$;

grant execute on function public.start_workspace_member_edit_session(uuid, uuid) to authenticated, service_role;

comment on function public.start_workspace_member_edit_session(uuid, uuid) is
  'Starts or reports the advisory edit session for an active workspace member role modal, enforcing real Owner/Admin role authority. Repaired in 20260730000200 with scalar session state to avoid stale applied function definitions.';

notify pgrst, 'reload schema';
