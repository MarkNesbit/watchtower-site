-- WT-WORKSPACE-TEAM-004-FIX-004 exact export snapshot version transport.
-- Keep stored snapshot versions as bigint, but return/audit snapshot metadata as
-- decimal text so JSON clients cannot round large identifiers.

create or replace function public.create_workspace_membership_csv_export(
  target_organisation_id uuid,
  requested_export_mode text default 'editable',
  takeover_export_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor record;
  active_export public.workspace_membership_export_runs;
  prior_export public.workspace_membership_export_runs;
  new_export public.workspace_membership_export_runs;
  snapshot_version bigint;
  checkout_expiry timestamptz;
  correlation_id uuid := gen_random_uuid();
  export_rows jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text, 4004));
  select * into actor from public.workspace_membership_require_admin_actor(target_organisation_id);

  if requested_export_mode not in ('editable', 'read_only') then
    raise exception 'WT_MEMBERSHIP_EXPORT_INVALID_MODE: Export mode must be editable or read_only.' using errcode = '23514';
  end if;

  select *
    into active_export
  from public.workspace_membership_export_runs wer
  where wer.organisation_id = target_organisation_id
    and wer.export_mode = 'editable'
    and wer.status = 'checked_out'
    and wer.superseded_at is null
    and wer.checkout_expires_at > now()
  order by wer.exported_at desc
  limit 1
  for update;

  if requested_export_mode = 'editable' then
    if takeover_export_id is null and active_export.id is not null then
      raise exception 'WT_MEMBERSHIP_EXPORT_ACTIVE_CHECKOUT: An editable Workspace Team export is already checked out.'
        using errcode = '55P03';
    end if;

    if takeover_export_id is not null then
      select *
        into prior_export
      from public.workspace_membership_export_runs wer
      where wer.id = takeover_export_id
        and wer.organisation_id = target_organisation_id
      for update;

      if not found
        or prior_export.export_mode <> 'editable'
        or prior_export.status <> 'checked_out'
        or prior_export.superseded_at is not null
        or prior_export.checkout_expires_at <= now()
      then
        raise exception 'WT_MEMBERSHIP_EXPORT_TAKEOVER_NOT_ACTIVE: The export to take over is no longer active.'
          using errcode = '23514';
      end if;

      if active_export.id is distinct from prior_export.id then
        raise exception 'WT_MEMBERSHIP_EXPORT_TAKEOVER_STALE: The active editable export has changed.'
          using errcode = '40001';
      end if;
    end if;
  end if;

  snapshot_version := public.current_workspace_membership_snapshot_version(target_organisation_id);
  checkout_expiry := case when requested_export_mode = 'editable' then now() + interval '24 hours' else null end;

  insert into public.workspace_membership_export_runs (
    organisation_id,
    requested_by,
    exported_at,
    membership_snapshot_version,
    export_mode,
    editing_mode,
    checkout_expires_at,
    status,
    takeover_of_export_id
  )
  values (
    target_organisation_id,
    actor.actor_user_id,
    now(),
    snapshot_version,
    requested_export_mode,
    case when requested_export_mode = 'editable' then 'checked_out' else 'none' end,
    checkout_expiry,
    case when requested_export_mode = 'editable' then 'checked_out' else 'generated' end,
    prior_export.id
  )
  returning * into new_export;

  insert into public.workspace_membership_export_rows (
    export_run_id,
    organisation_id,
    source_row_number,
    workspace_membership_id,
    user_id,
    login_name,
    first_name,
    last_name,
    contact_email,
    workspace_role,
    membership_status,
    invited_at,
    invitation_expires_at,
    accepted_at,
    last_login_at,
    added_at,
    deactivated_at,
    reactivated_at,
    row_values
  )
  select
    new_export.id,
    target_organisation_id,
    (row_number() over (
      order by lower(coalesce(p.last_name, '')),
        lower(coalesce(p.first_name, '')),
        lower(coalesce(p.login_name, '')),
        om.id::text
    ))::integer as source_row_number,
    om.id,
    om.user_id,
    p.login_name,
    p.first_name,
    p.last_name,
    p.contact_email,
    om.role,
    om.status,
    om.invited_at,
    om.invitation_expires_at,
    om.accepted_at,
    p.last_login_at,
    om.created_at,
    om.deactivated_at,
    om.reactivated_at,
    jsonb_build_object(
      'workspace_membership_id', om.id,
      'user_id', om.user_id,
      'login_name', p.login_name,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'email', p.contact_email,
      'workspace_role', om.role,
      'membership_status', om.status,
      'invited_at', om.invited_at,
      'invitation_expires_at', om.invitation_expires_at,
      'accepted_at', om.accepted_at,
      'last_login_at', p.last_login_at,
      'added_at', om.created_at,
      'deactivated_at', om.deactivated_at,
      'reactivated_at', om.reactivated_at
    )
  from public.organisation_members om
  join public.profiles p on p.id = om.user_id
  where om.organisation_id = target_organisation_id;

  if prior_export.id is not null then
    update public.workspace_membership_export_runs
      set status = 'superseded',
          superseded_at = now(),
          superseded_by = actor.actor_user_id,
          superseded_by_export_id = new_export.id,
          takeover_at = now()
    where id = prior_export.id;

    perform public.record_workspace_membership_audit_event(
      target_organisation_id,
      null,
      null,
      actor.actor_user_id,
      'membership_export_superseded',
      null,
      null,
      jsonb_build_object('export_id', prior_export.id, 'snapshot_version', prior_export.membership_snapshot_version::text),
      jsonb_build_object('superseded_by_export_id', new_export.id, 'takeover_by', actor.actor_user_id),
      'Workspace Team CSV export was superseded by checkout takeover.',
      'workspace_team_csv_export',
      correlation_id
    );

    perform public.record_workspace_membership_audit_event(
      target_organisation_id,
      null,
      null,
      actor.actor_user_id,
      'membership_export_taken_over',
      null,
      null,
      jsonb_build_object('takeover_of_export_id', prior_export.id),
      jsonb_build_object('export_id', new_export.id, 'checkout_expires_at', new_export.checkout_expires_at),
      'Workspace Team CSV editable checkout was taken over.',
      'workspace_team_csv_export',
      correlation_id
    );
  end if;

  perform public.record_workspace_membership_audit_event(
    target_organisation_id,
    null,
    null,
    actor.actor_user_id,
    case
      when requested_export_mode = 'read_only' then 'membership_export_read_only_generated'
      else 'membership_export_generated'
    end,
    null,
    null,
    '{}'::jsonb,
    jsonb_build_object(
      'export_id', new_export.id,
      'export_mode', new_export.export_mode,
      'membership_snapshot_version', new_export.membership_snapshot_version::text,
      'checkout_expires_at', new_export.checkout_expires_at,
      'takeover_of_export_id', new_export.takeover_of_export_id
    ),
    case
      when requested_export_mode = 'read_only' then 'Read-only Workspace Team CSV export generated.'
      else 'Editable Workspace Team CSV export generated with 24-hour advisory checkout.'
    end,
    'workspace_team_csv_export',
    correlation_id
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'source_row_number', wer.source_row_number,
      'workspace_membership_id', wer.workspace_membership_id,
      'user_id', wer.user_id,
      'login_name', wer.login_name,
      'first_name', wer.first_name,
      'last_name', wer.last_name,
      'email', wer.contact_email,
      'workspace_role', wer.workspace_role,
      'membership_status', wer.membership_status,
      'invited_at', wer.invited_at,
      'invitation_expires_at', wer.invitation_expires_at,
      'accepted_at', wer.accepted_at,
      'last_login_at', wer.last_login_at,
      'added_at', wer.added_at,
      'deactivated_at', wer.deactivated_at,
      'reactivated_at', wer.reactivated_at
    )
    order by wer.source_row_number
  ), '[]'::jsonb)
    into export_rows
  from public.workspace_membership_export_rows wer
  where wer.export_run_id = new_export.id;

  return jsonb_build_object(
    'export_id', new_export.id,
    'organisation_id', new_export.organisation_id,
    'export_mode', new_export.export_mode,
    'membership_snapshot_version', new_export.membership_snapshot_version::text,
    'exported_at', new_export.exported_at,
    'checkout_expires_at', new_export.checkout_expires_at,
    'takeover_of_export_id', new_export.takeover_of_export_id,
    'rows', export_rows
  );
end;
$$;

revoke all on function public.create_workspace_membership_csv_export(uuid, text, uuid) from public;
grant execute on function public.create_workspace_membership_csv_export(uuid, text, uuid) to authenticated, service_role;

comment on function public.create_workspace_membership_csv_export(uuid, text, uuid) is
  'Creates a versioned Workspace Team CSV export snapshot. Editable mode starts a 24-hour advisory checkout; snapshot metadata is returned as decimal text for JavaScript-safe transport.';
