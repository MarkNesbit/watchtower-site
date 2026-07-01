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
const projectInfoMigrationUrl = new URL('../supabase/migrations/20260630000300_project_information_fields.sql', import.meta.url);
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

test('Project information migration adds controlled nullable setup fields safely', async () => {
	const sql = await readFile(projectInfoMigrationUrl, 'utf8');
	for (const field of [
		'project_type',
		'delivery_method',
		'priority',
		'criticality',
		'start_date',
		'target_end_date',
		'next_review_date',
		'review_cadence',
		'governance_route',
		'escalation_route',
	]) {
		assert.match(sql, new RegExp(`add column if not exists ${field}`));
	}
	assert.match(sql, /projects_project_type_check[\s\S]*'delivery'[\s\S]*'transformation'[\s\S]*'compliance'/);
	assert.match(sql, /projects_delivery_method_check[\s\S]*'waterfall'[\s\S]*'agile'[\s\S]*'scrum'/);
	assert.match(sql, /projects_priority_check[\s\S]*'low'[\s\S]*'critical'/);
	assert.match(sql, /projects_criticality_check[\s\S]*'low'[\s\S]*'critical'/);
	assert.match(sql, /projects_review_cadence_check[\s\S]*'weekly'[\s\S]*'ad_hoc'/);
	assert.match(sql, /target_end_date >= start_date/);
	assert.match(sql, /length\(btrim\(governance_route\)\) <= 500/);
	assert.match(sql, /length\(btrim\(escalation_route\)\) <= 500/);
	assert.match(sql, /grant update \([\s\S]*project_type[\s\S]*escalation_route[\s\S]*\) on public\.projects to authenticated/);
	assert.doesNotMatch(sql, /create\s+table\s+(public\.)?(risks|issues|dependencies|assumptions)|notify|notification/i);
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
	assert.match(source, /assertActiveProjectPersonSelection\(organisation\.id, selection, client\)/);
	assert.match(source, /\.from\('project_people'\)[\s\S]*\.update\(\{ status: 'removed' \}\)/);
	assert.doesNotMatch(source, /organisation_members'\)\s*\.update|profiles'\)\s*\.update/);
	assert.doesNotMatch(source, /\.delete\(\)/);
});

