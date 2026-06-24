-- WT-US-0107 feature states and account-level preview access.
-- Preview access is deliberately separate from workspace membership and role.

alter table public.profiles
  add column if not exists can_access_preview_features boolean not null default false;

comment on column public.profiles.can_access_preview_features is
  'Platform-level product preview eligibility. This does not grant workspace membership, bypass RBAC or bypass RLS.';

alter table public.feature_flags
  add column if not exists state text not null default 'hidden';

update public.feature_flags
set state = case when enabled then 'enabled' else 'hidden' end;

alter table public.feature_flags
  add constraint feature_flags_state_check
  check (state in ('hidden', 'disabled', 'preview', 'enabled'));

drop policy if exists "Authenticated users can read enabled global feature flags" on public.feature_flags;
drop policy if exists "Active members can read enabled workspace feature flags" on public.feature_flags;
drop index if exists public.feature_flags_enabled_global_idx;

alter table public.feature_flags
  drop column enabled;

create index feature_flags_state_global_idx
  on public.feature_flags (key, state)
  where organisation_id is null;

create policy "Authenticated users can read global feature flags"
  on public.feature_flags for select
  to authenticated
  using (organisation_id is null);

create policy "Active members can read workspace feature flags"
  on public.feature_flags for select
  to authenticated
  using (
    organisation_id is not null
    and public.is_active_organisation_member(feature_flags.organisation_id)
  );

insert into public.feature_flags (key, name, description, state)
values
  ('projectDiary', 'Project Diary', 'Project diary and delivery narrative capability.', 'hidden'),
  ('riskManagement', 'Risk Management', 'Project risk management capability.', 'preview'),
  ('riskToDiary', 'Risk to Diary', 'Promotion of risk activity into the project diary.', 'hidden'),
  ('attentionItems', 'Attention Items', 'Cross-project attention item capability.', 'hidden'),
  ('healthDashboard', 'Health Dashboard', 'Project health dashboard capability.', 'hidden'),
  ('manualHealthAdjustment', 'Manual Health Adjustment', 'Manual project health adjustment capability.', 'hidden'),
  ('issues', 'Issues', 'Project issue management capability.', 'hidden'),
  ('dependencies', 'Dependencies', 'Project dependency management capability.', 'hidden'),
  ('assumptions', 'Assumptions', 'Project assumption management capability.', 'hidden'),
  ('forecasting', 'Forecasting', 'Delivery forecasting capability.', 'hidden')
on conflict do nothing;
