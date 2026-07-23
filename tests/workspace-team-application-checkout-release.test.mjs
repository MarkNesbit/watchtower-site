import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyWorkspaceTeamActiveEditableCheckoutFilters, isWorkspaceTeamActiveEditableCheckout } from '../src/lib/workspaceTeam.ts';

const migrationUrl = new URL('../supabase/migrations/20260723001000_workspace_membership_application_release_source_checkout.sql', import.meta.url);
const applicationMigrationUrl = new URL('../supabase/migrations/20260723000900_workspace_membership_application_shared_contact_policy.sql', import.meta.url);
const reviewMigrationUrl = new URL('../supabase/migrations/20260723000800_workspace_membership_review_draft_state.sql', import.meta.url);
const exportMigrationUrl = new URL('../supabase/migrations/20260723000100_workspace_membership_csv_checkout_release_ambiguity_fix.sql', import.meta.url);
const pageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);
const schemaDocsUrl = new URL('../docs/architecture/database-schema-v1.md', import.meta.url);

function sqlFunctionBody(sql, functionName) {
	const start = sql.indexOf(`create or replace function public.${functionName}`);
	assert.notEqual(start, -1, `${functionName} should be present`);
	const end = sql.indexOf('\n$$;', start);
	assert.notEqual(end, -1, `${functionName} should terminate`);
	return sql.slice(start, end + 4);
}

function checkoutRecord(overrides = {}) {
	return {
		id: 'export-1',
		organisation_id: 'workspace-1',
		requested_by: 'user-1',
		exported_at: '2026-07-23T10:00:00.000Z',
		export_mode: 'editable',
		editing_mode: 'checked_out',
		status: 'checked_out',
		checkout_expires_at: '2026-07-24T10:00:00.000Z',
		membership_snapshot_version: '123',
		superseded_at: null,
		released_at: null,
		...overrides,
	};
}

test('WT-007 application release migration extends the existing checkout release source model', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /workspace_membership_export_runs_release_source_check/);
	assert.match(sql, /release_source is null or release_source in \('holder_undo', 'application_completed'\)/);
	assert.match(sql, /set status = 'released'/);
	assert.match(sql, /editing_mode = 'none'/);
	assert.match(sql, /released_at = v_released_at/);
	assert.match(sql, /released_by = p_actor_id/);
	assert.match(sql, /release_source = 'application_completed'/);
	assert.match(sql, /release_reason = v_release_reason/);
	assert.match(sql, /Approved Workspace Team changes applied successfully\./);
});

test('WT-007 application release derives the source checkout from import evidence only', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const helper = sqlFunctionBody(sql, 'release_workspace_membership_csv_checkout_after_application');
	const apply = sqlFunctionBody(sql, 'apply_workspace_membership_change_set');

	assert.match(helper, /p_import_run_id uuid/);
	assert.match(helper, /p_application_run_id uuid/);
	assert.doesNotMatch(helper, /p_export_id|target_export_id|browser|formData/i);
	assert.match(helper, /from public\.workspace_membership_import_runs as ir[\s\S]*where ir\.id = p_import_run_id/);
	assert.match(helper, /where e\.id = v_import\.source_export_id/);
	assert.match(apply, /public\.release_workspace_membership_csv_checkout_after_application\(\s*p_organisation_id,\s*v_import\.id,\s*v_application\.id,\s*v_actor\.actor_user_id,\s*v_correlation_id\s*\)/);
	assert.doesNotMatch(apply, /p_export_id|target_export_id|client_supplied|request\.formData/i);
});

