-- WT-WORKSPACE-TEAM-008A-FIX-013: authorise invitation acceptance through the membership lifecycle guard.
-- The earlier controlled identity-preparation guard exception covered invitation expiry metadata only.
-- Activation must remain gated by the acceptance RPC so the invitation, profile, membership and auth links
-- are verified before the invited -> active membership transition is allowed.

create or replace function public.prevent_unsafe_workspace_membership_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  lifecycle_rpc boolean := coalesce(current_setting('watchtower.membership_lifecycle_rpc', true), '') = 'true';
  lifecycle_operation text := coalesce(current_setting('watchtower.membership_lifecycle_operation', true), '');
  invitation_preparation boolean := lifecycle_operation = 'workspace_invitation_identity_preparation';
  invitation_acceptance boolean := lifecycle_operation = 'workspace_invitation_acceptance';
  marker_organisation_id text;
  marker_membership_id text;
  marker_profile_id text;
  marker_auth_user_id text;
  uuid_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if old.organisation_id is distinct from new.organisation_id
     or old.user_id is distinct from new.user_id
     or old.auth_user_id is distinct from new.auth_user_id
     or old.created_at is distinct from new.created_at then
    raise exception 'Workspace membership identity fields cannot be changed.' using errcode = '42501';
  end if;

  if old.role = 'owner'
     and old.status = 'active'
     and (new.role <> 'owner' or new.status <> 'active') then
    perform public.workspace_membership_assert_not_final_owner(old);
  end if;

  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if lifecycle_rpc then
    return new;
  end if;

  if invitation_preparation then
    marker_organisation_id := nullif(current_setting('watchtower.membership_lifecycle_organisation_id', true), '');
    marker_membership_id := nullif(current_setting('watchtower.membership_lifecycle_membership_id', true), '');
    marker_profile_id := nullif(current_setting('watchtower.membership_lifecycle_profile_id', true), '');

    if marker_organisation_id is null
       or marker_membership_id is null
       or marker_profile_id is null
       or marker_organisation_id !~* uuid_pattern
       or marker_membership_id !~* uuid_pattern
       or marker_profile_id !~* uuid_pattern then
      raise exception 'WT_INVITATION_CONTROLLED_IDENTITY_CONTEXT: Invitation preparation context does not include valid protected membership markers.'
        using errcode = '42501';
    end if;

    if old.organisation_id <> marker_organisation_id::uuid
       or old.id <> marker_membership_id::uuid
       or old.user_id <> marker_profile_id::uuid then
      raise exception 'WT_INVITATION_CONTROLLED_IDENTITY_CONTEXT: Invitation preparation context does not match the protected membership.'
        using errcode = '42501';
    end if;

    if old.status not in ('invited', 'invite_expired')
       or new.status is distinct from old.status
       or new.role is distinct from old.role
       or new.invited_by is distinct from old.invited_by
       or new.invited_at is distinct from old.invited_at
       or new.accepted_at is distinct from old.accepted_at
       or new.joined_at is distinct from old.joined_at
       or new.suspended_at is distinct from old.suspended_at
       or new.suspended_by is distinct from old.suspended_by
       or new.suspension_reason is distinct from old.suspension_reason
       or new.deactivated_at is distinct from old.deactivated_at
       or new.deactivated_by is distinct from old.deactivated_by
       or new.deactivation_reason is distinct from old.deactivation_reason
       or new.reactivated_at is distinct from old.reactivated_at
       or new.reactivated_by is distinct from old.reactivated_by
       or new.reactivation_reason is distinct from old.reactivation_reason
       or new.invitation_expires_at is null then
      raise exception 'WT_INVITATION_CONTROLLED_IDENTITY_SCOPE: Invitation preparation may only refresh invited-membership invitation expiry metadata.'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if invitation_acceptance then
    marker_organisation_id := nullif(current_setting('watchtower.membership_lifecycle_organisation_id', true), '');
    marker_membership_id := nullif(current_setting('watchtower.membership_lifecycle_membership_id', true), '');
    marker_profile_id := nullif(current_setting('watchtower.membership_lifecycle_profile_id', true), '');
    marker_auth_user_id := nullif(current_setting('watchtower.membership_lifecycle_auth_user_id', true), '');

    if marker_organisation_id is null
       or marker_membership_id is null
       or marker_profile_id is null
       or marker_auth_user_id is null
       or marker_organisation_id !~* uuid_pattern
       or marker_membership_id !~* uuid_pattern
       or marker_profile_id !~* uuid_pattern
       or marker_auth_user_id !~* uuid_pattern then
      raise exception 'WT_INVITATION_ACCEPTANCE_CONTEXT: Invitation acceptance context does not include valid protected membership markers.'
        using errcode = '42501';
    end if;

    if old.organisation_id <> marker_organisation_id::uuid
       or old.id <> marker_membership_id::uuid
       or old.user_id <> marker_profile_id::uuid
       or old.auth_user_id <> marker_auth_user_id::uuid then
      raise exception 'WT_INVITATION_ACCEPTANCE_CONTEXT: Invitation acceptance context does not match the protected membership.'
        using errcode = '42501';
    end if;

    if old.status <> 'invited'
       or new.status <> 'active'
       or old.accepted_at is not null
       or new.accepted_at is null
       or new.role is distinct from old.role
       or new.invited_by is distinct from old.invited_by
       or new.invited_at is distinct from old.invited_at
       or new.invitation_expires_at is distinct from old.invitation_expires_at
       or (old.joined_at is not null and new.joined_at is distinct from old.joined_at)
       or new.joined_at is null
       or new.suspended_at is distinct from old.suspended_at
       or new.suspended_by is distinct from old.suspended_by
       or new.suspension_reason is distinct from old.suspension_reason
       or new.deactivated_at is distinct from old.deactivated_at
       or new.deactivated_by is distinct from old.deactivated_by
       or new.deactivation_reason is distinct from old.deactivation_reason
       or new.reactivated_at is distinct from old.reactivated_at
       or new.reactivated_by is distinct from old.reactivated_by
       or new.reactivation_reason is distinct from old.reactivation_reason then
      raise exception 'WT_INVITATION_ACCEPTANCE_SCOPE: Invitation acceptance may only activate the exact invited membership without changing identity or role.'
        using errcode = '42501';
    end if;

    return new;
  end if;

  actor_role := public.real_active_organisation_role(old.organisation_id, auth.uid());
  if actor_role = 'admin' and old.role in ('owner', 'admin') then
    raise exception 'Admins cannot directly alter Owner or Admin memberships.' using errcode = '42501';
  end if;

  if old.role is distinct from new.role
     or old.status is distinct from new.status
     or old.invited_by is distinct from new.invited_by
     or old.invited_at is distinct from new.invited_at
     or old.invitation_expires_at is distinct from new.invitation_expires_at
     or old.accepted_at is distinct from new.accepted_at
     or old.joined_at is distinct from new.joined_at
     or old.suspended_at is distinct from new.suspended_at
     or old.suspended_by is distinct from new.suspended_by
     or old.suspension_reason is distinct from new.suspension_reason
     or old.deactivated_at is distinct from new.deactivated_at
     or old.deactivated_by is distinct from new.deactivated_by
     or old.deactivation_reason is distinct from new.deactivation_reason
     or old.reactivated_at is distinct from new.reactivated_at
     or old.reactivated_by is distinct from new.reactivated_by
     or old.reactivation_reason is distinct from new.reactivation_reason then
    raise exception 'Use controlled workspace membership lifecycle functions for membership lifecycle changes.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

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
      v_invitation.profile_id,
      v_actor_auth_user_id,
      'workspace_invitation_replay_rejected',
      v_invitation.status,
      v_invitation.status,
      jsonb_build_object('invitation_id', v_invitation.id),
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
    v_invitation.profile_id,
    v_actor_auth_user_id,
    'workspace_invitation_accepted',
    v_invitation.status,
    'accepted',
    jsonb_build_object('invitation_id', v_invitation.id, 'role', v_invitation.intended_role),
    jsonb_build_object('membership_status', 'active'),
    'Invitation accepted by the linked auth identity.',
    'workspace_invitation_acceptance',
    v_invitation.correlation_id
  );

  perform public.record_workspace_membership_audit_event(
    v_invitation.organisation_id,
    v_invitation.membership_id,
    v_invitation.profile_id,
    v_actor_auth_user_id,
    'workspace_membership_activated',
    v_membership.status,
    'active',
    jsonb_build_object('invitation_id', v_invitation.id),
    jsonb_build_object('role', v_invitation.intended_role),
    'Membership activated after secure invitation acceptance.',
    'workspace_invitation_acceptance',
    v_invitation.correlation_id
  );

  return v_invitation.membership_id;
end;
$$;

revoke all on function public.accept_workspace_membership_invitation(text) from public;
grant execute on function public.accept_workspace_membership_invitation(text) to authenticated, service_role;

comment on function public.prevent_unsafe_workspace_membership_update() is
  'Rejects direct lifecycle changes. Controlled invitation preparation may refresh invite expiry only; controlled invitation acceptance may perform only the exact invited-to-active transition for a verified invitation.';

comment on function public.accept_workspace_membership_invitation(text) is
  'Accepts a current delivered/opened invitation for the exact linked Supabase Auth identity, then activates only the existing invited membership via the membership lifecycle guard while preserving profile, membership, Auth and role linkage.';
