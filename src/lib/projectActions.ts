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

export type ProjectAction = {
	id: string;
	organisation_id: string;
	project_id: string;
	action_number: number;
	action_ref: string;
	brief: string;
	status: ActionStatus;
	due_date: string;
	raiser_id: string;
	actioner_id: string | null;
	acceptance_owner_id: string;
	source_type: ActionSourceType;
	source_record_id: string | null;
	source_ref: string | null;
	source_label: string | null;
	source_context: Record<string, unknown>;
	latest_response: string | null;
	latest_evidence_url: string | null;
	submitted_at: string | null;
	completed_at: string | null;
	cancelled_at: string | null;
	created_by: string;
	updated_by: string | null;
	created_at: string;
	updated_at: string;
};

type ProjectActionRpcClient = {
	rpc: (functionName: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export type ProjectActionExpectedState = {
	expectedStatus: ActionStatus;
	expectedUpdatedAt?: string | null;
};

export type CreateProjectActionInput = {
	projectId: string;
	brief: string;
	dueDate: string;
	actionerId?: string | null;
	sourceType?: ActionSourceType;
	sourceRecordId?: string | null;
	sourceRef?: string | null;
	sourceLabel?: string | null;
	sourceContext?: Record<string, unknown>;
};

export type SubmitProjectActionInput = ProjectActionExpectedState & {
	actionId: string;
	response: string;
	evidenceUrl?: string | null;
};

export type ActionReasonInput = ProjectActionExpectedState & {
	actionId: string;
	reason: string;
};

export type ActionExpectedInput = ProjectActionExpectedState & {
	actionId: string;
};

export type AssignProjectActionInput = ProjectActionExpectedState & {
	actionId: string;
	actionerId: string | null;
};

export type AmendProjectActionBriefInput = ProjectActionExpectedState & {
	actionId: string;
	brief: string;
};

export type ChangeProjectActionDueDateInput = ProjectActionExpectedState & {
	actionId: string;
	dueDate: string;
};

export type ReissueProjectActionInput = ProjectActionExpectedState & {
	actionId: string;
	brief?: string | null;
	dueDate?: string | null;
	actionerId?: string | null;
};

export const PROJECT_ACTION_OPERATION_ERROR_CODES = [
	'permission_denied',
	'invalid_transition',
	'ineligible_actioner',
	'stale_operation',
	'missing_response',
	'missing_reason',
	'missing_brief',
	'missing_due_date',
	'unsafe_evidence_url',
	'terminal_action',
	'cross_workspace_access',
	'invalid_source',
	'unknown',
] as const;
export type ProjectActionOperationErrorCode = (typeof PROJECT_ACTION_OPERATION_ERROR_CODES)[number];

export class ProjectActionOperationError extends Error {
	code: ProjectActionOperationErrorCode;
	originalError: unknown;

	constructor(code: ProjectActionOperationErrorCode, message: string, originalError?: unknown) {
		super(message);
		this.name = 'ProjectActionOperationError';
		this.code = code;
		this.originalError = originalError;
	}
}

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

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
	if (typeof error === 'string') return error;
	return 'Action operation failed.';
}

const ACTION_OPERATION_ERROR_MAP: Array<[RegExp, ProjectActionOperationErrorCode, string]> = [
	[/WT_ACTION_PERMISSION_DENIED/, 'permission_denied', 'You do not have permission to perform this Action operation.'],
	[/WT_ACTION_INVALID_TRANSITION/, 'invalid_transition', 'This Action is not in the right state for that operation.'],
	[/WT_ACTION_INELIGIBLE_ACTIONER/, 'ineligible_actioner', 'The selected Actioner must be an active Owner, Admin or Member in this workspace.'],
	[/WT_ACTION_STALE/, 'stale_operation', 'This Action has changed since it was loaded. Refresh and try again.'],
	[/WT_ACTION_MISSING_RESPONSE/, 'missing_response', 'Response is required.'],
	[/WT_ACTION_MISSING_REASON/, 'missing_reason', 'Reason is required.'],
	[/WT_ACTION_MISSING_BRIEF/, 'missing_brief', 'Action brief is required.'],
	[/WT_ACTION_MISSING_DUE_DATE/, 'missing_due_date', 'Action due date is required.'],
	[/WT_ACTION_UNSAFE_EVIDENCE_URL/, 'unsafe_evidence_url', 'Enter a safe evidence URL that starts with http:// or https://.'],
	[/WT_ACTION_TERMINAL/, 'terminal_action', 'Complete and cancelled Actions cannot be changed.'],
	[/WT_ACTION_SCOPE/, 'cross_workspace_access', 'Action not found or you do not have access.'],
	[/WT_ACTION_INVALID_SOURCE/, 'invalid_source', 'Select a valid Action source.'],
];

export function mapProjectActionOperationError(error: unknown): ProjectActionOperationError {
	if (error instanceof ProjectActionOperationError) return error;

	const message = errorMessage(error);
	const mapped = ACTION_OPERATION_ERROR_MAP.find(([pattern]) => pattern.test(message));
	if (mapped) return new ProjectActionOperationError(mapped[1], mapped[2], error);

	return new ProjectActionOperationError('unknown', message, error);
}

function actionRpcArgs(input: ProjectActionExpectedState & { actionId: string }): Record<string, unknown> {
	return {
		p_action_id: input.actionId,
		p_expected_status: input.expectedStatus,
		p_expected_updated_at: input.expectedUpdatedAt ?? null,
	};
}

async function callProjectActionRpc(client: ProjectActionRpcClient, functionName: string, args: Record<string, unknown>): Promise<ProjectAction> {
	const { data, error } = await client.rpc(functionName, args);
	if (error) throw mapProjectActionOperationError(error);
	return data as ProjectAction;
}

export async function createProjectAction(client: ProjectActionRpcClient, input: CreateProjectActionInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'create_project_action', {
		p_project_id: input.projectId,
		p_brief: input.brief,
		p_due_date: input.dueDate,
		p_actioner_id: input.actionerId ?? null,
		p_source_type: input.sourceType ?? 'project',
		p_source_record_id: input.sourceRecordId ?? null,
		p_source_ref: input.sourceRef ?? null,
		p_source_label: input.sourceLabel ?? null,
		p_source_context: input.sourceContext ?? {},
	});
}

