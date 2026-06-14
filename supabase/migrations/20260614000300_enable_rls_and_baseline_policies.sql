-- WT-001B foundation RLS: conservative read/update baselines.

alter table public.profiles enable row level security;
alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.organisation_settings enable row level security;
alter table public.feature_flags enable row level security;
alter table public.audit_log enable row level security;

create or replace function public.is_active_organisation_member(target_organisation_id uuid, target_user_id uuid default auth.uid())
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
  );
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
      and om.role = any(allowed_roles)
  );
$$;

create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "Active members can read their organisations"
  on public.organisations for select
  to authenticated
  using (
    public.is_active_organisation_member(organisations.id)
  );

create policy "Owners and admins can update their organisations"
  on public.organisations for update
  to authenticated
  using (
    public.has_active_organisation_role(organisations.id, array['owner', 'admin'])
  )
  with check (
    public.has_active_organisation_role(organisations.id, array['owner', 'admin'])
  );

create policy "Active members can read organisation memberships"
  on public.organisation_members for select
  to authenticated
  using (
    public.is_active_organisation_member(organisation_members.organisation_id)
  );

create policy "Owners and admins can manage non-owner memberships"
  on public.organisation_members for update
  to authenticated
  using (
    role <> 'owner'
    and public.has_active_organisation_role(organisation_members.organisation_id, array['owner', 'admin'])
  )
  with check (
    role <> 'owner'
    and public.has_active_organisation_role(organisation_members.organisation_id, array['owner', 'admin'])
  );

create policy "Active members can read organisation settings"
  on public.organisation_settings for select
  to authenticated
  using (
    public.is_active_organisation_member(organisation_settings.organisation_id)
  );

create policy "Owners and admins can update organisation settings"
  on public.organisation_settings for update
  to authenticated
  using (
    public.has_active_organisation_role(organisation_settings.organisation_id, array['owner', 'admin'])
  )
  with check (
    public.has_active_organisation_role(organisation_settings.organisation_id, array['owner', 'admin'])
  );

create policy "Authenticated users can read enabled global feature flags"
  on public.feature_flags for select
  to authenticated
  using (organisation_id is null and enabled = true);

create policy "Active members can read enabled workspace feature flags"
  on public.feature_flags for select
  to authenticated
  using (
    enabled = true
    and organisation_id is not null
    and public.is_active_organisation_member(feature_flags.organisation_id)
  );

create policy "Owners and admins can read workspace audit logs"
  on public.audit_log for select
  to authenticated
  using (
    organisation_id is not null
    and public.has_active_organisation_role(audit_log.organisation_id, array['owner', 'admin'])
  );

create policy "Users can read their own account audit logs"
  on public.audit_log for select
  to authenticated
  using (organisation_id is null and actor_user_id = auth.uid());
