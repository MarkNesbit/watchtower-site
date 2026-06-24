-- WT-NARRATIVE-002 Project Narrative schema foundation.
-- Adds structured project narrative records, database-generated project-scoped references,
-- audit fields and workspace-isolated RLS. Narrative UI and RAID integrations are future scope.

create or replace function public.is_valid_iana_timezone(timezone_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = timezone_name
      and (name = 'UTC' or position('/' in name) > 0)
  );
$$;

comment on function public.is_valid_iana_timezone(text) is
  'Validates optional timezone context against the PostgreSQL IANA timezone catalogue. UTC and region/city names are accepted; abbreviations and fixed offsets are rejected.';

create table public.project_narrative_counters (
  project_id uuid primary key,
  organisation_id uuid not null,
  last_entry_number integer not null default 0,
  constraint project_narrative_counters_project_organisation_fk
    foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_narrative_counters_last_entry_number_check
    check (last_entry_number >= 0)
);

comment on table public.project_narrative_counters is
  'Internal per-project allocator for Project Narrative entry numbers. It is not exposed to authenticated clients and prevents reference reuse after entry deletion.';

create table public.project_narrative_entries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  entry_number integer not null,
  narrative_ref text not null,
  source_type text not null default 'manual',
  source_record_id uuid,
  source_ref text,
  attention_level text not null default 'neutral',
  title text,
  details text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_timezone text,
  updated_timezone text,
  constraint project_narrative_entries_project_organisation_fk
    foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_narrative_entries_entry_number_positive_check
    check (entry_number > 0),
  constraint project_narrative_entries_narrative_ref_format_check
    check (narrative_ref ~ '^NAR-[A-Z][A-Z0-9]{2,3}-[0-9]{3,}$'),
  constraint project_narrative_entries_source_type_check
    check (source_type in ('manual', 'risk', 'issue', 'dependency', 'assumption', 'system')),
  constraint project_narrative_entries_attention_level_check
    check (attention_level in ('neutral', 'green', 'amber', 'red')),
  constraint project_narrative_entries_content_check
    check (nullif(btrim(title), '') is not null or nullif(btrim(details), '') is not null),
  constraint project_narrative_entries_source_ref_not_empty_check
    check (source_ref is null or length(btrim(source_ref)) > 0),
  constraint project_narrative_entries_created_timezone_check
    check (created_timezone is null or public.is_valid_iana_timezone(created_timezone)),
  constraint project_narrative_entries_updated_timezone_check
    check (updated_timezone is null or public.is_valid_iana_timezone(updated_timezone)),
  constraint project_narrative_entries_project_entry_number_key
    unique (project_id, entry_number),
  constraint project_narrative_entries_project_narrative_ref_key
    unique (project_id, narrative_ref)
);

comment on table public.project_narrative_entries is
  'Project-level assurance timeline entries. Narrative records preserve context and references but do not replace authoritative Risk, Issue, Dependency or Assumption records. UI, RAID generation, filters, export and notifications are outside WT-NARRATIVE-002.';
comment on column public.project_narrative_entries.entry_number is
  'Immutable database-generated sequence number scoped to project_id.';
comment on column public.project_narrative_entries.narrative_ref is
  'Immutable database-generated NAR-{PROJECT_REF}-{NNN} reference retained for every entry, including source-generated entries.';
comment on column public.project_narrative_entries.source_record_id is
  'Optional UUID of a future authoritative source record. No RAID foreign key is introduced by this foundation story.';
comment on column public.project_narrative_entries.source_ref is
  'Optional human-readable source reference, for example Risk-HHH-003. The source module remains authoritative.';
comment on column public.project_narrative_entries.created_at is
  'UTC-compatible timestamptz audit timestamp. Display conversion belongs to a later viewer-timezone presentation layer.';
comment on column public.project_narrative_entries.created_timezone is
  'Optional IANA timezone context captured at creation; this does not alter UTC-compatible timestamp persistence.';

create or replace function public.prepare_project_narrative_entry_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organisation_id uuid;
  target_project_ref text;
