-- WT-ACTION-IDENTITY-001C4: approval and governance identity conversion.
-- Cancellation, amendment, due date change and reissue remain C5 scope.

create or replace function public.project_action_insert_c4_history(
  p_action public.project_actions, p_event_type text, p_auth uuid, p_profile uuid, p_membership uuid,
  p_from text, p_to text, p_reason text default null, p_old jsonb default null, p_new jsonb default null
)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.project_action_history (organisation_id, project_id, action_id, event_type, actor_user_id, actor_auth_user_id, actor_membership_id, from_status, to_status, reason, old_values, new_values)
  values (p_action.organisation_id, p_action.project_id, p_action.id, p_event_type, p_profile, p_auth, p_membership, p_from, p_to, nullif(btrim(p_reason), ''), p_old, p_new);
end;
$$;

create or replace function public.project_action_assert_c4_approver(p_action public.project_actions, p_caller_membership_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_actioner record; v_approver record;
begin
  if not p_action.approval_required then raise exception 'WT_ACTION_APPROVER_REQUIRED: This Action has no active Approver workflow.' using errcode = '23514'; end if;
  select * into v_actioner from public.project_action_resolve_stored_responsibility(p_action.organisation_id, p_action.actioner_id);
  select * into v_approver from public.project_action_resolve_stored_responsibility(p_action.organisation_id, p_action.acceptance_owner_id);
  if v_actioner.membership_id = v_approver.membership_id then raise exception 'WT_ACTION_RESPONSIBILITY_OVERLAP: Actioner and Approver must be different workspace members.' using errcode = '23514'; end if;
  if p_caller_membership_id is distinct from v_approver.membership_id then raise exception 'WT_ACTION_PERMISSION_DENIED: Only the current Approver can perform this review operation.' using errcode = '42501'; end if;
end;
$$;

create or replace function public.complete_project_action(p_action_id uuid, p_expected_status text default null, p_expected_updated_at timestamptz default null)
returns public.project_actions language plpgsql volatile security definer set search_path = public as $$
declare v_action public.project_actions; v_caller record; v_updated public.project_actions;
begin
  select * into v_action from public.project_actions where id = p_action_id for update;
  if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);
  if v_action.status <> 'submitted' then raise exception 'WT_ACTION_INVALID_TRANSITION: Only submitted Actions can be approved.' using errcode = '23514'; end if;
  perform public.project_action_assert_c4_approver(v_action, v_caller.membership_id);
  update public.project_actions set status = 'complete', completed_at = now(), cancelled_at = null where id = v_action.id returning * into v_updated;
  perform public.project_action_insert_c4_history(v_updated, 'completed', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id, 'submitted', 'complete', null,
    jsonb_build_object('status', 'submitted'), jsonb_build_object('status', 'complete', 'completion_route', 'approved'));
  return v_updated;
end;
$$;

create or replace function public.return_project_action_to_actioner(p_action_id uuid, p_reason text, p_expected_status text default null, p_expected_updated_at timestamptz default null)
returns public.project_actions language plpgsql volatile security definer set search_path = public as $$
declare v_action public.project_actions; v_caller record; v_updated public.project_actions;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'WT_ACTION_MISSING_REASON: Reason is required.' using errcode = '23514'; end if;
  select * into v_action from public.project_actions where id = p_action_id for update;
  if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);
  if v_action.status <> 'submitted' then raise exception 'WT_ACTION_INVALID_TRANSITION: Only submitted Actions can be returned.' using errcode = '23514'; end if;
  perform public.project_action_assert_c4_approver(v_action, v_caller.membership_id);
  update public.project_actions set status = 'returned_to_actioner' where id = v_action.id returning * into v_updated;
  perform public.project_action_insert_c4_history(v_updated, 'returned_to_actioner', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id, 'submitted', 'returned_to_actioner', p_reason,
    jsonb_build_object('status', 'submitted'), jsonb_build_object('status', 'returned_to_actioner'));
  return v_updated;
end;
$$;

