-- WT-ACTION-IDENTITY-001C2: create and manage Action responsibilities through
-- the canonical workspace-membership identity. Responsibility storage remains
-- profile-keyed until 001D; the membership-to-profile translation below is the
-- deliberately narrow compatibility boundary.

alter table public.project_actions
  add column if not exists created_by_auth_user_id uuid references auth.users(id),
  add column if not exists updated_by_auth_user_id uuid references auth.users(id),
  add column if not exists approval_required boolean not null default false;

alter table public.project_action_history
  add column if not exists actor_auth_user_id uuid references auth.users(id),
  add column if not exists actor_membership_id uuid references public.organisation_members(id);

comment on column public.project_actions.created_by_auth_user_id is
  'Authenticated creator audit identity. C2 compatibility field; created_by remains profile attribution until 001D.';
comment on column public.project_actions.updated_by_auth_user_id is
  'Authenticated updater audit identity. C2 compatibility field; updated_by remains profile attribution until 001D.';
comment on column public.project_actions.approval_required is
  'C2 workflow compatibility flag. False means no Approver was appointed; acceptance_owner_id remains the profile-keyed legacy column until 001D.';
comment on column public.project_action_history.actor_auth_user_id is
  'Authenticated actor audit identity, distinct from actor_user_id profile attribution.';
comment on column public.project_action_history.actor_membership_id is
  'Workspace membership through which the actor performed this event.';

create or replace function public.project_action_resolve_responsibility_membership(
  p_organisation_id uuid,
  p_membership_id uuid,
  p_required boolean default false
)
returns table (membership_id uuid, profile_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_membership_id is null then
    if p_required then
      raise exception 'WT_ACTION_RESPONSIBILITY_REQUIRED: A workspace member is required.' using errcode = '23502';
    end if;
    return;
  end if;

  return query
    select om.id, om.user_id
    from public.organisation_members om
    where om.id = p_membership_id
      and om.organisation_id = p_organisation_id
      and om.status = 'active';

  if not found then
    raise exception 'WT_ACTION_INELIGIBLE_RESPONSIBILITY: Select an active member of this workspace.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.project_action_assert_c2_responsibility_manager(
  p_action public.project_actions,
  p_caller_profile_id uuid
)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_caller_profile_id = p_action.raiser_id then
    return;
  end if;

  if exists (
    select 1
    from public.project_people pp
    where pp.organisation_id = p_action.organisation_id
      and pp.project_id = p_action.project_id
      and pp.user_id = p_caller_profile_id
      and pp.status = 'active'
      and pp.project_role in ('project_manager', 'product_owner', 'delivery_lead')
  ) then
    return;
  end if;

  raise exception 'WT_ACTION_PERMISSION_DENIED: Only the raiser, Project Manager, Product Owner or Delivery Manager can manage Action responsibilities.'
    using errcode = '42501';
end;
$$;

create or replace function public.project_action_insert_c2_history(
  p_action public.project_actions,
  p_event_type text,
  p_actor_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_actor_membership_id uuid,
  p_old_values jsonb default null,
  p_new_values jsonb default null
)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.project_action_history (
    organisation_id, project_id, action_id, event_type, actor_user_id,
    actor_auth_user_id, actor_membership_id, from_status, to_status,
    old_values, new_values
  ) values (
    p_action.organisation_id, p_action.project_id, p_action.id, p_event_type,
    p_actor_profile_id, p_actor_auth_user_id, p_actor_membership_id,
    null, p_action.status, p_old_values, p_new_values
  );
end;
$$;

-- Keep legacy profile audit columns valid for split-ID users while retaining
-- the authenticated actor in the explicit compatibility columns above.
create or replace function public.prepare_project_action_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target_organisation_id uuid;
  target_project_ref text;
  actor record;
begin
  select projects.organisation_id, projects.project_ref into target_organisation_id, target_project_ref
  from public.projects where projects.id = new.project_id;
  if not found then raise exception 'Project Action project does not exist.' using errcode = '23503'; end if;
  if target_project_ref is null then raise exception 'Project reference is required before a Project Action can be created.' using errcode = '23514'; end if;
  if new.raiser_id is null then raise exception 'Project Action raiser is required.' using errcode = '23502'; end if;
  if new.acceptance_owner_id is null then new.acceptance_owner_id = new.raiser_id; end if;
  new.source_context = coalesce(new.source_context, '{}'::jsonb);
  insert into public.project_action_counters (project_id, organisation_id, last_action_number)
  values (new.project_id, target_organisation_id, 1)
  on conflict (project_id) do update set last_action_number = project_action_counters.last_action_number + 1, updated_at = now()
  returning last_action_number into new.action_number;
  new.organisation_id = target_organisation_id;
  new.action_ref = format('Action-%s-%s', target_project_ref, lpad(new.action_number::text, 3, '0'));
  if auth.uid() is not null then
    select * into actor from public.resolve_action_identity(target_organisation_id);
    new.created_by = actor.profile_id;
    new.updated_by = actor.profile_id;
    new.created_by_auth_user_id = actor.auth_user_id;
    new.updated_by_auth_user_id = actor.auth_user_id;
  elsif coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authenticated user is required for Project Action audit fields.' using errcode = '42501';
  elsif new.created_by is null then
    raise exception 'Service-created Project Actions require created_by.' using errcode = '23502';
  end if;
  return new;
