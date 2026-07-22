-- WT-WORKSPACE-TEAM-004-FIX-002 holder undo for editable CSV checkout.
-- The user-facing action is "Undo"; the technical operation is checkout release.
-- Export runs, snapshot rows, import evidence, review decisions and audit evidence are retained.

alter table public.workspace_membership_export_runs
  add column if not exists released_at timestamptz,
  add column if not exists released_by uuid references auth.users(id) on delete set null,
  add column if not exists release_source text,
  add column if not exists release_reason text;

alter table public.workspace_membership_export_runs
  drop constraint if exists workspace_membership_export_runs_status_check,
  add constraint workspace_membership_export_runs_status_check
    check (status in ('generated', 'checked_out', 'released', 'superseded', 'expired', 'cancelled')),
  drop constraint if exists workspace_membership_export_runs_read_only_checkout_check,
  add constraint workspace_membership_export_runs_read_only_checkout_check
    check (
      (
        export_mode = 'editable'
        and (
          (editing_mode = 'checked_out' and checkout_expires_at is not null and released_at is null)
          or (editing_mode = 'none' and checkout_expires_at is not null and released_at is not null)
        )
      )
      or (export_mode = 'read_only' and editing_mode = 'none' and checkout_expires_at is null and released_at is null)
    ),
  drop constraint if exists workspace_membership_export_runs_release_source_check,
  add constraint workspace_membership_export_runs_release_source_check
    check (release_source is null or release_source in ('holder_undo')),
  drop constraint if exists workspace_membership_export_runs_release_reason_not_empty,
  add constraint workspace_membership_export_runs_release_reason_not_empty
    check (release_reason is null or length(btrim(release_reason)) > 0),
  drop constraint if exists workspace_membership_export_runs_released_check,
  add constraint workspace_membership_export_runs_released_check
    check (
      (status = 'released' and released_at is not null and released_by is not null and release_source is not null)
      or (
        status = 'superseded'
        and (
          (released_at is null and released_by is null and release_source is null and release_reason is null)
          or (released_at is not null and released_by is not null and release_source is not null)
        )
      )
      or (status not in ('released', 'superseded') and released_at is null and released_by is null and release_source is null and release_reason is null)
    );

drop index if exists workspace_membership_export_runs_checkout_idx;
create index workspace_membership_export_runs_checkout_idx
  on public.workspace_membership_export_runs (organisation_id, export_mode, status, checkout_expires_at desc)
  where export_mode = 'editable'
    and status = 'checked_out'
    and superseded_at is null
    and released_at is null;

alter table public.workspace_membership_audit_events
  drop constraint if exists workspace_membership_audit_events_event_type_check,
  add constraint workspace_membership_audit_events_event_type_check
    check (event_type in (
      'membership_invited',
      'invitation_expired',
      'membership_activated',
      'membership_suspended',
      'membership_deactivated',
      'membership_reactivated',
      'profile_identity_corrected',
      'membership_import_proposed',
      'membership_import_uploaded',
      'membership_import_validation_failed',
      'membership_import_validated',
      'membership_import_stale_detected',
      'membership_import_superseded_rejected',
      'membership_import_applied',
      'membership_import_failed',
      'membership_export_generated',
      'membership_export_read_only_generated',
      'membership_export_taken_over',
      'membership_export_superseded',
      'workspace_membership_csv_checkout_released',
      'membership_change_approved',
      'membership_change_excluded',
      'membership_deactivation_kept_active',
      'membership_change_decision_revised',
      'membership_change_blocked',
      'membership_change_no_longer_required',
      'membership_change_set_confirmed'
    ));

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

  if checkout_export.export_mode <> 'editable'
     or checkout_export.status <> 'checked_out'
     or checkout_export.editing_mode <> 'checked_out'
     or checkout_export.superseded_at is not null
     or checkout_export.released_at is not null
     or checkout_export.checkout_expires_at <= now()
  then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_NOT_ACTIVE: This editable checkout is no longer active.'
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
    and status = 'checked_out'
    and editing_mode = 'checked_out'
    and superseded_at is null
    and released_at is null
    and checkout_expires_at > now()
    and requested_by = actor.actor_user_id
  returning * into released_export;

  if not found then
    raise exception 'WT_MEMBERSHIP_EXPORT_RELEASE_RACE: The editable checkout changed before it could be released.'
      using errcode = '40001';
  end if;

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

  return released_export.id;
end;
$$;

revoke all on function public.release_workspace_membership_csv_checkout(uuid, uuid, text, text) from public;
grant execute on function public.release_workspace_membership_csv_checkout(uuid, uuid, text, text) to authenticated, service_role;

comment on column public.workspace_membership_export_runs.released_at is
  'Timestamp when the editable checkout holder released the advisory checkout. The export snapshot and CSV evidence remain retained.';
comment on column public.workspace_membership_export_runs.release_source is
  'Technical source for checkout release. The WT-004-FIX-002 user-facing label is Undo; the domain operation remains release checkout.';
comment on function public.release_workspace_membership_csv_checkout(uuid, uuid, text, text) is
  'Holder-only atomic release for the current editable Workspace Team CSV checkout. It retains export rows and audit evidence and never mutates memberships, profiles, auth users, imports or decisions.';
