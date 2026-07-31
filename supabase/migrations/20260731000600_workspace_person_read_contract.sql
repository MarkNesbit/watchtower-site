-- WT-IDENTITY-MEMBERSHIP-001B canonical workspace-person read contract.
-- This purpose-built directory preserves profile RLS and exposes only safe,
-- workspace-scoped person fields to callers with active workspace access.

create or replace view public.workspace_member_directory
as
select
  om.organisation_id,
  om.id as organisation_membership_id,
  p.id as profile_id,
  p.display_name,
  p.first_name,
  p.last_name,
  p.login_name,
  om.role,
  om.status as membership_status,
  (om.status = 'deactivated') as is_deactivated,
  om.deactivated_at,
  om.reactivated_at,
  om.joined_at,
  om.auth_user_id,
  coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    nullif(btrim(p.display_name), ''),
    nullif(btrim(p.login_name), ''),
    'Workspace member ' || left(om.id::text, 8)
  ) as resolved_display_name,
  invitation.status as invitation_status,
  (om.status = 'active') as assignment_eligible
from public.organisation_members om
join public.profiles p on p.id = om.user_id
left join lateral (
  select invitation.status
  from public.workspace_membership_invitations invitation
  where invitation.membership_id = om.id
    and invitation.is_current
  order by invitation.created_at desc
  limit 1
) invitation on true
where public.is_active_organisation_member(om.organisation_id);

comment on view public.workspace_member_directory is
  'Canonical safe workspace-person read contract. Active members of a workspace can resolve that workspace''s member/profile identity, lifecycle and assignment eligibility without direct cross-user profile reads. Contact and authentication email are excluded.';

grant select on public.workspace_member_directory to authenticated;
