-- WT-WORKSPACE-TEAM-005 CSV upload validation evidence.
-- This extends the WT-002 import foundation only; it does not apply membership changes.

alter table public.workspace_membership_import_runs
  add column if not exists original_filename text,
  add column if not exists file_size_bytes bigint,
  add column if not exists file_hash text,
  add column if not exists source_export_mode text,
  add column if not exists live_snapshot_version bigint,
  add column if not exists checkout_expired boolean not null default false,
  add column if not exists source_stale boolean not null default false,
  add column if not exists source_superseded boolean not null default false,
  add column if not exists validation_summary jsonb not null default '{}'::jsonb,
  add column if not exists total_rows integer not null default 0,
  add column if not exists valid_row_count integer not null default 0,
  add column if not exists invalid_row_count integer not null default 0,
  add column if not exists warning_count integer not null default 0,
  add column if not exists unchanged_count integer not null default 0,
  add column if not exists addition_count integer not null default 0,
  add column if not exists identity_correction_count integer not null default 0,
  add column if not exists name_correction_count integer not null default 0,
  add column if not exists email_correction_count integer not null default 0,
  add column if not exists deactivation_count integer not null default 0,
  add column if not exists reactivation_count integer not null default 0,
  add column if not exists failure_code text;

alter table public.workspace_membership_import_runs
  drop constraint if exists workspace_membership_import_runs_status_check,
  add constraint workspace_membership_import_runs_status_check
    check (status in (
      'uploaded',
      'parsing',
      'validated',
      'stale_review_required',
      'validation_failed',
      'comparison_completed',
      'approval_pending',
      'applied',
      'failed',
      'superseded',
      'cancelled'
    )),
  drop constraint if exists workspace_membership_import_runs_file_size_positive,
  add constraint workspace_membership_import_runs_file_size_positive
    check (file_size_bytes is null or file_size_bytes >= 0),
  drop constraint if exists workspace_membership_import_runs_live_snapshot_positive,
  add constraint workspace_membership_import_runs_live_snapshot_positive
    check (live_snapshot_version is null or live_snapshot_version > 0),
  drop constraint if exists workspace_membership_import_runs_validation_summary_object,
  add constraint workspace_membership_import_runs_validation_summary_object
    check (jsonb_typeof(validation_summary) = 'object'),
  drop constraint if exists workspace_membership_import_runs_count_non_negative,
  add constraint workspace_membership_import_runs_count_non_negative
    check (
      total_rows >= 0
      and valid_row_count >= 0
      and invalid_row_count >= 0
      and warning_count >= 0
      and unchanged_count >= 0
      and addition_count >= 0
      and identity_correction_count >= 0
      and name_correction_count >= 0
      and email_correction_count >= 0
      and deactivation_count >= 0
      and reactivation_count >= 0
    );

alter table public.workspace_membership_import_rows
  add column if not exists supplied_user_id uuid,
  add column if not exists raw_values jsonb not null default '{}'::jsonb,
  add column if not exists normalised_values jsonb not null default '{}'::jsonb,
  add column if not exists source_export_values jsonb not null default '{}'::jsonb,
  add column if not exists live_values jsonb not null default '{}'::jsonb,
  add column if not exists field_differences jsonb not null default '[]'::jsonb,
  add column if not exists is_unchanged boolean not null default false,
  add column if not exists formula_safety jsonb not null default '{}'::jsonb;

alter table public.workspace_membership_import_rows
  drop constraint if exists workspace_membership_import_rows_change_type_check,
  add constraint workspace_membership_import_rows_change_type_check
    check (proposed_change_type in (
      'addition',
      'identity_correction',
      'deactivation',
      'reactivation',
      'unchanged',
      'invalid',
      'add',
      'update_profile',
      'suspend',
      'expire_invitation',
      'activate',
      'no_change'
    )),
  drop constraint if exists workspace_membership_import_rows_json_shape_check,
  add constraint workspace_membership_import_rows_json_shape_check
    check (
      jsonb_typeof(parsed_values) = 'object'
      and jsonb_typeof(raw_values) = 'object'
      and jsonb_typeof(normalised_values) = 'object'
      and jsonb_typeof(validation_messages) = 'array'
      and jsonb_typeof(current_values) = 'object'
      and jsonb_typeof(source_export_values) = 'object'
      and jsonb_typeof(live_values) = 'object'
      and jsonb_typeof(proposed_values) = 'object'
      and jsonb_typeof(field_differences) = 'array'
      and jsonb_typeof(formula_safety) = 'object'
    );

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
      'membership_export_superseded'
    ));

create index if not exists workspace_membership_import_runs_source_export_idx
  on public.workspace_membership_import_runs (source_export_id, uploaded_at desc);
create index if not exists workspace_membership_import_rows_change_idx
  on public.workspace_membership_import_rows (import_run_id, proposed_change_type, validation_state);
