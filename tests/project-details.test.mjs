import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	PROJECT_PEOPLE_ROLES,
	isProjectPeopleRole,
	parseProjectPersonSelection,
	projectPeopleRoleLabel,
} from '../src/lib/projectPeople.ts';
import {
	PROJECT_DATE_TYPES,
	buildProjectDateCards,
	canChangeProjectDates,
	deriveProjectDateStatus,
	isProjectDateType,
	projectDateTypeLabel,
	projectDateWarningDays,
} from '../src/lib/projectDates.ts';

const migrationUrl = new URL('../supabase/migrations/20260630000200_project_people_assignments.sql', import.meta.url);
const projectInfoMigrationUrl = new URL('../supabase/migrations/20260630000300_project_information_fields.sql', import.meta.url);
const projectDatesMigrationUrl = new URL('../supabase/migrations/20260701000100_project_dates_timeline_readiness.sql', import.meta.url);
const projectDatesWarningDaysMigrationUrl = new URL('../supabase/migrations/20260702000200_allow_start_date_zero_warning_days.sql', import.meta.url);
const detailsPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/details.astro', import.meta.url);
const routesUrl = new URL('../src/lib/projectRoutes.ts', import.meta.url);
const projectsLibraryUrl = new URL('../src/lib/projects.ts', import.meta.url);
const peopleLibraryUrl = new URL('../src/lib/projectPeople.ts', import.meta.url);
const datesLibraryUrl = new URL('../src/lib/projectDates.ts', import.meta.url);

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

test('Project date types and derived status are controlled and timeline-ready', () => {
	assert.deepEqual(PROJECT_DATE_TYPES, ['start_date', 'target_end_date', 'review_date', 'uat', 'stage_gate', 'load_test', 'other']);
	assert.equal(PROJECT_DATE_TYPES.length, 7);
	assert.equal(isProjectDateType('stage_gate'), true);
	assert.equal(isProjectDateType('forecast_date'), false);
	assert.equal(projectDateTypeLabel('uat'), 'UAT');
	assert.equal(projectDateTypeLabel('other', 'Board approval'), 'Board approval');
	const now = new Date('2026-07-01T12:00:00Z');
	assert.equal(projectDateWarningDays('start_date'), 0);
	assert.equal(projectDateWarningDays('review_date'), 2);
	assert.equal(projectDateWarningDays('uat'), 7);
	assert.equal(projectDateWarningDays('load_test'), 7);
	assert.equal(projectDateWarningDays('stage_gate'), 14);
	assert.equal(projectDateWarningDays('other'), 14);
	assert.deepEqual(deriveProjectDateStatus(null, projectDateWarningDays('start_date'), now, 'start_date'), { tone: 'amber', label: 'Amber', text: 'Amber - date not set' });
	assert.deepEqual(deriveProjectDateStatus('2026-06-30', projectDateWarningDays('start_date'), now, 'start_date'), { tone: 'green', label: 'Green', text: 'Green - started' });
	assert.deepEqual(deriveProjectDateStatus('2026-07-01', projectDateWarningDays('start_date'), now, 'start_date'), { tone: 'green', label: 'Green', text: 'Green - starting today' });
	assert.deepEqual(deriveProjectDateStatus('2026-06-30', projectDateWarningDays('target_end_date'), now, 'target_end_date'), { tone: 'red', label: 'Red', text: 'Red - overdue' });
	assert.deepEqual(deriveProjectDateStatus('2026-07-03', projectDateWarningDays('review_date'), now, 'review_date'), { tone: 'amber', label: 'Amber', text: 'Amber - within 2 days' });
	assert.deepEqual(deriveProjectDateStatus('2026-07-04', projectDateWarningDays('review_date'), now, 'review_date'), { tone: 'green', label: 'Green', text: 'Green - scheduled' });
	assert.deepEqual(deriveProjectDateStatus('2026-06-30', projectDateWarningDays('review_date'), now, 'review_date'), { tone: 'red', label: 'Red', text: 'Red - review overdue' });
	assert.deepEqual(deriveProjectDateStatus('2026-07-08', projectDateWarningDays('uat'), now, 'uat'), { tone: 'amber', label: 'Amber', text: 'Amber - within 7 days' });
	assert.deepEqual(deriveProjectDateStatus('2026-07-09', projectDateWarningDays('uat'), now, 'uat'), { tone: 'green', label: 'Green', text: 'Green - scheduled' });
	assert.deepEqual(deriveProjectDateStatus('2026-07-08', projectDateWarningDays('load_test'), now, 'load_test'), { tone: 'amber', label: 'Amber', text: 'Amber - within 7 days' });
	assert.deepEqual(deriveProjectDateStatus('2026-07-15', projectDateWarningDays('stage_gate'), now, 'stage_gate'), { tone: 'amber', label: 'Amber', text: 'Amber - within 14 days' });
	assert.deepEqual(deriveProjectDateStatus('2026-07-15', projectDateWarningDays('other'), now, 'other'), { tone: 'amber', label: 'Amber', text: 'Amber - within 14 days' });
	assert.deepEqual(deriveProjectDateStatus('2026-07-16', projectDateWarningDays('other'), now, 'other'), { tone: 'green', label: 'Green', text: 'Green - scheduled' });
});

