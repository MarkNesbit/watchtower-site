-- WT-ACTION-002 follow-up: due dates are optional, but missing dates remain visible as Amber attention.

alter table public.project_actions
  alter column due_date drop not null;

create or replace function public.create_project_action(
  p_project_id uuid,
  p_brief text,
  p_due_date date default null,
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

revoke all on function public.create_project_action(uuid, text, date, uuid, text, uuid, text, text, jsonb) from public;
revoke all on function public.change_project_action_due_date(uuid, date, text, timestamptz) from public;

grant execute on function public.create_project_action(uuid, text, date, uuid, text, uuid, text, text, jsonb) to authenticated;
grant execute on function public.change_project_action_due_date(uuid, date, text, timestamptz) to authenticated;
