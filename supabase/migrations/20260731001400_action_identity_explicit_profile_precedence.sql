-- WT-ACTION-IDENTITY-001C1 follow-up: an explicit Auth-linked Profile is
-- canonical. The legacy equal-ID fallback is only for accounts with no
-- explicit linkage, including where a retained legacy Profile has membership
-- history in a different workspace.

create or replace function public.resolve_action_identity(
  p_organisation_id uuid,
  p_require_eligible boolean default true
)
returns table (
  auth_user_id uuid,
  profile_id uuid,
  membership_id uuid,
  organisation_id uuid,
  workspace_role text,
  membership_status text,
  lifecycle_eligible boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_profile_id uuid;
  v_profile_count integer;
  v_membership_count integer;
  v_lifecycle_eligible boolean;
begin
  if v_auth_user_id is null then raise exception 'WT_ACTION_IDENTITY_UNAUTHENTICATED' using errcode = '42501'; end if;

  -- Explicit linkage is authoritative. A retained equal-ID legacy Profile must
  -- not become a competing candidate once invitation/profile linking exists.
  select count(*) into v_profile_count
  from public.profiles profile
  where profile.auth_user_id = v_auth_user_id;
  if v_profile_count > 1 then raise exception 'WT_ACTION_IDENTITY_PROFILE_AMBIGUOUS' using errcode = '42501'; end if;
  if v_profile_count = 1 then
    select profile.id into v_profile_id from public.profiles profile where profile.auth_user_id = v_auth_user_id;
  else
    select count(*) into v_profile_count
    from public.profiles profile
    where profile.auth_user_id is null and profile.id = v_auth_user_id;
    if v_profile_count = 0 then raise exception 'WT_ACTION_IDENTITY_PROFILE_NOT_FOUND' using errcode = '42501'; end if;
    if v_profile_count <> 1 then raise exception 'WT_ACTION_IDENTITY_PROFILE_AMBIGUOUS' using errcode = '42501'; end if;
    select profile.id into v_profile_id from public.profiles profile
      where profile.auth_user_id is null and profile.id = v_auth_user_id;
  end if;

  select count(*) into v_membership_count
  from public.organisation_members membership
  where membership.organisation_id = p_organisation_id
    and membership.user_id = v_profile_id;
  if v_membership_count = 0 then raise exception 'WT_ACTION_IDENTITY_MEMBERSHIP_NOT_FOUND' using errcode = '42501'; end if;
  if v_membership_count <> 1 then raise exception 'WT_ACTION_IDENTITY_MEMBERSHIP_AMBIGUOUS' using errcode = '42501'; end if;

  select membership.status = 'active' into v_lifecycle_eligible
  from public.organisation_members membership
  where membership.organisation_id = p_organisation_id and membership.user_id = v_profile_id;
  if p_require_eligible and not v_lifecycle_eligible then raise exception 'WT_ACTION_IDENTITY_MEMBERSHIP_INELIGIBLE' using errcode = '42501'; end if;

  return query
    select v_auth_user_id, v_profile_id, membership.id, membership.organisation_id, membership.role, membership.status,
      membership.status = 'active'
    from public.organisation_members membership
    where membership.organisation_id = p_organisation_id and membership.user_id = v_profile_id;
end;
$$;

revoke all on function public.resolve_action_identity(uuid, boolean) from public;
grant execute on function public.resolve_action_identity(uuid, boolean) to authenticated;
comment on function public.resolve_action_identity(uuid, boolean) is 'WT-ACTION identity resolver: explicit profiles.auth_user_id linkage takes precedence; legacy equal-ID fallback is used only when explicit linkage is absent.';
