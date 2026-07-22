alter table public.workspace_membership_export_runs
  add column if not exists export_mode text not null default 'editable',
  add column if not exists superseded_by uuid references auth.users(id) on delete set null,
  add column if not exists takeover_at timestamptz;

alter table public.workspace_membership_export_runs
  drop constraint if exists workspace_membership_export_runs_export_mode_check,
  add constraint workspace_membership_export_runs_export_mode_check
    check (export_mode in ('editable', 'read_only'));

alter table public.workspace_membership_export_runs
  drop constraint if exists workspace_membership_export_runs_read_only_checkout_check,
  add constraint workspace_membership_export_runs_read_only_checkout_check
    check (
      (export_mode = 'editable' and editing_mode = 'checked_out' and checkout_expires_at is not null)
      or (export_mode = 'read_only' and editing_mode = 'none' and checkout_expires_at is null)
    );

alter table public.workspace_membership_export_runs
  add constraint workspace_membership_export_runs_id_organisation_key
  unique (id, organisation_id);

create table public.workspace_membership_export_rows (
  id uuid primary key default gen_random_uuid(),
  export_run_id uuid not null,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  source_row_number integer not null,
  workspace_membership_id uuid not null,
  user_id uuid not null,
  login_name text,
  first_name text,
  last_name text,
  contact_email text,
  workspace_role text not null,
  membership_status text not null,
  invited_at timestamptz,
  invitation_expires_at timestamptz,
  accepted_at timestamptz,
  last_login_at timestamptz,
  added_at timestamptz,
  deactivated_at timestamptz,
  reactivated_at timestamptz,
  row_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workspace_membership_export_rows_export_org_fk
    foreign key (export_run_id, organisation_id)
    references public.workspace_membership_export_runs(id, organisation_id) on delete cascade,
  constraint workspace_membership_export_rows_source_row_positive
    check (source_row_number > 0),
  constraint workspace_membership_export_rows_role_check
    check (workspace_role in ('owner', 'admin', 'member', 'viewer')),
  constraint workspace_membership_export_rows_status_check
    check (membership_status in ('invited', 'invite_expired', 'active', 'suspended', 'deactivated')),
  constraint workspace_membership_export_rows_row_values_object_check
    check (jsonb_typeof(row_values) = 'object'),
  constraint workspace_membership_export_rows_unique_source_row
    unique (export_run_id, source_row_number)
);

create index workspace_membership_export_runs_checkout_idx
  on public.workspace_membership_export_runs (organisation_id, export_mode, status, checkout_expires_at desc)
  where export_mode = 'editable' and status = 'checked_out' and superseded_at is null;

create index workspace_membership_export_rows_run_idx
  on public.workspace_membership_export_rows (export_run_id, source_row_number);

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
      'membership_import_applied',
      'membership_import_failed',
      'membership_export_generated',
      'membership_export_read_only_generated',
      'membership_export_taken_over',
      'membership_export_superseded'
    ));

create or replace function public.current_workspace_membership_snapshot_version(target_organisation_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with snapshot_source as (
    select string_agg(
      concat_ws(
        '|',
        om.id::text,
        om.user_id::text,
        coalesce(p.first_name, ''),
        coalesce(p.last_name, ''),
        coalesce(p.login_name, ''),
        coalesce(p.contact_email, ''),
        coalesce(p.last_login_at::text, ''),
        om.role,
        om.status,
        coalesce(om.invited_at::text, ''),
        coalesce(om.invitation_expires_at::text, ''),
        coalesce(om.accepted_at::text, ''),
        coalesce(om.suspended_at::text, ''),
        coalesce(om.created_at::text, ''),
        coalesce(om.deactivated_at::text, ''),
        coalesce(om.reactivated_at::text, '')
      ),
      E'\n'
      order by lower(coalesce(p.last_name, '')),
        lower(coalesce(p.first_name, '')),
        lower(coalesce(p.login_name, '')),
        om.id::text
    ) as snapshot_text
    from public.organisation_members om
    join public.profiles p on p.id = om.user_id
    where om.organisation_id = target_organisation_id
  )
  select (('x' || substr(md5(coalesce(snapshot_text, 'empty-workspace-membership-snapshot')), 1, 15))::bit(60)::bigint + 1)
  from snapshot_source;
$$;

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
      jsonb_build_object('export_id', prior_export.id, 'snapshot_version', prior_export.membership_snapshot_version),
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
      'membership_snapshot_version', new_export.membership_snapshot_version,
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
    'membership_snapshot_version', new_export.membership_snapshot_version,
    'exported_at', new_export.exported_at,
    'checkout_expires_at', new_export.checkout_expires_at,
    'takeover_of_export_id', new_export.takeover_of_export_id,
    'rows', export_rows
  );
end;
$$;

alter table public.workspace_membership_export_rows enable row level security;

create policy "Owners and admins can read workspace membership export rows"
  on public.workspace_membership_export_rows for select
  to authenticated
  using (public.has_real_active_organisation_role(workspace_membership_export_rows.organisation_id, array['owner', 'admin']));

revoke insert, update on public.workspace_membership_export_runs from authenticated;
grant select on public.workspace_membership_export_runs to authenticated;
grant select on public.workspace_membership_export_rows to authenticated;
grant all privileges on table public.workspace_membership_export_rows to service_role;

revoke all on function public.current_workspace_membership_snapshot_version(uuid) from public;
revoke all on function public.create_workspace_membership_csv_export(uuid, text, uuid) from public;
grant execute on function public.current_workspace_membership_snapshot_version(uuid) to service_role;
grant execute on function public.create_workspace_membership_csv_export(uuid, text, uuid) to authenticated, service_role;

comment on column public.workspace_membership_export_rows.contact_email is
  'Snapshot of profiles.contact_email exported as the CSV email column. The Supabase authentication email mirror is deliberately not exported.';
comment on function public.current_workspace_membership_snapshot_version(uuid) is
  'Deterministic workspace membership snapshot hash over membership UUIDs, profile identity/contact fields, roles and lifecycle timestamps.';
comment on function public.create_workspace_membership_csv_export(uuid, text, uuid) is
  'Creates a versioned Workspace Team CSV export snapshot. Editable mode starts a 24-hour advisory checkout; read_only mode does not affect checkout.';
