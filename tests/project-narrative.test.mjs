import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createProjectNarrativeEntry,
	getNarrativeDisplayRef,
	isNarrativeAttentionLevel,
	isNarrativeSourceType,
	listProjectNarrativeEntries,
	normaliseProjectNarrativeLinks,
	normaliseProjectNarrativeLinkUrl,
	NARRATIVE_ATTENTION_LEVELS,
	NARRATIVE_SOURCE_TYPES,
} from '../src/lib/projectNarrative.ts';
import { can } from '../src/lib/permissions.ts';

const migrationPath = new URL(
	'../supabase/migrations/20260624000400_project_narrative_schema_foundation.sql',
	import.meta.url,
);
const migrationSql = async () => readFile(migrationPath, 'utf8');
const linksMigrationPath = new URL(
	'../supabase/migrations/20260625000100_project_narrative_entry_links.sql',
	import.meta.url,
);
const linksMigrationSql = async () => readFile(linksMigrationPath, 'utf8');

test('Project Narrative migration creates the structured project-scoped record', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create table public\.project_narrative_entries \(/);
	for (const field of [
		'id uuid primary key default gen_random_uuid()',
		'organisation_id uuid not null',
		'project_id uuid not null',
		'entry_number integer not null',
		'narrative_ref text not null',
		"source_type text not null default 'manual'",
		'source_record_id uuid',
		'source_ref text',
		"attention_level text not null default 'neutral'",
		'title text',
		'details text',
		'created_by uuid not null',
		'updated_by uuid',
		'created_at timestamptz not null default now()',
		'updated_at timestamptz not null default now()',
		'created_timezone text',
		'updated_timezone text',
	]) {
		assert.ok(sql.includes(field), `Expected migration to contain ${field}`);
	}
	assert.match(sql, /foreign key \(project_id, organisation_id\)[\s\S]*references public\.projects\(id, organisation_id\)/);
});

test('entry numbers and narrative references are generated safely per project', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create or replace function public\.prepare_project_narrative_entry_insert\(\)/);
	assert.match(sql, /create table public\.project_narrative_counters \(/);
	assert.match(sql, /project_id uuid primary key/);
	assert.match(sql, /insert into public\.project_narrative_counters \(project_id, organisation_id, last_entry_number\)/);
	assert.match(sql, /on conflict \(project_id\) do update/);
	assert.match(sql, /last_entry_number = project_narrative_counters\.last_entry_number \+ 1/);
	assert.match(sql, /returning last_entry_number[\s\S]*into new\.entry_number/);
	assert.match(sql, /prevents reference reuse after entry deletion/);
	assert.match(sql, /'NAR-%s-%s'/);
	assert.match(sql, /lpad\(new\.entry_number::text, 3, '0'\)/);
	assert.match(sql, /unique \(project_id, entry_number\)/);
	assert.match(sql, /unique \(project_id, narrative_ref\)/);
});

test('narrative identity and project scope cannot be changed after creation', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create or replace function public\.prevent_project_narrative_entry_identity_update\(\)/);
	for (const identity of ['organisation_id', 'project_id', 'entry_number', 'narrative_ref', 'created_by', 'created_at']) {
		assert.match(sql, new RegExp(`old\\.${identity} is distinct from new\\.${identity}`));
	}
	assert.match(sql, /before update on public\.project_narrative_entries/);
	assert.doesNotMatch(
		sql,
		/grant update \([\s\S]*?(?:entry_number|narrative_ref|organisation_id|project_id|created_by|created_at)[\s\S]*?\) on public\.project_narrative_entries/,
	);
});

