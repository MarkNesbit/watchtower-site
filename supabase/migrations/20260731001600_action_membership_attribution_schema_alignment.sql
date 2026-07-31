-- WT-ACTION-IDENTITY-001C follow-up: organisation_members is keyed by id.
-- `membership_id` is a resolver-return alias only; it is not a physical column
-- on organisation_members. Recreate the remaining C2 Actioner assignment RPC
-- against the C2-C5 compatibility schema.

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
  v_action public.project_actions;
  v_caller record;
  v_actioner record;
  v_approver record;
  v_updated public.project_actions;
  v_event text;
begin
  perform public.project_action_assert_timestamp_expected(p_expected_updated_at);

  select * into v_action
  from public.project_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501';
  end if;

  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(v_action.status);
  perform public.project_action_assert_c2_responsibility_manager(v_action, v_caller.profile_id);

  if v_action.status = 'submitted' then
    raise exception 'WT_ACTION_INVALID_TRANSITION: Reassignment is blocked while an Action is submitted.' using errcode = '23514';
  end if;

  select * into v_actioner
  from public.project_action_resolve_responsibility_membership(v_action.organisation_id, p_actioner_id);

  -- acceptance_owner_id is legacy profile attribution. It names an Approver
  -- only when approval_required is true; otherwise it remains the Raiser
  -- fallback used by existing rows and direct-completion Actions.
  if v_action.approval_required then
    select * into v_approver
    from public.project_action_resolve_stored_responsibility(
      v_action.organisation_id,
      v_action.acceptance_owner_id,
      true
    );

    if v_actioner.membership_id is not null
      and v_actioner.membership_id = v_approver.membership_id then
      raise exception 'WT_ACTION_RESPONSIBILITY_OVERLAP: Actioner and Approver must be different workspace members.' using errcode = '23514';
    end if;
  end if;

  v_event := case
    when v_action.actioner_id is null and v_actioner.profile_id is not null then 'assigned'
    when v_action.actioner_id is not null and v_actioner.profile_id is null then 'unassigned'
    else 'reassigned'
  end;

  update public.project_actions
  set actioner_id = v_actioner.profile_id
  where id = v_action.id
  returning * into v_updated;

  perform public.project_action_insert_c4_history(
    v_updated,
    v_event,
    v_caller.auth_user_id,
    v_caller.profile_id,
    v_caller.membership_id,
    v_action.status,
    v_updated.status,
    null,
    jsonb_build_object('actioner_profile_id', v_action.actioner_id),
    jsonb_build_object(
      'actioner_profile_id', v_updated.actioner_id,
      'actioner_membership_id', v_actioner.membership_id
    )
  );

  return v_updated;
end;
$$;

revoke all on function public.assign_project_action(uuid, uuid, text, timestamptz) from public;
grant execute on function public.assign_project_action(uuid, uuid, text, timestamptz) to authenticated;
