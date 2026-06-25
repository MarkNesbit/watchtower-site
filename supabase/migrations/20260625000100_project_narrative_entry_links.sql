-- WT-NARRATIVE-003 manual Project Narrative entry links.
-- Adds structured hyperlinks attached to project narrative entries with workspace/project RLS.

alter table public.project_narrative_entries
  add constraint project_narrative_entries_id_project_organisation_key
  unique (id, project_id, organisation_id);

create table public.project_narrative_entry_links (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  narrative_entry_id uuid not null references public.project_narrative_entries(id) on delete cascade,
  label text not null,
  url text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint project_narrative_entry_links_project_organisation_fk
    foreign key (project_id, organisation_id)
    references public.projects(id, organisation_id) on delete cascade,
  constraint project_narrative_entry_links_entry_scope_fk
    foreign key (narrative_entry_id, project_id, organisation_id)
    references public.project_narrative_entries(id, project_id, organisation_id) on delete cascade,
  constraint project_narrative_entry_links_label_not_empty_check
    check (length(btrim(label)) > 0),
  constraint project_narrative_entry_links_url_not_empty_check
    check (length(btrim(url)) > 0),
  constraint project_narrative_entry_links_safe_url_check
    check (url ~* '^https?://')
);

comment on table public.project_narrative_entry_links is
  'Structured hyperlinks attached to Project Narrative entries. Links preserve assurance context and do not create or update RAID records.';
comment on column public.project_narrative_entry_links.narrative_entry_id is
  'Parent Project Narrative entry. Composite scope constraints require the link, entry and project to belong to the same workspace.';
comment on column public.project_narrative_entry_links.url is
  'Validated application link URL. WT-NARRATIVE-003 accepts http and https URLs and rejects unsafe protocols.';

create or replace function public.set_project_narrative_entry_link_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.created_by = auth.uid();
  elsif coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authenticated user is required for Project Narrative link audit fields.' using errcode = '42501';
  elsif new.created_by is null then
    raise exception 'Service-created Project Narrative links require created_by.' using errcode = '23502';
  end if;

  return new;
end;
$$;

create trigger set_project_narrative_entry_link_audit_fields
  before insert on public.project_narrative_entry_links
  for each row execute function public.set_project_narrative_entry_link_audit_fields();

alter table public.project_narrative_entry_links enable row level security;

create policy "Active members can read project narrative entry links"
  on public.project_narrative_entry_links for select
  to authenticated
  using (public.is_active_organisation_member(project_narrative_entry_links.organisation_id));

create policy "Owners admins and members can create project narrative entry links"
  on public.project_narrative_entry_links for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.has_active_organisation_role(
      project_narrative_entry_links.organisation_id,
      array['owner', 'admin', 'member']
    )
  );

create index project_narrative_entry_links_organisation_id_idx
  on public.project_narrative_entry_links (organisation_id);
create index project_narrative_entry_links_project_id_idx
  on public.project_narrative_entry_links (project_id);
create index project_narrative_entry_links_entry_id_idx
  on public.project_narrative_entry_links (narrative_entry_id);

grant select on table public.project_narrative_entry_links to authenticated;
grant insert (
  organisation_id,
  project_id,
  narrative_entry_id,
  label,
  url
) on public.project_narrative_entry_links to authenticated;

grant all privileges on table public.project_narrative_entry_links to service_role;

revoke all on function public.set_project_narrative_entry_link_audit_fields() from public;
