import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildWorkspaceTeamImportApplyPath } from '../src/lib/projectRoutes.ts';

const migrationUrl = new URL('../supabase/migrations/20260723000600_workspace_membership_transactional_application.sql', import.meta.url);
const teamPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const applyRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/imports/[importRunId]/apply.ts', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);
const schemaDocsUrl = new URL('../docs/architecture/database-schema-v1.md', import.meta.url);

function sqlConstraintValues(sql, constraintName) {
	const escapedName = constraintName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = sql.match(new RegExp(`${escapedName}[\\s\\S]*?check \\([\\s\\S]*?\\b(?:status|previous_status|new_status|event_type) in \\(([\\s\\S]*?)\\)[\\s\\S]*?\\)\\s*[,;]`));
	assert.ok(match, `${constraintName} constraint should be present`);
	return new Set([...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]));
}

test('Workspace Team import application route helper is workspace scoped', () => {
	assert.equal(
		buildWorkspaceTeamImportApplyPath('alpha workspace', '22222222-2222-4222-8222-222222222222'),
		'/app/workspaces/alpha%20workspace/team/imports/22222222-2222-4222-8222-222222222222/apply',
	);
});

test('Workspace Team application migration adds constrained run and invitation handoff evidence', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /create table if not exists public\.workspace_membership_change_application_runs/);
	assert.match(sql, /create table if not exists public\.workspace_membership_invitation_handoffs/);
	for (const status of ['requested', 'applying', 'applied', 'failed', 'drift_detected', 'rolled_back', 'already_applied']) {
		assert.ok(sqlConstraintValues(sql, 'workspace_membership_change_application_runs_status_check').has(status), `${status} should be an application run status`);
	}
	assert.match(sql, /unique \(organisation_id, import_run_id, operation_key\)/);
	assert.match(sql, /application_run_id uuid/);
	assert.match(sql, /applied_at timestamptz/);
	assert.match(sql, /enable row level security/);
	assert.match(sql, /has_real_active_organisation_role\(workspace_membership_change_application_runs\.organisation_id, array\['owner', 'admin'\]\)/);
	assert.match(sql, /has_real_active_organisation_role\(workspace_membership_invitation_handoffs\.organisation_id, array\['owner', 'admin'\]\)/);
});

test('Workspace Team application migration preserves audit constraints and adds WT-007 events', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const eventTypes = sqlConstraintValues(sql, 'workspace_membership_audit_events_event_type_check');
	const previousStatuses = sqlConstraintValues(sql, 'workspace_membership_audit_events_previous_status_check');
	const newStatuses = sqlConstraintValues(sql, 'workspace_membership_audit_events_new_status_check');

	for (const eventType of [
		'workspace_membership_csv_checkout_released',
		'workspace_membership_change_selection_confirmed',
		'membership_addition_applied',
		'profile_identity_correction_applied',
		'membership_deactivation_applied',
		'membership_reactivation_applied',
		'membership_change_application_failed',
		'membership_change_set_applied',
		'membership_change_set_drift_detected',
	]) {
		assert.ok(eventTypes.has(eventType), `${eventType} should be allowed`);
	}
	for (const status of ['requested', 'applying', 'applied', 'failed', 'drift_detected', 'rolled_back', 'already_applied', 'approved_for_application', 'application_failed_pending_review']) {
		assert.ok(previousStatuses.has(status), `${status} should be accepted as previous_status`);
		assert.ok(newStatuses.has(status), `${status} should be accepted as new_status`);
	}
	assert.doesNotMatch(sql, /delete from public\.workspace_membership_audit_events|update public\.workspace_membership_audit_events/i);
});

test('Workspace Team application RPC applies only a frozen approved change set after live revalidation', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /create or replace function public\.apply_workspace_membership_change_set/);
	assert.match(sql, /p_organisation_id uuid/);
	assert.match(sql, /p_import_run_id uuid/);
	assert.match(sql, /p_operation_key uuid/);
	assert.match(sql, /workspace_membership_require_admin_actor\(p_organisation_id\)/);
	assert.match(sql, /set_config\('watchtower\.membership_lifecycle_rpc', 'true', true\)/);
	assert.match(sql, /approved_for_application/);
	assert.match(sql, /approved_change_set_version <= 0/);
	assert.match(sql, /jsonb_array_length\(coalesce\(v_import\.approved_change_set/);
	assert.match(sql, /approved_change_set_snapshot_version is null/);
	assert.match(sql, /current_workspace_membership_snapshot_version\(p_organisation_id\)/);
	assert.match(sql, /v_current_snapshot is distinct from v_import\.approved_change_set_snapshot_version/);
	assert.match(sql, /source export has been superseded since approval/i);
	assert.match(sql, /application_failed_pending_review/);
	assert.match(sql, /decision_version is distinct from \(v_item->>'decision_version'\)::integer/);
	assert.match(sql, /v_decision\.finalised_at is null/);
	assert.match(sql, /value->>'decision' = 'approved'/);
	assert.match(sql, /exception\s+when others then/);
	assert.match(sql, /transaction_rolled_back/);
	assert.doesNotMatch(sql, /selected_import_row_ids|client_supplied|request\.formData/);
});

