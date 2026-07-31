-- WT-WORKSPACE-TEAM-009A REST API wrappers.
--
-- Production exposed the underlying secure modal RPCs in Postgres, but
-- PostgREST continued returning PGRST202 for those original RPC names. These
-- wrappers give the app fresh API-facing signatures while preserving the
-- existing server-side permission, lock, concurrency and audit implementation.

create or replace function public.start_workspace_member_edit_session_api(
  p_organisation_id uuid,
  p_membership_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  select *
    into v_session
  from public.start_workspace_member_edit_session(p_organisation_id, p_membership_id);

  return jsonb_build_object(
    'can_edit', coalesce(v_session.can_edit, false),
    'session_id', v_session.session_id,
    'expires_at', v_session.expires_at,
    'locked_by_display_name', v_session.locked_by_display_name,
    'message', v_session.message
  );
end;
$$;

create or replace function public.release_workspace_member_edit_session_api(
  p_organisation_id uuid,
  p_session_id uuid,
  p_release_source text default 'modal_closed'
)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  select public.release_workspace_member_edit_session(
    p_organisation_id,
    p_session_id,
    coalesce(nullif(btrim(p_release_source), ''), 'modal_closed')
  );
$$;

create or replace function public.change_workspace_member_role_api(
  p_organisation_id uuid,
  p_membership_id uuid,
  p_target_role text,
  p_expected_snapshot_version text,
  p_edit_session_id uuid default null
)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  select public.change_workspace_member_role(
    p_organisation_id,
    p_membership_id,
    p_target_role,
    p_expected_snapshot_version,
    p_edit_session_id
  );
$$;

revoke all on function public.start_workspace_member_edit_session_api(uuid, uuid) from public;
revoke all on function public.release_workspace_member_edit_session_api(uuid, uuid, text) from public;
revoke all on function public.change_workspace_member_role_api(uuid, uuid, text, text, uuid) from public;

grant execute on function public.start_workspace_member_edit_session_api(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.release_workspace_member_edit_session_api(uuid, uuid, text) to anon, authenticated, service_role;
grant execute on function public.change_workspace_member_role_api(uuid, uuid, text, text, uuid) to anon, authenticated, service_role;

comment on function public.start_workspace_member_edit_session_api(uuid, uuid) is
  'REST-visible wrapper for the Workspace Team member edit-session RPC. Delegates to start_workspace_member_edit_session so permission and advisory-lock behaviour remains centralised.';
comment on function public.release_workspace_member_edit_session_api(uuid, uuid, text) is
  'REST-visible wrapper for releasing a Workspace Team member edit session. Delegates to release_workspace_member_edit_session.';
comment on function public.change_workspace_member_role_api(uuid, uuid, text, text, uuid) is
  'REST-visible wrapper for individual workspace member role changes. Delegates to change_workspace_member_role so authority, optimistic concurrency and audit behaviour remain centralised.';

notify pgrst, 'reload schema';
