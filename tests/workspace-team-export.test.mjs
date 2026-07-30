import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	WORKSPACE_TEAM_CSV_COLUMNS,
	buildWorkspaceTeamCsv,
	encodeCsvCell,
	normaliseWorkspaceTeamCsvExport,
	normaliseWorkspaceTeamSnapshotVersion,
	safeWorkspaceTeamCsvFilename,
} from '../src/lib/workspaceTeamCsv.ts';
import { validateWorkspaceTeamCsvImport } from '../src/lib/workspaceTeamCsvImport.ts';
import {
	WORKSPACE_TEAM_ACTIVE_EDITABLE_CHECKOUT_SELECT,
	applyWorkspaceTeamActiveEditableCheckoutFilters,
	isWorkspaceTeamActiveEditableCheckout,
} from '../src/lib/workspaceTeam.ts';
import {
	WORKSPACE_TEAM_CHECKOUT_RELEASE_RPC,
	workspaceTeamCheckoutReleaseErrorCode,
	workspaceTeamCheckoutReleaseStateErrorCode,
} from '../src/lib/workspaceTeamCheckoutRelease.ts';
import { buildWorkspaceTeamCheckoutReleasePath, buildWorkspaceTeamExportPath } from '../src/lib/projectRoutes.ts';

const migrationUrl = new URL('../supabase/migrations/20260722000200_workspace_membership_csv_export_checkout.sql', import.meta.url);
const checkoutReleaseMigrationUrl = new URL('../supabase/migrations/20260722000600_workspace_membership_csv_checkout_release.sql', import.meta.url);
const checkoutReleaseDiagnosticsMigrationUrl = new URL('../supabase/migrations/20260722000700_workspace_membership_csv_checkout_release_diagnostics.sql', import.meta.url);
const checkoutReleaseAmbiguityMigrationUrl = new URL('../supabase/migrations/20260723000100_workspace_membership_csv_checkout_release_ambiguity_fix.sql', import.meta.url);
const exportSnapshotTextMigrationUrl = new URL('../supabase/migrations/20260723000200_workspace_membership_csv_export_snapshot_text.sql', import.meta.url);
const endpointUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/export.ts', import.meta.url);
const releaseEndpointUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/export/release.ts', import.meta.url);
const checkoutReleaseHelperUrl = new URL('../src/lib/workspaceTeamCheckoutRelease.ts', import.meta.url);
const pageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const EXPORT_ID = '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const LARGE_SNAPSHOT_VERSION = '894187232527702000';
const ROUNDED_LARGE_SNAPSHOT_VERSION = '894187232527702016';

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

test('Workspace Team CSV preserves exact snapshot versions during serialization', () => {
	const snapshotVersions = [
		'1',
		String(Number.MAX_SAFE_INTEGER),
		'9007199254740992',
		'788635894721686700',
		LARGE_SNAPSHOT_VERSION,
		999999n,
	];

	for (const snapshotVersion of snapshotVersions) {
		const expectedSnapshot = String(snapshotVersion);
		const csv = buildWorkspaceTeamCsv({
			export_id: EXPORT_ID,
			membership_snapshot_version: snapshotVersion,
			exported_at: '2026-07-22T09:42:30.000Z',
			export_mode: 'editable',
			rows: [
				{ workspace_membership_id: MEMBERSHIP_ID, user_id: USER_ID, first_name: 'Mark', last_name: 'Nesbit', email: 'mark@example.com', workspace_role: 'owner', membership_status: 'active' },
				{ first_name: 'New', last_name: 'Person', email: 'new@example.com', workspace_role: 'viewer' },
			],
		});
		const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r\n/);

		assert.equal(lines.length, 3);
		assert.equal(lines[1].split(',')[1], expectedSnapshot);
		assert.equal(lines[2].split(',')[1], expectedSnapshot);
		assert.equal(csv.includes(ROUNDED_LARGE_SNAPSHOT_VERSION), false);
		assert.equal(/e\+|E\+/.test(csv), false);
	}

	assert.equal(normaliseWorkspaceTeamSnapshotVersion(' 894187232527702000 '), LARGE_SNAPSHOT_VERSION);
	assert.equal(normaliseWorkspaceTeamSnapshotVersion(12345), '12345');
	assert.equal(normaliseWorkspaceTeamSnapshotVersion(12345n), '12345');
	assert.equal(normaliseWorkspaceTeamSnapshotVersion(Number.MAX_SAFE_INTEGER), String(Number.MAX_SAFE_INTEGER));
	assert.equal(normaliseWorkspaceTeamSnapshotVersion(9007199254740992), null);
	assert.throws(() => buildWorkspaceTeamCsv({
		export_id: EXPORT_ID,
		membership_snapshot_version: 9007199254740992,
		exported_at: '2026-07-22T09:42:30.000Z',
		export_mode: 'editable',
		rows: [{ workspace_membership_id: MEMBERSHIP_ID, user_id: USER_ID }],
	}), /unsafe membership snapshot version/);
});

