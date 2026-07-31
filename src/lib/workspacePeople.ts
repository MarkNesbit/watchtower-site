import type { WorkspaceRole } from './permissions.ts';

export type WorkspaceMembershipStatus = 'invited' | 'invite_expired' | 'active' | 'suspended' | 'deactivated' | string;

export type WorkspacePerson = {
	membershipId: string;
	workspaceId: string;
	profileId: string;
	authUserId: string | null;
	displayName: string;
	firstName: string | null;
	lastName: string | null;
	loginName: string | null;
	workspaceRole: WorkspaceRole | string | null;
	membershipStatus: WorkspaceMembershipStatus;
	invitationStatus: string | null;
	deactivatedAt: string | null;
	assignmentEligible: boolean;
};

type WorkspacePersonRow = {
	organisation_id?: string | null;
	organisation_membership_id?: string | null;
	profile_id?: string | null;
	auth_user_id?: string | null;
	resolved_display_name?: string | null;
	display_name?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	login_name?: string | null;
	role?: string | null;
	membership_status?: string | null;
	invitation_status?: string | null;
	deactivated_at?: string | null;
	assignment_eligible?: boolean | null;
};

const WORKSPACE_PERSON_SELECT = 'organisation_id, organisation_membership_id, profile_id, auth_user_id, resolved_display_name, display_name, first_name, last_name, login_name, role, membership_status, invitation_status, deactivated_at, assignment_eligible';

function cleanText(value: unknown): string {
	return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function workspacePersonDisplayName(person: Partial<WorkspacePersonRow> | null | undefined, fallback = 'Workspace member'): string {
	const fullName = [cleanText(person?.first_name), cleanText(person?.last_name)].filter(Boolean).join(' ').trim();
	return fullName
		|| cleanText(person?.display_name)
		|| cleanText(person?.login_name)
		|| cleanText(person?.resolved_display_name)
		|| fallback;
}

function toWorkspacePerson(row: WorkspacePersonRow): WorkspacePerson | null {
	const membershipId = cleanText(row.organisation_membership_id);
	const workspaceId = cleanText(row.organisation_id);
	const profileId = cleanText(row.profile_id);
	if (!membershipId || !workspaceId || !profileId) return null;

	return {
		membershipId,
		workspaceId,
		profileId,
		authUserId: cleanText(row.auth_user_id) || null,
		displayName: workspacePersonDisplayName(row, `Workspace member ${membershipId.slice(0, 8)}`),
		firstName: cleanText(row.first_name) || null,
		lastName: cleanText(row.last_name) || null,
		loginName: cleanText(row.login_name) || null,
		workspaceRole: cleanText(row.role) || null,
		membershipStatus: cleanText(row.membership_status) || 'unknown',
		invitationStatus: cleanText(row.invitation_status) || null,
		deactivatedAt: cleanText(row.deactivated_at) || null,
		assignmentEligible: row.assignment_eligible === true && row.membership_status === 'active',
	};
}

export async function listWorkspacePeople(
	organisationId: string,
	client,
	options: { eligibleOnly?: boolean } = {},
): Promise<WorkspacePerson[]> {
	let query = client
		.from('workspace_member_directory')
		.select(WORKSPACE_PERSON_SELECT)
		.eq('organisation_id', organisationId);

	if (options.eligibleOnly) query = query.eq('assignment_eligible', true);

	const { data, error } = await query
		.order('joined_at', { ascending: true, nullsFirst: false })
		.order('organisation_membership_id', { ascending: true });
	if (error) throw error;

	return (data ?? [])
		.map((row: WorkspacePersonRow) => toWorkspacePerson(row))
		.filter((person: WorkspacePerson | null): person is WorkspacePerson => person !== null);
}

export function workspacePeopleByIdentity(people: WorkspacePerson[]): Map<string, WorkspacePerson> {
	const byIdentity = new Map<string, WorkspacePerson>();
	for (const person of people) {
		byIdentity.set(person.profileId, person);
		if (person.authUserId) byIdentity.set(person.authUserId, person);
	}
	return byIdentity;
}
