import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { WORKSPACE_ROLES, can } from '../src/lib/permissions.ts';

const foundationMigration = new URL('../supabase/migrations/20260614000200_create_foundation_tables.sql', import.meta.url);
const rlsMigration = new URL('../supabase/migrations/20260614000300_enable_rls_and_baseline_policies.sql', import.meta.url);
const onboardingMigration = new URL('../supabase/migrations/20260614000600_create_auth_onboarding.sql', import.meta.url);

function tableDefinition(sql, tableName) {
	const start = sql.indexOf(`create table public.${tableName} (`);
	assert.notEqual(start, -1, `Expected ${tableName} table definition`);
	const end = sql.indexOf(');', start);
	assert.notEqual(end, -1, `Expected ${tableName} table terminator`);
	return sql.slice(start, end + 2);
}

test('Profiles are lightweight account identity records linked to Supabase users', async () => {
	const sql = await readFile(foundationMigration, 'utf8');
	assert.match(sql, /create table public\.profiles \(/);
	assert.match(sql, /id uuid primary key references auth\.users\(id\) on delete cascade/);
	assert.match(sql, /email text not null/);
	assert.match(sql, /display_name text not null/);
	assert.match(sql, /avatar_url text/);
	assert.match(sql, /created_at timestamptz not null default now\(\)/);
	assert.match(sql, /updated_at timestamptz not null default now\(\)/);
	const profileTable = tableDefinition(sql, 'profiles');
	assert.doesNotMatch(profileTable, /\b(global_role|workspace_role|organisation_role|role|permissions|recovery_email|secondary_email|persona)\b/i);
});

test('Verified auth onboarding creates or refreshes one profile for the auth user', async () => {
	const sql = await readFile(onboardingMigration, 'utf8');
	assert.match(sql, /after insert or update of email_confirmed_at on auth\.users/);
	assert.match(sql, /if new\.email_confirmed_at is null then\s+return new;\s+end if;/);
	assert.match(sql, /insert into public\.profiles \(id, email, display_name, created_by, updated_by\)/);
	assert.match(sql, /values \(new\.id, new\.email, derived_display_name, new\.id, new\.id\)/);
	assert.match(sql, /on conflict \(id\) do update\s+set email = excluded\.email/);
	assert.match(sql, /derive_display_name_from_email\(new\.email\)/);
});

test('Workspace roles are fixed and stored on organisation membership, not profile data', async () => {
	const sql = await readFile(foundationMigration, 'utf8');
	assert.deepEqual([...WORKSPACE_ROLES], ['owner', 'admin', 'member', 'viewer']);
	assert.match(sql, /create table public\.organisation_members \(/);
	assert.match(sql, /role text not null default 'member'/);
	assert.match(sql, /constraint organisation_members_role_check check \(role in \('owner', 'admin', 'member', 'viewer'\)\)/);
	const profileTable = tableDefinition(sql, 'profiles');
	assert.doesNotMatch(profileTable, /\brole\s+text\b/i);
});

test('Central permission helper denies write permissions to viewer and unknown profile-like values', () => {
	assert.equal(can('viewer', 'project.view'), true);
	assert.equal(can('viewer', 'project.create'), false);
	assert.equal(can('viewer', 'project.editDetails'), false);
	assert.equal(can('admin', 'project.editDetails'), true);
	assert.equal(can({ role: 'owner' }, 'project.create'), false);
	assert.equal(can('global_admin', 'project.create'), false);
});

test('RLS access helper requires active membership and role membership rather than profile attributes', async () => {
	const sql = await readFile(rlsMigration, 'utf8');
	assert.match(sql, /create or replace function public\.is_active_organisation_member/);
	assert.match(sql, /where om\.organisation_id = target_organisation_id\s+and om\.user_id = target_user_id\s+and om\.status = 'active'/);
	assert.match(sql, /create or replace function public\.has_active_organisation_role/);
	assert.match(sql, /and om\.role = any\(allowed_roles\)/);
	assert.doesNotMatch(sql, /from public\.profiles[\s\S]*role/i);
});
