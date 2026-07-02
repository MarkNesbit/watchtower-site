import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildUniqueSlug, slugifyProjectName } from '../src/lib/projectSlugs.ts';
import { can } from '../src/lib/permissions.ts';
import {
	buildProjectDetailsPath,
	buildProjectEditPath,
	buildProjectNarrativePath,
	buildProjectNewRiskPath,
	buildProjectPath,
	buildProjectRiskEditPath,
	buildProjectRiskPath,
	buildProjectRisksPath,
} from '../src/lib/projectRoutes.ts';

const migrationPath = new URL('../supabase/migrations/20260617000100_create_projects.sql', import.meta.url);
const projectPolicyFixMigrationPath = new URL(
	'../supabase/migrations/20260617000200_fix_project_creation_policy_member_setting.sql',
	import.meta.url,
);

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function projectAreasSource(source) {
	const start = source.indexOf('title="Project areas"');
	const end = source.indexOf('label="Read-only metadata"', start);
	return source.slice(start, end);
}

test('Project slug generation creates URL-safe slugs', () => {
	assert.equal(slugifyProjectName(' Watchtower Test Project '), 'watchtower-test-project');
	assert.equal(slugifyProjectName('München / Delivery!'), 'munchen-delivery');
	assert.equal(slugifyProjectName('***'), 'project');
});

test('Project route helpers build workspace-safe risk paths', () => {
	assert.equal(buildProjectPath('alpha-workspace', 'delivery-hub'), '/app/workspaces/alpha-workspace/projects/delivery-hub');
	assert.equal(buildProjectDetailsPath('alpha-workspace', 'delivery-hub'), '/app/workspaces/alpha-workspace/projects/delivery-hub/details');
	assert.equal(buildProjectRisksPath('alpha-workspace', 'delivery-hub'), '/app/workspaces/alpha-workspace/projects/delivery-hub/risks');
	assert.equal(buildProjectNewRiskPath('alpha-workspace', 'delivery-hub'), '/app/workspaces/alpha-workspace/projects/delivery-hub/risks/new');
	assert.equal(
		buildProjectRiskPath('alpha workspace', 'delivery hub', 'risk/id'),
		'/app/workspaces/alpha%20workspace/projects/delivery%20hub/risks/risk%2Fid',
	);
	assert.equal(
		buildProjectRiskEditPath('alpha workspace', 'delivery hub', 'risk/id'),
		'/app/workspaces/alpha%20workspace/projects/delivery%20hub/risks/risk%2Fid/edit',
	);
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
	const detailSource = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	for (const source of [listSource, detailSource]) {
		assert.doesNotMatch(source, /innerHTML\s*=/);
		assert.doesNotMatch(source, /<script[\s>]/);
	}
	assert.match(listSource, /{project\.name}/);
	assert.match(detailSource, /{project\.name}/);
	assert.match(listSource, /buildProjectPath\(workspaceSlug, project\.slug\)/);
	assert.match(listSource, /workspaceSlug = organisation\.slug/);
	assert.match(detailSource, /\.eq\('slug', projectSlug\)/);
	assert.match(detailSource, /formatValue\(project\.health,\s*'Not assessed'\)/);
});

