alter table public.workspace_membership_invitations
  add column if not exists delivery_operation_key uuid,
  add column if not exists email_provider text,
  add column if not exists provider_message_id text,
  add column if not exists provider_accepted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspace_membership_invitations'::regclass
      and conname = 'workspace_membership_invitations_email_provider_check'
  ) then
    alter table public.workspace_membership_invitations
      add constraint workspace_membership_invitations_email_provider_check
      check (email_provider is null or email_provider = lower(btrim(email_provider)));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspace_membership_invitations'::regclass
      and conname = 'workspace_membership_invitations_provider_message_id_check'
  ) then
    alter table public.workspace_membership_invitations
      add constraint workspace_membership_invitations_provider_message_id_check
      check (provider_message_id is null or length(btrim(provider_message_id)) between 1 and 200);
  end if;
end;
$$;

create index if not exists workspace_membership_invitations_provider_message_idx
  on public.workspace_membership_invitations (email_provider, provider_message_id)
  where provider_message_id is not null;

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
    v_invitation.profile_id,
    v_actor.actor_user_id,
    'workspace_invitation_delivery_attempted',
    'pending_delivery',
    'sending',
    jsonb_build_object('invitation_id', v_invitation.id, 'attempt', v_invitation.delivery_attempt_count),
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
    v_invitation.profile_id,
    v_actor.actor_user_id,
    case when p_delivery_status = 'delivered' then 'workspace_invitation_delivered' else 'workspace_invitation_delivery_failed' end,
    v_invitation.status,
    p_delivery_status,
    jsonb_build_object('invitation_id', v_invitation.id, 'attempt', v_attempt_count),
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
begin
  perform public.record_workspace_membership_invitation_delivery_result(
    p_invitation_id,
    p_delivery_status,
    p_failure_code,
    p_failure_message,
    null::text,
    null::text
  );
end;
$$;

revoke all on function public.begin_workspace_membership_invitation_delivery_attempt(uuid, uuid) from public;
revoke all on function public.record_workspace_membership_invitation_delivery_result(uuid, text, text, text, text, text) from public;
revoke all on function public.record_workspace_membership_invitation_delivery_result(uuid, text, text, text) from public;
grant execute on function public.begin_workspace_membership_invitation_delivery_attempt(uuid, uuid) to authenticated, service_role;
grant execute on function public.record_workspace_membership_invitation_delivery_result(uuid, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.record_workspace_membership_invitation_delivery_result(uuid, text, text, text) to authenticated, service_role;

comment on function public.begin_workspace_membership_invitation_delivery_attempt(uuid, uuid) is
  'WT-008A claims a pending invitation before an outbound email provider call so retry/idempotent submissions do not create duplicate messages.';

comment on function public.record_workspace_membership_invitation_delivery_result(uuid, text, text, text, text, text) is
  'WT-008A records sanitized outbound invitation email provider evidence without storing secrets, tokens, message bodies or raw provider responses.';
