import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	buildWorkspaceTeamMemberDeactivatePath,
	buildWorkspaceTeamMemberDeactivationImpactPath,
} from '../src/lib/projectRoutes.ts';
import {
	WORKSPACE_TEAM_MEMBER_DEACTIVATE_RPC,
	WORKSPACE_TEAM_MEMBER_DEACTIVATION_IMPACT_RPC,
	WORKSPACE_TEAM_MEMBER_DEACTIVATION_REASON_MAX_LENGTH,
	workspaceTeamDeactivationAuthority,
	workspaceTeamDeactivationErrorMessage,
} from '../src/lib/workspaceTeam.ts';

const pageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const deactivateRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/members/deactivate.ts', import.meta.url);
const impactRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/members/deactivation-impact.ts', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20260731000200_workspace_member_modal_deactivation.sql', import.meta.url);

async function pageSource() {
	return readFile(pageUrl, 'utf8');
}

async function deactivateRouteSource() {
	return readFile(deactivateRouteUrl, 'utf8');
}

async function impactRouteSource() {
	return readFile(impactRouteUrl, 'utf8');
}

async function migrationSql() {
	return readFile(migrationUrl, 'utf8');
}

test('Workspace Team deactivation authority follows Owner and Admin rules', () => {
	assert.deepEqual(workspaceTeamDeactivationAuthority('owner', 'viewer', false), {
		canDeactivate: true,
		reason: 'Owners can deactivate another active workspace member after reviewing current responsibilities.',
	});
	assert.equal(workspaceTeamDeactivationAuthority('owner', 'owner', false).canDeactivate, true);
	assert.equal(workspaceTeamDeactivationAuthority('owner', 'admin', false).canDeactivate, true);
	assert.equal(workspaceTeamDeactivationAuthority('owner', 'member', true).canDeactivate, false);
	assert.match(workspaceTeamDeactivationAuthority('owner', 'member', true).reason, /own workspace membership/);
	assert.deepEqual(workspaceTeamDeactivationAuthority('admin', 'member', false), {
		canDeactivate: true,
		reason: 'Admins can deactivate Viewers and Members after reviewing current responsibilities.',
	});
	assert.equal(workspaceTeamDeactivationAuthority('admin', 'viewer', false).canDeactivate, true);
	assert.equal(workspaceTeamDeactivationAuthority('admin', 'admin', false).canDeactivate, false);
	assert.match(workspaceTeamDeactivationAuthority('admin', 'admin', false).reason, /Owner may deactivate an Admin/);
	assert.equal(workspaceTeamDeactivationAuthority('admin', 'owner', false).canDeactivate, false);
	assert.match(workspaceTeamDeactivationAuthority('admin', 'owner', false).reason, /Admins cannot deactivate an Owner/);
	assert.equal(workspaceTeamDeactivationAuthority('admin', 'viewer', true).canDeactivate, false);
	assert.equal(workspaceTeamDeactivationAuthority('member', 'viewer', false).canDeactivate, false);
	assert.equal(workspaceTeamDeactivationAuthority('viewer', 'member', false).canDeactivate, false);
});

test('Workspace Team member modal exposes deactivation in the primary modal content', async () => {
	const page = await pageSource();
	const deactivationSection = page.match(/<section class="workspace-team-member-modal__section workspace-team-member-modal__section--deactivation"[\s\S]*?<\/section>/)?.[0] ?? '';

	assert.match(page, /data-member-deactivation-section/);
	assert.match(deactivationSection, /Deactivate membership/);
	assert.match(deactivationSection, /data-member-deactivation-start>Deactivate user/);
	assert.match(deactivationSection, /data-member-deactivation-confirm/);
	assert.match(deactivationSection, /data-member-impact-summary/);
	assert.match(deactivationSection, /data-impact-active-risks-owned/);
	assert.match(deactivationSection, /data-impact-active-risk-actions-assigned/);
	assert.match(deactivationSection, /data-impact-outstanding-actions-assigned/);
	assert.match(deactivationSection, /data-impact-actions-awaiting-approval/);
	assert.match(deactivationSection, /WT-PROJECT-TEAM-DEFECT-001/);
	assert.match(deactivationSection, /data-member-deactivation-reason/);
	assert.match(deactivationSection, /maxlength=\{WORKSPACE_TEAM_MEMBER_DEACTIVATION_REASON_MAX_LENGTH\}/);
	assert.match(page, /workspace-team-member-modal__section-heading/);
	assert.match(page, /workspace-team-member-modal__reason textarea:focus-visible/);
});

