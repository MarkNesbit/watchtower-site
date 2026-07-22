-- WT-WORKSPACE-TEAM-002 membership lifecycle, profile identity fields and audit schema.
-- This is a database foundation only: no UI, CSV parsing, invitation delivery or auth-user creation.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists login_name text,
  add column if not exists contact_email text;

update public.profiles
set contact_email = lower(btrim(email))
where contact_email is null
  and email is not null;

alter table public.profiles
  add constraint profiles_first_name_not_empty
    check (first_name is null or length(btrim(first_name)) > 0),
  add constraint profiles_last_name_not_empty
    check (last_name is null or length(btrim(last_name)) > 0),
  add constraint profiles_login_name_normalised_check
    check (login_name is null or login_name = lower(btrim(login_name))),
  add constraint profiles_login_name_format_check
    check (login_name is null or login_name ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  add constraint profiles_contact_email_normalised_check
    check (contact_email is null or contact_email = lower(btrim(contact_email))),
  add constraint profiles_contact_email_format_check
    check (contact_email is null or contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

create unique index profiles_login_name_normalised_key
  on public.profiles (lower(login_name))
  where login_name is not null;
create index profiles_contact_email_normalised_idx
  on public.profiles (lower(contact_email))
  where contact_email is not null;

comment on column public.profiles.email is
  'Compatibility mirror of auth.users.email. It remains the current authentication email display/search convenience field and is not the future contact-email authority.';
comment on column public.profiles.login_name is
  'Future unique Watchtower login identifier. WT-WORKSPACE-TEAM-002 stores and constrains it but does not add login-name authentication.';
comment on column public.profiles.contact_email is
  'Future contact/notification email distinct from the Supabase Auth email. Duplicate shared-contact behaviour is not enabled globally.';

alter table public.organisation_members
  add column if not exists invitation_expires_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references auth.users(id) on delete set null,
  add column if not exists suspension_reason text,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references auth.users(id) on delete set null,
  add column if not exists deactivation_reason text,
  add column if not exists reactivated_at timestamptz,
  add column if not exists reactivated_by uuid references auth.users(id) on delete set null,
  add column if not exists reactivation_reason text,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

update public.organisation_members
set status = 'deactivated',
    deactivated_at = coalesce(deactivated_at, updated_at, now()),
    deactivation_reason = coalesce(deactivation_reason, 'Migrated from legacy removed membership status.')
where status = 'removed';

alter table public.organisation_members
  drop constraint if exists organisation_members_status_check,
  add constraint organisation_members_status_check
    check (status in ('invited', 'invite_expired', 'active', 'suspended', 'deactivated')),
  add constraint organisation_members_invited_state_check
    check (status not in ('invited', 'invite_expired') or invited_at is not null),
  add constraint organisation_members_invite_expired_state_check
    check (status <> 'invite_expired' or invitation_expires_at is not null),
  add constraint organisation_members_suspended_state_check
    check (status <> 'suspended' or suspended_at is not null),
  add constraint organisation_members_deactivated_state_check
    check (status <> 'deactivated' or deactivated_at is not null),
  add constraint organisation_members_active_after_deactivation_check
    check (
      status <> 'active'
      or deactivated_at is null
      or (reactivated_at is not null and reactivated_at >= deactivated_at)
    ),
  add constraint organisation_members_active_after_suspension_check
    check (
      status <> 'active'
      or suspended_at is null
      or (reactivated_at is not null and reactivated_at >= suspended_at)
    ),
  add constraint organisation_members_reason_length_check
    check (
      (suspension_reason is null or length(btrim(suspension_reason)) > 0)
      and (deactivation_reason is null or length(btrim(deactivation_reason)) > 0)
      and (reactivation_reason is null or length(btrim(reactivation_reason)) > 0)
    );

create index organisation_members_lifecycle_status_idx
  on public.organisation_members (organisation_id, status, updated_at desc);
create index organisation_members_invitation_expiry_idx
  on public.organisation_members (organisation_id, invitation_expires_at)
  where status in ('invited', 'invite_expired');
create index organisation_members_active_owner_idx
  on public.organisation_members (organisation_id, user_id)
  where role = 'owner' and status = 'active';

comment on column public.organisation_members.status is
  'Product-facing membership lifecycle status: invited, invite_expired, active, suspended or deactivated. Legacy removed values are migrated to deactivated.';

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
      and om.user_id = target_user_id
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
    and om.user_id = target_user_id
    and om.status = 'active'
  order by om.created_at asc
  limit 1;
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
  om.reactivated_at
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
  om.invitation_expires_at,
  om.accepted_at,
  om.suspended_at,
  om.deactivated_at,
  om.reactivated_at
from public.organisation_members om
join public.profiles p on p.id = om.user_id
where public.has_real_active_organisation_role(om.organisation_id, array['owner', 'admin']);

comment on view public.workspace_member_directory is
  'Safe same-workspace identity display fields for active workspace users. Contact email and auth email are deliberately excluded.';
comment on view public.workspace_member_admin_directory is
  'Owner/Admin workspace membership administration directory. Exposes contact/auth email for future controlled team administration only.';

create table public.workspace_membership_audit_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  organisation_membership_id uuid references public.organisation_members(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  previous_status text,
  new_status text,
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  reason text,
  source text not null default 'manual',
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  constraint workspace_membership_audit_events_event_type_check
    check (event_type in (
      'membership_invited',
      'invitation_expired',
      'membership_activated',
      'membership_suspended',
      'membership_deactivated',
      'membership_reactivated',
      'profile_identity_corrected',
      'membership_import_proposed',
      'membership_import_applied',
      'membership_import_failed',
      'membership_export_generated',
      'membership_export_superseded'
    )),
  constraint workspace_membership_audit_events_previous_status_check
    check (previous_status is null or previous_status in ('invited', 'invite_expired', 'active', 'suspended', 'deactivated')),
  constraint workspace_membership_audit_events_new_status_check
    check (new_status is null or new_status in ('invited', 'invite_expired', 'active', 'suspended', 'deactivated')),
  constraint workspace_membership_audit_events_values_object_check
    check (jsonb_typeof(previous_values) = 'object' and jsonb_typeof(new_values) = 'object'),
  constraint workspace_membership_audit_events_reason_not_empty
    check (reason is null or length(btrim(reason)) > 0),
  constraint workspace_membership_audit_events_source_not_empty
    check (length(btrim(source)) > 0)
);

create index workspace_membership_audit_events_org_created_idx
  on public.workspace_membership_audit_events (organisation_id, created_at desc);
create index workspace_membership_audit_events_membership_idx
  on public.workspace_membership_audit_events (organisation_membership_id, created_at desc);
create index workspace_membership_audit_events_correlation_idx
  on public.workspace_membership_audit_events (correlation_id, created_at desc);

create or replace function public.prevent_workspace_membership_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception 'Workspace membership audit events are append-only.' using errcode = '42501';
end;
$$;

create trigger prevent_workspace_membership_audit_update
  before update on public.workspace_membership_audit_events
  for each row execute function public.prevent_workspace_membership_audit_mutation();
create trigger prevent_workspace_membership_audit_delete
  before delete on public.workspace_membership_audit_events
  for each row execute function public.prevent_workspace_membership_audit_mutation();

create table public.workspace_membership_export_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  exported_at timestamptz not null default now(),
  membership_snapshot_version bigint not null,
  editing_mode text not null default 'none',
  checkout_expires_at timestamptz,
  superseded_at timestamptz,
  superseded_by_export_id uuid references public.workspace_membership_export_runs(id) on delete set null,
  takeover_of_export_id uuid references public.workspace_membership_export_runs(id) on delete set null,
  status text not null default 'generated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_membership_export_runs_snapshot_positive
    check (membership_snapshot_version > 0),
  constraint workspace_membership_export_runs_editing_mode_check
    check (editing_mode in ('none', 'checked_out')),
  constraint workspace_membership_export_runs_status_check
    check (status in ('generated', 'checked_out', 'superseded', 'expired', 'cancelled')),
  constraint workspace_membership_export_runs_checkout_check
    check (editing_mode <> 'checked_out' or checkout_expires_at is not null)
);

create table public.workspace_membership_import_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  source_export_id uuid references public.workspace_membership_export_runs(id) on delete set null,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  source_snapshot_version bigint,
  status text not null default 'uploaded',
  comparison_completed_at timestamptz,
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  failure_message text,
  failure_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_membership_import_runs_snapshot_positive
    check (source_snapshot_version is null or source_snapshot_version > 0),
  constraint workspace_membership_import_runs_status_check
    check (status in ('uploaded', 'validated', 'comparison_completed', 'approval_pending', 'applied', 'failed', 'superseded', 'cancelled')),
  constraint workspace_membership_import_runs_failure_message_not_empty
    check (failure_message is null or length(btrim(failure_message)) > 0),
  constraint workspace_membership_import_runs_failure_details_object
    check (jsonb_typeof(failure_details) = 'object'),
  constraint workspace_membership_import_runs_applied_check
    check (status <> 'applied' or applied_at is not null)
);

