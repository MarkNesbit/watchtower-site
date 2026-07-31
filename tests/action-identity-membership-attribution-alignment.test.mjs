import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = new URL('../supabase/migrations/20260731001600_action_membership_attribution_schema_alignment.sql', import.meta.url);
const actionLibrary = new URL('../src/lib/projectActions.ts', import.meta.url);
const peopleLibrary = new URL('../src/lib/workspacePeople.ts', import.meta.url);

test('Actioner reassignment uses the stored-responsibility resolver, not a non-existent organisation_members.membership_id column', async () => {
	const sql = await readFile(migration, 'utf8');
	assert.match(sql, /create or replace function public\.assign_project_action/);
	assert.match(sql, /resolve_action_identity\(v_action\.organisation_id\)/);
	assert.match(sql, /project_action_resolve_responsibility_membership\(v_action\.organisation_id, p_actioner_id\)/);
	assert.match(sql, /project_action_resolve_stored_responsibility\([\s\S]*v_action\.acceptance_owner_id/);
	assert.doesNotMatch(sql, /select\s+membership_id\s+into[\s\S]*from\s+public\.organisation_members/i);
	assert.match(sql, /if v_action\.approval_required then/);
	assert.match(sql, /project_action_insert_c4_history/);
	assert.match(sql, /security definer[\s\S]*set search_path = public/);
	assert.match(sql, /grant execute on function public\.assign_project_action/);
});

test('Action detail history reads the explicit C2-C5 audit attribution fields and workspace directory keeps its explicit membership name', async () => {
	const [actions, people] = await Promise.all([readFile(actionLibrary, 'utf8'), readFile(peopleLibrary, 'utf8')]);
	assert.match(actions, /'actor_auth_user_id'/);
	assert.match(actions, /'actor_membership_id'/);
	assert.match(actions, /actor_auth_user_id: string \| null/);
	assert.match(actions, /actor_membership_id: string \| null/);
	assert.match(people, /organisation_membership_id/);
	assert.doesNotMatch(people, /WORKSPACE_PERSON_SELECT\s*=\s*['"][^'"]*\bmembership_id\b/);
});