test('Workspace Team deactivation save state requires editability impact and reason', async () => {
	const page = await pageSource();
	const updateFunction = page.match(/function updateMemberSaveState\(dialog\) \{[\s\S]*?\n\t\}/)?.[0] ?? '';
	const enterFunction = page.match(/async function enterMemberDeactivationMode\(dialog\) \{[\s\S]*?\n\t\}/)?.[0] ?? '';
	const exitFunction = page.match(/function exitMemberDeactivationMode\(dialog, options = \{\}\) \{[\s\S]*?\n\t\}/)?.[0] ?? '';

	assert.match(updateFunction, /isMemberDeactivationMode\(dialog\)/);
	assert.match(updateFunction, /dialog\.dataset\.memberCanDeactivate === 'true'/);
	assert.match(updateFunction, /dialog\.dataset\.memberEditState === 'editable'/);
	assert.match(updateFunction, /!dialog\.dataset\.memberLocked/);
	assert.match(updateFunction, /dialog\.dataset\.memberImpactLoaded === 'true'/);
	assert.match(updateFunction, /save\.disabled = !canDeactivate \|\| !hasSession \|\| reason\.length === 0 \|\| reason\.length > 500/);
	assert.match(updateFunction, /save\.textContent = 'Deactivate user'/);
	assert.match(page, /const deactivateButton = dialog\.querySelector\('\[data-member-deactivation-start\]'\)/);
	assert.match(page, /deactivateButton\.disabled = state !== 'editable' \|\| dialog\.dataset\.memberCanDeactivate !== 'true'/);
	assert.match(enterFunction, /Save or discard the role change before starting deactivation/);
	assert.match(enterFunction, /await loadMemberImpactSummary\(dialog\)/);
	assert.match(exitFunction, /options\.focus !== false/);
	assert.match(page, /exitMemberDeactivationMode\(dialog, \{ focus: false \}\)/);
});

