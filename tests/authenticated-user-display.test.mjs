import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	AUTHENTICATED_DASHBOARD_WORKSPACE_FALLBACK,
	loadAuthenticatedDashboardContext,
} from '../src/lib/authenticatedDashboard.ts';
import { authenticatedUserDisplayName } from '../src/lib/authenticatedUserDisplay.ts';

const appLandingUrl = new URL('../src/components/app/AppLanding.astro', import.meta.url);

async function appLandingSource() {
	return readFile(appLandingUrl, 'utf8');
}

const markWorkspace = {
	id: 'workspace-mark-professional',
	name: 'Mark Nesbit Professional Workspace',
	slug: 'mark-nesbit-professional-workspace',
	type: 'team',
	created_by: 'mark-auth-user',
};

function activeMembership(overrides = {}) {
	return {
		id: 'membership-id',
		user_id: 'profile-id',
		auth_user_id: 'auth-user-id',
		role: 'viewer',
		status: 'active',
		joined_at: '2026-07-30T09:00:00.000Z',
		created_at: '2026-07-30T08:00:00.000Z',
		organisations: markWorkspace,
		...overrides,
	};
}

function directoryRow(overrides = {}) {
	return {
		organisation_id: markWorkspace.id,
		organisation_membership_id: 'membership-id',
		profile_id: 'profile-id',
		auth_user_id: 'auth-user-id',
		first_name: 'James',
		last_name: 'Brooks',
		display_name: null,
		login_name: 'james.brooks',
		membership_status: 'active',
		...overrides,
	};
}

function createQuery(table, state) {
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
		gt(column, value) {
			state.calls.push({ table, method: 'gt', column, value });
			return query;
		},
		limit(count) {
			state.calls.push({ table, method: 'limit', count });
			return query;
		},
		async maybeSingle() {
			state.calls.push({ table, method: 'maybeSingle' });
			const result = resolveQuery(table, state, filters);
			return {
				data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
				error: result.error,
			};
		},
		then(resolve, reject) {
			try {
				resolve(resolveQuery(table, state, filters));
			} catch (error) {
				if (reject) reject(error);
				else throw error;
			}
		},
	};
	return query;
}

function resolveQuery(table, state, filters) {
	if (state.errors?.[table]) return { data: null, error: state.errors[table] };
	const matches = (row) => filters.every(({ column, value }) => row[column] === value);
	if (table === 'organisation_members') {
		return {
			data: state.memberships
				.filter((row) => row.status === 'active')
				.sort((a, b) => String(a.id).localeCompare(String(b.id))),
			error: null,
		};
	}
	if (table === 'workspace_member_directory') {
		return {
			data: state.directoryRows.filter(matches).slice(0, 2),
			error: null,
		};
	}
	if (table === 'profiles') return { data: [{ is_internal_tester: false }], error: null };
	if (table === 'internal_role_simulations') return { data: [], error: null };
	return { data: [], error: null };
}

function createDashboardClient({ userId = 'auth-user-id', memberships = [activeMembership()], directoryRows = [directoryRow()], errors = {} } = {}) {
	const state = { calls: [], memberships, directoryRows, errors };
	const client = {
		state,
		auth: {
			async getUser() {
				return { data: { user: userId ? { id: userId } : null }, error: null };
			},
		},
		from(table) {
			state.calls.push({ table, method: 'from' });
			return createQuery(table, state);
		},
	};
	return client;
}

test('Authenticated user display prefers linked profile first and last names', () => {
	assert.equal(authenticatedUserDisplayName({
		first_name: '  James ',
		last_name: ' Brooks  ',
		display_name: 'Mark Nesbit Professional Wt James Brooks Fdd7f16c8161',
		login_name: 'james.brooks',
	}), 'James Brooks');
	assert.equal(authenticatedUserDisplayName({ first_name: 'Ruby', last_name: 'Atkinson' }), 'Ruby Atkinson');
	assert.equal(authenticatedUserDisplayName({ first_name: 'Mark', last_name: 'Nesbit' }), 'Mark Nesbit');
});

test('Authenticated user display falls back only to profile display name login name or neutral text', () => {
	assert.equal(authenticatedUserDisplayName({
		first_name: '',
		last_name: '   ',
		display_name: ' Delivery Lead ',
		login_name: 'delivery.lead',
	}), 'Delivery Lead');
	assert.equal(authenticatedUserDisplayName({
		first_name: null,
		last_name: null,
		display_name: null,
		login_name: 'viewer-01',
	}), 'viewer-01');
	assert.equal(authenticatedUserDisplayName(null), 'Signed-in user');
	assert.equal(authenticatedUserDisplayName({ first_name: null, last_name: null, display_name: null, login_name: null }), 'Signed-in user');
});

