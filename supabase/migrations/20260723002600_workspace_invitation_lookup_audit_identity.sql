-- WT-008A-FIX-023: keep invitation token lookup/open audit identities in their declared domains.
-- workspace_membership_audit_events.target_user_id references auth.users(id), so
-- lookup/open audit rows must use the current invitation/membership Auth UUID.

create or replace function public.get_workspace_membership_invitation_by_token(
  p_token_hash text
)
returns table (
  invitation_id uuid,
  organisation_id uuid,
  membership_id uuid,
  profile_id uuid,
  auth_user_id uuid,
  workspace_name text,
  workspace_slug text,
  person_name text,
  login_name text,
  intended_role text,
  expires_at timestamptz,
  status text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_invitation public.workspace_membership_invitations;
  v_membership public.organisation_members;
  v_actor_auth_user_id uuid := auth.uid();
begin
  select * into v_invitation
  from public.workspace_membership_invitations as invitation
  where invitation.token_hash = p_token_hash
    and invitation.is_current
  for update;

  if not found then
    return;
  end if;

  select * into v_membership
  from public.organisation_members as membership
  where membership.id = v_invitation.membership_id
    and membership.organisation_id = v_invitation.organisation_id
  for update;

  if not found
     or v_membership.user_id is distinct from v_invitation.profile_id
     or v_membership.auth_user_id is null
     or v_membership.auth_user_id is distinct from v_invitation.auth_user_id
     or v_membership.role is distinct from v_invitation.intended_role then
    raise exception 'WT_INVITATION_LOOKUP_IDENTITY_MISMATCH: Invitation lookup requires matching profile, Auth and role linkage.'
      using errcode = '42501';
  end if;

  if v_invitation.expires_at <= now() and v_invitation.status in ('pending_delivery', 'sending', 'delivered', 'delivery_failed', 'opened') then
    update public.workspace_membership_invitations
      set status = 'expired',
          token_hash = null
    where id = v_invitation.id;

    perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);
    begin
      update public.organisation_members as om
        set status = 'invite_expired',
            invitation_expires_at = coalesce(om.invitation_expires_at, v_invitation.expires_at),
            updated_at = now()
      where om.id = v_invitation.membership_id
        and om.status = 'invited';
    exception
      when others then
        perform set_config('watchtower.membership_lifecycle_rpc', '', true);
        raise;
    end;
    perform set_config('watchtower.membership_lifecycle_rpc', '', true);

    perform public.record_workspace_membership_audit_event(
      v_invitation.organisation_id,
      v_invitation.membership_id,
      v_membership.auth_user_id,
      v_actor_auth_user_id,
      'workspace_invitation_expired',
      v_invitation.status,
      'expired',
      jsonb_build_object(
        'invitation_id', v_invitation.id,
        'membership_id', v_invitation.membership_id,
        'profile_id', v_invitation.profile_id,
        'target_auth_user_id', v_membership.auth_user_id,
        'membership_status', v_membership.status
      ),
      jsonb_build_object(
        'expires_at', v_invitation.expires_at,
        'membership_status', case when v_membership.status = 'invited' then 'invite_expired' else v_membership.status end
      ),
      'Invitation expired before acceptance.',
      'workspace_invitation_acceptance',
      v_invitation.correlation_id
    );
    return;
  end if;

  if v_invitation.status not in ('delivered', 'opened') then
    perform public.record_workspace_membership_audit_event(
      v_invitation.organisation_id,
      v_invitation.membership_id,
      v_membership.auth_user_id,
      v_actor_auth_user_id,
      'workspace_invitation_replay_rejected',
      v_invitation.status,
      v_invitation.status,
      jsonb_build_object(
        'invitation_id', v_invitation.id,
        'membership_id', v_invitation.membership_id,
        'profile_id', v_invitation.profile_id,
        'target_auth_user_id', v_membership.auth_user_id
      ),
      jsonb_build_object('requested_action', 'open'),
      'Invitation link replay or invalid state was rejected.',
      'workspace_invitation_acceptance',
      v_invitation.correlation_id
    );
    return;
  end if;

  if v_invitation.status = 'delivered' then
    update public.workspace_membership_invitations
      set status = 'opened',
          opened_at = coalesce(opened_at, now())
    where id = v_invitation.id;

    perform public.record_workspace_membership_audit_event(
      v_invitation.organisation_id,
      v_invitation.membership_id,
      v_membership.auth_user_id,
      v_actor_auth_user_id,
      'workspace_invitation_opened',
      'delivered',
      'opened',
      jsonb_build_object(
        'invitation_id', v_invitation.id,
        'membership_id', v_invitation.membership_id,
        'profile_id', v_invitation.profile_id,
        'target_auth_user_id', v_membership.auth_user_id
      ),
      jsonb_build_object('expires_at', v_invitation.expires_at),
      'Invitation link was opened.',
      'workspace_invitation_acceptance',
      v_invitation.correlation_id
    );
  end if;

  return query
  select
    invitation.id,
    invitation.organisation_id,
    invitation.membership_id,
    invitation.profile_id,
    invitation.auth_user_id,
    organisation.name,
    organisation.slug,
    coalesce(nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''), profile.display_name, profile.login_name, 'Invited member'),
    profile.login_name,
    invitation.intended_role,
    invitation.expires_at,
    case when invitation.status = 'delivered' then 'opened' else invitation.status end
  from public.workspace_membership_invitations as invitation
  join public.organisations as organisation on organisation.id = invitation.organisation_id
  join public.profiles as profile on profile.id = invitation.profile_id
  where invitation.id = v_invitation.id;
end;
$$;

revoke all on function public.get_workspace_membership_invitation_by_token(text) from public;
grant execute on function public.get_workspace_membership_invitation_by_token(text) to anon, authenticated, service_role;

comment on function public.get_workspace_membership_invitation_by_token(text) is
  'Returns the current invitation for an opaque token hash, marks delivered invitations as opened, expires stale invitations, and records lookup/open audit rows against the invited Auth UUID rather than the profile UUID.';
