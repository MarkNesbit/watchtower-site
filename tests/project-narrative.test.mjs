import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createProjectNarrativeEntry,
	getNarrativeDisplayRef,
	getUnseenProjectNarrativeCount,
	isNarrativeAttentionLevel,
	isNarrativeSourceType,
	listProjectNarrativeEntries,
	markProjectNarrativeViewed,
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
const readStateMigrationPath = new URL(
	'../supabase/migrations/20260702000100_project_narrative_read_states.sql',
	import.meta.url,
);
const readStateMigrationSql = async () => readFile(readStateMigrationPath, 'utf8');

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

test('Project Narrative read-state migration creates per-user scoped state with own-row RLS', async () => {
	const sql = await readStateMigrationSql();
	assert.match(sql, /create table public\.project_narrative_read_states \(/);
	for (const field of [
		'id uuid primary key default gen_random_uuid()',
		'organisation_id uuid not null references public.organisations(id) on delete cascade',
		'project_id uuid not null references public.projects(id) on delete cascade',
		'user_id uuid not null references auth.users(id) on delete cascade',
		'last_viewed_at timestamptz not null',
		'created_at timestamptz not null default now()',
		'updated_at timestamptz not null default now()',
	]) {
		assert.ok(sql.includes(field), `Expected read-state migration to contain ${field}`);
	}
	assert.match(sql, /foreign key \(project_id, organisation_id\)[\s\S]*references public\.projects\(id, organisation_id\)/);
	assert.match(sql, /unique \(organisation_id, project_id, user_id\)/);
	assert.match(sql, /set_project_narrative_read_states_updated_at/);
	assert.match(sql, /prevent_project_narrative_read_state_identity_update/);
	for (const identity of ['organisation_id', 'project_id', 'user_id', 'created_at']) {
		assert.match(sql, new RegExp(`old\\.${identity} is distinct from new\\.${identity}`));
	}
	assert.match(sql, /alter table public\.project_narrative_read_states enable row level security/);
	assert.match(sql, /Active members can read their own project narrative read states/);
	assert.match(sql, /Active members can create their own project narrative read states/);
	assert.match(sql, /Active members can update their own project narrative read states/);
	assert.match(sql, /user_id = auth\.uid\(\)/);
	assert.match(sql, /is_active_organisation_member\(project_narrative_read_states\.organisation_id\)/);
	assert.match(sql, /grant update \(\s*last_viewed_at\s*\) on public\.project_narrative_read_states to authenticated/);
	assert.doesNotMatch(sql, /grant update \([\s\S]*?(?:organisation_id|project_id|user_id|created_at)[\s\S]*?\) on public\.project_narrative_read_states/);
	assert.doesNotMatch(sql, /notification|digest|badge|health|risk scoring|project list attention/i);
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
	const baseRows = [{
		id: 'entry-2',
		organisation_id: 'workspace-id',
		project_id: 'project-id',
		narrative_ref: 'NAR-HHH-002',
		created_by: 'creator-id',
		updated_by: null,
	}];
	const baseQuery = {
		select(columns) {
			calls.push(['select', 'project_narrative_entries', columns]);
			return this;
		},
		eq(column, value) {
			calls.push(['eq', 'project_narrative_entries', column, value]);
			return this;
		},
		order(column, options) {
			calls.push(['order', 'project_narrative_entries', column, options]);
			if (calls.filter(([name]) => name === 'order').length === 2) {
				return Promise.resolve({ data: baseRows, error: null });
			}
			return this;
		},
	};
	const profileQuery = {
		select(columns) {
			calls.push(['select', 'profiles', columns]);
			return this;
		},
		in(column, values) {
			calls.push(['in', 'profiles', column, values]);
			return Promise.resolve({ data: [{ id: 'creator-id', display_name: 'Creator Name', email: 'creator@example.com' }], error: null });
		},
	};
	const linkQuery = {
		select(columns) {
			calls.push(['select', 'project_narrative_entry_links', columns]);
			return this;
		},
		eq(column, value) {
			calls.push(['eq', 'project_narrative_entry_links', column, value]);
			return this;
		},
		in(column, values) {
			calls.push(['in', 'project_narrative_entry_links', column, values]);
			return Promise.resolve({ data: [{ id: 'link-id', narrative_entry_id: 'entry-2', label: 'Evidence', url: 'https://example.com', created_at: '2026-06-25T10:00:00Z' }], error: null });
		},
	};
	const client = {
		from(table) {
			calls.push(['from', table]);
			if (table === 'project_narrative_entries') return baseQuery;
			if (table === 'profiles') return profileQuery;
			if (table === 'project_narrative_entry_links') return linkQuery;
			assert.fail(`Unexpected table ${table}`);
		},
	};

	const result = await listProjectNarrativeEntries('workspace-id', 'project-id', 'viewer', client);
	assert.equal(result[0].narrative_ref, 'NAR-HHH-002');
	assert.deepEqual(result[0].creator, { id: 'creator-id', display_name: 'Creator Name', email: 'creator@example.com' });
	assert.deepEqual(result[0].links, [{ id: 'link-id', narrative_entry_id: 'entry-2', label: 'Evidence', url: 'https://example.com', created_at: '2026-06-25T10:00:00Z' }]);
	assert.deepEqual(calls.filter(([name]) => name === 'eq'), [
		['eq', 'project_narrative_entries', 'organisation_id', 'workspace-id'],
		['eq', 'project_narrative_entries', 'project_id', 'project-id'],
		['eq', 'project_narrative_entry_links', 'organisation_id', 'workspace-id'],
		['eq', 'project_narrative_entry_links', 'project_id', 'project-id'],
	]);
	assert.deepEqual(calls.filter(([name]) => name === 'order'), [
		['order', 'project_narrative_entries', 'created_at', { ascending: false }],
		['order', 'project_narrative_entries', 'entry_number', { ascending: false }],
	]);
	assert.deepEqual(calls.filter(([name]) => name === 'in'), [
		['in', 'profiles', 'id', ['creator-id']],
		['in', 'project_narrative_entry_links', 'narrative_entry_id', ['entry-2']],
	]);
});

test('related profile and link enrichment cannot suppress valid base narrative entries', async () => {
	const baseRows = [{
		id: 'entry-1',
		organisation_id: 'workspace-id',
		project_id: 'project-id',
		narrative_ref: 'NAR-HHH-001',
		created_by: 'creator-id',
		updated_by: 'updater-id',
	}];
	const client = {
		from(table) {
			if (table === 'project_narrative_entries') {
				return {
					select: () => ({
						eq: () => ({
							eq: () => ({
								order: () => ({
									order: () => Promise.resolve({ data: baseRows, error: null }),
								}),
							}),
						}),
					}),
				};
			}
			if (table === 'profiles') {
				return {
					select: () => ({
						in: () => {
							throw new Error('Profile enrichment failed.');
						},
					}),
				};
			}
			if (table === 'project_narrative_entry_links') {
				return {
					select: () => ({
						eq: () => ({
							eq: () => ({
								in: () => {
									throw new Error('Link enrichment failed.');
								},
							}),
						}),
					}),
				};
			}
			assert.fail(`Unexpected table ${table}`);
		},
	};

	const result = await listProjectNarrativeEntries('workspace-id', 'project-id', 'viewer', client);
	assert.equal(result.length, 1);
	assert.equal(result[0].narrative_ref, 'NAR-HHH-001');
	assert.equal(result[0].creator, null);
	assert.equal(result[0].updater, null);
	assert.deepEqual(result[0].links, []);
});

test('base narrative list query errors are surfaced', async () => {
	const client = {
		from(table) {
			assert.equal(table, 'project_narrative_entries');
			return {
				select: () => ({
					eq: () => ({
						eq: () => ({
							order: () => ({
								order: () => Promise.resolve({ data: null, error: new Error('Narrative list query failed.') }),
							}),
						}),
					}),
				}),
			};
		},
	};

	await assert.rejects(
		listProjectNarrativeEntries('workspace-id', 'project-id', 'viewer', client),
		/Narrative list query failed/,
	);
});

test('unseen Project Narrative count uses current user read-state and counts all entries when no state exists', async () => {
	const calls = [];
	const makeClient = ({ lastViewedAt = null, count = 0 } = {}) => ({
		auth: {
			getUser(token) {
				calls.push(['auth.getUser', token]);
				return Promise.resolve({ data: { user: { id: 'user-1' } }, error: null });
			},
		},
		from(table) {
			calls.push(['from', table]);
			if (table === 'project_narrative_read_states') {
				return {
					select(columns) {
						calls.push(['select', table, columns]);
						return this;
					},
					eq(column, value) {
						calls.push(['eq', table, column, value]);
						return this;
					},
					maybeSingle() {
						calls.push(['maybeSingle', table]);
						return Promise.resolve({ data: lastViewedAt ? { last_viewed_at: lastViewedAt } : null, error: null });
					},
				};
			}
			if (table === 'project_narrative_entries') {
				return {
					select(columns, options) {
						calls.push(['select', table, columns, options]);
						return this;
					},
					eq(column, value) {
						calls.push(['eq', table, column, value]);
						return this;
					},
					gt(column, value) {
						calls.push(['gt', table, column, value]);
						return this;
					},
					then(resolve) {
						return Promise.resolve({ count, error: null }).then(resolve);
					},
				};
			}
			assert.fail(`Unexpected table ${table}`);
		},
	});

	assert.equal(
		await getUnseenProjectNarrativeCount('workspace-id', 'project-id', 'viewer', makeClient({ count: 3 }), 'token'),
		3,
	);
	assert.equal(calls.some((call) => call[0] === 'gt'), false);

	calls.length = 0;
	assert.equal(
		await getUnseenProjectNarrativeCount(
			'workspace-id',
			'project-id',
			'viewer',
			makeClient({ lastViewedAt: '2026-07-01T10:00:00.000Z', count: 2 }),
			'token',
		),
		2,
	);
	assert.deepEqual(calls.filter((call) => call[0] === 'gt'), [
		['gt', 'project_narrative_entries', 'created_at', '2026-07-01T10:00:00.000Z'],
	]);
	assert.deepEqual(calls.filter((call) => call[0] === 'eq' && call[1] === 'project_narrative_read_states'), [
		['eq', 'project_narrative_read_states', 'organisation_id', 'workspace-id'],
		['eq', 'project_narrative_read_states', 'project_id', 'project-id'],
		['eq', 'project_narrative_read_states', 'user_id', 'user-1'],
	]);
});

test('unseen Project Narrative count returns zero when no entries match and rejects unauthenticated users', async () => {
	const countClient = {
		auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
		from(table) {
			if (table === 'project_narrative_read_states') {
				return {
					select: () => ({
						eq: () => ({
							eq: () => ({
								eq: () => ({ maybeSingle: async () => ({ data: { last_viewed_at: '2026-07-01T10:00:00.000Z' }, error: null }) }),
							}),
						}),
					}),
				};
			}
			if (table === 'project_narrative_entries') {
				return {
					select: () => ({
						eq: () => ({
							eq: () => ({
								gt: async () => ({ count: 0, error: null }),
							}),
						}),
					}),
				};
			}
			assert.fail(`Unexpected table ${table}`);
		},
	};
	assert.equal(await getUnseenProjectNarrativeCount('workspace-id', 'project-id', 'viewer', countClient), 0);

	const anonymousClient = {
		auth: { getUser: async () => ({ data: { user: null }, error: null }) },
		from: () => assert.fail('Client table access should not happen without a user'),
	};
	await assert.rejects(
		getUnseenProjectNarrativeCount('workspace-id', 'project-id', 'viewer', anonymousClient),
		/Authenticated user is required/,
	);
});

test('marking Project Narrative viewed upserts current user read-state without changing entries', async () => {
	const calls = [];
	const viewedAt = new Date('2026-07-02T09:30:00.000Z');
	const expectedState = {
		id: 'state-id',
		organisation_id: 'workspace-id',
		project_id: 'project-id',
		user_id: 'user-1',
		last_viewed_at: viewedAt.toISOString(),
		created_at: '2026-07-02T09:30:00.000Z',
		updated_at: '2026-07-02T09:30:00.000Z',
	};
	const client = {
		auth: {
			getUser(token) {
				calls.push(['auth.getUser', token]);
				return Promise.resolve({ data: { user: { id: 'user-1' } }, error: null });
			},
		},
		from(table) {
			calls.push(['from', table]);
			assert.equal(table, 'project_narrative_read_states');
			return {
				upsert(payload, options) {
					calls.push(['upsert', table, payload, options]);
					return {
						select(columns) {
							calls.push(['select', table, columns]);
							return {
								single: async () => ({ data: expectedState, error: null }),
							};
						},
					};
				},
			};
		},
	};

	const state = await markProjectNarrativeViewed('workspace-id', 'project-id', 'viewer', client, 'token', viewedAt);
	assert.deepEqual(state, expectedState);
	assert.deepEqual(calls.filter((call) => call[0] === 'upsert'), [
		['upsert', 'project_narrative_read_states', {
			organisation_id: 'workspace-id',
			project_id: 'project-id',
			user_id: 'user-1',
			last_viewed_at: viewedAt.toISOString(),
		}, { onConflict: 'organisation_id,project_id,user_id' }],
	]);
	assert.equal(calls.some((call) => call[1] === 'project_narrative_entries'), false);
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
	const hero = await readFile(new URL('../src/components/app/ProjectPageHero.astro', import.meta.url), 'utf8');
	const controlPanel = await readFile(new URL('../src/components/app/ProjectControlPanel.astro', import.meta.url), 'utf8');
	const contentPanel = await readFile(new URL('../src/components/app/ProjectContentPanel.astro', import.meta.url), 'utf8');
	const emptyState = await readFile(new URL('../src/components/app/EmptyState.astro', import.meta.url), 'utf8');
	const ragReferencePill = await readFile(new URL('../src/components/app/RagReferencePill.astro', import.meta.url), 'utf8');
	const siteLayout = await readFile(new URL('../src/layouts/SiteLayout.astro', import.meta.url), 'utf8');

	assert.match(page, /data-project-narrative-route/);
	assert.match(page, /<ProjectPageHero/);
	assert.match(page, /workspaceName=\{workspaceName\}/);
	assert.match(page, /projectName=\{project\.name\}/);
	assert.match(page, /title="Project Narrative"/);
	assert.match(hero, /<h1 id=\{headingId\}>\{title\}<\/h1>/);
	assert.match(hero, /min-height: clamp\(11\.5rem, 20vw, 14\.5rem\)/);
	assert.match(hero, /font-size: clamp\(2rem, 3\.2vw, 3\.2rem\)/);
	assert.match(hero, /width: min\(100%, 11\.5rem\)/);
	assert.match(page, /A project-level timeline of key events, updates and decisions\./);
	assert.match(page, /<ProjectContentPanel/);
	assert.doesNotMatch(page, /label="Assurance timeline"/);
	assert.doesNotMatch(page, /ASSURANCE TIMELINE|Assurance timeline/);
	assert.match(page, /title="Narrative entries"/);
	assert.match(page, /project-content-panel h2\) \{ font-size: clamp\(1\.45rem, 2\.4vw, 2rem\); \}/);
	assert.doesNotMatch(page, /helper="Open an entry to inspect its full read-only details\."/);
	assert.match(contentPanel, /<slot name="action" \/>/);
	assert.match(page, />New Entry<\/button>/);
	assert.match(page, /data-open-create-narrative/);
	assert.match(siteLayout, /\.button \{[\s\S]*?cursor: pointer/);
	assert.match(siteLayout, /\.button:focus-visible/);
	assert.doesNotMatch(page, /<DisabledActionHint|narrative-action-help|Capture a manual project update/);
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
	assert.match(page, /import [\s\S]*markProjectNarrativeViewed[\s\S]*from/);
	assert.match(page, /markProjectNarrativeViewed\(organisation\.id, data\.id, workspace\.role, serverSupabase, accessToken\)/);
	assert.ok(page.indexOf('entries = await listProjectNarrativeEntries') < page.indexOf('await markProjectNarrativeViewed'));
	assert.match(page, /data-detail-modal/);
	assert.match(page, /data-entry-id=\{entry\.id\}/);
	assert.match(page, /data-detail-narrative-ref/);
	assert.match(page, /data-detail-source-type/);
	assert.match(page, /data-detail-links/);
	assert.match(page, /listProjectRisksByIds\(organisation\.id, data\.id, riskSourceIds, workspace\.role, serverSupabase\)/);
	assert.match(page, /data-detail-risk-section/);
	assert.match(page, /View risk detail/);
	assert.match(page, /data-risk-detail-trigger/);
	assert.match(page, /entry\.source_type === 'risk' && entry\.source_record_id/);
	assert.match(page, /Current source risk/);
	assert.match(page, /Risk detail/);
	assert.match(page, /data-detail-risk-reference/);
	assert.match(page, /data-detail-risk-concern/);
	assert.match(page, /data-detail-risk-concern-card/);
	assert.match(page, /data-detail-risk-exposure-card/);
	assert.match(page, /data-detail-risk-assurance-card/);
	assert.match(page, /data-detail-risk-assurance/);
	assert.match(page, /data-detail-risk-exposure/);
	assert.match(page, /data-detail-risk-probability/);
	assert.match(page, /data-detail-risk-impact/);
	assert.match(page, /data-detail-risk-owner/);
	assert.match(page, /data-detail-risk-actioner/);
	assert.match(page, /data-detail-risk-review-date/);
	assert.match(page, /data-detail-risk-due-date/);
	assert.match(page, /data-detail-risk-updated-at/);
	assert.match(page, /data-detail-risk-description/);
	assert.match(page, /data-detail-risk-mitigation/);
	assert.match(page, /data-detail-risk-contingency/);
	assert.match(page, /data-detail-risk-fallback/);
	assert.match(page, /data-detail-risk-open/);
	assert.match(page, /Open full risk in new tab/);
	assert.match(page, /target="_blank"/);
	assert.match(page, /rel="noopener noreferrer"/);
	assert.match(page, /buildProjectRiskPath\(workspaceSlug \?\? '', project\?\.slug \?\? projectSlug \?\? '', risk\.risk_id\)/);
	assert.match(page, /buildProjectRiskPath\(workspaceSlug \?\? '', project\?\.slug \?\? projectSlug \?\? '', entry\.source_record_id\)/);
	assert.match(page, /deriveRiskAssuranceTone\(risk, new Date\(\)\)/);
	assert.match(page, /deriveRiskExposureTone\(risk\.probability, risk\.impact\)/);
	assert.match(page, /deriveRiskConcernTone\(risk, new Date\(\)\)/);
	assert.match(page, /entry\.sourceRisk\.available === false/);
	assert.match(page, /rag-panel rag-panel--\$\{entry\.sourceRisk\.assuranceTone \|\| 'neutral'\}/);
	assert.match(page, /setRagClass\(detailModal\.querySelector\('\[data-detail-risk-exposure-card\]'\), 'narrative-risk-signal rag-card', entry\.sourceRisk\.exposureTone\)/);
	assert.doesNotMatch(page, /data-detail-risk-edit|Edit source risk|Edit Risk/);
	assert.doesNotMatch(page, /openDetail[\s\S]*markProjectNarrativeViewed/);
	assert.match(page, /showModal\(\)/);
	assert.match(page, /detailModal\?\.addEventListener\('close'/);
	assert.doesNotMatch(page, /narrative-ref-help|Open an entry to inspect its full read-only details\./);
	assert.match(page, /entriesLoadError/);
	assert.match(page, /<EmptyState title="Project Narrative entries could not be loaded\."/);
	assert.match(emptyState, /class=\{`empty-state empty-state--\$\{tone\}`\}/);
	assert.match(page, /data-narrative-list-error/);
	assert.match(page, /Project Narrative entries could not be loaded\./);
	assert.match(page, /entriesLoadError \? \(/);
	assert.match(page, /<EmptyState title="No narrative entries yet\."/);
	assert.match(page, /<ProjectControlPanel title="Filters" status="Coming soon"/);
	assert.match(controlPanel, /<slot \/>/);
	assert.match(page, /<tr><th scope="col">Ref<\/th><th scope="col">Details<\/th><th scope="col">Created by<\/th><th scope="col">Created<\/th><\/tr>/);
	assert.doesNotMatch(page, /<th scope="col">Attention<\/th>/);
	assert.doesNotMatch(page, /<th[^>]*>Type<\/th>|<th[^>]*>(?:Entry|Row) number<\/th>/i);
	assert.match(page, /import RagReferencePill/);
	assert.match(page, /getNarrativeDisplayRef\(entry\)/);
	assert.match(page, /<RagReferencePill[\s\S]*tone=\{getAttentionPillTone\(entry\.attention_level\)\}[\s\S]*label=\{getNarrativeDisplayRef\(entry\)\}[\s\S]*statusLabel=\{formatAttention\(entry\.attention_level\)\}/);
	assert.match(page, /aria-label=\{`Open \$\{getNarrativeDisplayRef\(entry\)\}, \$\{formatAttention\(entry\.attention_level\)\} attention`\}/);
	assert.match(ragReferencePill, /statusLabel/);
	assert.match(ragReferencePill, /rag-reference-pill__status/);
	assert.doesNotMatch(page, /<td><span class=\{`attention-badge attention-badge--\$\{entry\.attention_level\}`\}/);
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
	const readStateSql = await readStateMigrationSql();
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
		assert.doesNotMatch(readStateSql, new RegExp(`create\\s+table\\s+(public\\.)?${excludedTable}\\b`, 'i'));
	}
	const page = await readFile(
		new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/narrative.astro', import.meta.url),
		'utf8',
	);
	assert.doesNotMatch(page, /CSV|notification|digest|browser badge|favicon count|AI summar|AI analys/i);
});
