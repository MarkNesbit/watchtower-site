import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { listWorkspacePeople, workspacePeopleByIdentity, workspacePersonDisplayName } from '../src/lib/workspacePeople.ts';

const migrationUrl = new URL('../supabase/migrations/20260731000600_workspace_person_read_contract.sql', import.meta.url);

test('workspace person contract separates membership, profile and Auth IDs and filters new assignments', async () => {
	const calls = [];
	class Query {
		constructor(table) { this.table = table; this.filters = []; }
		select(value) { this.selection = value; return this; }
		eq(field, value) { this.filters.push([field, value]); return this; }
		order() { return this; }
		then(resolve, reject) {
			calls.push({ table: this.table, selection: this.selection, filters: this.filters });
			const eligibleOnly = this.filters.some(([field, value]) => field === 'assignment_eligible' && value === true);
			const rows = [
				{ organisation_id: 'workspace-a', organisation_membership_id: 'membership-active', profile_id: 'profile-ruby', auth_user_id: 'auth-ruby', first_name: 'Ruby', last_name: 'Atkinson', role: 'member', membership_status: 'active', assignment_eligible: true },
				{ organisation_id: 'workspace-a', organisation_membership_id: 'membership-invited', profile_id: 'profile-invited', auth_user_id: 'auth-invited', display_name: 'Invited Person', role: 'member', membership_status: 'invited', assignment_eligible: false },
				{ organisation_id: 'workspace-a', organisation_membership_id: 'membership-deactivated', profile_id: 'profile-history', auth_user_id: 'auth-history', role: 'viewer', membership_status: 'deactivated', assignment_eligible: false },
			];
			return Promise.resolve({ data: eligibleOnly ? rows.filter((row) => row.assignment_eligible) : rows, error: null }).then(resolve, reject);
		}
	}
	const client = { from: (table) => new Query(table) };
	const historicPeople = await listWorkspacePeople('workspace-a', client);
	const assignablePeople = await listWorkspacePeople('workspace-a', client, { eligibleOnly: true });

	assert.equal(historicPeople.length, 3);
	assert.equal(assignablePeople.length, 1);
	assert.deepEqual(
		workspacePeopleByIdentity(historicPeople).get('auth-ruby'),
		workspacePeopleByIdentity(historicPeople).get('profile-ruby'),
	);
	assert.equal(historicPeople[2].displayName, 'Workspace member membersh');
	assert.deepEqual(calls[0].filters, [['organisation_id', 'workspace-a']]);
	assert.deepEqual(calls[1].filters, [['organisation_id', 'workspace-a'], ['assignment_eligible', true]]);
});

test('workspace person display labels never use email as a fallback', () => {
	assert.equal(workspacePersonDisplayName({ first_name: 'Ruby', last_name: 'Atkinson', display_name: 'R. A.' }), 'Ruby Atkinson');
	assert.equal(workspacePersonDisplayName({ display_name: 'R. A.', login_name: 'ruby.a' }), 'R. A.');
	assert.equal(workspacePersonDisplayName({ login_name: 'ruby.a' }), 'ruby.a');
	assert.equal(workspacePersonDisplayName({}, 'Workspace member abc12345'), 'Workspace member abc12345');
});

test('workspace-person migration keeps direct profile RLS and excludes email', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	assert.match(sql, /create or replace view public\.workspace_member_directory/i);
	assert.match(sql, /p\.id as profile_id[\s\S]*om\.auth_user_id/);
	assert.match(sql, /assignment_eligible/);
	assert.match(sql, /is_active_organisation_member\(om\.organisation_id\)/);
	assert.doesNotMatch(sql, /p\.email|contact_email|auth_email/i);
});
