import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	buildWorkspaceTeamImportReviewDraftPath,
} from '../src/lib/projectRoutes.ts';

const migrationUrl = new URL('../supabase/migrations/20260723000800_workspace_membership_review_draft_state.sql', import.meta.url);
const teamPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const draftRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/imports/[importRunId]/review/draft.ts', import.meta.url);
const confirmRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/imports/[importRunId]/review/confirm.ts', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);
const schemaDocsUrl = new URL('../docs/architecture/database-schema-v1.md', import.meta.url);

function sqlFunctionBody(sql, functionName) {
	const start = sql.indexOf(`create or replace function public.${functionName}`);
	assert.notEqual(start, -1, `${functionName} should be present`);
	const end = sql.indexOf('\n$$;', start);
	assert.notEqual(end, -1, `${functionName} should terminate`);
	return sql.slice(start, end + 4);
}

test('Workspace Team review draft route helper is workspace scoped', () => {
	assert.equal(
		buildWorkspaceTeamImportReviewDraftPath('alpha workspace', '22222222-2222-4222-8222-222222222222'),
		'/app/workspaces/alpha%20workspace/team/imports/22222222-2222-4222-8222-222222222222/review/draft',
	);
});

test('Workspace Team draft migration persists draft selections on decision rows only', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const saveDraftSql = sqlFunctionBody(sql, 'save_workspace_membership_review_draft_selection');

	assert.match(sql, /20260723000800/);
	assert.match(sql, /add column if not exists review_selected boolean not null default true/);
	assert.match(sql, /add column if not exists review_draft_reason text/);
	assert.match(sql, /add column if not exists review_draft_updated_by uuid references auth\.users/);
	assert.match(sql, /add column if not exists review_draft_updated_at timestamptz/);
	assert.match(sql, /workspace_membership_change_decisions_draft_idx/);
	assert.match(saveDraftSql, /workspace_membership_require_admin_actor\(import_run\.organisation_id\)/);
	assert.match(saveDraftSql, /import_run\.status not in \('validated', 'stale_review_required', 'approval_pending'\)/);
	assert.match(saveDraftSql, /requested_review_selected boolean/);
	assert.match(saveDraftSql, /review_selected = requested_review_selected/);
	assert.match(saveDraftSql, /review_draft_reason = reason_clean/);
	assert.match(saveDraftSql, /review_draft_updated_by = actor\.actor_user_id/);
	assert.match(saveDraftSql, /review_draft_updated_at = now\(\)/);
	assert.match(sql, /grant execute on function public\.save_workspace_membership_review_draft_selection/);
	assert.doesNotMatch(saveDraftSql, /insert into public\.organisation_members|update public\.organisation_members|insert into public\.profiles|update public\.profiles|auth\.admin|insert into auth\.users|inviteUserByEmail|delete from public\.project_people/i);
});

test('Workspace Team proposal recalculation restores persisted draft state and approved re-review eligibility', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const ensureSql = sqlFunctionBody(sql, 'ensure_workspace_membership_change_decisions');
	const recalculateSql = sqlFunctionBody(sql, 'recalculate_workspace_membership_change_proposals');

	assert.match(ensureSql, /'approved_for_application', 'application_failed_pending_review'/);
	assert.match(ensureSql, /review_selected/);
	assert.match(ensureSql, /true/);
	assert.match(recalculateSql, /'review_selected', coalesce\(decision_record\.review_selected, true\)/);
	assert.match(recalculateSql, /'review_draft_reason', decision_record\.review_draft_reason/);
	assert.match(recalculateSql, /'review_draft_updated_by', decision_record\.review_draft_updated_by/);
	assert.match(recalculateSql, /'review_draft_updated_at', decision_record\.review_draft_updated_at/);
	assert.match(recalculateSql, /review_selected = false/);
});

test('Workspace Team final bulk confirmation can consume persisted draft choices atomically', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const confirmSql = sqlFunctionBody(sql, 'confirm_workspace_membership_selected_change_set');

	assert.match(confirmSql, /selected_import_row_ids uuid\[\] default null/);
	assert.match(confirmSql, /coalesce\(wcd\.review_selected, true\) as review_selected/);
	assert.match(confirmSql, /when selected_import_row_ids is null and decision_row\.review_selected then 'approved'/);
	assert.match(confirmSql, /when selected_import_row_ids is null and decision_row\.proposed_change_type = 'deactivation' then 'keep_active'/);
	assert.match(confirmSql, /when selected_import_row_ids is null then 'excluded'/);
	assert.match(confirmSql, /coalesce\(decision_row\.review_draft_reason, reason_clean\)/);
	assert.match(confirmSql, /used_persisted_draft_selection', selected_import_row_ids is null/);
	assert.match(confirmSql, /confirm_workspace_membership_change_set\(target_import_run_id\)/);
	assert.match(confirmSql, /reconfirm_workspace_membership_approved_change_set\(target_import_run_id, selected_import_row_ids, batch_reason\)/);
	assert.doesNotMatch(confirmSql, /insert into public\.organisation_members|update public\.organisation_members|insert into public\.profiles|update public\.profiles|auth\.admin|insert into auth\.users|inviteUserByEmail|delete from public\.project_people/i);
});

