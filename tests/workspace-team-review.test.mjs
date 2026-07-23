import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildWorkspaceTeamImportReviewConfirmPath, buildWorkspaceTeamImportReviewPath } from '../src/lib/projectRoutes.ts';

const migrationUrl = new URL('../supabase/migrations/20260722000500_workspace_membership_change_review_approval.sql', import.meta.url);
const bulkReviewMigrationUrl = new URL('../supabase/migrations/20260723000400_workspace_membership_bulk_review_confirmation.sql', import.meta.url);
const reviewPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/imports/[importRunId]/review.astro', import.meta.url);
const confirmRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/imports/[importRunId]/review/confirm.ts', import.meta.url);
const teamPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);
const schemaDocsUrl = new URL('../docs/architecture/database-schema-v1.md', import.meta.url);

test('Workspace Team import review route helper is workspace scoped', () => {
	assert.equal(
		buildWorkspaceTeamImportReviewPath('alpha workspace', '22222222-2222-4222-8222-222222222222'),
		'/app/workspaces/alpha%20workspace/team/imports/22222222-2222-4222-8222-222222222222/review',
	);
	assert.equal(
		buildWorkspaceTeamImportReviewConfirmPath('alpha workspace', '22222222-2222-4222-8222-222222222222'),
		'/app/workspaces/alpha%20workspace/team/imports/22222222-2222-4222-8222-222222222222/review/confirm',
	);
});

test('Workspace Team review migration extends decisions without applying membership changes', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /approved_for_application/);
	assert.match(sql, /approved_change_set_version/);
	assert.match(sql, /approved_change_set_snapshot_version/);
	assert.match(sql, /approved_change_set_summary/);
	assert.match(sql, /decision_version/);
	assert.match(sql, /decision_history/);
	assert.match(sql, /previous_decision/);
	assert.match(sql, /live_recalculation_status/);
	assert.match(sql, /workspace_membership_change_decisions_current_row_key/);
	for (const decision of ['pending', 'approved', 'excluded', 'keep_active', 'blocked', 'superseded', 'no_longer_required']) {
		assert.match(sql, new RegExp(`'${decision}'`));
	}
	assert.match(sql, /revoke insert, update on public\.workspace_membership_change_decisions from authenticated/);
	assert.match(sql, /revoke update on public\.workspace_membership_import_runs from authenticated/);
	assert.match(sql, /grant execute on function public\.record_workspace_membership_change_decision/);
	assert.match(sql, /grant execute on function public\.confirm_workspace_membership_change_set/);
	assert.doesNotMatch(sql, /insert into public\.organisation_members|update public\.organisation_members|insert into public\.profiles|update public\.profiles|auth\.admin|insert into auth\.users|delete from public\.project_people/i);
	assert.match(sql, /never mutates profiles, auth users, organisation_members, invitations or reassignment records/);
});

test('Workspace Team review migration enforces live recalculation and protected-role safeguards', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /workspace_membership_recalculate_import_row/);
	assert.match(sql, /recalculate_workspace_membership_change_proposals/);
	assert.match(sql, /current_workspace_membership_snapshot_version/);
	assert.match(sql, /Source export has been superseded/);
	assert.match(sql, /Membership and user pairing has changed since upload/);
	assert.match(sql, /CSV review can only approve Member or Viewer additions/);
	assert.match(sql, /Owner and Admin memberships are protected from CSV approval/);
	assert.match(sql, /Users cannot approve their own deactivation/);
	assert.match(sql, /final active Owner cannot be approved for deactivation/i);
	assert.match(sql, /This proposal cannot currently be approved/);
	assert.match(sql, /A reason is required for this decision/);
});

test('Workspace Team review migration stores preliminary responsibility impacts and audit evidence', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /workspace_membership_known_responsibility_counts/);
	assert.match(sql, /active_risks_owned/);
	assert.match(sql, /active_risk_actions_assigned/);
	assert.match(sql, /non_terminal_actions_assigned/);
	assert.match(sql, /non_terminal_approvals_held/);
	assert.match(sql, /submitted_actions_awaiting_approval/);
	assert.match(sql, /active_project_roles/);
	assert.match(sql, /WT-WORKSPACE-TEAM-010/);
	for (const event of [
		'membership_change_approved',
		'membership_change_excluded',
		'membership_deactivation_kept_active',
		'membership_change_decision_revised',
		'membership_change_blocked',
		'membership_change_no_longer_required',
		'membership_change_set_confirmed',
	]) {
		assert.match(sql, new RegExp(`'${event}'`));
	}
});

