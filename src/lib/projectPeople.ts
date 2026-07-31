import { assertCan, type WorkspaceRole } from './permissions.ts';
import { getWorkspaceBySlug } from './projects.ts';
import { listWorkspacePeople } from './workspacePeople.ts';

export const PROJECT_PEOPLE_ROLES = [
	'sponsor',
	'project_manager',
	'delivery_lead',
	'product_owner',
	'assurance_lead',
	'default_risk_owner',
	'default_issue_owner',
	'default_dependency_owner',
	'default_assumption_owner',
	'finance_stakeholder',
	'client_stakeholder',
	'project_support',
] as const;
export type ProjectPeopleRole = (typeof PROJECT_PEOPLE_ROLES)[number];

export type ProjectPersonProfile = {
	id: string;
	display_name?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	login_name?: string | null;
	email?: string | null;
};

export type ProjectPersonDemoProfile = {
	id: string;
	display_name: string;
	email?: string | null;
	workspace_role?: string | null;
	project_role?: string | null;
};

export type ProjectPersonAssignment = {
	id: string;
	organisation_id: string;
	project_id: string;
	user_id?: string | null;
	demo_person_id?: string | null;
	project_role: ProjectPeopleRole | string;
	responsibility?: string | null;
	is_primary: boolean;
	status: 'active' | 'removed' | string;
	created_by?: string | null;
	updated_by?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	profile?: ProjectPersonProfile | null;
	demoPerson?: ProjectPersonDemoProfile | null;
};

export type ProjectPersonOption = {
	source: 'user' | 'demo';
	id: string;
	displayName: string;
	email?: string | null;
	membershipId?: string | null;
	workspaceRole?: string | null;
	projectRole?: string | null;
	isDemoPerson: boolean;
};

export type ProjectPersonSelection = {
	source: 'user' | 'demo';
	id: string;
};

