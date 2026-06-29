-- WT-TEST-001 internal role simulation for the Mark.Nesbit.Professional test workspace.

alter table public.profiles
  add column is_internal_tester boolean not null default false;

create table public.internal_role_simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  simulated_role text not null,
  is_active boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_role_simulations_role_check check (simulated_role in ('owner', 'admin', 'member', 'viewer')),
  constraint internal_role_simulations_expiry_check check (expires_at > created_at)
);

create unique index internal_role_simulations_one_active_per_user_workspace_idx
  on public.internal_role_simulations (user_id, organisation_id)
  where is_active = true;
create index internal_role_simulations_active_lookup_idx
  on public.internal_role_simulations (user_id, organisation_id, expires_at desc)
  where is_active = true;

create trigger set_internal_role_simulations_updated_at
  before update on public.internal_role_simulations
  for each row execute function public.set_updated_at();

alter table public.internal_role_simulations enable row level security;

create or replace function public.is_internal_tester(target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = target_user_id
      and p.is_internal_tester = true
  );
$$;

create or replace function public.is_internal_role_simulation_workspace(target_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organisations o
    where o.id = target_organisation_id
      and o.slug = 'mark-nesbit-professional-workspace'
      and o.deleted_at is null
      and o.archived_at is null
  );
$$;

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
  select irs.simulated_role
  from public.internal_role_simulations irs
  where irs.organisation_id = target_organisation_id
    and irs.user_id = target_user_id
    and irs.is_active = true
    and irs.expires_at > now()
    and public.is_internal_tester(target_user_id)
    and public.is_internal_role_simulation_workspace(target_organisation_id)
  order by irs.updated_at desc
  limit 1;
$$;

create or replace function public.has_active_organisation_role(
  target_organisation_id uuid,
  allowed_roles text[],
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organisation_members om
    where om.organisation_id = target_organisation_id
      and om.user_id = target_user_id
      and om.status = 'active'
      and coalesce(
        public.active_internal_role_simulation(target_organisation_id, target_user_id),
        om.role
      ) = any(allowed_roles)
  );
$$;

create policy "Internal testers can read their scoped role simulations"
  on public.internal_role_simulations for select
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_internal_tester(auth.uid())
    and public.is_internal_role_simulation_workspace(organisation_id)
  );

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
  );

create policy "Internal testers can reset their scoped role simulations"
  on public.internal_role_simulations for update
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_internal_tester(auth.uid())
    and public.is_internal_role_simulation_workspace(organisation_id)
  )
  with check (
    user_id = auth.uid()
    and public.is_internal_tester(auth.uid())
    and public.is_internal_role_simulation_workspace(organisation_id)
    and simulated_role in ('owner', 'admin', 'member', 'viewer')
  );

grant select on table public.internal_role_simulations to authenticated;
grant insert (
  user_id,
  organisation_id,
  simulated_role,
  is_active,
  expires_at
) on public.internal_role_simulations to authenticated;
grant update (
  is_active,
  updated_at
) on public.internal_role_simulations to authenticated;
grant all privileges on table public.internal_role_simulations to service_role;

revoke all on function public.is_internal_tester(uuid) from public;
revoke all on function public.is_internal_role_simulation_workspace(uuid) from public;
revoke all on function public.active_internal_role_simulation(uuid, uuid) from public;
revoke all on function public.has_active_organisation_role(uuid, text[], uuid) from public;
grant execute on function public.is_internal_tester(uuid) to authenticated, service_role;
grant execute on function public.is_internal_role_simulation_workspace(uuid) to authenticated, service_role;
grant execute on function public.active_internal_role_simulation(uuid, uuid) to authenticated, service_role;
grant execute on function public.has_active_organisation_role(uuid, text[], uuid) to authenticated, service_role;
