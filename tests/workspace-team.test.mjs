import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	buildWorkspaceTeamDisplayMembers,
	memberMatchesFilter,
	membershipStateCounts,
	membershipStatusLabel,
	workspaceRoleLabel,
	workspaceTeamLoginLabel,
	workspaceTeamPersonName,
} from '../src/lib/workspaceTeam.ts';
import { buildWorkspaceTeamPath } from '../src/lib/projectRoutes.ts';

const routeUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const headerUrl = new URL('../src/components/Header.astro', import.meta.url);
const projectRoutesUrl = new URL('../src/lib/projectRoutes.ts', import.meta.url);
const projectsUrl = new URL('../src/lib/projects.ts', import.meta.url);

async function routeSource() {
	return readFile(routeUrl, 'utf8');
}

test('Workspace Team route is workspace-scoped and active-membership guarded', async () => {
	const route = await routeSource();
	const projects = await readFile(projectsUrl, 'utf8');

	assert.match(route, /src\/pages\/app\/workspaces\/\[workspaceSlug\]\/team\.astro|Workspace Team/);
	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug \?\? '', accessToken\)/);
	assert.match(projects, /export async function getWorkspaceBySlug/);
	assert.match(projects, /\.eq\('status', 'active'\)/);
	assert.match(route, /isWorkspaceRole\(workspace\.role\)/);
	assert.doesNotMatch(route, /auth\.users|service_role|from\('profiles'\)|from\("profiles"\)/);
});