create or replace function public.reject_project_action(p_action_id uuid, p_reason text, p_expected_status text default null, p_expected_updated_at timestamptz default null)
returns public.project_actions language plpgsql volatile security definer set search_path = public as $$
declare v_action public.project_actions; v_caller record; v_updated public.project_actions;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'WT_ACTION_MISSING_REASON: Reason is required.' using errcode = '23514'; end if;
  select * into v_action from public.project_actions where id = p_action_id for update;
  if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);
  if v_action.status <> 'submitted' then raise exception 'WT_ACTION_INVALID_TRANSITION: Only submitted Actions can be rejected.' using errcode = '23514'; end if;
  perform public.project_action_assert_c4_approver(v_action, v_caller.membership_id);
  update public.project_actions set status = 'rejected_by_actioner' where id = v_action.id returning * into v_updated;
  perform public.project_action_insert_c4_history(v_updated, 'rejected_by_actioner', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id, 'submitted', 'rejected_by_actioner', p_reason,
    jsonb_build_object('status', 'submitted'), jsonb_build_object('status', 'rejected_by_actioner', 'governance_decision', 'rejected'));
  return v_updated;
end;
$$;

create or replace function public.withdraw_project_action_approver(p_action_id uuid, p_reason text, p_expected_status text default null, p_expected_updated_at timestamptz default null)
returns public.project_actions language plpgsql volatile security definer set search_path = public as $$
declare v_action public.project_actions; v_caller record; v_updated public.project_actions;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'WT_ACTION_MISSING_REASON: Reason is required.' using errcode = '23514'; end if;
  select * into v_action from public.project_actions where id = p_action_id for update;
  if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);
  if v_action.status <> 'submitted' then raise exception 'WT_ACTION_INVALID_TRANSITION: Approver withdrawal is available only while submitted.' using errcode = '23514'; end if;
  perform public.project_action_assert_c4_approver(v_action, v_caller.membership_id);
  update public.project_actions set status = 'open', approval_required = false, acceptance_owner_id = raiser_id where id = v_action.id returning * into v_updated;
  perform public.project_action_insert_c4_history(v_updated, 'reassigned', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id, 'submitted', 'open', p_reason,
    jsonb_build_object('approver_profile_id', v_action.acceptance_owner_id), jsonb_build_object('approver_profile_id', null, 'approval_required', false, 'withdrawn', true));
  return v_updated;
end;
$$;

-- C2 responsibility manager also applies in Submitted state; it preserves the
-- submission and assigns a validated replacement Approver atomically.
create or replace function public.set_project_action_approver(p_action_id uuid, p_approver_id uuid default null, p_expected_status text default null, p_expected_updated_at timestamptz default null)
returns public.project_actions language plpgsql volatile security definer set search_path = public as $$
declare v_action public.project_actions; v_caller record; v_approver record; v_actioner record; v_updated public.project_actions;
begin
  perform public.project_action_assert_timestamp_expected(p_expected_updated_at);
  select * into v_action from public.project_actions where id = p_action_id for update;
  if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(v_action.status);
  perform public.project_action_assert_c2_responsibility_manager(v_action, v_caller.profile_id);
  if v_action.status = 'submitted' and p_approver_id is null then raise exception 'WT_ACTION_INVALID_TRANSITION: Use Approver withdrawal for a submitted Action.' using errcode = '23514'; end if;
  select * into v_approver from public.project_action_resolve_responsibility_membership(v_action.organisation_id, p_approver_id);
  select * into v_actioner from public.project_action_resolve_stored_responsibility(v_action.organisation_id, v_action.actioner_id, false);
  if v_approver.membership_id is not null and v_approver.membership_id = v_actioner.membership_id then raise exception 'WT_ACTION_RESPONSIBILITY_OVERLAP: Actioner and Approver must be different workspace members.' using errcode = '23514'; end if;
  update public.project_actions set acceptance_owner_id = coalesce(v_approver.profile_id, raiser_id), approval_required = v_approver.membership_id is not null where id = v_action.id returning * into v_updated;
  perform public.project_action_insert_c4_history(v_updated, 'reassigned', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id, v_action.status, v_updated.status, null,
    jsonb_build_object('approver_profile_id', v_action.acceptance_owner_id), jsonb_build_object('approver_profile_id', v_updated.acceptance_owner_id, 'approver_membership_id', v_approver.membership_id));
  return v_updated;
end;
$$;

revoke all on function public.project_action_insert_c4_history(public.project_actions, text, uuid, uuid, uuid, text, text, text, jsonb, jsonb) from public;
revoke all on function public.project_action_assert_c4_approver(public.project_actions, uuid) from public;
revoke all on function public.withdraw_project_action_approver(uuid, text, text, timestamptz) from public;
grant execute on function public.complete_project_action(uuid, text, timestamptz) to authenticated;
grant execute on function public.return_project_action_to_actioner(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.reject_project_action(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.withdraw_project_action_approver(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.set_project_action_approver(uuid, uuid, text, timestamptz) to authenticated;
