import { isWorkspaceRole, type WorkspaceRole } from './permissions.ts';

export const ACTION_STATUSES = [
	'open',
	'submitted',
	'returned_to_raiser',
	'rejected_by_actioner',
	'returned_to_actioner',
	'complete',
	'cancelled',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ACTION_SOURCE_TYPES = ['project', 'risk', 'project_details', 'narrative'] as const;
export type ActionSourceType = (typeof ACTION_SOURCE_TYPES)[number];

export const ACTION_HISTORY_EVENT_TYPES = [
	'created',
	'assigned',
	'unassigned',
	'reassigned',
	'brief_amended',
	'due_date_changed',
	'submitted',
	'returned_to_raiser',
	'rejected_by_actioner',
	'returned_to_actioner',
	'reissued',
	'acceptance_owner_taken_over',
	'completed',
	'cancelled',
] as const;
export type ActionHistoryEventType = (typeof ACTION_HISTORY_EVENT_TYPES)[number];

export const ACTION_DISPLAY_LABELS: Record<ActionStatus, string> = {
	open: 'Open',
	submitted: 'Awaiting raiser review',
	returned_to_raiser: 'Returned for clarification',
	rejected_by_actioner: 'Rejected',
	returned_to_actioner: 'Further work required',
	complete: 'Complete',
	cancelled: 'Cancelled',
};

export function isActionStatus(value: unknown): value is ActionStatus {
	return typeof value === 'string' && ACTION_STATUSES.includes(value as ActionStatus);
}

export function isActionSourceType(value: unknown): value is ActionSourceType {
	return typeof value === 'string' && ACTION_SOURCE_TYPES.includes(value as ActionSourceType);
}

export function isActionHistoryEventType(value: unknown): value is ActionHistoryEventType {
	return typeof value === 'string' && ACTION_HISTORY_EVENT_TYPES.includes(value as ActionHistoryEventType);
}

export function actionDisplayLabel(status: unknown): string {
	return isActionStatus(status) ? ACTION_DISPLAY_LABELS[status] : 'Unknown';
}

export function isTerminalActionStatus(status: unknown): boolean {
	return status === 'complete' || status === 'cancelled';
}

export function isValidActionProjectRef(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Z][A-Z0-9]{2,3}$/.test(value);
}

export function buildActionReference(projectRef: string, sequence: number): string {
	if (!isValidActionProjectRef(projectRef)) {
		throw new Error('This project needs a valid project reference before actions can be created.');
	}
	if (!Number.isInteger(sequence) || sequence < 1) {
		throw new Error('Watchtower could not assign a valid Action reference. Please try again.');
	}
	return `Action-${projectRef}-${String(sequence).padStart(3, '0')}`;
}

export function isValidActionReference(value: unknown): value is string {
	return typeof value === 'string' && /^Action-[A-Z][A-Z0-9]{2,3}-[0-9]{3,}$/.test(value);
}

function cleanOptionalText(value: string | null | undefined): string | null {
	return value?.trim() || null;
}

export function normaliseActionEvidenceUrl(value: string | null | undefined): string | null {
	const url = cleanOptionalText(value);
	if (!url) return null;

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		throw new Error('Enter a valid evidence URL.');
	}

	if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
		throw new Error('Enter a safe evidence URL that starts with http:// or https://.');
	}

	return parsedUrl.href;
}

export function canHoldActionWorkflowRole(role: unknown): role is Exclude<WorkspaceRole, 'viewer'> {
	return isWorkspaceRole(role) && role !== 'viewer';
}

export const canBeAssignedActionerRole = canHoldActionWorkflowRole;

export function canTakeOverActionAcceptanceRole(role: unknown): role is 'owner' | 'admin' {
	return role === 'owner' || role === 'admin';
}
