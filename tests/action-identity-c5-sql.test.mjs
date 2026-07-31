import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = new URL('../supabase/migrations/20260731001300_action_administrative_lifecycle_identity.sql', import.meta.url);

test('C5 administrative Action mutations use the canonical resolver and atomic audit history', async () => {
	const sql = await readFile(migration, 'utf8');
	for (const operation of ['cancel_project_action', 'amend_project_action_brief', 'change_project_action_due_date', 'reissue_project_action', 'take_over_project_action_acceptance']) {
		assert.match(sql, new RegExp(`function public\\.${operation}[\\s\\S]*resolve_action_identity`));
	}
	assert.match(sql, /project_action_insert_c4_history/);
	assert.match(sql, /c\.auth_user_id,c\.profile_id,c\.membership_id/);
});

test('C5 narrows takeover to explicit project governance roles', async () => {
	const sql = await readFile(migration, 'utf8');
	assert.match(sql, /project_role in \('project_manager','product_owner','delivery_lead'\)/);
	assert.match(sql, /Actioner cannot take over approval/);
	assert.match(sql, /WT_ACTION_MISSING_REASON/);
});