test('Project pages do not use client-side imports for project flow', async () => {
	const pagePaths = [
		'../src/pages/app/projects/index.astro',
		'../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro',
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
	const detailSource = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	const labels = ['Description', 'Status', 'Health', 'Created', 'Last updated', 'Created by'];
	for (const label of labels) {
		assert.match(detailSource, new RegExp(`<dt>${label}</dt>`));
	}
	assert.match(detailSource, /data-project-dashboard/);
	assert.match(detailSource, /import ProjectPageHero/);
	assert.match(detailSource, /import ProjectControlPanel/);
	assert.match(detailSource, /import ProjectContentPanel/);
	assert.match(detailSource, /import RagReferencePill/);
	assert.match(detailSource, /<ProjectPageHero[\s\S]*workspaceName=\{workspaceName\}[\s\S]*projectName=\{project\.name\}[\s\S]*projectRef=\{project\.project_ref\}[\s\S]*title="Project Dashboard"/);
	assert.match(detailSource, /<ProjectControlPanel title="Project status"/);
	assert.match(detailSource, /<ProjectContentPanel[\s\S]*title="Project areas"[\s\S]*helper="Open a project capability or review its current availability\."/);
	assert.doesNotMatch(detailSource, /label="Capability hub"|CAPABILITY HUB|Capability hub/);
	assert.match(detailSource, /project-dashboard-areas-heading\) \{\s*font-size: clamp\(1\.45rem, 2\.4vw, 2rem\);/);
	assert.match(detailSource, /<ProjectContentPanel[\s\S]*label="Read-only metadata"[\s\S]*title="Key details"/);
	assert.match(detailSource, /<RagReferencePill[\s\S]*tone=\{healthTone\(project\.health\)\}/);
	assert.doesNotMatch(detailSource, /project-dashboard__bar|project-dashboard__workspace|project-hero-card|project-pills|rag-timeline/);
	assert.match(detailSource, /Read-only metadata/);
	assert.match(detailSource, /Project Details/);
	assert.match(detailSource, /buildProjectDetailsPath\(workspaceSlug \?\? '', project\.slug\)/);
	assert.match(detailSource, /description, slug/);
	assert.match(detailSource, /formatValue\(project\.description\)/);
	assert.match(detailSource, /formatDate\(project\.created_at\)/);
	assert.match(detailSource, /formatDate\(project\.updated_at\)/);
	assert.match(detailSource, /formatValue\(creatorDisplayName\)/);
	assert.match(detailSource, /\.eq\('slug', projectSlug\)/);
	assert.match(detailSource, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(detailSource, /getWorkspaceBySlug\(serverSupabase, workspaceSlug \?\? '', accessToken\)/);
	assert.match(detailSource, /\.is\('deleted_at', null\)/);
	assert.match(detailSource, /\.is\('archived_at', null\)/);
	assert.doesNotMatch(detailSource, /<form\b|<input\b|<select\b|<textarea\b|type="submit"|Save project/);
	assert.doesNotMatch(detailSource, /<dd>{project\.created_by}<\/dd>|<dd>{project\.organisation_id}<\/dd>|data-project-id/);
	assert.doesNotMatch(detailSource, /<dt>Project name<\/dt>|<dt>Project reference<\/dt>|<dt>Workspace<\/dt>/);
});

test('Project dashboard capability tiles lead with Project Narrative while keeping Timeline separate', async () => {
	const detailSource = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	const narrativeIndex = detailSource.indexOf("title: 'Project Narrative'");
	const timelineIndex = detailSource.indexOf("title: 'Timeline'");
	const risksIndex = detailSource.indexOf("title: 'Risks'");

	assert.notEqual(narrativeIndex, -1);
	assert.match(detailSource, /title: 'Project Details'[\s\S]*?ariaLabel: 'Open Project Details, Informational state'[\s\S]*?destination: 'details'/);
	assert.match(detailSource, /title: 'Project Narrative'[\s\S]*?destination: 'narrative',[\s\S]*?featureKey: 'projectDiary'/);
	assert.ok(narrativeIndex < timelineIndex);
	assert.ok(timelineIndex < risksIndex);
	assert.match(detailSource, /title: 'Timeline'.*href: '#timeline'/);
	assert.match(detailSource, /buildProjectNarrativePath\(workspaceSlug \?\? '', project\.slug\)/);
});

test('Project dashboard areas tiles render icon and title only with equal square sizing and RAG state', async () => {
	const detailSource = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	const areasSource = projectAreasSource(detailSource);
	const ragStyles = await readFile(new URL('../src/styles/rag.css', import.meta.url), 'utf8');
	const removedCopy = [
		'View setup, context, roles and responsibilities.',
		'View key project events, updates, decisions and history.',
		'Not assessed',
		'Open risk management',
		'No data yet',
	];

	assert.match(areasSource, /<span class="dashboard-tile__icon" aria-hidden="true">\{tile\.icon\}<\/span>/);
	assert.match(areasSource, /<strong>\{tile\.title\}<\/strong>/);
	assert.match(areasSource, /<article[\s\S]*?dashboard-tile--unavailable[\s\S]*?rag-tile--attention-\$\{tile\.attentionTone \?\? 'unknown'\}[\s\S]*?aria-disabled="true"[\s\S]*?aria-label=\{tile\.ariaLabel \?\? `\$\{tile\.title\} unavailable, \$\{tile\.statusLabel \?\? 'Unknown state'\}`\}[\s\S]*?tabindex="0"/);
	assert.match(areasSource, /<a[\s\S]*?class={`dashboard-tile[\s\S]*?rag-tile--attention-\$\{tile\.attentionTone \?\? 'neutral'\}[\s\S]*?href=\{tile\.href\}[\s\S]*?aria-label=\{tile\.ariaLabel \?\? `Open \$\{tile\.title\}, \$\{tile\.statusLabel \?\? 'Neutral state'\}`\}/);
	assert.match(areasSource, /data-rag-tile-state=\{tile\.attentionTone \?\? 'unknown'\}/);
	assert.match(areasSource, /data-rag-tile-state=\{tile\.attentionTone \?\? 'neutral'\}/);
	assert.doesNotMatch(areasSource, /<small|tile\.line|aria-describedby=\{`dashboard-tile-help-/);
	for (const copy of removedCopy) {
		assert.doesNotMatch(areasSource, new RegExp(escapeRegExp(copy)));
	}
	assert.match(ragStyles, /\.rag-tile/);
	assert.match(ragStyles, /\.rag-tile--attention-red/);
	assert.match(ragStyles, /\.visually-hidden/);
	assert.match(detailSource, /\.dashboard-tile-grid \{[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(9\.5rem, 10\.75rem\)\);[\s\S]*?justify-content: center;/);
	assert.match(detailSource, /\.dashboard-tile \{[\s\S]*?aspect-ratio: 1;/);
	assert.match(detailSource, /\.dashboard-tile strong \{[\s\S]*?min-height: 2\.8rem;[\s\S]*?line-height: 1\.18;/);
	assert.doesNotMatch(detailSource, /\.dashboard-tile--unavailable\s*\{[^}]*opacity:/);
	assert.doesNotMatch(detailSource, /\.dashboard-tile--unavailable:hover/);
});

test('Project dashboard Risk tile uses shared RAG assurance state styling', async () => {
	const detailSource = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');

	assert.match(detailSource, /import \{[\s\S]*deriveProjectRiskDashboardAssuranceTone,[\s\S]*listProjectRisks,[\s\S]*riskAssuranceToneLabel/);
	assert.match(detailSource, /let riskDashboardIconTone: RiskDashboardAssuranceTone = 'neutral'/);
	assert.match(detailSource, /riskFeatureAccess\.isAccessible && can\(workspace\.role, 'risk\.view'\)/);
	assert.match(detailSource, /listProjectRisks\(organisation\.id, project\.id, workspace\.role, serverSupabase\)/);
	assert.match(detailSource, /deriveProjectRiskDashboardAssuranceTone\(risks, new Date\(\)\)/);
	assert.match(detailSource, /riskDashboardIconLabel\(riskDashboardIconTone\)/);
	assert.match(detailSource, /attentionTone: riskDashboardIconTone/);
	assert.match(detailSource, /statusLabel: riskDashboardIconTone === 'neutral' \? 'No active risks recorded' : `\$\{riskAssuranceToneLabel\(riskDashboardIconTone\)\} assurance state`/);
	assert.match(detailSource, /aria-label=\{tile\.ariaLabel \?\? `\$\{tile\.title\} unavailable, \$\{tile\.statusLabel \?\? 'Unknown state'\}`\}/);
	assert.match(detailSource, /aria-label=\{tile\.ariaLabel \?\? `Open \$\{tile\.title\}, \$\{tile\.statusLabel \?\? 'Neutral state'\}`\}/);
	assert.match(detailSource, /data-risk-icon-state=\{tile\.destination === 'risks' \? tile\.iconTone : undefined\}/);
	assert.match(detailSource, /data-rag-tile-state=\{tile\.attentionTone \?\? 'neutral'\}/);
	assert.match(detailSource, /dashboard-tile--icon-\$\{tile\.iconTone \?\? 'default'\}/);
	assert.match(detailSource, /rag-tile--attention-\$\{tile\.attentionTone \?\? 'neutral'\}/);
	assert.match(detailSource, /\.dashboard-tile__icon \{[\s\S]*?color: var\(--rag-icon-tone, var\(--tile-icon-status, var\(--tile-status\)\)\)/);
	for (const tone of ['green', 'amber', 'red', 'neutral']) {
		assert.match(detailSource, new RegExp(`dashboard-tile--icon-${tone}`));
	}
	assert.doesNotMatch(detailSource, /badge|count|dot|notification|attention-item|attentionItems|healthScore/i);
});

test('Project dashboard links to Project Details as the controlled detail surface', async () => {
	const detailSource = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	assert.match(detailSource, /canEditProject = can\(workspace\.role, 'project\.editDetails'\)/);
	assert.match(detailSource, /data-project-details-action/);
	assert.match(detailSource, /Project details/);
	assert.match(detailSource, /title: 'Project Details'/);
	assert.match(detailSource, /destination: 'details'/);
	assert.match(detailSource, /buildProjectDetailsPath\(workspaceSlug \?\? '', project\.slug\)/);
	assert.doesNotMatch(detailSource, /data-edit-project-action/);
	assert.match(detailSource, /You do not have permission to edit project details\./);
});

test('Project edit route enforces permission and only exposes safe editable fields', async () => {
	const editSource = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/edit.astro', import.meta.url), 'utf8');
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
	assert.match(editSource, /getWorkspaceBySlug\(serverSupabase, workspaceSlug \?\? '', accessToken\)/);
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

test('Project routing keeps migrations, admin invite permissions tables and future models out of scope', async () => {
	const migrationFiles = await readdir(new URL('../supabase/migrations/', import.meta.url));
	const sourceFiles = [
		await readFile(new URL('../src/lib/projects.ts', import.meta.url), 'utf8'),
		await readFile(new URL('../src/lib/permissions.ts', import.meta.url), 'utf8'),
		await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8'),
		await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/edit.astro', import.meta.url), 'utf8'),
	].join('\n');
	assert.deepEqual(migrationFiles.filter((file) => file.includes('wt_002c') || file.includes('permissions')), []);
	assert.doesNotMatch(sourceFiles, /from\('project_permissions'\)|create\s+table\s+(public\.)?project_permissions/i);
	assert.doesNotMatch(sourceFiles, /invite|invitation|admin panel/i);
	assert.doesNotMatch(sourceFiles, /from\('risks'\)|from\('issues'\)|from\('dependencies'\)|RAID|programme|portfolio|Red\/Amber\/Green/);
});

test('Workspace-scoped project route builders use readable slugs for every project destination', () => {
	assert.equal(buildProjectPath('client-alpha', 'health-check'), '/app/workspaces/client-alpha/projects/health-check');
	assert.equal(buildProjectDetailsPath('client-alpha', 'health-check'), '/app/workspaces/client-alpha/projects/health-check/details');
	assert.equal(buildProjectEditPath('client-alpha', 'health-check'), '/app/workspaces/client-alpha/projects/health-check/edit');
	assert.equal(buildProjectRisksPath('client-alpha', 'health-check'), '/app/workspaces/client-alpha/projects/health-check/risks');
	assert.equal(buildProjectNarrativePath('client-alpha', 'health-check'), '/app/workspaces/client-alpha/projects/health-check/narrative');
	for (const route of [
		buildProjectPath('workspace-a', 'same-slug'),
		buildProjectPath('workspace-b', 'same-slug'),
	]) {
		assert.doesNotMatch(route, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
	}
	assert.notEqual(buildProjectPath('workspace-a', 'same-slug'), buildProjectPath('workspace-b', 'same-slug'));
});

test('Workspace lookup requires the authenticated user active membership and workspace slug', async () => {
	const source = await readFile(new URL('../src/lib/projects.ts', import.meta.url), 'utf8');
	assert.match(source, /export async function getWorkspaceBySlug/);
	assert.match(source, /organisations!inner\(id, name, slug\)/);
	assert.match(source, /\.eq\('status', 'active'\)\s*\n\s*\.eq\('user_id', user\.id\)\s*\n\s*\.eq\('organisations\.slug', workspaceSlug\)/);
});

test('Every workspace-scoped project page binds project slug to the matched workspace', async () => {
	for (const pagePath of [
		'../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro',
		'../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/details.astro',
		'../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/edit.astro',
		'../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro',
		'../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/narrative.astro',
	]) {
		const source = await readFile(new URL(pagePath, import.meta.url), 'utf8');
		assert.match(source, /getWorkspaceBySlug\(serverSupabase, workspaceSlug \?\? '', accessToken\)/);
		assert.match(source, /\.eq\('slug', projectSlug\)/);
		assert.match(source, /\.eq\('organisation_id', organisation\.id\)/);
		assert.match(source, /\.is\('deleted_at', null\)/);
		assert.match(source, /\.is\('archived_at', null\)/);
	}
});

test('Legacy project routes redirect only one accessible match and block ambiguity', async () => {
	const librarySource = await readFile(new URL('../src/lib/projects.ts', import.meta.url), 'utf8');
	assert.match(librarySource, /export async function getAccessibleProjectsBySlug/);
	assert.match(librarySource, /\.in\('organisation_id', activeWorkspaces\.map\(\(workspace\) => workspace\.id\)\)/);
	assert.match(librarySource, /\.eq\('slug', projectSlug\)/);
	assert.match(librarySource, /\.is\('deleted_at', null\)/);
	assert.match(librarySource, /\.is\('archived_at', null\)/);
	for (const pagePath of [
		'../src/pages/app/projects/[projectId].astro',
		'../src/pages/app/projects/[projectId]/edit.astro',
		'../src/pages/app/projects/[projectId]/risks.astro',
	]) {
		const source = await readFile(new URL(pagePath, import.meta.url), 'utf8');
		assert.match(source, /getAccessibleProjectsBySlug\(serverSupabase, projectSlug, accessToken\)/);
		assert.match(source, /if \(projects\.length === 1\)/);
		assert.match(source, /if \(projects\.length === 0\)/);
		assert.match(source, /Astro\.response\.status = 409/);
		assert.match(source, /projects\.map\(\(project\) =>/);
	}
});

import { buildUniqueProjectRef, isValidProjectRef, normaliseProjectRef, projectRefValidationMessage, suggestProjectRef } from '../src/lib/projectRefs.ts';

const projectReferenceMigrationPath = new URL('../supabase/migrations/20260624000100_project_reference_code_foundation.sql', import.meta.url);

test('Project reference generator creates short distinctive uppercase references', () => {
	assert.equal(suggestProjectRef('Hive Health Hub'), 'HHH');
	assert.equal(suggestProjectRef('Acme CRM Migration'), 'ACM');
	assert.equal(suggestProjectRef('Delivery Intelligence MVP'), 'DIM');
	assert.equal(suggestProjectRef('123'), 'PRJ');
	assert.equal(normaliseProjectRef(' hhh '), 'HHH');
	assert.equal(buildUniqueProjectRef('HHH', ['HHH']), 'HHH1');
	assert.equal(
		buildUniqueProjectRef('HHH', ['HHH', 'HHH1', 'HHH2', 'HHH3', 'HHH4', 'HHH5', 'HHH6', 'HHH7', 'HHH8', 'HHH9']),
		'HH10',
	);
	assert.equal(buildUniqueProjectRef('', []), 'PRJ');
});

test('Project reference validation enforces MVP format', () => {
	assert.equal(isValidProjectRef('HHH'), true);
	assert.equal(isValidProjectRef('H1H2'), true);
	assert.equal(isValidProjectRef('hh1'), true);
	assert.equal(isValidProjectRef('HH'), false);
	assert.equal(isValidProjectRef('HHHHH'), false);
	assert.equal(isValidProjectRef('1HH'), false);
	assert.equal(projectRefValidationMessage('1HH'), 'Project reference must be 3–4 uppercase letters or numbers and start with a letter.');
});

test('Project reference migration tightens format uniqueness names and immutability', async () => {
	const sql = await readFile(projectReferenceMigrationPath, 'utf8');
	assert.match(sql, /projects_project_ref_format_check/);
	assert.match(sql, /project_ref ~ '\^\[A-Z\]\[A-Z0-9\]\{2,3\}\$'/);
	assert.match(sql, /projects_organisation_project_name_key/);
	assert.match(sql, /organisation_id, lower\(btrim\(name\)\)/);
	assert.match(sql, /Project reference cannot be changed after project creation\./);
	assert.match(sql, /revoke update \(project_ref\) on public\.projects from authenticated/);
});

test('Project creation generates project_ref independently from routing slug and client input', async () => {
	const source = await readFile(new URL('../src/lib/projects.ts', import.meta.url), 'utf8');
	assert.match(source, /input: \{ name: string; description\?: string; status\?: ProjectStatus \}/);
	assert.match(source, /preferredProjectRef = normaliseProjectRef\(suggestProjectRef\(name\)\)/);
	assert.match(source, /project_ref: projectRef/);
	assert.match(source, /const baseSlug = slugifyProjectName\(name\)/);
	assert.match(source, /slug,/);
	assert.doesNotMatch(source, /input\.projectRef|input\.project_ref/);
	assert.match(source, /\.ilike\('name', name\)/);
	assert.match(source, /A project with this name already exists in this Workspace\./);
	assert.doesNotMatch(source, /slug\s*=\s*projectRef|projectRef\s*=\s*slug/);
});

test('Project creation retries a server-generated reference after a concurrent collision', async () => {
	const source = await readFile(new URL('../src/lib/projects.ts', import.meta.url), 'utf8');
	assert.match(source, /PROJECT_REF_CONSTRAINT = 'projects_organisation_project_ref_key'/);
	assert.match(source, /MAX_PROJECT_REF_INSERT_ATTEMPTS = 3/);
	assert.match(source, /isConstraintViolation\(error, PROJECT_REF_CONSTRAINT\)/);
	assert.match(source, /projectRef = buildUniqueProjectRef\(preferredProjectRef, await loadExistingProjectRefs\(\)\)/);
	assert.doesNotMatch(source, /A project with this reference already exists in this Workspace\./);
});

test('Project UI displays and protects project reference', async () => {
	const newSource = await readFile(new URL('../src/pages/app/projects/new.astro', import.meta.url), 'utf8');
	const listSource = await readFile(new URL('../src/pages/app/projects/index.astro', import.meta.url), 'utf8');
	const detailSource = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	const editSource = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/edit.astro', import.meta.url), 'utf8');
	assert.match(newSource, /aria-labelledby="project-reference-label"/);
	assert.match(newSource, /aria-describedby="project-reference-help"/);
	assert.match(newSource, /Watchtower will assign this fixed project reference when the project is created/);
	assert.doesNotMatch(newSource, /name="project_ref"|formData\.get\('project_ref'\)|projectRef:/);
	assert.match(listSource, /project_ref/);
	assert.match(listSource, /<th scope="col">Reference<\/th>/);
	assert.match(listSource, /<RagReferencePill[\s\S]*label=\{project\.project_ref \?\? 'Not assigned'\}/);
	assert.match(listSource, /<RagReferencePill[\s\S]*tone="neutral"[\s\S]*label=\{project\.project_ref \?\? 'Not assigned'\}/);
	assert.match(detailSource, /projectRef=\{project\.project_ref\}/);
	assert.match(editSource, /project\.project_ref/);
	assert.match(editSource, /read-only and cannot be edited after creation in MVP/);
	assert.doesNotMatch(editSource, /name="project_ref"/);
	assert.match(newSource, /Astro\.redirect\(buildProjectPath\(project\.workspaceSlug, project\.slug\)\)/);
});

test('Project list uses shared authenticated page patterns without changing routing or create permissions', async () => {
	const listSource = await readFile(new URL('../src/pages/app/projects/index.astro', import.meta.url), 'utf8');
	assert.match(listSource, /import ProjectContentPanel/);
	assert.match(listSource, /import EmptyState/);
	assert.match(listSource, /import DisabledActionHint/);
	assert.match(listSource, /import RagReferencePill/);
	assert.match(listSource, /<h1 id="projects-page-heading">Projects<\/h1>/);
	assert.match(listSource, /View and open projects in the current workspace\./);
	assert.match(listSource, /<ProjectContentPanel[\s\S]*title="Project list"[\s\S]*helper="Open a project dashboard or review its current delivery status\."/);
	assert.match(listSource, /slot="action"[\s\S]*href="\/app\/projects\/new">New project<\/a>/);
	assert.match(listSource, /canCreateProject = can\(workspace\.role, 'project\.create'\)/);
	assert.match(listSource, /\.from\('organisation_settings'\)[\s\S]*allow_member_project_creation/);
	assert.match(listSource, /aria-disabled="true" aria-describedby="create-project-restriction"/);
	assert.match(listSource, /<DisabledActionHint[\s\S]*disabledText=\{createProjectRestriction\}/);
	assert.match(listSource, /<EmptyState title="Projects could not be loaded\." tone="error"/);
	assert.match(listSource, /<EmptyState title="No projects yet\."/);
	assert.match(listSource, /<table class="simple-table projects-table">/);
	assert.match(listSource, /<th scope="col">Action<\/th>/);
	assert.match(listSource, /Open project/);
	assert.match(listSource, /buildProjectPath\(workspaceSlug, project\.slug\)/);
	assert.match(listSource, /\.select\('name, project_ref, slug, status, health, updated_at'\)/);
});

test('Shared RAG pill styling keeps active states scannable on dark surfaces', async () => {
	const ragStyles = await readFile(new URL('../src/styles/rag.css', import.meta.url), 'utf8');

	assert.match(ragStyles, /--rag-pill-background-strength: 22%/);
	assert.match(ragStyles, /--rag-pill-border-strength: 78%/);
	assert.match(ragStyles, /border: 1px solid color-mix\(in srgb, var\(--rag-tone\) var\(--rag-pill-border-strength\), transparent\)/);
	assert.match(ragStyles, /background: color-mix\(in srgb, var\(--rag-tone\) var\(--rag-pill-background-strength\), rgba\(4, 12, 24, 0\.46\)\)/);
	assert.match(ragStyles, /\.rag-pill--red \{[\s\S]*?--rag-pill-text: #ffb4ae;/);
	assert.match(ragStyles, /\.rag-pill--amber \{[\s\S]*?--rag-pill-text: #ffd37a;/);
	assert.match(ragStyles, /\.rag-pill--green \{[\s\S]*?--rag-pill-text: #8ff0bb;/);
	assert.match(ragStyles, /\.rag-pill--neutral,[\s\S]*?\.rag-pill--unknown \{[\s\S]*?--rag-pill-background-strength: 16%;[\s\S]*?--rag-pill-border-strength: 58%;/);
	assert.match(ragStyles, /\.rag-pill--unknown \{[\s\S]*?--rag-pill-text: #c4d3df;/);
	assert.match(ragStyles, /\.rag-pill__status \{[\s\S]*?color: var\(--rag-pill-text\);/);
});