test('Project date cards preserve default slots and hide removed added dates', () => {
	const now = new Date('2026-07-01T12:00:00Z');
	const comments = [{
		id: 'comment-1',
		organisation_id: 'org-1',
		project_id: 'project-1',
		project_date_id: 'removed-uat',
		comment: 'Keep this context',
		created_at: '2026-06-20T10:00:00Z',
	}];
	const cards = buildProjectDateCards([
		{
			id: 'removed-start',
			organisation_id: 'org-1',
			project_id: 'project-1',
			date_type: 'start_date',
			target_date: '2026-06-01',
			warning_days: 0,
			is_key_date: true,
			removed_at: '2026-07-01T09:00:00Z',
		},
		{
			id: 'removed-uat',
			organisation_id: 'org-1',
			project_id: 'project-1',
			date_type: 'uat',
			target_date: '2026-07-08',
			warning_days: 7,
			is_key_date: true,
			removed_at: '2026-07-01T09:00:00Z',
			comments,
		},
		{
			id: 'active-start',
			organisation_id: 'org-1',
			project_id: 'project-1',
			date_type: 'start_date',
			target_date: '2026-06-15',
			warning_days: 0,
			is_key_date: true,
			removed_at: null,
		},
		{
			id: 'active-target-end',
			organisation_id: 'org-1',
			project_id: 'project-1',
			date_type: 'target_end_date',
			target_date: '2026-08-31',
			warning_days: 14,
			is_key_date: true,
			removed_at: null,
		},
		{
			id: 'active-stage-gate',
			organisation_id: 'org-1',
			project_id: 'project-1',
			date_type: 'stage_gate',
			target_date: '2026-07-15',
			warning_days: 14,
			is_key_date: true,
			removed_at: null,
		},
	], { start_date: '2026-05-01', target_end_date: '2026-12-01', next_review_date: null }, now);

	const startCard = cards.find((card) => card.dateType === 'start_date' && card.isDefault);
	assert.equal(startCard?.id, 'active-start');
	assert.equal(startCard?.targetDate, '2026-06-15');
	assert.equal(startCard?.status.tone, 'green');
	const targetEndCard = cards.find((card) => card.dateType === 'target_end_date' && card.isDefault);
	assert.equal(targetEndCard?.id, 'active-target-end');
	assert.equal(targetEndCard?.targetDate, '2026-08-31');
	assert.equal(targetEndCard?.status.tone, 'green');
	assert.equal(cards.some((card) => card.id === 'removed-uat'), false);
	assert.equal(cards.some((card) => card.id === 'active-stage-gate'), true);
	assert.equal(comments[0].comment, 'Keep this context');
});

