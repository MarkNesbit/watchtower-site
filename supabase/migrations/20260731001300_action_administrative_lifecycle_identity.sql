-- WT-ACTION-IDENTITY-001C5: remaining administrative Action mutations.

create or replace function public.cancel_project_action(p_action_id uuid, p_reason text, p_expected_status text default null, p_expected_updated_at timestamptz default null)
returns public.project_actions language plpgsql volatile security definer set search_path = public as $$
declare a public.project_actions; c record; u public.project_actions;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'WT_ACTION_MISSING_REASON: Reason is required.' using errcode = '23514'; end if;
  select * into a from public.project_actions where id=p_action_id for update; if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode='42501'; end if;
  select * into c from public.resolve_action_identity(a.organisation_id);
  perform public.project_action_assert_expected_state(a.status,a.updated_at,p_expected_status,p_expected_updated_at);
  if a.status in ('complete','cancelled','rejected_by_actioner') then raise exception 'WT_ACTION_INVALID_TRANSITION: Terminal Actions cannot be cancelled.' using errcode='23514'; end if;
  perform public.project_action_assert_c2_responsibility_manager(a,c.profile_id);
  update public.project_actions set status='cancelled', cancelled_at=now() where id=a.id returning * into u;
  perform public.project_action_insert_c4_history(u,'cancelled',c.auth_user_id,c.profile_id,c.membership_id,a.status,'cancelled',p_reason,jsonb_build_object('status',a.status),jsonb_build_object('status','cancelled'));
  return u;
end; $$;

create or replace function public.amend_project_action_brief(p_action_id uuid,p_brief text,p_expected_status text default null,p_expected_updated_at timestamptz default null)
returns public.project_actions language plpgsql volatile security definer set search_path=public as $$
declare a public.project_actions; c record; u public.project_actions;
begin
  if p_brief is null or length(btrim(p_brief))=0 then raise exception 'WT_ACTION_MISSING_BRIEF: Action brief is required.' using errcode='23514'; end if;
  select * into a from public.project_actions where id=p_action_id for update; if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode='42501'; end if;
  select * into c from public.resolve_action_identity(a.organisation_id); perform public.project_action_assert_expected_state(a.status,a.updated_at,p_expected_status,p_expected_updated_at); perform public.project_action_assert_non_terminal(a.status); perform public.project_action_assert_c2_responsibility_manager(a,c.profile_id);
  if btrim(p_brief)=a.brief then raise exception 'WT_ACTION_NO_CHANGE: Action brief has not changed.' using errcode='23514'; end if;
  update public.project_actions set brief=btrim(p_brief) where id=a.id returning * into u;
  perform public.project_action_insert_c4_history(u,'brief_amended',c.auth_user_id,c.profile_id,c.membership_id,a.status,u.status,null,jsonb_build_object('brief',a.brief),jsonb_build_object('brief',u.brief)); return u;
end; $$;

create or replace function public.change_project_action_due_date(p_action_id uuid,p_due_date date,p_expected_status text default null,p_expected_updated_at timestamptz default null)
returns public.project_actions language plpgsql volatile security definer set search_path=public as $$
declare a public.project_actions; c record; u public.project_actions;
begin
  select * into a from public.project_actions where id=p_action_id for update; if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode='42501'; end if;
  select * into c from public.resolve_action_identity(a.organisation_id); perform public.project_action_assert_expected_state(a.status,a.updated_at,p_expected_status,p_expected_updated_at); perform public.project_action_assert_non_terminal(a.status); perform public.project_action_assert_c2_responsibility_manager(a,c.profile_id);
  update public.project_actions set due_date=p_due_date where id=a.id returning * into u;
  perform public.project_action_insert_c4_history(u,'due_date_changed',c.auth_user_id,c.profile_id,c.membership_id,a.status,u.status,null,jsonb_build_object('due_date',a.due_date),jsonb_build_object('due_date',u.due_date)); return u;
end; $$;

