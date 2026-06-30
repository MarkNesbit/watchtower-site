-- WT-TEST-002 workspace-scoped demo people and persona simulation.

create table public.workspace_demo_people (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  display_name text not null,
  email text not null,
  notification_email text not null,
  workspace_role text not null,
  project_role text,
  is_default_risk_owner boolean not null default false,
  is_default_risk_actioner boolean not null default false,
  notes text,
  status text not null default 'active',
  is_demo_person boolean not null default true,
  linked_profile_id uuid references public.profiles(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_demo_people_display_name_not_empty check (length(btrim(display_name)) > 0),
  constraint workspace_demo_people_email_not_empty check (length(btrim(email)) > 0),
  constraint workspace_demo_people_notification_email_not_empty check (length(btrim(notification_email)) > 0),
  constraint workspace_demo_people_workspace_role_check check (workspace_role in ('admin', 'member', 'viewer')),
  constraint workspace_demo_people_status_check check (status in ('active', 'removed')),
  constraint workspace_demo_people_must_be_demo check (is_demo_person = true)
);

create unique index workspace_demo_people_active_email_key
  on public.workspace_demo_people (organisation_id, lower(email))
  where is_demo_person = true and status = 'active';
create index workspace_demo_people_organisation_status_idx
  on public.workspace_demo_people (organisation_id, status, display_name)
  where is_demo_person = true;

create trigger set_workspace_demo_people_updated_at
  before update on public.workspace_demo_people
  for each row execute function public.set_updated_at();

alter table public.internal_role_simulations
  add column demo_person_id uuid references public.workspace_demo_people(id) on delete set null;

alter table public.workspace_demo_people enable row level security;

drop policy if exists "Internal testers can create their scoped role simulations"
  on public.internal_role_simulations;

create policy "Internal testers can create their scoped role simulations"
  on public.internal_role_simulations for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_internal_tester(auth.uid())
    and public.is_internal_role_simulation_workspace(organisation_id)
    and public.is_active_organisation_member(organisation_id, auth.uid())
    and simulated_role in ('owner', 'admin', 'member', 'viewer')
    and is_active = true
    and expires_at > now()
    and expires_at <= now() + interval '4 hours'
    and (
      demo_person_id is null
      or exists (
        select 1
        from public.workspace_demo_people wdp
        where wdp.id = demo_person_id
          and wdp.organisation_id = internal_role_simulations.organisation_id
          and wdp.status = 'active'
          and wdp.is_demo_person = true
      )
    )
  );

create or replace function public.active_internal_role_simulation(
  target_organisation_id uuid,
  target_user_id uuid default auth.uid()
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when irs.demo_person_id is null then irs.simulated_role
    else wdp.workspace_role
  end
  from public.internal_role_simulations irs
  left join public.workspace_demo_people wdp
    on wdp.id = irs.demo_person_id
   and wdp.organisation_id = irs.organisation_id
   and wdp.status = 'active'
   and wdp.is_demo_person = true
  where irs.organisation_id = target_organisation_id
    and irs.user_id = target_user_id
    and irs.is_active = true
    and irs.expires_at > now()
    and public.is_internal_tester(target_user_id)
    and public.is_internal_role_simulation_workspace(target_organisation_id)
    and (irs.demo_person_id is null or wdp.id is not null)
  order by irs.updated_at desc
  limit 1;
$$;

create policy "Internal testers can read scoped demo people"
  on public.workspace_demo_people for select
  to authenticated
  using (
    public.is_internal_tester(auth.uid())
    and public.is_internal_role_simulation_workspace(organisation_id)
    and public.is_active_organisation_member(organisation_id, auth.uid())
    and is_demo_person = true
  );

create policy "Internal testers can import scoped demo people"
  on public.workspace_demo_people for insert
  to authenticated
  with check (
    public.is_internal_tester(auth.uid())
    and public.is_internal_role_simulation_workspace(organisation_id)
    and public.is_active_organisation_member(organisation_id, auth.uid())
    and is_demo_person = true
    and linked_profile_id is null
    and workspace_role in ('admin', 'member', 'viewer')
  );

create policy "Internal testers can replace scoped demo people"
  on public.workspace_demo_people for delete
  to authenticated
  using (
    public.is_internal_tester(auth.uid())
    and public.is_internal_role_simulation_workspace(organisation_id)
    and public.is_active_organisation_member(organisation_id, auth.uid())
    and is_demo_person = true
  );

grant select on table public.workspace_demo_people to authenticated;
grant insert (
  organisation_id,
  display_name,
  email,
  notification_email,
  workspace_role,
  project_role,
  is_default_risk_owner,
  is_default_risk_actioner,
  notes,
  status,
  is_demo_person,
  linked_profile_id
) on public.workspace_demo_people to authenticated;
grant delete on table public.workspace_demo_people to authenticated;
grant all privileges on table public.workspace_demo_people to service_role;

grant insert (
  demo_person_id
) on public.internal_role_simulations to authenticated;
grant update (
  demo_person_id
) on public.internal_role_simulations to authenticated;

revoke all on function public.active_internal_role_simulation(uuid, uuid) from public;
grant execute on function public.active_internal_role_simulation(uuid, uuid) to authenticated, service_role;
