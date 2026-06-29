import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	INTERNAL_TEST_WORKSPACE_SLUG,
	ROLE_SIMULATION_TTL_HOURS,
	activateRoleSimulation,
	applyRoleSimulationToMembership,
	getInternalRoleSimulationState,
	resetRoleSimulation,
} from '../src/lib/internalTesting.ts';
import { createProjectRisk } from '../src/lib/projectRisks.ts';

const migrationUrl = new URL('../supabase/migrations/20260629000300_internal_role_simulation.sql', import.meta.url);
const accountPageUrl = new URL('../src/pages/app/account/index.astro', import.meta.url);
const testToolsPageUrl = new URL('../src/pages/app/account/test-tools.astro', import.meta.url);
const bannerUrl = new URL('../src/components/app/TestingModeBanner.astro', import.meta.url);
const authenticatedLayoutUrl = new URL('../src/layouts/AuthenticatedLayout.astro', import.meta.url);
const UNSCOPED_SHORT_WORKSPACE_SLUG = 'mark-nesbit-professional';

function createInternalTestingClient({
	userId = 'tester-1',
	isTester = true,
	workspaceSlug = INTERNAL_TEST_WORKSPACE_SLUG,
	workspaceName = 'Mark.Nesbit.Professional',
	role = 'owner',
	activeSimulation = null,
} = {}) {
	const calls = [];
	let simulation = activeSimulation;
	const client = {
		calls,
		auth: {
			async getUser() {
				calls.push(['auth.getUser']);
				return { data: { user: { id: userId } }, error: null };
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
				update(payload) {
					this.updatePayload = payload;
					calls.push(['update', table, payload]);
					if (table === 'internal_role_simulations' && simulation) {
						simulation = { ...simulation, ...payload };
					}
					return { eq: this.eq.bind(this), error: null };
				},
				insert(payload) {
					this.insertPayload = payload;
					calls.push(['insert', table, payload]);
					if (table === 'internal_role_simulations') {
						simulation = {
							id: 'simulation-new',
							created_at: new Date().toISOString(),
							updated_at: new Date().toISOString(),
							...payload,
						};
					}
					return { error: null };
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
								organisations: { id: 'workspace-1', name: workspaceName, slug: workspaceSlug },
							},
							error: null,
						};
					}
					if (table === 'internal_role_simulations') return { data: simulation, error: null };
					return { data: null, error: null };
				},
			};
			return query;
		},
	};
	return client;
}

function futureSimulation(role = 'viewer') {
	return {
		id: 'simulation-1',
		user_id: 'tester-1',
		organisation_id: 'workspace-1',
		simulated_role: role,
		is_active: true,
		expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	};
}

test('Migration adds scoped internal role simulation storage and effective-role RLS resolution', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	assert.match(sql, /add column is_internal_tester boolean not null default false/);
	assert.match(sql, /create table public\.internal_role_simulations/);
	assert.match(sql, /simulated_role in \('owner', 'admin', 'member', 'viewer'\)/);
	assert.match(sql, /internal_role_simulations_one_active_per_user_workspace_idx/);
	assert.match(sql, /o\.slug = 'mark-nesbit-professional-workspace'/);
	assert.doesNotMatch(sql, /o\.slug = 'mark-nesbit-professional'/);
	assert.match(sql, /expires_at <= now\(\) \+ interval '4 hours'/);
	assert.match(sql, /coalesce\(\s*public\.active_internal_role_simulation\(target_organisation_id, target_user_id\),\s*om\.role\s*\) = any\(allowed_roles\)/);
	assert.doesNotMatch(sql, /impersonat|global_admin|platform_admin/i);
});

test('Account page hides Test tools from ordinary users and exposes them to authorised testers only', async () => {
	const accountPage = await readFile(accountPageUrl, 'utf8');
	const testToolsPage = await readFile(testToolsPageUrl, 'utf8');
	assert.match(accountPage, /state\?\.isInternalTester && state\?\.workspace/);
	assert.match(accountPage, /data-test-tools-link/);
	assert.match(accountPage, /data-no-test-tools/);
	assert.match(testToolsPage, /if \(!state\.isInternalTester \|\| !state\.workspace\)/);
	assert.match(testToolsPage, /Astro\.redirect\('\/app\/account'\)/);
});

