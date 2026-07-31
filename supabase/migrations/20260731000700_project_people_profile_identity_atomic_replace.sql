-- WT-IDENTITY-MEMBERSHIP-001B follow-up: project responsibilities use profile
-- identity and replacement is atomic, so a failed replacement retains the prior row.

alter table public.project_people
  drop constraint if exists project_people_user_id_fkey;

alter table public.project_people
  add constraint project_people_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade not valid;

comment on column public.project_people.user_id is
  'Immutable profile/person UUID for a real workspace member. Authentication UUIDs remain in organisation_members.auth_user_id and are not stored as project responsibility identity.';

create or replace function public.replace_project_person_assignment(
  p_organisation_id uuid,
  p_project_id uuid,
  p_project_role text,
  p_user_profile_id uuid default null,
  p_demo_person_id uuid default null,
  p_responsibility text default null
)
returns public.project_people
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.project_people;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required for project responsibility assignment.' using errcode = '42501';
  end if;

  if not public.has_active_organisation_role(p_organisation_id, array['owner', 'admin', 'member']) then
    raise exception 'Your workspace role does not permit project responsibility assignment.' using errcode = '42501';
  end if;

  if p_project_role not in (
    'sponsor', 'project_manager', 'delivery_lead', 'product_owner', 'assurance_lead',
    'default_risk_owner', 'default_issue_owner', 'default_dependency_owner',
    'default_assumption_owner', 'finance_stakeholder', 'client_stakeholder', 'project_support'
  ) then
    raise exception 'Select a valid project role.' using errcode = '22023';
  end if;

  if p_user_profile_id is not null and p_demo_person_id is not null then
    raise exception 'Select one person for this responsibility.' using errcode = '22023';
  end if;

  perform 1
  from public.projects project
  where project.id = p_project_id
    and project.organisation_id = p_organisation_id
    and project.deleted_at is null
    and project.archived_at is null
  for update;
  if not found then
    raise exception 'Project not found or you do not have access.' using errcode = 'P0002';
  end if;

  if p_user_profile_id is not null and not exists (
    select 1
    from public.organisation_members membership
    where membership.organisation_id = p_organisation_id
      and membership.user_id = p_user_profile_id
      and membership.status = 'active'
  ) then
    raise exception 'Select an active workspace member for this responsibility.' using errcode = '23503';
  end if;

  if p_demo_person_id is not null and not exists (
    select 1
    from public.workspace_demo_people person
    where person.id = p_demo_person_id
      and person.organisation_id = p_organisation_id
      and person.status = 'active'
      and person.is_demo_person = true
  ) then
    raise exception 'Select an active demo persona for this responsibility.' using errcode = '23503';
  end if;

  perform 1
  from public.project_people assignment
  where assignment.organisation_id = p_organisation_id
    and assignment.project_id = p_project_id
    and assignment.project_role = p_project_role
    and assignment.status = 'active'
  for update;

  update public.project_people assignment
    set status = 'removed'
  where assignment.organisation_id = p_organisation_id
    and assignment.project_id = p_project_id
    and assignment.project_role = p_project_role
    and assignment.status = 'active';

  if p_user_profile_id is null and p_demo_person_id is null then
    return null;
  end if;

  insert into public.project_people (
    organisation_id, project_id, user_id, demo_person_id, project_role,
    responsibility, is_primary, status
  ) values (
    p_organisation_id, p_project_id, p_user_profile_id, p_demo_person_id, p_project_role,
    nullif(btrim(p_responsibility), ''), true, 'active'
  ) returning * into v_assignment;

  return v_assignment;
end;
$$;

revoke all on function public.replace_project_person_assignment(uuid, uuid, text, uuid, uuid, text) from public;
grant execute on function public.replace_project_person_assignment(uuid, uuid, text, uuid, uuid, text) to authenticated;

comment on function public.replace_project_person_assignment(uuid, uuid, text, uuid, uuid, text) is
  'Atomically replaces one project-role responsibility using profile identity for real people. Validation occurs before the prior active row is removed; any insert failure rolls the replacement back.';
