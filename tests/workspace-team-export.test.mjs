import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	WORKSPACE_TEAM_CSV_COLUMNS,
	buildWorkspaceTeamCsv,
	encodeCsvCell,
	safeWorkspaceTeamCsvFilename,
} from '../src/lib/workspaceTeamCsv.ts';
import {
	WORKSPACE_TEAM_ACTIVE_EDITABLE_CHECKOUT_SELECT,
	applyWorkspaceTeamActiveEditableCheckoutFilters,
	isWorkspaceTeamActiveEditableCheckout,
} from '../src/lib/workspaceTeam.ts';
import { buildWorkspaceTeamCheckoutReleasePath, buildWorkspaceTeamExportPath } from '../src/lib/projectRoutes.ts';

const migrationUrl = new URL('../supabase/migrations/20260722000200_workspace_membership_csv_export_checkout.sql', import.meta.url);
const checkoutReleaseMigrationUrl = new URL('../supabase/migrations/20260722000600_workspace_membership_csv_checkout_release.sql', import.meta.url);
const endpointUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/export.ts', import.meta.url);
const releaseEndpointUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/export/release.ts', import.meta.url);
const pageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);

async function migrationSql() {
	return readFile(migrationUrl, 'utf8');
}

class QueryRecorder {
	operations = [];

	select(columns) {
		this.operations.push(['select', columns]);
		return this;
	}

	eq(column, value) {
		this.operations.push(['eq', column, value]);
		return this;
	}

	is(column, value) {
		this.operations.push(['is', column, value]);
		return this;
	}

	gt(column, value) {
		this.operations.push(['gt', column, value]);
		return this;
	}

	order(column, options) {
		this.operations.push(['order', column, options]);
		return this;
	}

	limit(count) {
		this.operations.push(['limit', count]);
		return this;
	}
}

function checkoutRecord(overrides = {}) {
	return {
		id: 'export-1',
		organisation_id: 'workspace-1',
		requested_by: 'user-1',
		exported_at: '2026-07-22T09:42:30.000Z',
		export_mode: 'editable',
		editing_mode: 'checked_out',
		status: 'checked_out',
		checkout_expires_at: '2026-07-23T09:42:30.000Z',
		membership_snapshot_version: 12345,
		superseded_at: null,
		released_at: null,
		...overrides,
	};
}

test('Workspace Team CSV columns and filename follow the export contract', () => {
	assert.deepEqual([...WORKSPACE_TEAM_CSV_COLUMNS], [
		'export_id',
		'membership_snapshot_version',
		'exported_at',
		'export_mode',
		'workspace_membership_id',
		'user_id',
		'login_name',
		'first_name',
		'last_name',
		'email',
		'workspace_role',
		'membership_status',
		'invited_at',
		'invitation_expires_at',
		'accepted_at',
		'last_login_at',
		'added_at',
		'deactivated_at',
		'reactivated_at',
		'proposed_membership_action',
	]);
	assert.equal(
		safeWorkspaceTeamCsvFilename('Mark Nesbit Professional Workspace', '2026-07-22T09:42:30.000Z', 'editable'),
		'watchtower-workspace-team-mark-nesbit-professional-workspace-20260722-0942-editable.csv',
	);
	assert.equal(buildWorkspaceTeamExportPath('alpha workspace'), '/app/workspaces/alpha%20workspace/team/export');
	assert.equal(buildWorkspaceTeamCheckoutReleasePath('alpha workspace'), '/app/workspaces/alpha%20workspace/team/export/release');
});

test('Workspace Team CSV encoding escapes special characters unicode and formula-like values', () => {
	assert.equal(encodeCsvCell('Smith, Jane'), '"Smith, Jane"');
	assert.equal(encodeCsvCell('Quote "inside"'), '"Quote ""inside"""');
	assert.equal(encodeCsvCell('Line\r\nbreak'), '"Line\r\nbreak"');
	assert.equal(encodeCsvCell('Łukasz'), 'Łukasz');
	assert.equal(encodeCsvCell('=cmd|A1'), "'=cmd|A1");
	assert.equal(encodeCsvCell('+SUM(A1:A2)'), "'+SUM(A1:A2)");
	assert.equal(encodeCsvCell('-10'), "'-10");
	assert.equal(encodeCsvCell('@lookup'), "'@lookup");
});