test('source and attention types cover manual and future RAID-linked entries', async () => {
	const sql = await migrationSql();
	assert.deepEqual(NARRATIVE_SOURCE_TYPES, ['manual', 'risk', 'issue', 'dependency', 'assumption', 'system']);
	assert.deepEqual(NARRATIVE_ATTENTION_LEVELS, ['neutral', 'green', 'amber', 'red']);
	assert.match(sql, /source_type in \('manual', 'risk', 'issue', 'dependency', 'assumption', 'system'\)/);
	assert.match(sql, /attention_level in \('neutral', 'green', 'amber', 'red'\)/);
	assert.equal(isNarrativeSourceType('manual'), true);
	assert.equal(isNarrativeSourceType('decision'), false);
	assert.equal(isNarrativeAttentionLevel('neutral'), true);
	assert.equal(isNarrativeAttentionLevel('blue'), false);
});

test('UTC-compatible timestamps and optional IANA timezone context are enforced', async () => {
	const sql = await migrationSql();
	assert.match(sql, /created_at timestamptz not null default now\(\)/);
	assert.match(sql, /updated_at timestamptz not null default now\(\)/);
	assert.match(sql, /from pg_catalog\.pg_timezone_names/);
	assert.match(sql, /name = 'UTC' or position\('\/' in name\) > 0/);
	assert.match(sql, /created_timezone is null or public\.is_valid_iana_timezone\(created_timezone\)/);
	assert.match(sql, /updated_timezone is null or public\.is_valid_iana_timezone\(updated_timezone\)/);
});

test('RLS permits active workspace readers and excludes viewers from mutations', async () => {
	const sql = await migrationSql();
	assert.match(sql, /alter table public\.project_narrative_entries enable row level security/);
	assert.match(sql, /alter table public\.project_narrative_counters enable row level security/);
	assert.doesNotMatch(sql, /grant (?:select|insert|update|delete)[^;]*project_narrative_counters to authenticated/);
	assert.match(sql, /is_active_organisation_member\(project_narrative_entries\.organisation_id\)/);
	for (const operation of ['create', 'update', 'delete']) {
		assert.match(sql, new RegExp(`Owners admins and members can ${operation} project narrative entries`));
	}
	assert.match(sql, /array\['owner', 'admin', 'member'\]/);
	assert.doesNotMatch(sql, /array\['owner', 'admin', 'member', 'viewer'\]/);

	for (const role of ['owner', 'admin', 'member']) {
		for (const permission of ['narrative.view', 'narrative.create', 'narrative.edit', 'narrative.delete']) {
			assert.equal(can(role, permission), true);
		}
	}
	assert.equal(can('viewer', 'narrative.view'), true);
	assert.equal(can('viewer', 'narrative.create'), false);
	assert.equal(can('viewer', 'narrative.edit'), false);
	assert.equal(can('viewer', 'narrative.delete'), false);
});