test('Workspace Team bulk review migration records selected and excluded decisions without applying changes', async () => {
	const sql = await readFile(bulkReviewMigrationUrl, 'utf8');

	assert.match(sql, /workspace_membership_change_selection_confirmed/);
	assert.match(sql, /create or replace function public\.confirm_workspace_membership_selected_change_set/);
	assert.match(sql, /workspace_membership_require_admin_actor\(import_run\.organisation_id\)/);
	assert.match(sql, /ensure_workspace_membership_change_decisions\(target_import_run_id\)/);
	assert.match(sql, /recalculate_workspace_membership_change_proposals\(target_import_run_id\)/);
	assert.match(sql, /record_workspace_membership_change_decision/);
	assert.match(sql, /when decision_row\.import_row_id = any\(coalesce\(selected_import_row_ids, array\[\]::uuid\[\]\)\) then 'approved'/);
	assert.match(sql, /when decision_row\.proposed_change_type = 'deactivation' then 'keep_active'/);
	assert.match(sql, /else 'excluded'/);
	assert.match(sql, /WT_MEMBERSHIP_BULK_CONFIRM_EMPTY/);
	assert.match(sql, /confirm_workspace_membership_change_set\(target_import_run_id\)/);
	assert.match(sql, /batch_correlation_id/);
	assert.match(sql, /'audit_scope', 'proposal'/);
	assert.match(sql, /'audit_scope', 'batch'/);
	assert.match(sql, /'selected', requested_decision = 'approved'/);
	assert.match(sql, /applies_changes', false/);
	assert.match(sql, /grant execute on function public\.confirm_workspace_membership_selected_change_set/);
	assert.doesNotMatch(sql, /insert into public\.organisation_members|update public\.organisation_members|insert into public\.profiles|update public\.profiles|auth\.admin|insert into auth\.users|delete from public\.project_people/i);
});

test('Workspace Team review page groups proposals and saves decisions through controlled RPCs', async () => {
	const page = await readFile(reviewPageUrl, 'utf8');

	assert.match(page, /data-workspace-team-import-review/);
	assert.match(page, /buildWorkspaceTeamImportReviewPath/);
	assert.match(page, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(page, /workspace\.role !== 'owner' && workspace\.role !== 'admin'/);
	assert.match(page, /ensure_workspace_membership_change_decisions/);
	assert.match(page, /recalculate_workspace_membership_change_proposals/);
	assert.match(page, /record_workspace_membership_change_decision/);
	assert.match(page, /confirm_workspace_membership_change_set/);
	assert.match(page, /normaliseWorkspaceTeamSnapshotVersion/);
	assert.match(page, /snapshotLabel/);
	assert.match(page, /Additions/);
	assert.match(page, /Corrections/);
	assert.match(page, /Deactivations/);
	assert.match(page, /Reactivations/);
	assert.match(page, /Invalid or protected changes/);
	assert.match(page, /Approve addition/);
	assert.match(page, /Approve correction/);
	assert.match(page, /Approve deactivation/);
	assert.match(page, /Keep active/);
	assert.match(page, /Confirm approved change set/);
	assert.match(page, /Contact email correction does not change the Supabase authentication login email/);
	assert.match(page, /Full deactivation impact assessment remains WT-WORKSPACE-TEAM-010/);
	assert.match(page, /No workspace membership changes have been made yet/);
	assert.doesNotMatch(page, /\.from\('organisation_members'\)\.update|\.from\('profiles'\)\.update|auth\.admin|Send invitation|Apply changes|\.delete\(/);
});

test('Workspace Team review page relative imports resolve from the nested route directory', async () => {
	const page = await readFile(reviewPageUrl, 'utf8');
	const importPaths = [...page.matchAll(/from ['"](\.{1,2}\/[^'"]+)['"]/g)].map((match) => match[1]);

	assert.deepEqual(importPaths, [
		'../../../../../../../layouts/AuthenticatedLayout.astro',
		'../../../../../../../components/app/EmptyState.astro',
		'../../../../../../../components/app/ProjectContentPanel.astro',
		'../../../../../../../lib/projects',
		'../../../../../../../lib/permissions',
		'../../../../../../../lib/supabaseServer',
		'../../../../../../../lib/workspaceTeamCsv',
	]);

	for (const importPath of importPaths) {
		const resolved = new URL(importPath, reviewPageUrl);
		const candidates = /\.[a-z]+$/i.test(importPath)
			? [resolved]
			: [resolved, new URL(`${importPath}.ts`, reviewPageUrl), new URL(`${importPath}.astro`, reviewPageUrl)];
		await assert.doesNotReject(
			Promise.any(candidates.map((candidate) => access(candidate))),
			`${importPath} should resolve from the review page directory`,
		);
	}
});

test('Workspace Team page links validated imports into review without apply controls', async () => {
	const page = await readFile(teamPageUrl, 'utf8');

	assert.match(page, /buildWorkspaceTeamImportReviewConfirmPath/);
	assert.match(page, /buildWorkspaceTeamImportReviewPath/);
	assert.match(page, /normaliseWorkspaceTeamSnapshotVersion/);
	assert.match(page, /data-workspace-team-import-review-link/);
	assert.match(page, /Review proposed changes/);
	assert.match(page, /data-workspace-team-review-dialog/);
	assert.match(page, /Review the proposed team changes below\. Switch off anything that should not proceed, then accept the selected changes\./);
	assert.match(page, /data-review-switch/);
	assert.match(page, /data-review-select-all/);
	assert.match(page, /data-review-clear-all/);
	assert.match(page, /Accept \{reviewModalInitialSelectedCount\} selected changes/);
	assert.match(page, /Confirm selected changes/);
	assert.match(page, /recalculate_workspace_membership_change_proposals/);
	assert.doesNotMatch(page, /Proposed additions', importGroups|Row \{row\.source_row_number\}: \{importRowIdentity\(row\)\}/);
	assert.doesNotMatch(page, /Apply changes|Send invitation|auth\.admin|\.from\('organisation_members'\)\.update|\.from\('profiles'\)\.update/);
});

test('Workspace Team bulk review confirmation route is scoped and delegates to the controlled RPC', async () => {
	const route = await readFile(confirmRouteUrl, 'utf8');

	assert.match(route, /export const POST/);
	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(route, /workspace\.role !== 'owner' && workspace\.role !== 'admin'/);
	assert.match(route, /selected_import_row_id/);
	assert.match(route, /confirm_workspace_membership_selected_change_set/);
	assert.match(route, /review_confirmation=success|review_confirmation/);
	assert.match(route, /workspace_team_bulk_review_confirmation_failed/);
	assert.doesNotMatch(route, /auth\.admin|auth\.users|\.from\('profiles'\)\.update|\.from\('organisation_members'\)\.update|\.delete\(/);
});

test('Workspace Team review documentation states the decision boundary and WT-007 handoff', async () => {
	const docs = await readFile(docsUrl, 'utf8');
	const schemaDocs = await readFile(schemaDocsUrl, 'utf8');

	assert.match(docs, /Workspace Team CSV change review and approval/);
	assert.match(docs, /\/app\/workspaces\/\{workspaceSlug\}\/team\/imports\/\{importRunId\}\/review/);
	assert.match(docs, /Every valid material proposal starts as `pending`/);
	assert.match(docs, /Live recalculation runs before rendering review cards and again before final confirmation/);
	assert.match(docs, /approved_for_application/);
	assert.match(docs, /no profile, auth, invitation, membership lifecycle, role or reassignment mutation is applied/);
	assert.match(schemaDocs, /workspace_membership_change_decisions/);
	assert.match(schemaDocs, /decision_history/);
	assert.match(schemaDocs, /WT-WORKSPACE-TEAM-007 handoff contract/);
});
