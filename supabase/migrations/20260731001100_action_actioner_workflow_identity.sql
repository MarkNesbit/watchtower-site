-- WT-ACTION-IDENTITY-001C3: split-ID-safe Actioner workflow. Approval and
-- governance RPCs deliberately remain unchanged for C4/C5.

create or replace function public.project_action_resolve_stored_responsibility(
  p_organisation_id uuid, p_profile_id uuid, p_required boolean default true
)
returns table (membership_id uuid, profile_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_profile_id is null then
    if p_required then raise exception 'WT_ACTION_ACTIONER_REQUIRED: An Actioner is required.' using errcode = '23514'; end if;
    return;
  end if;
  return query select om.id, om.user_id from public.organisation_members om
    where om.organisation_id = p_organisation_id and om.user_id = p_profile_id and om.status = 'active';
  if not found then
    raise exception 'WT_ACTION_INELIGIBLE_RESPONSIBILITY: The Action responsibility holder is not an active workspace member.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.project_action_insert_c3_history(
  p_action public.project_actions, p_event_type text, p_actor_auth_user_id uuid, p_actor_profile_id uuid, p_actor_membership_id uuid,
  p_from_status text, p_to_status text, p_response text default null,
  p_old_values jsonb default null, p_new_values jsonb default null
)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.project_action_history (
    organisation_id, project_id, action_id, event_type, actor_user_id,
    actor_auth_user_id, actor_membership_id, from_status, to_status,
    response, old_values, new_values
  ) values (
    p_action.organisation_id, p_action.project_id, p_action.id, p_event_type,
    p_actor_profile_id, p_actor_auth_user_id, p_actor_membership_id,
    p_from_status, p_to_status, nullif(btrim(p_response), ''), p_old_values, p_new_values
  );
end;
$$;

create or replace function public.save_project_action_progress(
  p_action_id uuid, p_response text, p_expected_status text default null, p_expected_updated_at timestamptz default null
)
returns public.project_actions language plpgsql volatile security definer set search_path = public as $$
declare v_action public.project_actions; v_caller record; v_actioner record; v_updated public.project_actions;
begin
  if p_response is null or length(btrim(p_response)) = 0 then raise exception 'WT_ACTION_MISSING_RESPONSE: Response is required.' using errcode = '23514'; end if;
  select * into v_action from public.project_actions where id = p_action_id for update;
  if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);
  if v_action.status not in ('open', 'returned_to_actioner') then raise exception 'WT_ACTION_INVALID_TRANSITION: Progress updates can only be saved while an Action is outstanding.' using errcode = '23514'; end if;
  select * into v_actioner from public.project_action_resolve_stored_responsibility(v_action.organisation_id, v_action.actioner_id);
  if v_caller.membership_id is distinct from v_actioner.membership_id then raise exception 'WT_ACTION_PERMISSION_DENIED: Only the current Actioner can update progress.' using errcode = '42501'; end if;
  update public.project_actions set latest_response = btrim(p_response) where id = v_action.id returning * into v_updated;
  perform public.project_action_insert_c3_history(v_updated, 'progress_updated', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id, v_action.status, v_updated.status, v_updated.latest_response,
    jsonb_build_object('latest_response', v_action.latest_response), jsonb_build_object('latest_response', v_updated.latest_response, 'actioner_membership_id', v_actioner.membership_id));
  return v_updated;
end;
$$;