test('Workspace Team CSV normalises RPC export payload snapshot version before download', () => {
	const exportRun = normaliseWorkspaceTeamCsvExport({
		export_id: EXPORT_ID,
		membership_snapshot_version: LARGE_SNAPSHOT_VERSION,
		exported_at: '2026-07-22T09:42:30.000Z',
		export_mode: 'editable',
		rows: [{ workspace_membership_id: MEMBERSHIP_ID, user_id: USER_ID }],
	});

	assert.equal(exportRun.membership_snapshot_version, LARGE_SNAPSHOT_VERSION);
	assert.equal(normaliseWorkspaceTeamCsvExport({
		...exportRun,
		membership_snapshot_version: 12345,
	}).membership_snapshot_version, '12345');
	assert.equal(normaliseWorkspaceTeamCsvExport({
		...exportRun,
		membership_snapshot_version: 12345n,
	}).membership_snapshot_version, '12345');
	assert.throws(() => normaliseWorkspaceTeamCsvExport({
		...exportRun,
		membership_snapshot_version: 9007199254740992,
	}), /unsafe membership snapshot version/);
});

test('Workspace Team exported CSV round trips large snapshot comparison exactly', () => {
	const sourceRow = {
		source_row_number: 1,
		workspace_membership_id: MEMBERSHIP_ID,
		user_id: USER_ID,
		login_name: 'mark.nesbit',
		first_name: 'Mark',
		last_name: 'Nesbit',
		email: 'mark@example.com',
		workspace_role: 'owner',
		membership_status: 'active',
		accepted_at: '2026-07-01T00:00:00.000Z',
		added_at: '2026-07-01T00:00:00.000Z',
	};
	const csv = buildWorkspaceTeamCsv({
		export_id: EXPORT_ID,
		membership_snapshot_version: LARGE_SNAPSHOT_VERSION,
		exported_at: '2026-07-22T09:42:30.000Z',
		export_mode: 'editable',
		rows: [
			sourceRow,
			{ first_name: 'New', last_name: 'Person', email: 'new@example.com', workspace_role: 'viewer', proposed_membership_action: '' },
		],
	});
	const result = validateWorkspaceTeamCsvImport(csv, {
		organisationId: ORG_ID,
		sourceExport: {
			id: EXPORT_ID,
			organisation_id: ORG_ID,
			export_mode: 'editable',
			status: 'checked_out',
			exported_at: '2026-07-22T09:42:30.000Z',
			membership_snapshot_version: LARGE_SNAPSHOT_VERSION,
			checkout_expires_at: '2026-07-23T09:42:30.000Z',
			superseded_at: null,
		},
		sourceRows: [sourceRow],
		liveRows: [sourceRow],
		liveSnapshotVersion: LARGE_SNAPSHOT_VERSION,
		now: new Date('2026-07-22T12:00:00.000Z'),
	});

	assert.equal(result.status, 'validated');
	assert.equal(result.sourceSnapshotVersion, LARGE_SNAPSHOT_VERSION);
	assert.equal(result.liveSnapshotVersion, LARGE_SNAPSHOT_VERSION);
	assert.equal(result.summary.unchanged, 1);
	assert.equal(result.summary.additions, 1);
	assert.deepEqual(result.fileErrors, []);
	assert.equal(JSON.stringify(result).includes(ROUNDED_LARGE_SNAPSHOT_VERSION), false);
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

test('CSV export snapshot precision migration returns and audits snapshot text', async () => {
	const sql = await readFile(exportSnapshotTextMigrationUrl, 'utf8');

	assert.match(sql, /create or replace function public\.create_workspace_membership_csv_export/);
	assert.match(sql, /returns jsonb[\s\S]*security definer[\s\S]*set search_path = public/);
	assert.match(sql, /snapshot_version bigint/);
	assert.match(sql, /membership_snapshot_version,\s*[\s\S]*snapshot_version,\s*[\s\S]*requested_export_mode/);
	assert.match(sql, /'snapshot_version', prior_export\.membership_snapshot_version::text/);
	assert.match(sql, /'membership_snapshot_version', new_export\.membership_snapshot_version::text/);
	assert.match(sql, /'membership_snapshot_version', new_export\.membership_snapshot_version::text,\s*[\s\S]*'exported_at'/);
	assert.match(sql, /grant execute on function public\.create_workspace_membership_csv_export\(uuid, text, uuid\) to authenticated, service_role/);
	assert.doesNotMatch(sql, /'membership_snapshot_version', new_export\.membership_snapshot_version(?!::text)/);
	assert.doesNotMatch(sql, /'snapshot_version', prior_export\.membership_snapshot_version(?!::text)/);
	assert.doesNotMatch(sql, /insert into public\.organisation_members|update public\.organisation_members|insert into public\.profiles|update public\.profiles|auth\.admin|insert into auth\.users/i);
	assert.doesNotMatch(sql, /delete from public\.workspace_membership_export_runs|delete from public\.workspace_membership_export_rows|delete from public\.workspace_membership_import_runs|delete from public\.workspace_membership_import_rows|delete from public\.workspace_membership_change_decisions/i);
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

test('Workspace Team checkout release helper maps active state and RPC failures specifically', () => {
	const now = new Date('2026-07-22T10:00:00.000Z');

	assert.equal(workspaceTeamCheckoutReleaseStateErrorCode(checkoutRecord(), 'user-1', now), null);
	assert.equal(workspaceTeamCheckoutReleaseStateErrorCode(null, 'user-1', now), 'no_active_checkout');
	assert.equal(workspaceTeamCheckoutReleaseStateErrorCode(checkoutRecord({ requested_by: 'user-2' }), 'user-1', now), 'not_holder');
	assert.equal(workspaceTeamCheckoutReleaseStateErrorCode(checkoutRecord({ released_at: '2026-07-22T10:01:00.000Z', status: 'released' }), 'user-1', now), 'already_released');
	assert.equal(workspaceTeamCheckoutReleaseStateErrorCode(checkoutRecord({ checkout_expires_at: '2026-07-22T09:59:59.000Z' }), 'user-1', now), 'expired');
	assert.equal(workspaceTeamCheckoutReleaseStateErrorCode(checkoutRecord({ checkout_expires_at: null }), 'user-1', now), 'no_active_checkout');
	assert.equal(workspaceTeamCheckoutReleaseStateErrorCode(checkoutRecord({ checkout_expires_at: 'not-a-date' }), 'user-1', now), 'no_active_checkout');
	assert.equal(workspaceTeamCheckoutReleaseStateErrorCode(checkoutRecord({ superseded_at: '2026-07-22T10:01:00.000Z' }), 'user-1', now), 'superseded');
	assert.equal(workspaceTeamCheckoutReleaseStateErrorCode(checkoutRecord({ status: 'generated', editing_mode: 'none' }), 'user-1', now), 'no_active_checkout');

	assert.equal(workspaceTeamCheckoutReleaseErrorCode({ message: 'WT_MEMBERSHIP_EXPORT_RELEASE_HOLDER_ONLY' }), 'not_holder');
	assert.equal(workspaceTeamCheckoutReleaseErrorCode({ message: 'WT_MEMBERSHIP_EXPORT_RELEASE_ALREADY_RELEASED' }), 'already_released');
	assert.equal(workspaceTeamCheckoutReleaseErrorCode({ message: 'WT_MEMBERSHIP_EXPORT_RELEASE_EXPIRED' }), 'expired');
	assert.equal(workspaceTeamCheckoutReleaseErrorCode({ message: 'WT_MEMBERSHIP_EXPORT_RELEASE_SUPERSEDED' }), 'superseded');
	assert.equal(workspaceTeamCheckoutReleaseErrorCode({ message: 'WT_MEMBERSHIP_EXPORT_RELEASE_NOT_FOUND' }), 'no_active_checkout');
	assert.equal(workspaceTeamCheckoutReleaseErrorCode({ message: 'WT_MEMBERSHIP_PERMISSION_DENIED' }), 'permission_denied');
	assert.equal(workspaceTeamCheckoutReleaseErrorCode({ message: 'workspace_membership_audit_events_previous_status_check' }), 'audit_failed');
	assert.equal(workspaceTeamCheckoutReleaseErrorCode({ code: 'PGRST202', message: 'Could not find function in schema cache' }), 'rpc_failed');
	assert.equal(workspaceTeamCheckoutReleaseErrorCode({ message: 'unexpected' }, 'expired'), 'expired');
	assert.equal(workspaceTeamCheckoutReleaseErrorCode({ message: 'unexpected' }), 'failed');
	assert.equal(WORKSPACE_TEAM_CHECKOUT_RELEASE_RPC, 'release_workspace_membership_csv_checkout');
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

test('CSV checkout release diagnostics migration fixes audit status compatibility and controlled errors', async () => {
	const sql = await readFile(checkoutReleaseDiagnosticsMigrationUrl, 'utf8');

	assert.match(sql, /drop constraint if exists workspace_membership_audit_events_previous_status_check/);
	assert.match(sql, /drop constraint if exists workspace_membership_audit_events_new_status_check/);
	assert.match(sql, /previous_status in \([\s\S]*'checked_out'[\s\S]*'released'[\s\S]*'superseded'[\s\S]*'expired'[\s\S]*'cancelled'[\s\S]*\)/);
	assert.match(sql, /new_status in \([\s\S]*'checked_out'[\s\S]*'released'[\s\S]*'superseded'[\s\S]*'expired'[\s\S]*'cancelled'[\s\S]*\)/);
	assert.match(sql, /create or replace function public\.release_workspace_membership_csv_checkout\(\s*target_organisation_id uuid,\s*target_export_id uuid,\s*release_reason text default null,\s*release_source text default 'holder_undo'\s*\)/);
	assert.match(sql, /returns uuid[\s\S]*security definer[\s\S]*set search_path = public/);
	assert.match(sql, /workspace_membership_require_admin_actor\(target_organisation_id\)/);
	assert.match(sql, /WT_MEMBERSHIP_EXPORT_RELEASE_NOT_FOUND/);
	assert.match(sql, /WT_MEMBERSHIP_EXPORT_RELEASE_ALREADY_RELEASED/);
	assert.match(sql, /WT_MEMBERSHIP_EXPORT_RELEASE_SUPERSEDED/);
	assert.match(sql, /WT_MEMBERSHIP_EXPORT_RELEASE_EXPIRED/);
	assert.match(sql, /WT_MEMBERSHIP_EXPORT_RELEASE_NO_ACTIVE_CHECKOUT/);
	assert.match(sql, /checkout_export\.checkout_expires_at is null/);
	assert.match(sql, /WT_MEMBERSHIP_EXPORT_RELEASE_HOLDER_ONLY/);
	assert.match(sql, /WT_MEMBERSHIP_EXPORT_RELEASE_AUDIT_FAILED/);
	assert.match(sql, /and requested_by = actor\.actor_user_id[\s\S]*and released_at is null[\s\S]*and superseded_at is null[\s\S]*and status = 'checked_out'[\s\S]*and editing_mode = 'checked_out'/);
	assert.match(sql, /record_workspace_membership_audit_event\([\s\S]*'workspace_membership_csv_checkout_released'[\s\S]*'checked_out'[\s\S]*'released'/);
	assert.match(sql, /grant execute on function public\.release_workspace_membership_csv_checkout\(uuid, uuid, text, text\) to authenticated, service_role/);
	assert.doesNotMatch(sql, /delete from public\.workspace_membership_export_runs|delete from public\.workspace_membership_export_rows|delete from public\.workspace_membership_import_runs|delete from public\.workspace_membership_import_rows|delete from public\.workspace_membership_change_decisions/i);
	assert.doesNotMatch(sql, /insert into public\.organisation_members|update public\.organisation_members|insert into public\.profiles|update public\.profiles|auth\.admin|insert into auth\.users/i);
});

test('CSV checkout release ambiguity fix qualifies parameters columns release reason and audit values', async () => {
	const sql = await readFile(checkoutReleaseAmbiguityMigrationUrl, 'utf8');

	assert.match(sql, /drop function if exists public\.release_workspace_membership_csv_checkout\(uuid, uuid, text, text\)/);
	assert.match(sql, /create function public\.release_workspace_membership_csv_checkout\(\s*p_organisation_id uuid,\s*p_export_id uuid,\s*p_release_reason text default null,\s*p_release_source text default 'holder_undo'\s*\)/);
	assert.match(sql, /v_actor_id uuid/);
	assert.match(sql, /v_checkout_export public\.workspace_membership_export_runs/);
	assert.match(sql, /v_released_export public\.workspace_membership_export_runs/);
	assert.match(sql, /v_release_reason text := nullif\(btrim\(p_release_reason\), ''\)/);
	assert.match(sql, /v_released_at timestamptz := now\(\)/);
	assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_organisation_id::text, 4004\)\)/);
	assert.match(sql, /workspace_membership_require_admin_actor\(p_organisation_id\)/);
	assert.match(sql, /coalesce\(p_release_source, ''\) <> 'holder_undo'/);
	assert.match(sql, /from public\.workspace_membership_export_runs as e[\s\S]*where e\.id = p_export_id[\s\S]*and e\.organisation_id = p_organisation_id/);
	assert.match(sql, /v_checkout_export\.requested_by is distinct from v_actor_id/);
	assert.match(sql, /update public\.workspace_membership_export_runs as e[\s\S]*released_at = v_released_at[\s\S]*released_by = v_actor_id[\s\S]*release_source = p_release_source[\s\S]*release_reason = v_release_reason/);
	assert.match(sql, /where e\.id = p_export_id[\s\S]*and e\.organisation_id = p_organisation_id[\s\S]*and e\.requested_by = v_actor_id[\s\S]*and e\.released_at is null[\s\S]*and e\.superseded_at is null[\s\S]*and e\.status = 'checked_out'[\s\S]*and e\.editing_mode = 'checked_out'[\s\S]*and e\.checkout_expires_at > v_released_at/);
	assert.match(sql, /returning e\.\* into v_released_export/);
	assert.match(sql, /record_workspace_membership_audit_event\(\s*p_organisation_id,[\s\S]*v_actor_id,[\s\S]*'workspace_membership_csv_checkout_released',[\s\S]*'checked_out',[\s\S]*'released'/);
	assert.match(sql, /'previous_expiry', v_checkout_export\.checkout_expires_at/);
	assert.match(sql, /'release_source', v_released_export\.release_source/);
	assert.match(sql, /'release_reason', v_released_export\.release_reason/);
	assert.match(sql, /coalesce\(v_release_reason, 'Editable Workspace Team CSV checkout released by current holder\.'\)/);
	assert.match(sql, /grant execute on function public\.release_workspace_membership_csv_checkout\(uuid, uuid, text, text\) to authenticated, service_role/);
	assert.doesNotMatch(sql, /\brelease_reason text default null/);
	assert.doesNotMatch(sql, /\brelease_source text default 'holder_undo'/);
	assert.doesNotMatch(sql, /target_organisation_id|target_export_id/);
	assert.doesNotMatch(sql, /nullif\(btrim\(release_reason\)|coalesce\(released_export\.release_reason|actor\.actor_user_id|\bcheckout_export\.|\breleased_export\./);
	assert.doesNotMatch(sql, /where id =|and organisation_id =|and released_at is null|and superseded_at is null|and status = 'checked_out'|and editing_mode = 'checked_out'|and checkout_expires_at > now\(\)/);
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
	assert.match(endpoint, /normaliseWorkspaceTeamCsvExport\(data as WorkspaceTeamCsvExport\)/);
	assert.match(endpoint, /buildWorkspaceTeamCsv\(exportRun\)/);
	assert.match(endpoint, /unsafe snapshot version/);
	assert.match(endpoint, /content-type': 'text\/csv; charset=utf-8'/);
	assert.match(endpoint, /content-disposition': `attachment; filename="\$\{filename\}"`/);
	assert.match(endpoint, /x-watchtower-export-id/);
	assert.match(endpoint, /export const GET/);
	assert.doesNotMatch(endpoint, /auth\.users|service_role|\.from\('profiles'\)|\.insert\(|\.update\(|\.delete\(/);
});

test('CSV checkout release endpoint is POST-only scoped and delegates to the release RPC', async () => {
	const endpoint = await readFile(releaseEndpointUrl, 'utf8');
	const helper = await readFile(checkoutReleaseHelperUrl, 'utf8');
	const releaseCode = `${endpoint}\n${helper}`;

	assert.match(endpoint, /export const POST/);
	assert.match(endpoint, /export const GET/);
	assert.match(endpoint, /405/);
	assert.match(endpoint, /getServerAccessToken\(cookies\)/);
	assert.match(endpoint, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(endpoint, /workspace\.role !== 'owner' && workspace\.role !== 'admin'/);
	assert.match(endpoint, /request\.formData\(\)/);
	assert.match(endpoint, /serverSupabase\.auth\.getUser\(accessToken\)/);
	assert.match(endpoint, /\.select\('requested_by, export_mode, status, editing_mode, checkout_expires_at, superseded_at, released_at'\)/);
	assert.match(endpoint, /workspaceTeamCheckoutReleaseStateErrorCode/);
	assert.match(endpoint, /p_organisation_id: organisation\.id/);
	assert.match(endpoint, /p_export_id: exportId/);
	assert.match(endpoint, /p_release_reason: 'Current holder selected Undo from Team administration\.'/);
	assert.match(endpoint, /p_release_source: 'holder_undo'/);
	assert.doesNotMatch(endpoint, /target_organisation_id|target_export_id|\brelease_reason:|\brelease_source:/);
	assert.match(endpoint, /\.rpc\(WORKSPACE_TEAM_CHECKOUT_RELEASE_RPC/);
	assert.match(endpoint, /logWorkspaceTeamCheckoutReleaseFailure/);
	assert.match(endpoint, /workspaceTeamCheckoutReleaseErrorCode\(error, stateErrorCode\)/);
	assert.match(releaseCode, /workspace_team_checkout_release_failed/);
	for (const field of ['routeName', 'workspaceId', 'workspaceSlug', 'exportId', 'actorId', 'rpcName', 'code', 'message', 'details', 'hint']) {
		assert.match(releaseCode, new RegExp(field));
	}
	assert.doesNotMatch(helper, /cookie|token|contact_email|team_csv|csvText/i);
	assert.doesNotMatch(endpoint, /contact_email|team_csv|csvText/i);
	assert.match(endpoint, /303/);
	assert.match(endpoint, /checkout_release=success|checkout_release/);
	assert.doesNotMatch(endpoint, /auth\.users|service_role|\.from\('profiles'\)|\.from\('organisation_members'\)|\.from\('workspace_membership_change_decisions'\)|\.insert\(|\.update\(|\.delete\(/);
});

test('Workspace Team page displays checkout warning and confirmation dialog flows', async () => {
	const page = await readFile(pageUrl, 'utf8');

	assert.match(page, /data-active-editable-checkout/);
	assert.match(page, /data-workspace-team-export-open/);
	assert.match(page, /data-workspace-team-export-download-form/);
	assert.match(page, /normaliseWorkspaceTeamSnapshotVersion/);
	assert.match(page, /activeCheckoutSnapshotVersion/);
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
	assert.doesNotMatch(page, /auth_email|service_role|auth\.users/);
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
	for (const code of ['not_holder', 'already_released', 'expired', 'superseded', 'no_active_checkout', 'permission_denied', 'audit_failed', 'rpc_failed']) {
		assert.match(page, new RegExp(`${code}:`));
	}
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