function uniqueValues(values: Array<string | null | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function cleanOptionalText(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanProfileText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

export function projectPersonProfileName(profile: ProjectPersonProfile | null | undefined, fallback = 'Workspace member'): string {
	if (!profile) return fallback;
	const fullName = [cleanProfileText(profile.first_name), cleanProfileText(profile.last_name)].filter(Boolean).join(' ').trim();
	return fullName
		|| cleanProfileText(profile.display_name)
		|| cleanProfileText(profile.login_name)
		|| fallback;
}

export function isProjectPeopleRole(value: unknown): value is ProjectPeopleRole {
	return typeof value === 'string' && PROJECT_PEOPLE_ROLES.includes(value as ProjectPeopleRole);
}

export function projectPeopleRoleLabel(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) return 'Project role';
	return value
		.split(/[_\s-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export function parseProjectPersonSelection(value: unknown): ProjectPersonSelection | null {
	if (typeof value !== 'string' || !value.trim()) return null;
	const [source, ...rest] = value.split(':');
	const id = rest.join(':');
	if ((source !== 'user' && source !== 'demo') || !id) return null;
	return { source, id };
}

async function enrichAssignments(assignments: ProjectPersonAssignment[], client): Promise<ProjectPersonAssignment[]> {
	if (assignments.length === 0) return assignments;

	const userIds = uniqueValues(assignments.map((assignment) => assignment.user_id));
	const demoPersonIds = uniqueValues(assignments.map((assignment) => assignment.demo_person_id));
	const profilesById = new Map<string, ProjectPersonProfile>();
	const demoPeopleById = new Map<string, ProjectPersonDemoProfile>();

	if (userIds.length > 0) {
		try {
			const people = await listWorkspacePeople(assignments[0].organisation_id, client);
			for (const person of people) {
				if (!userIds.includes(person.profileId)) continue;
				profilesById.set(person.profileId, {
					id: person.profileId,
					display_name: person.displayName,
					first_name: person.firstName,
					last_name: person.lastName,
					login_name: person.loginName,
					email: null,
				});
			}
		} catch {
			// Assignment rows remain usable even when profile labels cannot be enriched.
		}
	}

	if (demoPersonIds.length > 0) {
		try {
			const { data: demoPeople } = await client
				.from('workspace_demo_people')
				.select('id, display_name, email, workspace_role, project_role')
				.in('id', demoPersonIds);
			for (const demoPerson of demoPeople ?? []) demoPeopleById.set(demoPerson.id, demoPerson);
		} catch {
			// Demo labels are optional enrichment; the row itself is still visible.
		}
	}

	return assignments.map((assignment) => ({
		...assignment,
		profile: assignment.user_id ? profilesById.get(assignment.user_id) ?? null : null,
		demoPerson: assignment.demo_person_id ? demoPeopleById.get(assignment.demo_person_id) ?? null : null,
	}));
}

export async function listProjectPeople(
	organisationId: string,
	projectId: string,
	workspaceRole: WorkspaceRole,
	client,
): Promise<ProjectPersonAssignment[]> {
	assertCan(workspaceRole, 'project.view', 'Your workspace role does not permit project access.');

	const { data, error } = await client
		.from('project_people')
		.select('id, organisation_id, project_id, user_id, demo_person_id, project_role, responsibility, is_primary, status, created_by, updated_by, created_at, updated_at')
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.eq('status', 'active')
		.order('project_role', { ascending: true })
		.order('is_primary', { ascending: false })
		.order('created_at', { ascending: true });

	if (error) throw error;
	return enrichAssignments((data ?? []) as ProjectPersonAssignment[], client);
}

export async function listProjectPersonOptions(
	organisationId: string,
	workspaceRole: WorkspaceRole,
	client,
): Promise<ProjectPersonOption[]> {
	assertCan(workspaceRole, 'project.editDetails', 'Your workspace role does not permit project people assignment.');

	const memberRows = await listWorkspacePeople(organisationId, client, { eligibleOnly: true });

	let demoOptions: ProjectPersonOption[] = [];
	try {
		const { data: demoPeople } = await client
			.from('workspace_demo_people')
			.select('id, display_name, email, workspace_role, project_role')
			.eq('organisation_id', organisationId)
			.eq('status', 'active')
			.eq('is_demo_person', true)
			.order('display_name', { ascending: true });
		demoOptions = (demoPeople ?? []).map((person) => ({
			source: 'demo',
			id: person.id,
			displayName: person.display_name,
			email: person.email,
			workspaceRole: person.workspace_role,
			projectRole: person.project_role,
			isDemoPerson: true,
		}));
	} catch {
		demoOptions = [];
	}

	const memberOptions = memberRows.map((membership) => {
		const profile = {
			id: membership.profileId,
			display_name: membership.displayName,
			first_name: membership.firstName,
			last_name: membership.lastName,
			login_name: membership.loginName,
			email: null,
		};
		return {
			source: 'user' as const,
			id: membership.profileId,
			displayName: projectPersonProfileName(profile),
			email: null,
			membershipId: membership.membershipId,
			workspaceRole: membership.workspaceRole,
			projectRole: null,
			isDemoPerson: false,
		};
	});

	return [...memberOptions, ...demoOptions];
}

async function resolveEditableProject(workspaceSlug: string, projectSlug: string, client, accessToken?: string) {
	const workspace = await getWorkspaceBySlug(client, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation) throw new Error('Project not found or you do not have access.');
	assertCan(workspace.role, 'project.editDetails', 'Your workspace role does not permit project editing.');

	const { data: project, error } = await client
		.from('projects')
		.select('id, slug')
		.eq('slug', projectSlug)
		.eq('organisation_id', organisation.id)
		.is('deleted_at', null)
		.is('archived_at', null)
		.maybeSingle();

	if (error) throw error;
	if (!project) throw new Error('Project not found or you do not have access.');
	return { workspace, organisation, project };
}

async function assertActiveProjectPersonSelection(organisationId: string, selection: ProjectPersonSelection, client): Promise<void> {
	if (selection.source === 'user') {
		const { data, error } = await client
			.from('organisation_members')
			.select('user_id')
			.eq('organisation_id', organisationId)
			.eq('user_id', selection.id)
			.eq('status', 'active')
			.limit(1)
			.maybeSingle();
		if (error) throw error;
		if (!data) throw new Error('Select an active workspace member for this responsibility.');
		return;
	}

	const { data, error } = await client
		.from('workspace_demo_people')
		.select('id')
		.eq('organisation_id', organisationId)
		.eq('id', selection.id)
		.eq('status', 'active')
		.eq('is_demo_person', true)
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	if (!data) throw new Error('Select an active demo persona for this responsibility.');
}

export async function saveProjectPersonForRole(
	workspaceSlug: string,
	projectSlug: string,
	input: {
		projectRole: string;
		personSelection?: string | null;
		responsibility?: string | null;
	},
	client,
	accessToken?: string,
) {
	if (!isProjectPeopleRole(input.projectRole)) throw new Error('Select a valid project role.');
	const selection = parseProjectPersonSelection(input.personSelection);
	const { organisation, project } = await resolveEditableProject(workspaceSlug, projectSlug, client, accessToken);
	if (selection) await assertActiveProjectPersonSelection(organisation.id, selection, client);

	const { data, error } = await client.rpc('replace_project_person_assignment', {
		p_organisation_id: organisation.id,
		p_project_id: project.id,
		p_project_role: input.projectRole,
		p_user_profile_id: selection?.source === 'user' ? selection.id : null,
		p_demo_person_id: selection?.source === 'demo' ? selection.id : null,
		p_responsibility: cleanOptionalText(input.responsibility),
	});
	if (error) throw error;
	if (!selection) return null;

	const assignment = Array.isArray(data) ? data[0] : data;
	if (!assignment?.id) throw new Error('The project responsibility could not be confirmed after saving.');

	const { data: persisted, error: persistedError } = await client
		.from('project_people')
		.select('id, organisation_id, project_id, user_id, demo_person_id, project_role, responsibility, is_primary, status, created_by, updated_by, created_at, updated_at')
		.eq('id', assignment.id)
		.eq('organisation_id', organisation.id)
		.eq('project_id', project.id)
		.eq('project_role', input.projectRole)
		.eq('status', 'active')
		.maybeSingle();
	if (persistedError) throw persistedError;
	if (!persisted) throw new Error('The project responsibility could not be confirmed after saving.');
	return persisted as ProjectPersonAssignment;
}
