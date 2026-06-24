import { assertCan } from './permissions';
import { buildProjectEditPath, buildProjectPath, buildProjectRisksPath } from './projectRoutes';
import { buildUniqueSlug, slugifyProjectName } from './projectSlugs';
import { buildUniqueProjectRef, normaliseProjectRef, projectRefValidationMessage, suggestProjectRef } from './projectRefs';

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

export {
	buildProjectEditPath,
	buildProjectPath,
	buildProjectRisksPath,
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
	return data;
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
	return data;
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

	const activeWorkspaces = (memberships ?? [])
		.map((membership) => {
			const organisation = Array.isArray(membership.organisations)
				? membership.organisations[0]
				: membership.organisations;
			return organisation ? { ...organisation, role: membership.role } : null;
		})
		.filter(Boolean);
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