alter table public.workspace_membership_import_runs
  add constraint workspace_membership_import_runs_id_organisation_key
  unique (id, organisation_id);

create table public.workspace_membership_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.workspace_membership_import_runs(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  source_row_number integer not null,
  supplied_membership_id uuid,
  proposed_change_type text not null,
  parsed_values jsonb not null default '{}'::jsonb,
  validation_state text not null default 'pending',
  validation_messages jsonb not null default '[]'::jsonb,
  current_values jsonb not null default '{}'::jsonb,
  proposed_values jsonb not null default '{}'::jsonb,
  apply_status text not null default 'not_applied',
  apply_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_membership_import_rows_import_org_fk
    foreign key (import_run_id, organisation_id)
    references public.workspace_membership_import_runs(id, organisation_id) on delete cascade,
  constraint workspace_membership_import_rows_source_row_positive
    check (source_row_number > 0),
  constraint workspace_membership_import_rows_change_type_check
    check (proposed_change_type in ('add', 'update_profile', 'deactivate', 'reactivate', 'suspend', 'expire_invitation', 'activate', 'no_change', 'invalid')),
  constraint workspace_membership_import_rows_validation_state_check
    check (validation_state in ('pending', 'valid', 'warning', 'error')),
  constraint workspace_membership_import_rows_apply_status_check
    check (apply_status in ('not_applied', 'applied', 'failed', 'skipped')),
  constraint workspace_membership_import_rows_json_shape_check
    check (
      jsonb_typeof(parsed_values) = 'object'
      and jsonb_typeof(validation_messages) = 'array'
      and jsonb_typeof(current_values) = 'object'
      and jsonb_typeof(proposed_values) = 'object'
    ),
  constraint workspace_membership_import_rows_apply_message_not_empty
    check (apply_message is null or length(btrim(apply_message)) > 0)
);