test('Workspace Team CSV repeats metadata and exports all lifecycle states deterministically', () => {
	const csv = buildWorkspaceTeamCsv({
		export_id: 'export-1',
		membership_snapshot_version: 12345,
		exported_at: '2026-07-22T09:42:30.000Z',
		export_mode: 'read_only',
		rows: [
			{
				workspace_membership_id: 'member-1',
				user_id: 'user-1',
				login_name: 'owner',
				first_name: 'Alex',
				last_name: 'Owner',
				email: 'alex@example.com',
				workspace_role: 'owner',
				membership_status: 'active',
				accepted_at: '2026-07-01T00:00:00.000Z',
				added_at: '2026-07-01T00:00:00.000Z',
			},
			{
				workspace_membership_id: 'member-2',
				user_id: 'user-2',
				login_name: '=formula',
				first_name: 'Invited',
				last_name: 'Person',
				email: 'invited@example.com',
				workspace_role: 'viewer',
				membership_status: 'invite_expired',
				invited_at: '2026-07-02T00:00:00.000Z',
				invitation_expires_at: '2026-07-09T00:00:00.000Z',
				added_at: '2026-07-02T00:00:00.000Z',
			},
		],
	});

	const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r\n/);
	assert.equal(lines[0], WORKSPACE_TEAM_CSV_COLUMNS.join(','));
	assert.match(lines[1], /^export-1,12345,2026-07-22T09:42:30.000Z,read_only,member-1,user-1/);
	assert.match(lines[2], /invite_expired/);
	assert.match(lines[2], /'\=formula/);
});

test('CSV export migration completes schema with snapshot rows mode and audit events', async () => {
	const sql = await migrationSql();

	assert.match(sql, /add column if not exists export_mode text not null default 'editable'/);
	assert.match(sql, /create table public\.workspace_membership_export_rows/);
	assert.match(sql, /workspace_membership_id uuid not null/);
	assert.match(sql, /user_id uuid not null/);
	assert.match(sql, /contact_email text/);
	assert.match(sql, /membership_status text not null/);
	assert.match(sql, /row_values jsonb not null default '\{\}'::jsonb/);
	assert.match(sql, /membership_export_read_only_generated/);
	assert.match(sql, /membership_export_taken_over/);
	assert.match(sql, /revoke insert, update on public\.workspace_membership_export_runs from authenticated/);
	assert.match(sql, /grant execute on function public\.current_workspace_membership_snapshot_version\(uuid\) to service_role/);
	assert.doesNotMatch(sql, /grant execute on function public\.current_workspace_membership_snapshot_version\(uuid\) to authenticated/);
	assert.match(sql, /grant execute on function public\.create_workspace_membership_csv_export\(uuid, text, uuid\) to authenticated, service_role/);
});

test('CSV export migration computes durable snapshots from membership and profile fields', async () => {
	const sql = await migrationSql();

	assert.match(sql, /create or replace function public\.current_workspace_membership_snapshot_version/);
	for (const field of [
		'om.id::text',
		'om.user_id::text',
		'p.first_name',
		'p.last_name',
		'p.login_name',
		'p.contact_email',
		'p.last_login_at',
		'om.role',
		'om.status',
		'om.invited_at',
		'om.invitation_expires_at',
		'om.accepted_at',
		'om.suspended_at',
		'om.created_at',
		'om.deactivated_at',
		'om.reactivated_at',
	]) {
		assert.match(sql, new RegExp(field.replace(/[().]/g, '\\$&')));
	}
	assert.match(sql, /md5\(coalesce\(snapshot_text, 'empty-workspace-membership-snapshot'\)\)/);
	assert.doesNotMatch(sql, /exported_at as membership_snapshot_version|now\(\)::bigint/);
});