test('Workspace Team deactivation submits the correct route and refreshes after success', async () => {
	const page = await pageSource();
	const submitHandler = page.match(/form\.addEventListener\('submit', async \(event\) => \{[\s\S]*?window\.setTimeout\(\(\) => window\.location\.reload\(\), 250\)/)?.[0] ?? '';

	assert.equal(buildWorkspaceTeamMemberDeactivationImpactPath('alpha workspace'), '/app/workspaces/alpha%20workspace/team/members/deactivation-impact');
	assert.equal(buildWorkspaceTeamMemberDeactivatePath('alpha workspace'), '/app/workspaces/alpha%20workspace/team/members/deactivate');
	assert.equal(WORKSPACE_TEAM_MEMBER_DEACTIVATION_IMPACT_RPC, 'workspace_member_deactivation_impact_summary_api');
	assert.equal(WORKSPACE_TEAM_MEMBER_DEACTIVATE_RPC, 'deactivate_workspace_member_from_modal_api');
	assert.equal(WORKSPACE_TEAM_MEMBER_DEACTIVATION_REASON_MAX_LENGTH, 500);
	assert.match(page, /data-member-deactivation-impact-action=\{memberDeactivationImpactAction\}/);
	assert.match(page, /data-member-deactivate-action=\{memberDeactivateAction\}/);
	assert.match(submitHandler, /const action = isMemberDeactivationMode\(dialog\)[\s\S]*dialog\.dataset\.memberDeactivateAction \|\| form\.action[\s\S]*: form\.action/);
	assert.match(submitHandler, /await fetch\(action/);
	assert.match(submitHandler, /body: new FormData\(form\)/);
	assert.match(submitHandler, /dialog\.close\('saved'\)/);
	assert.match(submitHandler, /window\.location\.reload\(\)/);
});

test('Workspace Team deactivation routes enforce workspace access and secure RPC use', async () => {
	const deactivateRoute = await deactivateRouteSource();
	const impactRoute = await impactRouteSource();

	assert.match(deactivateRoute, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(deactivateRoute, /can\(workspace\.role, 'workspaceTeam\.manageRoles'\)/);
	assert.match(deactivateRoute, /p_organisation_id: organisation\.id/);
	assert.match(deactivateRoute, /p_membership_id: membershipId/);
	assert.match(deactivateRoute, /p_expected_snapshot_version: expectedSnapshotVersion/);
	assert.match(deactivateRoute, /p_edit_session_id: editSessionId/);
	assert.match(deactivateRoute, /p_reason: reason/);
	assert.match(deactivateRoute, /WORKSPACE_TEAM_MEMBER_DEACTIVATE_RPC/);
	assert.doesNotMatch(deactivateRoute, /\.from\('organisation_members'\)\.update|\.from\("organisation_members"\)\.update/);
	assert.match(impactRoute, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(impactRoute, /can\(workspace\.role, 'workspaceTeam\.manageRoles'\)/);
	assert.match(impactRoute, /p_organisation_id: organisation\.id/);
	assert.match(impactRoute, /p_membership_id: membershipId/);
	assert.match(impactRoute, /WORKSPACE_TEAM_MEMBER_DEACTIVATION_IMPACT_RPC/);
	assert.doesNotMatch(impactRoute, /\.from\('organisation_members'\)|\.from\("organisation_members"\)/);
});

test('Workspace Team deactivation migration enforces transaction authority session stale and active-only rules', async () => {
	const sql = await migrationSql();
	const functionSql = sql.match(/create or replace function public\.deactivate_workspace_member_from_modal_api[\s\S]*?revoke all on function public\.workspace_member_deactivation_authority_message/)?.[0] ?? '';

	assert.match(functionSql, /workspace_membership_require_admin_actor\(p_organisation_id\)/);
	assert.match(functionSql, /perform pg_advisory_xact_lock\(hashtextextended\(p_membership_id::text, 9009\)\)/);
	assert.match(functionSql, /v_target\.status <> 'active'/);
	assert.match(functionSql, /WT_MEMBER_DEACTIVATION_ACTIVE_ONLY/);
	assert.match(functionSql, /WT_MEMBER_DEACTIVATION_SELF_DENIED/);
	assert.match(functionSql, /v_actor\.actor_role = 'admin' and v_target\.role in \('admin', 'owner'\)/);
	assert.match(functionSql, /workspace_member_deactivation_can_deactivate/);
	assert.match(functionSql, /workspace_membership_assert_not_final_owner\(v_target\)/);
	assert.match(functionSql, /expire_workspace_member_edit_sessions\(p_organisation_id, p_membership_id\)/);
	assert.match(functionSql, /p_edit_session_id is null/);
	assert.match(functionSql, /WT_MEMBER_DEACTIVATION_LOCKED/);
	assert.match(functionSql, /WT_MEMBER_DEACTIVATION_SESSION/);
	assert.match(functionSql, /current_workspace_membership_snapshot_version\(p_organisation_id\)::text/);
	assert.match(functionSql, /WT_MEMBER_DEACTIVATION_STALE/);
	assert.match(functionSql, /length\(v_reason\) > 500/);
});

test('Workspace Team deactivation migration mutates only membership lifecycle and records audit evidence', async () => {
	const sql = await migrationSql();

	assert.match(sql, /create or replace function public\.workspace_member_deactivation_impact_counts/);
	assert.match(sql, /risk\.owner_id = p_profile_id/);
	assert.match(sql, /risk\.actioner_id = p_profile_id/);
	assert.match(sql, /risk\.status in \('open', 'monitoring', 'mitigating'\)/);
	assert.doesNotMatch(sql, /'escalated', 'materialised'/);
	assert.match(sql, /action\.actioner_id = p_profile_id/);
	assert.match(sql, /action\.acceptance_owner_id = p_profile_id/);
	assert.match(sql, /'project_roles_available', false/);
	assert.match(sql, /WT-PROJECT-TEAM-DEFECT-001/);
	assert.match(sql, /'responsibilities_are_informational', true/);
	assert.match(sql, /'reassignment_is_automatic', false/);
	assert.match(sql, /set status = 'deactivated'/);
	assert.match(sql, /deactivated_by = v_actor\.actor_user_id/);
	assert.match(sql, /deactivation_reason = v_reason/);
	assert.match(sql, /'membership_deactivated'/);
	assert.match(sql, /coalesce\(v_updated\.auth_user_id, v_updated\.user_id\)/);
	assert.match(sql, /'previous_role', v_target\.role/);
	assert.match(sql, /'responsibility_counts', v_impact_counts/);
	assert.match(sql, /'workspace_member_modal_deactivation'/);
	assert.match(sql, /release_source = 'save_deactivation_completed'/);
	assert.match(sql, /grant execute on function public\.deactivate_workspace_member_from_modal_api\(uuid, uuid, text, uuid, text\) to anon, authenticated, service_role/);
	assert.match(sql, /notify pgrst, 'reload schema'/);
	assert.doesNotMatch(sql, /update public\.profiles|delete from public\.profiles|delete from auth\.users|update auth\.users/i);
	assert.doesNotMatch(sql, /insert into public\.project_members|update public\.project_members|delete from public\.project_members/i);
});

test('Workspace Team deactivation errors are clear and non-leaky', () => {
	assert.match(workspaceTeamDeactivationErrorMessage({ message: 'WT_MEMBER_DEACTIVATION_STALE: uuid@example.com' }), /changed while the modal was open/);
	assert.match(workspaceTeamDeactivationErrorMessage({ message: 'WT_MEMBER_DEACTIVATION_LOCKED: abc' }), /currently being viewed/);
	assert.match(workspaceTeamDeactivationErrorMessage({ message: 'WT_MEMBER_DEACTIVATION_SESSION: abc' }), /edit session expired/);
	assert.match(workspaceTeamDeactivationErrorMessage({ message: 'WT_MEMBER_DEACTIVATION_SELF_DENIED: abc' }), /own workspace membership/);
	assert.match(workspaceTeamDeactivationErrorMessage({ message: 'WT_MEMBER_DEACTIVATION_ADMIN_TARGET_DENIED: abc' }), /Viewer and Member/);
	assert.match(workspaceTeamDeactivationErrorMessage({ message: 'WT_MEMBER_DEACTIVATION_REASON_REQUIRED: abc' }), /Enter a deactivation reason/);
	assert.match(workspaceTeamDeactivationErrorMessage({ message: 'WT_MEMBER_DEACTIVATION_REASON_TOO_LONG: abc' }), /500 characters/);
	assert.match(workspaceTeamDeactivationErrorMessage({ message: 'WT_MEMBER_DEACTIVATION_ACTIVE_ONLY: abc' }), /Only active workspace members/);
	assert.match(workspaceTeamDeactivationErrorMessage({ message: 'WT_MEMBERSHIP_FINAL_OWNER: abc' }), /final active Workspace Owner/);
	assert.doesNotMatch(workspaceTeamDeactivationErrorMessage({ message: 'WT_MEMBER_DEACTIVATION_STALE: uuid abc@example.com' }), /uuid|@/i);
});