alter table public.workspace_membership_import_rows
  add constraint workspace_membership_import_rows_id_import_org_key
  unique (id, import_run_id, organisation_id);

create table public.workspace_membership_change_decisions (
  id uuid primary key default gen_random_uuid(),
  import_row_id uuid not null references public.workspace_membership_import_rows(id) on delete cascade,
  import_run_id uuid not null,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  decision text not null default 'pending',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_membership_change_decisions_row_scope_fk
    foreign key (import_row_id, import_run_id, organisation_id)
    references public.workspace_membership_import_rows(id, import_run_id, organisation_id) on delete cascade,
  constraint workspace_membership_change_decisions_decision_check
    check (decision in ('pending', 'approved', 'rejected', 'skipped')),
  constraint workspace_membership_change_decisions_decided_check
    check ((decision = 'pending' and decided_at is null) or (decision <> 'pending' and decided_at is not null)),
  constraint workspace_membership_change_decisions_reason_not_empty
    check (reason is null or length(btrim(reason)) > 0)
);

create index workspace_membership_export_runs_org_status_idx
  on public.workspace_membership_export_runs (organisation_id, status, exported_at desc);
create index workspace_membership_import_runs_org_status_idx
  on public.workspace_membership_import_runs (organisation_id, status, uploaded_at desc);
create index workspace_membership_import_rows_run_row_idx
  on public.workspace_membership_import_rows (import_run_id, source_row_number);
create index workspace_membership_change_decisions_run_idx
  on public.workspace_membership_change_decisions (import_run_id, decision);

create trigger set_workspace_membership_export_runs_updated_at
  before update on public.workspace_membership_export_runs
  for each row execute function public.set_updated_at();
create trigger set_workspace_membership_import_runs_updated_at
  before update on public.workspace_membership_import_runs
  for each row execute function public.set_updated_at();
create trigger set_workspace_membership_import_rows_updated_at
  before update on public.workspace_membership_import_rows
  for each row execute function public.set_updated_at();
create trigger set_workspace_membership_change_decisions_updated_at
  before update on public.workspace_membership_change_decisions
  for each row execute function public.set_updated_at();

create or replace function public.workspace_membership_json(public.organisation_members)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', $1.id,
    'organisation_id', $1.organisation_id,
    'user_id', $1.user_id,
    'role', $1.role,
    'status', $1.status,
    'invited_at', $1.invited_at,
    'invitation_expires_at', $1.invitation_expires_at,
    'accepted_at', $1.accepted_at,
    'suspended_at', $1.suspended_at,
    'deactivated_at', $1.deactivated_at,
    'reactivated_at', $1.reactivated_at
  );
$$;

