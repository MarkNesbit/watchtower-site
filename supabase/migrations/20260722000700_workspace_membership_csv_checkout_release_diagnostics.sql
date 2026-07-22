-- WT-WORKSPACE-TEAM-004-FIX-003 release diagnostics and checkout audit compatibility.
-- The release audit event records export checkout states, while the original audit
-- status constraints only allowed membership lifecycle states.

alter table public.workspace_membership_audit_events
  drop constraint if exists workspace_membership_audit_events_previous_status_check,
  add constraint workspace_membership_audit_events_previous_status_check
    check (
      previous_status is null
      or previous_status in (
        'invited',
        'invite_expired',
        'active',
        'suspended',
        'deactivated',
        'generated',
        'checked_out',
        'released',
        'superseded',
        'expired',
        'cancelled'
      )
    ),
  drop constraint if exists workspace_membership_audit_events_new_status_check,
  add constraint workspace_membership_audit_events_new_status_check
    check (
      new_status is null
      or new_status in (
        'invited',
        'invite_expired',
        'active',
        'suspended',
        'deactivated',
        'generated',
        'checked_out',
        'released',
        'superseded',
        'expired',
        'cancelled'
      )
    );

create or replace function public.release_workspace_membership_csv_checkout(
  target_organisation_id uuid,
  target_export_id uuid,
  release_reason text default null,
  release_source text default 'holder_undo'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor record;
  checkout_export public.workspace_membership_export_runs;
  released_export public.workspace_membership_export_runs;
  correlation_id uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text, 4004));
  select * into actor from public.workspace_membership_require_admin_actor(target_organisation_id);

  if release_source <> 'holder_undo' then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_SOURCE: Unsupported checkout release source.' using errcode = '23514';
  end if;

  select *
    into checkout_export
  from public.workspace_membership_export_runs wer
  where wer.id = target_export_id
    and wer.organisation_id = target_organisation_id
  for update;

  if not found then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_NOT_FOUND: Editable checkout was not found for this workspace.' using errcode = '42501';
  end if;

  if checkout_export.released_at is not null or checkout_export.status = 'released' then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_ALREADY_RELEASED: This editable checkout has already been released.'
      using errcode = '23514';
  end if;
  if checkout_export.superseded_at is not null or checkout_export.status = 'superseded' then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_SUPERSEDED: This editable checkout has been superseded.'
      using errcode = '23514';
  end if;
  if checkout_export.checkout_expires_at is null then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_NO_ACTIVE_CHECKOUT: This export has no editable checkout expiry.'
      using errcode = '23514';
  end if;
  if checkout_export.checkout_expires_at <= now() then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_EXPIRED: This editable checkout has expired.'
      using errcode = '23514';
  end if;
  if checkout_export.export_mode <> 'editable'
     or checkout_export.status <> 'checked_out'
     or checkout_export.editing_mode <> 'checked_out'
  then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_NO_ACTIVE_CHECKOUT: This export is not the current active editable checkout.'
      using errcode = '23514';
  end if;

  if checkout_export.requested_by is distinct from actor.actor_user_id then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_HOLDER_ONLY: Only the current checkout holder can undo this editable checkout.'
      using errcode = '42501';
  end if;

  update public.workspace_membership_export_runs
    set status = 'released',
        editing_mode = 'none',
        released_at = now(),
        released_by = actor.actor_user_id,
        release_source = 'holder_undo',
        release_reason = nullif(btrim(release_reason), '')
  where id = checkout_export.id
    and organisation_id = target_organisation_id
    and requested_by = actor.actor_user_id
    and released_at is null
    and superseded_at is null
    and status = 'checked_out'
    and editing_mode = 'checked_out'
    and checkout_expires_at > now()
  returning * into released_export;

  if not found then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_RACE: The editable checkout changed before it could be released.'
      using errcode = '40001';
  end if;

  begin
    perform public.record_workspace_membership_audit_event(
      target_organisation_id,
      null,
      null,
      actor.actor_user_id,
      'workspace_membership_csv_checkout_released',
      'checked_out',
      'released',
      jsonb_build_object(
        'export_id', checkout_export.id,
        'previous_holder', checkout_export.requested_by,
        'previous_expiry', checkout_export.checkout_expires_at,
        'membership_snapshot_version', checkout_export.membership_snapshot_version
      ),
      jsonb_build_object(
        'export_id', released_export.id,
        'released_by', released_export.released_by,
        'released_at', released_export.released_at,
        'release_source', released_export.release_source,
        'release_reason', released_export.release_reason
      ),
      coalesce(released_export.release_reason, 'Editable Workspace Team CSV checkout released by current holder.'),
      'workspace_team_csv_checkout_release',
      correlation_id
    );
  exception
    when others then
      raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_AUDIT_FAILED: Checkout release audit event could not be recorded. %', sqlerrm
        using errcode = '23514';
  end;

  return released_export.id;
end;
$$;

revoke all on function public.release_workspace_membership_csv_checkout(uuid, uuid, text, text) from public;
grant execute on function public.release_workspace_membership_csv_checkout(uuid, uuid, text, text) to authenticated, service_role;

comment on constraint workspace_membership_audit_events_previous_status_check on public.workspace_membership_audit_events is
  'Allows membership lifecycle states and Workspace Team CSV export checkout states for audit evidence.';
comment on constraint workspace_membership_audit_events_new_status_check on public.workspace_membership_audit_events is
  'Allows membership lifecycle states and Workspace Team CSV export checkout states for audit evidence.';
comment on function public.release_workspace_membership_csv_checkout(uuid, uuid, text, text) is
  'Holder-only atomic release for the current editable Workspace Team CSV checkout. It records specific controlled errors for inactive, released, superseded, expired, non-holder and audit failure cases.';
