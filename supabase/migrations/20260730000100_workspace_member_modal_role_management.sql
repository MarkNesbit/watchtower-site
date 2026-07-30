-- WT-WORKSPACE-TEAM-009A active-member modal role management and advisory edit sessions.

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
      'membership_change_set_drift_detected',
      'workspace_invitation_prepared',
      'workspace_invitation_delivery_attempted',
      'workspace_invitation_delivered',
      'workspace_invitation_delivery_failed',
      'workspace_invitation_opened',
      'workspace_invitation_expired',
      'workspace_invitation_cancelled',
      'workspace_invitation_superseded',
      'workspace_invitation_accepted',
      'workspace_membership_activated',
      'workspace_invitation_replay_rejected',
      'workspace_membership_role_changed'
    ));

create or replace function public.workspace_membership_require_admin_actor(target_organisation_id uuid)
returns table(actor_user_id uuid, actor_role text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  actor_user_id := auth.uid();
  if actor_user_id is null then
    raise exception 'WT_MEMBERSHIP_PERMISSION_DENIED: Authenticated user is required.' using errcode = '42501';
  end if;

  select om.role
    into actor_role
  from public.organisation_members om
  where om.organisation_id = target_organisation_id
    and (
      om.auth_user_id = actor_user_id
      or (om.auth_user_id is null and om.user_id = actor_user_id)
    )
    and om.status = 'active'
  order by om.created_at asc
  limit 1;

  if actor_role not in ('owner', 'admin') then
    raise exception 'WT_MEMBERSHIP_PERMISSION_DENIED: Only active Owners and Admins can manage workspace membership.' using errcode = '42501';
  end if;

  return next;
end;
$$;

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
  om.invitation_expires_at
from public.organisation_members om
join public.profiles p on p.id = om.user_id
left join public.workspace_membership_invitations invitation
  on invitation.membership_id = om.id
  and invitation.organisation_id = om.organisation_id
  and invitation.is_current = true
where public.has_real_active_organisation_role(om.organisation_id, array['owner', 'admin']);

create table if not exists public.workspace_member_edit_sessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  organisation_membership_id uuid not null references public.organisation_members(id) on delete cascade,
  editing_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  release_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_member_edit_sessions_status_check
    check (status in ('active', 'released', 'expired')),
  constraint workspace_member_edit_sessions_expiry_check
    check (expires_at > started_at),
  constraint workspace_member_edit_sessions_release_check
    check ((status = 'active' and released_at is null) or (status <> 'active' and released_at is not null)),
  constraint workspace_member_edit_sessions_release_source_not_empty
    check (release_source is null or length(btrim(release_source)) > 0)
);

create index if not exists workspace_member_edit_sessions_membership_idx
  on public.workspace_member_edit_sessions (organisation_id, organisation_membership_id, status, expires_at desc);
create index if not exists workspace_member_edit_sessions_actor_idx
  on public.workspace_member_edit_sessions (editing_by, status, expires_at desc);
create unique index if not exists workspace_member_edit_sessions_active_membership_key
  on public.workspace_member_edit_sessions (organisation_id, organisation_membership_id)
  where status = 'active' and released_at is null;

drop trigger if exists set_workspace_member_edit_sessions_updated_at on public.workspace_member_edit_sessions;
create trigger set_workspace_member_edit_sessions_updated_at
  before update on public.workspace_member_edit_sessions
  for each row execute function public.set_updated_at();

alter table public.workspace_member_edit_sessions enable row level security;

drop policy if exists workspace_member_edit_sessions_select on public.workspace_member_edit_sessions;
create policy workspace_member_edit_sessions_select
  on public.workspace_member_edit_sessions for select
  to authenticated
  using (public.has_real_active_organisation_role(workspace_member_edit_sessions.organisation_id, array['owner', 'admin']));

revoke insert, update, delete on public.workspace_member_edit_sessions from authenticated;
grant select on public.workspace_member_edit_sessions to authenticated;
grant all privileges on public.workspace_member_edit_sessions to service_role;

create or replace function public.workspace_member_editor_display_name(target_auth_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    nullif(btrim(p.display_name), ''),
    nullif(btrim(p.login_name), ''),
    'another Workspace administrator'
  )
  from public.profiles p
  where p.auth_user_id = target_auth_user_id
     or (p.auth_user_id is null and p.id = target_auth_user_id)
  order by p.created_at asc
  limit 1;
$$;