test('Workspace Team route selects the correct membership directory by role', async () => {
	const route = await routeSource();

	assert.match(route, /const canUseAdminDirectory = workspaceRole === 'owner' \|\| workspaceRole === 'admin'/);
	assert.match(route, /const directoryTable = canUseAdminDirectory \? 'workspace_member_admin_directory' : 'workspace_member_directory'/);
	assert.match(route, /\.from\(directoryTable\)/);
	assert.match(route, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(route, /organisation_membership_id/);
	assert.match(route, /profile_id/);
	assert.match(route, /\{member\.loginLabel\}/);
	assert.doesNotMatch(route, /auth_email|data-email|email as/i);
});

test('Workspace Team route exposes CSV export controls without membership mutation UI', async () => {
	const route = await routeSource();

	assert.match(route, /Download team CSV for update/);
	assert.match(route, /data-team-csv-download/);
	assert.match(route, /Download read-only copy/);
	assert.match(route, /data-read-only-team-csv-download/);
	assert.match(route, /data-team-csv-takeover/);
	assert.match(route, /data-membership-history/);
	assert.match(route, /Owner or Admin access is required for future team CSV administration/);
	assert.match(route, /No actions in this release/);
	assert.match(route, /recalculate_workspace_membership_change_proposals/);
	assert.doesNotMatch(route, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\('confirm_workspace_membership_selected_change_set'/);
});

test('Workspace Team route renders roles states filters search and accessible responsive table', async () => {
	const route = await routeSource();

	for (const label of ['Person', 'Login', 'Role', 'Status', 'Joined / invited', 'Actions']) {
		assert.match(route, new RegExp(`<th scope="col">${label.replace('/', '\\/')}`));
	}
	for (const label of ['All', 'Active', 'Invitations', 'Deactivated']) {
		assert.match(route, new RegExp(`>${label} <span>`));
	}
	assert.match(route, /role="search"/);
	assert.match(route, /type="search"/);
	assert.match(route, /data-membership-id=\{member\.organisation_membership_id\}/);
	assert.match(route, /data-profile-id=\{member\.profile_id\}/);
	assert.match(route, /aria-label=\{\`\$\{member\.displayStatus\}\. \$\{member\.statusDescription\}\`\}/);
	assert.match(route, /@media \(max-width: 900px\)/);
	assert.match(route, /content: attr\(data-label\)/);
});

test('Workspace Team helper labels do not leak database lifecycle terms', () => {
	assert.equal(membershipStatusLabel('active'), 'Active');
	assert.equal(membershipStatusLabel('invited'), 'Invited');
	assert.equal(membershipStatusLabel('invite_expired'), 'Invitation expired');
	assert.equal(membershipStatusLabel('suspended'), 'Suspended');
	assert.equal(membershipStatusLabel('deactivated'), 'Deactivated');
	assert.notEqual(membershipStatusLabel('invite_expired'), 'invite_expired');
	assert.equal(workspaceRoleLabel('owner'), 'Owner');
	assert.equal(workspaceRoleLabel('admin'), 'Admin');
	assert.equal(workspaceRoleLabel('member'), 'Member');
	assert.equal(workspaceRoleLabel('viewer'), 'Viewer');
});

test('Workspace Team helper resolves person names without inventing identity', () => {
	assert.equal(workspaceTeamPersonName({ first_name: 'Jane', last_name: 'Smith', display_name: 'J. Smith', login_name: 'jsmith', membership_status: 'active' }), 'Jane Smith');
	assert.equal(workspaceTeamPersonName({ first_name: '', last_name: '', display_name: 'Delivery Lead', login_name: 'lead1', membership_status: 'active' }), 'Delivery Lead');
	assert.equal(workspaceTeamPersonName({ first_name: null, last_name: null, display_name: null, login_name: 'viewer-01', membership_status: 'active' }), 'viewer-01');
	assert.equal(workspaceTeamPersonName({ first_name: null, last_name: null, display_name: null, login_name: null, membership_status: 'active' }), 'Workspace user');
	assert.equal(workspaceTeamPersonName({ first_name: 'Jane', last_name: 'Smith', display_name: null, login_name: 'jsmith', membership_status: 'deactivated' }), 'Jane Smith [deactivated]');
});

test('Workspace Team login display uses backfilled login names before Not set fallback', () => {
	assert.equal(workspaceTeamLoginLabel({ login_name: 'mark.nesbit', display_name: 'Mark Nesbit' }), 'mark.nesbit');
	assert.equal(workspaceTeamLoginLabel({ login_name: '   ', display_name: 'Mark Nesbit' }), 'Mark Nesbit');
	assert.equal(workspaceTeamLoginLabel({ login_name: null, display_name: null }), 'Not set');
});

test('Workspace Team helper sorts by last first login and membership UUID', () => {
	const members = [
		{ organisation_id: 'org', organisation_membership_id: 'm-3', profile_id: 'u3', first_name: 'Zoe', last_name: 'Zimmer', login_name: 'zoe', role: 'viewer', membership_status: 'active' },
		{ organisation_id: 'org', organisation_membership_id: 'm-2', profile_id: 'u2', first_name: 'Amy', last_name: 'Adams', login_name: 'amy-b', role: 'member', membership_status: 'active' },
		{ organisation_id: 'org', organisation_membership_id: 'm-1', profile_id: 'u1', first_name: 'Amy', last_name: 'Adams', login_name: 'amy-a', role: 'admin', membership_status: 'active' },
	];

	const sorted = buildWorkspaceTeamDisplayMembers(members);
	assert.deepEqual(sorted.map((member) => member.organisation_membership_id), ['m-1', 'm-2', 'm-3']);
});

test('Workspace Team filters and counts keep active invitations and deactivated memberships distinct', () => {
	const members = [
		{ organisation_id: 'org', organisation_membership_id: 'm-1', profile_id: 'u1', login_name: 'active', role: 'owner', membership_status: 'active' },
		{ organisation_id: 'org', organisation_membership_id: 'm-2', profile_id: 'u2', login_name: 'invited', role: 'member', membership_status: 'invited' },
		{ organisation_id: 'org', organisation_membership_id: 'm-3', profile_id: 'u3', login_name: 'expired', role: 'member', membership_status: 'invite_expired' },
		{ organisation_id: 'org', organisation_membership_id: 'm-4', profile_id: 'u4', login_name: 'suspended', role: 'viewer', membership_status: 'suspended' },
		{ organisation_id: 'org', organisation_membership_id: 'm-5', profile_id: 'u5', login_name: 'deactivated', role: 'viewer', membership_status: 'deactivated' },
	];

	assert.equal(memberMatchesFilter(members[0], 'active'), true);
	assert.equal(memberMatchesFilter(members[1], 'invitations'), true);
	assert.equal(memberMatchesFilter(members[2], 'invitations'), true);
	assert.equal(memberMatchesFilter(members[3], 'invitations'), false);
	assert.equal(memberMatchesFilter(members[4], 'deactivated'), true);
	assert.deepEqual(membershipStateCounts(members), {
		all: 5,
		active: 1,
		invitations: 2,
		deactivated: 1,
	});
});

test('Workspace navigation links to the workspace-level team route when a workspace is known', async () => {
	const header = await readFile(headerUrl, 'utf8');
	const projectRoutes = await readFile(projectRoutesUrl, 'utf8');

	assert.equal(buildWorkspaceTeamPath('mark-nesbit-professional-workspace'), '/app/workspaces/mark-nesbit-professional-workspace/team');
	assert.match(projectRoutes, /export function buildWorkspaceTeamPath\(workspaceSlug: string\)/);
	assert.match(header, /getCurrentWorkspace\(serverSupabase, accessToken\)/);
	assert.match(header, /buildWorkspaceTeamPath\(organisation\.slug\)/);
	assert.match(header, /workspaceTeamHref \? \{ href: workspaceTeamHref, label: 'Workspace' \} : \{ label: 'Workspace' \}/);
});