end;
$$;

create or replace function public.set_project_action_update_audit_fields()
returns trigger
language plpgsql security definer set search_path = public as $$
declare actor record;
begin
  if auth.uid() is not null then
    select * into actor from public.resolve_action_identity(new.organisation_id);
    new.updated_by = actor.profile_id;
    new.updated_by_auth_user_id = actor.auth_user_id;
  elsif coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authenticated user is required for Project Action audit fields.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop function if exists public.create_project_action(uuid, text, date, uuid, text, uuid, text, text, jsonb);
create function public.create_project_action(
  p_project_id uuid,
  p_brief text,
  p_due_date date default null,
  p_actioner_id uuid default null,
  p_approver_id uuid default null,
  p_source_type text default 'project',
  p_source_record_id uuid default null,
  p_source_ref text default null,
  p_source_label text default null,
  p_source_context jsonb default '{}'::jsonb
)
returns public.project_actions
language plpgsql volatile security definer set search_path = public as $$
declare
  v_organisation_id uuid;
  v_caller record;
  v_actioner record;
  v_approver record;
  v_action public.project_actions;
begin
  if p_project_id is null then raise exception 'WT_ACTION_SCOPE: Project is required.' using errcode = '23502'; end if;
  if p_brief is null or length(btrim(p_brief)) = 0 then raise exception 'WT_ACTION_MISSING_BRIEF: Action brief is required.' using errcode = '23514'; end if;
  if p_source_type not in ('project', 'risk', 'project_details', 'narrative') then raise exception 'WT_ACTION_INVALID_SOURCE: Select a valid Action source.' using errcode = '23514'; end if;
  if p_source_context is not null and jsonb_typeof(p_source_context) <> 'object' then raise exception 'WT_ACTION_INVALID_SOURCE: Action source context must be a JSON object.' using errcode = '23514'; end if;
  select organisation_id into v_organisation_id from public.projects where id = p_project_id and deleted_at is null and archived_at is null;
  if v_organisation_id is null then raise exception 'WT_ACTION_SCOPE: Project not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_organisation_id);
  select * into v_actioner from public.project_action_resolve_responsibility_membership(v_organisation_id, p_actioner_id);
  select * into v_approver from public.project_action_resolve_responsibility_membership(v_organisation_id, p_approver_id);
  if v_actioner.membership_id is not null and v_actioner.membership_id = v_approver.membership_id then
    raise exception 'WT_ACTION_RESPONSIBILITY_OVERLAP: Actioner and Approver must be different workspace members.' using errcode = '23514';
  end if;
  insert into public.project_actions (project_id, brief, status, due_date, raiser_id, actioner_id, acceptance_owner_id, approval_required, source_type, source_record_id, source_ref, source_label, source_context, created_by, updated_by)
  values (p_project_id, btrim(p_brief), 'open', p_due_date, v_caller.profile_id, v_actioner.profile_id, coalesce(v_approver.profile_id, v_caller.profile_id), v_approver.membership_id is not null, p_source_type, p_source_record_id, nullif(btrim(p_source_ref), ''), nullif(btrim(p_source_label), ''), coalesce(p_source_context, '{}'::jsonb), v_caller.profile_id, v_caller.profile_id)
  returning * into v_action;
  perform public.project_action_insert_c2_history(v_action, 'created', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id, null,
    jsonb_build_object('raiser_profile_id', v_action.raiser_id, 'actioner_profile_id', v_action.actioner_id, 'actioner_membership_id', v_actioner.membership_id, 'approver_profile_id', v_action.acceptance_owner_id, 'approver_membership_id', coalesce(v_approver.membership_id, v_caller.membership_id), 'due_date', v_action.due_date));
  return v_action;
end;
$$;

