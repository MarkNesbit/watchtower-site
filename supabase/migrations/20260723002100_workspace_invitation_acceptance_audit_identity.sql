-- WT-WORKSPACE-TEAM-008A-FIX-014: keep invitation acceptance audit identities in their declared domains.
-- workspace_membership_audit_events.target_user_id references auth.users(id). The invitation acceptance
-- audit records must therefore use the validated invited Auth UUID, while profile UUID evidence remains
-- in the JSON audit payload because the audit table has no dedicated profile foreign-key column.

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
    jsonb_build_object('membership_status', 'active'),
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

comment on function public.accept_workspace_membership_invitation(text) is
  'Accepts a current delivered/opened invitation for the exact linked Supabase Auth identity, activates only the existing invited membership via the lifecycle guard, and records audit target_user_id values in the auth.users identity domain.';