create or replace function public.record_workspace_membership_audit_event(
  target_organisation_id uuid,
  target_membership_id uuid,
  target_user_id uuid,
  actor_user_id uuid,
  event_name text,
  previous_status text,
  new_status text,
  previous_values jsonb default '{}'::jsonb,
  new_values jsonb default '{}'::jsonb,
  event_reason text default null,
  event_source text default 'manual',
  event_correlation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  audit_id uuid;
begin
  insert into public.workspace_membership_audit_events (
    organisation_id,
    organisation_membership_id,
    target_user_id,
    actor_user_id,
    event_type,
    previous_status,
    new_status,
    previous_values,
    new_values,
    reason,
    source,
    correlation_id
  )
  values (
    target_organisation_id,
    target_membership_id,
    target_user_id,
    actor_user_id,
    event_name,
    previous_status,
    new_status,
    coalesce(previous_values, '{}'::jsonb),
    coalesce(new_values, '{}'::jsonb),
    nullif(btrim(event_reason), ''),
    coalesce(nullif(btrim(event_source), ''), 'manual'),
    coalesce(event_correlation_id, gen_random_uuid())
  )
  returning id into audit_id;

  return audit_id;
end;
$$;

create or replace function public.workspace_membership_require_admin_actor(target_organisation_id uuid)
returns table(actor_user_id uuid, actor_role text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  actor_user_id := auth.uid();
  if actor_user_id is null then
    raise exception 'WT_MEMBERSHIP_PERMISSION_DENIED: Authenticated user is required.' using errcode = '42501';
  end if;

  select om.role
    into actor_role
  from public.organisation_members om
  where om.organisation_id = target_organisation_id
    and om.user_id = actor_user_id
    and om.status = 'active'
  limit 1;

  if actor_role not in ('owner', 'admin') then
    raise exception 'WT_MEMBERSHIP_PERMISSION_DENIED: Only active Owners and Admins can manage workspace membership.' using errcode = '42501';
  end if;

  return next;
end;
$$;

create or replace function public.workspace_membership_assert_actor_can_change_target(
  actor_role text,
  actor_user_id uuid,
  target_membership public.organisation_members,
  lifecycle_operation text
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if lifecycle_operation in ('deactivate', 'suspend') and target_membership.user_id = actor_user_id then
    raise exception 'WT_MEMBERSHIP_SELF_CHANGE_DENIED: Users cannot deactivate or suspend their own workspace membership through membership administration.'
      using errcode = '42501';
  end if;

  if actor_role = 'admin' and target_membership.role in ('owner', 'admin') then
    raise exception 'WT_MEMBERSHIP_PROTECTED_ROLE: Admins cannot alter Owner or Admin memberships in this slice.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.workspace_membership_assert_not_final_owner(target_membership public.organisation_members)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  other_owner_count integer;
begin
  if target_membership.role <> 'owner' or target_membership.status <> 'active' then
    return;
  end if;

  select count(*)
    into other_owner_count
  from public.organisation_members om
  where om.organisation_id = target_membership.organisation_id
    and om.id <> target_membership.id
    and om.role = 'owner'
    and om.status = 'active';

  if other_owner_count = 0 then
    raise exception 'WT_MEMBERSHIP_FINAL_OWNER: The final active Owner cannot be deactivated, suspended or demoted.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_workspace_membership_invitation(
  target_organisation_id uuid,
  target_user_id uuid,
  target_role text default 'viewer',
  target_invitation_expires_at timestamptz default null,
  transition_reason text default null,
  transition_source text default 'manual',
  transition_correlation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor record;
  new_membership public.organisation_members;
begin
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);
  select * into actor from public.workspace_membership_require_admin_actor(target_organisation_id);

  if target_role not in ('admin', 'member', 'viewer') then
    raise exception 'WT_MEMBERSHIP_INVALID_ROLE: Invited role must be admin, member or viewer.' using errcode = '23514';
  end if;
  if actor.actor_role = 'admin' and target_role = 'admin' then
    raise exception 'WT_MEMBERSHIP_PROTECTED_ROLE: Admins cannot create Admin memberships in this slice.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target_user_id) then
    raise exception 'WT_MEMBERSHIP_TARGET_PROFILE: Target profile must exist before membership invitation.' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.organisation_members om
    where om.organisation_id = target_organisation_id
      and om.user_id = target_user_id
  ) then
    raise exception 'WT_MEMBERSHIP_EXISTS: Target user already has a membership in this workspace.' using errcode = '23505';
  end if;

  insert into public.organisation_members (
    organisation_id,
    user_id,
    role,
    status,
    invited_by,
    invited_at,
    invitation_expires_at,
    joined_at,
    updated_by
  )
  values (
    target_organisation_id,
    target_user_id,
    target_role,
    'invited',
    actor.actor_user_id,
    now(),
    target_invitation_expires_at,
    null,
    actor.actor_user_id
  )
  returning * into new_membership;

  perform public.record_workspace_membership_audit_event(
    target_organisation_id,
    new_membership.id,
    target_user_id,
    actor.actor_user_id,
    'membership_invited',
    null,
    'invited',
    '{}'::jsonb,
    public.workspace_membership_json(new_membership),
    transition_reason,
    transition_source,
    transition_correlation_id
  );

  return new_membership.id;
end;
$$;

create or replace function public.expire_workspace_membership_invitation(
  target_membership_id uuid,
  transition_reason text default null,
  transition_source text default 'manual',
  transition_correlation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor record;
  current_membership public.organisation_members;
  updated_membership public.organisation_members;
begin
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);
  select * into current_membership
  from public.organisation_members
  where id = target_membership_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_NOT_FOUND: Membership not found.' using errcode = '42501';
  end if;
  select * into actor from public.workspace_membership_require_admin_actor(current_membership.organisation_id);
  perform public.workspace_membership_assert_actor_can_change_target(actor.actor_role, actor.actor_user_id, current_membership, 'expire_invitation');

  if current_membership.status <> 'invited' then
    raise exception 'WT_MEMBERSHIP_INVALID_TRANSITION: Only invited memberships can expire.' using errcode = '23514';
  end if;

  update public.organisation_members
    set status = 'invite_expired',
        invitation_expires_at = coalesce(invitation_expires_at, now()),
        updated_by = actor.actor_user_id
  where id = current_membership.id
  returning * into updated_membership;

  perform public.record_workspace_membership_audit_event(
    updated_membership.organisation_id,
    updated_membership.id,
    updated_membership.user_id,
    actor.actor_user_id,
    'invitation_expired',
    current_membership.status,
    updated_membership.status,
    public.workspace_membership_json(current_membership),
    public.workspace_membership_json(updated_membership),
    transition_reason,
    transition_source,
    transition_correlation_id
  );

  return updated_membership.id;
end;
$$;

create or replace function public.activate_workspace_membership(
  target_membership_id uuid,
  transition_reason text default null,
  transition_source text default 'manual',
  transition_correlation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor record;
  current_membership public.organisation_members;
  updated_membership public.organisation_members;
begin
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);
  select * into current_membership
  from public.organisation_members
  where id = target_membership_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_NOT_FOUND: Membership not found.' using errcode = '42501';
  end if;
  select * into actor from public.workspace_membership_require_admin_actor(current_membership.organisation_id);
  perform public.workspace_membership_assert_actor_can_change_target(actor.actor_role, actor.actor_user_id, current_membership, 'activate');

  if current_membership.status not in ('invited', 'invite_expired') then
    raise exception 'WT_MEMBERSHIP_INVALID_TRANSITION: Only invited or expired-invitation memberships can be activated.' using errcode = '23514';
  end if;

  update public.organisation_members
    set status = 'active',
        accepted_at = coalesce(accepted_at, now()),
        joined_at = coalesce(joined_at, now()),
        updated_by = actor.actor_user_id
  where id = current_membership.id
  returning * into updated_membership;

  perform public.record_workspace_membership_audit_event(
    updated_membership.organisation_id,
    updated_membership.id,
    updated_membership.user_id,
    actor.actor_user_id,
    'membership_activated',
    current_membership.status,
    updated_membership.status,
    public.workspace_membership_json(current_membership),
    public.workspace_membership_json(updated_membership),
    transition_reason,
    transition_source,
    transition_correlation_id
  );

  return updated_membership.id;
end;
$$;

create or replace function public.suspend_workspace_membership(
  target_membership_id uuid,
  transition_reason text,
  transition_source text default 'manual',
  transition_correlation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor record;
  current_membership public.organisation_members;
  updated_membership public.organisation_members;
begin
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);
  select * into current_membership
  from public.organisation_members
  where id = target_membership_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_NOT_FOUND: Membership not found.' using errcode = '42501';
  end if;
  select * into actor from public.workspace_membership_require_admin_actor(current_membership.organisation_id);
  perform public.workspace_membership_assert_actor_can_change_target(actor.actor_role, actor.actor_user_id, current_membership, 'suspend');
  perform public.workspace_membership_assert_not_final_owner(current_membership);

  if current_membership.status <> 'active' then
    raise exception 'WT_MEMBERSHIP_INVALID_TRANSITION: Only active memberships can be suspended.' using errcode = '23514';
  end if;

  update public.organisation_members
    set status = 'suspended',
        suspended_at = now(),
        suspended_by = actor.actor_user_id,
        suspension_reason = nullif(btrim(transition_reason), ''),
        updated_by = actor.actor_user_id
  where id = current_membership.id
  returning * into updated_membership;

  perform public.record_workspace_membership_audit_event(
    updated_membership.organisation_id,
    updated_membership.id,
    updated_membership.user_id,
    actor.actor_user_id,
    'membership_suspended',
    current_membership.status,
    updated_membership.status,
    public.workspace_membership_json(current_membership),
    public.workspace_membership_json(updated_membership),
    transition_reason,
    transition_source,
    transition_correlation_id
  );

  return updated_membership.id;
end;
$$;

create or replace function public.deactivate_workspace_membership(
  target_membership_id uuid,
  transition_reason text,
  transition_source text default 'manual',
  transition_correlation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor record;
  current_membership public.organisation_members;
  updated_membership public.organisation_members;
begin
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);
  select * into current_membership
  from public.organisation_members
  where id = target_membership_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_NOT_FOUND: Membership not found.' using errcode = '42501';
  end if;
  select * into actor from public.workspace_membership_require_admin_actor(current_membership.organisation_id);
  perform public.workspace_membership_assert_actor_can_change_target(actor.actor_role, actor.actor_user_id, current_membership, 'deactivate');
  perform public.workspace_membership_assert_not_final_owner(current_membership);

  if current_membership.status = 'deactivated' then
    raise exception 'WT_MEMBERSHIP_INVALID_TRANSITION: Membership is already deactivated.' using errcode = '23514';
  end if;

  update public.organisation_members
    set status = 'deactivated',
        deactivated_at = now(),
        deactivated_by = actor.actor_user_id,
        deactivation_reason = nullif(btrim(transition_reason), ''),
        updated_by = actor.actor_user_id
  where id = current_membership.id
  returning * into updated_membership;

  perform public.record_workspace_membership_audit_event(
    updated_membership.organisation_id,
    updated_membership.id,
    updated_membership.user_id,
    actor.actor_user_id,
    'membership_deactivated',
    current_membership.status,
    updated_membership.status,
    public.workspace_membership_json(current_membership),
    public.workspace_membership_json(updated_membership),
    transition_reason,
    transition_source,
    transition_correlation_id
  );

  return updated_membership.id;
end;
$$;

create or replace function public.reactivate_workspace_membership(
  target_membership_id uuid,
  transition_reason text default null,
  transition_source text default 'manual',
  transition_correlation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor record;
  current_membership public.organisation_members;
  updated_membership public.organisation_members;
begin
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);
  select * into current_membership
  from public.organisation_members
  where id = target_membership_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_NOT_FOUND: Membership not found.' using errcode = '42501';
  end if;
  select * into actor from public.workspace_membership_require_admin_actor(current_membership.organisation_id);
  perform public.workspace_membership_assert_actor_can_change_target(actor.actor_role, actor.actor_user_id, current_membership, 'reactivate');

  if current_membership.status not in ('deactivated', 'suspended') then
    raise exception 'WT_MEMBERSHIP_INVALID_TRANSITION: Only deactivated or suspended memberships can be reactivated.' using errcode = '23514';
  end if;

  update public.organisation_members
    set status = 'active',
        reactivated_at = now(),
        reactivated_by = actor.actor_user_id,
        reactivation_reason = nullif(btrim(transition_reason), ''),
        joined_at = coalesce(joined_at, now()),
        accepted_at = coalesce(accepted_at, now()),
        updated_by = actor.actor_user_id
  where id = current_membership.id
  returning * into updated_membership;

  perform public.record_workspace_membership_audit_event(
    updated_membership.organisation_id,
    updated_membership.id,
    updated_membership.user_id,
    actor.actor_user_id,
    'membership_reactivated',
    current_membership.status,
    updated_membership.status,
    public.workspace_membership_json(current_membership),
    public.workspace_membership_json(updated_membership),
    transition_reason,
    transition_source,
    transition_correlation_id
  );

  return updated_membership.id;
end;
$$;

create or replace function public.correct_workspace_member_profile_identity(
  target_membership_id uuid,
  new_first_name text default null,
  new_last_name text default null,
  new_display_name text default null,
  new_login_name text default null,
  new_contact_email text default null,
  transition_reason text default null,
  transition_source text default 'manual',
  transition_correlation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor record;
  target_membership public.organisation_members;
  before_profile public.profiles;
  after_profile public.profiles;
begin
  perform set_config('watchtower.membership_lifecycle_rpc', 'true', true);
  select * into target_membership
  from public.organisation_members
  where id = target_membership_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_NOT_FOUND: Membership not found.' using errcode = '42501';
  end if;
  select * into actor from public.workspace_membership_require_admin_actor(target_membership.organisation_id);
  perform public.workspace_membership_assert_actor_can_change_target(actor.actor_role, actor.actor_user_id, target_membership, 'correct_profile');

  select * into before_profile
  from public.profiles
  where id = target_membership.user_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_TARGET_PROFILE: Target profile does not exist.' using errcode = '23503';
  end if;

  update public.profiles
    set first_name = coalesce(nullif(btrim(new_first_name), ''), first_name),
        last_name = coalesce(nullif(btrim(new_last_name), ''), last_name),
        display_name = coalesce(nullif(btrim(new_display_name), ''), display_name),
        login_name = coalesce(lower(nullif(btrim(new_login_name), '')), login_name),
        contact_email = coalesce(lower(nullif(btrim(new_contact_email), '')), contact_email),
        updated_by = actor.actor_user_id
  where id = before_profile.id
  returning * into after_profile;

  perform public.record_workspace_membership_audit_event(
    target_membership.organisation_id,
    target_membership.id,
    target_membership.user_id,
    actor.actor_user_id,
    'profile_identity_corrected',
    target_membership.status,
    target_membership.status,
    jsonb_build_object(
      'first_name', before_profile.first_name,
      'last_name', before_profile.last_name,
      'display_name', before_profile.display_name,
      'login_name', before_profile.login_name,
      'contact_email', before_profile.contact_email
    ),
    jsonb_build_object(
      'first_name', after_profile.first_name,
      'last_name', after_profile.last_name,
      'display_name', after_profile.display_name,
      'login_name', after_profile.login_name,
      'contact_email', after_profile.contact_email
    ),
    transition_reason,
    transition_source,
    transition_correlation_id
  );

  return after_profile.id;
end;
$$;

create or replace function public.prevent_unsafe_workspace_membership_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  lifecycle_rpc boolean := coalesce(current_setting('watchtower.membership_lifecycle_rpc', true), '') = 'true';
begin
  if old.organisation_id is distinct from new.organisation_id
     or old.user_id is distinct from new.user_id
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

drop trigger if exists prevent_unsafe_workspace_membership_update on public.organisation_members;
create trigger prevent_unsafe_workspace_membership_update
  before update on public.organisation_members
  for each row execute function public.prevent_unsafe_workspace_membership_update();

alter table public.workspace_membership_audit_events enable row level security;
alter table public.workspace_membership_export_runs enable row level security;
alter table public.workspace_membership_import_runs enable row level security;
alter table public.workspace_membership_import_rows enable row level security;
alter table public.workspace_membership_change_decisions enable row level security;

create policy "Owners and admins can read workspace membership audit events"
  on public.workspace_membership_audit_events for select
  to authenticated
  using (public.has_real_active_organisation_role(workspace_membership_audit_events.organisation_id, array['owner', 'admin']));

create policy "Owners and admins can read workspace membership export runs"
  on public.workspace_membership_export_runs for select
  to authenticated
  using (public.has_real_active_organisation_role(workspace_membership_export_runs.organisation_id, array['owner', 'admin']));
create policy "Owners and admins can create workspace membership export runs"
  on public.workspace_membership_export_runs for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and public.has_real_active_organisation_role(workspace_membership_export_runs.organisation_id, array['owner', 'admin'])
  );
create policy "Owners and admins can update workspace membership export runs"
  on public.workspace_membership_export_runs for update
  to authenticated
  using (public.has_real_active_organisation_role(workspace_membership_export_runs.organisation_id, array['owner', 'admin']))
  with check (public.has_real_active_organisation_role(workspace_membership_export_runs.organisation_id, array['owner', 'admin']));

create policy "Owners and admins can read workspace membership import runs"
  on public.workspace_membership_import_runs for select
  to authenticated
  using (public.has_real_active_organisation_role(workspace_membership_import_runs.organisation_id, array['owner', 'admin']));
create policy "Owners and admins can create workspace membership import runs"
  on public.workspace_membership_import_runs for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.has_real_active_organisation_role(workspace_membership_import_runs.organisation_id, array['owner', 'admin'])
  );
