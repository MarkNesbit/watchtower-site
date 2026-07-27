-- WT-WORKSPACE-TEAM-008A-FIX-005 valid Supabase Auth identity provisioning.
-- Historical imported invitees may have an auth.users row without an auth.identities
-- email identity. This migration adds explicit Watchtower-to-Auth linkage and
-- service-role-only repair controls. Supabase Auth Admin remains responsible for
-- creating or updating Auth users; this migration never mutates auth.identities.

alter table public.profiles
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

update public.profiles
set auth_user_id = id
where auth_user_id is null;

create unique index if not exists profiles_auth_user_id_key
  on public.profiles (auth_user_id)
  where auth_user_id is not null;

create index if not exists profiles_auth_user_id_idx
  on public.profiles (auth_user_id)
  where auth_user_id is not null;

comment on column public.profiles.auth_user_id is
  'Explicit Supabase Auth identity for sign-in. profiles.id remains the immutable Watchtower profile UUID and may differ from auth_user_id after invitation Auth repair.';

alter table public.organisation_members
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

update public.organisation_members
set auth_user_id = user_id
where auth_user_id is null;

create index if not exists organisation_members_auth_user_id_idx
  on public.organisation_members (auth_user_id)
  where auth_user_id is not null;

create unique index if not exists organisation_members_organisation_auth_user_id_key
  on public.organisation_members (organisation_id, auth_user_id)
  where auth_user_id is not null;

comment on column public.organisation_members.auth_user_id is
  'Explicit Supabase Auth identity that can activate this membership. organisation_members.user_id remains the immutable Watchtower profile/person UUID.';

