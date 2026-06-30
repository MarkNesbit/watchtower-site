import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	parseDemoPeopleCsv,
	replaceWorkspaceDemoPeople,
	listWorkspaceDemoPeople,
} from '../src/lib/demoPeople.ts';
import {
	INTERNAL_TEST_WORKSPACE_SLUG,
	activateDemoPersonSimulation,
} from '../src/lib/internalTesting.ts';

const migrationUrl = new URL('../supabase/migrations/20260629000400_workspace_demo_people.sql', import.meta.url);
const demoPeoplePageUrl = new URL('../src/pages/app/account/test-tools/demo-people.astro', import.meta.url);
const testToolsPageUrl = new URL('../src/pages/app/account/test-tools.astro', import.meta.url);
const bannerUrl = new URL('../src/components/app/TestingModeBanner.astro', import.meta.url);

const validCsv = `display_name,email,notification_email,workspace_role,project_role,is_default_risk_owner,is_default_risk_actioner,notes
Alice Morgan,mark+alice@example.com,mark@example.com,admin,project_manager,true,false,Demo PM
Priya Shah,mark+priya@example.com,mark@example.com,member,risk_actioner,false,true,Demo actioner
Tom Ellis,mark+tom@example.com,mark@example.com,viewer,sponsor,false,false,Read-only stakeholder`;

function demoPerson(overrides = {}) {
	return {
		id: 'demo-1',
		organisation_id: 'workspace-1',
		display_name: 'Priya Shah',
		email: 'mark+priya@example.com',
		notification_email: 'mark@example.com',
		workspace_role: 'member',
		project_role: 'risk_actioner',
		is_default_risk_owner: false,
		is_default_risk_actioner: true,
		notes: 'Demo actioner',
		status: 'active',
		is_demo_person: true,
		linked_profile_id: null,
		...overrides,
	};
}

function createDemoPeopleClient({
	isTester = true,
	workspaceSlug = INTERNAL_TEST_WORKSPACE_SLUG,
	role = 'owner',
	demoPeople = [demoPerson()],
	activeSimulation = null,
} = {}) {
	const calls = [];
	let people = [...demoPeople];
	let simulation = activeSimulation;

	const client = {
		calls,
		auth: {
			async getUser() {
				calls.push(['auth.getUser']);
				return { data: { user: { id: 'tester-1' } }, error: null };
			},
		},
		from(table) {
			calls.push(['from', table]);
			const query = {
				table,
				filters: {},
				selectValue: '',
				insertPayload: null,
				updatePayload: null,
				select(value) {
					this.selectValue = value;
					calls.push(['select', table, value]);
					if (this.insertPayload && table === 'workspace_demo_people') {
						people = this.insertPayload.map((person, index) => ({ id: `demo-${index + 1}`, ...person }));
						return { data: people, error: null };
					}
					return this;
				},
				eq(column, value) {
					this.filters[column] = value;
					calls.push(['eq', table, column, value]);
					return this;
				},
				gt(column, value) {
					calls.push(['gt', table, column, value]);
					return this;
				},
				order(column, options) {
					calls.push(['order', table, column, options]);
					return this;
				},
				limit(value) {
					calls.push(['limit', table, value]);
					return this;
				},
				delete() {
					calls.push(['delete', table]);
					return this;
				},
				update(payload) {
					this.updatePayload = payload;
					calls.push(['update', table, payload]);
					if (table === 'internal_role_simulations' && simulation) {
						simulation = { ...simulation, ...payload };
					}
					return this;
				},
				insert(payload) {
					this.insertPayload = Array.isArray(payload) ? payload : [payload];
					calls.push(['insert', table, payload]);
					if (table === 'internal_role_simulations') {
						simulation = {
							id: 'simulation-new',
							created_at: new Date().toISOString(),
							updated_at: new Date().toISOString(),
							...payload,
						};
						return { error: null };
					}
					return this;
				},
				maybeSingle() {
					calls.push(['maybeSingle', table, this.filters]);
					if (table === 'profiles') return { data: { is_internal_tester: isTester }, error: null };
					if (table === 'organisation_members') {
						if (this.filters['organisations.slug'] && this.filters['organisations.slug'] !== workspaceSlug) {
							return { data: null, error: null };
						}
						return {
							data: {
								role,
								organisations: { id: 'workspace-1', name: 'Mark.Nesbit.Professional', slug: workspaceSlug },
							},
							error: null,
						};
					}
					if (table === 'internal_role_simulations') {
						const nestedPerson = simulation?.demo_person_id
							? people.find((person) => person.id === simulation.demo_person_id)
							: null;
						return {
							data: simulation ? { ...simulation, workspace_demo_people: nestedPerson } : null,
							error: null,
						};
					}
					if (table === 'workspace_demo_people') {
						const person = people.find((row) => row.id === this.filters.id) ?? null;
						return { data: person, error: null };
					}
					return { data: null, error: null };
				},
				then(resolve) {
					if (table === 'workspace_demo_people') {
						const data = people.filter((person) => {
							if (this.filters.organisation_id && person.organisation_id !== this.filters.organisation_id) return false;
							if (this.filters.is_demo_person !== undefined && person.is_demo_person !== this.filters.is_demo_person) return false;
							if (this.filters.status && person.status !== this.filters.status) return false;
							return true;
						});
						resolve({ data, error: null });
						return;
					}
					resolve({ data: null, error: null });
				},
			};
			return query;
		},
	};
	return client;
}

