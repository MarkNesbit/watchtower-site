import { assertCan } from './permissions';
import { buildUniqueSlug, slugifyProjectName } from './projectSlugs';

export const PROJECT_STATUSES = ['proposed', 'active', 'paused', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export { buildUniqueSlug, slugifyProjectName };

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
		.select('role, joined_at, created_at, organisations(id, name)')
		.eq('status', 'active')
		.eq('user_id', user.id)
		.order('joined_at', { ascending: true, nullsFirst: false })
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	return data;
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

	const status = input.status && PROJECT_STATUSES.includes(input.status) ? input.status : 'proposed';
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

	const { data: project, error: projectError } = await client
		.from('projects')
		.insert({
			organisation_id: organisation.id,
			name,
			slug,
			description: input.description?.trim() || null,
			status,
			health: 'unknown',
			created_by: userData.user.id,
		})
		.select('id, name, slug, status, health, organisation_id')
		.single();
	if (projectError) throw projectError;

	const { error: auditError } = await client.from('audit_log').insert({
		organisation_id: project.organisation_id,
		actor_user_id: userData.user.id,
		action: 'project.created',
		entity_type: 'project',
		entity_id: project.id,
		new_values: { name: project.name, status: project.status, health: project.health },
	});
	if (auditError) throw auditError;

	return project;
}

export async function updateProjectCore(
	projectSlug: string,
	input: { name: string; description?: string; status?: ProjectStatus },
	client,
	accessToken?: string,
) {
	const name = input.name.trim();
	if (!name) throw new Error('Project name is required.');
	if (!isProjectStatus(input.status)) throw new Error('Select a valid project status.');

	const workspace = await getCurrentWorkspace(client, accessToken);
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
