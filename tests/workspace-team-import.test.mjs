import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildWorkspaceTeamCsv } from '../src/lib/workspaceTeamCsv.ts';
import {
	WORKSPACE_TEAM_IMPORT_MAX_FILE_BYTES,
	decodeWorkspaceTeamCsvBytes,
	extractWorkspaceTeamCsvMetadata,
	parseWorkspaceTeamCsvText,
	sha256HexFromWorkspaceTeamBytes,
	validateWorkspaceTeamCsvImport,
	workspaceTeamBytesFromArrayBuffer,
	workspaceTeamUtf8ByteLength,
} from '../src/lib/workspaceTeamCsvImport.ts';
import { buildWorkspaceTeamImportPath } from '../src/lib/projectRoutes.ts';

const migrationUrl = new URL('../supabase/migrations/20260722000400_workspace_membership_csv_import_validation.sql', import.meta.url);
const importModuleUrl = new URL('../src/lib/workspaceTeamCsvImport.ts', import.meta.url);
const permissionsModuleUrl = new URL('../src/lib/permissions.ts', import.meta.url);
const csvExportModuleUrl = new URL('../src/lib/workspaceTeamCsv.ts', import.meta.url);
const routeUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/import.ts', import.meta.url);
const pageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const EXPORT_ID = '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const DEACTIVATED_MEMBERSHIP_ID = '55555555-5555-4555-8555-555555555555';
const DEACTIVATED_USER_ID = '66666666-6666-4666-8666-666666666666';

function sourceExport(overrides = {}) {
	return {
		id: EXPORT_ID,
		organisation_id: ORG_ID,
		export_mode: 'editable',
		status: 'checked_out',
		exported_at: '2026-07-22T09:42:30.000Z',
		membership_snapshot_version: 12345,
		checkout_expires_at: '2026-07-23T09:42:30.000Z',
		superseded_at: null,
		...overrides,
	};
}

function sourceRows() {
	return [
		{
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
		},
		{
			source_row_number: 2,
			workspace_membership_id: DEACTIVATED_MEMBERSHIP_ID,
			user_id: DEACTIVATED_USER_ID,
			login_name: 'former.member',
			first_name: 'Former',
			last_name: 'Member',
			email: 'former@example.com',
			workspace_role: 'viewer',
			membership_status: 'deactivated',
			added_at: '2026-07-02T00:00:00.000Z',
			deactivated_at: '2026-07-10T00:00:00.000Z',
		},
	];
}

function liveRows() {
	return sourceRows();
}

function csv(rows, overrides = {}) {
	return buildWorkspaceTeamCsv({
		export_id: EXPORT_ID,
		membership_snapshot_version: 12345,
		exported_at: '2026-07-22T09:42:30.000Z',
		export_mode: 'editable',
		rows,
		...overrides,
	});
}

function validate(csvText, context = {}) {
	return validateWorkspaceTeamCsvImport(csvText, {
		organisationId: ORG_ID,
		sourceExport: sourceExport(),
		sourceRows: sourceRows(),
		liveRows: liveRows(),
		liveSnapshotVersion: 12345,
		now: new Date('2026-07-22T12:00:00.000Z'),
		...context,
	});
}

test('Workspace Team import path and CSV contract include explicit reactivation action', () => {
	assert.equal(buildWorkspaceTeamImportPath('alpha workspace'), '/app/workspaces/alpha%20workspace/team/import');
	const text = csv([{ ...sourceRows()[0], proposed_membership_action: '' }]);
	assert.match(text.split(/\r\n/)[0], /proposed_membership_action$/);
	assert.equal(extractWorkspaceTeamCsvMetadata(text).exportId, EXPORT_ID);
});

