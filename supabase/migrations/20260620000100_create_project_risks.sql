-- WT-RISK-001 risk schema foundation.
-- Adds project references, project-scoped risks, threaded risk notes, RLS, constraints and indexes.
-- Risk actions/actioners, notifications, email delivery and dashboard roll-ups are intentionally future scope.

alter table public.projects
  add column if not exists project_ref text;

comment on column public.projects.project_ref is
  'Short uppercase project reference unique within an organisation/workspace when present. Supports human-readable references such as Risk-HHH-003. Existing projects are not backfilled automatically; project_ref is nullable to preserve current project creation flows until UI support is added.';

create or replace function public.normalise_project_ref()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.project_ref is not null then
    new.project_ref = upper(btrim(new.project_ref));
    if new.project_ref = '' then
      new.project_ref = null;
    end if;
  end if;

  return new;
end;
$$;

create trigger normalise_projects_project_ref
  before insert or update of project_ref on public.projects
  for each row execute function public.normalise_project_ref();

alter table public.projects
  add constraint projects_project_ref_format_check
  check (project_ref is null or project_ref ~ '^[A-Z][A-Z0-9]{1,9}$');

create unique index projects_organisation_project_ref_key
  on public.projects (organisation_id, project_ref)
  where project_ref is not null;

create unique index projects_id_organisation_id_key
  on public.projects (id, organisation_id);

create table public.project_risks (
  risk_id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  risk_ref text not null,
  risk_sequence integer not null,
  title text not null,
  description text,
  status text not null default 'open',
  probability text not null default 'medium',
  impact text not null default 'medium',
  rag_status text not null default 'blue',
  owner_id uuid references public.profiles(id),
  mitigation_plan text,
  contingency_plan text,
  review_date date,
  due_date date,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  constraint project_risks_project_organisation_fk foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_risks_title_not_empty check (length(btrim(title)) > 0),
  constraint project_risks_risk_sequence_positive check (risk_sequence > 0),
  constraint project_risks_risk_ref_format_check check (risk_ref ~ '^Risk-[A-Z][A-Z0-9]{1,9}-[0-9]{3}$'),
  constraint project_risks_status_check check (status in ('open', 'monitoring', 'mitigating', 'accepted', 'closed')),
  constraint project_risks_probability_check check (probability in ('low', 'medium', 'high')),
  constraint project_risks_impact_check check (impact in ('low', 'medium', 'high')),
  constraint project_risks_rag_status_check check (rag_status in ('blue', 'green', 'amber', 'red')),
  constraint project_risks_project_sequence_key unique (project_id, risk_sequence),
  constraint project_risks_project_ref_key unique (project_id, risk_ref),
  constraint project_risks_organisation_ref_key unique (organisation_id, risk_ref),
  constraint project_risks_id_project_organisation_key unique (risk_id, project_id, organisation_id)
);

comment on table public.project_risks is
  'Project-scoped risk records. risk_id is the internal UUID relationship key; risk_ref is the human-readable Risk-{PROJECT_REF}-{NNN} reference. owner_id is the accountable risk owner. Actioners are future scope and will be modelled separately through project_risk_actions, not on this table.';
comment on column public.project_risks.owner_id is
  'Accountable risk owner. Actioners for mitigation, contingency, review or follow-up work are future scope in a separate project_risk_actions table.';
comment on column public.project_risks.risk_ref is
  'Human-readable reference in the format Risk-{PROJECT_REF}-{NNN}, for example Risk-HHH-003.';

create table public.project_risk_notes (
  risk_note_id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  risk_id uuid not null references public.project_risks(risk_id) on delete cascade,
  parent_risk_note_id uuid references public.project_risk_notes(risk_note_id) on delete cascade,
  note text not null,
  attention_level text not null default 'green',
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz,
  constraint project_risk_notes_project_organisation_fk foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_risk_notes_risk_scope_fk foreign key (risk_id, project_id, organisation_id)
    references public.project_risks(risk_id, project_id, organisation_id) on delete cascade,
  constraint project_risk_notes_note_not_empty check (length(btrim(note)) > 0),
  constraint project_risk_notes_attention_level_check check (attention_level in ('green', 'amber', 'red')),
  constraint project_risk_notes_id_risk_project_organisation_key unique (risk_note_id, risk_id, project_id, organisation_id),
  constraint project_risk_notes_parent_scope_fk foreign key (parent_risk_note_id, risk_id, project_id, organisation_id)
    references public.project_risk_notes(risk_note_id, risk_id, project_id, organisation_id) on delete cascade
);

comment on table public.project_risk_notes is
  'Threaded audit notes and replies for project risks. parent_risk_note_id is null for top-level notes and populated for replies. Attention levels support future notification behaviour only; delivery is not implemented here.';
comment on column public.project_risk_notes.attention_level is
  'green = routine/informational; amber = needs awareness/review; red = urgent/rapid interaction likely required. Future scope: red immediate owner email, amber/green daily digest.';

create or replace function public.set_project_risk_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required for risk audit fields.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_by = auth.uid();
  end if;

  return new;
end;
$$;

create trigger set_project_risk_audit_fields
  before insert or update on public.project_risks
  for each row execute function public.set_project_risk_audit_fields();

