-- WT-WORKSPACE-TEAM-004-FIX-003 release RPC ambiguity fix.
-- The prior replacement used release_reason as both a parameter and table column,
-- which made unqualified references ambiguous in PL/pgSQL.

drop function if exists public.release_workspace_membership_csv_checkout(uuid, uuid, text, text);

create function public.release_workspace_membership_csv_checkout(
  p_organisation_id uuid,
  p_export_id uuid,
  p_release_reason text default null,
  p_release_source text default 'holder_undo'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_checkout_export public.workspace_membership_export_runs;
  v_released_export public.workspace_membership_export_runs;
  v_release_reason text := nullif(btrim(p_release_reason), '');
  v_released_at timestamptz := now();
  v_correlation_id uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text, 4004));

  select required_admin.actor_user_id
    into v_actor_id
  from public.workspace_membership_require_admin_actor(p_organisation_id) as required_admin;

  if coalesce(p_release_source, '') <> 'holder_undo' then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_SOURCE: Unsupported checkout release source.' using errcode = '23514';
  end if;

  select e.*
    into v_checkout_export
  from public.workspace_membership_export_runs as e
  where e.id = p_export_id
    and e.organisation_id = p_organisation_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_NOT_FOUND: Editable checkout was not found for this workspace.' using errcode = '42501';
  end if;

  if v_checkout_export.released_at is not null or v_checkout_export.status = 'released' then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_ALREADY_RELEASED: This editable checkout has already been released.'
      using errcode = '23514';
  end if;
  if v_checkout_export.superseded_at is not null or v_checkout_export.status = 'superseded' then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_SUPERSEDED: This editable checkout has been superseded.'
      using errcode = '23514';
  end if;
  if v_checkout_export.checkout_expires_at is null then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_NO_ACTIVE_CHECKOUT: This export has no editable checkout expiry.'
      using errcode = '23514';
  end if;
  if v_checkout_export.checkout_expires_at <= v_released_at then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_EXPIRED: This editable checkout has expired.'
      using errcode = '23514';
  end if;
  if v_checkout_export.export_mode <> 'editable'
     or v_checkout_export.status <> 'checked_out'
     or v_checkout_export.editing_mode <> 'checked_out'
  then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_NO_ACTIVE_CHECKOUT: This export is not the current active editable checkout.'
      using errcode = '23514';
  end if;

  if v_checkout_export.requested_by is distinct from v_actor_id then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_HOLDER_ONLY: Only the current checkout holder can undo this editable checkout.'
      using errcode = '42501';
  end if;

  update public.workspace_membership_export_runs as e
    set status = 'released',
        editing_mode = 'none',
        released_at = v_released_at,
        released_by = v_actor_id,
        release_source = p_release_source,
        release_reason = v_release_reason
  where e.id = p_export_id
    and e.organisation_id = p_organisation_id
    and e.requested_by = v_actor_id
    and e.released_at is null
    and e.superseded_at is null
    and e.status = 'checked_out'
    and e.editing_mode = 'checked_out'
    and e.checkout_expires_at > v_released_at
  returning e.* into v_released_export;

  if not found then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_RACE: The editable checkout changed before it could be released.'
      using errcode = '40001';
  end if;

  begin
    perform public.record_workspace_membership_audit_event(
      p_organisation_id,
      null,
      null,
      v_actor_id,
      'workspace_membership_csv_checkout_released',
      'checked_out',
      'released',
      jsonb_build_object(
        'export_id', v_checkout_export.id,
        'previous_holder', v_checkout_export.requested_by,
        'previous_expiry', v_checkout_export.checkout_expires_at,
        'membership_snapshot_version', v_checkout_export.membership_snapshot_version
      ),
      jsonb_build_object(
        'export_id', v_released_export.id,
        'released_by', v_released_export.released_by,
        'released_at', v_released_export.released_at,
        'release_source', v_released_export.release_source,
        'release_reason', v_released_export.release_reason
      ),
      coalesce(v_release_reason, 'Editable Workspace Team CSV checkout released by current holder.'),
      'workspace_team_csv_checkout_release',
      v_correlation_id
    );
  exception
    when others then
      raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_AUDIT_FAILED: Checkout release audit event could not be recorded. %', sqlerrm
        using errcode = '23514';
  end;

  return v_released_export.id;
end;
$$;

revoke all on function public.release_workspace_membership_csv_checkout(uuid, uuid, text, text) from public;
grant execute on function public.release_workspace_membership_csv_checkout(uuid, uuid, text, text) to authenticated, service_role;

comment on function public.release_workspace_membership_csv_checkout(uuid, uuid, text, text) is
  'Holder-only atomic release for the current editable Workspace Team CSV checkout. Parameter and local names are prefixed to avoid ambiguity with export-run columns.';