test('Workspace Team import module stays Cloudflare-compatible without Buffer references', async () => {
	const sources = await Promise.all([
		readFile(importModuleUrl, 'utf8'),
		readFile(permissionsModuleUrl, 'utf8'),
		readFile(csvExportModuleUrl, 'utf8'),
		readFile(routeUrl, 'utf8'),
		readFile(pageUrl, 'utf8'),
	]);
	const combinedSource = sources.join('\n');

	assert.doesNotMatch(combinedSource, /\bBuffer\b|node:buffer|require\(['"]buffer['"]\)/);
	assert.doesNotMatch(sources[0], /csv-parse/);
	assert.match(pageUrl.pathname, /team\.astro$/);
	assert.match(sources[4], /WORKSPACE_TEAM_IMPORT_MAX_FILE_BYTES/);
});

test('Workspace Team import byte text and hash helpers use Web Platform data types', async () => {
	const unicodeText = 'A£😀東京';
	const bytes = new TextEncoder().encode(unicodeText);
	const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

	assert.equal(workspaceTeamUtf8ByteLength('A£😀'), 7);
	assert.equal(workspaceTeamUtf8ByteLength(unicodeText), bytes.byteLength);
	assert.deepEqual([...workspaceTeamBytesFromArrayBuffer(arrayBuffer)], [...bytes]);
	assert.equal(decodeWorkspaceTeamCsvBytes(arrayBuffer), unicodeText);
	assert.equal(decodeWorkspaceTeamCsvBytes(bytes), unicodeText);
	assert.equal(
		await sha256HexFromWorkspaceTeamBytes(arrayBuffer),
		await sha256HexFromWorkspaceTeamBytes(bytes),
	);
	assert.equal(
		await sha256HexFromWorkspaceTeamBytes(new TextEncoder().encode('abc')),
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
	);
	assert.throws(
		() => decodeWorkspaceTeamCsvBytes(new Uint8Array([0xff, 0xfe, 0xfd])),
		TypeError,
	);
});

test('Workspace Team import parser supports BOM commas quotes newlines unicode blanks and formula reversal', () => {
	const source = sourceRows();
	source[0].first_name = '=Mark';
	const text = csv([
		{
			...source[0],
			first_name: '=Mark',
			last_name: 'Nesbit, "Senior"\nLine',
			email: ' Mark@Example.com ',
			proposed_membership_action: '',
		},
	], { rows: [{ ...source[0], first_name: '=Mark', last_name: 'Nesbit, "Senior"\nLine', email: ' Mark@Example.com ' }] });
	const result = validate(text, { sourceRows: source, liveRows: [{ ...source[0], first_name: '=Mark' }] });
	const row = result.rows[0];
	assert.equal(row.normalised_values.first_name, '=Mark');
	assert.equal(row.normalised_values.email, 'mark@example.com');
	assert.equal(row.formula_safety.first_name.reversed, true);
	assert.match(row.raw_values.last_name, /Senior/);
});

test('Workspace Team import parser preserves existing CSV behaviour without Node parser imports', () => {
	const parsed = parseWorkspaceTeamCsvText('\uFEFFname,note\r\n"A, B","Line 1\nLine ""2"""\r\n,\r\n');

	assert.deepEqual(parsed.header, ['name', 'note']);
	assert.deepEqual(parsed.rows, [['A, B', 'Line 1\nLine "2"'], ['', '']]);
	assert.deepEqual(parsed.errors, []);

	const malformed = parseWorkspaceTeamCsvText('name,note\n"unterminated,value\n');
	assert.deepEqual(malformed.header, []);
	assert.match(malformed.errors[0].message, /CSV could not be parsed/);
});

test('Workspace Team page can import CSV limits without upload-time byte handling', async () => {
	const page = await readFile(pageUrl, 'utf8');

	assert.match(page, /import \{ WORKSPACE_TEAM_IMPORT_MAX_FILE_BYTES \} from '..\/..\/..\/..\/lib\/workspaceTeamCsvImport'/);
	assert.doesNotMatch(page, /decodeWorkspaceTeamCsvBytes|sha256HexFromWorkspaceTeamBytes|arrayBuffer\(/);
});

test('Workspace Team import route decodes ArrayBuffer bytes and hashes with Web Crypto helpers', async () => {
	const route = await readFile(routeUrl, 'utf8');

	assert.match(route, /uploadedFile\.arrayBuffer\(\)/);
	assert.match(route, /decodeWorkspaceTeamCsvBytes\(fileBytes\)/);
	assert.match(route, /sha256HexFromWorkspaceTeamBytes\(fileBytes\)/);
	assert.doesNotMatch(route, /TextDecoder\(|crypto\.subtle\.digest\(|\bBuffer\b|node:buffer|require\(['"]buffer['"]\)/);
});

test('Workspace Team import validates additions corrections deactivations and explicit reactivations without mutation', () => {
	const rows = [
		{ ...sourceRows()[0], first_name: 'Marcus', email: 'marcus@example.com' },
		{
			workspace_membership_id: DEACTIVATED_MEMBERSHIP_ID,
			user_id: DEACTIVATED_USER_ID,
			login_name: 'former.member',
			first_name: 'Former',
			last_name: 'Member',
			email: 'former@example.com',
			workspace_role: 'viewer',
			membership_status: 'deactivated',
			added_at: '2026-07-02T00:00:00.000Z',
			deactivated_at: '2026-07-10T00:00:00.000Z',
			proposed_membership_action: 'reactivate',
		},
		{ first_name: 'New', last_name: 'Person', email: 'new@example.com', workspace_role: '' },
	];
	const result = validate(csv(rows));
	assert.equal(result.status, 'validated');
	assert.equal(result.summary.identity_corrections, 1);
	assert.equal(result.summary.name_corrections, 1);
	assert.equal(result.summary.email_corrections, 1);
	assert.equal(result.summary.reactivations, 1);
	assert.equal(result.summary.additions, 1);
	assert.equal(result.rows.find((row) => row.proposed_change_type === 'addition')?.proposed_values.workspace_role, 'viewer');
});

test('Workspace Team import proposes deactivation only when a structurally valid retained row is absent', () => {
	const result = validate(csv([{ ...sourceRows()[0] }]));
	assert.equal(result.status, 'validated');
	assert.equal(result.summary.deactivations, 0, 'already deactivated source rows are not duplicated');

	const activeOnlySource = [sourceRows()[0]];
	const missingActive = validate(csv([], { rows: [] }), { sourceRows: activeOnlySource, liveRows: activeOnlySource });
	assert.equal(missingActive.status, 'validation_failed');
	assert.equal(missingActive.summary.deactivations, 0, 'empty files do not generate mass deactivations');
});

test('Workspace Team import rejects read-only released superseded and stale states distinctly', () => {
	const readOnly = validate(csv([{ ...sourceRows()[0] }], { export_mode: 'read_only' }), {
		sourceExport: sourceExport({ export_mode: 'read_only' }),
	});
	assert.equal(readOnly.status, 'validation_failed');
	assert.match(readOnly.fileErrors.map((entry) => entry.message).join(' '), /Read-only/);

	const released = validate(csv([{ ...sourceRows()[0] }]), {
		sourceExport: sourceExport({ status: 'released', released_at: '2026-07-22T10:30:00.000Z', release_source: 'holder_undo' }),
	});
	assert.equal(released.status, 'validation_failed');
	assert.match(released.fileErrors.map((entry) => entry.message).join(' '), /released by its holder/);

	const superseded = validate(csv([{ ...sourceRows()[0] }]), {
		sourceExport: sourceExport({ status: 'superseded', superseded_at: '2026-07-22T10:00:00.000Z' }),
	});
	assert.equal(superseded.status, 'superseded');
	assert.equal(superseded.sourceSuperseded, true);

	const stale = validate(csv([{ ...sourceRows()[0] }, { ...sourceRows()[1] }]), {
		liveSnapshotVersion: 99999,
	});
	assert.equal(stale.status, 'stale_review_required');
	assert.equal(stale.sourceStale, true);

	const expired = validate(csv([{ ...sourceRows()[0] }, { ...sourceRows()[1] }]), {
		sourceExport: sourceExport({ checkout_expires_at: '2026-07-21T00:00:00.000Z' }),
	});
	assert.equal(expired.checkoutExpired, true);
	assert.equal(expired.status, 'validated');
});

test('Workspace Team import rejects structural header metadata identity role and status problems', () => {
	const missingHeader = validate('export_id,email\n' + `${EXPORT_ID},a@example.com\n`);
	assert.equal(missingHeader.status, 'validation_failed');
	assert.match(missingHeader.fileErrors.map((entry) => entry.message).join(' '), /Required CSV column/);

	const duplicateHeader = validate(`\uFEFFexport_id,export_id\n${EXPORT_ID},${EXPORT_ID}\n`);
	assert.match(duplicateHeader.fileErrors.map((entry) => entry.message).join(' '), /Duplicate CSV column/);

	const alteredRole = validate(csv([{ ...sourceRows()[0], workspace_role: 'viewer' }]));
	assert.equal(alteredRole.rows[0].validation_state, 'error');
	assert.match(alteredRole.rows[0].validation_messages.map((entry) => entry.message).join(' '), /workspace_role is protected/);

	const invalidNewRole = validate(csv([{ first_name: 'New', last_name: 'Person', email: 'new@example.com', workspace_role: 'superuser' }]));
	assert.equal(invalidNewRole.rows[0].validation_state, 'error');
});

test('Workspace Team import detects duplicate UUID and contact email rules without using email identity', () => {
	const duplicateUuid = validate(csv([{ ...sourceRows()[0] }, { ...sourceRows()[0] }]));
	assert.equal(duplicateUuid.status, 'validation_failed');
	assert.match(duplicateUuid.rows.flatMap((row) => row.validation_messages).map((entry) => entry.message).join(' '), /Duplicate membership UUID/);

	const duplicateEmail = validate(csv([
		{ ...sourceRows()[0] },
		{ first_name: 'New', last_name: 'Person', email: 'mark@example.com' },
	]));
	assert.equal(duplicateEmail.status, 'validation_failed');
	assert.match(duplicateEmail.rows.flatMap((row) => row.validation_messages).map((entry) => entry.message).join(' '), /Duplicate contact email/);

	const internalShared = validate(csv([
		{ first_name: 'New', last_name: 'One', email: 'shared@example.com' },
		{ first_name: 'New', last_name: 'Two', email: 'shared@example.com' },
	]), { allowSharedContactEmail: true });
	assert.equal(internalShared.summary.additions, 2);
	assert.equal(internalShared.summary.invalid_rows, 0);
});

test('Workspace Team import migration completes evidence schema RLS grants and audit events', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	for (const field of ['original_filename', 'file_size_bytes', 'file_hash', 'live_snapshot_version', 'checkout_expired', 'source_stale', 'source_superseded', 'validation_summary']) {
		assert.match(sql, new RegExp(`add column if not exists ${field}`));
	}
	for (const field of ['supplied_user_id', 'raw_values', 'normalised_values', 'source_export_values', 'live_values', 'field_differences', 'formula_safety']) {
		assert.match(sql, new RegExp(`add column if not exists ${field}`));
	}
	assert.match(sql, /'membership_import_uploaded'/);
	assert.match(sql, /'membership_import_validation_failed'/);
	assert.match(sql, /'membership_import_validated'/);
	assert.match(sql, /'membership_import_stale_detected'/);
	assert.match(sql, /'membership_import_superseded_rejected'/);
	assert.match(sql, /create or replace function public\.record_workspace_membership_import_validation/);
	assert.match(sql, /workspace_membership_require_admin_actor\(target_organisation_id\)/);
	assert.match(sql, /revoke insert, update on public\.workspace_membership_import_runs from authenticated/);
	assert.match(sql, /grant execute on function public\.record_workspace_membership_import_validation/);
	assert.match(sql, /It never mutates profiles, auth users or memberships/);
});

test('Workspace Team import route is POST-only scoped and does not mutate membership data', async () => {
	const route = await readFile(routeUrl, 'utf8');

	assert.match(route, /export const POST/);
	assert.match(route, /export const GET/);
	assert.match(route, /getServerAccessToken\(cookies\)/);
	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(route, /workspace\.role !== 'owner' && workspace\.role !== 'admin'/);
	assert.match(route, /request\.formData\(\)/);
	assert.match(route, /WORKSPACE_TEAM_IMPORT_MAX_FILE_BYTES/);
	assert.match(route, /decodeWorkspaceTeamCsvBytes\(fileBytes\)/);
	assert.match(route, /sha256HexFromWorkspaceTeamBytes\(fileBytes\)/);
	assert.match(route, /released_at, released_by, release_source/);
	assert.match(route, /\.rpc\('record_workspace_membership_import_validation'/);
	assert.doesNotMatch(route, /auth\.admin|auth\.users|\.from\('profiles'\)\.update|\.from\('organisation_members'\)\.update|\.delete\(/);
});

test('Workspace Team page exposes upload validation UI results and no apply controls', async () => {
	const page = await readFile(pageUrl, 'utf8');
	const docs = await readFile(docsUrl, 'utf8');

	assert.match(page, /Upload amended team CSV/);
	assert.match(page, /data-workspace-team-import-open/);
	assert.match(page, /enctype="multipart\/form-data"/);
	assert.match(page, /name="team_csv"/);
	assert.match(page, /Upload and validate/);
	assert.match(page, /data-workspace-team-import-result/);
	assert.match(page, /Proposed additions/);
	assert.match(page, /Invalid rows/);
	assert.match(page, /No changes are applied/);
	assert.match(page, /Review proposed changes/);
	assert.doesNotMatch(page, /Apply changes|Send invitation/);
	assert.match(docs, /Workers-compatible CSV parser/);
	assert.match(docs, /rejects a released file with a clear message to download a new editable export/);
	assert.match(docs, /does not approve or apply changes/);
	assert.ok(WORKSPACE_TEAM_IMPORT_MAX_FILE_BYTES <= 1024 * 1024);
});
