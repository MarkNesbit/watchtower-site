-- WT-US-0202A project reference code foundation.
-- Tightens project_ref to the MVP 3-4 character rule, enforces workspace uniqueness,
-- enforces workspace/project name uniqueness, and prevents post-creation project_ref edits.

alter table public.projects
  drop constraint if exists projects_project_ref_format_check;

alter table public.projects
  add constraint projects_project_ref_format_check
  check (project_ref is null or project_ref ~ '^[A-Z][A-Z0-9]{2,3}$');

create unique index if not exists projects_organisation_project_name_key
  on public.projects (organisation_id, lower(btrim(name)));

comment on column public.projects.slug is
  'URL-safe routing identifier within a workspace. Slugs are routing-only and are not user-facing project reference codes.';

comment on column public.projects.project_ref is
  'Short immutable uppercase 3-4 character project reference unique within an organisation/workspace when present. Supports future human-readable references such as Risk-HHH-003. Existing early projects are not backfilled automatically and must be assigned/recreated before Risk records can be created.';

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

  if old.project_ref is distinct from new.project_ref
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Project reference cannot be changed after project creation.' using errcode = '42501';
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

grant insert (
  organisation_id,
  name,
  project_ref,
  slug,
  description,
  status,
  health,
  created_by
) on public.projects to authenticated;

revoke update (project_ref) on public.projects from authenticated;

revoke all on function public.prevent_unauthorised_project_destructive_update() from public;