test('Authenticated dashboard resolves James through the current workspace member directory', async () => {
	const client = createDashboardClient({
		userId: '9213ab00-1a8a-4ce3-bc46-bb3186d4b8b3',
		memberships: [activeMembership({
			id: 'e2de4ad0-6f78-4bc7-ae0b-3e65f64b3ba0',
			user_id: 'fdd7f16c-8161-484c-a623-ade94a7a4873',
			auth_user_id: '9213ab00-1a8a-4ce3-bc46-bb3186d4b8b3',
		})],
		directoryRows: [directoryRow({
			organisation_membership_id: 'e2de4ad0-6f78-4bc7-ae0b-3e65f64b3ba0',
			profile_id: 'fdd7f16c-8161-484c-a623-ade94a7a4873',
			auth_user_id: '9213ab00-1a8a-4ce3-bc46-bb3186d4b8b3',
			first_name: 'James',
			last_name: 'Brooks',
		})],
	});

	const context = await loadAuthenticatedDashboardContext(client);

	assert.equal(context.personName, 'James Brooks');
	assert.equal(context.workspaceName, 'Mark Nesbit Professional Workspace');
	assert.equal(context.directoryRowFound, true);
});

test('Authenticated dashboard resolves Ruby and James to the same workspace with different person names', async () => {
	const james = await loadAuthenticatedDashboardContext(createDashboardClient({
		userId: '9213ab00-1a8a-4ce3-bc46-bb3186d4b8b3',
		memberships: [activeMembership({ auth_user_id: '9213ab00-1a8a-4ce3-bc46-bb3186d4b8b3' })],
		directoryRows: [directoryRow({ auth_user_id: '9213ab00-1a8a-4ce3-bc46-bb3186d4b8b3', first_name: 'James', last_name: 'Brooks' })],
	}));
	const ruby = await loadAuthenticatedDashboardContext(createDashboardClient({
		userId: 'fb483350-23d9-4eac-a056-54b4afbfad96',
		memberships: [activeMembership({
			id: 'cd58905f-958d-46f8-8ea8-dc45594ba9be',
			user_id: 'df702c09-60ec-44df-b262-b5902726dc76',
			auth_user_id: 'fb483350-23d9-4eac-a056-54b4afbfad96',
		})],
		directoryRows: [directoryRow({
			organisation_membership_id: 'cd58905f-958d-46f8-8ea8-dc45594ba9be',
			profile_id: 'df702c09-60ec-44df-b262-b5902726dc76',
			auth_user_id: 'fb483350-23d9-4eac-a056-54b4afbfad96',
			first_name: 'Ruby',
			last_name: 'Atkinson',
			login_name: 'ruby.atkinson',
		})],
	}));

	assert.equal(james.personName, 'James Brooks');
	assert.equal(ruby.personName, 'Ruby Atkinson');
	assert.equal(james.workspaceName, 'Mark Nesbit Professional Workspace');
	assert.equal(ruby.workspaceName, 'Mark Nesbit Professional Workspace');
});

test('Authenticated dashboard keeps Mark person name separate from workspace name', async () => {
	const context = await loadAuthenticatedDashboardContext(createDashboardClient({
		userId: 'mark-auth-user',
		memberships: [activeMembership({ auth_user_id: 'mark-auth-user', user_id: 'mark-profile', role: 'owner' })],
		directoryRows: [directoryRow({
			auth_user_id: 'mark-auth-user',
			profile_id: 'mark-profile',
			first_name: 'Mark',
			last_name: 'Nesbit Professional',
			display_name: 'Mark Nesbit Professional Workspace',
			login_name: 'mark.nesbit',
		})],
	}));

	assert.equal(context.personName, 'Mark Nesbit Professional');
	assert.equal(context.workspaceName, 'Mark Nesbit Professional Workspace');
	assert.notEqual(context.personName, context.workspaceName);
});

