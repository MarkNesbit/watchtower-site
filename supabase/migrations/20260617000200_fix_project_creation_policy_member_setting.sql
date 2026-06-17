-- WT-002A follow-up for watchtower-dev after 20260617000100 was applied.
-- Ensure member project creation respects organisation_settings.allow_member_project_creation.

drop policy if exists "Owners admins and members can create projects" on public.projects;
drop policy if exists "Owners admins and permitted members can create projects" on public.projects;

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
