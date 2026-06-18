import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildUniqueSlug, slugifyProjectName } from '../src/lib/projectSlugs.ts';

const migrationPath = new URL('../supabase/migrations/20260617000100_create_projects.sql', import.meta.url);
const projectPolicyFixMigrationPath = new URL(
	'../supabase/migrations/20260617000200_fix_project_creation_policy_member_setting.sql',
	import.meta.url,
);

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
	const followUpSql = await readFile(projectPolicyFixMigrationPath, 'utf8');
	for (const source of [sql, followUpSql]) {
		assert.match(source, /from public\.organisation_settings os/);
		assert.match(source, /os\.organisation_id = projects\.organisation_id/);
		assert.match(source, /os\.allow_member_project_creation = true/);
	}
});

test('Follow-up migration updates an already-applied project creation policy', async () => {
	const followUpSql = await readFile(projectPolicyFixMigrationPath, 'utf8');
	assert.match(followUpSql, /drop policy if exists "Owners admins and members can create projects"/);
	assert.match(followUpSql, /drop policy if exists "Owners admins and permitted members can create projects"/);
	assert.match(followUpSql, /create policy "Owners admins and permitted members can create projects"/);
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
	assert.match(source, /client\.auth\.getUser\(/);
	assert.match(source, /const user = userData\.user/);
	assert.match(source, /if \(!user\) return null/);
	assert.match(source, /\.eq\('status', 'active'\)\s*\n\s*\.eq\('user_id', user\.id\)/);
});

test('Project list and detail render database values with safe Astro templates', async () => {
	const listSource = await readFile(new URL('../src/pages/app/projects/index.astro', import.meta.url), 'utf8');
	const detailSource = await readFile(new URL('../src/pages/app/projects/[projectId].astro', import.meta.url), 'utf8');
	for (const source of [listSource, detailSource]) {
		assert.doesNotMatch(source, /innerHTML\s*=/);
		assert.doesNotMatch(source, /<script[\s>]/);
	}
	assert.match(listSource, /{project\.name}/);
	assert.match(detailSource, /{project\.name}/);
	assert.match(listSource, /href={`\/app\/projects\/\$\{project\.slug\}`}/);
	assert.match(detailSource, /\.eq\('slug', projectSlug\)/);
	assert.match(detailSource, /formatValue\(project\.health/);
	assert.match(detailSource, /{project\.health}/);
});

test('Project pages do not use client-side imports for project flow', async () => {
	const pagePaths = [
		'../src/pages/app/projects/index.astro',
		'../src/pages/app/projects/[projectId].astro',
		'../src/pages/app/projects/new.astro',
	];
	for (const pagePath of pagePaths) {
		const source = await readFile(new URL(pagePath, import.meta.url), 'utf8');
		const renderedMarkup = source.replace(/^---[\s\S]*?---/, '');
		assert.doesNotMatch(renderedMarkup, /import \{.*\} from/);
	}
});

test('Project detail displays read-only metadata while keeping editing narrow', async () => {
	const detailSource = await readFile(new URL('../src/pages/app/projects/[projectId].astro', import.meta.url), 'utf8');
	const labels = ['Project name', 'Description', 'Status', 'Health', 'Workspace', 'Created', 'Last updated', 'Created by'];
	for (const label of labels) {
		assert.match(detailSource, new RegExp(`<dt>${label}</dt>`));
	}
	assert.match(detailSource, /Read-only metadata/);
	assert.match(detailSource, /description, slug/);
	assert.match(detailSource, /formatValue\(project\.description\)/);
	assert.match(detailSource, /formatDate\(project\.created_at\)/);
	assert.match(detailSource, /formatDate\(project\.updated_at\)/);
	assert.match(detailSource, /formatValue\(creatorDisplayName\)/);
	assert.doesNotMatch(detailSource, /<dd>{project\.created_by}<\/dd>|<dd>{project\.organisation_id}<\/dd>|data-project-id/);
});

test('Project detail edit foundation keeps RAID and dependency modelling out of scope', async () => {
	const detailSource = await readFile(new URL('../src/pages/app/projects/[projectId].astro', import.meta.url), 'utf8');
	const projectLibrarySource = await readFile(new URL('../src/lib/projects.ts', import.meta.url), 'utf8');
	const migrationFiles = await readdir(new URL('../supabase/migrations/', import.meta.url));
	assert.match(detailSource, /canEditProject = workspace\.role !== 'viewer'/);
	assert.match(detailSource, /data-view-only-project/);
	assert.match(detailSource, /Edit core details/);
	assert.match(detailSource, /name="name"/);
	assert.match(detailSource, /name="status"/);
	assert.doesNotMatch(detailSource, /name="description"|name="health"|name="created_by"|name="updated_by"|name="organisation_id"|name="slug"/);
	assert.doesNotMatch(detailSource, /data-future-route/);
	assert.doesNotMatch(projectLibrarySource, /from\('risks'\)|from\('issues'\)|from\('dependencies'\)/);
	assert.match(projectLibrarySource, /if \(workspace\.role === 'viewer'\) throw new Error\('Your workspace role does not permit project editing\.'\)/);
	assert.deepEqual(migrationFiles.filter((file) => file.includes('wt_002b') || file.includes('metadata')), []);
});
