-- WT-NARRATIVE-READSTATE-001 Project Narrative user read-state.
-- Tracks when each workspace member last viewed a project's Narrative.

create table public.project_narrative_read_states (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_viewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_narrative_read_states_project_organisation_fk
    foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_narrative_read_states_unique_user_project
    unique (organisation_id, project_id, user_id)
);

comment on table public.project_narrative_read_states is
  'Per-user Project Narrative read-state scoped to a workspace and project. This powers the dashboard Narrative awareness tile without mutating delivery records.';
comment on column public.project_narrative_read_states.last_viewed_at is
  'Timestamp when this user last opened the Project Narrative page for the scoped project.';

create trigger set_project_narrative_read_states_updated_at
  before update on public.project_narrative_read_states
  for each row execute function public.set_updated_at();

create or replace function public.prevent_project_narrative_read_state_identity_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.organisation_id is distinct from new.organisation_id then
    raise exception 'Project Narrative read-state organisation cannot be changed.' using errcode = '42501';
  end if;

  if old.project_id is distinct from new.project_id then
    raise exception 'Project Narrative read-state project cannot be changed.' using errcode = '42501';
  end if;

  if old.user_id is distinct from new.user_id then
    raise exception 'Project Narrative read-state user cannot be changed.' using errcode = '42501';
  end if;

  if old.created_at is distinct from new.created_at then
    raise exception 'Project Narrative read-state creation timestamp cannot be changed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger prevent_project_narrative_read_state_identity_update
  before update on public.project_narrative_read_states
  for each row execute function public.prevent_project_narrative_read_state_identity_update();

alter table public.project_narrative_read_states enable row level security;

create policy "Active members can read their own project narrative read states"
  on public.project_narrative_read_states for select
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_active_organisation_member(project_narrative_read_states.organisation_id)
  );

create policy "Active members can create their own project narrative read states"
  on public.project_narrative_read_states for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active_organisation_member(project_narrative_read_states.organisation_id)
  );

create policy "Active members can update their own project narrative read states"
  on public.project_narrative_read_states for update
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_active_organisation_member(project_narrative_read_states.organisation_id)
  )
  with check (
    user_id = auth.uid()
    and public.is_active_organisation_member(project_narrative_read_states.organisation_id)
  );

create index project_narrative_read_states_organisation_id_idx
  on public.project_narrative_read_states (organisation_id);
create index project_narrative_read_states_project_user_idx
  on public.project_narrative_read_states (project_id, user_id);
create index project_narrative_read_states_user_updated_at_idx
  on public.project_narrative_read_states (user_id, updated_at desc);

grant select on table public.project_narrative_read_states to authenticated;
grant insert (
  organisation_id,
  project_id,
  user_id,
  last_viewed_at
) on public.project_narrative_read_states to authenticated;
grant update (
  last_viewed_at
) on public.project_narrative_read_states to authenticated;

grant all privileges on table public.project_narrative_read_states to service_role;

revoke all on function public.prevent_project_narrative_read_state_identity_update() from public;