test('Project information helper validates controlled values dates permissions and scoped updates', async () => {
	const source = await readFile(projectsLibraryUrl, 'utf8');
	const helperSource = source.slice(source.indexOf('export async function updateProjectInformation'));
	assert.match(source, /export const PROJECT_TYPES = \['delivery', 'transformation', 'technology', 'operational', 'compliance', 'other'\]/);
	assert.match(source, /export const DELIVERY_METHODS = \['waterfall', 'agile', 'hybrid', 'kanban', 'scrum', 'other'\]/);
	assert.match(source, /export const PROJECT_PRIORITIES = \['low', 'medium', 'high', 'critical'\]/);
	assert.match(source, /export const REVIEW_CADENCES = \['weekly', 'fortnightly', 'monthly', 'quarterly', 'ad_hoc'\]/);
	assert.match(helperSource, /export async function updateProjectInformation/);
	assert.match(helperSource, /assertCan\(workspace\.role, 'project\.editDetails'/);
	assert.match(helperSource, /cleanOptionalControlledValue\(input\.projectType, PROJECT_TYPES/);
	assert.match(helperSource, /cleanOptionalDate\(input\.startDate, 'start date'\)/);
	assert.match(helperSource, /Target end date cannot be before the start date/);
	assert.match(helperSource, /cleanOptionalText\(input\.governanceRoute, 'Governance route', 500\)/);
	assert.match(helperSource, /\.eq\('slug', projectSlug\)/);
	assert.match(helperSource, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(helperSource, /\.is\('deleted_at', null\)/);
	assert.match(helperSource, /\.is\('archived_at', null\)/);
	assert.match(helperSource, /Object\.prototype\.hasOwnProperty\.call\(input, 'projectType'\)/);
	assert.doesNotMatch(helperSource, /project_ref:\s*|health:\s*|from\('project_risks'\)|from\('issues'\)|from\('dependencies'\)|from\('assumptions'\)/);
});

test('Project Details route displays full available details read-first with modal editing', async () => {
	const source = await readFile(detailsPageUrl, 'utf8');
	assert.match(source, /data-project-details/);
	assert.match(source, /ProjectPageHero/);
	assert.match(source, /title="Project Details"/);
	assert.match(source, /project-details-page :global\(\.project-content-panel h2\)/);
	assert.match(source, /font-size: clamp\(1\.35rem, 2\.2vw, 1\.85rem\)/);
	assert.match(source, /getWorkspaceBySlug\(serverSupabase, workspaceSlug \?\? '', accessToken\)/);
	assert.match(source, /\.eq\('slug', projectSlug\)/);
	assert.match(source, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(source, /\.is\('deleted_at', null\)/);
	assert.match(source, /\.is\('archived_at', null\)/);
	assert.match(source, /canEditProject = can\(workspaceRole, 'project\.editDetails'\)/);
	assert.match(source, /updateProjectCore\(workspaceSlug \?\? '', projectSlug \?\? ''/);
	assert.match(source, /updateProjectInformation\(workspaceSlug \?\? '', projectSlug \?\? ''/);
	assert.match(source, /saveProjectPersonForRole\(workspaceSlug \?\? '', projectSlug \?\? ''/);
	assert.match(source, /listProjectPeople\(organisation\.id, project\.id, workspace\.role, serverSupabase\)/);
	assert.match(source, /listProjectPersonOptions\(organisation\.id, workspace\.role, serverSupabase\)/);
	assert.match(source, /You can view these project details, but you do not have permission to edit them\./);
	assert.match(source, /data-project-dialog-open="project-identity-dialog"/);
	assert.match(source, /id="project-identity-dialog"/);
	assert.match(source, /data-project-identity-modal/);
	assert.match(source, /data-project-description-modal/);
	assert.match(source, /data-project-context-modal/);
	assert.match(source, /data-project-governance-modal/);
	assert.match(source, /data-project-assignment-modal/);
	assert.match(source, /data-add-team-member-modal/);
	assert.match(source, /data-project-dialog-cancel/);
	assert.match(source, /Project reference/);
	assert.match(source, /Workspace/);
	assert.match(source, /Project health/);
	assert.match(source, /Internal project ID/);
	assert.match(source, /Created by/);
	assert.match(source, /Updated by/);
	assert.match(source, /Not captured in the current project schema/);
	assert.match(source, /Start date/);
	assert.match(source, /Target end date/);
	assert.match(source, /Next review date/);
	assert.match(source, /Review cadence/);
	assert.match(source, /Governance route/);
	assert.match(source, /Escalation route/);
	assert.match(source, /Not set/);
	assert.match(source, /Project type/);
	assert.match(source, /Delivery method/);
	assert.match(source, /Priority/);
	assert.match(source, /Criticality/);
	assert.match(source, /Demo persona/);
	assert.match(source, /Assignments describe accountability only; they do not grant edit permissions\./);
	assert.doesNotMatch(source, /name="health"|name="project_ref"|name="organisation_id"|name="created_by"|name="updated_by"/);
	assert.doesNotMatch(source, /label="Project setup"|label="Context"|label="Governance"|label="Responsibilities"|label="Read-only"/);
	assert.doesNotMatch(source, /data-project-identity-form|data-project-description-form|project-person-card__form/);
});

test('Project Details loads and edits project context and governance fields through modals', async () => {
	const source = await readFile(detailsPageUrl, 'utf8');
	assert.match(source, /project_type, delivery_method, priority, criticality, start_date, target_end_date, next_review_date, review_cadence, governance_route, escalation_route/);
	assert.match(source, /data-project-context-fields/);
	assert.match(source, /projectContextFields = \[/);
	assert.match(source, /projectFieldLabel\(project\?\.project_type\)/);
	assert.match(source, /id="project-context-dialog"/);
	assert.match(source, /name="project_type"/);
	assert.match(source, /PROJECT_TYPES\.map/);
	assert.match(source, /DELIVERY_METHODS\.map/);
	assert.match(source, /PROJECT_PRIORITIES\.map/);
	assert.match(source, /PROJECT_CRITICALITIES\.map/);
	assert.match(source, /data-project-governance-fields/);
	assert.match(source, /governanceFields = \[/);
	assert.match(source, /formatDate\(project\?\.start_date\)/);
	assert.match(source, /id="project-governance-dialog"/);
	assert.match(source, /name="start_date" type="date"/);
	assert.match(source, /name="target_end_date" type="date"/);
	assert.match(source, /name="next_review_date" type="date"/);
	assert.match(source, /REVIEW_CADENCES\.map/);
	assert.match(source, /name="governance_route" rows="4" maxlength="500"/);
	assert.match(source, /name="escalation_route" rows="4" maxlength="500"/);
	assert.match(source, /Save dates and governance/);
});

test('Project Details roles use default slots, assignment modals, removal and add-team-member flow', async () => {
	const source = await readFile(detailsPageUrl, 'utf8');
	assert.match(source, /DEFAULT_PROJECT_PEOPLE_ROLES = \[/);
	for (const role of ['sponsor', 'project_manager', 'delivery_lead', 'product_owner', 'assurance_lead', 'default_risk_owner']) {
		assert.match(source, new RegExp(`'${role}'`));
	}
	assert.match(source, /No person assigned/);
	assert.match(source, /projectRoleCards = \[/);
	assert.match(source, /data-project-dialog-open={`project-person-dialog-\$\{role\}`}/);
	assert.match(source, /id={`project-person-dialog-\$\{role\}`}/);
	assert.match(source, /Save assignment/);
	assert.match(source, /Remove assignment/);
	assert.match(source, /value="remove-project-person"/);
	assert.match(source, /class="button button--destructive" type="submit" name="intent" value="remove-project-person"/);
	assert.match(source, /class="button button--secondary project-person-card__button"/);
	assert.match(source, /Add another team member/);
	assert.match(source, /id="project-add-person-dialog"/);
	assert.match(source, /name="project_role"/);
	assert.match(source, /PROJECT_PEOPLE_ROLES\.map/);
	assert.match(source, /Workspace members/);
	assert.match(source, /Demo personas/);
	assert.match(source, /showModal\(\)/);
});

test('Project Details modal actions use the shared authenticated button variants', async () => {
	const source = await readFile(detailsPageUrl, 'utf8');
	assert.match(source, /class="button button--secondary project-details-edit-action" type="button" data-project-dialog-open="project-identity-dialog"/);
	assert.match(source, /class="button button--secondary project-details-edit-action" type="button" data-project-dialog-open="project-governance-dialog"/);
	assert.match(source, /class="button button--primary project-details-edit-action" type="button" data-project-dialog-open="project-add-person-dialog"/);
	assert.match(source, /class="button button--secondary project-details-dialog__close" type="submit" aria-label="Close"/);
	assert.match(source, /class="button button--secondary" type="button" data-project-dialog-cancel>Cancel<\/button>/);
	assert.match(source, /class="button button--primary" type="submit">Save dates and governance<\/button>/);
	assert.doesNotMatch(source, /class="project-details-dialog__close"/);
	assert.doesNotMatch(source, /class="project-person-card__button"/);
});

test('Project Details route helper is exported through project libraries', async () => {
	const routes = await readFile(routesUrl, 'utf8');
	const projects = await readFile(projectsLibraryUrl, 'utf8');
	assert.match(routes, /export function buildProjectDetailsPath/);
	assert.match(routes, /\/details/);
	assert.match(projects, /buildProjectDetailsPath/);
});

test('Shared button styles keep modal action and disabled button contrast readable', async () => {
	const source = await readFile(new URL('../src/layouts/SiteLayout.astro', import.meta.url), 'utf8');
	assert.match(source, /\.button:focus-visible/);
	assert.match(source, /\.button--primary:disabled/);
	assert.match(source, /background: #315064/);
	assert.match(source, /color: #e4eef5/);
	assert.match(source, /\.button--secondary \{/);
	assert.match(source, /background: #07111d/);
	assert.match(source, /color: #f4f8fb/);
	assert.match(source, /\.button--secondary:hover/);
	assert.match(source, /\.button--secondary:disabled/);
	assert.match(source, /background: #263744/);
	assert.match(source, /color: #c8d6df/);
	assert.match(source, /\.button--destructive/);
	assert.match(source, /background: #5c1612/);
	assert.match(source, /color: #fff1ef/);
	assert.match(source, /\.button--destructive:disabled/);
	assert.match(source, /background: #432927/);
});

test('Authenticated button standard is documented for future project pages', async () => {
	const source = await readFile(new URL('../docs/ui-page-design-standard.md', import.meta.url), 'utf8');
	assert.match(source, /## Authenticated Button Styling/);
	assert.match(source, /\.button--primary/);
	assert.match(source, /\.button--secondary/);
	assert.match(source, /\.button--destructive/);
	assert.match(source, /Do not create white-filled or pale-filled buttons with white or low-contrast text/);
});
