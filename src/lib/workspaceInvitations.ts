import { buildWorkspaceTeamPath } from './projectRoutes.ts';

export const WORKSPACE_INVITATION_STATUSES = [
	'pending_delivery',
	'sending',
	'delivered',
	'delivery_failed',
	'opened',
	'accepted',
	'expired',
	'cancelled',
	'superseded',
] as const;
export type WorkspaceInvitationStatus = (typeof WORKSPACE_INVITATION_STATUSES)[number];

export const WORKSPACE_INVITATION_TOKEN_BYTES = 32;
export const WORKSPACE_INVITATION_EXPIRY_HOURS = 72;

export type WorkspaceInvitationDirectoryRow = {
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
};

export type PreparedInvitation = {
	invitation_id: string;
	membership_id: string;
	profile_id: string;
	status: WorkspaceInvitationStatus | string;
	recipient_email?: string | null;
	delivery_strategy?: string | null;
	failure_code?: string | null;
	failure_message?: string | null;
};

export type InvitationDeliveryResult = {
	invitationId: string;
	membershipId: string;
	status: 'delivered' | 'delivery_failed';
	failureCode?: string;
	failureMessage?: string;
};

export function isWorkspaceInvitationStatus(value: unknown): value is WorkspaceInvitationStatus {
	return typeof value === 'string' && WORKSPACE_INVITATION_STATUSES.includes(value as WorkspaceInvitationStatus);
}

export function workspaceInvitationStatusLabel(status: unknown): string {
	return ({
		pending_delivery: 'Pending delivery',
		sending: 'Sending',
		delivered: 'Delivered',
		delivery_failed: 'Delivery failed',
		opened: 'Opened',
		accepted: 'Accepted',
		expired: 'Expired',
		cancelled: 'Cancelled',
		superseded: 'Superseded',
	} as Record<string, string>)[String(status)] ?? 'Not sent';
}

export function workspaceInvitationActionLabel(row: Pick<WorkspaceInvitationDirectoryRow, 'membership_status' | 'invitation_status'>): string {
	if (row.membership_status === 'active') return 'Invitation accepted';
	if (row.invitation_status === 'delivered' || row.invitation_status === 'opened') return 'Resend invitation';
	if (row.invitation_status === 'delivery_failed') return 'Retry invitation';
	if (row.invitation_status === 'expired' || row.invitation_status === 'cancelled' || row.invitation_status === 'superseded') return 'Send new invitation';
	return 'Send invitation';
}

export function invitationNeedsCancellation(status: unknown): boolean {
	return status === 'delivered' || status === 'opened' || status === 'pending_delivery' || status === 'delivery_failed';
}

export function workspaceInvitationTone(status: unknown): 'active' | 'info' | 'warning' | 'inactive' {
	if (status === 'accepted') return 'active';
	if (status === 'delivered' || status === 'opened') return 'info';
	if (status === 'delivery_failed' || status === 'expired') return 'warning';
	if (status === 'cancelled' || status === 'superseded') return 'inactive';
	return 'info';
}

export function invitationLifecycleCounts(rows: WorkspaceInvitationDirectoryRow[]) {
	const invited = rows.filter((row) => row.membership_status === 'invited' || row.membership_status === 'invite_expired');
	const delivered = invited.filter((row) => row.invitation_status === 'delivered' || row.invitation_status === 'opened').length;
	const accepted = rows.filter((row) => row.membership_status === 'active' || row.invitation_status === 'accepted').length;
	const expired = invited.filter((row) => row.invitation_status === 'expired' || row.membership_status === 'invite_expired').length;
	const failed = invited.filter((row) => row.invitation_status === 'delivery_failed').length;
	const pendingDelivery = invited.filter((row) => !row.invitation_status || row.invitation_status === 'pending_delivery').length;
	const awaitingAcceptance = invited.filter((row) => row.invitation_status === 'delivered' || row.invitation_status === 'opened').length;
	const eligibleToSend = invited.filter((row) => (
		!row.invitation_status
		|| ['pending_delivery', 'delivery_failed', 'expired', 'cancelled', 'superseded'].includes(String(row.invitation_status))
	)).length;
	return {
		invited: invited.length,
		pendingDelivery,
		delivered,
		accepted,
		expired,
		failed,
		awaitingAcceptance,
		eligibleToSend,
	};
}

export function buildWorkspaceTeamInvitationSendPath(workspaceSlug: string): string {
	return `${buildWorkspaceTeamPath(workspaceSlug)}/invitations/send`;
}

export function buildWorkspaceInvitationAcceptPath(token: string, baseUrl: URL | string): string {
	const url = new URL('/invitations/accept', baseUrl);
	url.searchParams.set('token', token);
	return url.toString();
}

export function generateInvitationToken(): string {
	const bytes = new Uint8Array(WORKSPACE_INVITATION_TOKEN_BYTES);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashInvitationToken(token: string): Promise<string> {
	const data = new TextEncoder().encode(token);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function currentInvitationActionForSubmission(status: unknown): 'send' | 'resend' | 'retry' {
	if (status === 'delivered' || status === 'opened') return 'resend';
	if (status === 'delivery_failed') return 'retry';
	return 'send';
}

export function summariseInvitationSendResults(results: InvitationDeliveryResult[]) {
	const delivered = results.filter((result) => result.status === 'delivered').length;
	const failed = results.filter((result) => result.status === 'delivery_failed').length;
	return { delivered, failed, total: results.length };
}

export type InvitationEmailModel = {
	workspaceName: string;
	personName: string;
	roleLabel: string;
	acceptUrl: string;
	expiresAt?: string | null;
};

export function renderInvitationEmail(model: InvitationEmailModel) {
	const expiryText = model.expiresAt
		? `This invitation expires on ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(model.expiresAt))}.`
		: `This invitation expires after ${WORKSPACE_INVITATION_EXPIRY_HOURS} hours.`;
	const subject = 'You have been invited to the Watchtower workspace';
	const text = [
		`Hello ${model.personName},`,
		'',
		`You have been invited to join ${model.workspaceName} in Watchtower as ${model.roleLabel}.`,
		expiryText,
		'',
		`Accept invitation: ${model.acceptUrl}`,
		'',
		'If you were not expecting this invitation, ignore this message or report it to the workspace Owner.',
	].join('\n');
	const html = [
		'<main>',
		`<p>Hello ${escapeHtml(model.personName)},</p>`,
		`<p>You have been invited to join <strong>${escapeHtml(model.workspaceName)}</strong> in Watchtower as <strong>${escapeHtml(model.roleLabel)}</strong>.</p>`,
		`<p>${escapeHtml(expiryText)}</p>`,
		`<p><a href="${escapeHtml(model.acceptUrl)}">Accept invitation</a></p>`,
		'<p>If you were not expecting this invitation, ignore this message or report it to the workspace Owner.</p>',
		'</main>',
	].join('');
	return { subject, text, html };
}

export function invitationDeliveryMode(): 'provider_required' | 'test_record_only' {
	const mode = String(import.meta.env?.WATCHTOWER_INVITATION_DELIVERY_MODE ?? '').trim();
	return mode === 'test_record_only' ? 'test_record_only' : 'provider_required';
}

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
