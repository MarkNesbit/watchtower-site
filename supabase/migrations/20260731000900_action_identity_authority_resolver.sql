-- WT-ACTION-IDENTITY-001C1: authoritative mutation-side identity contract.
-- No Action lifecycle RPC or responsibility persistence is changed in this migration.

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
  v_profile_count integer;
  v_membership_count integer;
  v_lifecycle_eligible boolean;
begin
  if v_auth_user_id is null then raise exception 'WT_ACTION_IDENTITY_UNAUTHENTICATED' using errcode = '42501'; end if;
  select count(*) into v_profile_count from public.profiles profile
    where profile.auth_user_id = v_auth_user_id or (profile.auth_user_id is null and profile.id = v_auth_user_id);
  if v_profile_count = 0 then raise exception 'WT_ACTION_IDENTITY_PROFILE_NOT_FOUND' using errcode = '42501'; end if;
  if v_profile_count <> 1 then raise exception 'WT_ACTION_IDENTITY_PROFILE_AMBIGUOUS' using errcode = '42501'; end if;
  select count(*) into v_membership_count from public.organisation_members membership
    join public.profiles profile on profile.id = membership.user_id
    where membership.organisation_id = p_organisation_id
      and (profile.auth_user_id = v_auth_user_id or (profile.auth_user_id is null and profile.id = v_auth_user_id));
  if v_membership_count = 0 then raise exception 'WT_ACTION_IDENTITY_MEMBERSHIP_NOT_FOUND' using errcode = '42501'; end if;
  if v_membership_count <> 1 then raise exception 'WT_ACTION_IDENTITY_MEMBERSHIP_AMBIGUOUS' using errcode = '42501'; end if;
  select membership.status = 'active' into v_lifecycle_eligible
    from public.organisation_members membership join public.profiles profile on profile.id = membership.user_id
    where membership.organisation_id = p_organisation_id
      and (profile.auth_user_id = v_auth_user_id or (profile.auth_user_id is null and profile.id = v_auth_user_id));
  if p_require_eligible and not v_lifecycle_eligible then raise exception 'WT_ACTION_IDENTITY_MEMBERSHIP_INELIGIBLE' using errcode = '42501'; end if;
  return query
    select v_auth_user_id, profile.id, membership.id, membership.organisation_id, membership.role, membership.status,
      membership.status = 'active'
    from public.organisation_members membership join public.profiles profile on profile.id = membership.user_id
    where membership.organisation_id = p_organisation_id
      and (profile.auth_user_id = v_auth_user_id or (profile.auth_user_id is null and profile.id = v_auth_user_id));
end;
$$;

create or replace function public.resolve_action_identity_for_action(
  p_action_id uuid,
  p_organisation_id uuid default null,
  p_require_eligible boolean default true
)
returns table (auth_user_id uuid, profile_id uuid, membership_id uuid, organisation_id uuid, workspace_role text, membership_status text, lifecycle_eligible boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_organisation_id uuid;
begin
  select action.organisation_id into v_organisation_id from public.project_actions action where action.id = p_action_id;
  if v_organisation_id is null then raise exception 'WT_ACTION_IDENTITY_ACTION_NOT_FOUND' using errcode = '42501'; end if;
  if p_organisation_id is not null and p_organisation_id <> v_organisation_id then raise exception 'WT_ACTION_IDENTITY_WORKSPACE_MISMATCH' using errcode = '42501'; end if;
  return query select * from public.resolve_action_identity(v_organisation_id, p_require_eligible);
end;
$$;

revoke all on function public.resolve_action_identity(uuid, boolean) from public;
revoke all on function public.resolve_action_identity_for_action(uuid, uuid, boolean) from public;
grant execute on function public.resolve_action_identity(uuid, boolean) to authenticated;
grant execute on function public.resolve_action_identity_for_action(uuid, uuid, boolean) to authenticated;
comment on function public.resolve_action_identity(uuid, boolean) is 'WT-ACTION-IDENTITY-001C1 canonical Auth to Profile to workspace Membership resolver for Action mutation authority. Legacy equal-ID compatibility is explicit and fail-closed.';