test('WT-007 releases checkout only after successful application evidence is complete', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const apply = sqlFunctionBody(sql, 'apply_workspace_membership_change_set');
	const appliedRunIndex = apply.indexOf("set status = 'applied'");
	const importAppliedIndex = apply.indexOf("set status = 'applied',\n        applied_at = now()");
	const applicationAuditIndex = apply.indexOf("'membership_change_set_applied'");
	const releaseIndex = apply.lastIndexOf('release_workspace_membership_csv_checkout_after_application');

	assert.ok(appliedRunIndex > -1, 'application run should be marked applied');
	assert.ok(importAppliedIndex > appliedRunIndex, 'import should be marked applied after application run');
	assert.ok(applicationAuditIndex > importAppliedIndex, 'application audit should be written after import applied');
	assert.ok(releaseIndex > applicationAuditIndex, 'checkout release should happen after application audit evidence');
	assert.match(apply, /exception\s+when others then/);
	assert.match(apply, /transaction_rolled_back/);
	assert.match(apply, /application_failed_pending_review/);
});

test('WT-007 release helper no-ops safely for non-active source checkout states', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const helper = sqlFunctionBody(sql, 'release_workspace_membership_csv_checkout_after_application');

	assert.match(helper, /if v_import\.source_export_id is null then\s+return null/);
	assert.match(helper, /if not found then\s+return null/);
	assert.match(helper, /v_source_export\.export_mode <> 'editable'/);
	assert.match(helper, /v_source_export\.status <> 'checked_out'/);
	assert.match(helper, /v_source_export\.editing_mode <> 'checked_out'/);
	assert.match(helper, /v_source_export\.released_at is not null/);
	assert.match(helper, /v_source_export\.superseded_at is not null/);
	assert.match(helper, /v_source_export\.checkout_expires_at is null/);
	assert.match(helper, /v_source_export\.checkout_expires_at <= v_released_at/);
	assert.match(helper, /then\s+return null/);
	assert.match(helper, /WT_MEMBERSHIP_APPLICATION_CHECKOUT_RELEASE_RACE/);
});

test('WT-007 release audit uses existing checkout release event without deleting evidence or sending invitations', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const helper = sqlFunctionBody(sql, 'release_workspace_membership_csv_checkout_after_application');

	assert.match(helper, /workspace_membership_csv_checkout_released/);
	assert.match(helper, /'previous_holder', v_source_export\.requested_by/);
	assert.match(helper, /'previous_expiry', v_source_export\.checkout_expires_at/);
	assert.match(helper, /'membership_snapshot_version', v_source_export\.membership_snapshot_version/);
	assert.match(helper, /'import_run_id', v_import\.id/);
	assert.match(helper, /'application_run_id', v_application\.id/);
	assert.match(helper, /'release_source', v_released_export\.release_source/);
	assert.match(helper, /'workspace_team_csv_checkout_release'/);
	assert.doesNotMatch(sql, /delete from public\.workspace_membership_export_runs|delete from public\.workspace_membership_export_rows|delete from public\.workspace_membership_import_runs|delete from public\.workspace_membership_import_rows|delete from public\.workspace_membership_change_decisions|delete from public\.workspace_membership_change_application_runs/i);
	assert.doesNotMatch(sql, /inviteUserByEmail|generateLink|auth\.admin|confirmation_token|recovery_token/i);
});

test('WT-007 production recovery releases active source checkout for already-applied imports idempotently', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const apply = sqlFunctionBody(sql, 'apply_workspace_membership_change_set');

	assert.match(apply, /if v_import\.status = 'applied' then/);
	assert.match(apply, /where ar\.organisation_id = p_organisation_id[\s\S]*and ar\.import_run_id = p_import_run_id[\s\S]*and ar\.status = 'applied'/);
	assert.match(apply, /v_existing_application\.id[\s\S]*v_actor\.actor_user_id[\s\S]*v_correlation_id/);
	assert.match(sql, /do \$\$/);
	assert.match(sql, /select distinct on \(ir\.source_export_id\)/);
	assert.match(sql, /ir\.status = 'applied'/);
	assert.match(sql, /ar\.status = 'applied'/);
	assert.match(sql, /er\.status = 'checked_out'/);
	assert.match(sql, /er\.released_at is null/);
	assert.match(sql, /er\.checkout_expires_at > now\(\)/);
});

