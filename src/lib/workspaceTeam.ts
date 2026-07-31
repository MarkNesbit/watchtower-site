import { isWorkspaceRole, type WorkspaceRole } from './permissions.ts';

export const MEMBERSHIP_STATUSES = ['active', 'invited', 'invite_expired', 'suspended', 'deactivated'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export type TeamFilter = 'all' | 'active' | 'invitations' | 'deactivated';

export type WorkspaceTeamMember = {
	organisation_id: string;
	organisation_membership_id: string;
	profile_id: string;
	auth_user_id?: string | null;
	display_name?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	login_name?: string | null;
	contact_email?: string | null;
	last_login_at?: string | null;
	role?: string | null;
	membership_status?: string | null;
	is_deactivated?: boolean | null;
	invited_at?: string | null;
	invitation_expires_at?: string | null;
	joined_at?: string | null;
	accepted_at?: string | null;
	deactivated_at?: string | null;
	deactivated_by?: string | null;
	deactivated_by_display_name?: string | null;
	deactivation_reason?: string | null;
	reactivated_at?: string | null;
	reactivated_by?: string | null;
	reactivation_reason?: string | null;
	invitation_id?: string | null;
	invitation_status?: string | null;
	invitation_delivered_at?: string | null;
	invitation_opened_at?: string | null;
	invitation_accepted_at?: string | null;
	invitation_cancelled_at?: string | null;
	invitation_superseded_at?: string | null;
	invitation_delivery_attempt_count?: number | null;
	invitation_last_delivery_attempt_at?: string | null;
	invitation_failure_code?: string | null;
	invitation_failure_message?: string | null;
	invitation_delivery_strategy?: string | null;
	updated_at?: string | null;
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
	membership_snapshot_version: number | string;
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

export const WORKSPACE_TEAM_MEMBER_SESSION_RPC = 'start_workspace_member_edit_session_api';
export const WORKSPACE_TEAM_MEMBER_SESSION_RELEASE_RPC = 'release_workspace_member_edit_session_api';
export const WORKSPACE_TEAM_MEMBER_ROLE_CHANGE_RPC = 'change_workspace_member_role_api';
export const WORKSPACE_TEAM_MEMBER_DEACTIVATION_IMPACT_RPC = 'workspace_member_deactivation_impact_summary_api';
export const WORKSPACE_TEAM_MEMBER_DEACTIVATE_RPC = 'deactivate_workspace_member_from_modal_api';
export const WORKSPACE_TEAM_MEMBER_REACTIVATE_RPC = 'reactivate_workspace_member_from_modal_api';
export const WORKSPACE_TEAM_MEMBER_DEACTIVATION_REASON_MAX_LENGTH = 500;
export const WORKSPACE_TEAM_MEMBER_REACTIVATION_REASON_MAX_LENGTH = 500;

export type WorkspaceTeamRoleAuthority = {
	canEdit: boolean;
	options: WorkspaceRole[];
	reason: string;
};

export type WorkspaceTeamDeactivationAuthority = {
	canDeactivate: boolean;
	reason: string;
};

export type WorkspaceTeamReactivationAuthority = {
	canReactivate: boolean;
	options: WorkspaceRole[];
	canRestorePreviousRole: boolean;
	reason: string;
	restoreReason: string;
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

export function workspaceTeamRoleAuthority(actorRole: unknown, targetRole: unknown, isSelf = false): WorkspaceTeamRoleAuthority {
	if (!isWorkspaceRole(actorRole)) {
		return {
			canEdit: false,
			options: [],
			reason: 'Only active Workspace Owners and Admins can change workspace roles.',
		};
	}
	if (!isWorkspaceRole(targetRole)) {
		return {
			canEdit: false,
			options: [],
			reason: 'This member role could not be confirmed.',
		};
	}
	if (actorRole !== 'owner' && actorRole !== 'admin') {
		return {
			canEdit: false,
			options: [],
			reason: 'Only active Workspace Owners and Admins can change workspace roles.',
		};
	}
	if (isSelf) {
		return {
			canEdit: false,
			options: [],
			reason: 'Users cannot change their own workspace role through this modal.',
		};
	}
	if (actorRole === 'owner') {
		return {
			canEdit: true,
			options: ['viewer', 'member', 'admin', 'owner'],
			reason: 'Owners can assign Viewer, Member, Admin or Owner to another active member.',
		};
	}
	if (targetRole === 'admin') {
		return {
			canEdit: false,
			options: [],
			reason: 'Only a Workspace Owner may change an Admin role.',
		};
	}
	if (targetRole === 'owner') {
		return {
			canEdit: false,
			options: [],
			reason: 'Admins cannot change an Owner role.',
		};
	}
	return {
		canEdit: true,
		options: ['viewer', 'member'],
		reason: 'Admins can move Viewers and Members between Viewer and Member.',
	};
}

export function workspaceTeamDeactivationAuthority(actorRole: unknown, targetRole: unknown, isSelf = false): WorkspaceTeamDeactivationAuthority {
	if (!isWorkspaceRole(actorRole)) {
		return {
			canDeactivate: false,
			reason: 'Only active Workspace Owners and Admins can deactivate workspace members.',
		};
	}
	if (!isWorkspaceRole(targetRole)) {
		return {
			canDeactivate: false,
			reason: 'This member role could not be confirmed.',
		};
	}
	if (actorRole !== 'owner' && actorRole !== 'admin') {
		return {
			canDeactivate: false,
			reason: 'Only active Workspace Owners and Admins can deactivate workspace members.',
		};
	}
	if (isSelf) {
		return {
			canDeactivate: false,
			reason: 'Users cannot deactivate their own workspace membership through this modal.',
		};
	}
	if (actorRole === 'owner') {
		return {
			canDeactivate: true,
			reason: 'Owners can deactivate another active workspace member after reviewing current responsibilities.',
		};
	}
	if (targetRole === 'viewer' || targetRole === 'member') {
		return {
			canDeactivate: true,
			reason: 'Admins can deactivate Viewers and Members after reviewing current responsibilities.',
		};
	}
	if (targetRole === 'admin') {
		return {
			canDeactivate: false,
			reason: 'Only a Workspace Owner may deactivate an Admin.',
		};
	}
	return {
		canDeactivate: false,
		reason: 'Admins cannot deactivate an Owner.',
	};
}

export function workspaceTeamReactivationAuthority(actorRole: unknown, previousRole: unknown, isSelf = false): WorkspaceTeamReactivationAuthority {
	if (!isWorkspaceRole(actorRole)) {
		return {
			canReactivate: false,
			options: [],
			canRestorePreviousRole: false,
			reason: 'Only active Workspace Owners and Admins can reactivate workspace members.',
			restoreReason: 'The previous role cannot be restored because your workspace authority could not be confirmed.',
		};
	}
	if (!isWorkspaceRole(previousRole)) {
		return {
			canReactivate: false,
			options: [],
			canRestorePreviousRole: false,
			reason: 'The previous workspace role could not be confirmed. Choose a new role after support has reviewed the membership history.',
			restoreReason: 'Deactivated in error is unavailable because the previous role is not reliable.',
		};
	}
	if (actorRole !== 'owner' && actorRole !== 'admin') {
		return {
			canReactivate: false,
			options: [],
			canRestorePreviousRole: false,
			reason: 'Only active Workspace Owners and Admins can reactivate workspace members.',
			restoreReason: 'Only active Workspace Owners and Admins can restore a previous workspace role.',
		};
	}
	if (isSelf) {
		return {
			canReactivate: false,
			options: [],
			canRestorePreviousRole: false,
			reason: 'Users cannot reactivate their own workspace membership through this modal.',
			restoreReason: 'Users cannot restore their own previous workspace role through this modal.',
		};
	}
	if (actorRole === 'owner') {
		return {
			canReactivate: true,
			options: ['viewer', 'member', 'admin', 'owner'],
			canRestorePreviousRole: true,
			reason: 'Owners can reactivate a deactivated member as Viewer, Member, Admin or Owner.',
			restoreReason: `Deactivated in error can restore the previous ${workspaceRoleLabel(previousRole)} role.`,
		};
	}
	if (previousRole === 'viewer' || previousRole === 'member') {
		return {
			canReactivate: true,
			options: ['viewer', 'member'],
			canRestorePreviousRole: true,
			reason: 'Admins can reactivate former Viewers and Members as Viewer or Member.',
			restoreReason: `Deactivated in error can restore the previous ${workspaceRoleLabel(previousRole)} role.`,
		};
	}
	if (previousRole === 'admin') {
		return {
			canReactivate: false,
			options: [],
			canRestorePreviousRole: false,
			reason: 'Only a Workspace Owner may reactivate a former Admin.',
			restoreReason: 'Admins cannot restore a previous Admin role.',
		};
	}
	return {
		canReactivate: false,
		options: [],
		canRestorePreviousRole: false,
		reason: 'Admins cannot reactivate a former Owner.',
		restoreReason: 'Admins cannot restore a previous Owner role.',
	};
}

export function workspaceTeamRoleChangeErrorMessage(error: unknown): string {
	const message = typeof (error as { message?: unknown })?.message === 'string'
		? (error as { message: string }).message
		: '';
	if (message.includes('WT_MEMBER_ROLE_STALE')) return 'This membership changed while the modal was open. Refresh the Team page and try again.';
	if (message.includes('WT_MEMBER_ROLE_LOCKED')) return 'This member is currently being viewed by another Workspace administrator. Refresh when their edit session has ended.';
	if (message.includes('WT_MEMBER_ROLE_SESSION')) return 'Your member edit session expired or could not be confirmed. Close and reopen the member modal.';
	if (message.includes('WT_MEMBER_ROLE_SELF_DENIED')) return 'Users cannot change their own workspace role through this modal.';
	if (message.includes('WT_MEMBER_ROLE_ADMIN_TARGET_DENIED')) return 'Admins can change only Viewer and Member roles.';
	if (message.includes('WT_MEMBER_ROLE_ADMIN_ASSIGN_DENIED')) return 'Admins cannot assign Admin or Owner roles.';
	if (message.includes('WT_MEMBER_ROLE_INVALID_TARGET')) return 'Choose a permitted workspace role.';
	if (message.includes('WT_MEMBER_ROLE_ACTIVE_ONLY')) return 'Only active workspace members can be changed through this modal.';
	if (message.includes('WT_MEMBERSHIP_PERMISSION_DENIED')) return 'Only active Workspace Owners and Admins can manage workspace roles.';
	return 'The role change could not be saved. No membership changes were applied.';
}

export function workspaceTeamDeactivationErrorMessage(error: unknown): string {
	const message = typeof (error as { message?: unknown })?.message === 'string'
		? (error as { message: string }).message
		: '';
	if (message.includes('WT_MEMBER_DEACTIVATION_STALE')) return 'This membership changed while the modal was open. Refresh the Team page and try again.';
	if (message.includes('WT_MEMBER_DEACTIVATION_LOCKED')) return 'This member is currently being viewed by another Workspace administrator. Refresh when their edit session has ended.';
	if (message.includes('WT_MEMBER_DEACTIVATION_SESSION')) return 'Your member edit session expired or could not be confirmed. Close and reopen the member modal.';
	if (message.includes('WT_MEMBER_DEACTIVATION_SELF_DENIED')) return 'Users cannot deactivate their own workspace membership through this modal.';
	if (message.includes('WT_MEMBER_DEACTIVATION_ADMIN_TARGET_DENIED')) return 'Admins can deactivate only Viewer and Member memberships.';
	if (message.includes('WT_MEMBER_DEACTIVATION_REASON_REQUIRED')) return 'Enter a deactivation reason for the audit record.';
	if (message.includes('WT_MEMBER_DEACTIVATION_REASON_TOO_LONG')) return `Deactivation reason must be ${WORKSPACE_TEAM_MEMBER_DEACTIVATION_REASON_MAX_LENGTH} characters or fewer.`;
	if (message.includes('WT_MEMBER_DEACTIVATION_ACTIVE_ONLY')) return 'Only active workspace members can be deactivated through this modal.';
	if (message.includes('WT_MEMBERSHIP_FINAL_OWNER')) return 'The final active Workspace Owner cannot be deactivated.';
	if (message.includes('WT_MEMBERSHIP_PERMISSION_DENIED')) return 'Only active Workspace Owners and Admins can deactivate workspace members.';
	return 'The member could not be deactivated. No membership changes were applied.';
}

export function workspaceTeamReactivationErrorMessage(error: unknown): string {
	const message = typeof (error as { message?: unknown })?.message === 'string'
		? (error as { message: string }).message
		: '';
	if (message.includes('WT_MEMBER_REACTIVATION_STALE')) return 'This membership changed while the modal was open. Refresh the Team page and try again.';
	if (message.includes('WT_MEMBER_REACTIVATION_LOCKED')) return 'This member is currently being viewed by another Workspace administrator. Refresh when their edit session has ended.';
	if (message.includes('WT_MEMBER_REACTIVATION_SESSION')) return 'Your member edit session expired or could not be confirmed. Close and reopen the member modal.';
	if (message.includes('WT_MEMBER_REACTIVATION_SELF_DENIED')) return 'Users cannot reactivate their own workspace membership through this modal.';
	if (message.includes('WT_MEMBER_REACTIVATION_ADMIN_TARGET_DENIED')) return 'Admins can reactivate only former Viewer and Member memberships.';
	if (message.includes('WT_MEMBER_REACTIVATION_ADMIN_ASSIGN_DENIED')) return 'Admins cannot reactivate a member as Admin or Owner.';
	if (message.includes('WT_MEMBER_REACTIVATION_INVALID_TARGET')) return 'Choose a permitted workspace role before reactivating this member.';
	if (message.includes('WT_MEMBER_REACTIVATION_REASON_REQUIRED')) return 'Enter a reactivation reason for the audit record.';
	if (message.includes('WT_MEMBER_REACTIVATION_REASON_TOO_LONG')) return `Reactivation reason must be ${WORKSPACE_TEAM_MEMBER_REACTIVATION_REASON_MAX_LENGTH} characters or fewer.`;
	if (message.includes('WT_MEMBER_REACTIVATION_DEACTIVATED_ONLY')) return 'Only deactivated workspace members can be reactivated through this modal.';
	if (message.includes('WT_MEMBER_REACTIVATION_ACCEPTED_ONLY')) return 'Only a previously accepted workspace member can be reactivated without a new invitation.';
	if (message.includes('WT_MEMBER_REACTIVATION_AUTH_IDENTITY_MISSING')) return 'This member cannot be reactivated because their sign-in identity is missing. Account recovery is outside this workflow.';
	if (message.includes('WT_MEMBER_REACTIVATION_PREVIOUS_ROLE_UNAVAILABLE')) return 'The previous role could not be confirmed, so Deactivated in error cannot be used.';
	if (message.includes('WT_MEMBERSHIP_PERMISSION_DENIED')) return 'Only active Workspace Owners and Admins can reactivate workspace members.';
	return 'The member could not be reactivated. No membership changes were applied.';
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
	return fullName || cleanText(member.display_name) || cleanText(member.login_name) || 'Workspace user';
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
	return { lifecycleDateLabel: 'Joined', lifecycleDateValue: member.joined_at ?? member.accepted_at ?? member.reactivated_at ?? null };
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
				isCurrentUser: Boolean(currentUserId && member.auth_user_id === currentUserId),
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