create or replace function public.set_project_risk_note_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required for risk note audit fields.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_by = auth.uid();
  end if;

  return new;
end;
$$;

create trigger set_project_risk_note_audit_fields
  before insert or update on public.project_risk_notes
  for each row execute function public.set_project_risk_note_audit_fields();

create trigger set_project_risks_updated_at
  before update on public.project_risks
  for each row execute function public.set_updated_at();

create or replace function public.prevent_project_risk_scope_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.organisation_id is distinct from new.organisation_id then
    raise exception 'Risk organisation cannot be changed.' using errcode = '42501';
  end if;

  if old.project_id is distinct from new.project_id then
    raise exception 'Risk project cannot be changed.' using errcode = '42501';
  end if;

  if old.created_by is distinct from new.created_by then
    raise exception 'Risk creator cannot be changed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger prevent_project_risk_scope_update
  before update on public.project_risks
  for each row execute function public.prevent_project_risk_scope_update();

create trigger set_project_risk_notes_updated_at
  before update on public.project_risk_notes
  for each row execute function public.set_updated_at();

create or replace function public.prevent_project_risk_note_scope_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.organisation_id is distinct from new.organisation_id then
    raise exception 'Risk note organisation cannot be changed.' using errcode = '42501';
  end if;

  if old.project_id is distinct from new.project_id then
    raise exception 'Risk note project cannot be changed.' using errcode = '42501';
  end if;

  if old.risk_id is distinct from new.risk_id then
    raise exception 'Risk note risk cannot be changed.' using errcode = '42501';
  end if;

  if old.created_by is distinct from new.created_by then
    raise exception 'Risk note creator cannot be changed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger prevent_project_risk_note_scope_update
  before update on public.project_risk_notes
  for each row execute function public.prevent_project_risk_note_scope_update();

alter table public.project_risks enable row level security;
alter table public.project_risk_notes enable row level security;

create policy "Active members can read project risks"
  on public.project_risks for select
  to authenticated
  using (public.is_active_organisation_member(project_risks.organisation_id));

create policy "Owners admins and members can create project risks"
  on public.project_risks for insert
  to authenticated
  with check (public.has_active_organisation_role(project_risks.organisation_id, array['owner', 'admin', 'member']));

create policy "Owners admins and members can update project risks"
  on public.project_risks for update
  to authenticated
  using (public.has_active_organisation_role(project_risks.organisation_id, array['owner', 'admin', 'member']))
  with check (public.has_active_organisation_role(project_risks.organisation_id, array['owner', 'admin', 'member']));

create policy "Active members can read project risk notes"
  on public.project_risk_notes for select
  to authenticated
  using (public.is_active_organisation_member(project_risk_notes.organisation_id));

create policy "Owners admins and members can create project risk notes"
  on public.project_risk_notes for insert
  to authenticated
  with check (public.has_active_organisation_role(project_risk_notes.organisation_id, array['owner', 'admin', 'member']));

create policy "Owners admins and members can update project risk notes"
  on public.project_risk_notes for update
  to authenticated
  using (public.has_active_organisation_role(project_risk_notes.organisation_id, array['owner', 'admin', 'member']))
  with check (public.has_active_organisation_role(project_risk_notes.organisation_id, array['owner', 'admin', 'member']));

create index project_risks_organisation_id_idx on public.project_risks (organisation_id);
create index project_risks_project_id_idx on public.project_risks (project_id);
create index project_risks_risk_ref_idx on public.project_risks (risk_ref);
create index project_risks_status_idx on public.project_risks (status);
create index project_risks_rag_status_idx on public.project_risks (rag_status);
create index project_risks_owner_id_idx on public.project_risks (owner_id);
create index project_risks_review_date_idx on public.project_risks (review_date);
create index project_risks_due_date_idx on public.project_risks (due_date);
create index project_risks_active_project_idx on public.project_risks (project_id, rag_status, review_date, due_date)
  where deleted_at is null and archived_at is null;

create index project_risk_notes_organisation_id_idx on public.project_risk_notes (organisation_id);
create index project_risk_notes_project_id_idx on public.project_risk_notes (project_id);
create index project_risk_notes_risk_id_idx on public.project_risk_notes (risk_id);
create index project_risk_notes_parent_risk_note_id_idx on public.project_risk_notes (parent_risk_note_id);
create index project_risk_notes_attention_level_idx on public.project_risk_notes (attention_level);
create index project_risk_notes_created_at_idx on public.project_risk_notes (created_at desc);
create index project_risk_notes_active_risk_idx on public.project_risk_notes (risk_id, created_at desc)
  where deleted_at is null;

grant select, insert on table public.project_risks, public.project_risk_notes to authenticated;
grant update on table public.project_risks, public.project_risk_notes to authenticated;
grant all privileges on table public.project_risks, public.project_risk_notes to service_role;

revoke all on function public.normalise_project_ref() from public;
revoke all on function public.set_project_risk_audit_fields() from public;
revoke all on function public.set_project_risk_note_audit_fields() from public;
revoke all on function public.prevent_project_risk_scope_update() from public;
revoke all on function public.prevent_project_risk_note_scope_update() from public;