test('Project date mutation authority excludes viewer and simulated viewer roles', async () => {
	assert.equal(await canChangeProjectDates({ role: 'viewer' }, 'org-1', 'project-1', {}, undefined), false);
	assert.equal(await canChangeProjectDates({
		role: 'viewer',
		activeRoleSimulation: { demo_person_id: 'demo-viewer' },
	}, 'org-1', 'project-1', {}, undefined), false);
	assert.equal(await canChangeProjectDates({ role: 'owner' }, 'org-1', 'project-1', {}, undefined), true);
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

test('Project dates migration creates scoped date and comment tables with constraints', async () => {
	const sql = await readFile(projectDatesMigrationUrl, 'utf8');
	assert.match(sql, /create table public\.project_dates/);
	assert.match(sql, /create table public\.project_date_comments/);
	assert.match(sql, /project_dates_project_organisation_fk[\s\S]*references public\.projects\(id, organisation_id\)/);
	assert.match(sql, /project_date_comments_date_scope_fk[\s\S]*references public\.project_dates\(id, project_id, organisation_id\)/);
	assert.match(sql, /project_dates_type_check[\s\S]*'start_date'[\s\S]*'target_end_date'[\s\S]*'review_date'[\s\S]*'uat'[\s\S]*'stage_gate'[\s\S]*'load_test'[\s\S]*'other'/);
	assert.match(sql, /project_dates_other_label_check[\s\S]*date_type = 'other'[\s\S]*custom_label is not null/);
	assert.match(sql, /warning_days integer not null default 14/);
	assert.match(sql, /removed_at timestamptz/);
	assert.match(sql, /Active members can read project dates/);
	assert.match(sql, /Owners admins and members can create project dates/);
	assert.match(sql, /Comments do not change the date/);
	assert.match(sql, /future Project Timeline capability/);
	assert.doesNotMatch(sql, /create\s+table\s+(public\.)?(risks|issues|dependencies|assumptions)|notify|notification/i);
});

test('Project date warning-days migration permits Start date persistence without changing date types', async () => {
	const sql = await readFile(projectDatesWarningDaysMigrationUrl, 'utf8');
	assert.match(sql, /drop constraint if exists project_dates_warning_days_check/);
	assert.match(sql, /add constraint project_dates_warning_days_check check \(warning_days between 0 and 365\)/);
	assert.doesNotMatch(sql, /create table public\.project_dates|date_type in|alter table public\.projects/i);
	assert.equal(projectDateWarningDays('start_date'), 0);
	assert.equal(projectDateWarningDays('target_end_date'), 14);
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

test('Project date helper validates authority scope comments and legacy compatibility', async () => {
	const source = await readFile(datesLibraryUrl, 'utf8');
	assert.match(source, /export const PROJECT_DATE_TYPES = \['start_date', 'target_end_date', 'review_date', 'uat', 'stage_gate', 'load_test', 'other'\]/);
	assert.match(source, /export const PROJECT_DATE_WARNING_DAYS = 14/);
	assert.match(source, /PROJECT_DATE_TYPE_WARNING_DAYS[\s\S]*start_date: 0[\s\S]*review_date: 2[\s\S]*uat: 7[\s\S]*stage_gate: 14[\s\S]*load_test: 7[\s\S]*other: 14/);
	assert.match(source, /PROJECT_DATE_EDIT_ASSIGNMENT_ROLES = \['project_manager', 'delivery_lead', 'product_owner'\]/);
	assert.match(source, /export function deriveProjectDateStatus/);
	assert.match(source, /Amber - date not set/);
	assert.match(source, /Red - overdue/);
	assert.match(source, /Green - started/);
	assert.match(source, /Green - starting today/);
	assert.match(source, /Red - review overdue/);
	assert.match(source, /Green - scheduled/);
	assert.match(source, /buildProjectDateCards/);
	assert.match(source, /getWorkspaceBySlug\(client, workspaceSlug, accessToken\)/);
	assert.match(source, /\.eq\('slug', projectSlug\)/);
	assert.match(source, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(source, /canChangeProjectDates/);
	assert.match(source, /canCommentOnProjectDates/);
	assert.match(source, /workspace\.role === 'owner' \|\| workspace\.role === 'admin'/);
	assert.match(source, /hasActiveProjectPersonAssignment/);
	assert.match(source, /Custom date label is required when Other is selected/);
	assert.match(source, /createProjectDateComment/);
	assert.match(source, /mirrorLegacyProjectDate/);
	assert.match(source, /dateType === 'start_date'[\s\S]*'start_date'[\s\S]*dateType === 'target_end_date'[\s\S]*'target_end_date'/);
	assert.match(source, /\.insert\(\{[\s\S]*date_type: cleaned\.dateType[\s\S]*target_date: cleaned\.targetDate[\s\S]*warning_days: projectDateWarningDays\(cleaned\.dateType\)/);
	assert.match(source, /\.update\(\{[\s\S]*date_type: cleaned\.dateType[\s\S]*target_date: cleaned\.targetDate[\s\S]*warning_days: projectDateWarningDays\(cleaned\.dateType\)/);
	assert.match(source, /\.update\(\{ removed_at: new Date\(\)\.toISOString\(\) \}\)/);
	assert.match(source, /projectDateWarningDays\(cleaned\.dateType\)/);
	assert.doesNotMatch(source, /from\('project_risks'\)|from\('issues'\)|from\('dependencies'\)|from\('assumptions'\)|\.delete\(\)/);
});

test('Project Details route displays full available details read-first with modal editing', async () => {
	const source = await readFile(detailsPageUrl, 'utf8');
	const signalSource = await readFile(new URL('../src/lib/dashboardTileSignals.ts', import.meta.url), 'utf8');
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
	assert.match(source, /saveProjectDate\(workspaceSlug \?\? '', projectSlug \?\? ''/);
	assert.match(source, /createProjectDateComment\(/);
	assert.match(source, /const intentValues = formData\.getAll\('intent'\)/);
	assert.match(source, /intentValues\.at\(-1\)/);
	assert.match(source, /saveProjectPersonForRole\(workspaceSlug \?\? '', projectSlug \?\? ''/);
	assert.match(source, /listProjectPeople\(organisation\.id, project\.id, workspace\.role, serverSupabase\)/);
	assert.match(source, /listProjectDates\(organisation\.id, project\.id, workspace\.role, serverSupabase\)/);
	assert.match(source, /listProjectPersonOptions\(organisation\.id, workspace\.role, serverSupabase\)/);
	assert.match(source, /You can view these project details, but you do not have permission to edit them\./);
	assert.match(source, /import \{ deriveProjectDetailsAreaSignal, deriveProjectDetailsSectionSignals \}/);
	assert.match(source, /projectDetailsSectionSignals = deriveProjectDetailsSectionSignals\(project, projectDateCards, peopleLoadError \? null : assignments\)/);
	assert.match(source, /projectDetailsSignal = deriveProjectDetailsAreaSignal\(project, projectDateCards, peopleLoadError \? null : assignments\)/);
	assert.match(source, /projectDetailsAttentionReasons = projectDetailsSignal\.reasons\.filter/);
	assert.match(source, /projectDetailsAttentionSections = projectDetailsSectionSignals/);
	assert.match(source, /data-project-details-attention/);
	assert.match(source, /id="project-details-attention-heading">Attention/);
	assert.doesNotMatch(source, /Project setup attention/);
	assert.match(source, /Red attention/);
	assert.match(source, /Amber attention/);
	assert.match(source, /rag-panel rag-panel--\$\{projectDetailsSignal\.state\}/);
	assert.match(source, /<RagReferencePill tone=\{projectDetailsSignal\.state\} label=\{formatStatusLabel\(projectDetailsSignal\.state\)\} statusLabel="Project Details" \/>/);
	assert.match(source, /href=\{reason\.target\}/);
	for (const section of [
		'project_identity',
		'project_description',
		'project_context',
		'project_dates',
		'governance_escalation',
		'project_roles_responsibilities',
		'system_metadata',
	]) {
		assert.match(source, new RegExp(`data-project-section-marker="${section}"`));
	}
	assert.match(source, /data-section-state=\{identitySignal\.state\}/);
	assert.match(source, /data-section-state=\{datesSignal\.state\}/);
	assert.match(source, /statusLabel="Section"/);
	assert.match(source, /project-content-panel:has\(\[data-section-state="green"\]\)/);
	assert.match(source, /project-content-panel:has\(\[data-section-state="amber"\]\)/);
	assert.match(source, /project-content-panel:has\(\[data-section-state="red"\]\)/);
	assert.doesNotMatch(source, /project-section-signal/);
	assert.doesNotMatch(source, /data-project-section-signal/);
	assert.doesNotMatch(source, /Expected identity fields are present/);
	assert.match(signalSource, /Project Identity/);
	assert.match(signalSource, /Project Description/);
	assert.match(signalSource, /Project Context/);
	assert.match(signalSource, /Project Dates/);
	assert.match(signalSource, /Governance and Escalation/);
	assert.match(signalSource, /Project Roles and Responsibilities/);
	assert.match(signalSource, /System Metadata/);
	assert.match(signalSource, /Expected identity fields are present/);
	assert.match(signalSource, /#project-description-heading/);
	assert.match(signalSource, /#project-context-heading/);
	assert.match(signalSource, /#project-dates-heading/);
	assert.match(signalSource, /#project-governance-heading/);
	assert.match(signalSource, /#project-people-heading/);
	assert.match(signalSource, /Target end date is not set while the project is Proposed/);
	assert.match(signalSource, /Target end date is not set for an Active project/);
	assert.match(source, /data-project-dialog-open="project-identity-dialog"/);
	assert.match(source, /id="project-identity-dialog"/);
	assert.match(source, /data-project-identity-modal/);
	assert.match(source, /data-project-description-modal/);
	assert.match(source, /data-project-context-modal/);
	assert.match(source, /data-project-date-modal/);
	assert.match(source, /data-project-date-add-modal/);
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
	assert.match(source, /buildProjectDateCards\(projectDates, project\)/);
	assert.match(source, /projectDateTypeLabel\(card\.dateType\)/);
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

test('Project Details loads project dates as status cards and keeps governance separate', async () => {
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
	assert.match(source, /title="Project dates"/);
	assert.match(source, /data-project-dates-section/);
	assert.match(source, /projectDateCards\.map/);
	assert.match(source, /project-date-card--\$\{card\.status\.tone\}/);
	assert.match(source, /rag-card rag-card--\$\{card\.status\.tone\}/);
	assert.match(source, /card\.status\.text/);
	assert.match(source, /<RagReferencePill tone=\{card\.status\.tone\} label=\{card\.status\.text\} \/>/);
	assert.match(source, /projectDateId: String\(formData\.get\('project_date_id'\) \?\? ''\)/);
	assert.match(source, /dateType: String\(formData\.get\('date_type'\) \?\? ''\)/);
	assert.match(source, /targetDate: String\(formData\.get\('target_date'\) \?\? ''\)/);
	assert.match(source, /<input type="hidden" name="project_date_id" value=\{card\.id \?\? ''\} \/>/);
	assert.match(source, /<input type="hidden" name="date_type" value=\{card\.dateType\} \/>/);
	assert.match(source, /<input name="target_date" type="date" value=\{card\.targetDate \?\? ''\} data-project-date-input \/>/);
	const ragStyles = await readFile(new URL('../src/styles/rag.css', import.meta.url), 'utf8');
	assert.match(ragStyles, /\.rag-card,[\s\S]*?border-left: 0\.35rem solid var\(--rag-accent, var\(--rag-neutral-accent\)\);/);
	assert.doesNotMatch(ragStyles, /\.rag-card,[\s\S]*?--rag-tone: var\(--rag-neutral/);
	assert.match(source, /Add new date/);
	assert.match(source, /PROJECT_DATE_TYPES\.map/);
	assert.match(source, /name="date_type"/);
	assert.match(source, /name="custom_label"/);
	assert.match(source, /name="target_date" type="date"/);
	assert.match(source, /data-project-date-picker/);
	assert.match(source, /Open calendar/);
	assert.match(source, /name="comment"/);
	assert.match(source, /value="remove-project-date"/);
	assert.match(source, /\{card\.isDefault \? 'Clear date' : 'Remove date'\}/);
	assert.match(source, /Save project date/);
	assert.match(source, /Project dates are intended to auto-populate the future Project Timeline capability/);
	assert.match(source, /data-project-governance-fields/);
	assert.match(source, /governanceFields = \[/);
	assert.match(source, /GOVERNANCE_ROUTE_GUIDANCE/);
	assert.match(source, /ESCALATION_ROUTE_GUIDANCE/);
	assert.match(source, /id="project-governance-dialog"/);
	assert.match(source, /REVIEW_CADENCES\.map/);
	assert.match(source, /name="governance_route" rows="4" maxlength="500"/);
	assert.match(source, /name="escalation_route" rows="4" maxlength="500"/);
	assert.match(source, /Save governance and escalation/);
	assert.doesNotMatch(source, /Save dates and governance/);
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
	assert.match(source, /class="button button--primary project-details-edit-action" type="button" data-project-dialog-open="project-date-add-dialog"/);
	assert.match(source, /class="button button--primary project-details-edit-action" type="button" data-project-dialog-open="project-add-person-dialog"/);
	assert.match(source, /class="button button--secondary project-details-dialog__close" type="submit" aria-label="Close"/);
	assert.match(source, /class="button button--secondary" type="button" data-project-dialog-cancel>Cancel<\/button>/);
	assert.match(source, /class="button button--primary" type="submit">Save project date<\/button>/);
	assert.match(source, /class="button button--primary" type="submit">Save governance and escalation<\/button>/);
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