create or replace function public.workspace_member_role_authority_message(
  actor_role text,
  actor_user_id uuid,
  target_membership public.organisation_members
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if target_membership.auth_user_id = actor_user_id
     or (target_membership.auth_user_id is null and target_membership.user_id = actor_user_id) then
    return 'Users cannot change their own workspace role through this modal.';
  end if;
  if actor_role = 'owner' then
    return 'Owners can assign Viewer, Member, Admin or Owner to another active member.';
  end if;
  if actor_role = 'admin' and target_membership.role = 'admin' then
    return 'Only a Workspace Owner may change an Admin role.';
  end if;
  if actor_role = 'admin' and target_membership.role = 'owner' then
    return 'Admins cannot change an Owner role.';
  end if;
  if actor_role = 'admin' and target_membership.role in ('viewer', 'member') then
    return 'Admins can move Viewers and Members between Viewer and Member.';
  end if;
  return 'Only active Workspace Owners and Admins can change workspace roles.';
end;
$$;

create or replace function public.workspace_member_role_can_edit(
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
    and not (
      target_membership.auth_user_id = actor_user_id
      or (target_membership.auth_user_id is null and target_membership.user_id = actor_user_id)
    )
    and (
      actor_role = 'owner'
      or (actor_role = 'admin' and target_membership.role in ('viewer', 'member'))
    );
$$;

create or replace function public.expire_workspace_member_edit_sessions(
  p_organisation_id uuid,
  p_membership_id uuid default null
)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.workspace_member_edit_sessions session
     set status = 'expired',
         released_at = now(),
         release_source = 'expiry'
   where session.organisation_id = p_organisation_id
     and (p_membership_id is null or session.organisation_membership_id = p_membership_id)
     and session.status = 'active'
     and session.released_at is null
     and session.expires_at <= now();
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

  if not found or v_target.status <> 'active' then
    raise exception 'WT_MEMBER_ROLE_ACTIVE_ONLY: Only active memberships can be opened for role management.' using errcode = '23514';
  end if;

  v_can_edit := public.workspace_member_role_can_edit(v_actor.actor_role, v_actor.actor_user_id, v_target);
  if not v_can_edit then
    can_edit := false;
    session_id := null;
    expires_at := null;
    locked_by_display_name := null;
    message := public.workspace_member_role_authority_message(v_actor.actor_role, v_actor.actor_user_id, v_target);
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
  message := 'You can edit this member role.';
  return next;
end;
$$;

create or replace function public.release_workspace_member_edit_session(
  p_organisation_id uuid,
  p_session_id uuid,
  p_release_source text default 'modal_closed'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_session public.workspace_member_edit_sessions;
begin
  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);

  select *
    into v_session
  from public.workspace_member_edit_sessions session
  where session.id = p_session_id
    and session.organisation_id = p_organisation_id
  for update;

  if not found then
    return null;
  end if;

  if v_session.status = 'active'
     and v_session.released_at is null
     and v_session.editing_by = v_actor.actor_user_id then
    update public.workspace_member_edit_sessions session
       set status = 'released',
           released_at = now(),
           released_by = v_actor.actor_user_id,
           release_source = coalesce(nullif(btrim(p_release_source), ''), 'modal_closed')
     where session.id = v_session.id;
  end if;

  return v_session.id;
end;
$$;

create or replace function public.change_workspace_member_role(
  p_organisation_id uuid,
  p_membership_id uuid,
  p_target_role text,
  p_expected_snapshot_version text,
  p_edit_session_id uuid default null
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
  v_current_snapshot text;
  v_correlation_id uuid := gen_random_uuid();
begin
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);
  perform pg_advisory_xact_lock(hashtextextended(p_membership_id::text, 9009));
  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);

  if p_target_role not in ('viewer', 'member', 'admin', 'owner') then
    raise exception 'WT_MEMBER_ROLE_INVALID_TARGET: Requested workspace role is not valid.' using errcode = '23514';
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
    raise exception 'WT_MEMBER_ROLE_ACTIVE_ONLY: Only active memberships can be changed through this modal.' using errcode = '23514';
  end if;
  if v_target.auth_user_id = v_actor.actor_user_id
     or (v_target.auth_user_id is null and v_target.user_id = v_actor.actor_user_id) then
    raise exception 'WT_MEMBER_ROLE_SELF_DENIED: Users cannot change their own workspace role through this modal.' using errcode = '42501';
  end if;
  if v_actor.actor_role = 'admin' and v_target.role in ('admin', 'owner') then
    raise exception 'WT_MEMBER_ROLE_ADMIN_TARGET_DENIED: Admins can change only Viewer and Member roles.' using errcode = '42501';
  end if;
  if v_actor.actor_role = 'admin' and p_target_role in ('admin', 'owner') then
    raise exception 'WT_MEMBER_ROLE_ADMIN_ASSIGN_DENIED: Admins cannot assign Admin or Owner roles.' using errcode = '42501';
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
      raise exception 'WT_MEMBER_ROLE_LOCKED: Member is currently being edited by another Workspace administrator.' using errcode = '55P03';
    end if;
    raise exception 'WT_MEMBER_ROLE_SESSION: Active member edit session is required.' using errcode = '42501';
  end if;

  v_current_snapshot := public.current_workspace_membership_snapshot_version(p_organisation_id)::text;
  if nullif(btrim(p_expected_snapshot_version), '') is null
     or v_current_snapshot <> btrim(p_expected_snapshot_version) then
    raise exception 'WT_MEMBER_ROLE_STALE: Membership data changed after the modal opened.' using errcode = '40001';
  end if;

  if v_target.role = p_target_role then
    update public.workspace_member_edit_sessions session
       set status = 'released',
           released_at = now(),
           released_by = v_actor.actor_user_id,
           release_source = 'save_no_change'
     where session.id = v_session.id;
    return v_target.id;
  end if;

  update public.organisation_members om
     set role = p_target_role,
         updated_by = v_actor.actor_user_id
   where om.id = v_target.id
     and om.organisation_id = p_organisation_id
   returning * into v_updated;

  perform public.record_workspace_membership_audit_event(
    p_organisation_id,
    v_updated.id,
    coalesce(v_updated.auth_user_id, v_updated.user_id),
    v_actor.actor_user_id,
    'workspace_membership_role_changed',
    v_target.status,
    v_updated.status,
    public.workspace_membership_json(v_target) || jsonb_build_object(
      'previous_role', v_target.role,
      'profile_id', v_target.user_id
    ),
    public.workspace_membership_json(v_updated) || jsonb_build_object(
      'new_role', v_updated.role,
      'profile_id', v_updated.user_id,
      'changed_at', now(),
      'changed_by', v_actor.actor_user_id
    ),
    'Workspace role changed through individual member modal.',
    'workspace_member_modal_role_management',
    v_correlation_id
  );

  update public.workspace_member_edit_sessions session
     set status = 'released',
         released_at = now(),
         released_by = v_actor.actor_user_id,
         release_source = 'save_completed'
   where session.id = v_session.id;

  return v_updated.id;
end;
$$;

revoke all on function public.workspace_membership_require_admin_actor(uuid) from public;
revoke all on function public.workspace_member_editor_display_name(uuid) from public;
revoke all on function public.workspace_member_role_authority_message(text, uuid, public.organisation_members) from public;
revoke all on function public.workspace_member_role_can_edit(text, uuid, public.organisation_members) from public;
revoke all on function public.expire_workspace_member_edit_sessions(uuid, uuid) from public;
revoke all on function public.start_workspace_member_edit_session(uuid, uuid) from public;
revoke all on function public.release_workspace_member_edit_session(uuid, uuid, text) from public;
revoke all on function public.change_workspace_member_role(uuid, uuid, text, text, uuid) from public;

grant execute on function public.start_workspace_member_edit_session(uuid, uuid) to authenticated, service_role;
grant execute on function public.release_workspace_member_edit_session(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.change_workspace_member_role(uuid, uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.workspace_membership_require_admin_actor(uuid) to service_role;
grant execute on function public.workspace_member_editor_display_name(uuid) to service_role;
grant execute on function public.workspace_member_role_authority_message(text, uuid, public.organisation_members) to service_role;
grant execute on function public.workspace_member_role_can_edit(text, uuid, public.organisation_members) to service_role;
grant execute on function public.expire_workspace_member_edit_sessions(uuid, uuid) to service_role;

comment on table public.workspace_member_edit_sessions is
  'Advisory member-scoped edit sessions for the Workspace Team individual member role modal. Sessions expire and do not replace optimistic concurrency checks.';
comment on function public.start_workspace_member_edit_session(uuid, uuid) is
  'Starts or reports the advisory edit session for an active workspace member role modal, enforcing real Owner/Admin role authority.';
comment on function public.change_workspace_member_role(uuid, uuid, text, text, uuid) is
  'Workspace-scoped active-member role change RPC for the individual member modal. Enforces Owner/Admin authority, self-change denial, edit-session ownership, optimistic snapshot concurrency and audit evidence.';
