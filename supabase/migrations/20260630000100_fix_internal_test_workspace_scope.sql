-- WT-TEST-002A production repair for internal test workspace scoping.
-- The active production Mark.Nesbit.Professional workspace slug is
-- mark-nesbit-professional-workspace. The previous short slug is not accepted.

create or replace function public.internal_test_workspace_slug()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'mark-nesbit-professional-workspace'::text;
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
      and o.slug = public.internal_test_workspace_slug()
      and o.deleted_at is null
      and o.archived_at is null
  );
$$;

revoke all on function public.internal_test_workspace_slug() from public;
revoke all on function public.is_internal_role_simulation_workspace(uuid) from public;
grant execute on function public.internal_test_workspace_slug() to authenticated, service_role;
grant execute on function public.is_internal_role_simulation_workspace(uuid) to authenticated, service_role;
