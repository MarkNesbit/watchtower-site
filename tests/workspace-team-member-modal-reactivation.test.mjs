import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	buildWorkspaceTeamMemberReactivatePath,
} from '../src/lib/projectRoutes.ts';
import {
	WORKSPACE_TEAM_MEMBER_REACTIVATE_RPC,
	WORKSPACE_TEAM_MEMBER_REACTIVATION_REASON_MAX_LENGTH,
	workspaceTeamReactivationAuthority,
	workspaceTeamReactivationErrorMessage,
} from '../src/lib/workspaceTeam.ts';

const pageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const reactivateRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/members/reactivate.ts', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20260731000400_workspace_member_modal_reactivation.sql', import.meta.url);

async function pageSource() {
	return readFile(pageUrl, 'utf8');
}

async function reactivateRouteSource() {
	return readFile(reactivateRouteUrl, 'utf8');
}

async function migrationSql() {
	return readFile(migrationUrl, 'utf8');
}

test('Workspace Team reactivation authority follows Owner and Admin rules', () => {
	assert.deepEqual(workspaceTeamReactivationAuthority('owner', 'viewer', false), {
		canReactivate: true,
		options: ['viewer', 'member', 'admin', 'owner'],
		canRestorePreviousRole: true,
		reason: 'Owners can reactivate a deactivated member as Viewer, Member, Admin or Owner.',
		restoreReason: 'Deactivated in error can restore the previous Viewer role.',
	});
	assert.equal(workspaceTeamReactivationAuthority('owner', 'admin', false).canReactivate, true);
	assert.equal(workspaceTeamReactivationAuthority('owner', 'owner', false).canRestorePreviousRole, true);
	assert.deepEqual(workspaceTeamReactivationAuthority('admin', 'member', false), {
		canReactivate: true,
		options: ['viewer', 'member'],
		canRestorePreviousRole: true,
		reason: 'Admins can reactivate former Viewers and Members as Viewer or Member.',
		restoreReason: 'Deactivated in error can restore the previous Member role.',
	});
	assert.equal(workspaceTeamReactivationAuthority('admin', 'viewer', false).canReactivate, true);
	assert.equal(workspaceTeamReactivationAuthority('admin', 'admin', false).canReactivate, false);
	assert.match(workspaceTeamReactivationAuthority('admin', 'admin', false).reason, /Owner may reactivate a former Admin/);
	assert.equal(workspaceTeamReactivationAuthority('admin', 'owner', false).canRestorePreviousRole, false);
	assert.match(workspaceTeamReactivationAuthority('admin', 'owner', false).restoreReason, /cannot restore a previous Owner/);
	assert.equal(workspaceTeamReactivationAuthority('owner', 'member', true).canReactivate, false);
	assert.match(workspaceTeamReactivationAuthority('owner', 'unknown', false).restoreReason, /previous role is not reliable/);
});

test('Workspace Team page opens deactivated members and exposes reactivation controls', async () => {
	const page = await pageSource();
	const reactivationSection = page.match(/<section class="workspace-team-member-modal__section workspace-team-member-modal__section--reactivation"[\s\S]*?<\/section>/)?.[0] ?? '';

	assert.match(page, /member\.membership_status === 'deactivated' && canAdministerLater/);
	assert.match(page, /deactivated member\. Open member details for possible reactivation/);
	assert.match(page, /data-member-reactivate-action=\{memberReactivateAction\}/);
	assert.match(page, /data-member-can-reactivate/);
	assert.match(page, /data-member-can-restore-previous-role/);
	assert.match(page, /Previous workspace role/);
	assert.match(page, /Deactivated date/);
	assert.match(page, /Deactivated by/);
	assert.match(page, /Deactivation reason/);
	assert.match(reactivationSection, /Reactivate membership/);
	assert.match(reactivationSection, /data-member-reactivation-start>Reactivate user/);
	assert.match(reactivationSection, /data-member-reactivation-confirm/);
	assert.match(reactivationSection, /data-member-reactivation-role-select/);
	assert.match(reactivationSection, /<option value="" selected>Select role<\/option>/);
	assert.match(reactivationSection, /Deactivated in error/);
	assert.match(reactivationSection, /data-member-deactivated-in-error/);
	assert.match(reactivationSection, /data-member-reactivation-reason/);
	assert.match(reactivationSection, /Responsibilities changed while they were inactive will not automatically return/);
	assert.match(reactivationSection, /affects only this workspace/);
	assert.doesNotMatch(page, />Profile ID<|>Membership ID<|profile UUID|membership UUID/i);
});

