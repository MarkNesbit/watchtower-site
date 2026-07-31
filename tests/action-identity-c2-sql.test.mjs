import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = new URL('../supabase/migrations/20260731001000_action_creation_responsibility_identity.sql', import.meta.url);

test('C2 Action creation and responsibility mutations use the authoritative resolver', async () => {
	const sql = await readFile(migration, 'utf8');
	assert.match(sql, /create function public\.create_project_action[\s\S]*resolve_action_identity\(v_organisation_id\)/);
	assert.match(sql, /create or replace function public\.assign_project_action[\s\S]*resolve_action_identity\(v_action\.organisation_id\)/);
	assert.match(sql, /create or replace function public\.set_project_action_approver[\s\S]*resolve_action_identity\(v_action\.organisation_id\)/);
	assert.match(sql, /project_action_resolve_responsibility_membership[\s\S]*om\.status = 'active'/);
	assert.match(sql, /project_action_resolve_responsibility_membership\(v_action\.organisation_id, p_actioner_id\)/);
});

test('C2 keeps profile-keyed responsibility storage behind membership translation and records explicit audit identity', async () => {
	const sql = await readFile(migration, 'utf8');
	assert.match(sql, /created_by_auth_user_id uuid references auth\.users/);
	assert.match(sql, /actor_auth_user_id uuid references auth\.users/);
	assert.match(sql, /actor_membership_id uuid references public\.organisation_members/);
	assert.match(sql, /v_actioner\.profile_id/);
	assert.match(sql, /v_approver\.profile_id/);
	assert.match(sql, /project_action_insert_c2_history/);
	assert.match(sql, /approval_required boolean not null default false/);
});

test('C2 blocks Actioner and Approver overlap at every converted mutation boundary', async () => {
	const sql = await readFile(migration, 'utf8');
	const overlap = sql.match(/WT_ACTION_RESPONSIBILITY_OVERLAP/g) ?? [];
	assert.equal(overlap.length, 3);
	assert.match(sql, /raiser, Project Manager, Product Owner or Delivery Manager/);
	assert.match(sql, /project_role in \('project_manager', 'product_owner', 'delivery_lead'\)/);
});

test('C2 grants only the converted RPCs and leaves deferred lifecycle RPC definitions absent', async () => {
	const sql = await readFile(migration, 'utf8');
	assert.match(sql, /grant execute on function public\.create_project_action/);
	assert.match(sql, /grant execute on function public\.assign_project_action/);
	assert.match(sql, /grant execute on function public\.set_project_action_approver/);
	for (const deferred of ['save_project_action_progress', 'submit_project_action', 'complete_project_action', 'return_project_action_to_actioner', 'reject_project_action', 'cancel_project_action', 'amend_project_action_brief', 'reissue_project_action']) {
		assert.doesNotMatch(sql, new RegExp(`create (?:or replace )?function public\\.${deferred}`));
	}
});
