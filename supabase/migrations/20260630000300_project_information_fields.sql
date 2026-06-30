-- WT-PROJ-INFO-001 controlled project information, dates and governance fields.
-- Adds nullable setup fields to projects without changing Project reference, health or RAID records.

alter table public.projects
  add column if not exists project_type text,
  add column if not exists delivery_method text,
  add column if not exists priority text,
  add column if not exists criticality text,
  add column if not exists start_date date,
  add column if not exists target_end_date date,
  add column if not exists next_review_date date,
  add column if not exists review_cadence text,
  add column if not exists governance_route text,
  add column if not exists escalation_route text;

alter table public.projects
  add constraint projects_project_type_check
    check (project_type is null or project_type in ('delivery', 'transformation', 'technology', 'operational', 'compliance', 'other')),
  add constraint projects_delivery_method_check
    check (delivery_method is null or delivery_method in ('waterfall', 'agile', 'hybrid', 'kanban', 'scrum', 'other')),
  add constraint projects_priority_check
    check (priority is null or priority in ('low', 'medium', 'high', 'critical')),
  add constraint projects_criticality_check
    check (criticality is null or criticality in ('low', 'medium', 'high', 'critical')),
  add constraint projects_review_cadence_check
    check (review_cadence is null or review_cadence in ('weekly', 'fortnightly', 'monthly', 'quarterly', 'ad_hoc')),
  add constraint projects_target_end_after_start_check
    check (start_date is null or target_end_date is null or target_end_date >= start_date),
  add constraint projects_governance_route_length_check
    check (governance_route is null or length(btrim(governance_route)) <= 500),
  add constraint projects_escalation_route_length_check
    check (escalation_route is null or length(btrim(escalation_route)) <= 500);

comment on column public.projects.project_type is
  'Controlled project context field for Project Details. Context only; does not create or edit RAID records.';
comment on column public.projects.delivery_method is
  'Controlled delivery approach field for Project Details. Context only; does not replace project execution records.';
comment on column public.projects.priority is
  'Controlled project priority value for setup context and future assurance.';
comment on column public.projects.criticality is
  'Controlled project criticality value for setup context and future assurance.';
comment on column public.projects.start_date is
  'Optional project start date for Project Details.';
comment on column public.projects.target_end_date is
  'Optional target end date. Must not be before start_date when both are set.';
comment on column public.projects.next_review_date is
  'Optional next governance/review date for Project Details.';
comment on column public.projects.review_cadence is
  'Controlled review cadence for governance planning.';
comment on column public.projects.governance_route is
  'Optional trimmed free-text governance route, limited to 500 characters.';
comment on column public.projects.escalation_route is
  'Optional trimmed free-text escalation route, limited to 500 characters.';

grant update (
  project_type,
  delivery_method,
  priority,
  criticality,
  start_date,
  target_end_date,
  next_review_date,
  review_cadence,
  governance_route,
  escalation_route
) on public.projects to authenticated;