test('Internal tester with production workspace slug can see Test tools state', async () => {
	const client = createInternalTestingClient({
		isTester: true,
		workspaceSlug: 'mark-nesbit-professional-workspace',
		role: 'owner',
	});

	const state = await getInternalRoleSimulationState(client);
	assert.equal(state.isInternalTester, true);
	assert.equal(state.workspace.slug, 'mark-nesbit-professional-workspace');
	assert.equal(state.actualRole, 'owner');
	assert.equal(state.effectiveRole, 'owner');
	assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'organisation_members' && call[2] === 'organisations.slug' && call[3] === INTERNAL_TEST_WORKSPACE_SLUG));
});

test('Internal tester with old short slug alone cannot see Test tools state', async () => {
	const client = createInternalTestingClient({
		isTester: true,
		workspaceSlug: UNSCOPED_SHORT_WORKSPACE_SLUG,
		role: 'owner',
	});

	const state = await getInternalRoleSimulationState(client);
	assert.equal(state.isInternalTester, true);
	assert.equal(state.workspace, null);
	assert.equal(state.actualRole, null);
	assert.equal(state.effectiveRole, null);
});

test('Internal tester outside scoped workspace cannot see Test tools state', async () => {
	const client = createInternalTestingClient({
		isTester: true,
		workspaceSlug: 'customer-workspace',
		role: 'owner',
	});

	const state = await getInternalRoleSimulationState(client);
	assert.equal(state.isInternalTester, true);
	assert.equal(state.workspace, null);
	assert.equal(state.effectiveRole, null);
});

test('Ordinary users cannot see Test tools state', async () => {
	const client = createInternalTestingClient({
		isTester: false,
		workspaceSlug: INTERNAL_TEST_WORKSPACE_SLUG,
		role: 'owner',
	});

	const state = await getInternalRoleSimulationState(client);
	assert.equal(state.isInternalTester, false);
	assert.equal(state.workspace, null);
	assert.equal(state.effectiveRole, null);
});

test('Effective role resolves to active simulated role only for authorised tester in scoped workspace', async () => {
	const client = createInternalTestingClient({ activeSimulation: futureSimulation('viewer') });
	const membership = {
		role: 'owner',
		organisations: { id: 'workspace-1', name: 'Mark.Nesbit.Professional', slug: INTERNAL_TEST_WORKSPACE_SLUG },
	};

	const result = await applyRoleSimulationToMembership(membership, client, 'tester-1');
	assert.equal(result.actualRole, 'owner');
	assert.equal(result.role, 'viewer');
	assert.equal(result.effectiveRole, 'viewer');
	assert.equal(result.activeRoleSimulation.simulated_role, 'viewer');
});

test('Effective role falls back to actual role when simulation is inactive expired unauthorised or outside scope', async () => {
	const membership = {
		role: 'admin',
		organisations: { id: 'workspace-1', name: 'Mark.Nesbit.Professional', slug: INTERNAL_TEST_WORKSPACE_SLUG },
	};
	const inactiveClient = createInternalTestingClient({ activeSimulation: null });
	assert.equal((await applyRoleSimulationToMembership(membership, inactiveClient, 'tester-1')).role, 'admin');

	const expiredClient = createInternalTestingClient({
		activeSimulation: { ...futureSimulation('viewer'), expires_at: '2026-01-01T00:00:00Z' },
	});
	assert.equal((await applyRoleSimulationToMembership(membership, expiredClient, 'tester-1')).role, 'admin');

	const ordinaryClient = createInternalTestingClient({ isTester: false, activeSimulation: futureSimulation('viewer') });
	assert.equal((await applyRoleSimulationToMembership(membership, ordinaryClient, 'tester-1')).role, 'admin');

	const outsideWorkspaceClient = createInternalTestingClient({ workspaceSlug: 'customer-workspace', activeSimulation: futureSimulation('viewer') });
	assert.equal((await applyRoleSimulationToMembership({
		...membership,
		organisations: { ...membership.organisations, slug: 'customer-workspace' },
	}, outsideWorkspaceClient, 'tester-1')).role, 'admin');

	const oldShortSlugClient = createInternalTestingClient({ workspaceSlug: UNSCOPED_SHORT_WORKSPACE_SLUG, activeSimulation: futureSimulation('viewer') });
	assert.equal((await applyRoleSimulationToMembership({
		...membership,
		organisations: { ...membership.organisations, slug: UNSCOPED_SHORT_WORKSPACE_SLUG },
	}, oldShortSlugClient, 'tester-1')).role, 'admin');
});

