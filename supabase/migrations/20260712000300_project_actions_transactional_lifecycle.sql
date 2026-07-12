-- WT-ACTION-001B Transactional Project Action lifecycle and permission enforcement.
-- This migration deliberately adds controlled RPC operations only. It does not
-- grant direct authenticated insert/update/delete access to Action tables.

create or replace function public.project_action_require_authenticated_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_id uuid;
begin
  actor_id := auth.uid();

  if actor_id is null then
    raise exception 'WT_ACTION_PERMISSION_DENIED: Authenticated user is required.'
      using errcode = '42501';
  end if;

  return actor_id;
end;
$$;

create or replace function public.project_action_is_active_workflow_member(
  target_organisation_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organisation_members om
    where om.organisation_id = target_organisation_id
      and om.user_id = target_user_id
      and om.status = 'active'
      and om.role in ('owner', 'admin', 'member')
  );
$$;

create or replace function public.project_action_assert_actor_can_create(
  target_organisation_id uuid,
  actor_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.project_action_is_active_workflow_member(target_organisation_id, actor_id) then
    raise exception 'WT_ACTION_PERMISSION_DENIED: Only active Owners, Admins and Members can create Actions.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.project_action_assert_assignable_actioner(
  target_organisation_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if target_user_id is null then
    return;
  end if;

  if not public.project_action_is_active_workflow_member(target_organisation_id, target_user_id) then
    raise exception 'WT_ACTION_INELIGIBLE_ACTIONER: Actioner must be an active Owner, Admin or Member in this workspace.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.project_action_assert_expected_state(
  current_status text,
  current_updated_at timestamptz,
  expected_status text,
  expected_updated_at timestamptz default null
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if expected_status is null or length(btrim(expected_status)) = 0 then
    raise exception 'WT_ACTION_STALE: Expected Action status is required.'
      using errcode = '40001';
  end if;

  if current_status is distinct from expected_status then
    raise exception 'WT_ACTION_STALE: Action has changed since it was loaded.'
      using errcode = '40001';
  end if;

  if expected_updated_at is not null and current_updated_at is distinct from expected_updated_at then
    raise exception 'WT_ACTION_STALE: Action has changed since it was loaded.'
      using errcode = '40001';
  end if;
end;
$$;

create or replace function public.project_action_assert_timestamp_expected(
  expected_updated_at timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if expected_updated_at is null then
    raise exception 'WT_ACTION_STALE: Expected Action update timestamp is required for this operation.'
      using errcode = '40001';
  end if;
end;
$$;

create or replace function public.project_action_assert_non_terminal(action_status text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if action_status in ('complete', 'cancelled') then
    raise exception 'WT_ACTION_TERMINAL: Complete and cancelled Actions cannot be changed.'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.project_action_assert_current_actioner(
  target_organisation_id uuid,
  expected_actioner_id uuid,
  actor_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if expected_actioner_id is null or expected_actioner_id is distinct from actor_id then
    raise exception 'WT_ACTION_PERMISSION_DENIED: Only the current Actioner can perform this Actioner response.'
      using errcode = '42501';
  end if;

  if not public.project_action_is_active_workflow_member(target_organisation_id, actor_id) then
    raise exception 'WT_ACTION_INELIGIBLE_ACTIONER: Current Actioner is no longer eligible to respond.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.project_action_assert_acceptance_owner(
  target_organisation_id uuid,
  expected_acceptance_owner_id uuid,
  actor_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if expected_acceptance_owner_id is distinct from actor_id then
    raise exception 'WT_ACTION_PERMISSION_DENIED: Only the current acceptance owner can perform this Action review operation.'
      using errcode = '42501';
  end if;

  if not public.project_action_is_active_workflow_member(target_organisation_id, actor_id) then
    raise exception 'WT_ACTION_PERMISSION_DENIED: Acceptance owner must be an active Owner, Admin or Member.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.project_action_assert_owner_admin(
  target_organisation_id uuid,
  actor_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_active_organisation_role(target_organisation_id, array['owner', 'admin'], actor_id) then
    raise exception 'WT_ACTION_PERMISSION_DENIED: Only active Owners and Admins can take over Action acceptance.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.project_action_insert_history(
  source_action public.project_actions,
  history_event_type text,
  history_actor_id uuid,
  history_from_status text default null,
  history_to_status text default null,
  history_reason text default null,
  history_response text default null,
  history_evidence_url text default null,
  history_old_values jsonb default null,
  history_new_values jsonb default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  insert into public.project_action_history (
    organisation_id,
    project_id,
    action_id,
    event_type,
    actor_user_id,
    from_status,
    to_status,
    reason,
    response,
    evidence_url,
    old_values,
    new_values
  )
  values (
    source_action.organisation_id,
    source_action.project_id,
    source_action.id,
    history_event_type,
    history_actor_id,
    history_from_status,
    history_to_status,
    nullif(btrim(history_reason), ''),
    nullif(btrim(history_response), ''),
    nullif(btrim(history_evidence_url), ''),
    history_old_values,
    history_new_values
  );
end;
$$;

create or replace function public.create_project_action(
  p_project_id uuid,
  p_brief text,
  p_due_date date,
  p_actioner_id uuid default null,
  p_source_type text default 'project',
  p_source_record_id uuid default null,
  p_source_ref text default null,
  p_source_label text default null,
  p_source_context jsonb default '{}'::jsonb
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  project_organisation_id uuid;
  new_action public.project_actions;
begin
  actor_id := public.project_action_require_authenticated_actor();

  if p_project_id is null then
    raise exception 'WT_ACTION_SCOPE: Project is required.'
      using errcode = '23502';
  end if;

  if p_brief is null or length(btrim(p_brief)) = 0 then
    raise exception 'WT_ACTION_MISSING_BRIEF: Action brief is required.'
      using errcode = '23514';
  end if;

  if p_due_date is null then
    raise exception 'WT_ACTION_MISSING_DUE_DATE: Action due date is required.'
      using errcode = '23502';
  end if;

  if p_source_type not in ('project', 'risk', 'project_details', 'narrative') then
    raise exception 'WT_ACTION_INVALID_SOURCE: Select a valid Action source.'
      using errcode = '23514';
  end if;

  if p_source_context is not null and jsonb_typeof(p_source_context) <> 'object' then
    raise exception 'WT_ACTION_INVALID_SOURCE: Action source context must be a JSON object.'
      using errcode = '23514';
  end if;

  select projects.organisation_id
    into project_organisation_id
  from public.projects
  where projects.id = p_project_id
    and projects.deleted_at is null
    and projects.archived_at is null;

  if project_organisation_id is null then
    raise exception 'WT_ACTION_SCOPE: Project not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_actor_can_create(project_organisation_id, actor_id);
  perform public.project_action_assert_assignable_actioner(project_organisation_id, p_actioner_id);

  insert into public.project_actions (
    project_id,
    brief,
    status,
    due_date,
    raiser_id,
    actioner_id,
    acceptance_owner_id,
    source_type,
    source_record_id,
    source_ref,
    source_label,
    source_context,
    created_by,
    updated_by
  )
  values (
    p_project_id,
    btrim(p_brief),
    'open',
    p_due_date,
    actor_id,
    p_actioner_id,
    actor_id,
    p_source_type,
    p_source_record_id,
    nullif(btrim(p_source_ref), ''),
    nullif(btrim(p_source_label), ''),
    coalesce(p_source_context, '{}'::jsonb),
    actor_id,
    actor_id
  )
  returning *
    into new_action;

  perform public.project_action_insert_history(
    new_action,
    'created',
    actor_id,
    null,
    'open',
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'brief', new_action.brief,
      'due_date', new_action.due_date,
      'actioner_id', new_action.actioner_id,
      'raiser_id', new_action.raiser_id,
      'acceptance_owner_id', new_action.acceptance_owner_id,
      'source_type', new_action.source_type,
      'source_record_id', new_action.source_record_id,
      'source_ref', new_action.source_ref,
      'source_label', new_action.source_label
    )
  );

  return new_action;
end;
$$;

create or replace function public.submit_project_action(
  p_action_id uuid,
  p_response text,
  p_evidence_url text default null,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  current_action public.project_actions;
  updated_action public.project_actions;
  clean_evidence_url text;
begin
  actor_id := public.project_action_require_authenticated_actor();

  if p_response is null or length(btrim(p_response)) = 0 then
    raise exception 'WT_ACTION_MISSING_RESPONSE: Response is required.'
      using errcode = '23514';
  end if;

  clean_evidence_url := nullif(btrim(p_evidence_url), '');
  if clean_evidence_url is not null and clean_evidence_url !~* '^https?://' then
    raise exception 'WT_ACTION_UNSAFE_EVIDENCE_URL: Evidence URL must start with http:// or https://.'
      using errcode = '23514';
  end if;

  select *
    into current_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_expected_state(current_action.status, current_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(current_action.status);
  perform public.project_action_assert_current_actioner(current_action.organisation_id, current_action.actioner_id, actor_id);

  if current_action.status not in ('open', 'returned_to_actioner') then
    raise exception 'WT_ACTION_INVALID_TRANSITION: Action can only be submitted from Open or Returned to Actioner.'
      using errcode = '23514';
  end if;

  update public.project_actions
    set status = 'submitted',
        latest_response = btrim(p_response),
        latest_evidence_url = clean_evidence_url,
        submitted_at = now(),
        completed_at = null,
        cancelled_at = null
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    'submitted',
    actor_id,
    current_action.status,
    'submitted',
    null,
    updated_action.latest_response,
    updated_action.latest_evidence_url,
    jsonb_build_object('status', current_action.status),
    jsonb_build_object('status', 'submitted')
  );

  return updated_action;
end;
$$;

create or replace function public.return_project_action_to_raiser(
  p_action_id uuid,
  p_reason text,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  current_action public.project_actions;
  updated_action public.project_actions;
begin
  actor_id := public.project_action_require_authenticated_actor();

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'WT_ACTION_MISSING_REASON: Reason is required.'
      using errcode = '23514';
  end if;

  select *
    into current_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_expected_state(current_action.status, current_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(current_action.status);
  perform public.project_action_assert_current_actioner(current_action.organisation_id, current_action.actioner_id, actor_id);

  if current_action.status not in ('open', 'returned_to_actioner') then
    raise exception 'WT_ACTION_INVALID_TRANSITION: Action can only be returned to the raiser from Open or Returned to Actioner.'
      using errcode = '23514';
  end if;

  update public.project_actions
    set status = 'returned_to_raiser'
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    'returned_to_raiser',
    actor_id,
    current_action.status,
    'returned_to_raiser',
    p_reason,
    null,
    null,
    jsonb_build_object('status', current_action.status),
    jsonb_build_object('status', 'returned_to_raiser')
  );

  return updated_action;
end;
$$;

create or replace function public.reject_project_action(
  p_action_id uuid,
  p_reason text,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  current_action public.project_actions;
  updated_action public.project_actions;
begin
  actor_id := public.project_action_require_authenticated_actor();

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'WT_ACTION_MISSING_REASON: Reason is required.'
      using errcode = '23514';
  end if;

  select *
    into current_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_expected_state(current_action.status, current_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(current_action.status);
  perform public.project_action_assert_current_actioner(current_action.organisation_id, current_action.actioner_id, actor_id);

  if current_action.status not in ('open', 'returned_to_actioner') then
    raise exception 'WT_ACTION_INVALID_TRANSITION: Action can only be rejected from Open or Returned to Actioner.'
      using errcode = '23514';
  end if;

  update public.project_actions
    set status = 'rejected_by_actioner'
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    'rejected_by_actioner',
    actor_id,
    current_action.status,
    'rejected_by_actioner',
    p_reason,
    null,
    null,
    jsonb_build_object('status', current_action.status),
    jsonb_build_object('status', 'rejected_by_actioner')
  );

  return updated_action;
end;
$$;

create or replace function public.return_project_action_to_actioner(
  p_action_id uuid,
  p_reason text,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  current_action public.project_actions;
  updated_action public.project_actions;
begin
  actor_id := public.project_action_require_authenticated_actor();

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'WT_ACTION_MISSING_REASON: Reason is required.'
      using errcode = '23514';
  end if;

  select *
    into current_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_expected_state(current_action.status, current_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(current_action.status);
  perform public.project_action_assert_acceptance_owner(current_action.organisation_id, current_action.acceptance_owner_id, actor_id);

  if current_action.status <> 'submitted' then
    raise exception 'WT_ACTION_INVALID_TRANSITION: Only submitted Actions can be returned to the Actioner.'
      using errcode = '23514';
  end if;

  update public.project_actions
    set status = 'returned_to_actioner'
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    'returned_to_actioner',
    actor_id,
    'submitted',
    'returned_to_actioner',
    p_reason,
    null,
    null,
    jsonb_build_object('status', 'submitted'),
    jsonb_build_object('status', 'returned_to_actioner')
  );

  return updated_action;
end;
$$;

create or replace function public.complete_project_action(
  p_action_id uuid,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  current_action public.project_actions;
  updated_action public.project_actions;
begin
  actor_id := public.project_action_require_authenticated_actor();

  select *
    into current_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_expected_state(current_action.status, current_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_acceptance_owner(current_action.organisation_id, current_action.acceptance_owner_id, actor_id);

  if current_action.status <> 'submitted' then
    if current_action.status in ('complete', 'cancelled') then
      perform public.project_action_assert_non_terminal(current_action.status);
    end if;
    raise exception 'WT_ACTION_INVALID_TRANSITION: Only submitted Actions can be completed.'
      using errcode = '23514';
  end if;

  update public.project_actions
    set status = 'complete',
        completed_at = now(),
        cancelled_at = null
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    'completed',
    actor_id,
    'submitted',
    'complete',
    null,
    null,
    null,
    jsonb_build_object('status', 'submitted'),
    jsonb_build_object('status', 'complete')
  );

  return updated_action;
end;
$$;

create or replace function public.cancel_project_action(
  p_action_id uuid,
  p_reason text,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  current_action public.project_actions;
  updated_action public.project_actions;
begin
  actor_id := public.project_action_require_authenticated_actor();

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'WT_ACTION_MISSING_REASON: Reason is required.'
      using errcode = '23514';
  end if;

  select *
    into current_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_expected_state(current_action.status, current_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(current_action.status);
  perform public.project_action_assert_acceptance_owner(current_action.organisation_id, current_action.acceptance_owner_id, actor_id);

  update public.project_actions
    set status = 'cancelled',
        cancelled_at = now()
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    'cancelled',
    actor_id,
    current_action.status,
    'cancelled',
    p_reason,
    null,
    null,
    jsonb_build_object('status', current_action.status),
    jsonb_build_object('status', 'cancelled')
  );

  return updated_action;
end;
$$;

create or replace function public.assign_project_action(
  p_action_id uuid,
  p_actioner_id uuid,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  current_action public.project_actions;
  updated_action public.project_actions;
  event_type text;
begin
  actor_id := public.project_action_require_authenticated_actor();
  perform public.project_action_assert_timestamp_expected(p_expected_updated_at);

  select *
    into current_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_expected_state(current_action.status, current_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(current_action.status);
  perform public.project_action_assert_acceptance_owner(current_action.organisation_id, current_action.acceptance_owner_id, actor_id);
  perform public.project_action_assert_assignable_actioner(current_action.organisation_id, p_actioner_id);

  if current_action.status = 'submitted' then
    raise exception 'WT_ACTION_INVALID_TRANSITION: Reassignment is blocked while an Action is submitted.'
      using errcode = '23514';
  end if;

  event_type := case
    when current_action.actioner_id is null and p_actioner_id is not null then 'assigned'
    when current_action.actioner_id is not null and p_actioner_id is null then 'unassigned'
    else 'reassigned'
  end;

  update public.project_actions
    set actioner_id = p_actioner_id
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    event_type,
    actor_id,
    current_action.status,
    current_action.status,
    null,
    null,
    null,
    jsonb_build_object('actioner_id', current_action.actioner_id),
    jsonb_build_object('actioner_id', updated_action.actioner_id)
  );

  return updated_action;
end;
$$;

create or replace function public.amend_project_action_brief(
  p_action_id uuid,
  p_brief text,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  current_action public.project_actions;
  updated_action public.project_actions;
begin
  actor_id := public.project_action_require_authenticated_actor();
  perform public.project_action_assert_timestamp_expected(p_expected_updated_at);

  if p_brief is null or length(btrim(p_brief)) = 0 then
    raise exception 'WT_ACTION_MISSING_BRIEF: Action brief is required.'
      using errcode = '23514';
  end if;

  select *
    into current_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_expected_state(current_action.status, current_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(current_action.status);
  perform public.project_action_assert_acceptance_owner(current_action.organisation_id, current_action.acceptance_owner_id, actor_id);

  update public.project_actions
    set brief = btrim(p_brief)
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    'brief_amended',
    actor_id,
    current_action.status,
    current_action.status,
    null,
    null,
    null,
    jsonb_build_object('brief', current_action.brief),
    jsonb_build_object('brief', updated_action.brief)
  );

  return updated_action;
end;
$$;

create or replace function public.change_project_action_due_date(
  p_action_id uuid,
  p_due_date date,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  current_action public.project_actions;
  updated_action public.project_actions;
begin
  actor_id := public.project_action_require_authenticated_actor();
  perform public.project_action_assert_timestamp_expected(p_expected_updated_at);

  if p_due_date is null then
    raise exception 'WT_ACTION_MISSING_DUE_DATE: Action due date is required.'
      using errcode = '23502';
  end if;

  select *
    into current_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_expected_state(current_action.status, current_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(current_action.status);
  perform public.project_action_assert_acceptance_owner(current_action.organisation_id, current_action.acceptance_owner_id, actor_id);

  update public.project_actions
    set due_date = p_due_date
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    'due_date_changed',
    actor_id,
    current_action.status,
    current_action.status,
    null,
    null,
    null,
    jsonb_build_object('due_date', current_action.due_date),
    jsonb_build_object('due_date', updated_action.due_date)
  );

  return updated_action;
end;
$$;

create or replace function public.reissue_project_action(
  p_action_id uuid,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null,
  p_brief text default null,
  p_due_date date default null,
  p_actioner_id uuid default null,
  p_change_actioner boolean default false
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  current_action public.project_actions;
  updated_action public.project_actions;
  next_brief text;
  next_due_date date;
  next_actioner_id uuid;
begin
  actor_id := public.project_action_require_authenticated_actor();

  select *
    into current_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_expected_state(current_action.status, current_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(current_action.status);
  perform public.project_action_assert_acceptance_owner(current_action.organisation_id, current_action.acceptance_owner_id, actor_id);

  if current_action.status not in ('returned_to_raiser', 'rejected_by_actioner') then
    raise exception 'WT_ACTION_INVALID_TRANSITION: Only returned or rejected Actions can be reissued.'
      using errcode = '23514';
  end if;

  next_brief := coalesce(nullif(btrim(p_brief), ''), current_action.brief);
  next_due_date := coalesce(p_due_date, current_action.due_date);
  next_actioner_id := case when p_change_actioner then p_actioner_id else current_action.actioner_id end;

  if length(btrim(next_brief)) = 0 then
    raise exception 'WT_ACTION_MISSING_BRIEF: Action brief is required.'
      using errcode = '23514';
  end if;

  perform public.project_action_assert_assignable_actioner(current_action.organisation_id, next_actioner_id);

  update public.project_actions
    set status = 'open',
        brief = next_brief,
        due_date = next_due_date,
        actioner_id = next_actioner_id,
        latest_response = null,
        latest_evidence_url = null,
        submitted_at = null
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    'reissued',
    actor_id,
    current_action.status,
    'open',
    null,
    null,
    null,
    jsonb_build_object(
      'status', current_action.status,
      'brief', current_action.brief,
      'due_date', current_action.due_date,
      'actioner_id', current_action.actioner_id,
      'latest_response', current_action.latest_response,
      'latest_evidence_url', current_action.latest_evidence_url
    ),
    jsonb_build_object(
      'status', 'open',
      'brief', updated_action.brief,
      'due_date', updated_action.due_date,
      'actioner_id', updated_action.actioner_id,
      'latest_response', updated_action.latest_response,
      'latest_evidence_url', updated_action.latest_evidence_url
    )
  );

  return updated_action;
end;
$$;

create or replace function public.take_over_project_action_acceptance(
  p_action_id uuid,
  p_reason text,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  current_action public.project_actions;
  updated_action public.project_actions;
begin
  actor_id := public.project_action_require_authenticated_actor();
  perform public.project_action_assert_timestamp_expected(p_expected_updated_at);

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'WT_ACTION_MISSING_REASON: Reason is required.'
      using errcode = '23514';
  end if;

  select *
    into current_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.'
      using errcode = '42501';
  end if;

  perform public.project_action_assert_expected_state(current_action.status, current_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(current_action.status);
  perform public.project_action_assert_owner_admin(current_action.organisation_id, actor_id);

  if current_action.acceptance_owner_id is not distinct from actor_id then
    raise exception 'WT_ACTION_INVALID_TRANSITION: You are already the acceptance owner for this Action.'
      using errcode = '23514';
  end if;

  update public.project_actions
    set acceptance_owner_id = actor_id
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    'acceptance_owner_taken_over',
    actor_id,
    current_action.status,
    current_action.status,
    p_reason,
    null,
    null,
    jsonb_build_object('acceptance_owner_id', current_action.acceptance_owner_id, 'raiser_id', current_action.raiser_id),
    jsonb_build_object('acceptance_owner_id', updated_action.acceptance_owner_id, 'raiser_id', updated_action.raiser_id)
  );

  return updated_action;
end;
$$;

revoke all on function public.project_action_require_authenticated_actor() from public;
revoke all on function public.project_action_is_active_workflow_member(uuid, uuid) from public;
revoke all on function public.project_action_assert_actor_can_create(uuid, uuid) from public;
revoke all on function public.project_action_assert_assignable_actioner(uuid, uuid) from public;
revoke all on function public.project_action_assert_expected_state(text, timestamptz, text, timestamptz) from public;
revoke all on function public.project_action_assert_timestamp_expected(timestamptz) from public;
revoke all on function public.project_action_assert_non_terminal(text) from public;
revoke all on function public.project_action_assert_current_actioner(uuid, uuid, uuid) from public;
revoke all on function public.project_action_assert_acceptance_owner(uuid, uuid, uuid) from public;
revoke all on function public.project_action_assert_owner_admin(uuid, uuid) from public;
revoke all on function public.project_action_insert_history(public.project_actions, text, uuid, text, text, text, text, text, jsonb, jsonb) from public;

revoke all on function public.create_project_action(uuid, text, date, uuid, text, uuid, text, text, jsonb) from public;
revoke all on function public.submit_project_action(uuid, text, text, text, timestamptz) from public;
revoke all on function public.return_project_action_to_raiser(uuid, text, text, timestamptz) from public;
revoke all on function public.reject_project_action(uuid, text, text, timestamptz) from public;
revoke all on function public.return_project_action_to_actioner(uuid, text, text, timestamptz) from public;
revoke all on function public.complete_project_action(uuid, text, timestamptz) from public;
revoke all on function public.cancel_project_action(uuid, text, text, timestamptz) from public;
revoke all on function public.assign_project_action(uuid, uuid, text, timestamptz) from public;
revoke all on function public.amend_project_action_brief(uuid, text, text, timestamptz) from public;
revoke all on function public.change_project_action_due_date(uuid, date, text, timestamptz) from public;
revoke all on function public.reissue_project_action(uuid, text, timestamptz, text, date, uuid, boolean) from public;
revoke all on function public.take_over_project_action_acceptance(uuid, text, text, timestamptz) from public;

grant execute on function public.create_project_action(uuid, text, date, uuid, text, uuid, text, text, jsonb) to authenticated;
grant execute on function public.submit_project_action(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.return_project_action_to_raiser(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.reject_project_action(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.return_project_action_to_actioner(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.complete_project_action(uuid, text, timestamptz) to authenticated;
grant execute on function public.cancel_project_action(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.assign_project_action(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.amend_project_action_brief(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.change_project_action_due_date(uuid, date, text, timestamptz) to authenticated;
grant execute on function public.reissue_project_action(uuid, text, timestamptz, text, date, uuid, boolean) to authenticated;
grant execute on function public.take_over_project_action_acceptance(uuid, text, text, timestamptz) to authenticated;

grant execute on function public.project_action_require_authenticated_actor() to service_role;
grant execute on function public.project_action_is_active_workflow_member(uuid, uuid) to service_role;
grant execute on function public.project_action_assert_actor_can_create(uuid, uuid) to service_role;
grant execute on function public.project_action_assert_assignable_actioner(uuid, uuid) to service_role;
grant execute on function public.project_action_assert_expected_state(text, timestamptz, text, timestamptz) to service_role;
grant execute on function public.project_action_assert_timestamp_expected(timestamptz) to service_role;
grant execute on function public.project_action_assert_non_terminal(text) to service_role;
grant execute on function public.project_action_assert_current_actioner(uuid, uuid, uuid) to service_role;
grant execute on function public.project_action_assert_acceptance_owner(uuid, uuid, uuid) to service_role;
grant execute on function public.project_action_assert_owner_admin(uuid, uuid) to service_role;
grant execute on function public.project_action_insert_history(public.project_actions, text, uuid, text, text, text, text, text, jsonb, jsonb) to service_role;
