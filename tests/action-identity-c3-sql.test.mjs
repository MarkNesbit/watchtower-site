import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = new URL('../supabase/migrations/20260731001100_action_actioner_workflow_identity.sql', import.meta.url);

test('C3 Actioner mutations resolve caller and stored responsibilities through membership identity', async () => {
	const sql = await readFile(migration, 'utf8');
	for (const operation of ['save_project_action_progress', 'submit_project_action', 'complete_project_action']) {
		assert.match(sql, new RegExp(`function public\\.${operation}[\\s\\S]*resolve_action_identity\\(v_action\\.organisation_id\\)`));
	}
	assert.match(sql, /project_action_resolve_stored_responsibility/);
	assert.match(sql, /v_caller\.membership_id is distinct from v_actioner\.membership_id/);
});

test('C3 enforces Actioner workflow state and direct-versus-approved completion', async () => {
	const sql = await readFile(migration, 'utf8');
	assert.match(sql, /v_action\.status not in \('open', 'returned_to_actioner'\)/);
	assert.match(sql, /if not v_action\.approval_required then raise exception 'WT_ACTION_APPROVER_REQUIRED/);
	assert.match(sql, /if v_action\.approval_required then raise exception 'WT_ACTION_APPROVER_ASSIGNED/);
	assert.match(sql, /'completion_route', 'direct'/);
	assert.match(sql, /WT_ACTION_RESPONSIBILITY_OVERLAP/);
});

test('C3 writes explicit Auth Profile and Membership history without changing deferred RPCs', async () => {
	const sql = await readFile(migration, 'utf8');
	assert.match(sql, /actor_auth_user_id, actor_membership_id/);
	assert.match(sql, /p_actor_profile_id, p_actor_auth_user_id, p_actor_membership_id/);
	for (const deferred of ['return_project_action_to_actioner', 'cancel_project_action', 'amend_project_action_brief', 'reissue_project_action']) {
		assert.doesNotMatch(sql, new RegExp(`function public\\.${deferred}`));
	}
});