create or replace function public.assign_project_action(
  p_action_id uuid, p_actioner_id uuid, p_expected_status text default null, p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql volatile security definer set search_path = public as $$
declare v_action public.project_actions; v_caller record; v_actioner record; v_approver_membership uuid; v_updated public.project_actions; v_event text;
begin
  perform public.project_action_assert_timestamp_expected(p_expected_updated_at);
  select * into v_action from public.project_actions where id = p_action_id for update;
  if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(v_action.status);
  perform public.project_action_assert_c2_responsibility_manager(v_action, v_caller.profile_id);
  if v_action.status = 'submitted' then raise exception 'WT_ACTION_INVALID_TRANSITION: Reassignment is blocked while an Action is submitted.' using errcode = '23514'; end if;
  select * into v_actioner from public.project_action_resolve_responsibility_membership(v_action.organisation_id, p_actioner_id);
  select membership_id into v_approver_membership from public.organisation_members where organisation_id = v_action.organisation_id and user_id = v_action.acceptance_owner_id and status = 'active';
  if v_actioner.membership_id is not null and v_actioner.membership_id = v_approver_membership then raise exception 'WT_ACTION_RESPONSIBILITY_OVERLAP: Actioner and Approver must be different workspace members.' using errcode = '23514'; end if;
  v_event := case when v_action.actioner_id is null and v_actioner.profile_id is not null then 'assigned' when v_action.actioner_id is not null and v_actioner.profile_id is null then 'unassigned' else 'reassigned' end;
  update public.project_actions set actioner_id = v_actioner.profile_id where id = v_action.id returning * into v_updated;
  perform public.project_action_insert_c2_history(v_updated, v_event, v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id,
    jsonb_build_object('actioner_profile_id', v_action.actioner_id), jsonb_build_object('actioner_profile_id', v_updated.actioner_id, 'actioner_membership_id', v_actioner.membership_id));
  return v_updated;
end;
$$;

create or replace function public.set_project_action_approver(
  p_action_id uuid, p_approver_id uuid default null, p_expected_status text default null, p_expected_updated_at timestamptz default null
)
returns public.project_actions
language plpgsql volatile security definer set search_path = public as $$
declare v_action public.project_actions; v_caller record; v_approver record; v_actioner_membership uuid; v_updated public.project_actions;
begin
  perform public.project_action_assert_timestamp_expected(p_expected_updated_at);
  select * into v_action from public.project_actions where id = p_action_id for update;
  if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode = '42501'; end if;
  select * into v_caller from public.resolve_action_identity(v_action.organisation_id);
  perform public.project_action_assert_expected_state(v_action.status, v_action.updated_at, p_expected_status, p_expected_updated_at);
  perform public.project_action_assert_non_terminal(v_action.status);
  perform public.project_action_assert_c2_responsibility_manager(v_action, v_caller.profile_id);
  if v_action.status = 'submitted' then raise exception 'WT_ACTION_INVALID_TRANSITION: Approver changes after submission are handled by the approval workflow.' using errcode = '23514'; end if;
  select * into v_approver from public.project_action_resolve_responsibility_membership(v_action.organisation_id, p_approver_id);
  select membership_id into v_actioner_membership from public.organisation_members where organisation_id = v_action.organisation_id and user_id = v_action.actioner_id and status = 'active';
  if v_approver.membership_id is not null and v_approver.membership_id = v_actioner_membership then raise exception 'WT_ACTION_RESPONSIBILITY_OVERLAP: Actioner and Approver must be different workspace members.' using errcode = '23514'; end if;
  update public.project_actions set acceptance_owner_id = coalesce(v_approver.profile_id, v_action.raiser_id), approval_required = v_approver.membership_id is not null where id = v_action.id returning * into v_updated;
  perform public.project_action_insert_c2_history(v_updated, 'reassigned', v_caller.auth_user_id, v_caller.profile_id, v_caller.membership_id,
    jsonb_build_object('approver_profile_id', v_action.acceptance_owner_id), jsonb_build_object('approver_profile_id', v_updated.acceptance_owner_id, 'approver_membership_id', v_approver.membership_id));
  return v_updated;
end;
$$;

revoke all on function public.project_action_resolve_responsibility_membership(uuid, uuid, boolean) from public;
revoke all on function public.project_action_assert_c2_responsibility_manager(public.project_actions, uuid) from public;
revoke all on function public.project_action_insert_c2_history(public.project_actions, text, uuid, uuid, uuid, jsonb, jsonb) from public;
revoke all on function public.create_project_action(uuid, text, date, uuid, uuid, text, uuid, text, text, jsonb) from public;
revoke all on function public.assign_project_action(uuid, uuid, text, timestamptz) from public;
revoke all on function public.set_project_action_approver(uuid, uuid, text, timestamptz) from public;
grant execute on function public.create_project_action(uuid, text, date, uuid, uuid, text, uuid, text, text, jsonb) to authenticated;
grant execute on function public.assign_project_action(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.set_project_action_approver(uuid, uuid, text, timestamptz) to authenticated;