test('Project Narrative link migration creates scoped structured hyperlinks with read/create RLS', async () => {
	const sql = await linksMigrationSql();
	assert.match(sql, /create table public\.project_narrative_entry_links \(/);
	for (const field of [
		'id uuid primary key default gen_random_uuid()',
		'organisation_id uuid not null references public.organisations(id) on delete cascade',
		'project_id uuid not null references public.projects(id) on delete cascade',
		'narrative_entry_id uuid not null references public.project_narrative_entries(id) on delete cascade',
		'label text not null',
		'url text not null',
		'created_by uuid not null references public.profiles(id) on delete restrict',
		'created_at timestamptz not null default now()',
	]) {
		assert.ok(sql.includes(field), `Expected links migration to contain ${field}`);
	}
	assert.match(sql, /unique \(id, project_id, organisation_id\)/);
	assert.match(sql, /foreign key \(narrative_entry_id, project_id, organisation_id\)[\s\S]*references public\.project_narrative_entries\(id, project_id, organisation_id\)/);
	assert.match(sql, /project_narrative_entry_links_label_not_empty_check/);
	assert.match(sql, /project_narrative_entry_links_url_not_empty_check/);
	assert.match(sql, /project_narrative_entry_links_safe_url_check[\s\S]*url ~\* '\^https\?:\/\//);
	assert.match(sql, /alter table public\.project_narrative_entry_links enable row level security/);
	assert.match(sql, /Active members can read project narrative entry links/);
	assert.match(sql, /Owners admins and members can create project narrative entry links/);
	assert.match(sql, /is_active_organisation_member\(project_narrative_entry_links\.organisation_id\)/);
	assert.match(sql, /has_active_organisation_role\(\s*project_narrative_entry_links\.organisation_id,\s*array\['owner', 'admin', 'member'\]/);
	assert.doesNotMatch(sql, /array\['owner', 'admin', 'member', 'viewer'\]/);
	assert.doesNotMatch(sql, /for update|for delete/i);
});

test('data access defaults manual entries to neutral and leaves source metadata optional', async () => {
	let insertedPayload;
	const result = {
		id: 'entry-id',
		entry_number: 1,
		narrative_ref: 'NAR-HHH-001',
		source_type: 'manual',
		attention_level: 'neutral',
	};
	const client = {
		from(table) {
			assert.equal(table, 'project_narrative_entries');
			return {
				insert(payload) {
					insertedPayload = payload;
					return {
						select() {
							return { single: async () => ({ data: result, error: null }) };
						},
					};
				},
			};
		},
	};

	const entry = await createProjectNarrativeEntry(
		{ projectId: 'project-id', title: 'Mobilisation complete', details: 'Project mobilisation completed.' },
		'member',
		client,
	);
	assert.deepEqual(entry, { ...result, links: [] });
	assert.deepEqual(insertedPayload, {
		project_id: 'project-id',
		source_type: 'manual',
		source_record_id: null,
		source_ref: null,
		attention_level: 'neutral',
		title: 'Mobilisation complete',
		details: 'Project mobilisation completed.',
		created_timezone: null,
	});
});

test('data access preserves future source UUID and display reference metadata', async () => {
	let insertedPayload;
	const client = {
		from() {
			return {
				insert(payload) {
					insertedPayload = payload;
					return {
						select() {
							return { single: async () => ({ data: payload, error: null }) };
						},
					};
				},
			};
		},
	};

	await createProjectNarrativeEntry(
		{
			projectId: 'project-id',
			sourceType: 'risk',
			sourceRecordId: '9ae15cbc-2c1d-4701-8717-e8dab84ff9ea',
			sourceRef: ' Risk-HHH-003 ',
			attentionLevel: 'red',
			title: 'Risk escalated',
			details: 'The delivery risk has moved to urgent attention.',
		},
		'owner',
		client,
	);

	assert.equal(insertedPayload.source_type, 'risk');
	assert.equal(insertedPayload.source_record_id, '9ae15cbc-2c1d-4701-8717-e8dab84ff9ea');
	assert.equal(insertedPayload.source_ref, 'Risk-HHH-003');
	assert.equal(insertedPayload.attention_level, 'red');
});

test('data access saves validated links against the created narrative entry scope', async () => {
	const calls = [];
	const entryResult = {
		id: 'entry-id',
		organisation_id: 'workspace-id',
		project_id: 'project-id',
		narrative_ref: 'NAR-HHH-001',
		source_type: 'manual',
		attention_level: 'green',
	};
	const linkResult = [{
		id: 'link-id',
		organisation_id: 'workspace-id',
		project_id: 'project-id',
		narrative_entry_id: 'entry-id',
		label: 'Steering note',
		url: 'https://example.com/steering',
	}];
	const client = {
		from(table) {
			return {
				insert(payload) {
					calls.push(['insert', table, payload]);
					return {
						select() {
							if (table === 'project_narrative_entries') {
								return { single: async () => ({ data: entryResult, error: null }) };
							}
							return Promise.resolve({ data: linkResult, error: null });
						},
					};
				},
			};
		},
	};

	const entry = await createProjectNarrativeEntry(
		{
			projectId: 'project-id',
			title: 'Steering outcome',
			details: 'The steering group approved the revised delivery approach.',
			attentionLevel: 'green',
			links: [{ label: ' Steering note ', url: 'https://example.com/steering' }],
		},
		'admin',
		client,
	);

	assert.deepEqual(entry.links, linkResult);
	assert.deepEqual(calls[1], ['insert', 'project_narrative_entry_links', [{
		organisation_id: 'workspace-id',
		project_id: 'project-id',
		narrative_entry_id: 'entry-id',
		label: 'Steering note',
		url: 'https://example.com/steering',
	}]]);
});

test('narrative list stays workspace and project scoped and sorts newest first', async () => {
	const calls = [];
	const query = {
		select(columns) {
			calls.push(['select', columns]);
			return this;
		},
		eq(column, value) {
			calls.push(['eq', column, value]);
			return this;
		},
		order(column, options) {
			calls.push(['order', column, options]);
			if (calls.filter(([name]) => name === 'order').length === 2) {
				return Promise.resolve({ data: [{ narrative_ref: 'NAR-HHH-002' }], error: null });
			}
			return this;
		},
	};
	const client = { from: (table) => (calls.push(['from', table]), query) };

	const result = await listProjectNarrativeEntries('workspace-id', 'project-id', 'viewer', client);
	assert.deepEqual(result, [{ narrative_ref: 'NAR-HHH-002' }]);
	assert.deepEqual(calls.filter(([name]) => name === 'eq'), [
		['eq', 'organisation_id', 'workspace-id'],
		['eq', 'project_id', 'project-id'],
	]);
	assert.deepEqual(calls.filter(([name]) => name === 'order'), [
		['order', 'created_at', { ascending: false }],
		['order', 'entry_number', { ascending: false }],
	]);
});

test('display reference prefers a source reference and otherwise uses the Narrative reference', () => {
	assert.equal(getNarrativeDisplayRef({ source_ref: 'Risk-HHH-003', narrative_ref: 'NAR-HHH-007' }), 'Risk-HHH-003');
	assert.equal(getNarrativeDisplayRef({ source_ref: null, narrative_ref: 'NAR-HHH-007' }), 'NAR-HHH-007');
	assert.equal(getNarrativeDisplayRef({ source_ref: '   ', narrative_ref: 'NAR-HHH-007' }), 'NAR-HHH-007');
});

test('viewer writes and invalid narrative values are rejected before data access', async () => {
	const unusedClient = { from: () => assert.fail('Client should not be called') };
	await assert.rejects(
		createProjectNarrativeEntry({ projectId: 'project-id', title: 'No write', details: 'No write.' }, 'viewer', unusedClient),
		/does not permit Project Narrative entry creation/,
	);
	await assert.rejects(
		createProjectNarrativeEntry(
			{ projectId: 'project-id', title: 'Invalid', details: 'Invalid', attentionLevel: 'blue' },
			'member',
			unusedClient,
		),
		/valid Project Narrative attention level/,
	);
	await assert.rejects(
		createProjectNarrativeEntry({ projectId: 'project-id', title: ' ', details: ' ' }, 'member', unusedClient),
		/Title is required/,
	);
	await assert.rejects(
		createProjectNarrativeEntry({ projectId: 'project-id', title: 'Title only', details: ' ' }, 'member', unusedClient),
		/Details are required/,
	);
});

test('Project Narrative link validation accepts only complete safe http or https links', () => {
	assert.equal(normaliseProjectNarrativeLinkUrl(' https://example.com/evidence '), 'https://example.com/evidence');
	assert.deepEqual(normaliseProjectNarrativeLinks([{ label: ' Evidence ', url: 'http://example.com' }]), [{
		label: 'Evidence',
		url: 'http://example.com/',
	}]);
	assert.throws(() => normaliseProjectNarrativeLinks([{ label: '', url: 'https://example.com' }]), /Link label is required/);
	assert.throws(() => normaliseProjectNarrativeLinks([{ label: 'Evidence', url: '' }]), /Link URL is required/);
	assert.throws(() => normaliseProjectNarrativeLinks([{ label: 'Evidence', url: 'notaurl' }]), /valid link URL/);
	assert.throws(() => normaliseProjectNarrativeLinks([{ label: 'Evidence', url: 'javascript:alert(1)' }]), /safe link URL/);
});

test('Project Narrative page provides manual creation and read-only detail modal behaviour', async () => {
	const page = await readFile(
		new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/narrative.astro', import.meta.url),
		'utf8',
	);
	assert.match(page, /data-project-narrative-route/);
	assert.match(page, /<h1 id="project-narrative-heading">Project Narrative<\/h1>/);
	assert.match(page, /A project-level timeline of key events, updates and decisions\./);
	assert.match(page, />Create Project Narrative Entry<\/button>/);
	assert.match(page, /data-open-create-narrative/);
	assert.match(page, /data-create-narrative-modal/);
	assert.match(page, /data-create-narrative-form/);
	assert.match(page, /name="title"[\s\S]*?required/);
	assert.match(page, /name="attention_level"[\s\S]*?value=\{level\}[\s\S]*?required/);
	assert.match(page, /name="details"[\s\S]*?required/);
	assert.match(page, /name="link_label"/);
	assert.match(page, /name="link_url"/);
	assert.match(page, /Link label is required when adding a link/);
	assert.match(page, /normaliseProjectNarrativeLinkUrl\(link\.url\)/);
	assert.match(page, /createProjectNarrativeEntry\(/);
	assert.match(page, /data-detail-modal/);
	assert.match(page, /data-entry-id=\{entry\.id\}/);
	assert.match(page, /data-detail-narrative-ref/);
	assert.match(page, /data-detail-source-type/);
	assert.match(page, /data-detail-links/);
	assert.match(page, /showModal\(\)/);
	assert.match(page, /detailModal\?\.addEventListener\('close'/);
	assert.match(page, /class="narrative-filters"/);
	for (const label of ['Entry/source type', 'Attention', 'Date range', 'Source']) {
		assert.match(page, new RegExp(`<label>${label}`));
	}
	assert.match(page, /<tr><th scope="col">Ref<\/th><th scope="col">Attention<\/th><th scope="col">Details<\/th><th scope="col">Created by<\/th><th scope="col">Created<\/th><\/tr>/);
	assert.doesNotMatch(page, /<th[^>]*>Type<\/th>|<th[^>]*>(?:Entry|Row) number<\/th>/i);
	assert.match(page, /getNarrativeDisplayRef\(entry\)/);
	assert.doesNotMatch(page, /class="narrative-ref"[\s\S]*?aria-disabled="true"/);
	assert.match(page, /No narrative entries yet\./);
	assert.match(page, /Project Narrative will show key project events, manual updates and future RAID-linked activity in one assurance timeline\./);
	assert.match(page, /can\(workspace\.role, 'narrative\.view'\)/);
	assert.match(page, /can\(workspaceRole, 'narrative\.create'\)/);
	assert.match(page, /listProjectNarrativeEntries\(organisation\.id, data\.id, workspace\.role, serverSupabase\)/);
	assert.match(page, /loadFeatureAccess\(serverSupabase, 'projectDiary', accessToken\)/);
	assert.doesNotMatch(page, /from\('project_(?:risks|issues|dependencies|assumptions)'\)/);
});

test('Project Narrative foundation does not add RAID integration, export, notifications or AI', async () => {
	const sql = await migrationSql();
	for (const excludedTable of [
		'project_issues',
		'project_dependencies',
		'project_assumptions',
		'notification_events',
		'email_notifications',
		'narrative_exports',
		'ai_narrative_summaries',
	]) {
		assert.doesNotMatch(sql, new RegExp(`create\\s+table\\s+(public\\.)?${excludedTable}\\b`, 'i'));
	}
	const page = await readFile(
		new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/narrative.astro', import.meta.url),
		'utf8',
	);
	assert.doesNotMatch(page, /CSV|notification|digest|browser badge|favicon count|AI summar|AI analys/i);
});