create policy "Owners and admins can update workspace membership import runs"
  on public.workspace_membership_import_runs for update
  to authenticated
  using (public.has_real_active_organisation_role(workspace_membership_import_runs.organisation_id, array['owner', 'admin']))
  with check (public.has_real_active_organisation_role(workspace_membership_import_runs.organisation_id, array['owner', 'admin']));

create policy "Owners and admins can read workspace membership import rows"
  on public.workspace_membership_import_rows for select
  to authenticated
  using (public.has_real_active_organisation_role(workspace_membership_import_rows.organisation_id, array['owner', 'admin']));
create policy "Owners and admins can create workspace membership import rows"
  on public.workspace_membership_import_rows for insert
  to authenticated
  with check (public.has_real_active_organisation_role(workspace_membership_import_rows.organisation_id, array['owner', 'admin']));
create policy "Owners and admins can update workspace membership import rows"
  on public.workspace_membership_import_rows for update
  to authenticated
  using (public.has_real_active_organisation_role(workspace_membership_import_rows.organisation_id, array['owner', 'admin']))
  with check (public.has_real_active_organisation_role(workspace_membership_import_rows.organisation_id, array['owner', 'admin']));

create policy "Owners and admins can read workspace membership change decisions"
  on public.workspace_membership_change_decisions for select
  to authenticated
  using (public.has_real_active_organisation_role(workspace_membership_change_decisions.organisation_id, array['owner', 'admin']));
