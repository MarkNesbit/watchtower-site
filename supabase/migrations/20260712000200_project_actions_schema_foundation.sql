-- WT-ACTION-001A Project Action schema, references, RLS baseline and immutable history.
-- This migration creates the Action data foundation only. Workflow transition RPCs,
-- UI routes, dashboard signals, and source integrations are deliberately future scope.

create table public.project_action_counters (
  project_id uuid primary key,
  organisation_id uuid not null,
  last_action_number integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_action_counters_project_organisation_fk
    foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_action_counters_last_action_number_check
    check (last_action_number >= 0)
);

comment on table public.project_action_counters is
  'Internal per-project allocator for Project Action numbers. Authenticated clients have no direct access; the Action insert trigger increments the counter atomically.';

create trigger set_project_action_counters_updated_at
  before update on public.project_action_counters
  for each row execute function public.set_updated_at();

create table public.project_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  action_number integer not null,
  action_ref text not null,
  brief text not null,
  status text not null default 'open',
  due_date date not null,
  raiser_id uuid not null references public.profiles(id),
  actioner_id uuid references public.profiles(id),
  acceptance_owner_id uuid not null references public.profiles(id),
  source_type text not null default 'project',
  source_record_id uuid,
  source_ref text,
  source_label text,
  source_context jsonb not null default '{}'::jsonb,
  latest_response text,
  latest_evidence_url text,
  submitted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_actions_project_organisation_fk
    foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_actions_action_number_positive_check
    check (action_number > 0),
  constraint project_actions_action_ref_format_check
    check (action_ref ~ '^Action-[A-Z][A-Z0-9]{2,3}-[0-9]{3,}$'),
  constraint project_actions_brief_not_empty_check
    check (length(btrim(brief)) > 0),
  constraint project_actions_status_check
    check (status in ('open', 'submitted', 'returned_to_raiser', 'rejected_by_actioner', 'returned_to_actioner', 'complete', 'cancelled')),
  constraint project_actions_source_type_check
    check (source_type in ('project', 'risk', 'project_details', 'narrative')),
  constraint project_actions_source_ref_not_empty_check
    check (source_ref is null or length(btrim(source_ref)) > 0),
  constraint project_actions_source_label_not_empty_check
    check (source_label is null or length(btrim(source_label)) > 0),
  constraint project_actions_source_context_object_check
    check (jsonb_typeof(source_context) = 'object'),
  constraint project_actions_latest_response_not_empty_check
    check (latest_response is null or length(btrim(latest_response)) > 0),
  constraint project_actions_latest_evidence_url_safe_check
    check (latest_evidence_url is null or latest_evidence_url ~* '^https?://'),
  constraint project_actions_completed_timestamp_check
    check ((status = 'complete') = (completed_at is not null) or status <> 'complete'),
  constraint project_actions_cancelled_timestamp_check
    check ((status = 'cancelled') = (cancelled_at is not null) or status <> 'cancelled'),
  constraint project_actions_project_sequence_key
    unique (project_id, action_number),
  constraint project_actions_project_ref_key
    unique (project_id, action_ref),
  constraint project_actions_organisation_ref_key
    unique (organisation_id, action_ref),
  constraint project_actions_id_project_organisation_key
    unique (id, project_id, organisation_id)
);

comment on table public.project_actions is
  'Authoritative project Action records for assurance workflow. WT-ACTION-001A creates schema, references, RLS baseline and immutable history only; user-facing workflows arrive in later slices.';
comment on column public.project_actions.action_ref is
  'Human-readable reference in the format Action-{PROJECT_REF}-{NNN}, for example Action-HHH-001.';
comment on column public.project_actions.actioner_id is
  'Nullable assigned Actioner. Eligibility is enforced by later workflow helpers; historical assignment identity is retained if membership later changes.';
comment on column public.project_actions.source_type is
  'MVP source type. Supported values are project, risk, project_details and narrative.';
comment on column public.project_actions.source_context is
  'Structured context for source labels or future source-specific metadata. Must remain a JSON object.';

create or replace function public.prepare_project_action_insert()
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
    raise exception 'Project Action project does not exist.' using errcode = '23503';
  end if;

  if target_project_ref is null then
    raise exception 'Project reference is required before a Project Action can be created.' using errcode = '23514';
  end if;

  if new.raiser_id is null then
    raise exception 'Project Action raiser is required.' using errcode = '23502';
  end if;

  if new.acceptance_owner_id is null then
    new.acceptance_owner_id = new.raiser_id;
  end if;

  new.source_context = coalesce(new.source_context, '{}'::jsonb);

  -- The upsert takes a row-level lock for this project's counter. Issued numbers
  -- are retained for audit readability and cannot be reused by concurrent inserts.
  insert into public.project_action_counters (project_id, organisation_id, last_action_number)
  values (new.project_id, target_organisation_id, 1)
  on conflict (project_id) do update
    set last_action_number = project_action_counters.last_action_number + 1,
        updated_at = now()
  returning last_action_number
    into new.action_number;

  new.organisation_id = target_organisation_id;
  new.action_ref = format(
    'Action-%s-%s',
    target_project_ref,
    lpad(new.action_number::text, 3, '0')
  );

  if auth.uid() is not null then
    new.created_by = auth.uid();
    new.updated_by = auth.uid();
  elsif coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authenticated user is required for Project Action audit fields.' using errcode = '42501';
  elsif new.created_by is null then
    raise exception 'Service-created Project Actions require created_by.' using errcode = '23502';
  end if;

  return new;
