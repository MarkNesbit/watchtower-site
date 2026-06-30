import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	PROJECT_PEOPLE_ROLES,
	isProjectPeopleRole,
	parseProjectPersonSelection,
	projectPeopleRoleLabel,
} from '../src/lib/projectPeople.ts';

const migrationUrl = new URL('../supabase/migrations/20260630000200_project_people_assignments.sql', import.meta.url);
const detailsPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/details.astro', import.meta.url);
const routesUrl = new URL('../src/lib/projectRoutes.ts', import.meta.url);
const projectsLibraryUrl = new URL('../src/lib/projects.ts', import.meta.url);
const peopleLibraryUrl = new URL('../src/lib/projectPeople.ts', import.meta.url);

test('Project people roles are controlled and human-readable', () => {
	assert.ok(PROJECT_PEOPLE_ROLES.includes('sponsor'));
	assert.ok(PROJECT_PEOPLE_ROLES.includes('project_manager'));
	assert.ok(PROJECT_PEOPLE_ROLES.includes('default_risk_owner'));
	assert.equal(isProjectPeopleRole('client_stakeholder'), true);
	assert.equal(isProjectPeopleRole('workspace_admin'), false);
	assert.equal(projectPeopleRoleLabel('default_dependency_owner'), 'Default Dependency Owner');
	assert.deepEqual(parseProjectPersonSelection('user:profile-1'), { source: 'user', id: 'profile-1' });
	assert.deepEqual(parseProjectPersonSelection('demo:demo-1'), { source: 'demo', id: 'demo-1' });
	assert.equal(parseProjectPersonSelection('owner:profile-1'), null);
});

test('Project people migration keeps assignment separate from workspace permissions', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	assert.match(sql, /create table public\.project_people/);
	assert.match(sql, /user_id uuid references auth\.users\(id\)/);
	assert.match(sql, /demo_person_id uuid references public\.workspace_demo_people\(id\)/);
	assert.match(sql, /project_people_exactly_one_person_check/);
	assert.match(sql, /project_people_project_organisation_fk[\s\S]*references public\.projects\(id, organisation_id\)/);
	assert.match(sql, /project_people_role_check[\s\S]*'sponsor'[\s\S]*'project_manager'[\s\S]*'default_risk_owner'/);
	assert.match(sql, /wdp\.status = 'active'[\s\S]*wdp\.is_demo_person = true/);
	assert.match(sql, /om\.status = 'active'/);
	assert.match(sql, /Assignments link real workspace members or active demo personas to project roles, but never grant workspace permissions/);
	assert.match(sql, /Active members can read project people/);
	assert.match(sql, /Owners admins and members can create project people/);
	assert.match(sql, /Owners admins and members can update project people/);
	assert.doesNotMatch(sql, /project_permissions|grant_workspace|organisation_members\s+set\s+role/i);
});

test('Project people helper enforces central RBAC and scopes assignment writes through workspace project route', async () => {
	const source = await readFile(peopleLibraryUrl, 'utf8');
	assert.match(source, /assertCan\(workspaceRole, 'project\.view'/);
	assert.match(source, /assertCan\(workspaceRole, 'project\.editDetails'/);
	assert.match(source, /getWorkspaceBySlug\(client, workspaceSlug, accessToken\)/);
	assert.match(source, /\.eq\('slug', projectSlug\)/);
	assert.match(source, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(source, /\.from\('organisation_members'\)[\s\S]*\.eq\('status', 'active'\)/);
	assert.match(source, /\.from\('workspace_demo_people'\)[\s\S]*\.eq\('status', 'active'\)[\s\S]*\.eq\('is_demo_person', true\)/);
	assert.match(source, /parseProjectPersonSelection\(input\.personSelection\)/);
	assert.match(source, /\.from\('project_people'\)[\s\S]*\.update\(\{ status: 'removed' \}\)/);
	assert.doesNotMatch(source, /organisation_members'\)\s*\.update|profiles'\)\s*\.update/);
});

test('Project Details route displays full available details with controlled editing', async () => {
	const source = await readFile(detailsPageUrl, 'utf8');
	assert.match(source, /data-project-details/);
	assert.match(source, /ProjectPageHero/);
	assert.match(source, /title="Project Details"/);
	assert.match(source, /getWorkspaceBySlug\(serverSupabase, workspaceSlug \?\? '', accessToken\)/);
	assert.match(source, /\.eq\('slug', projectSlug\)/);
	assert.match(source, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(source, /\.is\('deleted_at', null\)/);
	assert.match(source, /\.is\('archived_at', null\)/);
	assert.match(source, /canEditProject = can\(workspaceRole, 'project\.editDetails'\)/);
	assert.match(source, /updateProjectCore\(workspaceSlug \?\? '', projectSlug \?\? ''/);
	assert.match(source, /saveProjectPersonForRole\(workspaceSlug \?\? '', projectSlug \?\? ''/);
	assert.match(source, /listProjectPeople\(organisation\.id, project\.id, workspace\.role, serverSupabase\)/);
	assert.match(source, /listProjectPersonOptions\(organisation\.id, workspace\.role, serverSupabase\)/);
	assert.match(source, /You can view these project details, but you do not have permission to edit them\./);
	assert.match(source, /Project reference/);
	assert.match(source, /Workspace/);
	assert.match(source, /Project health/);
	assert.match(source, /Internal project ID/);
	assert.match(source, /Created by/);
	assert.match(source, /Updated by/);
	assert.match(source, /Not captured in the current project schema/);
	assert.match(source, /Start date/);
	assert.match(source, /Target end date/);
	assert.match(source, /Governance route/);
	assert.match(source, /Demo persona/);
	assert.match(source, /Assignments describe accountability only; they do not grant edit permissions\./);
	assert.doesNotMatch(source, /name="health"|name="project_ref"|name="organisation_id"|name="created_by"|name="updated_by"/);
});

test('Project Details route helper is exported through project libraries', async () => {
	const routes = await readFile(routesUrl, 'utf8');
	const projects = await readFile(projectsLibraryUrl, 'utf8');
	assert.match(routes, /export function buildProjectDetailsPath/);
	assert.match(routes, /\/details/);
	assert.match(projects, /buildProjectDetailsPath/);
});
