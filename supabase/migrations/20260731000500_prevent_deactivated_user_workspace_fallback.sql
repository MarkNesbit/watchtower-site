-- WT-WORKSPACE-TEAM-009B-FIX-001 prevent fallback workspace creation for
-- previously accepted or invited users whose active workspace access has ended.

create or replace function public.complete_verified_user_onboarding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  derived_display_name text;
  derived_login_name text;
  derived_first_name text;
  derived_last_name text;
  workspace_name text;
  workspace_id uuid;
  existing_membership_profile_id uuid;
  has_membership_lifecycle boolean := false;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  select om.user_id
    into existing_membership_profile_id
  from public.organisation_members om
  where om.auth_user_id = new.id
  order by
    case om.status
      when 'active' then 0
      when 'invited' then 1
      when 'invite_expired' then 2
      when 'suspended' then 3
      when 'deactivated' then 4
      when 'removed' then 5
      else 6
    end,
    om.joined_at asc nulls last,
    om.accepted_at asc nulls last,
    om.created_at asc
  limit 1;

  select exists (
    select 1
    from public.organisation_members om
    where om.auth_user_id = new.id
       or om.user_id = new.id
  )
    into has_membership_lifecycle;

  if existing_membership_profile_id is not null and existing_membership_profile_id <> new.id then
    return new;
  end if;

  derived_display_name := public.derive_display_name_from_email(new.email);
  derived_login_name := public.workspace_profile_next_login_name(derived_display_name, new.id);

  select name_parts.derived_first_name, name_parts.derived_last_name
    into derived_first_name, derived_last_name
  from public.workspace_profile_safe_name_parts(derived_display_name) as name_parts;

  workspace_name := derived_display_name || ' Workspace';

  insert into public.profiles (
    id,
    email,
    display_name,
    first_name,
    last_name,
    login_name,
    contact_email,
    created_by,
    updated_by
  )
  values (
    new.id,
    new.email,
    derived_display_name,
    derived_first_name,
    derived_last_name,
    derived_login_name,
    lower(nullif(btrim(new.email), '')),
    new.id,
    new.id
  )
  on conflict (id) do update
    set email = excluded.email,
        contact_email = coalesce(nullif(btrim(public.profiles.contact_email), ''), excluded.contact_email),
        login_name = coalesce(nullif(btrim(public.profiles.login_name), ''), excluded.login_name),
        first_name = coalesce(nullif(btrim(public.profiles.first_name), ''), excluded.first_name),
        last_name = coalesce(nullif(btrim(public.profiles.last_name), ''), excluded.last_name),
        updated_by = excluded.updated_by;

  if has_membership_lifecycle then
    return new;
  end if;

  select organisations.id
    into workspace_id
  from public.organisations
  where organisations.created_by = new.id
    and organisations.type = 'personal'
    and organisations.deleted_at is null
  order by organisations.created_at asc
  limit 1;

  if workspace_id is null then
    insert into public.organisations (name, slug, type, created_by)
    values (workspace_name, public.unique_workspace_slug(workspace_name), 'personal', new.id)
    returning id into workspace_id;
  end if;

  insert into public.organisation_members (organisation_id, user_id, role, status, joined_at)
  values (workspace_id, new.id, 'owner', 'active', now())
  on conflict (organisation_id, user_id) do update
    set role = 'owner',
        status = 'active',
        joined_at = coalesce(public.organisation_members.joined_at, excluded.joined_at);

  insert into public.organisation_settings (organisation_id)
  values (workspace_id)
  on conflict (organisation_id) do nothing;

  insert into public.audit_log (organisation_id, actor_user_id, action, entity_type, entity_id, new_values)
  select null, new.id, 'user.registered', 'profile', new.id, jsonb_build_object(
    'email', new.email,
    'display_name', derived_display_name,
    'login_name', derived_login_name,
    'contact_email', lower(nullif(btrim(new.email), ''))
  )
  where not exists (
    select 1 from public.audit_log
    where actor_user_id = new.id
      and action = 'user.registered'
      and entity_type = 'profile'
      and entity_id = new.id
      and organisation_id is null
  );

  insert into public.audit_log (organisation_id, actor_user_id, action, entity_type, entity_id, new_values)
  select null, new.id, 'user.email_verified', 'profile', new.id, jsonb_build_object('email_confirmed_at', new.email_confirmed_at)
  where not exists (
    select 1 from public.audit_log
    where actor_user_id = new.id
      and action = 'user.email_verified'
      and entity_type = 'profile'
      and entity_id = new.id
      and organisation_id is null
  );

  insert into public.audit_log (organisation_id, actor_user_id, action, entity_type, entity_id, new_values)
  select workspace_id, new.id, 'workspace.created', 'organisation', workspace_id, jsonb_build_object('name', workspace_name, 'type', 'personal')
  where not exists (
    select 1 from public.audit_log
    where organisation_id = workspace_id
      and actor_user_id = new.id
      and action = 'workspace.created'
      and entity_type = 'organisation'
      and entity_id = workspace_id
  );

  insert into public.audit_log (organisation_id, actor_user_id, action, entity_type, entity_id, new_values)
  select workspace_id, new.id, 'member.joined', 'member', new.id, jsonb_build_object('role', 'owner', 'status', 'active')
  where not exists (
    select 1 from public.audit_log
    where organisation_id = workspace_id
      and actor_user_id = new.id
      and action = 'member.joined'
      and entity_type = 'member'
      and entity_id = new.id
  );

  return new;
end;
$$;

comment on function public.complete_verified_user_onboarding() is
  'Creates the default personal workspace only for genuine first-time verified users with no prior organisation_members lifecycle. Users already linked to invited, active, suspended, deactivated or removed memberships keep their existing lifecycle and are not given fallback Owner access.';

revoke all on function public.complete_verified_user_onboarding() from public;

notify pgrst, 'reload schema';
