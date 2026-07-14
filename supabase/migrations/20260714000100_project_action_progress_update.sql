-- WT-ACTIONS-UX-002B: auditable progress updates without workflow transition.

alter table public.project_action_history
  drop constraint if exists project_action_history_event_type_check,
  add constraint project_action_history_event_type_check
    check (event_type in ('created', 'assigned', 'unassigned', 'reassigned', 'brief_amended', 'due_date_changed', 'submitted', 'returned_to_raiser', 'rejected_by_actioner', 'returned_to_actioner', 'progress_updated', 'reissued', 'acceptance_owner_taken_over', 'completed', 'cancelled'));

create or replace function public.save_project_action_progress(
  p_action_id uuid,
  p_response text,
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

  if p_response is null or length(btrim(p_response)) = 0 then
    raise exception 'WT_ACTION_MISSING_RESPONSE: Response is required.'
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

  if current_action.status not in ('open', 'returned_to_actioner') then
    raise exception 'WT_ACTION_INVALID_TRANSITION: Progress updates can only be saved while an Action is Outstanding.'
      using errcode = '23514';
  end if;

  if current_action.actioner_id is distinct from actor_id
    and current_action.acceptance_owner_id is distinct from actor_id
    and not public.has_active_organisation_role(current_action.organisation_id, array['owner', 'admin'], actor_id) then
    raise exception 'WT_ACTION_PERMISSION_DENIED: Only the Actioner, acceptance owner, Owner or Admin can update progress.'
      using errcode = '42501';
  end if;

  update public.project_actions
    set latest_response = btrim(p_response)
  where id = current_action.id
  returning *
    into updated_action;

  perform public.project_action_insert_history(
    updated_action,
    'progress_updated',
    actor_id,
    current_action.status,
    current_action.status,
    null,
    updated_action.latest_response,
    null,
    jsonb_build_object('latest_response', current_action.latest_response),
    jsonb_build_object('latest_response', updated_action.latest_response)
  );

  return updated_action;
end;
$$;

revoke all on function public.save_project_action_progress(uuid, text, text, timestamptz) from public;
grant execute on function public.save_project_action_progress(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.save_project_action_progress(uuid, text, text, timestamptz) to service_role;
