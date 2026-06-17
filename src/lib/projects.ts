import { supabase } from './supabaseClient';

export const PROJECT_STATUSES = ['proposed', 'active', 'paused', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export { buildUniqueSlug, slugifyProjectName } from './projectSlugs';

export async function getCurrentWorkspace() {
	const { data, error } = await supabase
		.from('organisation_members')
		.select('role, joined_at, created_at, organisations(id, name)')
		.eq('status', 'active')
		.order('joined_at', { ascending: true, nullsFirst: false })
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	return data;
}

export async function createProject(input: { name: string; description?: string; status?: ProjectStatus }) {
	const name = input.name.trim();
	if (!name) throw new Error('Project name is required.');

	const workspace = await getCurrentWorkspace();
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation) throw new Error('No active workspace is available.');
	if (workspace.role === 'viewer') throw new Error('Your workspace role does not permit project creation.');

	const status = input.status && PROJECT_STATUSES.includes(input.status) ? input.status : 'proposed';
	const baseSlug = slugifyProjectName(name);
	const { data: slugRows, error: slugError } = await supabase
		.from('projects')
		.select('slug')
		.eq('organisation_id', organisation.id)
		.like('slug', `${baseSlug}%`);
	if (slugError) throw slugError;

	const slug = buildUniqueSlug(baseSlug, (slugRows ?? []).map((project) => project.slug));
	const { data: userData, error: userError } = await supabase.auth.getUser();
	if (userError) throw userError;
	if (!userData.user) throw new Error('You must be signed in to create a project.');

	const { data: project, error: projectError } = await supabase
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
		.select('id, name, status, health, organisation_id')
		.single();
	if (projectError) throw projectError;

	const { error: auditError } = await supabase.from('audit_log').insert({
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
