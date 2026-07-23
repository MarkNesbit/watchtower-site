-- WT-WORKSPACE-TEAM-005-FIX-003 exact source snapshot transport.
-- Keep snapshot versions stored as bigint, but return import validation source
-- metadata as decimal text so JSON clients cannot round large identifiers.

create or replace function public.get_workspace_membership_csv_import_source_export(
  target_organisation_id uuid,
  target_export_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  source_export public.workspace_membership_export_runs;
begin
  perform public.workspace_membership_require_admin_actor(target_organisation_id);

  if target_export_id is null then
    return null;
  end if;

  select e.*
    into source_export
  from public.workspace_membership_export_runs as e
  where e.id = target_export_id
    and e.organisation_id = target_organisation_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', source_export.id,
    'organisation_id', source_export.organisation_id,
    'export_mode', source_export.export_mode,
    'status', source_export.status,
    'exported_at', source_export.exported_at,
    'membership_snapshot_version', source_export.membership_snapshot_version::text,
    'checkout_expires_at', source_export.checkout_expires_at,
    'superseded_at', source_export.superseded_at,
    'superseded_by_export_id', source_export.superseded_by_export_id,
    'released_at', source_export.released_at,
    'released_by', source_export.released_by,
    'release_source', source_export.release_source
  );
end;
$$;

create or replace function public.current_workspace_membership_snapshot_version_text(
  target_organisation_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.current_workspace_membership_snapshot_version(target_organisation_id)::text;
$$;

revoke all on function public.get_workspace_membership_csv_import_source_export(uuid, uuid) from public;
grant execute on function public.get_workspace_membership_csv_import_source_export(uuid, uuid) to authenticated, service_role;

revoke all on function public.current_workspace_membership_snapshot_version_text(uuid) from public;
grant execute on function public.current_workspace_membership_snapshot_version_text(uuid) to authenticated, service_role;

comment on function public.get_workspace_membership_csv_import_source_export(uuid, uuid) is
  'Returns Workspace Team CSV source-export metadata for import validation with membership_snapshot_version encoded as decimal text.';
comment on function public.current_workspace_membership_snapshot_version_text(uuid) is
  'Returns the current Workspace Team membership snapshot version as decimal text for JSON-safe import validation.';
