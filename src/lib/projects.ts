import { assertCan } from './permissions.ts';
import {
	buildProjectActionPath,
	buildProjectActionsPath,
	buildProjectDetailsPath,
	buildProjectEditPath,
	buildProjectNarrativePath,
	buildProjectNewRiskPath,
	buildProjectPath,
	buildProjectRiskEditPath,
	buildProjectRiskPath,
	buildProjectRisksPath,
	buildProjectTimelinePath,
	buildWorkspaceTeamCheckoutReleasePath,
	buildWorkspaceTeamExportPath,
	buildWorkspaceTeamImportPath,
	buildWorkspaceTeamImportReviewConfirmPath,
	buildWorkspaceTeamImportReviewPath,
	buildWorkspaceTeamPath,
} from './projectRoutes.ts';
import { buildUniqueSlug, slugifyProjectName } from './projectSlugs.ts';
import { buildUniqueProjectRef, normaliseProjectRef, projectRefValidationMessage, suggestProjectRef } from './projectRefs.ts';
import { applyRoleSimulationToMembership } from './internalTesting.ts';

const PROJECT_REF_CONSTRAINT = 'projects_organisation_project_ref_key';
const PROJECT_NAME_CONSTRAINT = 'projects_organisation_project_name_key';
const MAX_PROJECT_REF_INSERT_ATTEMPTS = 3;

type DatabaseError = { code?: string; message?: string; details?: string; hint?: string };

function isConstraintViolation(error: DatabaseError | null, constraintName: string): boolean {
	if (!error || error.code !== '23505') return false;
	return [error.message, error.details, error.hint].filter(Boolean).join(' ').includes(constraintName);
}

export const PROJECT_STATUSES = ['proposed', 'active', 'paused', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_TYPES = ['delivery', 'transformation', 'technology', 'operational', 'compliance', 'other'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];
export const DELIVERY_METHODS = ['waterfall', 'agile', 'hybrid', 'kanban', 'scrum', 'other'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export const PROJECT_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];
export const PROJECT_CRITICALITIES = ['low', 'medium', 'high', 'critical'] as const;
export type ProjectCriticality = (typeof PROJECT_CRITICALITIES)[number];
export const REVIEW_CADENCES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'ad_hoc'] as const;
export type ReviewCadence = (typeof REVIEW_CADENCES)[number];

export type ProjectInformationInput = {
	projectType?: string | null;
	deliveryMethod?: string | null;
	priority?: string | null;
	criticality?: string | null;
	startDate?: string | null;
	targetEndDate?: string | null;
	nextReviewDate?: string | null;
	reviewCadence?: string | null;
	governanceRoute?: string | null;
	escalationRoute?: string | null;
};

export {
	buildProjectActionPath,
	buildProjectActionsPath,
	buildProjectDetailsPath,
	buildProjectEditPath,
	buildProjectNarrativePath,
	buildProjectNewRiskPath,
	buildProjectPath,
	buildProjectRiskEditPath,
	buildProjectRiskPath,
	buildProjectRisksPath,
	buildProjectTimelinePath,
	buildWorkspaceTeamCheckoutReleasePath,
	buildWorkspaceTeamExportPath,
	buildWorkspaceTeamImportPath,
	buildWorkspaceTeamImportReviewConfirmPath,
	buildWorkspaceTeamImportReviewPath,
	buildWorkspaceTeamPath,
	buildUniqueProjectRef,
	normaliseProjectRef,
	projectRefValidationMessage,
	slugifyProjectName,
	suggestProjectRef,
	buildUniqueSlug,
};

export function isProjectStatus(value: unknown): value is ProjectStatus {
	return typeof value === 'string' && PROJECT_STATUSES.includes(value as ProjectStatus);
}

export function isProjectType(value: unknown): value is ProjectType {
	return typeof value === 'string' && PROJECT_TYPES.includes(value as ProjectType);
}

export function isDeliveryMethod(value: unknown): value is DeliveryMethod {
	return typeof value === 'string' && DELIVERY_METHODS.includes(value as DeliveryMethod);
}

export function isProjectPriority(value: unknown): value is ProjectPriority {
	return typeof value === 'string' && PROJECT_PRIORITIES.includes(value as ProjectPriority);
}

