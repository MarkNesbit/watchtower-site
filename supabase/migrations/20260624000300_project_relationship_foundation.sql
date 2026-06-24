-- WT-US-0208 project relationship readiness foundation.
-- Adds project-to-project relationship storage and workspace-safe access without a user-facing UI.

create table public.project_relationships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  source_project_id uuid not null,
  target_project_id uuid not null,
  relationship_type text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_relationships_source_project_organisation_fk
    foreign key (source_project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_relationships_target_project_organisation_fk
    foreign key (target_project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_relationships_type_check
    check (relationship_type in ('relates_to', 'dependent_on', 'required_for', 'programme', 'portfolio')),
  constraint project_relationships_no_self_relationship_check
    check (source_project_id <> target_project_id)
);

comment on table public.project_relationships is
  'Workspace-scoped project relationship foundation. Both endpoints are internal project UUIDs. No relationship management UI, programme/portfolio dashboard, reporting, or automatic risk creation is included in WT-US-0208.';
comment on column public.project_relationships.relationship_type is
  'One of relates_to, dependent_on, required_for, programme, or portfolio. relates_to is intentionally non-specific and is available to future health/risk logic as an ambiguity signal; it does not create a risk automatically.';
comment on column public.project_relationships.description is
  'Optional context for the relationship. User-facing views should identify projects with their human-readable project_ref rather than exposing UUIDs.';

create unique index project_relationships_active_unique_key
  on public.project_relationships (organisation_id, source_project_id, target_project_id, relationship_type)
  where is_active = true;

create index project_relationships_source_project_idx
  on public.project_relationships (source_project_id, organisation_id);
create index project_relationships_target_project_idx
  on public.project_relationships (target_project_id, organisation_id);
create index project_relationships_active_organisation_idx
  on public.project_relationships (organisation_id, relationship_type, source_project_id, target_project_id)
  where is_active = true;

create or replace function public.set_project_relationship_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required for project relationship audit fields.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_by = auth.uid();
  end if;

  return new;
end;
$$;

create trigger set_project_relationship_audit_fields
  before insert or update on public.project_relationships
  for each row execute function public.set_project_relationship_audit_fields();

create trigger set_project_relationships_updated_at
  before update on public.project_relationships
  for each row execute function public.set_updated_at();

create or replace function public.prevent_project_relationship_scope_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.organisation_id is distinct from new.organisation_id then
    raise exception 'Project relationship organisation cannot be changed.' using errcode = '42501';
  end if;

  if old.created_by is distinct from new.created_by then
    raise exception 'Project relationship creator cannot be changed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger prevent_project_relationship_scope_update
  before update on public.project_relationships
  for each row execute function public.prevent_project_relationship_scope_update();

alter table public.project_relationships enable row level security;

create policy "Active members can read project relationships"
  on public.project_relationships for select
  to authenticated
  using (public.is_active_organisation_member(project_relationships.organisation_id));

create policy "Owners admins and members can create project relationships"
  on public.project_relationships for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.has_active_organisation_role(project_relationships.organisation_id, array['owner', 'admin', 'member'])
  );

create policy "Owners admins and members can update project relationships"
  on public.project_relationships for update
  to authenticated
  using (public.has_active_organisation_role(project_relationships.organisation_id, array['owner', 'admin', 'member']))
  with check (public.has_active_organisation_role(project_relationships.organisation_id, array['owner', 'admin', 'member']));

create policy "Owners admins and members can delete project relationships"
  on public.project_relationships for delete
  to authenticated
  using (public.has_active_organisation_role(project_relationships.organisation_id, array['owner', 'admin', 'member']));

grant select, delete on table public.project_relationships to authenticated;
grant insert (
  organisation_id,
  source_project_id,
  target_project_id,
  relationship_type,
  description,
  is_active
) on public.project_relationships to authenticated;
grant update (
  source_project_id,
  target_project_id,
  relationship_type,
  description,
  is_active
) on public.project_relationships to authenticated;

grant all privileges on table public.project_relationships to service_role;

revoke all on function public.set_project_relationship_audit_fields() from public;
revoke all on function public.prevent_project_relationship_scope_update() from public;