create or replace function public.submit_project_action(
  p_action_id uuid, p_response text, p_evidence_url text default null, p_expected_status text default null, p_expected_updated_at timestamptz default null
)
returns public.project_actions language plpgsql volatile security definer set search_path = public as $$
declare v_action public.project_actions; v_caller record; v_actioner record; v_approver record; v_updated public.project_actions; v_evidence text;
begin
  if p_response is null or length(btrim(p_response)) = 0 then raise exception 'WT_ACTION_MISSING_RESPONSE: Response is required.' using errcode = '23514'; end if;
  v_evidence := nullif(btrim(p_evidence_url), '');
  if v_evidence is not null and v_evidence !~* '^https?://' then raise exception 'WT_ACTION_UNSAFE_EVIDENCE_URL: Evidence URL must start with http:// or https://.' using errcode = '23514'; end if;
  select * into v_action from public.project_actions where id = p_action_id for update;
  if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);
  if v_action.status not in ('open', 'returned_to_actioner') then raise exception 'WT_ACTION_INVALID_TRANSITION: Action can only be submitted from Open or Returned work.' using errcode = '23514'; end if;
  if not v_action.approval_required then raise exception 'WT_ACTION_APPROVER_REQUIRED: An Approver is required before submission.' using errcode = '23514'; end if;
  select * into v_actioner from public.project_action_resolve_stored_responsibility(v_action.organisation_id, v_action.actioner_id);
  select * into v_approver from public.project_action_resolve_stored_responsibility(v_action.organisation_id, v_action.acceptance_owner_id);
  if v_caller.membership_id is distinct from v_actioner.membership_id then raise exception 'WT_ACTION_PERMISSION_DENIED: Only the current Actioner can submit.' using errcode = '42501'; end if;
  if v_actioner.membership_id = v_approver.membership_id then raise exception 'WT_ACTION_RESPONSIBILITY_OVERLAP: Actioner and Approver must be different workspace members.' using errcode = '23514'; end if;
  update public.project_actions set status = 'submitted', latest_response = btrim(p_response), latest_evidence_url = v_evidence, submitted_at = now(), completed_at = null, cancelled_at = null where id = v_action.id returning * into v_updated;
  perform public.project_action_insert_c3_history(v_updated, 'submitted', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id, v_action.status, 'submitted', v_updated.latest_response,
    jsonb_build_object('status', v_action.status), jsonb_build_object('status', 'submitted', 'actioner_membership_id', v_actioner.membership_id, 'approver_membership_id', v_approver.membership_id));
  return v_updated;
end;
$$;

create or replace function public.complete_project_action(
  p_action_id uuid, p_expected_status text default null, p_expected_updated_at timestamptz default null
)
returns public.project_actions language plpgsql volatile security definer set search_path = public as $$
declare v_action public.project_actions; v_caller record; v_actioner record; v_updated public.project_actions;
begin
  select * into v_action from public.project_actions where id = p_action_id for update;
  if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);
  if v_action.status not in ('open', 'returned_to_actioner') then raise exception 'WT_ACTION_INVALID_TRANSITION: Direct completion is available only for outstanding Actions.' using errcode = '23514'; end if;
  if v_action.approval_required then raise exception 'WT_ACTION_APPROVER_ASSIGNED: Submit this Action for approval instead of completing it directly.' using errcode = '23514'; end if;
  select * into v_actioner from public.project_action_resolve_stored_responsibility(v_action.organisation_id, v_action.actioner_id);
  if v_caller.membership_id is distinct from v_actioner.membership_id then raise exception 'WT_ACTION_PERMISSION_DENIED: Only the current Actioner can complete this Action.' using errcode = '42501'; end if;
  update public.project_actions set status = 'complete', completed_at = now(), cancelled_at = null where id = v_action.id returning * into v_updated;
  perform public.project_action_insert_c3_history(v_updated, 'completed', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id, v_action.status, 'complete', null,
    jsonb_build_object('status', v_action.status), jsonb_build_object('status', 'complete', 'completion_route', 'direct', 'actioner_membership_id', v_actioner.membership_id));
  return v_updated;
end;
$$;

revoke all on function public.project_action_resolve_stored_responsibility(uuid, uuid, boolean) from public;
revoke all on function public.project_action_insert_c3_history(public.project_actions, text, uuid, uuid, uuid, text, text, text, jsonb, jsonb) from public;
revoke all on function public.save_project_action_progress(uuid, text, text, timestamptz) from public;
revoke all on function public.submit_project_action(uuid, text, text, text, timestamptz) from public;
revoke all on function public.complete_project_action(uuid, text, timestamptz) from public;
grant execute on function public.save_project_action_progress(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.submit_project_action(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.complete_project_action(uuid, text, timestamptz) to authenticated;
