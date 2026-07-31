import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = new URL('../supabase/migrations/20260731001200_action_approval_governance_identity.sql', import.meta.url);

test('C4 governance mutations resolve caller identity and current Approver membership', async () => {
	const sql = await readFile(migration, 'utf8');
	for (const operation of ['complete_project_action', 'return_project_action_to_actioner', 'reject_project_action', 'withdraw_project_action_approver', 'set_project_action_approver']) {
		assert.match(sql, new RegExp(`function public\\.${operation}[\\s\\S]*resolve_action_identity\\(v_action\\.organisation_id\\)`));
	}
	assert.match(sql, /project_action_assert_c4_approver/);
	assert.match(sql, /WT_ACTION_RESPONSIBILITY_OVERLAP/);
});

test('C4 preserves governance state distinctions and explicit actor audit attribution', async () => {
	const sql = await readFile(migration, 'utf8');
	assert.match(sql, /'completion_route', 'approved'/);
	assert.match(sql, /'submitted', 'returned_to_actioner'/);
	assert.match(sql, /'submitted', 'rejected_by_actioner'/);
	assert.match(sql, /approval_required = false/);
	assert.match(sql, /actor_auth_user_id, actor_membership_id/);
});

test('C4 leaves C5 administrative RPC definitions outside this migration', async () => {
	const sql = await readFile(migration, 'utf8');
	for (const deferred of ['cancel_project_action', 'amend_project_action_brief', 'change_project_action_due_date', 'reissue_project_action']) {
		assert.doesNotMatch(sql, new RegExp(`function public\\.${deferred}`));
	}
});
