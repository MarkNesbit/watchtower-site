-- WT-001B foundation API role privileges.
-- auto_expose_new_tables is intentionally not enabled, so expose only the
-- conservative baseline privileges that match the RLS policies.

grant usage on schema public to authenticated, service_role;

grant select on table
  public.profiles,
  public.organisations,
  public.organisation_members,
  public.organisation_settings,
  public.feature_flags,
  public.audit_log
to authenticated;

grant update (
  name,
  updated_at,
  archived_at,
  deleted_at
) on public.organisations to authenticated;

grant update (
  role,
  status,
  invited_by,
  invited_at,
  joined_at,
  updated_at
) on public.organisation_members to authenticated;

grant update (
  allow_user_display_name_editing,
  require_mfa,
  default_member_role,
  allow_member_project_creation,
  allow_member_data_upload,
  updated_at
) on public.organisation_settings to authenticated;

-- Keep operational access available to Supabase service-role processes only.
-- Application code must not expose or rely on the service-role key.
grant all privileges on table
  public.profiles,
  public.organisations,
  public.organisation_members,
  public.organisation_settings,
  public.feature_flags,
  public.audit_log
to service_role;

revoke all on function public.is_active_organisation_member(uuid, uuid) from public;
revoke all on function public.has_active_organisation_role(uuid, text[], uuid) from public;
revoke all on function public.prevent_non_owner_organisation_destructive_update() from public;
grant execute on function public.is_active_organisation_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.has_active_organisation_role(uuid, text[], uuid) to authenticated, service_role;