test('Demo people migration creates workspace-scoped demo personas without auth user creation', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	assert.match(sql, /create table public\.workspace_demo_people/);
	assert.match(sql, /linked_profile_id uuid references public\.profiles\(id\)/);
	assert.match(sql, /workspace_role in \('admin', 'member', 'viewer'\)/);
	assert.match(sql, /is_demo_person = true/);
	assert.match(sql, /alter table public\.internal_role_simulations\s+add column demo_person_id/);
	assert.match(sql, /when irs\.demo_person_id is null then irs\.simulated_role/);
	assert.match(sql, /and \(irs\.demo_person_id is null or wdp\.id is not null\)/);
	assert.doesNotMatch(sql, /insert\s+into\s+auth\.users/i);
	assert.doesNotMatch(sql, /insert\s+into\s+public\.profiles/i);
});

test('CSV validation accepts agreed demo people format', () => {
	const result = parseDemoPeopleCsv(validCsv);
	assert.deepEqual(result.errors, []);
	assert.equal(result.rows.length, 3);
	assert.equal(result.rows[0].display_name, 'Alice Morgan');
	assert.equal(result.rows[0].workspace_role, 'admin');
	assert.equal(result.rows[1].is_default_risk_actioner, true);
});

test('CSV validation rejects missing fields invalid roles duplicate emails and owner personas', () => {
	const result = parseDemoPeopleCsv(`display_name,email,notification_email,workspace_role
,not-an-email,mark@example.com,member
Owner Person,mark+owner@example.com,mark@example.com,owner
Duplicate,mark+owner@example.com,mark@example.com,viewer
Bad Role,mark+bad@example.com,mark@example.com,superuser`);
	assert.ok(result.errors.some((error) => error.field === 'display_name'));
	assert.ok(result.errors.some((error) => error.field === 'email' && /valid/.test(error.message)));
	assert.ok(result.errors.some((error) => error.field === 'workspace_role' && /Owner/.test(error.message)));
	assert.ok(result.errors.some((error) => error.field === 'email' && /unique/.test(error.message)));
	assert.ok(result.errors.some((error) => error.field === 'workspace_role' && /must be one/.test(error.message)));
});

test('Import replacement deletes only demo people and does not alter real profiles auth users or memberships', async () => {
	const client = createDemoPeopleClient();
	const parsed = parseDemoPeopleCsv(validCsv);
	const imported = await replaceWorkspaceDemoPeople(client, parsed.rows);
	assert.equal(imported.length, 3);
	assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'organisation_members' && call[2] === 'organisations.slug' && call[3] === INTERNAL_TEST_WORKSPACE_SLUG));
	assert.ok(client.calls.some((call) => call[0] === 'delete' && call[1] === 'workspace_demo_people'));
	assert.ok(client.calls.some((call) => call[0] === 'insert' && call[1] === 'workspace_demo_people'));
	assert.ok(client.calls.some((call) => call[0] === 'update' && call[1] === 'internal_role_simulations' && call[2].is_active === false));
	assert.ok(!client.calls.some((call) => ['insert', 'update', 'delete'].includes(call[0]) && call[1] === 'profiles'));
	assert.ok(!client.calls.some((call) => call[1] === 'auth.users'));
	assert.ok(!client.calls.some((call) => ['insert', 'update', 'delete'].includes(call[0]) && call[1] === 'organisation_members'));
});

