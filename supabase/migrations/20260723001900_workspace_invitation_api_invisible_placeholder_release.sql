-- WT-WORKSPACE-TEAM-008A-FIX-011 release API-invisible invitation Auth placeholders.
-- Supabase Auth Admin can return "User not found" while a malformed historical
-- auth.users row still occupies the deterministic invitation alias. This
-- forward migration adds a service-role-only, evidence-bound release function
-- that can remove only the verified identity-less placeholder row.

alter table public.workspace_invitation_auth_identity_repairs
  drop constraint if exists workspace_invitation_auth_identity_repairs_outcome_check,
  add constraint workspace_invitation_auth_identity_repairs_outcome_check
  check (outcome in (
    'detected',
    'attempted',
    'skipped_valid',
    'remapped_existing_user',
    'remapped_created_user',
    'failed',
    'placeholder_deleted',
    'placeholder_already_absent',
    'placeholder_release_blocked'
  ));

create or replace function public.release_workspace_invitation_auth_placeholder(
  p_invitation_id uuid,
  p_old_auth_user_id uuid,
  p_new_auth_user_id uuid,
  p_correlation_id uuid default gen_random_uuid()
)
returns table(result text, reason text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_repair public.workspace_invitation_auth_identity_repairs%rowtype;
  v_invitation public.workspace_membership_invitations%rowtype;
  v_profile public.profiles%rowtype;
  v_membership public.organisation_members%rowtype;
  v_old_auth_user auth.users%rowtype;
  v_result text := null;
  v_reason text := null;
  v_old_has_identity boolean := false;
  v_new_has_identity boolean := false;
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

  select repair.*
  into v_repair
  from public.workspace_invitation_auth_identity_repairs repair
  where repair.invitation_id = p_invitation_id
    and repair.old_auth_user_id = p_old_auth_user_id
    and repair.new_auth_user_id = p_new_auth_user_id
    and repair.outcome in ('remapped_existing_user', 'remapped_created_user')
  order by repair.created_at desc
  limit 1
  for update;

  if not found then
    return query select 'blocked'::text, 'repair_not_found'::text;
    return;
  end if;

  select invitation.*
  into v_invitation
  from public.workspace_membership_invitations invitation
  where invitation.id = v_repair.invitation_id
    and invitation.is_current
  for update;

  if not found then
    v_result := 'blocked';
    v_reason := 'invitation_not_found';
  end if;

  if v_result is null then
    select profile.*
    into v_profile
    from public.profiles profile
    where profile.id = v_invitation.profile_id
    for update;

    if not found then
      v_result := 'blocked';
      v_reason := 'profile_not_found';
    end if;
  end if;

  if v_result is null then
    select om.*
    into v_membership
    from public.organisation_members om
    where om.id = v_invitation.membership_id
      and om.organisation_id = v_invitation.organisation_id
    for update;

    if not found then
      v_result := 'blocked';
      v_reason := 'membership_not_found';
    end if;
  end if;

  if v_result is null and (
    v_repair.organisation_id is distinct from v_invitation.organisation_id
    or v_repair.membership_id is distinct from v_invitation.membership_id
    or v_repair.profile_id is distinct from v_invitation.profile_id
  ) then
    v_result := 'blocked';
    v_reason := 'repair_invitation_mismatch';
  end if;

  if v_result is null and (
    v_profile.auth_user_id is distinct from p_new_auth_user_id
    or v_membership.auth_user_id is distinct from p_new_auth_user_id
    or v_invitation.auth_user_id is distinct from p_new_auth_user_id
  ) then
    v_result := 'blocked';
    v_reason := 'replacement_not_current';
  end if;

  if v_result is null and v_membership.status not in ('invited', 'invite_expired') then
    v_result := 'blocked';
    v_reason := 'membership_not_invited';
  end if;

  if v_result is null and exists (
    select 1
    from public.organisation_members active_membership
    where active_membership.status = 'active'
      and (
        active_membership.auth_user_id = p_old_auth_user_id
        or active_membership.user_id = p_old_auth_user_id
      )
  ) then
    v_result := 'blocked';
    v_reason := 'active_membership';
  end if;

  if v_result is null and (
    exists (
      select 1 from public.profiles profile
      where profile.auth_user_id = p_old_auth_user_id
    )
    or exists (
      select 1 from public.organisation_members om
      where om.auth_user_id = p_old_auth_user_id
    )
    or exists (
      select 1 from public.workspace_membership_invitations invitation
      where invitation.is_current
        and invitation.auth_user_id = p_old_auth_user_id
    )
    or exists (
      select 1 from public.project_people project_person
      where project_person.user_id = p_old_auth_user_id
    )
    or exists (
      select 1 from public.internal_role_simulations simulation
      where simulation.user_id = p_old_auth_user_id
    )
    or exists (
      select 1 from public.project_narrative_read_states read_state
      where read_state.user_id = p_old_auth_user_id
    )
  ) then
    v_result := 'blocked';
    v_reason := 'old_auth_user_referenced';
  end if;

  if v_result is null then
    select au.*
    into v_old_auth_user
    from auth.users au
    where au.id = p_old_auth_user_id
    for update;

    if not found then
      v_result := 'already_absent';
      v_reason := 'old_auth_user_absent';
    end if;
  end if;

  if v_result is null and lower(coalesce(v_old_auth_user.email, '')) <> lower(coalesce(v_invitation.auth_email, '')) then
    v_result := 'blocked';
    v_reason := 'alias_mismatch';
  end if;

  if v_result is null and coalesce(v_old_auth_user.encrypted_password, '') <> '' then
    v_result := 'blocked';
    v_reason := 'password_present';
  end if;

  if v_result is null and v_old_auth_user.email_confirmed_at is not null then
    v_result := 'blocked';
    v_reason := 'email_confirmed';
  end if;

  if v_result is null and v_old_auth_user.deleted_at is not null then
    v_result := 'blocked';
    v_reason := 'already_soft_deleted';
  end if;

  if v_result is null and exists (
    select 1
    from auth.identities identity
    where identity.user_id = p_old_auth_user_id
  ) then
    v_result := 'blocked';
    v_reason := 'identity_present';
  end if;

  if v_result is null and exists (
    select 1
    from auth.sessions session
    where session.user_id = p_old_auth_user_id
  ) then
    v_result := 'blocked';
    v_reason := 'session_present';
  end if;

  if v_result is null and exists (
    select 1
    from auth.mfa_factors factor
    where factor.user_id = p_old_auth_user_id
  ) then
    v_result := 'blocked';
    v_reason := 'mfa_factor_present';
  end if;

  select exists (
    select 1
    from auth.identities identity
    where identity.user_id = p_old_auth_user_id
  ) into v_old_has_identity;

  select exists (
    select 1
    from auth.identities identity
    where identity.user_id = p_new_auth_user_id
      and identity.provider = 'email'
  ) into v_new_has_identity;

  if v_result is null then
    delete from auth.users au
    where au.id = p_old_auth_user_id
      and au.id = v_old_auth_user.id;

    if exists (
      select 1
      from auth.users au
      where au.id = p_old_auth_user_id
    ) then
      v_result := 'blocked';
      v_reason := 'delete_not_completed';
    else
      v_result := 'deleted';
      v_reason := 'old_auth_user_deleted';
    end if;
  end if;

  insert into public.workspace_invitation_auth_identity_repairs (
    organisation_id,
    invitation_id,
    membership_id,
    profile_id,
    old_auth_user_id,
    new_auth_user_id,
    outcome,
    failure_code,
    failure_message,
    old_auth_user_had_email_identity,
    new_auth_user_has_email_identity,
    actor_user_id,
    correlation_id,
    metadata
  )
  values (
    v_repair.organisation_id,
    v_repair.invitation_id,
    v_repair.membership_id,
    v_repair.profile_id,
    p_old_auth_user_id,
    p_new_auth_user_id,
    case
      when v_result = 'deleted' then 'placeholder_deleted'
      when v_result = 'already_absent' then 'placeholder_already_absent'
      else 'placeholder_release_blocked'
    end,
    case when v_result = 'blocked' then v_reason else null end,
    case when v_result = 'blocked' then 'blocked' else null end,
    v_old_has_identity,
    v_new_has_identity,
    auth.uid(),
    coalesce(p_correlation_id, gen_random_uuid()),
    jsonb_build_object(
      'release_result', v_result,
      'release_reason', v_reason,
      'membership_status', v_membership.status,
      'invitation_status', v_invitation.status,
      'profile_uuid_preserved', true,
      'membership_uuid_preserved', true,
      'membership_activated', false
    )
  );

  return query select v_result, v_reason;
end;
$$;

revoke all on function public.release_workspace_invitation_auth_placeholder(uuid, uuid, uuid, uuid) from public;
revoke all on function public.release_workspace_invitation_auth_placeholder(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.release_workspace_invitation_auth_placeholder(uuid, uuid, uuid, uuid) to service_role;

comment on function public.release_workspace_invitation_auth_placeholder(uuid, uuid, uuid, uuid) is
  'Service-role-only release path for positively verified malformed invitation Auth placeholders that Supabase Auth Admin cannot see. It is evidence-bound and cannot delete generic Auth users.';
