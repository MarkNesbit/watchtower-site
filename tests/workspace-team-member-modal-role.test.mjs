import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { can } from '../src/lib/permissions.ts';
import {
	WORKSPACE_TEAM_MEMBER_ROLE_CHANGE_RPC,
	WORKSPACE_TEAM_MEMBER_SESSION_RELEASE_RPC,
	WORKSPACE_TEAM_MEMBER_SESSION_RPC,
	workspaceTeamRoleAuthority,
	workspaceTeamRoleChangeErrorMessage,
} from '../src/lib/workspaceTeam.ts';
import {
	buildWorkspaceTeamMemberRolePath,
	buildWorkspaceTeamMemberSessionPath,
} from '../src/lib/projectRoutes.ts';

const pageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const roleRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/members/role.ts', import.meta.url);
const sessionRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/members/session.ts', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20260730000100_workspace_member_modal_role_management.sql', import.meta.url);

async function pageSource() {
	return readFile(pageUrl, 'utf8');
}

async function migrationSql() {
	return readFile(migrationUrl, 'utf8');
}

test('Workspace Team central permissions restrict page access to Owner and Admin', () => {
	assert.equal(can('owner', 'workspaceTeam.view'), true);
	assert.equal(can('admin', 'workspaceTeam.view'), true);
	assert.equal(can('member', 'workspaceTeam.view'), false);
	assert.equal(can('viewer', 'workspaceTeam.view'), false);
	assert.equal(can('owner', 'workspaceTeam.manageRoles'), true);
	assert.equal(can('admin', 'workspaceTeam.manageRoles'), true);
	assert.equal(can('member', 'workspaceTeam.manageRoles'), false);
	assert.equal(can('viewer', 'workspaceTeam.manageRoles'), false);
});

test('Workspace Team role helper implements Owner and Admin modal authority', () => {
	assert.deepEqual(workspaceTeamRoleAuthority('owner', 'viewer', false), {
		canEdit: true,
		options: ['viewer', 'member', 'admin', 'owner'],
		reason: 'Owners can assign Viewer, Member, Admin or Owner to another active member.',
	});
	assert.deepEqual(workspaceTeamRoleAuthority('owner', 'owner', true), {
		canEdit: false,
		options: [],
		reason: 'Users cannot change their own workspace role through this modal.',
	});
	assert.deepEqual(workspaceTeamRoleAuthority('admin', 'viewer', false), {
		canEdit: true,
		options: ['viewer', 'member'],
		reason: 'Admins can move Viewers and Members between Viewer and Member.',
	});
	assert.equal(workspaceTeamRoleAuthority('admin', 'admin', false).canEdit, false);
	assert.match(workspaceTeamRoleAuthority('admin', 'admin', false).reason, /Owner may change an Admin/);
	assert.equal(workspaceTeamRoleAuthority('admin', 'owner', false).canEdit, false);
	assert.match(workspaceTeamRoleAuthority('admin', 'owner', false).reason, /Admins cannot change an Owner/);
	assert.equal(workspaceTeamRoleAuthority('admin', 'member', true).canEdit, false);
	assert.match(workspaceTeamRoleAuthority('member', 'viewer', false).reason, /Only active Workspace Owners and Admins/);
});

