import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = new URL('../supabase/migrations/20260731001400_action_identity_explicit_profile_precedence.sql', import.meta.url);

test('Action resolver gives unique explicit Auth Profile linkage precedence over legacy equal-ID fallback', async () => {
	const sql = await readFile(migration, 'utf8');
	const explicit = sql.indexOf('where profile.auth_user_id = v_auth_user_id');
	const fallback = sql.indexOf('where profile.auth_user_id is null and profile.id = v_auth_user_id');
	assert.ok(explicit >= 0 && fallback > explicit);
	assert.match(sql, /if v_profile_count = 1 then[\s\S]*select profile\.id into v_profile_id[\s\S]*else[\s\S]*profile\.auth_user_id is null and profile\.id = v_auth_user_id/);
	assert.match(sql, /membership\.organisation_id = p_organisation_id[\s\S]*membership\.user_id = v_profile_id/);
});

test('Action resolver retains fail-closed ambiguity and membership checks', async () => {
	const sql = await readFile(migration, 'utf8');
	assert.equal((sql.match(/WT_ACTION_IDENTITY_PROFILE_AMBIGUOUS/g) ?? []).length, 2);
	assert.match(sql, /WT_ACTION_IDENTITY_MEMBERSHIP_NOT_FOUND/);
	assert.match(sql, /WT_ACTION_IDENTITY_MEMBERSHIP_AMBIGUOUS/);
	assert.match(sql, /security definer set search_path = public/);
	assert.match(sql, /revoke all on function public\.resolve_action_identity/);
	assert.match(sql, /grant execute on function public\.resolve_action_identity/);
});