create or replace function public.reissue_project_action(p_action_id uuid,p_expected_status text default null,p_expected_updated_at timestamptz default null,p_brief text default null,p_due_date date default null,p_actioner_id uuid default null,p_change_actioner boolean default false)
returns public.project_actions language plpgsql volatile security definer set search_path=public as $$
declare a public.project_actions; c record; holder record; approver record; u public.project_actions; next_brief text; next_actioner uuid;
begin
  select * into a from public.project_actions where id=p_action_id for update; if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode='42501'; end if;
  select * into c from public.resolve_action_identity(a.organisation_id); perform public.project_action_assert_expected_state(a.status,a.updated_at,p_expected_status,p_expected_updated_at); perform public.project_action_assert_c2_responsibility_manager(a,c.profile_id);
  if a.status not in ('returned_to_raiser','rejected_by_actioner') then raise exception 'WT_ACTION_INVALID_TRANSITION: Only returned or rejected Actions can be reissued.' using errcode='23514'; end if;
  next_brief:=coalesce(nullif(btrim(p_brief),''),a.brief); if length(next_brief)=0 then raise exception 'WT_ACTION_MISSING_BRIEF: Action brief is required.' using errcode='23514'; end if;
  if p_change_actioner then select * into holder from public.project_action_resolve_responsibility_membership(a.organisation_id,p_actioner_id); else select * into holder from public.project_action_resolve_stored_responsibility(a.organisation_id,a.actioner_id,false); end if;
  if a.approval_required and holder.membership_id is not null then select * into approver from public.project_action_resolve_stored_responsibility(a.organisation_id,a.acceptance_owner_id); if holder.membership_id=approver.membership_id then raise exception 'WT_ACTION_RESPONSIBILITY_OVERLAP: Actioner and Approver must be different workspace members.' using errcode='23514'; end if; end if;
  update public.project_actions set status='open',brief=next_brief,due_date=coalesce(p_due_date,a.due_date),actioner_id=holder.profile_id,latest_response=null,latest_evidence_url=null,submitted_at=null where id=a.id returning * into u;
  perform public.project_action_insert_c4_history(u,'reissued',c.auth_user_id,c.profile_id,c.membership_id,a.status,'open',null,jsonb_build_object('status',a.status,'actioner_id',a.actioner_id),jsonb_build_object('status','open','actioner_id',u.actioner_id,'actioner_membership_id',holder.membership_id)); return u;
end; $$;

create or replace function public.take_over_project_action_acceptance(p_action_id uuid,p_reason text,p_expected_status text default null,p_expected_updated_at timestamptz default null)
returns public.project_actions language plpgsql volatile security definer set search_path=public as $$
declare a public.project_actions; c record; actioner record; u public.project_actions;
begin
  if p_reason is null or length(btrim(p_reason))=0 then raise exception 'WT_ACTION_MISSING_REASON: Reason is required.' using errcode='23514'; end if;
  select * into a from public.project_actions where id=p_action_id for update; if not found then raise exception 'WT_ACTION_SCOPE: Action not found or unavailable.' using errcode='42501'; end if;
  select * into c from public.resolve_action_identity(a.organisation_id); perform public.project_action_assert_expected_state(a.status,a.updated_at,p_expected_status,p_expected_updated_at); perform public.project_action_assert_non_terminal(a.status);
  if not exists(select 1 from public.project_people pp where pp.organisation_id=a.organisation_id and pp.project_id=a.project_id and pp.user_id=c.profile_id and pp.status='active' and pp.project_role in ('project_manager','product_owner','delivery_lead')) then raise exception 'WT_ACTION_PERMISSION_DENIED: Only the Project Manager, Product Owner or Delivery Manager can take over approval.' using errcode='42501'; end if;
  select * into actioner from public.project_action_resolve_stored_responsibility(a.organisation_id,a.actioner_id,false); if c.membership_id=actioner.membership_id then raise exception 'WT_ACTION_RESPONSIBILITY_OVERLAP: Actioner cannot take over approval.' using errcode='23514'; end if;
  update public.project_actions set acceptance_owner_id=c.profile_id,approval_required=true where id=a.id returning * into u;
  perform public.project_action_insert_c4_history(u,'acceptance_owner_taken_over',c.auth_user_id,c.profile_id,c.membership_id,a.status,u.status,p_reason,jsonb_build_object('approver_profile_id',a.acceptance_owner_id),jsonb_build_object('approver_profile_id',u.acceptance_owner_id,'approver_membership_id',c.membership_id)); return u;
end; $$;

grant execute on function public.cancel_project_action(uuid,text,text,timestamptz) to authenticated;
grant execute on function public.amend_project_action_brief(uuid,text,text,timestamptz) to authenticated;
grant execute on function public.change_project_action_due_date(uuid,date,text,timestamptz) to authenticated;
grant execute on function public.reissue_project_action(uuid,text,timestamptz,text,date,uuid,boolean) to authenticated;
grant execute on function public.take_over_project_action_acceptance(uuid,text,text,timestamptz) to authenticated;