test('Internal tester with old short workspace slug cannot import demo people', async () => {
	const client = createDemoPeopleClient({ workspaceSlug: 'mark-nesbit-professional' });
	const parsed = parseDemoPeopleCsv(validCsv);
	await assert.rejects(
		replaceWorkspaceDemoPeople(client, parsed.rows),
		/Demo people import is not available/,
	);
	assert.ok(!client.calls.some((call) => call[0] === 'insert' && call[1] === 'workspace_demo_people'));
});

test('Ordinary users cannot import demo people through server helper', async () => {
	const client = createDemoPeopleClient({ isTester: false });
	const parsed = parseDemoPeopleCsv(validCsv);
	await assert.rejects(
		replaceWorkspaceDemoPeople(client, parsed.rows),
		/Demo people import is not available/,
	);
	assert.ok(!client.calls.some((call) => call[0] === 'insert' && call[1] === 'workspace_demo_people'));
});

test('Demo people list feeds the persona simulation selector', async () => {
	const client = createDemoPeopleClient({ demoPeople: [demoPerson(), demoPerson({ id: 'demo-2', display_name: 'Tom Ellis', workspace_role: 'viewer' })] });
	const people = await listWorkspaceDemoPeople(client);
	assert.equal(people.length, 2);
	assert.equal(people[0].display_name, 'Priya Shah');

	const page = await readFile(demoPeoplePageUrl, 'utf8');
	assert.match(page, /data-demo-person-selector/);
	assert.match(page, /data-demo-people-list/);
	assert.match(page, /confirm_import/);
	assert.match(page, /simulate_demo_person/);
});

test('Activating demo persona applies selected persona role without changing real membership', async () => {
	const client = createDemoPeopleClient({ role: 'owner', demoPeople: [demoPerson({ id: 'demo-1', workspace_role: 'viewer' })] });
	const state = await activateDemoPersonSimulation(client, 'demo-1');
	assert.equal(state.actualRole, 'owner');
	assert.equal(state.effectiveRole, 'viewer');
	assert.equal(state.activeSimulation.demo_person_id, 'demo-1');
	assert.equal(state.activeSimulation.demoPerson.display_name, 'Priya Shah');
	assert.ok(client.calls.some((call) => call[0] === 'insert' && call[1] === 'internal_role_simulations' && call[2].demo_person_id === 'demo-1'));
	assert.ok(!client.calls.some((call) => call[0] === 'update' && call[1] === 'organisation_members'));
});

test('Demo persona viewer blocks writes and does not inherit owner superuser powers', async () => {
	const client = createDemoPeopleClient({ role: 'owner', demoPeople: [demoPerson({ id: 'demo-1', workspace_role: 'viewer' })] });
	const state = await activateDemoPersonSimulation(client, 'demo-1');
	assert.equal(state.actualRole, 'owner');
	assert.equal(state.effectiveRole, 'viewer');
	assert.notEqual(state.effectiveRole, state.actualRole);
});

test('Demo people route and banner preserve internal-only access and persona visibility', async () => {
	const page = await readFile(demoPeoplePageUrl, 'utf8');
	const tools = await readFile(testToolsPageUrl, 'utf8');
	const banner = await readFile(bannerUrl, 'utf8');
	assert.match(page, /if \(!state\.isInternalTester \|\| !state\.workspace\)/);
	assert.match(page, /Astro\.redirect\('\/app\/account'\)/);
	assert.match(tools, /data-demo-people-tool-link/);
	assert.match(banner, /Testing as \{demoPerson\.display_name\}/);
	assert.match(banner, /demoPerson\.project_role/);
});
