import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	NO_ACTIVE_WORKSPACE_PATH,
	buildWorkspaceAccessFallbackPath,
	getCurrentWorkspace,
	getWorkspaceBySlug,
	resolveWorkspaceAccessFallbackPath,
} from '../src/lib/projects.ts';

const migrationUrl = new URL('../supabase/migrations/20260731000500_prevent_deactivated_user_workspace_fallback.sql', import.meta.url);
const appIndexUrl = new URL('../src/pages/app/index.astro', import.meta.url);
const noActivePageUrl = new URL('../src/pages/app/no-active-workspace.astro', import.meta.url);
const middlewareUrl = new URL('../src/middleware.ts', import.meta.url);
const headerUrl = new URL('../src/components/Header.astro', import.meta.url);
const siteLayoutUrl = new URL('../src/layouts/SiteLayout.astro', import.meta.url);

const activeWorkspace = {
	id: 'workspace-active',
	name: 'Active Workspace',
	slug: 'active-workspace',
	type: 'team',
	created_by: 'owner-auth-user',
};

const fallbackPersonalWorkspace = {
	id: 'workspace-personal',
	name: 'Evie Clarke Workspace',
	slug: 'evie-clarke-workspace',
	type: 'personal',
	created_by: 'evie-auth-user',
};

function membership(overrides = {}) {
	return {
		id: 'membership-active',
		user_id: 'profile-id',
		auth_user_id: 'evie-auth-user',
		role: 'viewer',
		status: 'active',
		joined_at: '2026-07-30T09:00:00.000Z',
		created_at: '2026-07-30T08:00:00.000Z',
		organisations: activeWorkspace,
		...overrides,
	};
}

function createWorkspaceClient({ userId = 'evie-auth-user', memberships = [] } = {}) {
	const state = { calls: [] };
	function createQuery(table) {
		const filters = [];
		const query = {
			select(columns) {
				state.calls.push({ table, method: 'select', columns });
				return query;
			},
			eq(column, value) {
				state.calls.push({ table, method: 'eq', column, value });
				filters.push({ column, value });
				return query;
			},
			or(filter) {
				state.calls.push({ table, method: 'or', filter });
				return query;
			},
			order(column, options) {
				state.calls.push({ table, method: 'order', column, options });
				return query;
			},
			limit(count) {
				state.calls.push({ table, method: 'limit', count });
				return query;
			},
			async maybeSingle() {
				state.calls.push({ table, method: 'maybeSingle' });
				const result = resolve(filters);
				return { data: result[0] ?? null, error: null };
			},
			then(resolveThen, reject) {
				try {
					resolveThen({ data: resolve(filters), error: null });
				} catch (error) {
					if (reject) reject(error);
					else throw error;
				}
			},
		};
		return query;
	}
	function resolve(filters) {
		return memberships.filter((row) => filters.every(({ column, value }) => {
			if (column === 'status') return row.status === value;
			if (column === 'organisations.slug') {
				const organisation = Array.isArray(row.organisations) ? row.organisations[0] : row.organisations;
				return organisation?.slug === value;
			}
			return row[column] === value;
		}));
	}
	return {
		state,
		auth: {
			async getUser() {
				return { data: { user: userId ? { id: userId } : null }, error: null };
			},
		},
		from(table) {
			state.calls.push({ table, method: 'from' });
			return createQuery(table);
		},
	};
}

function objectBlock(sql, startPattern, endPattern) {
	const start = sql.search(startPattern);
	assert.notEqual(start, -1, `Expected start ${startPattern}`);
	const rest = sql.slice(start);
	const end = rest.search(endPattern);
	assert.notEqual(end, -1, `Expected end ${endPattern}`);
	return rest.slice(0, end);
}

test('active workspace resolution ignores deactivated memberships and returns no-active fallback', async () => {
	const client = createWorkspaceClient({
		memberships: [
			membership({
				id: 'membership-deactivated',
				status: 'deactivated',
				deactivated_at: '2026-07-31T09:00:00.000Z',
			}),
		],
	});

	const workspace = await getCurrentWorkspace(client);

	assert.equal(workspace, null);
	assert.equal(await resolveWorkspaceAccessFallbackPath(client), NO_ACTIVE_WORKSPACE_PATH);
	assert.ok(client.state.calls.some((call) => call.table === 'organisation_members' && call.method === 'eq' && call.column === 'status' && call.value === 'active'));
	assert.equal(client.state.calls.some((call) => call.method === 'insert'), false);
});

