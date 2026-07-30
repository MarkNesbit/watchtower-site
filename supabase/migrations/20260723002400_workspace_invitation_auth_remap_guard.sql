-- WT-WORKSPACE-TEAM-008A-FIX-020: authorise controlled invitation Auth identity remaps.
-- The membership identity guard must continue to reject direct identity changes, but the
-- service-role repair RPC needs one narrow transaction-local path for invited placeholders.

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
  invitation_auth_identity_repair boolean := lifecycle_operation = 'workspace_invitation_auth_identity_repair';
  marker_organisation_id text;
  marker_membership_id text;
  marker_profile_id text;
  marker_auth_user_id text;
  marker_new_auth_user_id text;
  uuid_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if old.organisation_id is distinct from new.organisation_id
     or old.user_id is distinct from new.user_id
     or old.created_at is distinct from new.created_at then
    raise exception 'Workspace membership identity fields cannot be changed.' using errcode = '42501';
  end if;

  if old.auth_user_id is distinct from new.auth_user_id then
    if invitation_auth_identity_repair then
      if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_SERVICE_ROLE: Auth identity repair membership guard is service-role only.'
          using errcode = '42501';
      end if;

      marker_organisation_id := nullif(current_setting('watchtower.membership_lifecycle_organisation_id', true), '');
      marker_membership_id := nullif(current_setting('watchtower.membership_lifecycle_membership_id', true), '');
      marker_profile_id := nullif(current_setting('watchtower.membership_lifecycle_profile_id', true), '');
      marker_auth_user_id := nullif(current_setting('watchtower.membership_lifecycle_auth_user_id', true), '');
      marker_new_auth_user_id := nullif(current_setting('watchtower.membership_lifecycle_new_auth_user_id', true), '');

      if marker_organisation_id is null
         or marker_membership_id is null
         or marker_profile_id is null
         or marker_auth_user_id is null
         or marker_new_auth_user_id is null
         or marker_organisation_id !~* uuid_pattern
         or marker_membership_id !~* uuid_pattern
         or marker_profile_id !~* uuid_pattern
         or marker_auth_user_id !~* uuid_pattern
         or marker_new_auth_user_id !~* uuid_pattern then
        raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_CONTEXT: Auth identity repair context does not include valid protected membership markers.'
          using errcode = '42501';
      end if;

      if old.organisation_id is distinct from marker_organisation_id::uuid
         or old.id is distinct from marker_membership_id::uuid
         or old.user_id is distinct from marker_profile_id::uuid
         or old.auth_user_id is distinct from marker_auth_user_id::uuid
         or new.auth_user_id is distinct from marker_new_auth_user_id::uuid
         or marker_auth_user_id::uuid = marker_new_auth_user_id::uuid then
        raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_CONTEXT: Auth identity repair context does not match the protected membership.'
          using errcode = '42501';
      end if;

      if old.status not in ('invited', 'invite_expired')
         or new.status is distinct from old.status
         or new.role is distinct from old.role
         or new.invited_by is distinct from old.invited_by
         or new.invited_at is distinct from old.invited_at
         or new.invitation_expires_at is distinct from old.invitation_expires_at
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
         or new.updated_by is distinct from old.updated_by then
        raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_SCOPE: Auth identity repair may only replace the Auth UUID on the exact invited membership.'
          using errcode = '42501';
      end if;

      return new;
    end if;

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

comment on function public.prevent_unsafe_workspace_membership_update() is
  'Rejects direct membership identity and lifecycle changes. Controlled invitation preparation may refresh expiry metadata, controlled invitation acceptance may activate the exact invited membership, and controlled invitation Auth repair may replace only the Auth UUID for a verified invited placeholder remap.';