test('Workspace Team reactivation save state requires explicit role decision session and reason', async () => {
	const page = await pageSource();
	const updateFunction = page.match(/function updateMemberSaveState\(dialog\) \{[\s\S]*?\n\t\}/)?.[0] ?? '';
	const submitHandler = page.match(/form\.addEventListener\('submit', async \(event\) => \{[\s\S]*?window\.location\.reload\(\)/)?.[0] ?? '';

	assert.match(page, /function isMemberReactivationMode\(dialog\)/);
	assert.match(page, /function memberHasReactivationDecision\(dialog\)/);
	assert.match(page, /memberDeactivatedInError\(dialog\)[\s\S]*dialog\.dataset\.memberCanRestorePreviousRole === 'true'/);
	assert.match(updateFunction, /isMemberReactivationMode\(dialog\)/);
	assert.match(updateFunction, /dialog\.dataset\.memberCanReactivate === 'true'/);
	assert.match(updateFunction, /dialog\.dataset\.memberEditState === 'editable'/);
	assert.match(updateFunction, /save\.disabled = !canReactivate \|\| !hasSession \|\| !memberHasReactivationDecision\(dialog\) \|\| reason\.length === 0 \|\| reason\.length > 500/);
	assert.match(updateFunction, /save\.textContent = 'Reactivate user'/);
	assert.match(page, /enterMemberReactivationMode/);
	assert.match(page, /exitMemberReactivationMode/);
	assert.match(page, /Discard the unsaved reactivation decision/);
	assert.match(page, /reactivationSelect\.disabled = true/);
	assert.match(page, /dialog\.addEventListener\('input', onReactivationStateChange\)/);
	assert.match(page, /dialog\.addEventListener\('change', onReactivationStateChange\)/);
	assert.match(submitHandler, /isMemberReactivationMode\(dialog\)[\s\S]*dialog\.dataset\.memberReactivateAction \|\| form\.action/);
	assert.match(submitHandler, /Reactivating\.\.\./);
	assert.match(submitHandler, /The member could not be reactivated\. No membership changes were applied/);
	assert.match(submitHandler, /window\.location\.reload\(\)/);
});

test('Workspace Team reactivation route is workspace-scoped and delegates to the secure RPC', async () => {
	const route = await reactivateRouteSource();

	assert.equal(buildWorkspaceTeamMemberReactivatePath('alpha workspace'), '/app/workspaces/alpha%20workspace/team/members/reactivate');
	assert.equal(WORKSPACE_TEAM_MEMBER_REACTIVATE_RPC, 'reactivate_workspace_member_from_modal_api');
	assert.equal(WORKSPACE_TEAM_MEMBER_REACTIVATION_REASON_MAX_LENGTH, 500);
	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(route, /can\(workspace\.role, 'workspaceTeam\.manageRoles'\)/);
	assert.match(route, /p_organisation_id: organisation\.id/);
	assert.match(route, /p_membership_id: membershipId/);
	assert.match(route, /p_expected_snapshot_version: expectedSnapshotVersion/);
	assert.match(route, /p_edit_session_id: editSessionId/);
	assert.match(route, /p_target_role: targetRole \|\| null/);
	assert.match(route, /p_deactivated_in_error: deactivatedInError/);
	assert.match(route, /p_reason: reason/);
	assert.match(route, /WORKSPACE_TEAM_MEMBER_REACTIVATE_RPC/);
	assert.doesNotMatch(route, /\.from\('organisation_members'\)\.update|\.from\("organisation_members"\)\.update/);
});

test('Workspace Team reactivation migration enforces transaction authority role decision and stale checks', async () => {
	const sql = await migrationSql();
	const functionSql = sql.match(/create or replace function public\.reactivate_workspace_member_from_modal[\s\S]*?create or replace function public\.reactivate_workspace_member_from_modal_api/)?.[0] ?? '';

	assert.match(sql, /create or replace view public\.workspace_member_admin_directory/);
	assert.match(sql, /om\.deactivated_by/);
	assert.match(sql, /workspace_member_editor_display_name\(om\.deactivated_by\) as deactivated_by_display_name/);
	assert.match(sql, /om\.deactivation_reason/);
	assert.match(sql, /create or replace function public\.workspace_member_reactivation_can_reactivate/);
	assert.match(sql, /create or replace function public\.start_workspace_member_edit_session/);
	assert.match(sql, /v_target\.status not in \('active', 'deactivated'\)/);
	assert.match(sql, /workspace_member_reactivation_can_reactivate\(v_actor\.actor_role, v_actor\.actor_user_id, v_target, null, true\)/);
	assert.match(functionSql, /workspace_membership_require_admin_actor\(p_organisation_id\)/);
	assert.match(functionSql, /v_target\.status <> 'deactivated'/);
	assert.match(functionSql, /WT_MEMBER_REACTIVATION_DEACTIVATED_ONLY/);
	assert.match(functionSql, /v_target\.accepted_at is null and v_target\.joined_at is null/);
	assert.match(functionSql, /WT_MEMBER_REACTIVATION_ACCEPTED_ONLY/);
	assert.match(functionSql, /exists \(select 1 from auth\.users/);
	assert.match(functionSql, /WT_MEMBER_REACTIVATION_AUTH_IDENTITY_MISSING/);
	assert.match(functionSql, /v_deactivated_in_error then v_target\.role/);
	assert.match(functionSql, /v_target_role not in \('viewer', 'member', 'admin', 'owner'\)/);
	assert.match(functionSql, /WT_MEMBER_REACTIVATION_INVALID_TARGET/);
	assert.match(functionSql, /v_actor\.actor_role = 'admin' and v_target\.role in \('admin', 'owner'\)/);
	assert.match(functionSql, /v_actor\.actor_role = 'admin' and v_target_role in \('admin', 'owner'\)/);
	assert.match(functionSql, /p_edit_session_id is null/);
	assert.match(functionSql, /WT_MEMBER_REACTIVATION_LOCKED/);
	assert.match(functionSql, /current_workspace_membership_snapshot_version\(p_organisation_id\)::text/);
	assert.match(functionSql, /WT_MEMBER_REACTIVATION_STALE/);
	assert.match(functionSql, /length\(v_reason\) > 500/);
});

test('Workspace Team reactivation migration mutates only membership lifecycle and records audit evidence', async () => {
	const sql = await migrationSql();

	assert.match(sql, /set status = 'active'/);
	assert.match(sql, /role = v_target_role/);
	assert.match(sql, /reactivated_at = now\(\)/);
	assert.match(sql, /reactivated_by = v_actor\.actor_user_id/);
	assert.match(sql, /reactivation_reason = v_reason/);
	assert.match(sql, /'membership_reactivated'/);
	assert.match(sql, /'previous_role', v_target\.role/);
	assert.match(sql, /'new_role', v_updated\.role/);
	assert.match(sql, /'deactivated_in_error', v_deactivated_in_error/);
	assert.match(sql, /'reactivation_reason', v_reason/);
	assert.match(sql, /'responsibilities_restored_automatically', false/);
	assert.match(sql, /'project_roles_restored_automatically', false/);
	assert.match(sql, /'workspace_member_modal_reactivation_correction'/);
	assert.match(sql, /'workspace_member_modal_reactivation'/);
	assert.match(sql, /release_source = 'save_reactivation_completed'/);
	assert.match(sql, /grant execute on function public\.reactivate_workspace_member_from_modal_api\(uuid, uuid, text, uuid, text, boolean, text\) to anon, authenticated, service_role/);
	assert.match(sql, /notify pgrst, 'reload schema'/);
	assert.doesNotMatch(sql, /insert into public\.profiles|update public\.profiles|delete from public\.profiles|insert into auth\.users|delete from auth\.users|update auth\.users/i);
	assert.doesNotMatch(sql, /insert into public\.workspace_membership_invitations|workspace_invitation_delivery_attempted|workspace_invitation_delivered/i);
	assert.doesNotMatch(sql, /update public\.project_risks|update public\.project_actions|insert into public\.project_members|update public\.project_members|delete from public\.project_members/i);
});

test('Workspace Team reactivation errors are clear and non-leaky', () => {
	assert.match(workspaceTeamReactivationErrorMessage({ message: 'WT_MEMBER_REACTIVATION_STALE: uuid@example.com' }), /changed while the modal was open/);
	assert.match(workspaceTeamReactivationErrorMessage({ message: 'WT_MEMBER_REACTIVATION_LOCKED: abc' }), /currently being viewed/);
	assert.match(workspaceTeamReactivationErrorMessage({ message: 'WT_MEMBER_REACTIVATION_SESSION: abc' }), /edit session expired/);
	assert.match(workspaceTeamReactivationErrorMessage({ message: 'WT_MEMBER_REACTIVATION_ADMIN_ASSIGN_DENIED: abc' }), /Admins cannot reactivate/);
	assert.match(workspaceTeamReactivationErrorMessage({ message: 'WT_MEMBER_REACTIVATION_AUTH_IDENTITY_MISSING: abc' }), /sign-in identity is missing/);
	assert.match(workspaceTeamReactivationErrorMessage({ message: 'WT_MEMBER_REACTIVATION_PREVIOUS_ROLE_UNAVAILABLE: abc' }), /previous role could not be confirmed/);
	assert.doesNotMatch(workspaceTeamReactivationErrorMessage({ message: 'WT_MEMBER_REACTIVATION_STALE: uuid abc@example.com' }), /uuid|@/i);
});