create policy "Owners and admins can create workspace membership change decisions"
  on public.workspace_membership_change_decisions for insert
  to authenticated
  with check (public.has_real_active_organisation_role(workspace_membership_change_decisions.organisation_id, array['owner', 'admin']));
create policy "Owners and admins can update workspace membership change decisions"
  on public.workspace_membership_change_decisions for update
  to authenticated
  using (public.has_real_active_organisation_role(workspace_membership_change_decisions.organisation_id, array['owner', 'admin']))
  with check (public.has_real_active_organisation_role(workspace_membership_change_decisions.organisation_id, array['owner', 'admin']));

revoke update (
  role,
  status,
  invited_by,
  invited_at,
  joined_at,
  updated_at
) on public.organisation_members from authenticated;

grant select on public.workspace_member_directory to authenticated;
grant select on public.workspace_member_admin_directory to authenticated;
grant select on public.workspace_membership_audit_events to authenticated;
grant select, insert, update on public.workspace_membership_export_runs to authenticated;
grant select, insert, update on public.workspace_membership_import_runs to authenticated;
grant select, insert, update on public.workspace_membership_import_rows to authenticated;
grant select, insert, update on public.workspace_membership_change_decisions to authenticated;

grant all privileges on table
  public.workspace_membership_audit_events,
  public.workspace_membership_export_runs,
  public.workspace_membership_import_runs,
  public.workspace_membership_import_rows,
  public.workspace_membership_change_decisions
