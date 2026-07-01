-- WT-PROJ-DATES-001 structured project dates, comments and timeline readiness.
-- Project dates are setup/timeline records; they do not replace RAID management.

create table public.project_dates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  date_type text not null,
  custom_label text,
  target_date date,
  warning_days integer not null default 14,
  is_key_date boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint project_dates_project_organisation_fk
    foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_dates_type_check
    check (date_type in ('start_date', 'target_end_date', 'review_date', 'uat', 'stage_gate', 'load_test', 'other')),
  constraint project_dates_other_label_check
    check (
      (date_type = 'other' and custom_label is not null and length(btrim(custom_label)) > 0 and length(btrim(custom_label)) <= 120)
      or (date_type <> 'other' and custom_label is null)
    ),
  constraint project_dates_warning_days_check check (warning_days between 1 and 365),
  constraint project_dates_custom_label_trimmed_check check (custom_label is null or custom_label = btrim(custom_label)),
  constraint project_dates_id_project_organisation_key unique (id, project_id, organisation_id)
);

comment on table public.project_dates is
  'Timeline-ready project setup date and milestone records. Project dates are intended to auto-populate the future Project Timeline capability and do not replace RAID records.';
comment on column public.project_dates.warning_days is
  'Warning window in days. MVP defaults to 14; configurable warning periods are future scope.';
comment on column public.project_dates.removed_at is
  'Soft removal timestamp. Comments are preserved when a project date is removed.';

create index project_dates_project_active_idx
  on public.project_dates (organisation_id, project_id, removed_at, date_type, target_date);
create index project_dates_timeline_idx
  on public.project_dates (organisation_id, project_id, target_date)
  where removed_at is null;

create table public.project_date_comments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  project_date_id uuid not null references public.project_dates(id) on delete cascade,
  comment text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint project_date_comments_project_organisation_fk
    foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_date_comments_date_scope_fk
    foreign key (project_date_id, project_id, organisation_id)
    references public.project_dates(id, project_id, organisation_id) on delete cascade,
  constraint project_date_comments_comment_not_empty check (length(btrim(comment)) > 0),
  constraint project_date_comments_comment_length_check check (length(btrim(comment)) <= 1000)
);

comment on table public.project_date_comments is
  'Comments and context for one project date. Comments do not change the date and are preserved unless explicitly soft-removed.';

create index project_date_comments_date_active_idx
  on public.project_date_comments (organisation_id, project_id, project_date_id, removed_at, created_at desc);

create or replace function public.set_project_date_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required for project date audit fields.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
    new.updated_by = auth.uid();
  elsif tg_op = 'UPDATE' then
    if old.organisation_id is distinct from new.organisation_id then
      raise exception 'Project date workspace cannot be changed.' using errcode = '42501';
    end if;
    if old.project_id is distinct from new.project_id then
      raise exception 'Project date project cannot be changed.' using errcode = '42501';
    end if;
    if old.created_by is distinct from new.created_by then
      raise exception 'Project date creator cannot be changed.' using errcode = '42501';
    end if;
    new.updated_by = auth.uid();
  end if;

  return new;
end;
$$;

create trigger set_project_date_audit_fields
  before insert or update on public.project_dates
  for each row execute function public.set_project_date_audit_fields();

create trigger set_project_dates_updated_at
  before update on public.project_dates
  for each row execute function public.set_updated_at();

create trigger set_project_date_comments_updated_at
  before update on public.project_date_comments
  for each row execute function public.set_updated_at();

alter table public.project_dates enable row level security;
alter table public.project_date_comments enable row level security;

create policy "Active members can read project dates"
  on public.project_dates for select
  to authenticated
  using (public.is_active_organisation_member(project_dates.organisation_id));

create policy "Owners admins and members can create project dates"
  on public.project_dates for insert
  to authenticated
  with check (public.has_active_organisation_role(project_dates.organisation_id, array['owner', 'admin', 'member']));

create policy "Owners admins and members can update project dates"
  on public.project_dates for update
  to authenticated
  using (public.has_active_organisation_role(project_dates.organisation_id, array['owner', 'admin', 'member']))
  with check (public.has_active_organisation_role(project_dates.organisation_id, array['owner', 'admin', 'member']));

create policy "Active members can read project date comments"
  on public.project_date_comments for select
  to authenticated
  using (public.is_active_organisation_member(project_date_comments.organisation_id));

create policy "Owners admins members and participants can create project date comments"
  on public.project_date_comments for insert
  to authenticated
  with check (
    public.has_active_organisation_role(project_date_comments.organisation_id, array['owner', 'admin', 'member'])
    or exists (
      select 1
      from public.project_people pp
      where pp.organisation_id = project_date_comments.organisation_id
        and pp.project_id = project_date_comments.project_id
        and pp.status = 'active'
        and pp.user_id = auth.uid()
    )
  );

grant select on table public.project_dates to authenticated;
grant insert (
  organisation_id,
  project_id,
  date_type,
  custom_label,
  target_date,
  warning_days,
  is_key_date
) on public.project_dates to authenticated;
grant update (
  date_type,
  custom_label,
  target_date,
  warning_days,
  is_key_date,
  removed_at,
  updated_at
) on public.project_dates to authenticated;

grant select on table public.project_date_comments to authenticated;
grant insert (
  organisation_id,
  project_id,
  project_date_id,
  comment
) on public.project_date_comments to authenticated;
grant update (
  comment,
  removed_at,
  updated_at
) on public.project_date_comments to authenticated;

grant all privileges on table public.project_dates to service_role;
grant all privileges on table public.project_date_comments to service_role;

revoke all on function public.set_project_date_audit_fields() from public;