export function isProjectCriticality(value: unknown): value is ProjectCriticality {
	return typeof value === 'string' && PROJECT_CRITICALITIES.includes(value as ProjectCriticality);
}

export function isReviewCadence(value: unknown): value is ReviewCadence {
	return typeof value === 'string' && REVIEW_CADENCES.includes(value as ReviewCadence);
}

export function projectFieldLabel(value: unknown, fallback = 'Not set'): string {
	if (typeof value !== 'string' || !value.trim()) return fallback;
	return value
		.split(/[_\s-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function cleanOptionalText(value: unknown, fieldLabel: string, maxLength: number): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	if (!text) return null;
	if (text.length > maxLength) throw new Error(`${fieldLabel} must be ${maxLength} characters or fewer.`);
	return text;
}

function cleanOptionalControlledValue<T extends string>(
	value: unknown,
	values: readonly T[],
	message: string,
): T | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(message);
	return value as T;
}

function cleanOptionalDate(value: unknown, fieldLabel: string): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Enter a valid ${fieldLabel}.`);
	const date = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
		throw new Error(`Enter a valid ${fieldLabel}.`);
	}
	return value;
}

export async function getCurrentWorkspace(client, accessToken?: string) {
	const { data: userData, error: userError } = accessToken
		? await client.auth.getUser(accessToken)
		: await client.auth.getUser();
	if (userError) throw userError;
	const user = userData.user;
	if (!user) return null;

	const { data, error } = await client
		.from('organisation_members')
		.select('role, joined_at, created_at, organisations(id, name, slug)')
		.eq('status', 'active')
		.eq('user_id', user.id)
		.order('joined_at', { ascending: true, nullsFirst: false })
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	return applyRoleSimulationToMembership(data, client, user.id);
}

export async function getWorkspaceBySlug(client, workspaceSlug: string, accessToken?: string) {
	const { data: userData, error: userError } = accessToken
		? await client.auth.getUser(accessToken)
		: await client.auth.getUser();
	if (userError) throw userError;
	const user = userData.user;
	if (!user) return null;

	const { data, error } = await client
		.from('organisation_members')
		.select('role, joined_at, created_at, organisations!inner(id, name, slug)')
		.eq('status', 'active')
		.eq('user_id', user.id)
		.eq('organisations.slug', workspaceSlug)
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	return applyRoleSimulationToMembership(data, client, user.id);
}

export async function getAccessibleProjectsBySlug(client, projectSlug: string, accessToken?: string) {
	const { data: userData, error: userError } = accessToken
		? await client.auth.getUser(accessToken)
		: await client.auth.getUser();
	if (userError) throw userError;
	const user = userData.user;
	if (!user) return [];

	const { data: memberships, error: membershipError } = await client
		.from('organisation_members')
		.select('role, organisations!inner(id, name, slug)')
		.eq('status', 'active')
		.eq('user_id', user.id);
	if (membershipError) throw membershipError;

	const activeWorkspaces = [];
	for (const membership of memberships ?? []) {
		const organisation = Array.isArray(membership.organisations)
			? membership.organisations[0]
			: membership.organisations;
		if (organisation) {
			const effectiveMembership = await applyRoleSimulationToMembership(
				{ role: membership.role, organisations: organisation },
				client,
				user.id,
			);
			activeWorkspaces.push({ ...organisation, role: effectiveMembership?.role ?? membership.role });
		}
	}
	if (activeWorkspaces.length === 0) return [];

	const workspaceById = new Map(activeWorkspaces.map((workspace) => [workspace.id, workspace]));
	const { data: projects, error: projectError } = await client
		.from('projects')
		.select('name, project_ref, slug, organisation_id')
		.eq('slug', projectSlug)
		.in('organisation_id', activeWorkspaces.map((workspace) => workspace.id))
		.is('deleted_at', null)
		.is('archived_at', null);
	if (projectError) throw projectError;

	return (projects ?? [])
		.map((project) => ({ ...project, workspace: workspaceById.get(project.organisation_id) }))
		.filter((project) => project.workspace);
}

export async function createProject(
	input: { name: string; description?: string; status?: ProjectStatus },
	client,
	accessToken?: string,
) {
	const name = input.name.trim();
	if (!name) throw new Error('Project name is required.');

	const workspace = await getCurrentWorkspace(client, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation) throw new Error('No active workspace is available.');
	assertCan(workspace.role, 'project.create', 'Your workspace role does not permit project creation.');
	if (workspace.role === 'member') {
		const { data: settings, error: settingsError } = await client
			.from('organisation_settings')
			.select('allow_member_project_creation')
			.eq('organisation_id', organisation.id)
			.maybeSingle();
		if (settingsError) throw settingsError;
		if (!settings?.allow_member_project_creation) {
			throw new Error('Members cannot create projects in this workspace.');
		}
	}

	const { data: duplicateNames, error: nameError } = await client
		.from('projects')
		.select('id')
		.eq('organisation_id', organisation.id)
		.ilike('name', name)
		.limit(1);
	if (nameError) throw nameError;
	if ((duplicateNames ?? []).length > 0) throw new Error('A project with this name already exists in this Workspace.');

	const status = input.status && PROJECT_STATUSES.includes(input.status) ? input.status : 'proposed';
	const preferredProjectRef = normaliseProjectRef(suggestProjectRef(name));
	const loadExistingProjectRefs = async () => {
		const { data, error } = await client
			.from('projects')
			.select('project_ref')
			.eq('organisation_id', organisation.id)
			.not('project_ref', 'is', null);
		if (error) throw error;
		return (data ?? []).map((project: { project_ref: string }) => project.project_ref);
	};
	let projectRef = buildUniqueProjectRef(preferredProjectRef, await loadExistingProjectRefs());
	const projectRefMessage = projectRefValidationMessage(projectRef);
	if (projectRefMessage) throw new Error(projectRefMessage);

	const baseSlug = slugifyProjectName(name);
	const { data: slugRows, error: slugError } = await client
		.from('projects')
		.select('slug')
		.eq('organisation_id', organisation.id)
		.like('slug', `${baseSlug}%`);
	if (slugError) throw slugError;

	const slug = buildUniqueSlug(baseSlug, (slugRows ?? []).map((project) => project.slug));
	const { data: userData, error: userError } = accessToken
		? await client.auth.getUser(accessToken)
		: await client.auth.getUser();
	if (userError) throw userError;
	if (!userData.user) throw new Error('You must be signed in to create a project.');

	let project;
	for (let attempt = 1; attempt <= MAX_PROJECT_REF_INSERT_ATTEMPTS; attempt += 1) {
		const { data, error } = await client
			.from('projects')
			.insert({
				organisation_id: organisation.id,
				name,
				project_ref: projectRef,
				slug,
				description: input.description?.trim() || null,
				status,
				health: 'unknown',
				created_by: userData.user.id,
			})
			.select('id, name, project_ref, slug, status, health, organisation_id')
			.single();
		if (!error) {
			project = data;
			break;
		}
		if (isConstraintViolation(error, PROJECT_NAME_CONSTRAINT)) {
			throw new Error('A project with this name already exists in this Workspace.');
		}
		if (isConstraintViolation(error, PROJECT_REF_CONSTRAINT)) {
			if (attempt < MAX_PROJECT_REF_INSERT_ATTEMPTS) {
				projectRef = buildUniqueProjectRef(preferredProjectRef, await loadExistingProjectRefs());
				continue;
			}
			throw new Error('Watchtower could not assign a unique project reference. Please try again.');
		}
		throw error;
	}
	if (!project) throw new Error('Watchtower could not assign a unique project reference. Please try again.');

	const { error: auditError } = await client.from('audit_log').insert({
		organisation_id: project.organisation_id,
		actor_user_id: userData.user.id,
		action: 'project.created',
		entity_type: 'project',
		entity_id: project.id,
		new_values: { name: project.name, project_ref: project.project_ref, status: project.status, health: project.health },
	});
	if (auditError) throw auditError;

	return { ...project, workspaceSlug: organisation.slug };
}

export async function updateProjectCore(
	workspaceSlug: string,
	projectSlug: string,
	input: { name: string; description?: string; status?: ProjectStatus },
	client,
	accessToken?: string,
) {
	const name = input.name.trim();
	if (!name) throw new Error('Project name is required.');
	if (!isProjectStatus(input.status)) throw new Error('Select a valid project status.');

	const workspace = await getWorkspaceBySlug(client, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation) throw new Error('No active workspace is available.');
	assertCan(workspace.role, 'project.editDetails', 'Your workspace role does not permit project editing.');

	const updatePayload: { name: string; status: ProjectStatus; description?: string | null } = { name, status: input.status };
	if (Object.prototype.hasOwnProperty.call(input, 'description')) {
		updatePayload.description = input.description?.trim() || null;
	}

	const { data: project, error } = await client
		.from('projects')
		.update(updatePayload)
		.eq('slug', projectSlug)
		.eq('organisation_id', organisation.id)
		.is('deleted_at', null)
		.is('archived_at', null)
		.select('slug, name, description, status, health')
		.maybeSingle();

	if (error) throw error;
	if (!project) throw new Error('Project not found or you do not have access.');
	return project;
}

export async function updateProjectInformation(
	workspaceSlug: string,
	projectSlug: string,
	input: ProjectInformationInput,
	client,
	accessToken?: string,
) {
	const workspace = await getWorkspaceBySlug(client, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation) throw new Error('No active workspace is available.');
	assertCan(workspace.role, 'project.editDetails', 'Your workspace role does not permit project editing.');

	const updatePayload: Record<string, string | null> = {};
	if (Object.prototype.hasOwnProperty.call(input, 'projectType')) {
		updatePayload.project_type = cleanOptionalControlledValue(input.projectType, PROJECT_TYPES, 'Select a valid project type.');
	}
	if (Object.prototype.hasOwnProperty.call(input, 'deliveryMethod')) {
		updatePayload.delivery_method = cleanOptionalControlledValue(input.deliveryMethod, DELIVERY_METHODS, 'Select a valid delivery method.');
	}
	if (Object.prototype.hasOwnProperty.call(input, 'priority')) {
		updatePayload.priority = cleanOptionalControlledValue(input.priority, PROJECT_PRIORITIES, 'Select a valid priority.');
	}
	if (Object.prototype.hasOwnProperty.call(input, 'criticality')) {
		updatePayload.criticality = cleanOptionalControlledValue(input.criticality, PROJECT_CRITICALITIES, 'Select a valid criticality.');
	}
	if (Object.prototype.hasOwnProperty.call(input, 'startDate')) {
		updatePayload.start_date = cleanOptionalDate(input.startDate, 'start date');
	}
	if (Object.prototype.hasOwnProperty.call(input, 'targetEndDate')) {
		updatePayload.target_end_date = cleanOptionalDate(input.targetEndDate, 'target end date');
	}
	if (Object.prototype.hasOwnProperty.call(input, 'nextReviewDate')) {
		updatePayload.next_review_date = cleanOptionalDate(input.nextReviewDate, 'next review date');
	}
	if (Object.prototype.hasOwnProperty.call(input, 'reviewCadence')) {
		updatePayload.review_cadence = cleanOptionalControlledValue(input.reviewCadence, REVIEW_CADENCES, 'Select a valid review cadence.');
	}
	if (Object.prototype.hasOwnProperty.call(input, 'governanceRoute')) {
		updatePayload.governance_route = cleanOptionalText(input.governanceRoute, 'Governance route', 500);
	}
	if (Object.prototype.hasOwnProperty.call(input, 'escalationRoute')) {
		updatePayload.escalation_route = cleanOptionalText(input.escalationRoute, 'Escalation route', 500);
	}

	if (Object.keys(updatePayload).length === 0) throw new Error('No project information fields were supplied.');
	if (updatePayload.start_date && updatePayload.target_end_date && updatePayload.target_end_date < updatePayload.start_date) {
		throw new Error('Target end date cannot be before the start date.');
	}

	const { data: project, error } = await client
		.from('projects')
		.update(updatePayload)
		.eq('slug', projectSlug)
		.eq('organisation_id', organisation.id)
		.is('deleted_at', null)
		.is('archived_at', null)
		.select('slug, project_type, delivery_method, priority, criticality, start_date, target_end_date, next_review_date, review_cadence, governance_route, escalation_route')
		.maybeSingle();

	if (error) throw error;
	if (!project) throw new Error('Project not found or you do not have access.');
	return project;
}