test('CSV export migration enforces one active editable checkout transactionally', async () => {
	const sql = await migrationSql();

	assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(target_organisation_id::text, 4004\)\)/);
	assert.match(sql, /for update/);
	assert.match(sql, /WT_MEMBERSHIP_EXPORT_ACTIVE_CHECKOUT/);
	assert.match(sql, /export_mode = 'editable'/);
	assert.match(sql, /status = 'checked_out'/);
	assert.match(sql, /checkout_expires_at > now\(\)/);
	assert.match(sql, /now\(\) \+ interval '24 hours'/);
	assert.match(sql, /requested_export_mode = 'read_only'/);
	assert.match(sql, /status = 'superseded'/);
	assert.match(sql, /superseded_by_export_id = new_export\.id/);
	assert.match(sql, /takeover_of_export_id/);
});

test('Workspace Team active checkout filter excludes released superseded expired and non-editable exports', () => {
	const query = new QueryRecorder();
	const nowIso = '2026-07-22T10:00:00.000Z';

	assert.equal(applyWorkspaceTeamActiveEditableCheckoutFilters(query, 'workspace-1', nowIso), query);
	assert.deepEqual(query.operations, [
		['select', WORKSPACE_TEAM_ACTIVE_EDITABLE_CHECKOUT_SELECT],
		['eq', 'organisation_id', 'workspace-1'],
		['eq', 'export_mode', 'editable'],
		['eq', 'status', 'checked_out'],
		['eq', 'editing_mode', 'checked_out'],
		['is', 'superseded_at', null],
		['is', 'released_at', null],
		['gt', 'checkout_expires_at', nowIso],
		['order', 'exported_at', { ascending: false }],
		['limit', 1],
	]);

	const now = new Date(nowIso);
	assert.equal(isWorkspaceTeamActiveEditableCheckout(checkoutRecord(), 'workspace-1', now), true);
	assert.equal(isWorkspaceTeamActiveEditableCheckout(checkoutRecord({ released_at: '2026-07-22T10:01:00.000Z', status: 'released', editing_mode: 'none' }), 'workspace-1', now), false);
	assert.equal(isWorkspaceTeamActiveEditableCheckout(checkoutRecord({ released_at: '2026-07-22T10:01:00.000Z' }), 'workspace-1', now), false);
	assert.equal(isWorkspaceTeamActiveEditableCheckout(checkoutRecord({ superseded_at: '2026-07-22T10:01:00.000Z' }), 'workspace-1', now), false);
	assert.equal(isWorkspaceTeamActiveEditableCheckout(checkoutRecord({ checkout_expires_at: '2026-07-22T09:59:59.000Z' }), 'workspace-1', now), false);
	assert.equal(isWorkspaceTeamActiveEditableCheckout(checkoutRecord({ export_mode: 'read_only' }), 'workspace-1', now), false);
	assert.equal(isWorkspaceTeamActiveEditableCheckout(checkoutRecord({ editing_mode: 'none' }), 'workspace-1', now), false);
	assert.equal(isWorkspaceTeamActiveEditableCheckout(checkoutRecord({ organisation_id: 'workspace-2' }), 'workspace-1', now), false);
});

test('CSV checkout release migration adds holder-only release without evidence deletion', async () => {
	const sql = await readFile(checkoutReleaseMigrationUrl, 'utf8');

	for (const field of ['released_at', 'released_by', 'release_source', 'release_reason']) {
		assert.match(sql, new RegExp(`add column if not exists ${field}`));
	}
	assert.match(sql, /status in \('generated', 'checked_out', 'released', 'superseded', 'expired', 'cancelled'\)/);
	assert.match(sql, /release_source is null or release_source in \('holder_undo'\)/);
	assert.match(sql, /released_at is null/);
	assert.match(sql, /create or replace function public\.release_workspace_membership_csv_checkout/);
	assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(target_organisation_id::text, 4004\)\)/);
	assert.match(sql, /workspace_membership_require_admin_actor\(target_organisation_id\)/);
	assert.match(sql, /checkout_export\.requested_by is distinct from actor\.actor_user_id/);
	assert.match(sql, /WT_MEMBERSHIP_EXPORT_RELEASE_HOLDER_ONLY/);
	assert.match(sql, /WT_MEMBERSHIP_EXPORT_RELEASE_NOT_ACTIVE/);
	assert.match(sql, /set status = 'released'/);
	assert.match(sql, /editing_mode = 'none'/);
	assert.match(sql, /released_at = now\(\)/);
	assert.match(sql, /released_by = actor\.actor_user_id/);
	assert.match(sql, /release_source = 'holder_undo'/);
	assert.match(sql, /where id = checkout_export\.id[\s\S]*and status = 'checked_out'[\s\S]*and editing_mode = 'checked_out'[\s\S]*and released_at is null[\s\S]*returning \* into released_export/);
	assert.match(sql, /return released_export\.id/);
	assert.match(sql, /workspace_membership_csv_checkout_released/);
	assert.match(sql, /grant execute on function public\.release_workspace_membership_csv_checkout/);
	assert.doesNotMatch(sql, /delete from public\.workspace_membership_export_runs|delete from public\.workspace_membership_export_rows|delete from public\.workspace_membership_import_runs|delete from public\.workspace_membership_import_rows|delete from public\.workspace_membership_change_decisions/i);
	assert.doesNotMatch(sql, /insert into public\.organisation_members|update public\.organisation_members|insert into public\.profiles|update public\.profiles|auth\.admin|insert into auth\.users/i);
});