end;
$$;

create trigger prepare_project_action_insert
  before insert on public.project_actions
  for each row execute function public.prepare_project_action_insert();

create or replace function public.set_project_action_update_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.updated_by = auth.uid();
  elsif coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authenticated user is required for Project Action audit fields.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger set_project_action_update_audit_fields
  before update on public.project_actions
  for each row execute function public.set_project_action_update_audit_fields();

create trigger set_project_actions_updated_at
  before update on public.project_actions
  for each row execute function public.set_updated_at();

create or replace function public.prevent_project_action_identity_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.organisation_id is distinct from new.organisation_id then
    raise exception 'Project Action workspace cannot be changed.' using errcode = '42501';
  end if;

  if old.project_id is distinct from new.project_id then
    raise exception 'Project Action project cannot be changed.' using errcode = '42501';
  end if;

  if old.action_number is distinct from new.action_number then
    raise exception 'Project Action number cannot be changed.' using errcode = '42501';
  end if;

  if old.action_ref is distinct from new.action_ref then
    raise exception 'Project Action reference cannot be changed.' using errcode = '42501';
  end if;

  if old.raiser_id is distinct from new.raiser_id then
    raise exception 'Project Action raiser cannot be changed.' using errcode = '42501';
  end if;

  if old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'Project Action creation audit identity cannot be changed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger prevent_project_action_identity_update
  before update on public.project_actions
  for each row execute function public.prevent_project_action_identity_update();

create table public.project_action_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  action_id uuid not null references public.project_actions(id),
  event_type text not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  from_status text,
  to_status text,
  reason text,
  response text,
  evidence_url text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now(),
  constraint project_action_history_project_organisation_fk
    foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_action_history_action_scope_fk
    foreign key (action_id, project_id, organisation_id)
    references public.project_actions(id, project_id, organisation_id),
  constraint project_action_history_event_type_check
    check (event_type in ('created', 'assigned', 'unassigned', 'reassigned', 'brief_amended', 'due_date_changed', 'submitted', 'returned_to_raiser', 'rejected_by_actioner', 'returned_to_actioner', 'reissued', 'acceptance_owner_taken_over', 'completed', 'cancelled')),
  constraint project_action_history_from_status_check
    check (from_status is null or from_status in ('open', 'submitted', 'returned_to_raiser', 'rejected_by_actioner', 'returned_to_actioner', 'complete', 'cancelled')),
  constraint project_action_history_to_status_check
    check (to_status is null or to_status in ('open', 'submitted', 'returned_to_raiser', 'rejected_by_actioner', 'returned_to_actioner', 'complete', 'cancelled')),
  constraint project_action_history_reason_not_empty_check
    check (reason is null or length(btrim(reason)) > 0),
  constraint project_action_history_response_not_empty_check
    check (response is null or length(btrim(response)) > 0),
  constraint project_action_history_evidence_url_safe_check
    check (evidence_url is null or evidence_url ~* '^https?://'),
  constraint project_action_history_old_values_object_check
    check (old_values is null or jsonb_typeof(old_values) = 'object'),
  constraint project_action_history_new_values_object_check
    check (new_values is null or jsonb_typeof(new_values) = 'object')
);

comment on table public.project_action_history is
  'Immutable structured workflow history for Project Actions. This is not a general comment thread and is append-only for authenticated users.';

create or replace function public.prevent_project_action_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception 'Project Action history is immutable.' using errcode = '42501';
end;
$$;

create trigger prevent_project_action_history_update
  before update on public.project_action_history
  for each row execute function public.prevent_project_action_history_mutation();

create trigger prevent_project_action_history_delete
  before delete on public.project_action_history
  for each row execute function public.prevent_project_action_history_mutation();

alter table public.project_action_counters enable row level security;
alter table public.project_actions enable row level security;
alter table public.project_action_history enable row level security;

create policy "Active members can read project actions"
  on public.project_actions for select
  to authenticated
  using (public.is_active_organisation_member(project_actions.organisation_id));

create policy "Active members can read project action history"
  on public.project_action_history for select
  to authenticated
  using (public.is_active_organisation_member(project_action_history.organisation_id));

create index project_actions_project_status_due_idx
  on public.project_actions (organisation_id, project_id, status, due_date);
create index project_actions_actioner_status_due_idx
  on public.project_actions (organisation_id, actioner_id, status, due_date)
  where actioner_id is not null;
create index project_actions_acceptance_owner_status_idx
  on public.project_actions (organisation_id, acceptance_owner_id, status, updated_at desc);
create index project_actions_raiser_status_idx
  on public.project_actions (organisation_id, raiser_id, status, updated_at desc);
create index project_actions_source_idx
  on public.project_actions (organisation_id, project_id, source_type, source_record_id)
  where source_record_id is not null;

create index project_action_history_action_created_idx
  on public.project_action_history (action_id, created_at desc);
create index project_action_history_actor_created_idx
  on public.project_action_history (organisation_id, actor_user_id, created_at desc);

grant select on table public.project_actions, public.project_action_history to authenticated;

grant all privileges on table public.project_action_counters to service_role;
grant all privileges on table public.project_actions to service_role;
grant all privileges on table public.project_action_history to service_role;

revoke all on function public.prepare_project_action_insert() from public;
revoke all on function public.set_project_action_update_audit_fields() from public;
revoke all on function public.prevent_project_action_identity_update() from public;
revoke all on function public.prevent_project_action_history_mutation() from public;