test('Workspace Team application RPC performs safe addition handoff without invitation delivery', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /insert into auth\.users/);
	assert.match(sql, /workspace_membership_pending_auth_email/);
	assert.match(sql, /@pending\.watchtower\.invalid/);
	assert.match(sql, /insert into public\.profiles/);
	assert.match(sql, /contact_email/);
	assert.match(sql, /workspace_profile_next_login_name/);
	assert.match(sql, /insert into public\.organisation_members/);
	assert.match(sql, /'invited'/);
	assert.match(sql, /insert into public\.workspace_membership_invitation_handoffs/);
	assert.match(sql, /'pending'/);
	assert.match(sql, /membership_addition_applied/);
	assert.match(sql, /auth_email_is_placeholder/);
	assert.match(sql, /invitation_delivery_pending/);
	assert.doesNotMatch(sql, /inviteUserByEmail|generateLink|auth\.admin|confirmation_token|recovery_token/i);
});

test('Workspace Team application RPC limits profile corrections and lifecycle mutations', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /Profile corrections may only change first name, last name and contact email/);
	assert.match(sql, /first_name = case when v_proposed_values \? 'first_name'/);
	assert.match(sql, /last_name = case when v_proposed_values \? 'last_name'/);
	assert.match(sql, /contact_email = case when v_proposed_values \? 'email'/);
	assert.match(sql, /auth_email_unchanged/);
	assert.match(sql, /login_name_unchanged/);
	assert.match(sql, /membership_deactivation_applied/);
	assert.match(sql, /status = 'deactivated'/);
	assert.match(sql, /Users cannot apply their own deactivation/);
	assert.match(sql, /Approved deactivation still has known responsibility impact/);
	assert.match(sql, /membership_reactivation_applied/);
	assert.match(sql, /status = 'active'/);
	assert.doesNotMatch(sql, /update public\.organisation_members[\s\S]*set[\s\S]*role =|update public\.profiles[\s\S]*set[\s\S]*\bemail =|login_name = case/i);
});

test('Workspace Team application route is scoped and delegates to the controlled RPC', async () => {
	const route = await readFile(applyRouteUrl, 'utf8');

	assert.match(route, /export const POST/);
	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(route, /workspace\.role !== 'owner' && workspace\.role !== 'admin'/);
	assert.match(route, /operation_key/);
	assert.match(route, /apply_workspace_membership_change_set/);
	assert.match(route, /p_organisation_id: organisation\.id/);
	assert.match(route, /p_import_run_id: importRunId/);
	assert.match(route, /p_operation_key: operationKey/);
	assert.match(route, /workspace_team_membership_application_failed/);
	assert.match(route, /status: 303/);
	assert.doesNotMatch(route, /selected_import_row_id|\.from\('organisation_members'\)\.update|\.from\('profiles'\)\.update|auth\.admin|inviteUserByEmail|\.delete\(/);
});

test('Workspace Team page exposes application summary and confirmation modal only after approval', async () => {
	const page = await readFile(teamPageUrl, 'utf8');

	assert.match(page, /approved_change_set_summary/);
	assert.match(page, /approved_change_set_snapshot_version/);
	assert.match(page, /workspace_membership_change_application_runs/);
	assert.match(page, /current_workspace_membership_snapshot_version_text/);
	assert.match(page, /applicationSnapshotMatches/);
	assert.match(page, /data-workspace-team-application-summary/);
	assert.match(page, /data-workspace-team-application-cta/);
	assert.match(page, /data-workspace-team-application-dialog/);
	assert.match(page, /Apply approved team changes\?/);
	assert.match(page, /This will update workspace membership and profile data for the approved changes\. The operation will either complete in full or make no changes\./);
	assert.match(page, /New members will be created in an invited state\. Invitation delivery will follow separately\./);
	assert.match(page, /Approved Workspace Team changes applied\./);
	assert.match(page, /No partial membership changes were committed/);
	assert.doesNotMatch(page, /\.from\('organisation_members'\)\.update|\.from\('profiles'\)\.update|auth\.admin|inviteUserByEmail|\.delete\(/);
});

test('Workspace Team application documentation records the transaction boundary', async () => {
	const docs = await readFile(docsUrl, 'utf8');
	const schemaDocs = await readFile(schemaDocsUrl, 'utf8');

	assert.match(docs, /Workspace Team CSV transactional application/);
	assert.match(docs, /apply_workspace_membership_change_set/);
	assert.match(docs, /frozen `approved_change_set`/);
	assert.match(docs, /pending Supabase Auth identity/);
	assert.match(docs, /Invitation delivery remains separate/);
	assert.match(docs, /Excluded proposals remain untouched/);
	assert.match(schemaDocs, /workspace_membership_change_application_runs/);
	assert.match(schemaDocs, /workspace_membership_invitation_handoffs/);
	assert.match(schemaDocs, /transactionally applies only the frozen approved set/);
});