test('Authorised tester can activate each simulated role without changing real membership role', async () => {
	for (const role of ['viewer', 'member', 'admin', 'owner']) {
		const client = createInternalTestingClient({ role: 'owner' });
		const state = await activateRoleSimulation(client, role);
		assert.equal(state.actualRole, 'owner');
		assert.equal(state.effectiveRole, role);
		assert.ok(client.calls.some((call) => call[0] === 'insert' && call[1] === 'internal_role_simulations' && call[2].simulated_role === role));
		assert.ok(!client.calls.some((call) => call[0] === 'update' && call[1] === 'organisation_members'));
	}
});

test('Reset deactivates active simulation and restores actual effective permissions', async () => {
	const client = createInternalTestingClient({ role: 'admin', activeSimulation: futureSimulation('viewer') });
	const state = await resetRoleSimulation(client);
	assert.equal(state.actualRole, 'admin');
	assert.equal(state.effectiveRole, 'admin');
	assert.equal(state.activeSimulation, null);
	assert.ok(client.calls.some((call) => call[0] === 'update' && call[1] === 'internal_role_simulations' && call[2].is_active === false));
});

test('Viewer simulation blocks create/edit server actions before mutation', async () => {
	const client = createInternalTestingClient({ role: 'owner', activeSimulation: futureSimulation('viewer') });
	await assert.rejects(
		createProjectRisk(INTERNAL_TEST_WORKSPACE_SLUG, 'delivery-hub', {
			title: 'No write',
			status: 'open',
			probability: 'medium',
			impact: 'medium',
		}, client),
		/risk creation/,
	);
	assert.ok(!client.calls.some((call) => call[0] === 'insert'));
});

test('Banner renders only for active simulations and includes reset action', async () => {
	const banner = await readFile(bannerUrl, 'utf8');
	const layout = await readFile(authenticatedLayoutUrl, 'utf8');
	assert.match(layout, /getInternalRoleSimulationState\(serverSupabase, accessToken\)/);
	assert.match(layout, /<TestingModeBanner state=\{roleSimulationState\}/);
	assert.match(banner, /data-testing-mode-banner/);
	assert.match(banner, /state\?\.isInternalTester && simulation && simulatedRole/);
	assert.match(banner, /Reset to real permissions/);
	assert.match(banner, /name="action" value="reset"/);
});

test('Ordinary users cannot create update or reset simulation records through RLS', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	assert.match(sql, /for insert[\s\S]*with check \([\s\S]*user_id = auth\.uid\(\)[\s\S]*public\.is_internal_tester\(auth\.uid\(\)\)/);
	assert.match(sql, /for update[\s\S]*using \([\s\S]*user_id = auth\.uid\(\)[\s\S]*public\.is_internal_tester\(auth\.uid\(\)\)/);
	assert.match(sql, /public\.is_internal_role_simulation_workspace\(organisation_id\)/);
	assert.match(sql, /grant update \(\s*is_active,\s*updated_at\s*\) on public\.internal_role_simulations to authenticated/);
	assert.doesNotMatch(sql, /grant delete on table public\.internal_role_simulations to authenticated/i);
});

test('Test tools display actual effective and expiry information', async () => {
	const source = await readFile(testToolsPageUrl, 'utf8');
	assert.match(source, /data-actual-role/);
	assert.match(source, /data-effective-role/);
	assert.match(source, /data-testing-mode-status/);
	assert.match(source, /data-testing-expiry/);
	assert.match(source, /ROLE_SIMULATION_TTL_HOURS/);
	assert.equal(ROLE_SIMULATION_TTL_HOURS, 4);
});
