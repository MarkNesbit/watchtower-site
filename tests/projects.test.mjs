import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildUniqueSlug, slugifyProjectName } from '../src/lib/projectSlugs.ts';
import { can } from '../src/lib/permissions.ts';

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
	assert.match(detailSource, /formatValue\(project\.health,\s*'Not assessed'\)/);
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


test('Permission helper maps existing workspace roles to project permissions', () => {
	for (const role of ['owner', 'admin', 'member']) {
		assert.equal(can(role, 'project.view'), true);
		assert.equal(can(role, 'project.create'), true);
		assert.equal(can(role, 'project.viewDashboard'), true);
		assert.equal(can(role, 'project.editDetails'), true);
	}
	assert.equal(can('viewer', 'project.view'), true);
	assert.equal(can('viewer', 'project.viewDashboard'), true);
	assert.equal(can('viewer', 'project.create'), false);
	assert.equal(can('viewer', 'project.editDetails'), false);
	assert.equal(can('unknown', 'project.view'), false);
});

test('Project dashboard is read-only and displays metadata including description', async () => {
	const detailSource = await readFile(new URL('../src/pages/app/projects/[projectId].astro', import.meta.url), 'utf8');
	const labels = ['Project name', 'Description', 'Status', 'Health', 'Workspace', 'Created', 'Last updated', 'Created by'];
	for (const label of labels) {
		assert.match(detailSource, new RegExp(`<dt>${label}</dt>`));
	}
	assert.match(detailSource, /data-project-dashboard/);
	assert.match(detailSource, /Read-only metadata/);
	assert.match(detailSource, /description, slug/);
	assert.match(detailSource, /formatValue\(project\.description\)/);
	assert.match(detailSource, /formatDate\(project\.created_at\)/);
	assert.match(detailSource, /formatDate\(project\.updated_at\)/);
	assert.match(detailSource, /formatValue\(creatorDisplayName\)/);
	assert.match(detailSource, /\.eq\('slug', projectSlug\)/);
	assert.match(detailSource, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(detailSource, /\.is\('deleted_at', null\)/);
	assert.match(detailSource, /\.is\('archived_at', null\)/);
	assert.doesNotMatch(detailSource, /<form\b|<input\b|<select\b|<textarea\b|type="submit"|Save project/);
	assert.doesNotMatch(detailSource, /<dd>{project\.created_by}<\/dd>|<dd>{project\.organisation_id}<\/dd>|data-project-id/);
});

test('Project dashboard edit action is visible to all viewers and active only for permitted roles', async () => {
	const detailSource = await readFile(new URL('../src/pages/app/projects/[projectId].astro', import.meta.url), 'utf8');
	assert.match(detailSource, /canEditProject = can\(workspace\.role, 'project\.editDetails'\)/);
	assert.match(detailSource, /data-edit-project-action/);
	assert.match(detailSource, /Edit project details/);
	assert.match(detailSource, /href={`\/app\/projects\/\$\{project\.slug\}\/edit`}/);
	assert.match(detailSource, /data-disabled-edit-action/);
	assert.match(detailSource, /aria-disabled="true"/);
	assert.match(detailSource, /You do not have permission to edit project details\./);
});

test('Project edit route enforces permission and only exposes safe editable fields', async () => {
	const editSource = await readFile(new URL('../src/pages/app/projects/[projectId]/edit.astro', import.meta.url), 'utf8');
	assert.match(editSource, /data-project-edit-form/);
	assert.match(editSource, /canEditProject = can\(workspace\.role, 'project\.editDetails'\)/);
	assert.match(editSource, /Astro\.request\.method === 'POST' && canEditProject/);
	assert.match(editSource, /You do not have permission to edit project details\./);
	assert.match(editSource, /name="name"/);
	assert.match(editSource, /name="description"/);
	assert.match(editSource, /name="status"/);
	assert.match(editSource, /Health: <strong>{formatValue\(project\.health, 'Not assessed'\)}<\/strong>/);
	assert.doesNotMatch(editSource, /name="health"|name="created_by"|name="updated_by"|name="organisation_id"|name="slug"/);
	assert.match(editSource, /\.eq\('slug', projectSlug\)/);
	assert.match(editSource, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(editSource, /\.is\('deleted_at', null\)/);
	assert.match(editSource, /\.is\('archived_at', null\)/);
});

test('Project update helper rejects unsafe updates and preserves omitted description', async () => {
	const projectLibrarySource = await readFile(new URL('../src/lib/projects.ts', import.meta.url), 'utf8');
	assert.match(projectLibrarySource, /if \(!name\) throw new Error\('Project name is required\.'\)/);
	assert.match(projectLibrarySource, /if \(!isProjectStatus\(input\.status\)\) throw new Error\('Select a valid project status\.'\)/);
	assert.match(projectLibrarySource, /assertCan\(workspace\.role, 'project\.editDetails'/);
	assert.match(projectLibrarySource, /const updatePayload: \{ name: string; status: ProjectStatus; description\?: string \| null \}/);
	assert.match(projectLibrarySource, /Object\.prototype\.hasOwnProperty\.call\(input, 'description'\)/);
	assert.match(projectLibrarySource, /update\(updatePayload\)/);
	assert.doesNotMatch(projectLibrarySource, /update\(\{ name, status: input\.status, description: input\.description/);
});

test('WT-002C keeps migrations, admin invite permissions tables, routing and future models out of scope', async () => {
	const migrationFiles = await readdir(new URL('../supabase/migrations/', import.meta.url));
	const sourceFiles = [
		await readFile(new URL('../src/lib/projects.ts', import.meta.url), 'utf8'),
		await readFile(new URL('../src/lib/permissions.ts', import.meta.url), 'utf8'),
		await readFile(new URL('../src/pages/app/projects/[projectId].astro', import.meta.url), 'utf8'),
		await readFile(new URL('../src/pages/app/projects/[projectId]/edit.astro', import.meta.url), 'utf8'),
	].join('\n');
	assert.deepEqual(migrationFiles.filter((file) => file.includes('wt_002c') || file.includes('permissions')), []);
	assert.doesNotMatch(sourceFiles, /from\('project_permissions'\)|create\s+table\s+(public\.)?project_permissions/i);
	assert.doesNotMatch(sourceFiles, /invite|invitation|admin panel/i);
	assert.doesNotMatch(sourceFiles, /data-future-route|workspaceSlug|organisationSlug|\[workspace/);
	assert.doesNotMatch(sourceFiles, /from\('risks'\)|from\('issues'\)|from\('dependencies'\)|RAID|programme|portfolio|Red\/Amber\/Green/);
});
