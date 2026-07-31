-- WT-ACTION direct-completion repair: one RPC owns both completion modes.
-- Profile-keyed responsibilities are resolved through the C1/C3/C4 helpers.

create or replace function public.complete_project_action(
  p_action_id uuid,
  p_expected_status text default null,
  p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql volatile security definer set search_path = public as $$
declare
  v_action public.project_actions;
  v_caller record;
  v_actioner record;
  v_updated public.project_actions;
begin
  select * into v_action from public.project_actions where id = p_action_id for update;
  if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);

  if v_action.approval_required then
    if v_action.status <> 'submitted' then raise exception 'WT_ACTION_INVALID_TRANSITION: Only submitted Actions can be approved.' using errcode = '23514'; end if;
    perform public.project_action_assert_c4_approver(v_action, v_caller.membership_id);
    update public.project_actions set status = 'complete', completed_at = now(), cancelled_at = null where id = v_action.id returning * into v_updated;
    perform public.project_action_insert_c4_history(v_updated, 'completed', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id, 'submitted', 'complete', null,
      jsonb_build_object('status', 'submitted'), jsonb_build_object('status', 'complete', 'completion_route', 'approved'));
    return v_updated;
  end if;

  if v_action.status not in ('open', 'returned_to_actioner') then
    raise exception 'WT_ACTION_INVALID_TRANSITION: Direct completion is available only for Open or Returned Actions.' using errcode = '23514';
  end if;
  select * into v_actioner from public.project_action_resolve_stored_responsibility(v_action.organisation_id, v_action.actioner_id);
  if v_caller.membership_id is distinct from v_actioner.membership_id then
    raise exception 'WT_ACTION_PERMISSION_DENIED: Only the current Actioner can complete this Action.' using errcode = '42501';
  end if;
  update public.project_actions set status = 'complete', completed_at = now(), cancelled_at = null where id = v_action.id returning * into v_updated;
  perform public.project_action_insert_c4_history(v_updated, 'completed', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id, v_action.status, 'complete', null,
    jsonb_build_object('status', v_action.status), jsonb_build_object('status', 'complete', 'completion_route', 'direct', 'actioner_membership_id', v_actioner.membership_id));
  return v_updated;
end;
$$;

revoke all on function public.complete_project_action(uuid, text, timestamptz) from public;
grant execute on function public.complete_project_action(uuid, text, timestamptz) to authenticated;
