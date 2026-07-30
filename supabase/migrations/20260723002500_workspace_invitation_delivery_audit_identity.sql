-- WT-008A-FIX-021: keep invitation delivery audit identities in their declared UUID domains.
-- workspace_membership_audit_events.target_user_id references auth.users(id), so
-- invitation delivery, retry/resend preparation and cancellation audit rows must
-- use the current invitation/membership Auth UUID rather than the immutable
-- Watchtower profile UUID.

create or replace function public.prepare_workspace_membership_invitations(
  p_organisation_id uuid,
  p_membership_ids uuid[],
  p_idempotency_key uuid,
  p_token_hashes jsonb,
  p_request_intent text
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
  v_policy_source text;
  v_request_intent text;
  v_token_hash text;
  v_duplicate_contact_count integer;
  v_auth_conflict_count integer;
  v_next_version integer;
  v_failure_code text;
  v_failure_message text;
  v_temporary_auth_email_replaced boolean;
  v_updated_auth_users integer;
  v_updated_profiles integer;
  v_correlation_id uuid := gen_random_uuid();
begin
  v_request_intent := lower(coalesce(nullif(btrim(p_request_intent), ''), 'send'));
  if v_request_intent not in ('send', 'resend', 'retry') then
    raise exception 'WT_INVITATION_REQUEST_INTENT: unsupported invitation request intent %', v_request_intent
      using errcode = '23514';
  end if;

  select * into v_actor from public.workspace_membership_require_admin_actor(p_organisation_id);
  perform pg_advisory_xact_lock(hashtextextended(p_organisation_id::text, 8008));

  select * into v_policy
  from public.workspace_invitation_delivery_policies as policy
  where policy.organisation_id = p_organisation_id;

  v_delivery_strategy := coalesce(v_policy.delivery_strategy, 'normal_smtp');
  v_policy_source := case
    when v_policy.organisation_id is not null and v_policy.locked_at is not null
      then 'workspace_invitation_delivery_policies.locked'
    else 'default_normal_smtp'
  end;

  for v_row in
    select
      om.id as membership_id,
      om.organisation_id,
      om.user_id as profile_id,
      om.auth_user_id,
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

    v_failure_code := null;
    v_failure_message := null;
    v_contact_email := lower(nullif(btrim(v_row.contact_email), ''));
    v_recipient_email := null;
    v_auth_email := null;
    v_temporary_auth_email_replaced := false;

    if v_has_current and v_current.idempotency_key = p_idempotency_key then
      if v_request_intent = 'retry'
        and v_current.status = 'delivery_failed'
        and (
          v_current.delivery_strategy is distinct from v_delivery_strategy
          or v_current.failure_code = 'shared_contact_policy_required'
          or lower(coalesce(v_current.auth_email, '')) ~ '@pending\.watchtower\.invalid$'
        )
      then
        raise exception 'WT_INVITATION_RETRY_OPERATION_KEY: retry_requires_new_operation_key'
          using errcode = '23514';
      end if;

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

    if v_row.membership_status = 'active' then
      v_failure_code := 'membership_already_active';
      v_failure_message := 'This membership is already active. Delivery cannot activate it again.';
    elsif v_row.auth_user_id is null then
      v_failure_code := 'auth_identity_required';
      v_failure_message := 'This invited membership does not have a valid authentication identity.';
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
        and au.id <> v_row.auth_user_id;

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
        v_current.auth_user_id,
        v_actor.actor_user_id,
        'workspace_invitation_superseded',
        v_current.status,
        'superseded',
        jsonb_strip_nulls(jsonb_build_object(
          'invitation_id', v_current.id,
          'profile_id', v_current.profile_id,
          'target_auth_user_id', v_current.auth_user_id,
          'version', v_current.invitation_version,
          'delivery_strategy', v_current.delivery_strategy,
          'request_intent', v_request_intent,
          'retry_requested', case when v_request_intent = 'retry' then true else null end,
          'policy_source', v_policy_source
        )),
        jsonb_strip_nulls(jsonb_build_object(
          'membership_id', v_current.membership_id,
          'profile_id', v_current.profile_id,
          'target_auth_user_id', v_current.auth_user_id,
          'superseded_by_retry', case when v_request_intent = 'retry' then true else null end
        )),
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
      v_row.auth_user_id,
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
        v_temporary_auth_email_replaced := true;

        update auth.users as au
          set email = v_auth_email,
              raw_user_meta_data = coalesce(au.raw_user_meta_data, '{}'::jsonb)
                || jsonb_build_object(
                  'watchtower_invitation_prepared', true,
                  'watchtower_invitation_id', v_new.id,
                  'organisation_id', p_organisation_id
                ),
              updated_at = now()
        where au.id = v_row.auth_user_id
          and lower(coalesce(au.email, '')) ~ '@pending\.watchtower\.invalid$';

        get diagnostics v_updated_auth_users = row_count;
        if v_updated_auth_users <> 1 then
          raise exception 'WT_INVITATION_AUTH_IDENTITY_CONTEXT: Invitation preparation can only replace the matching pending auth identity.'
            using errcode = '42501';
        end if;

        update public.profiles as profile
          set email = v_auth_email,
              updated_by = v_actor.actor_user_id,
              updated_at = now()
        where profile.id = v_row.profile_id
          and lower(coalesce(profile.email, '')) ~ '@pending\.watchtower\.invalid$';

        get diagnostics v_updated_profiles = row_count;
        if v_updated_profiles <> 1 then
          raise exception 'WT_INVITATION_PROFILE_IDENTITY_CONTEXT: Invitation preparation can only replace the matching pending profile auth email mirror.'
            using errcode = '42501';
        end if;
      end if;

      perform set_config('watchtower.membership_lifecycle_operation', 'workspace_invitation_identity_preparation', true);
      perform set_config('watchtower.membership_lifecycle_organisation_id', p_organisation_id::text, true);
      perform set_config('watchtower.membership_lifecycle_membership_id', v_row.membership_id::text, true);
      perform set_config('watchtower.membership_lifecycle_profile_id', v_row.profile_id::text, true);
      perform set_config('watchtower.membership_lifecycle_invitation_id', v_new.id::text, true);
      perform set_config('watchtower.membership_lifecycle_correlation_id', v_correlation_id::text, true);

      update public.organisation_members as om
        set invitation_expires_at = v_new.expires_at,
            updated_by = v_actor.actor_user_id,
            updated_at = now()
      where om.id = v_row.membership_id;

      perform set_config('watchtower.membership_lifecycle_operation', '', true);
      perform set_config('watchtower.membership_lifecycle_organisation_id', '', true);
      perform set_config('watchtower.membership_lifecycle_membership_id', '', true);
      perform set_config('watchtower.membership_lifecycle_profile_id', '', true);
      perform set_config('watchtower.membership_lifecycle_invitation_id', '', true);
      perform set_config('watchtower.membership_lifecycle_correlation_id', '', true);

      update public.workspace_membership_invitation_handoffs as handoff
        set status = 'sent'
      where handoff.id = v_handoff.id;
    end if;

    perform public.record_workspace_membership_audit_event(
      p_organisation_id,
      v_row.membership_id,
      v_row.auth_user_id,
      v_actor.actor_user_id,
      'workspace_invitation_prepared',
      null,
      v_new.status,
      jsonb_strip_nulls(jsonb_build_object(
        'membership_status', v_row.membership_status,
        'profile_id', v_row.profile_id,
        'target_auth_user_id', v_row.auth_user_id,
        'request_intent', v_request_intent,
        'retry_requested', case when v_request_intent = 'retry' then true else null end,
        'previous_invitation_id', case when v_has_current then v_current.id else null end,
        'previous_invitation_version', case when v_has_current then v_current.invitation_version else null end,
        'previous_invitation_status', case when v_has_current then v_current.status else null end,
        'previous_delivery_strategy', case when v_has_current then v_current.delivery_strategy else null end,
        'controlled_operation', 'workspace_invitation_identity_preparation',
        'temporary_auth_email_replaced', v_temporary_auth_email_replaced,
        'policy_source', v_policy_source
      )),
      jsonb_strip_nulls(jsonb_build_object(
        'invitation_id', v_new.id,
        'membership_id', v_new.membership_id,
        'profile_id', v_new.profile_id,
        'target_auth_user_id', v_new.auth_user_id,
        'version', v_new.invitation_version,
        'delivery_strategy', v_new.delivery_strategy,
        'recipient_domain', split_part(v_new.recipient_email, '@', 2),
        'expires_at', v_new.expires_at,
        'failure_code', v_failure_code,
        'policy_source', v_policy_source
      )),
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

create or replace function public.begin_workspace_membership_invitation_delivery_attempt(
  p_invitation_id uuid,
  p_delivery_operation_key uuid
)
returns table (
  should_send boolean,
  status text,
  failure_code text,
  failure_message text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_invitation public.workspace_membership_invitations;
  v_membership public.organisation_members;
  v_actor record;
begin
  if p_delivery_operation_key is null then
    raise exception 'WT_INVITATION_DELIVERY_OPERATION_KEY: Delivery operation key is required.' using errcode = '23514';
  end if;

  select * into v_invitation
  from public.workspace_membership_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.is_current
  for update;

  if not found then
    raise exception 'WT_INVITATION_NOT_FOUND: Invitation was not found.' using errcode = '42501';
  end if;

  select * into v_membership
  from public.organisation_members as membership
  where membership.id = v_invitation.membership_id
    and membership.organisation_id = v_invitation.organisation_id
  for update;

  if not found
     or v_membership.user_id is distinct from v_invitation.profile_id
     or v_membership.auth_user_id is null
     or v_membership.auth_user_id is distinct from v_invitation.auth_user_id
     or v_membership.role is distinct from v_invitation.intended_role then
    raise exception 'WT_INVITATION_DELIVERY_IDENTITY_MISMATCH: Invitation delivery requires matching profile, Auth and role linkage.'
      using errcode = '42501';
  end if;

  if v_membership.status not in ('invited', 'invite_expired') then
    raise exception 'WT_INVITATION_DELIVERY_MEMBERSHIP_STATE: Invitation delivery cannot activate or resend active memberships.'
      using errcode = '23514';
  end if;

  select * into v_actor from public.workspace_membership_require_admin_actor(v_invitation.organisation_id);

  if v_invitation.status <> 'pending_delivery' then
    should_send := false;
    status := v_invitation.status;
    failure_code := v_invitation.failure_code;
    failure_message := v_invitation.failure_message;
    return next;
    return;
  end if;

  update public.workspace_membership_invitations as invitation
    set status = 'sending',
        delivery_operation_key = p_delivery_operation_key,
        delivery_attempt_count = invitation.delivery_attempt_count + 1,
        last_delivery_attempt_at = now(),
        failure_code = null,
        failure_message = null
  where invitation.id = v_invitation.id
  returning invitation.* into v_invitation;

  perform public.record_workspace_membership_audit_event(
    v_invitation.organisation_id,
    v_invitation.membership_id,
    v_membership.auth_user_id,
    v_actor.actor_user_id,
    'workspace_invitation_delivery_attempted',
    'pending_delivery',
    'sending',
    jsonb_build_object(
      'invitation_id', v_invitation.id,
      'membership_id', v_invitation.membership_id,
      'profile_id', v_invitation.profile_id,
      'target_auth_user_id', v_membership.auth_user_id,
      'attempt', v_invitation.delivery_attempt_count
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'delivery_strategy', v_invitation.delivery_strategy,
      'recipient_domain', split_part(v_invitation.recipient_email, '@', 2)
    )),
    'Invitation email delivery was claimed for a server-side provider attempt.',
    'workspace_invitation_delivery',
    v_invitation.correlation_id
  );

  should_send := true;
  status := v_invitation.status;
  failure_code := null;
  failure_message := null;
  return next;
end;
$$;

create or replace function public.record_workspace_membership_invitation_delivery_result(
  p_invitation_id uuid,
  p_delivery_status text,
  p_failure_code text,
  p_failure_message text,
  p_email_provider text,
  p_provider_message_id text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_invitation public.workspace_membership_invitations;
  v_membership public.organisation_members;
  v_actor record;
  v_attempt_count integer;
  v_email_provider text := lower(nullif(btrim(p_email_provider), ''));
  v_provider_message_id text := nullif(btrim(p_provider_message_id), '');
begin
  if p_delivery_status not in ('delivered', 'delivery_failed') then
    raise exception 'WT_INVITATION_DELIVERY_STATUS: Unsupported delivery result.' using errcode = '23514';
  end if;

  if v_email_provider is not null and v_email_provider !~ '^[a-z0-9_.-]+$' then
    raise exception 'WT_INVITATION_EMAIL_PROVIDER: Unsupported provider evidence.' using errcode = '23514';
  end if;

  select * into v_invitation
  from public.workspace_membership_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'WT_INVITATION_NOT_FOUND: Invitation was not found.' using errcode = '42501';
  end if;

  select * into v_membership
  from public.organisation_members as membership
  where membership.id = v_invitation.membership_id
    and membership.organisation_id = v_invitation.organisation_id
  for update;

  if not found
     or v_membership.user_id is distinct from v_invitation.profile_id
     or v_membership.auth_user_id is null
     or v_membership.auth_user_id is distinct from v_invitation.auth_user_id
     or v_membership.role is distinct from v_invitation.intended_role then
    raise exception 'WT_INVITATION_DELIVERY_IDENTITY_MISMATCH: Invitation delivery result requires matching profile, Auth and role linkage.'
      using errcode = '42501';
  end if;

  if v_membership.status not in ('invited', 'invite_expired') then
    raise exception 'WT_INVITATION_DELIVERY_MEMBERSHIP_STATE: Invitation delivery result cannot activate or resend active memberships.'
      using errcode = '23514';
  end if;

  select * into v_actor from public.workspace_membership_require_admin_actor(v_invitation.organisation_id);

  v_attempt_count := case
    when v_invitation.status = 'sending' then v_invitation.delivery_attempt_count
    else v_invitation.delivery_attempt_count + 1
  end;

  update public.workspace_membership_invitations as invitation
    set status = p_delivery_status,
        delivery_attempt_count = v_attempt_count,
        last_delivery_attempt_at = coalesce(invitation.last_delivery_attempt_at, now()),
        delivered_at = case when p_delivery_status = 'delivered' then now() else invitation.delivered_at end,
        provider_accepted_at = case when p_delivery_status = 'delivered' then now() else invitation.provider_accepted_at end,
        email_provider = v_email_provider,
        provider_message_id = case when p_delivery_status = 'delivered' then v_provider_message_id else null end,
        failure_code = case when p_delivery_status = 'delivery_failed' then p_failure_code else null end,
        failure_message = case when p_delivery_status = 'delivery_failed' then p_failure_message else null end
  where invitation.id = p_invitation_id;

  perform public.record_workspace_membership_audit_event(
    v_invitation.organisation_id,
    v_invitation.membership_id,
    v_membership.auth_user_id,
    v_actor.actor_user_id,
    case when p_delivery_status = 'delivered' then 'workspace_invitation_delivered' else 'workspace_invitation_delivery_failed' end,
    v_invitation.status,
    p_delivery_status,
    jsonb_build_object(
      'invitation_id', v_invitation.id,
      'membership_id', v_invitation.membership_id,
      'profile_id', v_invitation.profile_id,
      'target_auth_user_id', v_membership.auth_user_id,
      'attempt', v_attempt_count
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'delivery_strategy', v_invitation.delivery_strategy,
      'email_provider', v_email_provider,
      'provider_message_id', case when p_delivery_status = 'delivered' then v_provider_message_id else null end,
      'failure_code', p_failure_code,
      'recipient_domain', split_part(v_invitation.recipient_email, '@', 2)
    )),
    case
      when p_delivery_status = 'delivered' then 'Invitation email provider accepted the send request.'
      else coalesce(p_failure_message, 'Invitation delivery failed.')
    end,
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
  v_membership public.organisation_members;
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

  select * into v_membership
  from public.organisation_members as membership
  where membership.id = v_invitation.membership_id
    and membership.organisation_id = v_invitation.organisation_id
  for update;

  if not found
     or v_membership.user_id is distinct from v_invitation.profile_id
     or v_membership.auth_user_id is null
     or v_membership.auth_user_id is distinct from v_invitation.auth_user_id
     or v_membership.role is distinct from v_invitation.intended_role then
    raise exception 'WT_INVITATION_CANCEL_IDENTITY_MISMATCH: Invitation cancellation requires matching profile, Auth and role linkage.'
      using errcode = '42501';
  end if;

  if v_invitation.status in ('accepted', 'superseded', 'cancelled') then
    perform public.record_workspace_membership_audit_event(
      p_organisation_id,
      v_invitation.membership_id,
      v_membership.auth_user_id,
      v_actor.actor_user_id,
      'workspace_invitation_replay_rejected',
      v_invitation.status,
      v_invitation.status,
      jsonb_build_object(
        'invitation_id', v_invitation.id,
        'membership_id', v_invitation.membership_id,
        'profile_id', v_invitation.profile_id,
        'target_auth_user_id', v_membership.auth_user_id
      ),
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
    v_membership.auth_user_id,
    v_actor.actor_user_id,
    'workspace_invitation_cancelled',
    v_invitation.status,
    'cancelled',
    jsonb_build_object(
      'invitation_id', v_invitation.id,
      'membership_id', v_invitation.membership_id,
      'profile_id', v_invitation.profile_id,
      'target_auth_user_id', v_membership.auth_user_id
    ),
    jsonb_build_object('membership_remains', 'invited'),
    'Invitation cancelled. Membership remains invited and can receive a new invitation later.',
    'workspace_invitation',
    v_invitation.correlation_id
  );
end;
$$;

revoke all on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb, text) from public;
revoke all on function public.begin_workspace_membership_invitation_delivery_attempt(uuid, uuid) from public;
revoke all on function public.record_workspace_membership_invitation_delivery_result(uuid, text, text, text, text, text) from public;
revoke all on function public.cancel_workspace_membership_invitation(uuid, uuid) from public;

grant execute on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.begin_workspace_membership_invitation_delivery_attempt(uuid, uuid) to authenticated, service_role;
grant execute on function public.record_workspace_membership_invitation_delivery_result(uuid, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.cancel_workspace_membership_invitation(uuid, uuid) to authenticated, service_role;

comment on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb, text) is
  'Owner/Admin-only invitation preparation RPC with explicit request intent. Retry/resend preserves the membership Auth UUID in invitation rows and audit target_user_id; profile UUIDs are recorded only as JSON evidence.';
comment on function public.begin_workspace_membership_invitation_delivery_attempt(uuid, uuid) is
  'WT-008A claims a pending invitation before an outbound email provider call and records delivery-attempt audit rows against the current invitation Auth UUID.';
comment on function public.record_workspace_membership_invitation_delivery_result(uuid, text, text, text, text, text) is
  'WT-008A records sanitized outbound invitation email provider evidence and keeps audit target_user_id in the auth.users UUID domain.';
comment on function public.cancel_workspace_membership_invitation(uuid, uuid) is
  'Cancels a current workspace invitation without activating membership and records audit rows against the invited Auth UUID.';
