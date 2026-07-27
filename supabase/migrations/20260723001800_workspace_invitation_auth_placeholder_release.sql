-- WT-WORKSPACE-TEAM-008A-FIX-008 release deterministic invitation aliases.
-- Supabase Auth soft deletion keeps the old auth.users email reserved. For the
-- specific historical invitation placeholder rows created by WT-007, this
-- migration lets the server prove the placeholder is detached and safe to
-- hard-delete before the replacement Auth user is moved onto the deterministic
-- invitation alias.

alter table public.organisation_members
  drop constraint if exists organisation_members_user_id_fkey;

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.workspace_invitation_auth_identity_repairs
  drop constraint if exists workspace_invitation_auth_identity_repairs_old_auth_user_id_fkey;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.organisation_members'::regclass
      and conname = 'organisation_members_user_id_profile_fkey'
  ) then
    alter table public.organisation_members
      add constraint organisation_members_user_id_profile_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade
      not valid;
  end if;
end;
$$;

alter table public.organisation_members
  validate constraint organisation_members_user_id_profile_fkey;

comment on column public.profiles.id is
  'Immutable Watchtower profile/person UUID. Authentication is linked through profiles.auth_user_id; profiles.id is intentionally not an auth.users foreign key after invitation Auth repair support.';

comment on column public.organisation_members.user_id is
  'Immutable Watchtower profile/person UUID for the workspace membership. Authentication is linked through organisation_members.auth_user_id.';

comment on column public.workspace_invitation_auth_identity_repairs.old_auth_user_id is
  'Historical malformed Auth UUID being detached. This is retained as evidence even after the identity-less placeholder auth.users row is hard-deleted.';

create or replace function public.verify_workspace_invitation_auth_placeholder_release(
  p_invitation_id uuid,
  p_old_auth_user_id uuid,
  p_new_auth_user_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_invitation record;
  v_old_auth_user auth.users%rowtype;
  v_repair_exists boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_SERVICE_ROLE: Auth placeholder release is service-role only.'
      using errcode = '42501';
  end if;

  if p_invitation_id is null or p_old_auth_user_id is null or p_new_auth_user_id is null then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_INPUT: Invitation, old Auth user and new Auth user are required.'
      using errcode = '23502';
  end if;

  if p_old_auth_user_id = p_new_auth_user_id then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_SAME_USER: Placeholder and replacement Auth users must be distinct.'
      using errcode = '23514';
  end if;

  select
    invitation.id,
    invitation.organisation_id,
    invitation.membership_id,
    invitation.profile_id,
    invitation.auth_user_id,
    invitation.auth_email,
    invitation.status as invitation_status,
    profile.auth_user_id as profile_auth_user_id,
    om.auth_user_id as membership_auth_user_id,
    om.user_id as membership_profile_id,
    om.status as membership_status
  into v_invitation
  from public.workspace_membership_invitations invitation
  join public.profiles profile
    on profile.id = invitation.profile_id
  join public.organisation_members om
    on om.id = invitation.membership_id
    and om.organisation_id = invitation.organisation_id
    and om.user_id = invitation.profile_id
  where invitation.id = p_invitation_id
    and invitation.is_current;

  if not found then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_NOT_FOUND: Current invitation repair candidate was not found.'
      using errcode = '23503';
  end if;

  if v_invitation.profile_id is distinct from p_old_auth_user_id then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_CANDIDATE: Old Auth user is not the expected historical invitation placeholder.'
      using errcode = '23514';
  end if;

  if v_invitation.membership_status not in ('invited', 'invite_expired') then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_MEMBERSHIP_STATE: Membership is not awaiting invitation acceptance.'
      using errcode = '23514';
  end if;

  if v_invitation.auth_user_id is distinct from p_new_auth_user_id
     or v_invitation.profile_auth_user_id is distinct from p_new_auth_user_id
     or v_invitation.membership_auth_user_id is distinct from p_new_auth_user_id then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_REFERENCED: Watchtower Auth references have not been remapped to the replacement user.'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.profiles profile
    where profile.auth_user_id = p_old_auth_user_id
  ) or exists (
    select 1 from public.organisation_members om
    where om.auth_user_id = p_old_auth_user_id
  ) or exists (
    select 1 from public.workspace_membership_invitations invitation
    where invitation.is_current
      and invitation.auth_user_id = p_old_auth_user_id
  ) then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_REFERENCED: Old Auth user is still referenced by Watchtower Auth linkage.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.organisation_members om
    where om.status = 'active'
      and (om.auth_user_id = p_old_auth_user_id or om.user_id = p_old_auth_user_id)
  ) then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_ACTIVE: Old Auth user is linked to an active workspace membership.'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.project_people project_person
    where project_person.user_id = p_old_auth_user_id
  ) or exists (
    select 1 from public.internal_role_simulations simulation
    where simulation.user_id = p_old_auth_user_id
  ) or exists (
    select 1 from public.project_narrative_read_states read_state
    where read_state.user_id = p_old_auth_user_id
  ) then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_REFERENCED: Old Auth user is still referenced by non-invitation Watchtower state.'
      using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.workspace_invitation_auth_identity_repairs repair
    where repair.organisation_id = v_invitation.organisation_id
      and repair.invitation_id = v_invitation.id
      and repair.membership_id = v_invitation.membership_id
      and repair.profile_id = v_invitation.profile_id
      and repair.old_auth_user_id = p_old_auth_user_id
      and repair.new_auth_user_id = p_new_auth_user_id
      and repair.outcome in ('remapped_existing_user', 'remapped_created_user')
  ) into v_repair_exists;

  if not v_repair_exists then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_REPAIR: Matching repair evidence was not found.'
      using errcode = '23503';
  end if;

  select * into v_old_auth_user
  from auth.users au
  where au.id = p_old_auth_user_id;

  if not found then
    return;
  end if;

  if lower(coalesce(v_old_auth_user.email, '')) <> lower(v_invitation.auth_email) then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_EMAIL: Old Auth user does not hold the expected deterministic invitation alias.'
      using errcode = '23514';
  end if;

  if coalesce(v_old_auth_user.encrypted_password, '') <> '' then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_PASSWORD: Old Auth user has password credentials.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from auth.identities identity
    where identity.user_id = p_old_auth_user_id
  ) then
    raise exception 'WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_IDENTITY: Old Auth user has an Auth identity.'
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.verify_workspace_invitation_auth_placeholder_release(uuid, uuid, uuid) from public;
revoke all on function public.verify_workspace_invitation_auth_placeholder_release(uuid, uuid, uuid) from authenticated;
grant execute on function public.verify_workspace_invitation_auth_placeholder_release(uuid, uuid, uuid) to service_role;

comment on function public.verify_workspace_invitation_auth_placeholder_release(uuid, uuid, uuid) is
  'Service-role-only safety gate for hard-deleting a historical identity-less invitation placeholder Auth user after Watchtower Auth references have been remapped.';
