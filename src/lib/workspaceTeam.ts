import { isWorkspaceRole, type WorkspaceRole } from './permissions.ts';

export const MEMBERSHIP_STATUSES = ['active', 'invited', 'invite_expired', 'suspended', 'deactivated'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export type TeamFilter = 'all' | 'active' | 'invitations' | 'deactivated';

export type WorkspaceTeamMember = {
	organisation_id: string;
	organisation_membership_id: string;
	profile_id: string;
	display_name?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	login_name?: string | null;
	role?: string | null;
	membership_status?: string | null;
	is_deactivated?: boolean | null;
	invited_at?: string | null;
	invitation_expires_at?: string | null;
	accepted_at?: string | null;
	deactivated_at?: string | null;
	reactivated_at?: string | null;
};

export type WorkspaceTeamActiveEditableCheckout = {
	id: string;
	organisation_id: string;
	requested_by: string | null;
	exported_at: string;
	export_mode: string;
	editing_mode: string;
	status: string;
	checkout_expires_at: string;
	membership_snapshot_version: number;
	superseded_at: string | null;
	released_at: string | null;
};

export type WorkspaceTeamDisplayMember = WorkspaceTeamMember & {
	personName: string;
	displayRole: string;
	displayStatus: string;
	statusTone: 'active' | 'info' | 'warning' | 'inactive';
	statusDescription: string;
	loginLabel: string;
	lifecycleDateLabel: string;
	lifecycleDateValue: string | null;
	isCurrentUser: boolean;
};

export const WORKSPACE_TEAM_ACTIVE_EDITABLE_CHECKOUT_SELECT = [
	'id',
	'organisation_id',
	'requested_by',
	'exported_at',
	'export_mode',
	'editing_mode',
	'status',
	'checkout_expires_at',
	'membership_snapshot_version',
	'superseded_at',
	'released_at',
].join(', ');

const ROLE_LABELS: Record<WorkspaceRole, string> = {
	owner: 'Owner',
	admin: 'Admin',
	member: 'Member',
	viewer: 'Viewer',
};

const STATUS_LABELS: Record<MembershipStatus, string> = {
	active: 'Active',
	invited: 'Invited',
	invite_expired: 'Invitation expired',
	suspended: 'Suspended',
	deactivated: 'Deactivated',
};

const STATUS_DESCRIPTIONS: Record<MembershipStatus, string> = {
	active: 'Membership is active and grants workspace access.',
	invited: 'Invitation has been created but not accepted.',
	invite_expired: 'Invitation expired before activation.',
	suspended: 'Membership is suspended and does not grant workspace access.',
	deactivated: 'Membership is deactivated and retained for history.',
};

export function membershipStatusLabel(status: unknown): string {
	return isMembershipStatus(status) ? STATUS_LABELS[status] : 'Unknown';
}

export function membershipStatusDescription(status: unknown): string {
	return isMembershipStatus(status) ? STATUS_DESCRIPTIONS[status] : 'Membership state is not recognised.';
}

export function workspaceRoleLabel(role: unknown): string {
	return isWorkspaceRole(role) ? ROLE_LABELS[role] : 'Unavailable';
}

export function isMembershipStatus(status: unknown): status is MembershipStatus {
	return typeof status === 'string' && MEMBERSHIP_STATUSES.includes(status as MembershipStatus);
}

export function statusTone(status: unknown): WorkspaceTeamDisplayMember['statusTone'] {
	if (status === 'active') return 'active';
	if (status === 'invited') return 'info';
	if (status === 'invite_expired' || status === 'suspended') return 'warning';
	return 'inactive';
}

function cleanText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

export function applyWorkspaceTeamActiveEditableCheckoutFilters(query: any, organisationId: string, nowIso = new Date().toISOString()) {
	return query
		.select(WORKSPACE_TEAM_ACTIVE_EDITABLE_CHECKOUT_SELECT)
		.eq('organisation_id', organisationId)
		.eq('export_mode', 'editable')
		.eq('status', 'checked_out')
		.eq('editing_mode', 'checked_out')
		.is('superseded_at', null)
		.is('released_at', null)
		.gt('checkout_expires_at', nowIso)
		.order('exported_at', { ascending: false })
		.limit(1);
}

export function isWorkspaceTeamActiveEditableCheckout(
	checkout: WorkspaceTeamActiveEditableCheckout | null | undefined,
	organisationId: string,
	now = new Date(),
): checkout is WorkspaceTeamActiveEditableCheckout {
	if (!checkout) return false;
	return (
		checkout.organisation_id === organisationId &&
		checkout.export_mode === 'editable' &&
		checkout.status === 'checked_out' &&
		checkout.editing_mode === 'checked_out' &&
		checkout.superseded_at === null &&
		checkout.released_at === null &&
		new Date(checkout.checkout_expires_at).getTime() > now.getTime()
	);
}

export function workspaceTeamPersonName(member: Pick<WorkspaceTeamMember, 'first_name' | 'last_name' | 'display_name' | 'login_name' | 'membership_status'>): string {
	const firstName = cleanText(member.first_name);
	const lastName = cleanText(member.last_name);
	const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
	const baseName = fullName || cleanText(member.display_name) || cleanText(member.login_name) || 'Workspace user';
	return member.membership_status === 'deactivated' ? `${baseName} [deactivated]` : baseName;
}

export function workspaceTeamLoginLabel(member: Pick<WorkspaceTeamMember, 'login_name' | 'display_name'>): string {
	return cleanText(member.login_name) || cleanText(member.display_name) || 'Not set';
}

export function compareWorkspaceTeamMembers(a: WorkspaceTeamMember, b: WorkspaceTeamMember): number {
	const sortPartsA = [
		cleanText(a.last_name).toLocaleLowerCase(),
		cleanText(a.first_name).toLocaleLowerCase(),
		cleanText(a.login_name).toLocaleLowerCase(),
		cleanText(a.organisation_membership_id).toLocaleLowerCase(),
	];
	const sortPartsB = [
		cleanText(b.last_name).toLocaleLowerCase(),
		cleanText(b.first_name).toLocaleLowerCase(),
		cleanText(b.login_name).toLocaleLowerCase(),
		cleanText(b.organisation_membership_id).toLocaleLowerCase(),
	];

	for (let index = 0; index < sortPartsA.length; index += 1) {
		const result = sortPartsA[index].localeCompare(sortPartsB[index]);
		if (result !== 0) return result;
	}
	return 0;
}

export function memberMatchesFilter(member: Pick<WorkspaceTeamMember, 'membership_status'>, filter: TeamFilter): boolean {
	if (filter === 'all') return true;
	if (filter === 'active') return member.membership_status === 'active';
	if (filter === 'invitations') return member.membership_status === 'invited' || member.membership_status === 'invite_expired';
	return member.membership_status === 'deactivated';
}

export function memberMatchesSearch(member: WorkspaceTeamMember, search: string): boolean {
	const query = search.trim().toLocaleLowerCase();
	if (!query) return true;
	return [
		member.first_name,
		member.last_name,
		member.display_name,
		member.login_name,
		workspaceTeamPersonName(member),
	]
		.some((value) => cleanText(value).toLocaleLowerCase().includes(query));
}

export function lifecycleDate(member: WorkspaceTeamMember): Pick<WorkspaceTeamDisplayMember, 'lifecycleDateLabel' | 'lifecycleDateValue'> {
	if (member.membership_status === 'invited') return { lifecycleDateLabel: 'Invited', lifecycleDateValue: member.invited_at ?? null };
	if (member.membership_status === 'invite_expired') return { lifecycleDateLabel: 'Expired', lifecycleDateValue: member.invitation_expires_at ?? member.invited_at ?? null };
	if (member.membership_status === 'deactivated') return { lifecycleDateLabel: 'Deactivated', lifecycleDateValue: member.deactivated_at ?? null };
	if (member.membership_status === 'suspended') return { lifecycleDateLabel: 'Suspended', lifecycleDateValue: null };
	return { lifecycleDateLabel: 'Joined', lifecycleDateValue: member.accepted_at ?? member.reactivated_at ?? null };
}

export function buildWorkspaceTeamDisplayMembers(
	members: WorkspaceTeamMember[],
	options: { currentUserId?: string | null; filter?: TeamFilter; search?: string } = {},
): WorkspaceTeamDisplayMember[] {
	const { currentUserId = null, filter = 'all', search = '' } = options;
	return members
		.filter((member) => memberMatchesFilter(member, filter))
		.filter((member) => memberMatchesSearch(member, search))
		.sort(compareWorkspaceTeamMembers)
		.map((member) => {
			const lifecycle = lifecycleDate(member);
			return {
				...member,
				personName: workspaceTeamPersonName(member),
				displayRole: workspaceRoleLabel(member.role),
				displayStatus: membershipStatusLabel(member.membership_status),
				statusTone: statusTone(member.membership_status),
				statusDescription: membershipStatusDescription(member.membership_status),
				loginLabel: workspaceTeamLoginLabel(member),
				lifecycleDateLabel: lifecycle.lifecycleDateLabel,
				lifecycleDateValue: lifecycle.lifecycleDateValue,
				isCurrentUser: member.profile_id === currentUserId,
			};
		});
}

export function membershipStateCounts(members: WorkspaceTeamMember[]) {
	return {
		all: members.length,
		active: members.filter((member) => member.membership_status === 'active').length,
		invitations: members.filter((member) => member.membership_status === 'invited' || member.membership_status === 'invite_expired').length,
		deactivated: members.filter((member) => member.membership_status === 'deactivated').length,
	};
}
