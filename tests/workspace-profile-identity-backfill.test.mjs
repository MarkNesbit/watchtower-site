import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const identityBackfillUrl = new URL('../supabase/migrations/20260722000300_workspace_profile_identity_backfill.sql', import.meta.url);
const lifecycleMigrationUrl = new URL('../supabase/migrations/20260722000100_workspace_membership_lifecycle_audit_schema.sql', import.meta.url);
const accessDocsUrl = new URL('../docs/access-foundation.md', import.meta.url);

async function identityBackfillSql() {
	return readFile(identityBackfillUrl, 'utf8');
}

function objectBlock(sql, startPattern, endPattern) {
	const start = sql.search(startPattern);
	assert.notEqual(start, -1, `Expected block start ${startPattern}`);
	const rest = sql.slice(start);
	const end = rest.search(endPattern);
	assert.notEqual(end, -1, `Expected block end ${endPattern}`);
	return rest.slice(0, end);
}

test('Profile identity backfill migration preserves existing non-blank identity values', async () => {
	const sql = await identityBackfillSql();
	const backfill = objectBlock(sql, /create or replace function public\.backfill_workspace_profile_identity_fields/, /create or replace function public\.complete_verified_user_onboarding/);

	for (const field of ['contact_email', 'login_name', 'first_name', 'last_name']) {
		assert.match(backfill, new RegExp(`nullif\\(btrim\\(profile_record\\.${field}\\), ''\\) is null`));
		assert.match(backfill, new RegExp(`else profile_record\\.${field}`));
	}
	assert.doesNotMatch(backfill, /set display_name|set email|update auth\.users/i);
	assert.match(sql, /select public\.backfill_workspace_profile_identity_fields\(\)/);
});

test('Profile identity backfill fills contact email from profile email without changing auth email', async () => {
	const sql = await identityBackfillSql();

	assert.match(sql, /contact_email = case[\s\S]*lower\(nullif\(btrim\(profile_record\.email\), ''\)\)/);
	assert.match(sql, /new\.contact_email := lower\(btrim\(new\.email\)\)/);
	assert.doesNotMatch(sql, /update\s+auth\.users|alter table auth\.users|auth\.admin/i);
	assert.match(sql, /does not modify auth\.users/);
});

test('Profile login names are normalised and duplicate-safe with deterministic suffixes', async () => {
	const sql = await identityBackfillSql();
	const lifecycleSql = await readFile(lifecycleMigrationUrl, 'utf8');

	assert.match(sql, /create or replace function public\.workspace_profile_login_name_base/);
	assert.match(sql, /lower\(coalesce\(nullif\(btrim\(raw_value\), ''\)/);
	assert.match(sql, /regexp_replace\(cleaned, '\[\^a-z0-9\._-\]\+', '\.', 'g'\)/);
	assert.match(sql, /return left\(cleaned, 64\)/);
	assert.match(sql, /create or replace function public\.workspace_profile_next_login_name/);
	assert.match(sql, /while exists \([\s\S]*from public\.profiles p[\s\S]*lower\(p\.login_name\) = candidate/);
	assert.match(sql, /suffix_text := '\.' \|\| lpad\(suffix_number::text, 2, '0'\)/);
	assert.match(sql, /candidate := left\(base_candidate, 64 - length\(suffix_text\)\) \|\| suffix_text/);
	assert.doesNotMatch(sql, /random\(|gen_random_uuid\(\).*login_name/i);
	assert.match(lifecycleSql, /create unique index profiles_login_name_normalised_key[\s\S]*lower\(login_name\)[\s\S]*where login_name is not null/);
});

test('Profile name backfill remains conservative and does not fabricate uncertain names', async () => {
	const sql = await identityBackfillSql();
	const nameParts = objectBlock(sql, /create or replace function public\.workspace_profile_safe_name_parts/, /create or replace function public\.complete_workspace_profile_identity_defaults/);

	assert.match(nameParts, /array_length\(parts, 1\) = 2/);
	assert.match(nameParts, /derived_first_name := initcap\(lower\(parts\[1\]\)\)/);
	assert.match(nameParts, /derived_last_name := initcap\(lower\(parts\[2\]\)\)/);
	assert.doesNotMatch(nameParts, /Workspace|organisation|workspace_name/);
	assert.doesNotMatch(sql, /first_name = 'Workspace'|last_name = 'User'/);
});

test('Onboarding now populates profile identity defaults without changing account identity rules', async () => {
	const sql = await identityBackfillSql();
	const onboarding = objectBlock(sql, /create or replace function public\.complete_verified_user_onboarding/, /select public\.backfill_workspace_profile_identity_fields\(\)/);

	assert.match(onboarding, /insert into public\.profiles \([\s\S]*first_name,[\s\S]*last_name,[\s\S]*login_name,[\s\S]*contact_email/);
	assert.match(onboarding, /derived_login_name := public\.workspace_profile_next_login_name\(derived_display_name, new\.id\)/);
	assert.match(onboarding, /contact_email = coalesce\(nullif\(btrim\(public\.profiles\.contact_email\), ''\), excluded\.contact_email\)/);
	assert.match(onboarding, /login_name = coalesce\(nullif\(btrim\(public\.profiles\.login_name\), ''\), excluded\.login_name\)/);
	assert.match(onboarding, /first_name = coalesce\(nullif\(btrim\(public\.profiles\.first_name\), ''\), excluded\.first_name\)/);
	assert.match(onboarding, /last_name = coalesce\(nullif\(btrim\(public\.profiles\.last_name\), ''\), excluded\.last_name\)/);
	assert.match(onboarding, /values \(workspace_id, new\.id, 'owner', 'active', now\(\)\)/);
	assert.doesNotMatch(onboarding, /signInWithPassword|login_name authentication|shared-contact/i);
});

test('Profile identity defaults are available for non-onboarding profile inserts', async () => {
	const sql = await identityBackfillSql();

	assert.match(sql, /create or replace function public\.complete_workspace_profile_identity_defaults/);
	assert.match(sql, /create trigger complete_workspace_profile_identity_defaults[\s\S]*before insert or update of email, display_name[\s\S]*on public\.profiles/);
	assert.match(sql, /new\.login_name := generated_login_name/);
	assert.match(sql, /new\.contact_email := lower\(btrim\(new\.email\)\)/);
});

test('Identity backfill documentation records boundaries and production migration need', async () => {
	const docs = await readFile(accessDocsUrl, 'utf8');

	assert.match(docs, /WT-WORKSPACE-TEAM-004-FIX-001 backfills missing values/);
	assert.match(docs, /deterministic `\.02`, `\.03` suffixes/);
	assert.match(docs, /does not modify `auth\.users\.email`/);
	assert.match(docs, /login-name authentication is not implemented/);
	assert.match(docs, /CSV upload, parsing, comparison, approval or membership mutation/);
});