export async function submitProjectAction(client: ProjectActionRpcClient, input: SubmitProjectActionInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'submit_project_action', {
		...actionRpcArgs(input),
		p_response: input.response,
		p_evidence_url: normaliseActionEvidenceUrl(input.evidenceUrl),
	});
}

export async function returnProjectActionToRaiser(client: ProjectActionRpcClient, input: ActionReasonInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'return_project_action_to_raiser', {
		...actionRpcArgs(input),
		p_reason: input.reason,
	});
}

export async function rejectProjectAction(client: ProjectActionRpcClient, input: ActionReasonInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'reject_project_action', {
		...actionRpcArgs(input),
		p_reason: input.reason,
	});
}

export async function returnProjectActionToActioner(client: ProjectActionRpcClient, input: ActionReasonInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'return_project_action_to_actioner', {
		...actionRpcArgs(input),
		p_reason: input.reason,
	});
}

export async function completeProjectAction(client: ProjectActionRpcClient, input: ActionExpectedInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'complete_project_action', actionRpcArgs(input));
}

export async function cancelProjectAction(client: ProjectActionRpcClient, input: ActionReasonInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'cancel_project_action', {
		...actionRpcArgs(input),
		p_reason: input.reason,
	});
}

export async function assignProjectAction(client: ProjectActionRpcClient, input: AssignProjectActionInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'assign_project_action', {
		...actionRpcArgs(input),
		p_actioner_id: input.actionerId,
	});
}

export async function amendProjectActionBrief(client: ProjectActionRpcClient, input: AmendProjectActionBriefInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'amend_project_action_brief', {
		...actionRpcArgs(input),
		p_brief: input.brief,
	});
}

export async function changeProjectActionDueDate(client: ProjectActionRpcClient, input: ChangeProjectActionDueDateInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'change_project_action_due_date', {
		...actionRpcArgs(input),
		p_due_date: input.dueDate,
	});
}

export async function reissueProjectAction(client: ProjectActionRpcClient, input: ReissueProjectActionInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'reissue_project_action', {
		...actionRpcArgs(input),
		p_brief: input.brief ?? null,
		p_due_date: input.dueDate ?? null,
		p_actioner_id: input.actionerId ?? null,
		p_change_actioner: Object.hasOwn(input, 'actionerId'),
	});
}

export async function takeOverProjectActionAcceptance(client: ProjectActionRpcClient, input: ActionReasonInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'take_over_project_action_acceptance', {
		...actionRpcArgs(input),
		p_reason: input.reason,
	});
}