create index if not exists workspace_membership_import_rows_supplied_ids_idx
  on public.workspace_membership_import_rows (organisation_id, supplied_membership_id, supplied_user_id);

create or replace function public.record_workspace_membership_import_validation(
  target_organisation_id uuid,
  target_source_export_id uuid,
  import_metadata jsonb,
  import_rows jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor record;
  source_export public.workspace_membership_export_runs;
  import_run public.workspace_membership_import_runs;
  row_payload jsonb;
  import_status text := coalesce(nullif(import_metadata->>'status', ''), 'validation_failed');
  correlation_id uuid := gen_random_uuid();
begin
  select * into actor from public.workspace_membership_require_admin_actor(target_organisation_id);

  if target_source_export_id is not null then
    select *
      into source_export
    from public.workspace_membership_export_runs wer
    where wer.id = target_source_export_id
      and wer.organisation_id = target_organisation_id;

    if not found then
      raise exception 'WT_MEMBERSHIP_IMPORT_SOURCE_EXPORT: Source export was not found for this workspace.' using errcode = '42501';
    end if;
  end if;

  if import_status not in ('validated', 'stale_review_required', 'validation_failed', 'superseded') then
    raise exception 'WT_MEMBERSHIP_IMPORT_STATUS: Unsupported import validation status.' using errcode = '23514';
  end if;

  insert into public.workspace_membership_import_runs (
    organisation_id,
    source_export_id,
    uploaded_by,
    uploaded_at,
    original_filename,
    file_size_bytes,
    file_hash,
    source_snapshot_version,
    live_snapshot_version,
    source_export_mode,
    checkout_expired,
    source_stale,
    source_superseded,
    status,
    comparison_completed_at,
    validation_summary,
    total_rows,
    valid_row_count,
    invalid_row_count,
    warning_count,
    unchanged_count,
    addition_count,
    identity_correction_count,
    name_correction_count,
    email_correction_count,
    deactivation_count,
    reactivation_count,
    failure_code,
    failure_message,
    failure_details
  )
  values (
    target_organisation_id,
    target_source_export_id,
    actor.actor_user_id,
    now(),
    nullif(btrim(import_metadata->>'original_filename'), ''),
    nullif(import_metadata->>'file_size_bytes', '')::bigint,
    nullif(btrim(import_metadata->>'file_hash'), ''),
    nullif(import_metadata->>'source_snapshot_version', '')::bigint,
    nullif(import_metadata->>'live_snapshot_version', '')::bigint,
    nullif(btrim(import_metadata->>'source_export_mode'), ''),
    coalesce((import_metadata->>'checkout_expired')::boolean, false),
    coalesce((import_metadata->>'source_stale')::boolean, false),
    coalesce((import_metadata->>'source_superseded')::boolean, false),
    import_status,
    case when import_status in ('validated', 'stale_review_required', 'validation_failed', 'superseded') then now() else null end,
    coalesce(import_metadata->'validation_summary', '{}'::jsonb),
    coalesce(nullif(import_metadata#>>'{validation_summary,total_rows}', '')::integer, 0),
    coalesce(nullif(import_metadata#>>'{validation_summary,valid_rows}', '')::integer, 0),
    coalesce(nullif(import_metadata#>>'{validation_summary,invalid_rows}', '')::integer, 0),
    coalesce(nullif(import_metadata#>>'{validation_summary,warnings}', '')::integer, 0),
    coalesce(nullif(import_metadata#>>'{validation_summary,unchanged}', '')::integer, 0),
    coalesce(nullif(import_metadata#>>'{validation_summary,additions}', '')::integer, 0),
    coalesce(nullif(import_metadata#>>'{validation_summary,identity_corrections}', '')::integer, 0),
    coalesce(nullif(import_metadata#>>'{validation_summary,name_corrections}', '')::integer, 0),
    coalesce(nullif(import_metadata#>>'{validation_summary,email_corrections}', '')::integer, 0),
    coalesce(nullif(import_metadata#>>'{validation_summary,deactivations}', '')::integer, 0),
    coalesce(nullif(import_metadata#>>'{validation_summary,reactivations}', '')::integer, 0),
    nullif(btrim(import_metadata->>'failure_code'), ''),
    nullif(btrim(import_metadata->>'failure_message'), ''),
    coalesce(import_metadata->'failure_details', '{}'::jsonb)
  )
  returning * into import_run;

  for row_payload in
    select value
    from jsonb_array_elements(coalesce(import_rows, '[]'::jsonb))
  loop
    insert into public.workspace_membership_import_rows (
      import_run_id,
      organisation_id,
      source_row_number,
      supplied_membership_id,
      supplied_user_id,
      proposed_change_type,
      parsed_values,
      raw_values,
      normalised_values,
      validation_state,
      validation_messages,
      current_values,
      source_export_values,
      live_values,
      proposed_values,
      field_differences,
      is_unchanged,
      formula_safety,
      apply_status
    )
    values (
      import_run.id,
      target_organisation_id,
      coalesce(nullif(row_payload->>'source_row_number', '')::integer, 1),
      nullif(row_payload->>'supplied_membership_id', '')::uuid,
      nullif(row_payload->>'supplied_user_id', '')::uuid,
      coalesce(nullif(row_payload->>'proposed_change_type', ''), 'invalid'),
      coalesce(row_payload->'normalised_values', '{}'::jsonb),
      coalesce(row_payload->'raw_values', '{}'::jsonb),
      coalesce(row_payload->'normalised_values', '{}'::jsonb),
      coalesce(nullif(row_payload->>'validation_state', ''), 'error'),
      coalesce(row_payload->'validation_messages', '[]'::jsonb),
      coalesce(row_payload->'live_values', '{}'::jsonb),
      coalesce(row_payload->'source_export_values', '{}'::jsonb),
      coalesce(row_payload->'live_values', '{}'::jsonb),
      coalesce(row_payload->'proposed_values', '{}'::jsonb),
      coalesce(row_payload->'field_differences', '[]'::jsonb),
      coalesce((row_payload->>'is_unchanged')::boolean, false),
      coalesce(row_payload->'formula_safety', '{}'::jsonb),
      'not_applied'
    );
  end loop;

  perform public.record_workspace_membership_audit_event(
    target_organisation_id,
    null,
    null,
    actor.actor_user_id,
    'membership_import_uploaded',
    null,
    null,
    '{}'::jsonb,
    jsonb_build_object(
      'import_run_id', import_run.id,
      'source_export_id', target_source_export_id,
      'file_hash', import_run.file_hash,
      'summary', import_run.validation_summary
    ),
    'Workspace Team CSV uploaded for validation.',
    'workspace_team_csv_import',
    correlation_id
  );

  if import_status = 'superseded' then
    perform public.record_workspace_membership_audit_event(
      target_organisation_id,
      null,
      null,
      actor.actor_user_id,
      'membership_import_superseded_rejected',
      null,
      null,
      '{}'::jsonb,
      jsonb_build_object('import_run_id', import_run.id, 'source_export_id', target_source_export_id),
      'Superseded Workspace Team CSV rejected.',
      'workspace_team_csv_import',
      correlation_id
    );
  elsif import_status = 'validation_failed' then
    perform public.record_workspace_membership_audit_event(
      target_organisation_id,
      null,
      null,
      actor.actor_user_id,
      'membership_import_validation_failed',
      null,
      null,
      '{}'::jsonb,
      jsonb_build_object('import_run_id', import_run.id, 'summary', import_run.validation_summary),
      'Workspace Team CSV validation failed.',
      'workspace_team_csv_import',
      correlation_id
    );
  else
    if import_status = 'stale_review_required' then
      perform public.record_workspace_membership_audit_event(
        target_organisation_id,
        null,
        null,
        actor.actor_user_id,
        'membership_import_stale_detected',
        null,
        null,
        '{}'::jsonb,
        jsonb_build_object(
          'import_run_id', import_run.id,
          'source_snapshot_version', import_run.source_snapshot_version,
          'live_snapshot_version', import_run.live_snapshot_version
        ),
        'Workspace Team CSV source snapshot is stale.',
        'workspace_team_csv_import',
        correlation_id
      );
    end if;

    perform public.record_workspace_membership_audit_event(
      target_organisation_id,
      null,
      null,
      actor.actor_user_id,
      'membership_import_validated',
      null,
      null,
      '{}'::jsonb,
      jsonb_build_object('import_run_id', import_run.id, 'summary', import_run.validation_summary),
      'Workspace Team CSV validation completed without applying membership changes.',
      'workspace_team_csv_import',
      correlation_id
    );
  end if;

  return import_run.id;
end;
$$;

revoke insert, update on public.workspace_membership_import_runs from authenticated;
revoke insert, update on public.workspace_membership_import_rows from authenticated;
revoke insert, update on public.workspace_membership_change_decisions from authenticated;
grant select on public.workspace_membership_import_runs to authenticated;
grant select on public.workspace_membership_import_rows to authenticated;
grant select on public.workspace_membership_change_decisions to authenticated;

revoke all on function public.record_workspace_membership_import_validation(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.record_workspace_membership_import_validation(uuid, uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.current_workspace_membership_snapshot_version(uuid) to authenticated, service_role;

comment on column public.workspace_membership_import_runs.file_hash is
  'SHA-256 hash of the uploaded CSV content used for audit and retry traceability; raw file bytes are not stored.';
comment on column public.workspace_membership_import_runs.source_stale is
  'True when the stored source export snapshot differs from the current live Workspace Team snapshot.';
comment on column public.workspace_membership_import_rows.formula_safety is
  'Records whether Watchtower export formula protection was reversed for each field during validation.';
comment on function public.record_workspace_membership_import_validation(uuid, uuid, jsonb, jsonb) is
  'Records Workspace Team CSV import validation evidence and audit events. It never mutates profiles, auth users or memberships.';
