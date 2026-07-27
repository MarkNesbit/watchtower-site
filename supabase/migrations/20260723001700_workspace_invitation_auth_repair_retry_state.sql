-- WT-WORKSPACE-TEAM-008A-FIX-007 Auth repair retry state.
-- Migration 20260723001600 has already been applied in production, so the
-- candidate-loader return shape is advanced here with a forward-only function
-- replacement. The helper uses these fields to finish incomplete temporary
-- replacement Auth repairs without issuing setup links too early.

drop function if exists public.get_workspace_invitation_auth_identity_repair_candidates(uuid[], uuid[], text);

create or replace function public.get_workspace_invitation_auth_identity_repair_candidates(
  p_invitation_ids uuid[] default null,
  p_membership_ids uuid[] default null,
  p_token_hash text default null
)
returns table (
  invitation_id uuid,
  organisation_id uuid,
  membership_id uuid,
  profile_id uuid,
  current_auth_user_id uuid,
  auth_email text,
  membership_status text,
  invitation_status text,
  has_email_identity boolean,
  auth_email_matches_invitation boolean,
  existing_valid_auth_user_id uuid,
  previous_auth_user_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_SERVICE_ROLE: Auth identity repair candidates are service-role only.'
      using errcode = '42501';
  end if;

  return query
  select
    invitation.id,
    invitation.organisation_id,
    invitation.membership_id,
    invitation.profile_id,
    invitation.auth_user_id,
    invitation.auth_email,
    om.status,
    invitation.status,
    exists (
      select 1
      from auth.identities identity
      where identity.user_id = invitation.auth_user_id
        and identity.provider = 'email'
    ) as has_email_identity,
    lower(current_au.email) = lower(invitation.auth_email) as auth_email_matches_invitation,
    (
      select au_valid.id
      from auth.users au_valid
      where au_valid.id <> invitation.auth_user_id
        and lower(au_valid.email) = lower(invitation.auth_email)
        and exists (
          select 1
          from auth.identities valid_identity
          where valid_identity.user_id = au_valid.id
            and valid_identity.provider = 'email'
        )
      order by au_valid.created_at asc
      limit 1
    ) as existing_valid_auth_user_id,
    (
      select repair.old_auth_user_id
      from public.workspace_invitation_auth_identity_repairs repair
      where repair.organisation_id = invitation.organisation_id
        and repair.invitation_id = invitation.id
        and repair.membership_id = invitation.membership_id
        and repair.profile_id = invitation.profile_id
        and repair.new_auth_user_id = invitation.auth_user_id
        and repair.outcome in ('remapped_existing_user', 'remapped_created_user')
      order by repair.created_at desc
      limit 1
    ) as previous_auth_user_id
  from public.workspace_membership_invitations invitation
  join public.organisation_members om
    on om.id = invitation.membership_id
    and om.organisation_id = invitation.organisation_id
  join auth.users current_au
    on current_au.id = invitation.auth_user_id
  where invitation.is_current
    and om.status in ('invited', 'invite_expired')
    and invitation.auth_email is not null
    and (p_token_hash is null or invitation.token_hash = p_token_hash)
    and (p_invitation_ids is null or invitation.id = any(p_invitation_ids))
    and (p_membership_ids is null or invitation.membership_id = any(p_membership_ids))
  order by invitation.created_at, invitation.id;
end;
$$;

revoke all on function public.get_workspace_invitation_auth_identity_repair_candidates(uuid[], uuid[], text) from public;
revoke all on function public.get_workspace_invitation_auth_identity_repair_candidates(uuid[], uuid[], text) from authenticated;
grant execute on function public.get_workspace_invitation_auth_identity_repair_candidates(uuid[], uuid[], text) to service_role;

comment on function public.get_workspace_invitation_auth_identity_repair_candidates(uuid[], uuid[], text) is
  'Service-role-only candidate loader for invitation Auth identity repair. It returns retry state for incomplete temporary replacement Auth users and may return the deterministic auth email for server-side Supabase Admin provisioning.';