to service_role;

grant all privileges on public.workspace_member_directory to service_role;
grant all privileges on public.workspace_member_admin_directory to service_role;

revoke all on function public.has_real_active_organisation_role(uuid, text[], uuid) from public;
revoke all on function public.real_active_organisation_role(uuid, uuid) from public;
revoke all on function public.prevent_workspace_membership_audit_mutation() from public;
revoke all on function public.workspace_membership_json(public.organisation_members) from public;
revoke all on function public.record_workspace_membership_audit_event(uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text, uuid) from public;
revoke all on function public.workspace_membership_require_admin_actor(uuid) from public;
revoke all on function public.workspace_membership_assert_actor_can_change_target(text, uuid, public.organisation_members, text) from public;
revoke all on function public.workspace_membership_assert_not_final_owner(public.organisation_members) from public;
revoke all on function public.prevent_unsafe_workspace_membership_update() from public;
revoke all on function public.create_workspace_membership_invitation(uuid, uuid, text, timestamptz, text, text, uuid) from public;
revoke all on function public.expire_workspace_membership_invitation(uuid, text, text, uuid) from public;
revoke all on function public.activate_workspace_membership(uuid, text, text, uuid) from public;
revoke all on function public.suspend_workspace_membership(uuid, text, text, uuid) from public;
revoke all on function public.deactivate_workspace_membership(uuid, text, text, uuid) from public;
revoke all on function public.reactivate_workspace_membership(uuid, text, text, uuid) from public;
revoke all on function public.correct_workspace_member_profile_identity(uuid, text, text, text, text, text, text, text, uuid) from public;

