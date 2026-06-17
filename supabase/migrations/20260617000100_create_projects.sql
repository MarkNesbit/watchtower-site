-- WT-002A project core foundation.
-- Depends on public.set_updated_at() from WT-001B.

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
      and p.pronargs = 0
  ) then
    raise exception 'Required function public.set_updated_at() is missing. Stop rather than creating an incompatible duplicate.';
  end if;
end $$;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  name text not null,
  slug text not null,
  description text,
  status text not null default 'proposed',
  health text not null default 'unknown',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  constraint projects_name_not_empty check (length(btrim(name)) > 0),
  constraint projects_slug_not_empty check (length(btrim(slug)) > 0),
  constraint projects_status_check check (status in ('proposed', 'active', 'paused', 'completed', 'cancelled')),
  constraint projects_health_check check (health in ('green', 'amber', 'red', 'unknown')),
  constraint projects_organisation_slug_key unique (organisation_id, slug)
);

create index projects_organisation_id_idx on public.projects (organisation_id);
create index projects_created_by_idx on public.projects (created_by);
create index projects_organisation_status_idx on public.projects (organisation_id, status);
create index projects_organisation_updated_at_idx on public.projects (organisation_id, updated_at desc);
create index projects_active_idx on public.projects (organisation_id, updated_at desc)
  where deleted_at is null and archived_at is null;

create trigger set_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

create or replace function public.prevent_unauthorised_project_destructive_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.organisation_id is distinct from new.organisation_id then
    raise exception 'Project organisation cannot be changed.' using errcode = '42501';
  end if;

  if old.created_by is distinct from new.created_by then
    raise exception 'Project creator cannot be changed.' using errcode = '42501';
  end if;

  if (old.archived_at is distinct from new.archived_at
      or old.deleted_at is distinct from new.deleted_at)
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.has_active_organisation_role(old.organisation_id, array['owner', 'admin']) then
    raise exception 'Only workspace owners and admins may archive or delete projects.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger prevent_unauthorised_project_destructive_update
  before update on public.projects
  for each row execute function public.prevent_unauthorised_project_destructive_update();

create policy "Active members can read projects"
  on public.projects for select
  to authenticated
  using (public.is_active_organisation_member(projects.organisation_id));

create policy "Owners admins and permitted members can create projects"
  on public.projects for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.has_active_organisation_role(projects.organisation_id, array['owner', 'admin'])
      or (
        public.has_active_organisation_role(projects.organisation_id, array['member'])
        and exists (
          select 1
          from public.organisation_settings os
          where os.organisation_id = projects.organisation_id
            and os.allow_member_project_creation = true
        )
      )
    )
  );

create policy "Owners admins and members can update projects"
  on public.projects for update
  to authenticated
  using (public.has_active_organisation_role(projects.organisation_id, array['owner', 'admin', 'member']))
  with check (
    public.has_active_organisation_role(projects.organisation_id, array['owner', 'admin', 'member'])
    and organisation_id = projects.organisation_id
  );

create policy "Project creators can write creation audit log"
  on public.audit_log for insert
  to authenticated
  with check (
    action = 'project.created'
    and entity_type = 'project'
    and actor_user_id = auth.uid()
    and organisation_id is not null
    and public.has_active_organisation_role(organisation_id, array['owner', 'admin', 'member'])
    and old_values is null
    and new_values ? 'name'
    and new_values ? 'status'
    and new_values ? 'health'
  );

grant select, insert on table public.projects to authenticated;
grant update (
  name,
  slug,
  description,
  status,
  health,
  updated_at,
  archived_at,
  deleted_at
) on public.projects to authenticated;
grant insert (
  organisation_id,
  actor_user_id,
  action,
  entity_type,
  entity_id,
  new_values
) on public.audit_log to authenticated;

grant all privileges on table public.projects to service_role;

revoke all on function public.prevent_unauthorised_project_destructive_update() from public;