test('Workspace Team member modal page exposes accessible modal fields controls and unsaved handling', async () => {
	const page = await pageSource();

	assert.match(page, /data-workspace-team-member-dialog/);
	assert.match(page, /data-workspace-team-member-open/);
	assert.match(page, /aria-haspopup="dialog"/);
	assert.match(page, /data-workspace-team-dialog-focus/);
	assert.match(page, /Full name/);
	assert.match(page, /Login name/);
	assert.match(page, /Contact email/);
	assert.match(page, /Workspace role/);
	assert.match(page, /Membership status/);
	assert.match(page, /Invitation status/);
	assert.match(page, /Joined date/);
	assert.match(page, /Invited date/);
	assert.match(page, /Accepted date/);
	assert.match(page, /Last login/);
	assert.match(page, /data-member-role-select/);
	assert.match(page, /data-member-save/);
	assert.match(page, /memberDialogDirty/);
	assert.match(page, /resetMemberRoleSelection/);
	assert.match(page, /normalizeMemberRole\(select\.value\) !== normalizeMemberRole\(form\.dataset\.memberInitialRole\)/);
	assert.match(page, /select\.addEventListener\('input', onRoleChange\)/);
	assert.match(page, /select\.addEventListener\('change', onRoleChange\)/);
	assert.match(page, /Discard the unsaved role change/);
	assert.match(page, /dialog\.addEventListener\('cancel'/);
	assert.match(page, /setMemberError/);
	assert.doesNotMatch(page, />Profile ID<|>Membership ID<|profile UUID|membership UUID/i);
});

test('Workspace Team member modal keeps editable role control in primary membership content', async () => {
	const page = await pageSource();
	const membershipSection = page.match(/<section class="workspace-team-member-modal__section" aria-labelledby=\{`\$\{modalId\}-membership-heading`\}>[\s\S]*?<\/section>/)?.[0] ?? '';

	assert.match(membershipSection, /<dt id=\{roleLabelId\}>Workspace role<\/dt>[\s\S]*data-member-role-select/);
	assert.match(membershipSection, /aria-labelledby=\{roleLabelId\}/);
	assert.match(membershipSection, /aria-describedby=\{`\$\{roleHelpId\} \$\{errorId\}`\}/);
	assert.match(membershipSection, /Membership status/);
	assert.doesNotMatch(page, /id=\{`\$\{modalId\}-role-heading`\}>Workspace role/);
	assert.doesNotMatch(page, /data-member-current-role-label/);
});

test('Workspace Team member modal save state follows role changes and edit availability', async () => {
	const page = await pageSource();
	const updateFunction = page.match(/function updateMemberSaveState\(dialog\) \{[\s\S]*?\n\t\}/)?.[0] ?? '';
	const acquireFunction = page.match(/async function acquireMemberSession\(dialog\) \{[\s\S]*?function closeMemberDialog/)?.[0] ?? '';
	const submitHandler = page.match(/form\.addEventListener\('submit', async \(event\) => \{[\s\S]*?window\.location\.reload\(\)/)?.[0] ?? '';

	assert.match(updateFunction, /const hasChanged = select instanceof HTMLSelectElement[\s\S]*normalizeMemberRole\(select\.value\) !== normalizeMemberRole\(form\.dataset\.memberInitialRole\)/);
	assert.match(updateFunction, /const hasSession = Boolean\(form\.dataset\.memberSessionId\)/);
	assert.match(updateFunction, /dialog\.dataset\.memberEditState === 'editable'/);
	assert.match(updateFunction, /save\.disabled = !canEdit \|\| !hasChanged \|\| !hasSession/);
	assert.match(page, /select\.value = normalizeMemberRole\(form\.dataset\.memberInitialRole\)/);
	assert.match(acquireFunction, /setMemberEditState\(dialog, 'checking'\)/);
	assert.match(acquireFunction, /setMemberEditState\(dialog, payload\.session_id \? 'editable' : 'unavailable'\)/);
	assert.match(acquireFunction, /setMemberEditState\(dialog, 'locked'\)/);
	assert.match(page, /select\.disabled = true/);
	assert.match(submitHandler, /body: new FormData\(form\)/);
	assert.match(submitHandler, /window\.location\.reload\(\)/);
});

test('Workspace Team member session and role routes use workspace-scoped secure RPCs', async () => {
	const roleRoute = await readFile(roleRouteUrl, 'utf8');
	const sessionRoute = await readFile(sessionRouteUrl, 'utf8');

	assert.equal(buildWorkspaceTeamMemberSessionPath('alpha workspace'), '/app/workspaces/alpha%20workspace/team/members/session');
	assert.equal(buildWorkspaceTeamMemberRolePath('alpha workspace'), '/app/workspaces/alpha%20workspace/team/members/role');
	assert.equal(WORKSPACE_TEAM_MEMBER_SESSION_RPC, 'start_workspace_member_edit_session');
	assert.equal(WORKSPACE_TEAM_MEMBER_SESSION_RELEASE_RPC, 'release_workspace_member_edit_session');
	assert.equal(WORKSPACE_TEAM_MEMBER_ROLE_CHANGE_RPC, 'change_workspace_member_role');
	assert.match(sessionRoute, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(sessionRoute, /can\(workspace\.role, 'workspaceTeam\.manageRoles'\)/);
	assert.match(sessionRoute, /WORKSPACE_TEAM_MEMBER_SESSION_RPC/);
	assert.match(sessionRoute, /WORKSPACE_TEAM_MEMBER_SESSION_RELEASE_RPC/);
	assert.match(roleRoute, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(roleRoute, /can\(workspace\.role, 'workspaceTeam\.manageRoles'\)/);
	assert.match(roleRoute, /p_expected_snapshot_version/);
	assert.match(roleRoute, /p_edit_session_id/);
	assert.match(roleRoute, /WORKSPACE_TEAM_MEMBER_ROLE_CHANGE_RPC/);
	assert.doesNotMatch(roleRoute, /\.from\('organisation_members'\)\.update|\.from\("organisation_members"\)\.update/);
});

test('Workspace Team member role migration adds scoped edit sessions RLS and expiry release', async () => {
	const sql = await migrationSql();

	assert.match(sql, /create table if not exists public\.workspace_member_edit_sessions/);
	assert.match(sql, /organisation_id uuid not null references public\.organisations/);
	assert.match(sql, /organisation_membership_id uuid not null references public\.organisation_members/);
	assert.match(sql, /editing_by uuid not null references auth\.users/);
	assert.match(sql, /expires_at timestamptz not null default now\(\) \+ interval '15 minutes'/);
	assert.match(sql, /create unique index if not exists workspace_member_edit_sessions_active_membership_key/);
	assert.match(sql, /alter table public\.workspace_member_edit_sessions enable row level security/);
	assert.match(sql, /has_real_active_organisation_role\(workspace_member_edit_sessions\.organisation_id, array\['owner', 'admin'\]\)/);
	assert.match(sql, /revoke insert, update, delete on public\.workspace_member_edit_sessions from authenticated/);
	assert.match(sql, /expire_workspace_member_edit_sessions/);
	assert.match(sql, /release_source = 'expiry'/);
});

test('Workspace Team member role migration enforces server authority and optimistic concurrency', async () => {
	const sql = await migrationSql();
	const roleFunction = sql.match(/create or replace function public\.change_workspace_member_role[\s\S]*?comment on table public\.workspace_member_edit_sessions/)?.[0] ?? '';

	assert.match(roleFunction, /workspace_membership_require_admin_actor\(p_organisation_id\)/);
	assert.match(roleFunction, /p_target_role not in \('viewer', 'member', 'admin', 'owner'\)/);
	assert.match(roleFunction, /v_target\.status <> 'active'/);
	assert.match(roleFunction, /WT_MEMBER_ROLE_SELF_DENIED/);
	assert.match(roleFunction, /v_actor\.actor_role = 'admin' and v_target\.role in \('admin', 'owner'\)/);
	assert.match(roleFunction, /v_actor\.actor_role = 'admin' and p_target_role in \('admin', 'owner'\)/);
	assert.match(roleFunction, /workspace_membership_assert_not_final_owner\(v_target\)/);
	assert.match(roleFunction, /p_edit_session_id is null/);
	assert.match(roleFunction, /WT_MEMBER_ROLE_LOCKED/);
	assert.match(roleFunction, /current_workspace_membership_snapshot_version\(p_organisation_id\)::text/);
	assert.match(roleFunction, /WT_MEMBER_ROLE_STALE/);
	assert.match(roleFunction, /update public\.organisation_members om[\s\S]*set role = p_target_role,[\s\S]*updated_by = v_actor\.actor_user_id/);
});

test('Workspace Team member role migration records audit evidence without changing profile identity', async () => {
	const sql = await migrationSql();

	assert.match(sql, /'workspace_membership_role_changed'/);
	assert.match(sql, /record_workspace_membership_audit_event/);
	assert.match(sql, /'previous_role', v_target\.role/);
	assert.match(sql, /'new_role', v_updated\.role/);
	assert.match(sql, /'changed_by', v_actor\.actor_user_id/);
	assert.match(sql, /'changed_at', now\(\)/);
	assert.match(sql, /'workspace_member_modal_role_management'/);
	assert.match(sql, /create or replace view public\.workspace_member_admin_directory/);
	assert.match(sql, /p\.last_login_at/);
	assert.match(sql, /om\.updated_at/);
	const adminView = sql.match(/create or replace view public\.workspace_member_admin_directory[\s\S]*?where public\.has_real_active_organisation_role/)?.[0] ?? '';
	assert.match(adminView, /p\.display_name[\s\S]*om\.joined_at,[\s\S]*om\.auth_user_id,[\s\S]*p\.last_login_at,[\s\S]*om\.updated_at/);
	assert.doesNotMatch(adminView, /om\.auth_user_id,\s*p\.display_name/);
	assert.equal(adminView.match(/\binvitation_expires_at\b/g)?.length, 1);
	assert.doesNotMatch(sql, /update public\.profiles[\s\S]*first_name|update public\.profiles[\s\S]*last_name|update public\.profiles[\s\S]*contact_email|update public\.profiles[\s\S]*login_name/);
});

test('Workspace Team role change errors are clear and non-leaky', () => {
	assert.match(workspaceTeamRoleChangeErrorMessage({ message: 'WT_MEMBER_ROLE_STALE: changed' }), /changed while the modal was open/);
	assert.match(workspaceTeamRoleChangeErrorMessage({ message: 'WT_MEMBER_ROLE_LOCKED: locked' }), /currently being viewed/);
	assert.match(workspaceTeamRoleChangeErrorMessage({ message: 'WT_MEMBER_ROLE_SELF_DENIED: self' }), /own workspace role/);
	assert.match(workspaceTeamRoleChangeErrorMessage({ message: 'WT_MEMBER_ROLE_ADMIN_ASSIGN_DENIED: admin' }), /Admins cannot assign/);
	assert.doesNotMatch(workspaceTeamRoleChangeErrorMessage({ message: 'WT_MEMBER_ROLE_STALE: uuid abc@example.com' }), /uuid|@/i);
});
