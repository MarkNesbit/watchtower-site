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
        jsonb_strip_nulls(jsonb_build_object(
          'invitation_id', v_current.id,
          'version', v_current.invitation_version,
          'delivery_strategy', v_current.delivery_strategy,
          'request_intent', v_request_intent,
          'retry_requested', case when v_request_intent = 'retry' then true else null end,
          'policy_source', v_policy_source
        )),
        jsonb_strip_nulls(jsonb_build_object(
          'membership_id', v_current.membership_id,
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
      jsonb_strip_nulls(jsonb_build_object(
        'membership_status', v_row.membership_status,
        'request_intent', v_request_intent,
        'retry_requested', case when v_request_intent = 'retry' then true else null end,
        'previous_invitation_id', case when v_has_current then v_current.id else null end,
        'previous_invitation_version', case when v_has_current then v_current.invitation_version else null end,
        'previous_invitation_status', case when v_has_current then v_current.status else null end,
        'previous_delivery_strategy', case when v_has_current then v_current.delivery_strategy else null end,
        'policy_source', v_policy_source
      )),
      jsonb_strip_nulls(jsonb_build_object(
        'invitation_id', v_new.id,
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
language sql
volatile
security definer
set search_path = public
as $$
  select *
  from public.prepare_workspace_membership_invitations(
    p_organisation_id,
    p_membership_ids,
    p_idempotency_key,
    p_token_hashes,
    'send'
  );
$$;

revoke all on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb, text) from public;
revoke all on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb) from public;
grant execute on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb) to authenticated, service_role;

comment on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb, text) is
  'Owner/Admin-only invitation preparation RPC with explicit request intent. Retry intent re-resolves the immutable delivery policy and rejects stale failed-operation keys that would otherwise replay the previous failed invitation.';
comment on function public.prepare_workspace_membership_invitations(uuid, uuid[], uuid, jsonb) is
  'Compatibility wrapper for invitation preparation callers that do not yet pass request intent; normal send semantics are preserved.';
