-- WT-PROJ-DETAILS-001 project people and responsibility assignment foundation.
-- Project roles describe accountability/context only. Workspace RBAC still controls access.

create table public.project_people (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  demo_person_id uuid references public.workspace_demo_people(id) on delete cascade,
  project_role text not null,
  responsibility text,
  is_primary boolean not null default true,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_people_project_organisation_fk
    foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_people_exactly_one_person_check
    check (
      (user_id is not null and demo_person_id is null)
      or (user_id is null and demo_person_id is not null)
    ),
  constraint project_people_role_check
    check (project_role in (
      'sponsor',
      'project_manager',
      'delivery_lead',
      'product_owner',
      'assurance_lead',
      'default_risk_owner',
      'default_issue_owner',
      'default_dependency_owner',
      'default_assumption_owner',
      'finance_stakeholder',
      'client_stakeholder',
      'project_support'
    )),
  constraint project_people_status_check check (status in ('active', 'removed')),
  constraint project_people_responsibility_not_empty check (responsibility is null or length(btrim(responsibility)) > 0)
);

comment on table public.project_people is
  'Workspace-scoped project responsibility assignments. Assignments link real workspace members or active demo personas to project roles, but never grant workspace permissions.';
comment on column public.project_people.user_id is
  'Real workspace member user_id. This aligns with organisation_members.user_id and profiles.id/auth.users.id.';
comment on column public.project_people.demo_person_id is
  'Internal demo/persona assignment from workspace_demo_people. Demo people are visibly labelled in the application and are not authenticated users.';
comment on column public.project_people.project_role is
  'Controlled project responsibility label. This is accountability/context and does not grant edit access.';

create index project_people_project_status_idx
  on public.project_people (organisation_id, project_id, status, project_role);
create index project_people_user_id_idx
  on public.project_people (user_id)
  where user_id is not null;
create index project_people_demo_person_id_idx
  on public.project_people (demo_person_id)
  where demo_person_id is not null;

create unique index project_people_active_primary_role_key
  on public.project_people (organisation_id, project_id, project_role)
  where status = 'active' and is_primary = true;
create unique index project_people_active_real_person_role_key
  on public.project_people (organisation_id, project_id, project_role, user_id)
  where status = 'active' and user_id is not null;
create unique index project_people_active_demo_person_role_key
  on public.project_people (organisation_id, project_id, project_role, demo_person_id)
  where status = 'active' and demo_person_id is not null;

create or replace function public.validate_project_people_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_project_organisation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required for project people assignment.' using errcode = '42501';
  end if;

  select projects.organisation_id
    into target_project_organisation_id
  from public.projects
  where projects.id = new.project_id;

  if not found or target_project_organisation_id is distinct from new.organisation_id then
    raise exception 'Project people assignment must belong to the same workspace as the project.' using errcode = '23503';
  end if;

  if new.status = 'active' and new.user_id is not null and not exists (
    select 1
    from public.organisation_members om
    where om.organisation_id = new.organisation_id
      and om.user_id = new.user_id
      and om.status = 'active'
  ) then
    raise exception 'Project people assignment requires an active workspace member.' using errcode = '23503';
  end if;

  if new.status = 'active' and new.demo_person_id is not null and not exists (
    select 1
    from public.workspace_demo_people wdp
    where wdp.id = new.demo_person_id
      and wdp.organisation_id = new.organisation_id
      and wdp.status = 'active'
      and wdp.is_demo_person = true
  ) then
    raise exception 'Project people assignment requires an active demo person from this workspace.' using errcode = '23503';
  end if;

  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
  elsif tg_op = 'UPDATE' then
    if old.organisation_id is distinct from new.organisation_id then
      raise exception 'Project people assignment workspace cannot be changed.' using errcode = '42501';
    end if;
    if old.project_id is distinct from new.project_id then
      raise exception 'Project people assignment project cannot be changed.' using errcode = '42501';
    end if;
    if old.created_by is distinct from new.created_by then
      raise exception 'Project people assignment creator cannot be changed.' using errcode = '42501';
    end if;
    new.updated_by = auth.uid();
  end if;

  return new;
end;
$$;

create trigger validate_project_people_assignment
  before insert or update on public.project_people
  for each row execute function public.validate_project_people_assignment();

create trigger set_project_people_updated_at
  before update on public.project_people
  for each row execute function public.set_updated_at();

alter table public.project_people enable row level security;

create policy "Active members can read project people"
  on public.project_people for select
  to authenticated
  using (public.is_active_organisation_member(project_people.organisation_id));

create policy "Owners admins and members can create project people"
  on public.project_people for insert
  to authenticated
  with check (
    public.has_active_organisation_role(project_people.organisation_id, array['owner', 'admin', 'member'])
  );

create policy "Owners admins and members can update project people"
  on public.project_people for update
  to authenticated
  using (public.has_active_organisation_role(project_people.organisation_id, array['owner', 'admin', 'member']))
  with check (public.has_active_organisation_role(project_people.organisation_id, array['owner', 'admin', 'member']));

grant select on table public.project_people to authenticated;
grant insert (
  organisation_id,
  project_id,
  user_id,
  demo_person_id,
  project_role,
  responsibility,
  is_primary,
  status
) on public.project_people to authenticated;
grant update (
  user_id,
  demo_person_id,
  project_role,
  responsibility,
  is_primary,
  status,
  updated_at
) on public.project_people to authenticated;
grant all privileges on table public.project_people to service_role;

revoke all on function public.validate_project_people_assignment() from public;