test('CSV export endpoint authenticates scopes authorises and returns download headers', async () => {
	const endpoint = await readFile(endpointUrl, 'utf8');

	assert.match(endpoint, /export const POST/);
	assert.match(endpoint, /getServerAccessToken\(cookies\)/);
	assert.match(endpoint, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(endpoint, /workspace\.role !== 'owner' && workspace\.role !== 'admin'/);
	assert.match(endpoint, /\.rpc\('create_workspace_membership_csv_export'/);
	assert.match(endpoint, /buildWorkspaceTeamCsv\(exportRun\)/);
	assert.match(endpoint, /content-type': 'text\/csv; charset=utf-8'/);
	assert.match(endpoint, /content-disposition': `attachment; filename="\$\{filename\}"`/);
	assert.match(endpoint, /x-watchtower-export-id/);
	assert.match(endpoint, /export const GET/);
	assert.doesNotMatch(endpoint, /auth\.users|service_role|\.from\('profiles'\)|\.insert\(|\.update\(|\.delete\(/);
});

test('CSV checkout release endpoint is POST-only scoped and delegates to the release RPC', async () => {
	const endpoint = await readFile(releaseEndpointUrl, 'utf8');

	assert.match(endpoint, /export const POST/);
	assert.match(endpoint, /export const GET/);
	assert.match(endpoint, /405/);
	assert.match(endpoint, /getServerAccessToken\(cookies\)/);
	assert.match(endpoint, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(endpoint, /workspace\.role !== 'owner' && workspace\.role !== 'admin'/);
	assert.match(endpoint, /request\.formData\(\)/);
	assert.match(endpoint, /target_export_id: exportId/);
	assert.match(endpoint, /\.rpc\('release_workspace_membership_csv_checkout'/);
	assert.match(endpoint, /release_source: 'holder_undo'/);
	assert.match(endpoint, /303/);
	assert.match(endpoint, /checkout_release=success|checkout_release/);
	assert.doesNotMatch(endpoint, /auth\.users|service_role|\.from\('profiles'\)|\.from\('organisation_members'\)|\.from\('workspace_membership_change_decisions'\)|\.insert\(|\.update\(|\.delete\(/);
});

test('Workspace Team page displays checkout warning and confirmation dialog flows', async () => {
	const page = await readFile(pageUrl, 'utf8');

	assert.match(page, /data-active-editable-checkout/);
	assert.match(page, /data-workspace-team-export-open/);
	assert.match(page, /data-workspace-team-export-download-form/);
	assert.match(page, /workspace-team-editable-export-dialog/);
	assert.match(page, /workspace-team-export-conflict-dialog/);
	assert.match(page, /This creates a versioned export and starts a 24-hour advisory editing window/);
	assert.match(page, /The CSV is an offline working copy; the database remains the source of truth/);
	assert.match(page, /Download read-only copy/);
	assert.match(page, /Take over editing/);
	assert.match(page, /confirm_takeover/);
	assert.match(page, /dialog\.showModal\(\)/);
	assert.match(page, /lastTriggerByDialog/);
	assert.match(page, /data-workspace-team-dialog-cancel/);
	assert.match(page, /applyWorkspaceTeamActiveEditableCheckoutFilters/);
	assert.match(page, /isWorkspaceTeamActiveEditableCheckout\(checkoutData, organisation\.id\) \? checkoutData : null/);
	assert.doesNotMatch(page, /contact_email|auth_email|service_role|auth\.users/);
});

test('Workspace Team page shows holder-only Undo checkout confirmation', async () => {
	const page = await readFile(pageUrl, 'utf8');

	assert.match(page, /Astro\.response\.headers\.set\('Cache-Control', 'private, no-store, no-cache, must-revalidate'\)/);
	assert.match(page, /Astro\.response\.headers\.set\('Pragma', 'no-cache'\)/);
	assert.match(page, /Astro\.response\.headers\.set\('Expires', '0'\)/);
	assert.match(page, /buildWorkspaceTeamCheckoutReleasePath/);
	assert.match(page, /checkoutHeldByCurrentUser && checkoutReleaseAction/);
	assert.match(page, /data-team-csv-checkout-undo/);
	assert.match(page, />\s*Undo\s*</);
	assert.match(page, /Undo editable file checkout\?/);
	assert.match(page, /Your downloaded CSV will not be deleted/);
	assert.match(page, /Keep checkout/);
	assert.match(page, /Undo checkout/);
	assert.match(page, /data-workspace-team-checkout-release-dialog/);
	assert.match(page, /data-workspace-team-checkout-release-form/);
	assert.match(page, /data-workspace-team-checkout-release-message/);
	assert.match(page, /Editable team-file checkout undone\./);
	assert.match(page, /canAdministerLater && exportAction && !checkoutHeldByCurrentUser/);
	assert.match(page, /submitButton\.disabled = true/);
	assert.match(page, /lastTriggerByDialog/);
});

test('Workspace Team export forms close only after a successful download response', async () => {
	const page = await readFile(pageUrl, 'utf8');

	assert.match(page, /await fetch\(form\.action/);
	assert.match(page, /method: 'POST'/);
	assert.match(page, /credentials: 'same-origin'/);
	assert.match(page, /const blob = await response\.blob\(\)/);
	assert.match(page, /downloadBlob\(blob, exportFilenameFromResponse\(response\)\)/);
	assert.match(page, /content-disposition/);
	assert.match(page, /dialog\.close\('downloaded'\)/);
	assert.match(page, /formData\.get\('export_mode'\) === 'editable'/);
	assert.match(page, /window\.location\.reload\(\)/);
});

test('Workspace Team export modal prevents duplicates and remains open on failure', async () => {
	const page = await readFile(pageUrl, 'utf8');

	assert.match(page, /if \(submitButton\?\.disabled\) return/);
	assert.match(page, /submitButton\.disabled = true/);
	assert.match(page, /submitButton\.textContent = 'Preparing CSV\.\.\.'/);
	assert.match(page, /if \(!response\.ok\)/);
	assert.match(page, /const failureText = await response\.text\(\)/);
	assert.match(page, /setExportMessage\(form, message\)/);
	assert.match(page, /data-workspace-team-export-message/);
	assert.match(page, /role="alert"/);
});

test('Workspace Team export docs record snapshot checkout and exclusion boundaries', async () => {
	const docs = await readFile(docsUrl, 'utf8');

	assert.match(docs, /WT-WORKSPACE-TEAM-004/);
	assert.match(docs, /watchtower-workspace-team-\{workspace-slug\}-\{YYYYMMDD-HHmm\}-\{mode\}\.csv/);
	assert.match(docs, /profiles\.contact_email/);
	assert.match(docs, /proposed_membership_action/);
	assert.match(docs, /24-hour advisory checkout/);
	assert.match(docs, /release_workspace_membership_csv_checkout/);
	assert.match(docs, /release_source = holder_undo/);
	assert.match(docs, /workspace_membership_csv_checkout_released/);
	assert.match(docs, /does not delete the export record, snapshot rows, import evidence, review decisions or the user's downloaded CSV/);
	assert.match(docs, /Successful browser exports wait for the server response/);
	assert.match(docs, /formula-injection/);
	assert.match(docs, /WT-WORKSPACE-TEAM-005 adds upload, parsing, validation and comparison evidence only/);
});
