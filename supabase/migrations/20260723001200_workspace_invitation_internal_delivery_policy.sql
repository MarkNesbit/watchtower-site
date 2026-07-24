-- WT-WORKSPACE-TEAM-008-FIX-001 immutable internal invitation delivery policy.
-- 20260723001100 has already been applied in production; this migration is the
-- forward-only package for the bounded internal shared-contact delivery policy.

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
      'membership_change_set_confirmed',
      'membership_change_set_reconfirmed',
      'workspace_membership_change_selection_confirmed',
      'membership_addition_applied',
      'profile_identity_correction_applied',
      'membership_deactivation_applied',
      'membership_reactivation_applied',
      'membership_change_application_failed',
      'membership_change_set_applied',
      'membership_change_set_drift_detected',
      'workspace_invitation_prepared',
      'workspace_invitation_delivery_attempted',
      'workspace_invitation_delivered',
      'workspace_invitation_delivery_failed',
      'workspace_invitation_opened',
      'workspace_invitation_expired',
      'workspace_invitation_cancelled',
      'workspace_invitation_superseded',
      'workspace_invitation_accepted',
      'workspace_membership_activated',
      'workspace_invitation_replay_rejected'
    ));

create table if not exists public.workspace_invitation_delivery_policies (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  delivery_strategy text not null default 'normal_smtp',
  internal_alias_base_email text,
  internal_alias_prefix text not null default 'wt',
  forced_recipient_email text,
  configured_by uuid references auth.users(id) on delete set null,
  configured_at timestamptz not null default now(),
  locked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_invitation_delivery_policies_strategy_check
    check (delivery_strategy in ('normal_smtp', 'internal_gmail_alias', 'test_record_only')),
  constraint workspace_invitation_delivery_policies_internal_base_check
    check (
      delivery_strategy <> 'internal_gmail_alias'
      or (
        internal_alias_base_email is not null
        and internal_alias_base_email = lower(btrim(internal_alias_base_email))
        and internal_alias_base_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ),
  constraint workspace_invitation_delivery_policies_forced_recipient_check
    check (
      forced_recipient_email is null
      or (
        forced_recipient_email = lower(btrim(forced_recipient_email))
        and forced_recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    )
);

alter table public.workspace_invitation_delivery_policies
  add column if not exists internal_alias_base_email text,
  add column if not exists internal_alias_prefix text not null default 'wt',
  add column if not exists forced_recipient_email text,
  add column if not exists configured_by uuid references auth.users(id) on delete set null,
  add column if not exists configured_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz not null default now();

create unique index if not exists workspace_membership_invitations_current_auth_email_unique
  on public.workspace_membership_invitations (organisation_id, auth_email)
  where is_current;

drop trigger if exists set_workspace_invitation_delivery_policies_updated_at
  on public.workspace_invitation_delivery_policies;
create trigger set_workspace_invitation_delivery_policies_updated_at
  before update on public.workspace_invitation_delivery_policies
  for each row execute function public.set_updated_at();

create or replace function public.workspace_invitation_internal_alias_base_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'mark.nesbit.professional@gmail.com'::text;
$$;

create or replace function public.workspace_invitation_internal_alias_prefix()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'wt'::text;
$$;

create or replace function public.workspace_invitation_internal_alias_email(
  p_base_email text,
  p_prefix text,
  p_login_name text,
  p_profile_id uuid
)
returns text
language sql
immutable
set search_path = public
as $$
  with normalised as (
    select
      lower(btrim(p_base_email)) as base_email,
      lower(coalesce(nullif(regexp_replace(btrim(p_prefix), '[^a-zA-Z0-9]+', '.', 'g'), ''), 'wt')) as alias_prefix,
      trim(both '.' from regexp_replace(
        lower(coalesce(nullif(btrim(p_login_name), ''), p_profile_id::text)),
        '[^a-z0-9._-]+',
        '.',
        'g'
      )) as login_identity,
      left(replace(p_profile_id::text, '-', ''), 12) as profile_suffix
  )
  select
    split_part(base_email, '@', 1)
    || '+'
    || alias_prefix
    || '.'
    || left(coalesce(nullif(login_identity, ''), profile_suffix), 40)
    || '.'
    || profile_suffix
    || '@'
    || split_part(base_email, '@', 2)
  from normalised;
$$;

create or replace function public.prevent_workspace_invitation_delivery_policy_mutation()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.locked_at is not null then
    raise exception 'WT_INVITATION_POLICY_IMMUTABLE: Workspace invitation delivery policies are immutable after deployment.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_workspace_invitation_delivery_policy_mutation
  on public.workspace_invitation_delivery_policies;

do $$
declare
  v_internal_organisation_id uuid;
  v_internal_organisation_count integer;
  v_total_organisation_count integer;
begin
  select count(*)::integer
    into v_total_organisation_count
  from public.organisations;

  select count(*)::integer
    into v_internal_organisation_count
  from public.organisations as o
  where public.is_internal_role_simulation_workspace(o.id);

  if v_total_organisation_count = 0 then
    raise notice 'WT_INVITATION_INTERNAL_POLICY_SKIPPED: No organisations exist yet; no internal invitation delivery policy row was seeded.';
  elsif v_internal_organisation_count = 0 then
    raise exception 'WT_INVITATION_INTERNAL_POLICY_NOT_FOUND: The internal invitation delivery policy seed could not resolve the configured internal workspace.' using errcode = '23514';
  elsif v_internal_organisation_count > 1 then
    raise exception 'WT_INVITATION_INTERNAL_POLICY_AMBIGUOUS: The internal invitation delivery policy seed resolved more than one internal workspace.' using errcode = '23514';
  else
    select o.id
      into v_internal_organisation_id
    from public.organisations as o
    where public.is_internal_role_simulation_workspace(o.id)
    limit 1;

    insert into public.workspace_invitation_delivery_policies (
      organisation_id,
      delivery_strategy,
      internal_alias_base_email,
      internal_alias_prefix,
      forced_recipient_email,
      locked_at
    )
    values (
      v_internal_organisation_id,
      'internal_gmail_alias',
      public.workspace_invitation_internal_alias_base_email(),
      public.workspace_invitation_internal_alias_prefix(),
      null,
      now()
    )
    on conflict (organisation_id) do update
      set delivery_strategy = excluded.delivery_strategy,
          internal_alias_base_email = excluded.internal_alias_base_email,
          internal_alias_prefix = excluded.internal_alias_prefix,
          forced_recipient_email = excluded.forced_recipient_email,
          locked_at = coalesce(public.workspace_invitation_delivery_policies.locked_at, excluded.locked_at);
  end if;
end;
$$;

create trigger prevent_workspace_invitation_delivery_policy_mutation
  before update or delete on public.workspace_invitation_delivery_policies
  for each row execute function public.prevent_workspace_invitation_delivery_policy_mutation();

create or replace function public.prepare_workspace_membership_invitations(
  p_organisation_id uuid,
  p_membership_ids uuid[] default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_token_hashes jsonb default '{}'::jsonb
)
returns table (
  invitation_id uuid,
  membership_id uuid,
  profile_id uuid,
  status text,
  recipient_email text,
  delivery_strategy text,
  failure_code text,
  failure_message text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_row record;
  v_policy public.workspace_invitation_delivery_policies;
  v_handoff public.workspace_membership_invitation_handoffs;
  v_current public.workspace_membership_invitations;
  v_new public.workspace_membership_invitations;
  v_has_current boolean;
  v_contact_email text;
  v_recipient_email text;
  v_auth_email text;
  v_delivery_strategy text;
  v_token_hash text;
  v_duplicate_contact_count integer;
  v_auth_conflict_count integer;
  v_next_version integer;
  v_failure_code text;
  v_failure_message text;
  v_correlation_id uuid := gen_random_uuid();
begin
  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text, 8008));

  select * into v_policy
  from public.workspace_invitation_delivery_policies as policy
  where policy.organisation_id = p_organisation_id;

  for v_row in
    select
      om.id as membership_id,
      om.organisation_id,
      om.user_id as profile_id,
      om.role,
      om.status as membership_status,
      p.display_name,
      p.login_name,
      p.contact_email,
      p.email as current_auth_email
    from public.organisation_members as om
    join public.profiles as p on p.id = om.user_id
    where om.organisation_id = p_organisation_id
      and (p_membership_ids is null or om.id = any(p_membership_ids))
      and om.status in ('invited', 'invite_expired', 'active')
    order by om.created_at asc
  loop
    select * into v_current
    from public.workspace_membership_invitations as invitation
    where invitation.organisation_id = p_organisation_id
      and invitation.membership_id = v_row.membership_id
      and invitation.is_current
    for update;
    v_has_current := found;

    if v_has_current and v_current.idempotency_key = p_idempotency_key then
      invitation_id := v_current.id;
      membership_id := v_current.membership_id;
      profile_id := v_current.profile_id;
      status := v_current.status;
      recipient_email := v_current.recipient_email;
      delivery_strategy := v_current.delivery_strategy;
      failure_code := v_current.failure_code;
      failure_message := v_current.failure_message;
      return next;
      continue;
    end if;

    v_failure_code := null;
    v_failure_message := null;
    v_contact_email := lower(nullif(btrim(v_row.contact_email), ''));
    v_delivery_strategy := coalesce(v_policy.delivery_strategy, 'normal_smtp');

    if v_row.membership_status = 'active' then
      v_failure_code := 'membership_already_active';
      v_failure_message := 'This membership is already active. Delivery cannot activate it again.';
    elsif v_contact_email is null then
      v_failure_code := 'contact_email_required';
      v_failure_message := 'This invited membership does not have a valid contact email.';
    end if;

    if v_failure_code is null then
      select count(*)::integer
        into v_duplicate_contact_count
      from public.profiles as p
      join public.organisation_members as om on om.user_id = p.id
      where om.organisation_id = p_organisation_id
        and om.status in ('invited', 'invite_expired', 'active')
        and lower(p.contact_email) = v_contact_email;

      if v_duplicate_contact_count > 1 and v_delivery_strategy <> 'internal_gmail_alias' then
        v_failure_code := 'shared_contact_policy_required';
        v_failure_message := 'Multiple invited people share this contact email. Configure an immutable internal delivery policy before sending.';
      end if;
    end if;

    if v_failure_code is null and v_delivery_strategy = 'internal_gmail_alias' then
      if v_policy.organisation_id is distinct from p_organisation_id or v_policy.locked_at is null then
        v_failure_code := 'internal_policy_workspace_mismatch';
        v_failure_message := 'Internal alias delivery is only available through the locked internal invitation delivery policy.';
      else
        v_auth_email := public.workspace_invitation_internal_alias_email(
          v_policy.internal_alias_base_email,
          v_policy.internal_alias_prefix,
          v_row.login_name,
          v_row.profile_id
        );
        v_recipient_email := v_auth_email;
      end if;
    elsif v_failure_code is null then
      v_auth_email := v_contact_email;
      v_recipient_email := v_contact_email;
    end if;

    if v_failure_code is null then
      select count(*)::integer
        into v_auth_conflict_count
      from auth.users as au
      where lower(au.email) = v_auth_email
        and au.id <> v_row.profile_id;

      if v_auth_conflict_count > 0 then
        v_failure_code := 'existing_account_link_required';
        v_failure_message := 'A verified account already uses this authentication email. A deliberate account-linking journey is required.';
      end if;
    end if;

    if v_failure_code is null then
      v_token_hash := p_token_hashes ->> v_row.membership_id::text;
      if v_token_hash is null or v_token_hash !~ '^[a-f0-9]{64}$' then
        v_failure_code := 'token_hash_required';
        v_failure_message := 'A server-generated token hash is required before invitation delivery.';
      end if;
    else
      v_token_hash := null;
      v_recipient_email := coalesce(v_recipient_email, v_contact_email, 'blocked@example.invalid');
      v_auth_email := coalesce(v_auth_email, v_row.current_auth_email, 'blocked@example.invalid');
    end if;

    if v_has_current then
      update public.workspace_membership_invitations as invitation
        set is_current = false,
            status = 'superseded',
            superseded_at = now(),
            token_hash = null
      where invitation.id = v_current.id;

      perform public.record_workspace_membership_audit_event(
        p_organisation_id,
        v_current.membership_id,
        v_current.profile_id,
        v_actor.actor_user_id,
        'workspace_invitation_superseded',
        v_current.status,
        'superseded',
        jsonb_build_object('invitation_id', v_current.id, 'version', v_current.invitation_version),
        jsonb_build_object('membership_id', v_current.membership_id),
        'A new invitation version superseded the previous current invitation.',
        'workspace_invitation',
        v_correlation_id
      );
    end if;

    v_next_version := coalesce(v_current.invitation_version, 0) + 1;

    select * into v_handoff
    from public.workspace_membership_invitation_handoffs as handoff
    where handoff.organisation_id = p_organisation_id
      and handoff.organisation_membership_id = v_row.membership_id
    order by handoff.created_at desc
    limit 1;

    insert into public.workspace_membership_invitations (
      organisation_id,
      membership_id,
      profile_id,
      auth_user_id,
      application_run_id,
      handoff_id,
      invitation_version,
      status,
      intended_role,
      recipient_email,
      auth_email,
      delivery_strategy,
      token_hash,
      idempotency_key,
      issued_by,
      issued_at,
      expires_at,
      failure_code,
      failure_message,
      correlation_id
    )
    values (
      p_organisation_id,
      v_row.membership_id,
      v_row.profile_id,
      v_row.profile_id,
      v_handoff.application_run_id,
      v_handoff.id,
      v_next_version,
      case when v_failure_code is null then 'pending_delivery' else 'delivery_failed' end,
      v_row.role,
      v_recipient_email,
      v_auth_email,
      v_delivery_strategy,
      v_token_hash,
      p_idempotency_key,
      v_actor.actor_user_id,
      now(),
      now() + public.workspace_invitation_expiry_interval(),
      v_failure_code,
      v_failure_message,
      v_correlation_id
    )
    returning * into v_new;

    if v_failure_code is null then
      if lower(coalesce(v_row.current_auth_email, '')) ~ '@pending\.watchtower\.invalid$' then
        update auth.users as au
          set email = v_auth_email,
              raw_user_meta_data = coalesce(au.raw_user_meta_data, '{}'::jsonb)
                || jsonb_build_object(
                  'watchtower_invitation_prepared', true,
                  'watchtower_invitation_id', v_new.id,
                  'organisation_id', p_organisation_id
                ),
              updated_at = now()
        where au.id = v_row.profile_id;

        update public.profiles as profile
          set email = v_auth_email,
              updated_by = v_actor.actor_user_id,
              updated_at = now()
        where profile.id = v_row.profile_id;
      end if;

      update public.organisation_members as om
        set invitation_expires_at = v_new.expires_at,
            updated_by = v_actor.actor_user_id,
            updated_at = now()
      where om.id = v_row.membership_id;

      update public.workspace_membership_invitation_handoffs as handoff
        set status = 'sent'
      where handoff.id = v_handoff.id;
    end if;

    perform public.record_workspace_membership_audit_event(
      p_organisation_id,
      v_row.membership_id,
      v_row.profile_id,
      v_actor.actor_user_id,
      'workspace_invitation_prepared',
      null,
      v_new.status,
      jsonb_build_object('membership_status', v_row.membership_status),
      jsonb_build_object(
        'invitation_id', v_new.id,
        'version', v_new.invitation_version,
        'delivery_strategy', v_new.delivery_strategy,
        'recipient_domain', split_part(v_new.recipient_email, '@', 2),
        'expires_at', v_new.expires_at,
        'failure_code', v_failure_code
      ),
      case when v_failure_code is null then 'Invitation prepared for delivery.' else v_failure_message end,
      'workspace_invitation',
      v_correlation_id
    );

    invitation_id := v_new.id;
    membership_id := v_new.membership_id;
    profile_id := v_new.profile_id;
    status := v_new.status;
    recipient_email := v_new.recipient_email;
    delivery_strategy := v_new.delivery_strategy;
    failure_code := v_new.failure_code;
    failure_message := v_new.failure_message;
    return next;
  end loop;
end;
$$;

alter table public.workspace_invitation_delivery_policies enable row level security;

drop policy if exists workspace_invitation_delivery_policies_select
  on public.workspace_invitation_delivery_policies;

revoke all on public.workspace_invitation_delivery_policies from public;
revoke all on public.workspace_invitation_delivery_policies from authenticated;
grant all on public.workspace_invitation_delivery_policies to service_role;

revoke all on function public.workspace_invitation_internal_alias_base_email() from public;
revoke all on function public.workspace_invitation_internal_alias_prefix() from public;
revoke all on function public.workspace_invitation_internal_alias_email(text, text, text, uuid) from public;
revoke all on function public.prevent_workspace_invitation_delivery_policy_mutation() from public;
revoke all on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb) from public;
grant execute on function public.workspace_invitation_internal_alias_base_email() to service_role;
grant execute on function public.workspace_invitation_internal_alias_prefix() to service_role;
grant execute on function public.workspace_invitation_internal_alias_email(text, text, text, uuid) to service_role;
grant execute on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb) to authenticated, service_role;

comment on table public.workspace_invitation_delivery_policies is
  'Immutable workspace invitation delivery policy foundation. The internal row is seeded by 20260723001200 from server-side internal configuration, stored by organisation_id, locked against update/delete, and cannot be inferred at runtime from workspace name, slug, domain or duplicate contact email.';
comment on function public.workspace_invitation_internal_alias_email(text, text, text, uuid) is
  'Builds the bounded internal auth/delivery alias from the configured base mailbox, policy prefix, login identity and profile UUID suffix. Contact email is never used.';
comment on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb) is
  'Owner/Admin-only invitation preparation RPC. It derives profile, membership, role and contact evidence server-side, uses only locked policy rows for internal alias delivery, and never accepts role/profile identity from the browser.';
