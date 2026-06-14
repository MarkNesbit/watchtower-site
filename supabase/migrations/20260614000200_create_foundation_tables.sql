-- WT-001B foundation tables.
create extension if not exists pgcrypto with schema extensions;

-- Supabase Auth owns auth.users; these tables only reference auth.users.id.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  avatar_url text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint profiles_email_not_empty check (length(btrim(email)) > 0),
  constraint profiles_display_name_not_empty check (length(btrim(display_name)) > 0)
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  type text not null default 'personal',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  constraint organisations_name_not_empty check (length(btrim(name)) > 0),
  constraint organisations_slug_not_empty check (length(btrim(slug)) > 0),
  constraint organisations_type_check check (type in ('personal', 'team', 'business', 'client')),
  constraint organisations_slug_key unique (slug)
);


create index organisations_created_by_idx on public.organisations (created_by);
create index organisations_active_idx on public.organisations (id) where deleted_at is null and archived_at is null;

create table public.organisation_members (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active',
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz,
  joined_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisation_members_role_check check (role in ('owner', 'admin', 'member', 'viewer')),
  constraint organisation_members_status_check check (status in ('active', 'invited', 'suspended', 'removed'))
);

create unique index organisation_members_organisation_id_user_id_key
  on public.organisation_members (organisation_id, user_id);
create index organisation_members_user_id_idx on public.organisation_members (user_id);
create index organisation_members_active_user_org_idx
  on public.organisation_members (user_id, organisation_id)
  where status = 'active';
create table public.organisation_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  allow_user_display_name_editing boolean not null default false,
  require_mfa boolean not null default false,
  default_member_role text not null default 'member',
  allow_member_project_creation boolean not null default true,
  allow_member_data_upload boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisation_settings_default_member_role_check check (default_member_role in ('admin', 'member', 'viewer'))
);

create table public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  description text,
  enabled boolean not null default false,
  organisation_id uuid references public.organisations(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_flags_key_not_empty check (length(btrim(key)) > 0),
  constraint feature_flags_name_not_empty check (length(btrim(name)) > 0)
);

create unique index feature_flags_global_key_key
  on public.feature_flags (key)
  where organisation_id is null;
create unique index feature_flags_organisation_key_key
  on public.feature_flags (organisation_id, key)
  where organisation_id is not null;
create index feature_flags_organisation_id_idx on public.feature_flags (organisation_id);
create index feature_flags_enabled_global_idx on public.feature_flags (key) where enabled = true and organisation_id is null;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint audit_log_action_not_empty check (length(btrim(action)) > 0)
);

create index audit_log_organisation_created_at_idx on public.audit_log (organisation_id, created_at desc);
create index audit_log_actor_created_at_idx on public.audit_log (actor_user_id, created_at desc);
create index audit_log_action_idx on public.audit_log (action);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_organisations_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();
create trigger set_organisation_members_updated_at
  before update on public.organisation_members
  for each row execute function public.set_updated_at();
create trigger set_organisation_settings_updated_at
  before update on public.organisation_settings
  for each row execute function public.set_updated_at();
create trigger set_feature_flags_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();
