-- WT-WORKSPACE-TEAM-008A-FIX-016 workspace resolution identity display support.
-- Directory views expose the linked Auth UUID so server-rendered UI can identify the
-- current member without comparing Auth UUIDs to immutable profile UUIDs.

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
  om.joined_at,
  om.deactivated_at,
  om.reactivated_at,
  om.auth_user_id
from public.organisation_members om
join public.profiles p on p.id = om.user_id
where public.is_active_organisation_member(om.organisation_id);

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
  om.joined_at,
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
  om.auth_user_id
from public.organisation_members om
join public.profiles p on p.id = om.user_id
left join public.workspace_membership_invitations invitation
  on invitation.membership_id = om.id
  and invitation.is_current
where public.has_real_active_organisation_role(
  om.organisation_id,
  array['owner', 'admin']
);

comment on view public.workspace_member_directory is
  'Safe same-workspace identity display fields for active workspace users. Contact email and auth email are deliberately excluded. auth_user_id is exposed for server-side current-member resolution only.';
comment on view public.workspace_member_admin_directory is
  'Owner/Admin workspace membership administration directory. Exposes contact/auth email, invitation evidence, joined_at and auth_user_id for controlled team administration.';

grant select on public.workspace_member_directory to authenticated;
grant select on public.workspace_member_admin_directory to authenticated;
