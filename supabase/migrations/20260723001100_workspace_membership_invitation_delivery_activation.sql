-- WT-WORKSPACE-TEAM-008 invitation delivery, acceptance and activation.
-- Invitation state is separate from membership state. Contact email remains
-- communication metadata and is never used by itself as identity.

create extension if not exists pgcrypto with schema extensions;

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
    )),
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
        'cancelled',
        'uploaded',
        'parsing',
        'validation_failed',
        'validated',
        'stale_review_required',
        'comparison_completed',
        'approval_pending',
        'approved_for_application',
        'application_failed_pending_review',
        'applied',
        'failed',
        'pending',
        'approved',
        'excluded',
        'keep_active',
        'blocked',
        'no_longer_required',
        'rejected',
        'skipped',
        'not_started',
        'in_review',
        'ready_for_application',
        'review_blocked',
        'not_applied',
        'requested',
        'applying',
        'drift_detected',
        'rolled_back',
        'already_applied',
        'pending_delivery',
        'sending',
        'delivered',
        'delivery_failed',
        'opened',
        'accepted'
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
        'cancelled',
        'uploaded',
        'parsing',
        'validation_failed',
        'validated',
        'stale_review_required',
        'comparison_completed',
        'approval_pending',
        'approved_for_application',
        'application_failed_pending_review',
        'applied',
        'failed',
        'pending',
        'approved',
        'excluded',
        'keep_active',
        'blocked',
        'no_longer_required',
        'rejected',
        'skipped',
        'not_started',
        'in_review',
        'ready_for_application',
        'review_blocked',
        'not_applied',
        'requested',
        'applying',
        'drift_detected',
        'rolled_back',
        'already_applied',
        'pending_delivery',
        'sending',
        'delivered',
        'delivery_failed',
        'opened',
        'accepted'
      )
    );

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

create trigger set_workspace_invitation_delivery_policies_updated_at
  before update on public.workspace_invitation_delivery_policies
  for each row execute function public.set_updated_at();

