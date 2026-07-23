import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20260723000700_workspace_membership_approved_snapshot_recovery.sql', import.meta.url);
const teamPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const reviewPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/imports/[importRunId]/review.astro', import.meta.url);
const confirmRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/imports/[importRunId]/review/confirm.ts', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);
const schemaDocsUrl = new URL('../docs/architecture/database-schema-v1.md', import.meta.url);

function sqlConstraintValues(sql, constraintName) {
	const escapedName = constraintName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = sql.match(new RegExp(`${escapedName}[\\s\\S]*?check \\([\\s\\S]*?\\b(?:previous_status|new_status|event_type) in \\(([\\s\\S]*?)\\)[\\s\\S]*?\\)\\s*[,;]`));
	assert.ok(match, `${constraintName} constraint should be present`);
	return new Set([...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]));
}

function sqlFunctionBody(sql, functionName) {
	const start = sql.indexOf(`create or replace function public.${functionName}`);
	assert.notEqual(start, -1, `${functionName} should be present`);
	const end = sql.indexOf('\n$$;', start);
	assert.notEqual(end, -1, `${functionName} should terminate`);
	return sql.slice(start, end + 4);
}

test('Approved snapshot recovery migration records canonical text approval snapshot', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /20260723000700/);
	assert.match(sql, /add column if not exists approved_live_snapshot_version text/);
	assert.match(sql, /add column if not exists approved_at timestamptz/);
	assert.match(sql, /add column if not exists approved_by uuid references auth\.users/);
	assert.match(sql, /approved_live_snapshot_version ~ '\^\[1-9\]\[0-9\]\*\$'/);
	assert.match(sql, /current_workspace_membership_snapshot_version_text\(import_run\.organisation_id\)/);
	assert.match(sql, /approved_live_snapshot_version = current_snapshot_text/);
	assert.match(sql, /approved_change_set_snapshot_version = current_snapshot_text::bigint/);
	assert.match(sql, /'approved_live_snapshot_version', current_snapshot_text/);
	assert.match(sql, /894187232527701972/);
	assert.doesNotMatch(sql, /parseInt|parseFloat|Number\(|::double precision|::numeric/);
});

test('Approved snapshot recovery migration adds reconfirmation without membership mutation', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const reconfirmSql = sqlFunctionBody(sql, 'reconfirm_workspace_membership_approved_change_set');
	const eventTypes = sqlConstraintValues(sql, 'workspace_membership_audit_events_event_type_check');

	assert.ok(eventTypes.has('membership_change_set_reconfirmed'));
	assert.match(sql, /create or replace function public\.reconfirm_workspace_membership_approved_change_set/);
	assert.match(sql, /previous_approved_change_set_version/);
	assert.match(sql, /new_approved_change_set_version/);
	assert.match(sql, /previous_approved_live_snapshot_version/);
	assert.match(sql, /new_approved_live_snapshot_version/);
	assert.match(sql, /selected_import_row_ids uuid\[\] default null/);
	assert.match(sql, /decision = requested_decision/);
	assert.match(sql, /decision_history = coalesce\(wcd\.decision_history/);
	assert.match(sql, /confirm_workspace_membership_selected_change_set/);
	assert.match(sql, /reconfirm_workspace_membership_approved_change_set\(target_import_run_id, selected_import_row_ids, batch_reason\)/);
	assert.match(reconfirmSql, /No membership, profile, auth or invitation delivery changes were applied/);
	assert.doesNotMatch(reconfirmSql, /insert into public\.organisation_members|update public\.organisation_members|insert into public\.profiles|update public\.profiles|auth\.admin|insert into auth\.users|inviteUserByEmail|generateLink|delete from public\.project_people/i);
});

test('Approved snapshot recovery keeps WT-007 application on the approved live snapshot text contract', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /create or replace function public\.apply_workspace_membership_change_set/);
	assert.match(sql, /v_approved_snapshot_text text/);
	assert.match(sql, /v_current_snapshot_text text/);
	assert.match(sql, /v_approved_snapshot_text := nullif\(btrim\(v_import\.approved_live_snapshot_version\), ''\)/);
	assert.match(sql, /v_current_snapshot_text := public\.current_workspace_membership_snapshot_version_text\(p_organisation_id\)/);
	assert.match(sql, /v_current_snapshot_text is distinct from v_approved_snapshot_text/);
	assert.match(sql, /approved_live_snapshot_version', v_approved_snapshot_text/);
});

test('Team page shows re-review CTA for missing or changed approved snapshots', async () => {
	const page = await readFile(teamPageUrl, 'utf8');

	assert.match(page, /approved_live_snapshot_version/);
	assert.match(page, /applicationSnapshotMissing/);
	assert.match(page, /applicationSnapshotDiffers/);
	assert.match(page, /Workspace changed since approval/);
	assert.match(page, /Re-review approved changes/);
	assert.match(page, /data-workspace-team-application-rereview/);
	assert.match(page, /data-workspace-team-review-dialog/);
	assert.match(page, /item\.decision === 'approved'/);
	assert.match(page, /reviewModalInitialSelectedCount/);
	assert.match(page, /reviewModalInitialExcludedCount/);
	assert.doesNotMatch(page, /Number\(importRun\.approved|parseInt|parseFloat/);
});

test('Review fallback page and confirm route support deliberate approved-set reconfirmation', async () => {
	const page = await readFile(reviewPageUrl, 'utf8');
	const route = await readFile(confirmRouteUrl, 'utf8');

	assert.match(page, /approved_live_snapshot_version/);
	assert.match(page, /needsApprovedSnapshotRecovery/);
	assert.match(page, /Re-review approved changes/);
	assert.match(page, /reconfirm_workspace_membership_approved_change_set/);
	assert.match(page, /No CSV re-upload is required while the proposals remain valid/);
	assert.match(route, /confirm_workspace_membership_selected_change_set/);
	assert.doesNotMatch(route, /\.from\('organisation_members'\)\.update|\.from\('profiles'\)\.update|auth\.admin|inviteUserByEmail|\.delete\(/);
});

test('Approved snapshot recovery documentation records the production deployment boundary', async () => {
	const docs = await readFile(docsUrl, 'utf8');
	const schemaDocs = await readFile(schemaDocsUrl, 'utf8');

	assert.match(docs, /approved_live_snapshot_version/);
	assert.match(docs, /membership_change_set_reconfirmed/);
	assert.match(docs, /No CSV re-upload is required/);
	assert.match(docs, /production migration deployment is required/);
	assert.match(schemaDocs, /approved_live_snapshot_version/);
	assert.match(schemaDocs, /reconfirm_workspace_membership_approved_change_set/);
	assert.match(schemaDocs, /No membership, profile, auth or invitation delivery mutation occurs during reconfirmation/);
});