create or replace function public.record_workspace_invitation_auth_identity_repair(
  p_invitation_id uuid,
  p_old_auth_user_id uuid,
  p_new_auth_user_id uuid,
  p_outcome text,
  p_failure_code text default null,
  p_failure_message text default null,
  p_correlation_id uuid default gen_random_uuid()
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
  v_profile public.profiles;
  v_old_has_identity boolean := false;
  v_new_has_identity boolean := false;
  v_repair_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_SERVICE_ROLE: Auth identity repair recording is service-role only.'
      using errcode = '42501';
  end if;

  if p_outcome not in ('detected', 'attempted', 'skipped_valid', 'remapped_existing_user', 'remapped_created_user', 'failed') then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_OUTCOME: Unsupported repair outcome.'
      using errcode = '23514';
  end if;

  if p_old_auth_user_id is null or p_new_auth_user_id is null then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_UUID_REQUIRED: Auth identity repair requires old and new Auth UUIDs.'
      using errcode = '23502';
  end if;

  if p_outcome in ('remapped_existing_user', 'remapped_created_user') and p_old_auth_user_id = p_new_auth_user_id then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_SAME_AUTH: Auth identity repair requires distinct old and replacement Auth UUIDs.'
      using errcode = '23514';
  end if;

  select * into v_invitation
  from public.workspace_membership_invitations invitation
  where invitation.id = p_invitation_id
    and invitation.is_current
  for update;

  if not found then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_NOT_FOUND: Current invitation was not found.'
      using errcode = '23503';
  end if;

  select * into v_membership
  from public.organisation_members om
  where om.id = v_invitation.membership_id
    and om.organisation_id = v_invitation.organisation_id
  for update;

  if not found then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_MEMBERSHIP: Linked membership was not found.'
      using errcode = '23503';
  end if;

  select * into v_profile
  from public.profiles profile
  where profile.id = v_invitation.profile_id
  for update;

  if not found then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_PROFILE: Linked profile was not found.'
      using errcode = '23503';
  end if;

  if v_invitation.membership_id is distinct from v_membership.id
     or v_invitation.organisation_id is distinct from v_membership.organisation_id
     or v_invitation.profile_id is distinct from v_profile.id
     or v_membership.user_id is distinct from v_profile.id then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_LINKAGE: Invitation, profile and membership linkage is inconsistent.'
      using errcode = '23514';
  end if;

  if p_outcome in ('remapped_existing_user', 'remapped_created_user')
     and v_invitation.auth_user_id = p_new_auth_user_id
     and v_profile.auth_user_id = p_new_auth_user_id
     and v_membership.auth_user_id = p_new_auth_user_id then
    select repair.id into v_repair_id
    from public.workspace_invitation_auth_identity_repairs repair
    where repair.organisation_id = v_invitation.organisation_id
      and repair.invitation_id = v_invitation.id
      and repair.membership_id = v_membership.id
      and repair.profile_id = v_profile.id
      and repair.old_auth_user_id = p_old_auth_user_id
      and repair.new_auth_user_id = p_new_auth_user_id
      and repair.outcome in ('remapped_existing_user', 'remapped_created_user')
    order by repair.created_at desc
    limit 1;

    if v_repair_id is not null then
      return v_repair_id;
    end if;

    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_REPLAY: Auth identity repair is already remapped but audit evidence was not found.'
      using errcode = '40001';
  end if;

  if v_invitation.auth_user_id is distinct from p_old_auth_user_id then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_STALE: Invitation Auth identity changed before repair could be recorded.'
      using errcode = '40001';
  end if;

  select exists (
    select 1
    from auth.identities identity
    where identity.user_id = p_old_auth_user_id
      and identity.provider = 'email'
  ) into v_old_has_identity;

  select exists (
    select 1
    from auth.users au
    where au.id = p_new_auth_user_id
      and exists (
        select 1
        from auth.identities identity
        where identity.user_id = au.id
          and identity.provider = 'email'
      )
  ) into v_new_has_identity;

  if p_outcome in ('remapped_existing_user', 'remapped_created_user', 'skipped_valid') and not v_new_has_identity then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_INVALID: Replacement Auth user does not have a Supabase email identity.'
      using errcode = '23503';
  end if;

  if p_outcome in ('remapped_existing_user', 'remapped_created_user') then
    if v_profile.auth_user_id is distinct from p_old_auth_user_id
       or v_membership.auth_user_id is distinct from p_old_auth_user_id then
      raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_STALE_LINKAGE: Profile and membership Auth linkage must match the old placeholder Auth UUID.'
        using errcode = '40001';
    end if;

    if v_membership.status not in ('invited', 'invite_expired')
       or v_invitation.status not in ('pending_delivery', 'sending', 'delivered', 'delivery_failed', 'opened')
       or v_invitation.intended_role is distinct from v_membership.role then
      raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_STATE: Invitation Auth repair requires a current invited membership and deliverable invitation.'
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.organisation_members other_membership
      where other_membership.auth_user_id = p_new_auth_user_id
        and other_membership.id <> v_membership.id
    ) or exists (
      select 1
      from public.profiles other_profile
      where other_profile.auth_user_id = p_new_auth_user_id
        and other_profile.id <> v_profile.id
    ) then
      raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_DUPLICATE: Replacement Auth user is already linked to another Watchtower identity.'
        using errcode = '23505';
    end if;

    update public.profiles profile
      set auth_user_id = p_new_auth_user_id,
          updated_at = now()
    where profile.id = v_profile.id
      and profile.auth_user_id = p_old_auth_user_id;

    if not found then
      raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_PROFILE_STATE: Linked profile could not be remapped safely.'
        using errcode = '40001';
    end if;

    perform set_config('watchtower.membership_lifecycle_operation', 'workspace_invitation_auth_identity_repair', true);
    perform set_config('watchtower.membership_lifecycle_organisation_id', v_invitation.organisation_id::text, true);
    perform set_config('watchtower.membership_lifecycle_membership_id', v_membership.id::text, true);
    perform set_config('watchtower.membership_lifecycle_profile_id', v_profile.id::text, true);
    perform set_config('watchtower.membership_lifecycle_auth_user_id', p_old_auth_user_id::text, true);
    perform set_config('watchtower.membership_lifecycle_new_auth_user_id', p_new_auth_user_id::text, true);
    perform set_config('watchtower.membership_lifecycle_invitation_id', v_invitation.id::text, true);
    perform set_config('watchtower.membership_lifecycle_correlation_id', p_correlation_id::text, true);

    begin
      update public.organisation_members om
        set auth_user_id = p_new_auth_user_id,
            updated_at = now()
      where om.id = v_membership.id
        and om.organisation_id = v_invitation.organisation_id
        and om.user_id = v_profile.id
        and om.auth_user_id = p_old_auth_user_id
        and om.status in ('invited', 'invite_expired')
        and om.role = v_invitation.intended_role;

      if not found then
        raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_MEMBERSHIP_STATE: Invited membership could not be remapped safely.'
          using errcode = '23514';
      end if;
    exception
      when others then
        perform set_config('watchtower.membership_lifecycle_operation', '', true);
        perform set_config('watchtower.membership_lifecycle_organisation_id', '', true);
        perform set_config('watchtower.membership_lifecycle_membership_id', '', true);
        perform set_config('watchtower.membership_lifecycle_profile_id', '', true);
        perform set_config('watchtower.membership_lifecycle_auth_user_id', '', true);
        perform set_config('watchtower.membership_lifecycle_new_auth_user_id', '', true);
        perform set_config('watchtower.membership_lifecycle_invitation_id', '', true);
        perform set_config('watchtower.membership_lifecycle_correlation_id', '', true);
        raise;
    end;

    perform set_config('watchtower.membership_lifecycle_operation', '', true);
    perform set_config('watchtower.membership_lifecycle_organisation_id', '', true);
    perform set_config('watchtower.membership_lifecycle_membership_id', '', true);
    perform set_config('watchtower.membership_lifecycle_profile_id', '', true);
    perform set_config('watchtower.membership_lifecycle_auth_user_id', '', true);
    perform set_config('watchtower.membership_lifecycle_new_auth_user_id', '', true);
    perform set_config('watchtower.membership_lifecycle_invitation_id', '', true);
    perform set_config('watchtower.membership_lifecycle_correlation_id', '', true);

    update public.workspace_membership_invitations invitation
      set auth_user_id = p_new_auth_user_id,
          updated_at = now()
    where invitation.id = v_invitation.id
      and invitation.is_current
      and invitation.organisation_id = v_invitation.organisation_id
      and invitation.membership_id = v_membership.id
      and invitation.profile_id = v_profile.id
      and invitation.auth_user_id = p_old_auth_user_id
      and invitation.status in ('pending_delivery', 'sending', 'delivered', 'delivery_failed', 'opened');

    if not found then
      raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_INVITATION_STATE: Invitation could not be remapped safely.'
        using errcode = '23514';
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
    v_invitation.organisation_id,
    v_invitation.id,
    v_invitation.membership_id,
    v_invitation.profile_id,
    p_old_auth_user_id,
    p_new_auth_user_id,
    p_outcome,
    nullif(btrim(p_failure_code), ''),
    case
      when p_failure_message is null then null
      else left(regexp_replace(p_failure_message, 'https?://[^[:space:]]+|[^[:space:]@]+@[^[:space:]@]+|re_[[:alnum:]_-]+', '[redacted]', 'gi'), 240)
    end,
    v_old_has_identity,
    v_new_has_identity,
    auth.uid(),
    p_correlation_id,
    jsonb_build_object(
      'operation', 'record_workspace_invitation_auth_identity_repair',
      'source', 'workspace_invitation_auth_identity_repair',
      'membership_status', v_membership.status,
      'invitation_status', v_invitation.status,
      'profile_uuid_preserved', true,
      'membership_uuid_preserved', true,
      'membership_activated', false,
      'old_auth_user_id', p_old_auth_user_id,
      'new_auth_user_id', p_new_auth_user_id
    )
  )
  returning id into v_repair_id;

  return v_repair_id;
end;
$$;

revoke all on function public.record_workspace_invitation_auth_identity_repair(uuid, uuid, uuid, text, text, text, uuid) from public;
revoke all on function public.record_workspace_invitation_auth_identity_repair(uuid, uuid, uuid, text, text, text, uuid) from authenticated;
grant execute on function public.record_workspace_invitation_auth_identity_repair(uuid, uuid, uuid, text, text, text, uuid) to service_role;

comment on function public.record_workspace_invitation_auth_identity_repair(uuid, uuid, uuid, text, text, text, uuid) is
  'Service-role-only transactional repair recorder. It validates the old placeholder and replacement Auth identities, sets a narrow transaction-local membership guard marker, remaps profile, invited membership and current invitation Auth linkage atomically, and records repair evidence without activating membership.';