create table if not exists public.workspace_membership_invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  membership_id uuid not null references public.organisation_members(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  application_run_id uuid references public.workspace_membership_change_application_runs(id) on delete set null,
  handoff_id uuid references public.workspace_membership_invitation_handoffs(id) on delete set null,
  invitation_version integer not null default 1,
  is_current boolean not null default true,
  status text not null default 'pending_delivery',
  intended_role text not null,
  recipient_email text not null,
  auth_email text not null,
  delivery_strategy text not null default 'normal_smtp',
  token_hash text,
  token_hash_algorithm text not null default 'sha256',
  idempotency_key uuid,
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivery_attempt_count integer not null default 0,
  last_delivery_attempt_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  superseded_at timestamptz,
  superseded_by_invitation_id uuid,
  failure_code text,
  failure_message text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_membership_invitations_role_check
    check (intended_role in ('owner', 'admin', 'member', 'viewer')),
  constraint workspace_membership_invitations_status_check
    check (status in (
      'pending_delivery',
      'sending',
      'delivered',
      'delivery_failed',
      'opened',
      'accepted',
      'expired',
      'cancelled',
      'superseded'
    )),
  constraint workspace_membership_invitations_version_check
    check (invitation_version > 0),
  constraint workspace_membership_invitations_delivery_attempt_count_check
    check (delivery_attempt_count >= 0),
  constraint workspace_membership_invitations_email_check
    check (
      recipient_email = lower(btrim(recipient_email))
      and recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and auth_email = lower(btrim(auth_email))
      and auth_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint workspace_membership_invitations_token_check
    check (token_hash is null or token_hash ~ '^[a-f0-9]{64}$'),
  constraint workspace_membership_invitations_failure_message_check
    check (failure_message is null or length(btrim(failure_message)) > 0),
  constraint workspace_membership_invitations_failure_code_check
    check (failure_code is null or length(btrim(failure_code)) > 0),
  constraint workspace_membership_invitations_accepted_check
    check (status <> 'accepted' or (accepted_at is not null and accepted_by is not null)),
  constraint workspace_membership_invitations_cancelled_check
    check (status <> 'cancelled' or cancelled_at is not null),
  constraint workspace_membership_invitations_superseded_check
    check (status <> 'superseded' or superseded_at is not null)
);

create unique index if not exists workspace_membership_invitations_current_unique
  on public.workspace_membership_invitations (membership_id)
  where is_current;
create unique index if not exists workspace_membership_invitations_token_hash_unique
  on public.workspace_membership_invitations (token_hash)
  where token_hash is not null;
create unique index if not exists workspace_membership_invitations_idempotency_unique
  on public.workspace_membership_invitations (organisation_id, idempotency_key, membership_id)
  where idempotency_key is not null;
create index if not exists workspace_membership_invitations_org_status_idx
  on public.workspace_membership_invitations (organisation_id, status, created_at desc);
create index if not exists workspace_membership_invitations_expiry_idx
  on public.workspace_membership_invitations (expires_at)
  where status in ('pending_delivery', 'sending', 'delivered', 'delivery_failed', 'opened');

create trigger set_workspace_membership_invitations_updated_at
  before update on public.workspace_membership_invitations
  for each row execute function public.set_updated_at();

create or replace function public.workspace_invitation_expiry_interval()
returns interval
language sql
stable
set search_path = public
as $$
  select interval '72 hours';
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
  select lower(
    split_part(p_base_email, '@', 1)
    || '+'
    || coalesce(nullif(btrim(p_prefix), ''), 'wt')
    || '.'
    || left(regexp_replace(coalesce(nullif(btrim(p_login_name), ''), p_profile_id::text), '[^a-zA-Z0-9]+', '.', 'g'), 48)
    || '@'
    || split_part(p_base_email, '@', 2)
  );
$$;

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
      if not coalesce(public.is_internal_role_simulation_workspace(p_organisation_id), false) then
        v_failure_code := 'internal_policy_workspace_mismatch';
        v_failure_message := 'Internal alias delivery is only available to the configured internal test workspace.';
      else
        v_auth_email := public.workspace_invitation_internal_alias_email(
          v_policy.internal_alias_base_email,
          v_policy.internal_alias_prefix,
          v_row.login_name,
          v_row.profile_id
        );
        v_recipient_email := coalesce(v_policy.forced_recipient_email, v_policy.internal_alias_base_email);
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

create or replace function public.record_workspace_membership_invitation_delivery_result(
  p_invitation_id uuid,
  p_delivery_status text,
  p_failure_code text default null,
  p_failure_message text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_invitation public.workspace_membership_invitations;
  v_actor record;
  v_new_status text;
begin
  if p_delivery_status not in ('delivered', 'delivery_failed') then
    raise exception 'WT_INVITATION_DELIVERY_STATUS: Unsupported delivery result.' using errcode = '23514';
  end if;

  select * into v_invitation
  from public.workspace_membership_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'WT_INVITATION_NOT_FOUND: Invitation was not found.' using errcode = '42501';
  end if;

  select * into v_actor from public.workspace_membership_require_admin_actor(v_invitation.organisation_id);

  update public.workspace_membership_invitations as invitation
    set status = p_delivery_status,
        delivery_attempt_count = invitation.delivery_attempt_count + 1,
        last_delivery_attempt_at = now(),
        delivered_at = case when p_delivery_status = 'delivered' then now() else invitation.delivered_at end,
        failure_code = case when p_delivery_status = 'delivery_failed' then p_failure_code else null end,
        failure_message = case when p_delivery_status = 'delivery_failed' then p_failure_message else null end
  where invitation.id = p_invitation_id
  returning status into v_new_status;

  perform public.record_workspace_membership_audit_event(
    v_invitation.organisation_id,
    v_invitation.membership_id,
    v_invitation.profile_id,
    v_actor.actor_user_id,
    case when p_delivery_status = 'delivered' then 'workspace_invitation_delivered' else 'workspace_invitation_delivery_failed' end,
    v_invitation.status,
    p_delivery_status,
    jsonb_build_object('invitation_id', v_invitation.id, 'attempt', v_invitation.delivery_attempt_count + 1),
    jsonb_build_object(
      'delivery_strategy', v_invitation.delivery_strategy,
      'failure_code', p_failure_code,
      'recipient_domain', split_part(v_invitation.recipient_email, '@', 2)
    ),
    case when p_delivery_status = 'delivered' then 'Invitation delivery recorded.' else coalesce(p_failure_message, 'Invitation delivery failed.') end,
    'workspace_invitation_delivery',
    v_invitation.correlation_id
  );
end;
$$;

create or replace function public.cancel_workspace_membership_invitation(
  p_organisation_id uuid,
  p_invitation_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_invitation public.workspace_membership_invitations;
begin
  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);

  select * into v_invitation
  from public.workspace_membership_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.organisation_id = p_organisation_id
    and invitation.is_current
  for update;

  if not found then
    raise exception 'WT_INVITATION_NOT_FOUND: Invitation was not found.' using errcode = '42501';
  end if;

  if v_invitation.status in ('accepted', 'superseded', 'cancelled') then
    perform public.record_workspace_membership_audit_event(
      p_organisation_id,
      v_invitation.membership_id,
      v_invitation.profile_id,
      v_actor.actor_user_id,
      'workspace_invitation_replay_rejected',
      v_invitation.status,
      v_invitation.status,
      jsonb_build_object('invitation_id', v_invitation.id),
      jsonb_build_object('requested_action', 'cancel'),
      'Invitation cancellation replay was rejected.',
      'workspace_invitation',
      v_invitation.correlation_id
    );
    return;
  end if;

  update public.workspace_membership_invitations as invitation
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = v_actor.actor_user_id,
        token_hash = null
  where invitation.id = v_invitation.id;

  perform public.record_workspace_membership_audit_event(
    p_organisation_id,
    v_invitation.membership_id,
    v_invitation.profile_id,
    v_actor.actor_user_id,
    'workspace_invitation_cancelled',
    v_invitation.status,
    'cancelled',
    jsonb_build_object('invitation_id', v_invitation.id),
    jsonb_build_object('membership_remains', 'invited'),
    'Invitation cancelled. Membership remains invited and can receive a new invitation later.',
    'workspace_invitation',
    v_invitation.correlation_id
  );
end;
$$;

create or replace function public.get_workspace_membership_invitation_by_token(
  p_token_hash text
)
returns table (
  invitation_id uuid,
  organisation_id uuid,
  membership_id uuid,
  profile_id uuid,
  auth_user_id uuid,
  workspace_name text,
  workspace_slug text,
  person_name text,
  login_name text,
  intended_role text,
  expires_at timestamptz,
  status text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_invitation public.workspace_membership_invitations;
begin
  select * into v_invitation
  from public.workspace_membership_invitations as invitation
  where invitation.token_hash = p_token_hash
    and invitation.is_current
  for update;

  if not found then
    return;
  end if;

  if v_invitation.expires_at <= now() and v_invitation.status in ('pending_delivery', 'sending', 'delivered', 'delivery_failed', 'opened') then
    update public.workspace_membership_invitations
      set status = 'expired',
          token_hash = null
    where id = v_invitation.id;

    update public.organisation_members as om
      set status = 'invite_expired',
          invitation_expires_at = coalesce(om.invitation_expires_at, v_invitation.expires_at),
          updated_at = now()
    where om.id = v_invitation.membership_id
      and om.status = 'invited';

    perform public.record_workspace_membership_audit_event(
      v_invitation.organisation_id,
      v_invitation.membership_id,
      v_invitation.profile_id,
      null,
      'workspace_invitation_expired',
      v_invitation.status,
      'expired',
      jsonb_build_object('invitation_id', v_invitation.id),
      jsonb_build_object('expires_at', v_invitation.expires_at),
      'Invitation expired before acceptance.',
      'workspace_invitation_acceptance',
      v_invitation.correlation_id
    );
    return;
  end if;

  if v_invitation.status not in ('delivered', 'opened') then
    perform public.record_workspace_membership_audit_event(
      v_invitation.organisation_id,
      v_invitation.membership_id,
      v_invitation.profile_id,
      null,
      'workspace_invitation_replay_rejected',
      v_invitation.status,
      v_invitation.status,
      jsonb_build_object('invitation_id', v_invitation.id),
      jsonb_build_object('requested_action', 'open'),
      'Invitation link replay or invalid state was rejected.',
      'workspace_invitation_acceptance',
      v_invitation.correlation_id
    );
    return;
  end if;

  if v_invitation.status = 'delivered' then
    update public.workspace_membership_invitations
      set status = 'opened',
          opened_at = coalesce(opened_at, now())
    where id = v_invitation.id;

    perform public.record_workspace_membership_audit_event(
      v_invitation.organisation_id,
      v_invitation.membership_id,
      v_invitation.profile_id,
      null,
      'workspace_invitation_opened',
      'delivered',
      'opened',
      jsonb_build_object('invitation_id', v_invitation.id),
      jsonb_build_object('expires_at', v_invitation.expires_at),
      'Invitation link was opened.',
      'workspace_invitation_acceptance',
      v_invitation.correlation_id
    );
  end if;

  return query
  select
    invitation.id,
    invitation.organisation_id,
    invitation.membership_id,
    invitation.profile_id,
    invitation.auth_user_id,
    organisation.name,
    organisation.slug,
    coalesce(nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''), profile.display_name, profile.login_name, 'Invited member'),
    profile.login_name,
    invitation.intended_role,
    invitation.expires_at,
    case when invitation.status = 'delivered' then 'opened' else invitation.status end
  from public.workspace_membership_invitations as invitation
  join public.organisations as organisation on organisation.id = invitation.organisation_id
  join public.profiles as profile on profile.id = invitation.profile_id
  where invitation.id = v_invitation.id;
end;
$$;

create or replace function public.accept_workspace_membership_invitation(
  p_token_hash text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_invitation public.workspace_membership_invitations;
  v_membership public.organisation_members;
begin
  select * into v_invitation
  from public.workspace_membership_invitations as invitation
  where invitation.token_hash = p_token_hash
    and invitation.is_current
  for update;

  if not found then
    raise exception 'WT_INVITATION_INVALID: Invitation is invalid.' using errcode = '42501';
  end if;

  select * into v_membership
  from public.organisation_members as om
  where om.id = v_invitation.membership_id
    and om.organisation_id = v_invitation.organisation_id
  for update;

  if v_invitation.status = 'accepted' or v_membership.status = 'active' then
    perform public.record_workspace_membership_audit_event(
      v_invitation.organisation_id,
      v_invitation.membership_id,
      v_invitation.profile_id,
      auth.uid(),
      'workspace_invitation_replay_rejected',
      v_invitation.status,
      v_invitation.status,
      jsonb_build_object('invitation_id', v_invitation.id),
      jsonb_build_object('requested_action', 'accept'),
      'Invitation acceptance replay was rejected.',
      'workspace_invitation_acceptance',
      v_invitation.correlation_id
    );
    return v_invitation.membership_id;
  end if;

  if v_invitation.status not in ('opened', 'delivered') or v_invitation.expires_at <= now() then
    raise exception 'WT_INVITATION_NOT_ACCEPTABLE: Invitation cannot be accepted.' using errcode = '42501';
  end if;

  if auth.uid() is null or auth.uid() <> v_invitation.auth_user_id then
    raise exception 'WT_INVITATION_WRONG_ACCOUNT: This invitation belongs to another account.' using errcode = '42501';
  end if;

  if v_membership.status not in ('invited', 'invite_expired') then
    raise exception 'WT_INVITATION_MEMBERSHIP_STATE: Membership is not awaiting invitation acceptance.' using errcode = '23514';
  end if;

  update public.workspace_membership_invitations as invitation
    set status = 'accepted',
        accepted_at = now(),
        accepted_by = auth.uid(),
        token_hash = null,
        failure_code = null,
        failure_message = null
  where invitation.id = v_invitation.id;

  update public.organisation_members as om
    set status = 'active',
        accepted_at = now(),
        joined_at = coalesce(om.joined_at, now()),
        updated_by = auth.uid(),
        updated_at = now()
  where om.id = v_invitation.membership_id
    and om.organisation_id = v_invitation.organisation_id
    and om.user_id = v_invitation.profile_id
    and om.role = v_invitation.intended_role
    and om.status in ('invited', 'invite_expired');

  if not found then
    raise exception 'WT_INVITATION_ACTIVATION_FAILED: Membership activation failed.' using errcode = '40001';
  end if;

  perform public.record_workspace_membership_audit_event(
    v_invitation.organisation_id,
    v_invitation.membership_id,
    v_invitation.profile_id,
    auth.uid(),
    'workspace_invitation_accepted',
    v_invitation.status,
    'accepted',
    jsonb_build_object('invitation_id', v_invitation.id, 'role', v_invitation.intended_role),
    jsonb_build_object('membership_status', 'active'),
    'Invitation accepted by the linked auth identity.',
    'workspace_invitation_acceptance',
    v_invitation.correlation_id
  );

  perform public.record_workspace_membership_audit_event(
    v_invitation.organisation_id,
    v_invitation.membership_id,
    v_invitation.profile_id,
    auth.uid(),
    'workspace_membership_activated',
    'invited',
    'active',
    jsonb_build_object('invitation_id', v_invitation.id),
    jsonb_build_object('role', v_invitation.intended_role),
    'Membership activated after secure invitation acceptance.',
    'workspace_invitation_acceptance',
    v_invitation.correlation_id
  );

  return v_invitation.membership_id;
end;
$$;

create or replace view public.workspace_member_admin_directory
as
select
  om.organisation_id,
  om.id as organisation_membership_id,
  p.id as profile_id,
  p.display_name,
  p.first_name,
  p.last_name,
  p.login_name,
  p.contact_email,
  p.email as auth_email,
  om.role,
  om.status as membership_status,
  om.invited_at,
  om.accepted_at,
  om.suspended_at,
  om.deactivated_at,
  om.reactivated_at,
  invitation.id as invitation_id,
  invitation.status as invitation_status,
  invitation.delivered_at as invitation_delivered_at,
  invitation.opened_at as invitation_opened_at,
  invitation.accepted_at as invitation_accepted_at,
  invitation.cancelled_at as invitation_cancelled_at,
  invitation.superseded_at as invitation_superseded_at,
  invitation.delivery_attempt_count as invitation_delivery_attempt_count,
  invitation.last_delivery_attempt_at as invitation_last_delivery_attempt_at,
  invitation.expires_at as invitation_expires_at,
  invitation.failure_code as invitation_failure_code,
  invitation.failure_message as invitation_failure_message,
  invitation.delivery_strategy as invitation_delivery_strategy
from public.organisation_members om
join public.profiles p on p.id = om.user_id
left join public.workspace_membership_invitations invitation
  on invitation.membership_id = om.id
  and invitation.is_current
where public.has_real_active_organisation_role(om.organisation_id, array['owner', 'admin']);

alter table public.workspace_invitation_delivery_policies enable row level security;
alter table public.workspace_membership_invitations enable row level security;

drop policy if exists workspace_invitation_delivery_policies_select on public.workspace_invitation_delivery_policies;
create policy workspace_invitation_delivery_policies_select
  on public.workspace_invitation_delivery_policies for select
  using (public.has_real_active_organisation_role(workspace_invitation_delivery_policies.organisation_id, array['owner', 'admin']));

drop policy if exists workspace_membership_invitations_select_admin on public.workspace_membership_invitations;
create policy workspace_membership_invitations_select_admin
  on public.workspace_membership_invitations for select
  using (public.has_real_active_organisation_role(workspace_membership_invitations.organisation_id, array['owner', 'admin']));

revoke all on public.workspace_invitation_delivery_policies from authenticated;
revoke all on public.workspace_membership_invitations from authenticated;
grant select on public.workspace_invitation_delivery_policies to authenticated;
grant select on public.workspace_membership_invitations to authenticated;
grant all on public.workspace_invitation_delivery_policies to service_role;
grant all on public.workspace_membership_invitations to service_role;

revoke all on function public.workspace_invitation_expiry_interval() from public;
revoke all on function public.workspace_invitation_internal_alias_email(text, text, text, uuid) from public;
revoke all on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb) from public;
revoke all on function public.record_workspace_membership_invitation_delivery_result(uuid, text, text, text) from public;
revoke all on function public.cancel_workspace_membership_invitation(uuid, uuid) from public;
revoke all on function public.get_workspace_membership_invitation_by_token(text) from public;
revoke all on function public.accept_workspace_membership_invitation(text) from public;
grant execute on function public.workspace_invitation_expiry_interval() to authenticated, service_role;
grant execute on function public.workspace_invitation_internal_alias_email(text, text, text, uuid) to authenticated, service_role;
grant execute on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb) to authenticated, service_role;
grant execute on function public.record_workspace_membership_invitation_delivery_result(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.cancel_workspace_membership_invitation(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_workspace_membership_invitation_by_token(text) to anon, authenticated, service_role;
grant execute on function public.accept_workspace_membership_invitation(text) to authenticated, service_role;

comment on table public.workspace_membership_invitations is
  'WT-008 secure per-membership invitation lifecycle. Stores token hashes only; delivery state remains separate from organisation_members.status.';
comment on table public.workspace_invitation_delivery_policies is
  'Immutable workspace invitation delivery policy foundation. Internal alias delivery requires an explicit row and cannot be inferred from workspace name, slug, domain or duplicate contact email.';
comment on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb) is
  'Owner/Admin-only invitation preparation RPC. It derives profile, membership, role and contact evidence server-side and never accepts role/profile identity from the browser.';
comment on function public.accept_workspace_membership_invitation(text) is
  'Accepts one valid invitation token for the linked auth user and transactionally activates the matching membership without role escalation.';