test('Workspace Team page isolates secondary load failures and logs safe diagnostics', async () => {
	const page = await readFile(teamPageUrl, 'utf8');
	const loggerStart = page.indexOf('const logWorkspaceTeamLoadFailure');
	const loggerEnd = page.indexOf('\n};', loggerStart);
	const logger = page.slice(loggerStart, loggerEnd);

	assert.match(page, /logWorkspaceTeamLoadFailure/);
	assert.match(page, /workspace_team_page_section_load_failed/);
	assert.match(page, /routeName: 'workspace_team_page'/);
	assert.match(page, /queryName/);
	for (const queryName of [
		'active_editable_checkout',
		'workspace_membership_import_runs_latest',
		'workspace_membership_import_rows_summary',
		'recalculate_workspace_membership_change_proposals',
		'current_workspace_membership_snapshot_version_text',
		'workspace_membership_change_application_runs_latest',
		'workspace_membership_directory_critical',
	]) {
		assert.match(page, new RegExp(queryName));
	}
	assert.match(page, /The team directory loaded, but the latest import status could not be retrieved/);
	assert.match(page, /data-workspace-team-import-load-error/);
	assert.match(page, /data-workspace-team-review-load-error/);
	assert.match(page, /data-workspace-team-application-load-error/);
	assert.match(page, /Workspace Team could not be loaded/);
	assert.doesNotMatch(logger, /tokens|cookies|team_csv|raw_values|normalised_values/i);
});

test('Workspace Team review modal persists draft switches and comments before confirmation', async () => {
	const page = await readFile(teamPageUrl, 'utf8');

	assert.match(page, /buildWorkspaceTeamImportReviewDraftPath/);
	assert.match(page, /data-workspace-team-review-draft-action/);
	assert.match(page, /selection_source" value=\{reviewModalIsReconfirmation \? 'form_selection' : 'persisted_draft'\}/);
	assert.match(page, /item\.review_selected !== false/);
	assert.match(page, /data-review-draft-reason/);
	assert.match(page, /data-review-save-state/);
	assert.match(page, /fetch\(draftAction/);
	assert.match(page, /save_workspace_membership_review_draft_selection|workspaceTeamReviewDraftAction/);
	assert.match(page, /pendingSaves/);
	assert.match(page, /failedSaves/);
	assert.match(page, /Save failed\. Try again before confirming\./);
	assert.match(page, /event\.preventDefault\(\)/);
	assert.match(page, /reviewModalInitialExcludedCount/);
});

test('Workspace Team draft save route is scoped and delegates to the controlled RPC', async () => {
	const route = await readFile(draftRouteUrl, 'utf8');
	const confirmRoute = await readFile(confirmRouteUrl, 'utf8');

	assert.match(route, /export const POST/);
	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(route, /workspace\.role !== 'owner' && workspace\.role !== 'admin'/);
	assert.match(route, /save_workspace_membership_review_draft_selection/);
	assert.match(route, /target_import_row_id: importRowId/);
	assert.match(route, /requested_review_selected: selected/);
	assert.match(route, /review_draft_reason: draftReason/);
	assert.match(route, /workspace_team_review_draft_save_failed/);
	assert.match(route, /code: error\.code/);
	assert.match(route, /message: error\.message/);
	assert.match(route, /details: error\.details/);
	assert.match(route, /hint: error\.hint/);
	assert.match(confirmRoute, /selectionSource === 'persisted_draft'/);
	assert.match(confirmRoute, /selected_import_row_ids: selectedImportRowIds/);
	assert.doesNotMatch(route, /\.from\('organisation_members'\)\.update|\.from\('profiles'\)\.update|auth\.admin|inviteUserByEmail|\.delete\(/);
});

test('Workspace Team draft review documentation records refresh-safe review state', async () => {
	const docs = await readFile(docsUrl, 'utf8');
	const schemaDocs = await readFile(schemaDocsUrl, 'utf8');

	assert.match(docs, /review_selected/);
	assert.match(docs, /review_draft_reason/);
	assert.match(docs, /Browser refresh, deployment refresh or accidental navigation/i);
	assert.match(docs, /No CSV re-upload is required/);
	assert.match(schemaDocs, /save_workspace_membership_review_draft_selection/);
	assert.match(schemaDocs, /Final confirmation converts persisted draft selection/);
	assert.match(schemaDocs, /does not mutate membership, profile, auth or invitation delivery data/);
});