grant execute on function public.has_real_active_organisation_role(uuid, text[], uuid) to authenticated, service_role;
grant execute on function public.real_active_organisation_role(uuid, uuid) to authenticated, service_role;
grant execute on function public.create_workspace_membership_invitation(uuid, uuid, text, timestamptz, text, text, uuid) to authenticated, service_role;
grant execute on function public.expire_workspace_membership_invitation(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.activate_workspace_membership(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.suspend_workspace_membership(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.deactivate_workspace_membership(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.reactivate_workspace_membership(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.correct_workspace_member_profile_identity(uuid, text, text, text, text, text, text, text, uuid) to authenticated, service_role;

grant execute on function public.prevent_workspace_membership_audit_mutation() to service_role;
grant execute on function public.workspace_membership_json(public.organisation_members) to service_role;
grant execute on function public.record_workspace_membership_audit_event(uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, text, uuid) to service_role;
grant execute on function public.workspace_membership_require_admin_actor(uuid) to service_role;
grant execute on function public.workspace_membership_assert_actor_can_change_target(text, uuid, public.organisation_members, text) to service_role;
grant execute on function public.workspace_membership_assert_not_final_owner(public.organisation_members) to service_role;
grant execute on function public.prevent_unsafe_workspace_membership_update() to service_role;