create table if not exists public.workspace_invitation_auth_identity_repairs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  invitation_id uuid references public.workspace_membership_invitations(id) on delete set null,
  membership_id uuid references public.organisation_members(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  old_auth_user_id uuid references auth.users(id) on delete set null,
  new_auth_user_id uuid references auth.users(id) on delete set null,
  outcome text not null,
  failure_code text,
  failure_message text,
  old_auth_user_had_email_identity boolean,
  new_auth_user_has_email_identity boolean,
  actor_user_id uuid references auth.users(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workspace_invitation_auth_identity_repairs_outcome_check
    check (outcome in (
      'detected',
      'attempted',
      'skipped_valid',
      'remapped_existing_user',
      'remapped_created_user',
      'failed'
    )),
  constraint workspace_invitation_auth_identity_repairs_failure_message_safe
    check (failure_message is null or failure_message !~* 'https?://|@[[:alnum:]._-]+|re_[[:alnum:]_-]+|token|password|authorization')
);

create index if not exists workspace_invitation_auth_identity_repairs_invitation_idx
  on public.workspace_invitation_auth_identity_repairs (invitation_id, created_at desc);
create index if not exists workspace_invitation_auth_identity_repairs_membership_idx
  on public.workspace_invitation_auth_identity_repairs (membership_id, created_at desc);
create index if not exists workspace_invitation_auth_identity_repairs_correlation_idx
  on public.workspace_invitation_auth_identity_repairs (correlation_id, created_at desc);

alter table public.workspace_invitation_auth_identity_repairs enable row level security;
revoke all on public.workspace_invitation_auth_identity_repairs from public;
revoke all on public.workspace_invitation_auth_identity_repairs from authenticated;
grant select, insert on public.workspace_invitation_auth_identity_repairs to service_role;

comment on table public.workspace_invitation_auth_identity_repairs is
  'Service-role-only audit evidence for WT-008 invitation Auth identity repair. It records UUIDs, outcomes and redacted failure details only.';

create or replace function public.is_active_organisation_member(
  target_organisation_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organisation_members om
    where om.organisation_id = target_organisation_id
      and (
        om.auth_user_id = target_user_id
        or (om.auth_user_id is null and om.user_id = target_user_id)
      )
      and om.status = 'active'
  );
$$;

create or replace function public.has_active_organisation_role(
  target_organisation_id uuid,
  allowed_roles text[],
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organisation_members om
    where om.organisation_id = target_organisation_id
      and (
        om.auth_user_id = target_user_id
        or (om.auth_user_id is null and om.user_id = target_user_id)
      )
      and om.status = 'active'
      and coalesce(
        public.active_internal_role_simulation(target_organisation_id, target_user_id),
        om.role
      ) = any(allowed_roles)
  );
$$;

create or replace function public.has_real_active_organisation_role(
  target_organisation_id uuid,
  allowed_roles text[],
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organisation_members om
    where om.organisation_id = target_organisation_id
      and (
        om.auth_user_id = target_user_id
        or (om.auth_user_id is null and om.user_id = target_user_id)
      )
      and om.status = 'active'
      and om.role = any(allowed_roles)
  );
$$;

create or replace function public.real_active_organisation_role(
  target_organisation_id uuid,
  target_user_id uuid default auth.uid()
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select om.role
  from public.organisation_members om
  where om.organisation_id = target_organisation_id
    and (
      om.auth_user_id = target_user_id
      or (om.auth_user_id is null and om.user_id = target_user_id)
    )
    and om.status = 'active'
  order by om.created_at asc
  limit 1;
$$;

revoke all on function public.is_active_organisation_member(uuid, uuid) from public;
revoke all on function public.has_active_organisation_role(uuid, text[], uuid) from public;
revoke all on function public.has_real_active_organisation_role(uuid, text[], uuid) from public;
revoke all on function public.real_active_organisation_role(uuid, uuid) from public;
grant execute on function public.is_active_organisation_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.has_active_organisation_role(uuid, text[], uuid) to authenticated, service_role;
grant execute on function public.has_real_active_organisation_role(uuid, text[], uuid) to authenticated, service_role;
grant execute on function public.real_active_organisation_role(uuid, uuid) to authenticated, service_role;

create or replace function public.workspace_invitation_identityless_auth_user_report(
  p_organisation_id uuid default null
)
returns table (
  organisation_id uuid,
  profile_id uuid,
  membership_id uuid,
  invitation_id uuid,
  auth_user_id uuid,
  auth_email_domain text,
  membership_status text,
  invitation_status text,
  role text,
  has_email_identity boolean,
  invitation_is_current boolean,
  invitation_created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    invitation.organisation_id,
    invitation.profile_id,
    invitation.membership_id,
    invitation.id,
    invitation.auth_user_id,
    split_part(lower(coalesce(au.email, invitation.auth_email, '')), '@', 2),
    om.status,
    invitation.status,
    om.role,
    exists (
      select 1
      from auth.identities identity
      where identity.user_id = invitation.auth_user_id
        and identity.provider = 'email'
    ) as has_email_identity,
    invitation.is_current,
    invitation.created_at
  from public.workspace_membership_invitations invitation
  join public.organisation_members om
    on om.id = invitation.membership_id
    and om.organisation_id = invitation.organisation_id
  join public.profiles profile
    on profile.id = invitation.profile_id
  join auth.users au
    on au.id = invitation.auth_user_id
  where (p_organisation_id is null or invitation.organisation_id = p_organisation_id)
    and invitation.is_current
    and om.status in ('invited', 'invite_expired')
    and coalesce(au.email, invitation.auth_email) is not null
    and not exists (
      select 1
      from auth.identities identity
      where identity.user_id = invitation.auth_user_id
        and identity.provider = 'email'
    )
  order by invitation.organisation_id, invitation.created_at, invitation.id;
$$;

revoke all on function public.workspace_invitation_identityless_auth_user_report(uuid) from public;
revoke all on function public.workspace_invitation_identityless_auth_user_report(uuid) from authenticated;
grant execute on function public.workspace_invitation_identityless_auth_user_report(uuid) to service_role;

comment on function public.workspace_invitation_identityless_auth_user_report(uuid) is
  'Service-role report for invited members whose current invitation points at auth.users without a Supabase email identity. Returns UUIDs, statuses and email domain only.';

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
  existing_valid_auth_user_id uuid
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
    ) as existing_valid_auth_user_id
  from public.workspace_membership_invitations invitation
  join public.organisation_members om
    on om.id = invitation.membership_id
    and om.organisation_id = invitation.organisation_id
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
  'Service-role-only candidate loader for invitation Auth identity repair. It may return the deterministic auth email for server-side Supabase Admin provisioning.';

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
    from auth.identities identity
    where identity.user_id = p_new_auth_user_id
      and identity.provider = 'email'
  ) into v_new_has_identity;

  if p_outcome in ('remapped_existing_user', 'remapped_created_user', 'skipped_valid') and not v_new_has_identity then
    raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_INVALID: Replacement Auth user does not have a Supabase email identity.'
      using errcode = '23503';
  end if;

  if p_outcome in ('remapped_existing_user', 'remapped_created_user') then
    update public.profiles profile
      set auth_user_id = p_new_auth_user_id,
          updated_at = now()
    where profile.id = v_invitation.profile_id;

    if not found then
      raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_PROFILE: Linked profile was not found.'
        using errcode = '23503';
    end if;

    update public.organisation_members om
      set auth_user_id = p_new_auth_user_id,
          updated_at = now()
    where om.id = v_invitation.membership_id
      and om.organisation_id = v_invitation.organisation_id
      and om.user_id = v_invitation.profile_id
      and om.status in ('invited', 'invite_expired');

    if not found then
      raise exception 'WT_INVITATION_AUTH_IDENTITY_REPAIR_MEMBERSHIP_STATE: Invited membership could not be remapped safely.'
        using errcode = '23514';
    end if;

    update public.workspace_membership_invitations invitation
      set auth_user_id = p_new_auth_user_id,
          updated_at = now()
    where invitation.id = v_invitation.id
      and invitation.is_current
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
      'membership_status', v_membership.status,
      'invitation_status', v_invitation.status,
      'profile_uuid_preserved', true,
      'membership_uuid_preserved', true,
      'membership_activated', false
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
  'Service-role-only transactional repair recorder. It remaps Watchtower profile, membership and current invitation Auth linkage only after the replacement Auth user has a real Supabase email identity.';

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
begin
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

  if v_invitation.status = 'accepted' or v_membership.status = 'active' then
    perform public.record_workspace_membership_audit_event(
      v_invitation.organisation_id,
      v_invitation.membership_id,
      v_invitation.profile_id,
      auth.uid(),
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

  if v_invitation.status not in ('opened', 'delivered') or v_invitation.expires_at <= now() then
    raise exception 'WT_INVITATION_NOT_ACCEPTABLE: Invitation cannot be accepted.' using errcode = '42501';
  end if;

  if auth.uid() is null or auth.uid() <> v_invitation.auth_user_id then
    raise exception 'WT_INVITATION_WRONG_ACCOUNT: This invitation belongs to another account.' using errcode = '42501';
  end if;

  if v_membership.status not in ('invited', 'invite_expired') then
    raise exception 'WT_INVITATION_MEMBERSHIP_STATE: Membership is not awaiting invitation acceptance.' using errcode = '23514';
  end if;

  update public.workspace_membership_invitations as invitation
    set status = 'accepted',
        accepted_at = now(),
        accepted_by = auth.uid(),
        token_hash = null,
        failure_code = null,
        failure_message = null
  where invitation.id = v_invitation.id;

  update public.organisation_members as om
    set status = 'active',
        auth_user_id = v_invitation.auth_user_id,
        accepted_at = now(),
        joined_at = coalesce(om.joined_at, now()),
        updated_by = auth.uid(),
        updated_at = now()
  where om.id = v_invitation.membership_id
    and om.organisation_id = v_invitation.organisation_id
    and om.user_id = v_invitation.profile_id
    and om.role = v_invitation.intended_role
    and om.status in ('invited', 'invite_expired');

  if not found then
    raise exception 'WT_INVITATION_ACTIVATION_FAILED: Membership activation failed.' using errcode = '40001';
  end if;

  perform public.record_workspace_membership_audit_event(
    v_invitation.organisation_id,
    v_invitation.membership_id,
    v_invitation.profile_id,
    auth.uid(),
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
    auth.uid(),
    'workspace_membership_activated',
    'invited',
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

comment on function public.accept_workspace_membership_invitation(text) is
  'Accepts a current delivered/opened invitation for the exact linked Supabase Auth identity, then activates only the existing invited membership while preserving the Watchtower profile UUID.';
