-- WT-WORKSPACE-TEAM-004-FIX-001 controlled profile identity backfill.
-- This fills missing profile identity fields used by the Workspace Team directory
-- and CSV export without changing auth.users, membership identity, or login behaviour.

create or replace function public.workspace_profile_login_name_base(raw_value text, fallback_id uuid)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned text;
  fallback_suffix text := left(replace(fallback_id::text, '-', ''), 8);
begin
  cleaned := lower(coalesce(nullif(btrim(raw_value), ''), 'user-' || fallback_suffix));
  cleaned := regexp_replace(cleaned, '[^a-z0-9._-]+', '.', 'g');
  cleaned := regexp_replace(cleaned, '[._-]{2,}', '.', 'g');
  cleaned := regexp_replace(cleaned, '^[^a-z0-9]+|[^a-z0-9]+$', '', 'g');

  if length(cleaned) < 3 then
    cleaned := regexp_replace(cleaned || '.' || fallback_suffix, '^[^a-z0-9]+|[^a-z0-9]+$', '', 'g');
  end if;

  if length(cleaned) < 3 then
    cleaned := 'user-' || fallback_suffix;
  end if;

  return left(cleaned, 64);
end;
$$;

create or replace function public.workspace_profile_next_login_name(base_login_name text, excluded_profile_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base_candidate text := public.workspace_profile_login_name_base(base_login_name, excluded_profile_id);
  candidate text;
  suffix_number integer := 1;
  suffix_text text;
begin
  candidate := base_candidate;

  while exists (
    select 1
    from public.profiles p
    where p.id is distinct from excluded_profile_id
      and lower(p.login_name) = candidate
  ) loop
    suffix_number := suffix_number + 1;
    suffix_text := '.' || lpad(suffix_number::text, 2, '0');
    candidate := left(base_candidate, 64 - length(suffix_text)) || suffix_text;
  end loop;

  return candidate;
end;
$$;

create or replace function public.workspace_profile_safe_name_parts(raw_value text)
returns table (derived_first_name text, derived_last_name text)
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned text;
  parts text[];
begin
  cleaned := nullif(btrim(coalesce(raw_value, '')), '');
  if cleaned is null then
    return;
  end if;

  cleaned := regexp_replace(cleaned, '@.*$', '');
  cleaned := regexp_replace(cleaned, '[._+-]+', ' ', 'g');
  cleaned := regexp_replace(cleaned, '[^[:alnum:] ]+', ' ', 'g');
  cleaned := nullif(btrim(regexp_replace(cleaned, '\s+', ' ', 'g')), '');
  if cleaned is null then
    return;
  end if;

  parts := regexp_split_to_array(cleaned, '\s+');
  if array_length(parts, 1) = 2 then
    derived_first_name := initcap(lower(parts[1]));
    derived_last_name := initcap(lower(parts[2]));
    return next;
  end if;
end;
$$;

create or replace function public.complete_workspace_profile_identity_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_for_identity text;
  generated_login_name text;
  generated_first_name text;
  generated_last_name text;
begin
  source_for_identity := coalesce(
    nullif(btrim(new.display_name), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user-' || left(replace(new.id::text, '-', ''), 8)
  );

  if nullif(btrim(new.contact_email), '') is null and nullif(btrim(new.email), '') is not null then
    new.contact_email := lower(btrim(new.email));
  end if;

  if nullif(btrim(new.login_name), '') is null then
    generated_login_name := public.workspace_profile_next_login_name(source_for_identity, new.id);
    new.login_name := generated_login_name;
  else
    new.login_name := lower(btrim(new.login_name));
  end if;

  select derived_first_name, derived_last_name
    into generated_first_name, generated_last_name
  from public.workspace_profile_safe_name_parts(source_for_identity);

  if nullif(btrim(new.first_name), '') is null and generated_first_name is not null then
    new.first_name := generated_first_name;
  end if;

  if nullif(btrim(new.last_name), '') is null and generated_last_name is not null then
    new.last_name := generated_last_name;
  end if;

  return new;
end;
$$;

drop trigger if exists complete_workspace_profile_identity_defaults on public.profiles;
create trigger complete_workspace_profile_identity_defaults
  before insert or update of email, display_name
  on public.profiles
  for each row execute function public.complete_workspace_profile_identity_defaults();

create or replace function public.backfill_workspace_profile_identity_fields()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record public.profiles;
  source_for_identity text;
  generated_login_name text;
  generated_first_name text;
  generated_last_name text;
  updated_count integer := 0;
begin
  for profile_record in
    select *
    from public.profiles p
    where nullif(btrim(p.contact_email), '') is null
       or nullif(btrim(p.login_name), '') is null
       or nullif(btrim(p.first_name), '') is null
       or nullif(btrim(p.last_name), '') is null
    order by p.created_at asc, p.id asc
  loop
    source_for_identity := coalesce(
      nullif(btrim(profile_record.display_name), ''),
      nullif(split_part(coalesce(profile_record.email, ''), '@', 1), ''),
      'user-' || left(replace(profile_record.id::text, '-', ''), 8)
    );

    generated_login_name := case
      when nullif(btrim(profile_record.login_name), '') is null
        then public.workspace_profile_next_login_name(source_for_identity, profile_record.id)
      else profile_record.login_name
    end;

    generated_first_name := null;
    generated_last_name := null;
    select derived_first_name, derived_last_name
      into generated_first_name, generated_last_name
    from public.workspace_profile_safe_name_parts(source_for_identity);

    update public.profiles
      set contact_email = case
            when nullif(btrim(profile_record.contact_email), '') is null
              then lower(nullif(btrim(profile_record.email), ''))
            else profile_record.contact_email
          end,
          login_name = case
            when nullif(btrim(profile_record.login_name), '') is null
              then generated_login_name
            else profile_record.login_name
          end,
          first_name = case
            when nullif(btrim(profile_record.first_name), '') is null
              then generated_first_name
            else profile_record.first_name
          end,
          last_name = case
            when nullif(btrim(profile_record.last_name), '') is null
              then generated_last_name
            else profile_record.last_name
          end
    where id = profile_record.id;

    updated_count := updated_count + 1;
  end loop;

  return updated_count;
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
  derived_login_name text;
  derived_first_name text;
  derived_last_name text;
  workspace_name text;
  workspace_id uuid;
begin
  if new.email_confirmed_at is null then
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

select public.backfill_workspace_profile_identity_fields();

comment on function public.workspace_profile_login_name_base(text, uuid) is
  'Normalises display/email-derived profile text into a login_name-compatible base. It does not enable login-name authentication.';
comment on function public.workspace_profile_next_login_name(text, uuid) is
  'Returns a deterministic unique profile login_name candidate using .02, .03 and later suffixes for duplicates.';
comment on function public.workspace_profile_safe_name_parts(text) is
  'Returns first_name and last_name only when existing profile text cleanly resolves to exactly two name parts.';
comment on function public.backfill_workspace_profile_identity_fields() is
  'Controlled one-time backfill for WT-WORKSPACE-TEAM-004-FIX-001. Preserves non-blank profile values and does not modify auth.users.';
comment on function public.complete_verified_user_onboarding() is
  'Creates or refreshes a verified auth user profile, personal workspace, owner membership and identity defaults. UUID remains the account identity key.';

revoke all on function public.workspace_profile_login_name_base(text, uuid) from public;
revoke all on function public.workspace_profile_next_login_name(text, uuid) from public;
revoke all on function public.workspace_profile_safe_name_parts(text) from public;
revoke all on function public.complete_workspace_profile_identity_defaults() from public;
revoke all on function public.backfill_workspace_profile_identity_fields() from public;
revoke all on function public.complete_verified_user_onboarding() from public;