test('WT-007 non-success paths retain checkout and review-only stages do not release it', async () => {
	const releaseSql = await readFile(migrationUrl, 'utf8');
	const priorApplicationSql = await readFile(applicationMigrationUrl, 'utf8');
	const reviewSql = await readFile(reviewMigrationUrl, 'utf8');

	assert.doesNotMatch(priorApplicationSql, /release_workspace_membership_csv_checkout_after_application|application_completed/);
	assert.doesNotMatch(reviewSql, /release_workspace_membership_csv_checkout_after_application|application_completed/);
	assert.match(releaseSql, /if v_import\.status <> 'approved_for_application' then/);
	assert.match(releaseSql, /if v_failure_code is not null then[\s\S]*membership_change_application_failed[\s\S]*return v_application\.id/);
	assert.doesNotMatch(sqlFunctionBody(releaseSql, 'release_workspace_membership_csv_checkout_after_application'), /v_import\.status = 'approved_for_application'|approval_pending|validated/);
});

test('Team page active checkout lookup drops released checkouts so banner stays gone and export is available', async () => {
	const now = new Date('2026-07-23T12:00:00.000Z');
	const query = {
		calls: [],
		select(value) { this.calls.push(['select', value]); return this; },
		eq(field, value) { this.calls.push(['eq', field, value]); return this; },
		is(field, value) { this.calls.push(['is', field, value]); return this; },
		gt(field, value) { this.calls.push(['gt', field, value]); return this; },
		order(field, options) { this.calls.push(['order', field, options]); return this; },
		limit(value) { this.calls.push(['limit', value]); return this; },
	};

	assert.equal(applyWorkspaceTeamActiveEditableCheckoutFilters(query, 'workspace-1', now.toISOString()), query);
	assert.deepEqual(query.calls.filter((call) => call[0] === 'is'), [
		['is', 'superseded_at', null],
		['is', 'released_at', null],
	]);
	assert.equal(isWorkspaceTeamActiveEditableCheckout(checkoutRecord(), 'workspace-1', now), true);
	assert.equal(isWorkspaceTeamActiveEditableCheckout(checkoutRecord({ released_at: '2026-07-23T12:01:00.000Z', status: 'released', editing_mode: 'none' }), 'workspace-1', now), false);
});

test('Holder Undo remains holder-only while application release is internal', async () => {
	const exportSql = await readFile(exportMigrationUrl, 'utf8');
	const releaseSql = await readFile(migrationUrl, 'utf8');

	assert.match(exportSql, /coalesce\(p_release_source, ''\) <> 'holder_undo'/);
	assert.match(exportSql, /v_checkout_export\.requested_by is distinct from v_actor_id/);
	assert.match(releaseSql, /revoke all on function public\.release_workspace_membership_csv_checkout_after_application/);
	assert.doesNotMatch(releaseSql, /grant execute on function public\.release_workspace_membership_csv_checkout_after_application/);
});

test('Team page treats applied import as history rather than restarting review', async () => {
	const page = await readFile(pageUrl, 'utf8');

	assert.match(page, /importRun\.status === 'applied'/);
	assert.match(page, /data-workspace-team-applied-review-disabled/);
	assert.match(page, /Applied change set/);
	assert.match(page, /importRun\.status === 'approved_for_application'/);
	assert.match(page, /View approved change set/);
});

test('WT-007 application release documentation records transaction and deployment boundary', async () => {
	const docs = await readFile(docsUrl, 'utf8');
	const schemaDocs = await readFile(schemaDocsUrl, 'utf8');

	assert.match(docs, /application_completed/);
	assert.match(docs, /Approved Workspace Team changes applied successfully/);
	assert.match(docs, /If checkout release cannot be recorded, the application rolls back/);
	assert.match(schemaDocs, /release_workspace_membership_csv_checkout_after_application/);
	assert.match(schemaDocs, /source_export_id/);
	assert.match(schemaDocs, /production migration deployment is required/);
});
