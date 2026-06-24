import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createProjectNarrativeEntry,
	isNarrativeAttentionLevel,
	isNarrativeSourceType,
	NARRATIVE_ATTENTION_LEVELS,
	NARRATIVE_SOURCE_TYPES,
} from '../src/lib/projectNarrative.ts';
import { can } from '../src/lib/permissions.ts';

const migrationPath = new URL(
	'../supabase/migrations/20260624000400_project_narrative_schema_foundation.sql',
	import.meta.url,
);
const migrationSql = async () => readFile(migrationPath, 'utf8');

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
		{ projectId: 'project-id', details: 'Project mobilisation completed.' },
		'member',
		client,
	);
	assert.equal(entry, result);
	assert.deepEqual(insertedPayload, {
		project_id: 'project-id',
		source_type: 'manual',
		source_record_id: null,
		source_ref: null,
		attention_level: 'neutral',
		title: null,
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
		},
		'owner',
		client,
	);

	assert.equal(insertedPayload.source_type, 'risk');
	assert.equal(insertedPayload.source_record_id, '9ae15cbc-2c1d-4701-8717-e8dab84ff9ea');
	assert.equal(insertedPayload.source_ref, 'Risk-HHH-003');
	assert.equal(insertedPayload.attention_level, 'red');
});

test('viewer writes and invalid narrative values are rejected before data access', async () => {
	const unusedClient = { from: () => assert.fail('Client should not be called') };
	await assert.rejects(
		createProjectNarrativeEntry({ projectId: 'project-id', details: 'No write.' }, 'viewer', unusedClient),
		/does not permit Project Narrative entry creation/,
	);
	await assert.rejects(
		createProjectNarrativeEntry(
			{ projectId: 'project-id', details: 'Invalid', attentionLevel: 'blue' },
			'member',
			unusedClient,
		),
		/valid Project Narrative attention level/,
	);
	await assert.rejects(
		createProjectNarrativeEntry({ projectId: 'project-id', title: ' ', details: ' ' }, 'member', unusedClient),
		/requires a title or details/,
	);
});

test('schema foundation does not add Narrative UI, RAID integration, export, notifications or AI', async () => {
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

	const dashboard = await readFile(
		new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url),
		'utf8',
	);
	assert.doesNotMatch(dashboard, /from\('project_narrative_entries'\)/);
	assert.doesNotMatch(dashboard, /href: ['"]\/app\/[^'"]*narrative/i);
});
