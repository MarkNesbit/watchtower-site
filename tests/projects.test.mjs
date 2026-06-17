import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildUniqueSlug, slugifyProjectName } from '../src/lib/projectSlugs.ts';

const migrationPath = new URL('../supabase/migrations/20260617000100_create_projects.sql', import.meta.url);

test('Project slug generation creates URL-safe slugs', () => {
	assert.equal(slugifyProjectName(' Watchtower Test Project '), 'watchtower-test-project');
	assert.equal(slugifyProjectName('München / Delivery!'), 'munchen-delivery');
	assert.equal(slugifyProjectName('***'), 'project');
});

test('Safe unique slug handling appends the next available suffix', () => {
	assert.equal(buildUniqueSlug('watchtower-test-project', []), 'watchtower-test-project');
	assert.equal(
		buildUniqueSlug('watchtower-test-project', ['watchtower-test-project', 'watchtower-test-project-2']),
		'watchtower-test-project-3',
	);
});

test('Viewer cannot create projects while owner admin and permitted members can', async () => {
	const sql = await readFile(migrationPath, 'utf8');
	assert.match(sql, /array\['owner', 'admin'\]/);
	assert.match(sql, /array\['member'\]/);
	assert.doesNotMatch(sql, /array\['owner', 'admin', 'member', 'viewer'\]/);
});

test('Members can create projects only when workspace settings allow it', async () => {
	const sql = await readFile(migrationPath, 'utf8');
	assert.match(sql, /from public\.organisation_settings os/);
	assert.match(sql, /os\.organisation_id = projects\.organisation_id/);
	assert.match(sql, /os\.allow_member_project_creation = true/);
});

test('Project records are scoped by organisation_id', async () => {
	const sql = await readFile(migrationPath, 'utf8');
	assert.match(sql, /organisation_id uuid not null references public\.organisations\(id\)/);
	assert.match(sql, /unique \(organisation_id, slug\)/);
	assert.match(sql, /is_active_organisation_member\(projects\.organisation_id\)/);
});

test('No out-of-scope tables are created', async () => {
	const sql = await readFile(migrationPath, 'utf8');
	const forbiddenTables = [
		'project_members',
		'project_responsibilities',
		'project_health_snapshots',
		'risks',
		'issues',
		'decisions',
		'actions',
		'project_relationships',
	];
	for (const table of forbiddenTables) {
		assert.doesNotMatch(sql, new RegExp(`create\\s+table\\s+(public\\.)?${table}\\b`, 'i'));
	}
});


test('Current workspace lookup is scoped to the signed-in user membership', async () => {
	const source = await readFile(new URL('../src/lib/projects.ts', import.meta.url), 'utf8');
	assert.match(source, /supabase\.auth\.getUser\(\)/);
	assert.match(source, /\.eq\('user_id', userData\.user\.id\)/);
});

test('Project list and detail render database values with safe DOM text APIs', async () => {
	const listSource = await readFile(new URL('../src/pages/app/projects/index.astro', import.meta.url), 'utf8');
	const detailSource = await readFile(new URL('../src/pages/app/projects/[projectId].astro', import.meta.url), 'utf8');
	for (const source of [listSource, detailSource]) {
		assert.doesNotMatch(source, /innerHTML\s*=/);
		assert.match(source, /textContent/);
		assert.match(source, /createElement/);
	}
	assert.match(listSource, /link\.textContent = project\.name/);
	assert.match(detailSource, /heading\.textContent = project\.name/);
	assert.match(detailSource, /description\.textContent = project\.description/);
});
