import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const url = new URL('../supabase/migrations/20260731000900_action_identity_authority_resolver.sql', import.meta.url);
test('Action SQL identity resolver has explicit split-ID, fail-closed contract', async () => {
 const sql = await readFile(url, 'utf8');
 for (const code of ['UNAUTHENTICATED','PROFILE_NOT_FOUND','PROFILE_AMBIGUOUS','MEMBERSHIP_NOT_FOUND','MEMBERSHIP_AMBIGUOUS','MEMBERSHIP_INELIGIBLE','ACTION_NOT_FOUND','WORKSPACE_MISMATCH']) assert.match(sql, new RegExp(`WT_ACTION_IDENTITY_${code}`));
 assert.match(sql, /profile\.auth_user_id = v_auth_user_id/);
 assert.match(sql, /membership\.status = 'active'/);
 assert.match(sql, /resolve_action_identity_for_action/);
 assert.match(sql, /security definer set search_path = public/);
 assert.doesNotMatch(sql, /email|contact_email/);
});
