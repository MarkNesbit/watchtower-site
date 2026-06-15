-- WT-001C auth onboarding: create application records after Supabase email verification.

create or replace function public.derive_display_name_from_email(email_address text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(
      initcap(
        regexp_replace(
          regexp_replace(split_part(coalesce(email_address, ''), '@', 1), '[._+-]+', ' ', 'g'),
          '\s+', ' ', 'g'
        )
      ),
      ''
    ),
    'WatchTower User'
  );
$$;

create or replace function public.slugify_workspace_name(workspace_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(workspace_name, 'workspace')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.unique_workspace_slug(workspace_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text := public.slugify_workspace_name(workspace_name);
  candidate_slug text;
  suffix integer := 1;
begin
  if base_slug is null or base_slug = '' then
    base_slug := 'workspace';
  end if;

  candidate_slug := base_slug;
  while exists (select 1 from public.organisations where slug = candidate_slug) loop
    suffix := suffix + 1;
    candidate_slug := base_slug || '-' || suffix::text;
  end loop;

  return candidate_slug;
end;
$$;

create or replace function public.complete_verified_user_onboarding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  derived_display_name text;
  workspace_name text;
  workspace_id uuid;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  derived_display_name := public.derive_display_name_from_email(new.email);
  workspace_name := derived_display_name || ' Workspace';

  insert into public.profiles (id, email, display_name, created_by, updated_by)
  values (new.id, new.email, derived_display_name, new.id, new.id)
  on conflict (id) do update
    set email = excluded.email,
        updated_by = excluded.updated_by;

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
  select null, new.id, 'user.registered', 'profile', new.id, jsonb_build_object('email', new.email, 'display_name', derived_display_name)
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

create trigger complete_verified_user_onboarding_on_auth_user
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.complete_verified_user_onboarding();

create or replace function public.record_auth_audit_event(action_name text, event_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if action_name not in ('user.logged_in', 'user.logged_out', 'user.password_reset_requested', 'user.password_reset_completed') then
    raise exception 'Unsupported auth audit action: %', action_name using errcode = '22023';
  end if;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_values)
  values (auth.uid(), action_name, 'profile', auth.uid(), coalesce(event_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.derive_display_name_from_email(text) from public;
revoke all on function public.slugify_workspace_name(text) from public;
revoke all on function public.unique_workspace_slug(text) from public;
revoke all on function public.complete_verified_user_onboarding() from public;
revoke all on function public.record_auth_audit_event(text, jsonb) from public;
grant execute on function public.record_auth_audit_event(text, jsonb) to anon, authenticated, service_role;
