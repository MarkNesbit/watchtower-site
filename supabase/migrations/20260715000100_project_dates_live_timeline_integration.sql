-- WT-TIMELINE-FOUNDATION-004: Live Project Dates integration.
-- Project Dates remain authoritative. The Timeline stores no duplicate events.

alter table public.project_dates
  add column if not exists title text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists description text,
  add column if not exists status text not null default 'scheduled',
  add column if not exists show_on_timeline boolean not null default true;

update public.project_dates
set
  start_date = coalesce(start_date, target_date),
  title = coalesce(
    nullif(btrim(title), ''),
    nullif(btrim(custom_label), ''),
    case date_type
      when 'start_date' then 'Project start'
      when 'project-start' then 'Project start'
      when 'target_end_date' then 'Target end'
      when 'target-end' then 'Target end'
      when 'review_date' then 'Review'
      when 'review' then 'Review'
      when 'stage_gate' then 'Gateway'
      when 'gateway' then 'Gateway'
      when 'load_test' then 'Load testing'
      when 'load-testing' then 'Load testing'
      when 'uat' then 'UAT'
      else 'Project date'
    end
  ),
  status = coalesce(nullif(status, ''), 'scheduled'),
  show_on_timeline = coalesce(show_on_timeline, true);

alter table public.project_dates
  alter column title set not null;

update public.project_dates
set date_type = case date_type
  when 'start_date' then 'project-start'
  when 'target_end_date' then 'target-end'
  when 'review_date' then 'review'
  when 'stage_gate' then 'gateway'
  when 'load_test' then 'load-testing'
  else date_type
end;

alter table public.project_dates
  drop constraint if exists project_dates_type_check,
  drop constraint if exists project_dates_other_label_check,
  drop constraint if exists project_dates_custom_label_trimmed_check,
  drop constraint if exists project_dates_title_check,
  drop constraint if exists project_dates_description_check,
  drop constraint if exists project_dates_status_check,
  drop constraint if exists project_dates_range_check;

alter table public.project_dates
  add constraint project_dates_type_check
    check (date_type in (
      'project-start',
      'target-end',
      'review',
      'gateway',
      'milestone',
      'uat',
      'testing',
      'load-testing',
      'integration',
      'deployment',
      'cutover',
      'training',
      'go-live',
      'hypercare',
      'other'
    )),
  add constraint project_dates_custom_label_trimmed_check
    check (custom_label is null or (custom_label = btrim(custom_label) and length(custom_label) between 1 and 120)),
  add constraint project_dates_title_check
    check (title = btrim(title) and length(title) between 1 and 160),
  add constraint project_dates_description_check
    check (description is null or (description = btrim(description) and length(description) <= 500)),
  add constraint project_dates_status_check
    check (status in ('scheduled', 'upcoming', 'started', 'complete', 'delayed', 'at-risk', 'cancelled')),
  add constraint project_dates_range_check
    check (end_date is null or start_date is null or end_date >= start_date);

comment on column public.project_dates.title is
  'User-facing Project Date title shown in Project Details and projected onto the Timeline.';
comment on column public.project_dates.start_date is
  'Required by the application for new Project Dates. Backfilled from legacy target_date for existing records.';
comment on column public.project_dates.end_date is
  'Optional inclusive end date. Null or same-day end dates project to point Timeline events.';
comment on column public.project_dates.description is
  'Optional short delivery context used by Project Details and Timeline summaries.';
comment on column public.project_dates.status is
  'Project Date lifecycle status. Category and status remain separate.';
comment on column public.project_dates.show_on_timeline is
  'When false, the Project Date remains in Project Details but is excluded from Timeline projection.';

drop index if exists public.project_dates_timeline_idx;
create index project_dates_timeline_idx
  on public.project_dates (organisation_id, project_id, show_on_timeline, start_date, end_date)
  where removed_at is null;

grant insert (
  title,
  start_date,
  end_date,
  description,
  status,
  show_on_timeline
) on public.project_dates to authenticated;

grant update (
  title,
  start_date,
  end_date,
  description,
  status,
  show_on_timeline
) on public.project_dates to authenticated;