begin
  select projects.organisation_id, projects.project_ref
    into target_organisation_id, target_project_ref
  from public.projects
  where projects.id = new.project_id;

  if not found then
    raise exception 'Project Narrative project does not exist.' using errcode = '23503';
  end if;

  if target_project_ref is null then
    raise exception 'Project reference is required before a Project Narrative entry can be created.' using errcode = '23514';
  end if;

  -- The upsert takes a row-level lock for this project's counter. Issued numbers are
  -- retained even if an entry is later deleted, so narrative references are not reused.
  insert into public.project_narrative_counters (project_id, organisation_id, last_entry_number)
  values (new.project_id, target_organisation_id, 1)
  on conflict (project_id) do update
    set last_entry_number = project_narrative_counters.last_entry_number + 1
  returning last_entry_number
    into new.entry_number;

  new.organisation_id = target_organisation_id;
  new.narrative_ref = format(
    'NAR-%s-%s',
    target_project_ref,
    lpad(new.entry_number::text, 3, '0')
  );

  if auth.uid() is not null then
    new.created_by = auth.uid();
  elsif coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authenticated user is required for Project Narrative audit fields.' using errcode = '42501';
  elsif new.created_by is null then
    raise exception 'Service-created Project Narrative entries require created_by.' using errcode = '23502';
  end if;

  return new;
end;
$$;

create trigger prepare_project_narrative_entry_insert
  before insert on public.project_narrative_entries
  for each row execute function public.prepare_project_narrative_entry_insert();

create or replace function public.set_project_narrative_entry_update_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.updated_by = auth.uid();
  elsif coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authenticated user is required for Project Narrative audit fields.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger set_project_narrative_entry_update_audit_fields
  before update on public.project_narrative_entries
  for each row execute function public.set_project_narrative_entry_update_audit_fields();

create trigger set_project_narrative_entries_updated_at
  before update on public.project_narrative_entries
  for each row execute function public.set_updated_at();

create or replace function public.prevent_project_narrative_entry_identity_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.organisation_id is distinct from new.organisation_id then
    raise exception 'Project Narrative organisation cannot be changed.' using errcode = '42501';
  end if;

  if old.project_id is distinct from new.project_id then
    raise exception 'Project Narrative project cannot be changed.' using errcode = '42501';
  end if;

  if old.entry_number is distinct from new.entry_number then
    raise exception 'Project Narrative entry number cannot be changed.' using errcode = '42501';
  end if;

  if old.narrative_ref is distinct from new.narrative_ref then
    raise exception 'Project Narrative reference cannot be changed.' using errcode = '42501';
  end if;

  if old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'Project Narrative creation audit identity cannot be changed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger prevent_project_narrative_entry_identity_update
  before update on public.project_narrative_entries
  for each row execute function public.prevent_project_narrative_entry_identity_update();

alter table public.project_narrative_entries enable row level security;
alter table public.project_narrative_counters enable row level security;

create policy "Active members can read project narrative entries"
  on public.project_narrative_entries for select
  to authenticated
  using (public.is_active_organisation_member(project_narrative_entries.organisation_id));

create policy "Owners admins and members can create project narrative entries"
  on public.project_narrative_entries for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.has_active_organisation_role(
      project_narrative_entries.organisation_id,
      array['owner', 'admin', 'member']
    )
  );

create policy "Owners admins and members can update project narrative entries"
  on public.project_narrative_entries for update
  to authenticated
  using (
    public.has_active_organisation_role(
      project_narrative_entries.organisation_id,
      array['owner', 'admin', 'member']
    )
  )
  with check (
    public.has_active_organisation_role(
      project_narrative_entries.organisation_id,
      array['owner', 'admin', 'member']
    )
  );

create policy "Owners admins and members can delete project narrative entries"
  on public.project_narrative_entries for delete
  to authenticated
  using (
    public.has_active_organisation_role(
      project_narrative_entries.organisation_id,
      array['owner', 'admin', 'member']
    )
  );

create index project_narrative_entries_organisation_id_idx
  on public.project_narrative_entries (organisation_id);
create index project_narrative_entries_project_created_at_idx
  on public.project_narrative_entries (project_id, created_at desc);
create index project_narrative_entries_project_attention_idx
  on public.project_narrative_entries (project_id, attention_level, created_at desc);
create index project_narrative_entries_source_record_idx
  on public.project_narrative_entries (source_type, source_record_id)
  where source_record_id is not null;

grant select, delete on table public.project_narrative_entries to authenticated;
grant insert (
  project_id,
  source_type,
  source_record_id,
  source_ref,
  attention_level,
  title,
  details,
  created_timezone
) on public.project_narrative_entries to authenticated;
grant update (
  source_type,
  source_record_id,
  source_ref,
  attention_level,
  title,
  details,
  updated_timezone
) on public.project_narrative_entries to authenticated;

grant all privileges on table public.project_narrative_entries to service_role;
grant all privileges on table public.project_narrative_counters to service_role;
grant execute on function public.is_valid_iana_timezone(text) to authenticated, service_role;

revoke all on function public.is_valid_iana_timezone(text) from public;
revoke all on function public.prepare_project_narrative_entry_insert() from public;
revoke all on function public.set_project_narrative_entry_update_audit_fields() from public;
revoke all on function public.prevent_project_narrative_entry_identity_update() from public;