test('active workspace resolution remains deterministic when active and inactive memberships are mixed', async () => {
	const client = createWorkspaceClient({
		memberships: [
			membership({
				id: 'membership-personal',
				user_id: 'evie-auth-user',
				auth_user_id: 'evie-auth-user',
				joined_at: '2026-07-01T00:00:00.000Z',
				organisations: fallbackPersonalWorkspace,
			}),
			membership({
				id: 'membership-accepted-invite',
				user_id: 'evie-profile-id',
				auth_user_id: 'evie-auth-user',
				joined_at: '2026-07-15T00:00:00.000Z',
				organisations: activeWorkspace,
			}),
			membership({
				id: 'membership-deactivated',
				status: 'deactivated',
				user_id: 'evie-profile-id',
				auth_user_id: 'evie-auth-user',
				organisations: { ...activeWorkspace, id: 'workspace-old', slug: 'old-workspace' },
			}),
		],
	});

	const workspace = await getCurrentWorkspace(client);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;

	assert.equal(workspace.id, 'membership-accepted-invite');
	assert.equal(organisation.slug, 'active-workspace');
	assert.equal(buildWorkspaceAccessFallbackPath(workspace), '/app');
});

test('workspace slug lookup requires an active membership for the requested workspace', async () => {
	const client = createWorkspaceClient({
		memberships: [
			membership({ status: 'deactivated', organisations: { ...activeWorkspace, slug: 'old-workspace' } }),
			membership({ id: 'membership-current', organisations: activeWorkspace }),
		],
	});

	assert.equal(await getWorkspaceBySlug(client, 'old-workspace'), null);
	assert.equal((await getWorkspaceBySlug(client, 'active-workspace'))?.id, 'membership-current');
});

test('authenticated landing and no-active page use the controlled no-workspace state', async () => {
	const [appIndex, noActivePage, header, siteLayout] = await Promise.all([
		readFile(appIndexUrl, 'utf8'),
		readFile(noActivePageUrl, 'utf8'),
		readFile(headerUrl, 'utf8'),
		readFile(siteLayoutUrl, 'utf8'),
	]);

	assert.match(appIndex, /getCurrentWorkspace\(serverSupabase, accessToken\)/);
	assert.match(appIndex, /buildWorkspaceAccessFallbackPath\(workspace\)/);
	assert.match(appIndex, /Astro\.redirect\(NO_ACTIVE_WORKSPACE_PATH, 303\)/);
	assert.match(noActivePage, /You do not currently have access to an active WatchTower workspace\./);
	assert.match(noActivePage, /<SignOutButton className="button button--primary" label="Sign out" \/>/);
	assert.match(noActivePage, /hideAppNavigation/);
	assert.doesNotMatch(noActivePage, /organisation_membership_id|profile_id|auth_user_id|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
	assert.match(header, /hideAppNavigation/);
	assert.match(siteLayout, /<Header hideAppNavigation=\{hideAppNavigation\} \/>/);
});

test('workspace-scoped GET routes revalidate cached slugs through the active workspace resolver', async () => {
	const middleware = await readFile(middlewareUrl, 'utf8');

	assert.match(middleware, /workspaceSlugFromPath\(context\.url\.pathname\)/);
	assert.match(middleware, /getWorkspaceBySlug\(serverSupabase, requestedWorkspaceSlug, accessToken\)/);
	assert.match(middleware, /resolveWorkspaceAccessFallbackPath\(serverSupabase, accessToken\)/);
	assert.match(middleware, /context\.redirect\(fallbackPath, 303\)/);
	assert.match(middleware, /context\.request\.method === 'GET' \|\| context\.request\.method === 'HEAD'/);
	assert.doesNotMatch(middleware, /organisation_members[\s\S]*insert|create.*workspace/i);
});

test('verified-user onboarding does not create fallback workspaces for users with membership lifecycle history', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const onboarding = objectBlock(sql, /create or replace function public\.complete_verified_user_onboarding/, /comment on function public\.complete_verified_user_onboarding/);
	const beforeLifecycleGuard = onboarding.slice(0, onboarding.indexOf('if has_membership_lifecycle then'));
	const afterLifecycleGuard = onboarding.slice(onboarding.indexOf('if has_membership_lifecycle then'));

	assert.match(onboarding, /where om\.auth_user_id = new\.id\s+or om\.user_id = new\.id/);
	assert.match(onboarding, /existing_membership_profile_id is not null and existing_membership_profile_id <> new\.id[\s\S]*return new/);
	assert.match(onboarding, /if has_membership_lifecycle then\s+return new;\s+end if;/);
	assert.doesNotMatch(beforeLifecycleGuard, /insert into public\.organisations|insert into public\.organisation_members|set role = 'owner'|status = 'active'/);
	assert.match(afterLifecycleGuard, /insert into public\.organisations/);
	assert.match(afterLifecycleGuard, /values \(workspace_id, new\.id, 'owner', 'active', now\(\)\)/);
	assert.match(sql, /previously accepted or invited users/);
	assert.match(sql, /invited, active, suspended, deactivated or removed memberships/);
});