test('Authenticated dashboard uses the current workspace to select the member row', async () => {
	const otherWorkspace = { id: 'workspace-other', name: 'Other Workspace', slug: 'other', type: 'team' };
	const client = createDashboardClient({
		userId: 'multi-auth-user',
		memberships: [
			activeMembership({
				id: 'membership-other',
				auth_user_id: 'multi-auth-user',
				joined_at: '2026-08-01T00:00:00.000Z',
				organisations: otherWorkspace,
			}),
			activeMembership({
				id: 'membership-current',
				auth_user_id: 'multi-auth-user',
				joined_at: '2026-07-01T00:00:00.000Z',
				organisations: markWorkspace,
			}),
		],
		directoryRows: [
			directoryRow({ organisation_id: otherWorkspace.id, auth_user_id: 'multi-auth-user', first_name: 'Other', last_name: 'Member' }),
			directoryRow({ organisation_id: markWorkspace.id, auth_user_id: 'multi-auth-user', first_name: 'Current', last_name: 'Member' }),
		],
	});

	const context = await loadAuthenticatedDashboardContext(client);

	assert.equal(context.personName, 'Current Member');
	assert.equal(context.workspaceName, 'Mark Nesbit Professional Workspace');
	assert.ok(client.state.calls.some((call) => call.table === 'workspace_member_directory' && call.method === 'eq' && call.column === 'organisation_id' && call.value === markWorkspace.id));
});

test('Authenticated dashboard ignores inactive directory rows for current-user identity', async () => {
	const logs = [];
	const originalWarn = console.warn;
	console.warn = (event, details) => logs.push({ event, details });
	try {
		const context = await loadAuthenticatedDashboardContext(createDashboardClient({
			directoryRows: [directoryRow({ membership_status: 'deactivated', first_name: 'Inactive', last_name: 'Member' })],
		}));

		assert.equal(context.personName, 'Signed-in user');
		assert.equal(context.workspaceName, 'Mark Nesbit Professional Workspace');
		assert.equal(logs[0]?.event, 'authenticated_user_profile_resolution_failed');
		assert.equal(logs[0]?.details.fallbackUsed, true);
	} finally {
		console.warn = originalWarn;
	}
});

test('Authenticated dashboard profile failure does not suppress resolved workspace', async () => {
	const logs = [];
	const originalWarn = console.warn;
	console.warn = (event, details) => logs.push({ event, details });
	try {
		const context = await loadAuthenticatedDashboardContext(createDashboardClient({
			errors: {
				workspace_member_directory: {
					code: '42501',
					message: 'permission denied for profile alias james@example.com token=supersecret',
				},
			},
		}));

		assert.equal(context.personName, 'Signed-in user');
		assert.equal(context.workspaceName, 'Mark Nesbit Professional Workspace');
		assert.equal(logs[0]?.details.safeErrorCode, '42501');
		assert.doesNotMatch(JSON.stringify(logs), /james@example\.com|supersecret/);
	} finally {
		console.warn = originalWarn;
	}
});

test('Authenticated dashboard workspace-name failure does not replace the person name', async () => {
	const logs = [];
	const originalWarn = console.warn;
	console.warn = (event, details) => logs.push({ event, details });
	try {
		const context = await loadAuthenticatedDashboardContext(createDashboardClient({
			memberships: [activeMembership({ organisations: { ...markWorkspace, name: null } })],
			directoryRows: [directoryRow({ first_name: 'James', last_name: 'Brooks' })],
		}));

		assert.equal(context.personName, 'James Brooks');
		assert.equal(context.workspaceName, AUTHENTICATED_DASHBOARD_WORKSPACE_FALLBACK);
		assert.equal(logs[0]?.event, 'authenticated_dashboard_workspace_resolution_failed');
		assert.doesNotMatch(JSON.stringify(logs), /James|Brooks|Mark Nesbit Professional Workspace/);
	} finally {
		console.warn = originalWarn;
	}
});

test('Authenticated dashboard source resolves through auth_user_id and member directory', async () => {
	const source = await appLandingSource();

	assert.match(source, /loadAuthenticatedDashboardContext\(serverSupabase, accessToken\)/);
	assert.match(source, /data-signed-in-person/);
	assert.match(source, /data-current-workspace/);
	assert.doesNotMatch(source, /supabaseClient|from\('profiles'\)|data\.user\.email|user_metadata|app_metadata/);
});

test('Authenticated landing does not use Auth email metadata or generated aliases for display', async () => {
	const source = await appLandingSource();

	assert.doesNotMatch(source, /data\.user\.email|user\.email|user_metadata|app_metadata|full_name/);
	assert.doesNotMatch(source, /split\('@'\)|replace\(\.\/\[\\\._\+\-\]/);
	assert.doesNotMatch(source, /Fdd7f16c8161|auth alias|alias/i);
});
