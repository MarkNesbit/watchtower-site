-- WT-WORKSPACE-TEAM-008A-FIX-015: populate and expose the membership joined date for invitation acceptance.
-- The Team page's Joined column must read organisation_members.joined_at. Acceptance keeps accepted_at,
-- joined_at and invitation.accepted_at on the same transaction timestamp, while preserving an existing
-- joined_at value for memberships that already had one.

create or replace function public.accept_workspace_membership_invitation(
  p_token_hash text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_invitation public.workspace_membership_invitations;
  v_membership public.organisation_members;
  v_actor_auth_user_id uuid := auth.uid();
  v_accepted_at timestamptz := now();
begin
  if v_actor_auth_user_id is null then
    raise exception 'WT_INVITATION_WRONG_ACCOUNT: This invitation belongs to another account.' using errcode = '42501';
  end if;

  select * into v_invitation
  from public.workspace_membership_invitations as invitation
  where invitation.token_hash = p_token_hash
    and invitation.is_current
  for update;

  if not found then
    raise exception 'WT_INVITATION_INVALID: Invitation is invalid.' using errcode = '42501';
  end if;

  select * into v_membership
  from public.organisation_members as om
  where om.id = v_invitation.membership_id
    and om.organisation_id = v_invitation.organisation_id
  for update;

  if not found then
    raise exception 'WT_INVITATION_MEMBERSHIP_STATE: Membership is not awaiting invitation acceptance.' using errcode = '23514';
  end if;

  if v_actor_auth_user_id <> v_invitation.auth_user_id then
    raise exception 'WT_INVITATION_WRONG_ACCOUNT: This invitation belongs to another account.' using errcode = '42501';
  end if;

  if v_invitation.status = 'accepted' or v_membership.status = 'active' then
    perform public.record_workspace_membership_audit_event(
      v_invitation.organisation_id,
      v_invitation.membership_id,
      v_invitation.auth_user_id,
      v_actor_auth_user_id,
      'workspace_invitation_replay_rejected',
      v_invitation.status,
      v_invitation.status,
      jsonb_build_object(
        'invitation_id', v_invitation.id,
        'profile_id', v_invitation.profile_id,
        'target_auth_user_id', v_invitation.auth_user_id
      ),
      jsonb_build_object('requested_action', 'accept'),
      'Invitation acceptance replay was rejected.',
      'workspace_invitation_acceptance',
      v_invitation.correlation_id
    );
    return v_invitation.membership_id;
  end if;

  if v_invitation.status in ('cancelled', 'superseded') or v_invitation.cancelled_at is not null or v_invitation.superseded_at is not null then
    raise exception 'WT_INVITATION_NOT_ACCEPTABLE: Invitation cannot be accepted.' using errcode = '42501';
  end if;

  if v_invitation.expires_at <= v_accepted_at then
    raise exception 'WT_INVITATION_EXPIRED: Invitation has expired.' using errcode = '42501';
  end if;

  if v_invitation.status not in ('opened', 'delivered') then
    raise exception 'WT_INVITATION_NOT_ACCEPTABLE: Invitation cannot be accepted.' using errcode = '42501';
  end if;

  if v_membership.organisation_id <> v_invitation.organisation_id
     or v_membership.id <> v_invitation.membership_id
     or v_membership.user_id <> v_invitation.profile_id
     or v_membership.role <> v_invitation.intended_role then
    raise exception 'WT_INVITATION_MEMBERSHIP_LINKAGE: Invitation does not match the protected membership linkage.' using errcode = '42501';
  end if;

  if v_membership.status <> 'invited' then
    raise exception 'WT_INVITATION_MEMBERSHIP_STATE: Membership is not awaiting invitation acceptance.' using errcode = '23514';
  end if;

  if v_membership.auth_user_id is null or v_membership.auth_user_id <> v_actor_auth_user_id then
    raise exception 'WT_INVITATION_WRONG_ACCOUNT: This invitation belongs to another account.' using errcode = '42501';
  end if;

  update public.workspace_membership_invitations as invitation
    set status = 'accepted',
        accepted_at = v_accepted_at,
        accepted_by = v_actor_auth_user_id,
        token_hash = null,
        failure_code = null,
        failure_message = null
  where invitation.id = v_invitation.id
    and invitation.is_current
    and invitation.status in ('opened', 'delivered')
    and invitation.membership_id = v_membership.id
    and invitation.profile_id = v_membership.user_id
    and invitation.auth_user_id = v_actor_auth_user_id
    and invitation.intended_role = v_membership.role
    and invitation.expires_at > v_accepted_at
    and invitation.cancelled_at is null
    and invitation.superseded_at is null;

  if not found then
    raise exception 'WT_INVITATION_NOT_ACCEPTABLE: Invitation cannot be accepted.' using errcode = '42501';
  end if;

  perform set_config('watchtower.membership_lifecycle_operation', 'workspace_invitation_acceptance', true);
  perform set_config('watchtower.membership_lifecycle_organisation_id', v_invitation.organisation_id::text, true);
  perform set_config('watchtower.membership_lifecycle_membership_id', v_invitation.membership_id::text, true);
  perform set_config('watchtower.membership_lifecycle_profile_id', v_invitation.profile_id::text, true);
  perform set_config('watchtower.membership_lifecycle_auth_user_id', v_actor_auth_user_id::text, true);
  perform set_config('watchtower.membership_lifecycle_invitation_id', v_invitation.id::text, true);
  perform set_config('watchtower.membership_lifecycle_correlation_id', v_invitation.correlation_id::text, true);

  begin
    update public.organisation_members as om
      set status = 'active',
          accepted_at = v_accepted_at,
          joined_at = coalesce(om.joined_at, v_accepted_at),
          updated_by = v_actor_auth_user_id,
          updated_at = v_accepted_at
    where om.id = v_invitation.membership_id
      and om.organisation_id = v_invitation.organisation_id
      and om.user_id = v_invitation.profile_id
      and om.auth_user_id = v_actor_auth_user_id
      and om.role = v_invitation.intended_role
      and om.status = 'invited';

    if not found then
      raise exception 'WT_INVITATION_ACTIVATION_FAILED: Membership activation failed.' using errcode = '40001';
    end if;
  exception
    when others then
      perform set_config('watchtower.membership_lifecycle_operation', '', true);
      perform set_config('watchtower.membership_lifecycle_organisation_id', '', true);
      perform set_config('watchtower.membership_lifecycle_membership_id', '', true);
      perform set_config('watchtower.membership_lifecycle_profile_id', '', true);
      perform set_config('watchtower.membership_lifecycle_auth_user_id', '', true);
      perform set_config('watchtower.membership_lifecycle_invitation_id', '', true);
      perform set_config('watchtower.membership_lifecycle_correlation_id', '', true);
      raise;
  end;

  perform set_config('watchtower.membership_lifecycle_operation', '', true);
  perform set_config('watchtower.membership_lifecycle_organisation_id', '', true);
  perform set_config('watchtower.membership_lifecycle_membership_id', '', true);
  perform set_config('watchtower.membership_lifecycle_profile_id', '', true);
  perform set_config('watchtower.membership_lifecycle_auth_user_id', '', true);
  perform set_config('watchtower.membership_lifecycle_invitation_id', '', true);
  perform set_config('watchtower.membership_lifecycle_correlation_id', '', true);

  perform public.record_workspace_membership_audit_event(
    v_invitation.organisation_id,
    v_invitation.membership_id,
    v_membership.auth_user_id,
    v_actor_auth_user_id,
    'workspace_invitation_accepted',
    v_invitation.status,
    'accepted',
    jsonb_build_object(
      'invitation_id', v_invitation.id,
      'profile_id', v_invitation.profile_id,
      'role', v_invitation.intended_role,
      'target_auth_user_id', v_membership.auth_user_id
    ),
    jsonb_build_object('membership_status', 'active', 'joined_at', coalesce(v_membership.joined_at, v_accepted_at)),
    'Invitation accepted by the linked auth identity.',
    'workspace_invitation_acceptance',
    v_invitation.correlation_id
  );

  perform public.record_workspace_membership_audit_event(
    v_invitation.organisation_id,
    v_invitation.membership_id,
    v_membership.auth_user_id,
    v_actor_auth_user_id,
    'workspace_membership_activated',
    v_membership.status,
    'active',
    jsonb_build_object(
      'invitation_id', v_invitation.id,
      'profile_id', v_invitation.profile_id,
      'target_auth_user_id', v_membership.auth_user_id
    ),
    jsonb_build_object('role', v_invitation.intended_role, 'joined_at', coalesce(v_membership.joined_at, v_accepted_at)),
    'Membership activated after secure invitation acceptance.',
    'workspace_invitation_acceptance',
    v_invitation.correlation_id
  );

  return v_invitation.membership_id;
end;
$$;

revoke all on function public.accept_workspace_membership_invitation(text) from public;
grant execute on function public.accept_workspace_membership_invitation(text) to authenticated, service_role;

comment on function public.accept_workspace_membership_invitation(text) is
  'Accepts a current delivered/opened invitation for the exact linked Supabase Auth identity, activates only the existing invited membership via the lifecycle guard, records audit target_user_id values in the auth.users identity domain, and sets joined_at to the acceptance timestamp only when it was previously null.';

do $$
declare
  v_backfilled_count integer := 0;
begin
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);

  update public.organisation_members as om
    set accepted_at = coalesce(om.accepted_at, invitation.accepted_at),
        joined_at = coalesce(om.joined_at, om.accepted_at, invitation.accepted_at),
        updated_at = now()
  from public.workspace_membership_invitations as invitation
  where invitation.membership_id = om.id
    and invitation.organisation_id = om.organisation_id
    and invitation.profile_id = om.user_id
    and invitation.auth_user_id = om.auth_user_id
    and invitation.is_current
    and invitation.status = 'accepted'
    and invitation.accepted_at is not null
    and om.status = 'active'
    and om.joined_at is null;

  get diagnostics v_backfilled_count = row_count;

  perform set_config('watchtower.membership_lifecycle_rpc', '', true);
  raise notice 'WT_INVITATION_JOINED_AT_BACKFILL: populated joined_at for % accepted active invitation memberships.', v_backfilled_count;
end;
$$;

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
  om.joined_at
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
  om.joined_at
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
  'Safe same-workspace identity display fields for active workspace users. Contact email and auth email are deliberately excluded. joined_at is exposed for the Team Joined date.';
comment on view public.workspace_member_admin_directory is
  'Owner/Admin workspace membership administration directory. Exposes contact/auth email, invitation evidence and joined_at for controlled team administration.';
