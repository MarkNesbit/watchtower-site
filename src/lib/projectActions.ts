import { assertCan, can, isWorkspaceRole, type WorkspaceRole } from './permissions.ts';
import { listWorkspacePeople, workspacePeopleByIdentity } from './workspacePeople.ts';

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
	'progress_updated',
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
	due_date: string | null;
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
	raiser?: ActionProfile | null;
	actioner?: ActionProfile | null;
	acceptance_owner?: ActionProfile | null;
};

export type ActionProfile = {
	id: string;
	display_name?: string | null;
	email?: string | null;
	role?: WorkspaceRole | string | null;
	membershipStatus?: string | null;
	isAssignable?: boolean;
};

export type ProjectActionHistory = {
	id: string;
	organisation_id: string;
	project_id: string;
	action_id: string;
	event_type: ActionHistoryEventType | string;
	actor_user_id: string | null;
	from_status: ActionStatus | string | null;
	to_status: ActionStatus | string | null;
	reason: string | null;
	response: string | null;
	evidence_url: string | null;
	old_values: Record<string, unknown> | null;
	new_values: Record<string, unknown> | null;
	created_at: string;
	actor?: ActionProfile | null;
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
	dueDate?: string | null;
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

export type SaveProjectActionProgressInput = ProjectActionExpectedState & {
	actionId: string;
	response: string;
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
	dueDate?: string | null;
};

export type ReissueProjectActionInput = ProjectActionExpectedState & {
	actionId: string;
	brief?: string | null;
	dueDate?: string | null;
	actionerId?: string | null;
};

export const ACTION_REGISTER_TABS = ['outstanding', 'awaiting_review', 'complete', 'cancelled'] as const;
export type ActionRegisterTab = (typeof ACTION_REGISTER_TABS)[number];

export const ACTION_REGISTER_SCOPES = ['my', 'project'] as const;
export type ActionRegisterScope = (typeof ACTION_REGISTER_SCOPES)[number];

export const ACTION_TIMING_STATES = [
	'open',
	'due_soon',
	'due_today',
	'missing_due_date',
	'overdue',
	'unassigned',
	'reassignment_required',
	'complete',
	'cancelled',
] as const;
export type ActionTimingState = (typeof ACTION_TIMING_STATES)[number];

export const ACTION_TIMING_FILTERS = ['all', ...ACTION_TIMING_STATES] as const;
export type ActionTimingFilter = (typeof ACTION_TIMING_FILTERS)[number];

export const ACTION_REGISTER_SORTS = [
	'highest_urgency',
	'due_date_earliest',
	'due_date_latest',
	'recently_updated',
	'oldest_updated',
	'action_ref',
	'actioner',
	'submitted_oldest',
	'completed_recent',
	'cancelled_recent',
] as const;
export type ActionRegisterSort = (typeof ACTION_REGISTER_SORTS)[number];

export const ACTION_REGISTER_PAGE_SIZES = [20] as const;
export type ActionRegisterPageSize = (typeof ACTION_REGISTER_PAGE_SIZES)[number];
export const DEFAULT_ACTION_REGISTER_PAGE_SIZE: ActionRegisterPageSize = 20;
export const ACTION_REGISTER_LOAD_INCREMENT = 20;

export type ActionRegisterFilters = {
	tab?: ActionRegisterTab | string | null;
	search?: string | null;
	timing?: ActionTimingFilter | string | null;
	status?: ActionStatus | string | null;
	actionerId?: string | null;
	raiserId?: string | null;
	sourceType?: ActionSourceType | string | null;
	sort?: ActionRegisterSort | string | null;
};

export type ActionPagination = {
	page: number;
	pageSize: ActionRegisterPageSize;
	totalItems: number;
	totalPages: number;
	startItem: number;
	endItem: number;
	hasPrevious: boolean;
	hasNext: boolean;
};

export type PaginatedActions = {
	items: ProjectAction[];
	pagination: ActionPagination;
};

export type ActionRegisterSummary = {
	openActions: number;
	needAction: number;
	highestUrgency: ActionTimingState | 'none';
};

export type ActionNeedsAttentionItem = {
	type: ActionTimingState | 'returned_to_raiser' | 'rejected_by_actioner' | 'awaiting_review';
	priority: number;
	label: string;
	reason: string;
	actionId: string;
	actionRef: string;
	brief: string;
	sourceLabel: string;
	timingState: ActionTimingState;
	status: ActionStatus;
	dueDate: string | null;
};

export type ActionDistributionSegment = {
	key: 'open' | 'awaiting_review' | 'complete' | 'cancelled';
	label: string;
	count: number;
	percentage: number;
	tone: 'neutral' | 'amber' | 'green' | 'grey';
};

export type ActionConcernTone = 'red' | 'amber' | 'green' | 'grey' | 'neutral';

export type ActionDueDateDisplay = {
	label: string;
	tone: ActionConcernTone;
};

export type ActionDistribution = {
	total: number;
	segments: ActionDistributionSegment[];
	summary: string;
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

export const ACTION_TIMING_DISPLAY_LABELS: Record<ActionTimingState, string> = {
	open: 'Open',
	due_soon: 'Due soon',
	due_today: 'Due today',
	missing_due_date: 'No due date',
	overdue: 'Overdue',
	unassigned: 'Unassigned',
	reassignment_required: 'Reassignment required',
	complete: 'Completed',
	cancelled: 'Cancelled',
};

export const ACTION_SOURCE_DISPLAY_LABELS: Record<ActionSourceType, string> = {
	project: 'Project',
	risk: 'Risk',
	project_details: 'Project Details',
	narrative: 'Narrative',
};

export const ACTION_REGISTER_TAB_LABELS: Record<ActionRegisterTab, string> = {
	outstanding: 'Outstanding',
	awaiting_review: 'Awaiting review',
	complete: 'Complete',
	cancelled: 'Cancelled',
};

export const ACTION_REGISTER_SCOPE_LABELS: Record<ActionRegisterScope, string> = {
	my: 'My actions',
	project: 'All project actions',
};

const ACTION_SELECT = [
	'id',
	'organisation_id',
	'project_id',
	'action_number',
	'action_ref',
	'brief',
	'status',
	'due_date',
	'raiser_id',
	'actioner_id',
	'acceptance_owner_id',
	'source_type',
	'source_record_id',
	'source_ref',
	'source_label',
	'source_context',
	'latest_response',
	'latest_evidence_url',
	'submitted_at',
	'completed_at',
	'cancelled_at',
	'created_by',
	'updated_by',
	'created_at',
	'updated_at',
].join(', ');

const ACTION_HISTORY_SELECT = [
	'id',
	'organisation_id',
	'project_id',
	'action_id',
	'event_type',
	'actor_user_id',
	'from_status',
	'to_status',
	'reason',
	'response',
	'evidence_url',
	'old_values',
	'new_values',
	'created_at',
].join(', ');

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

export function deriveActionWorkflowLabel(status: unknown): string {
	return actionDisplayLabel(status);
}

export function actionTimingDisplayLabel(state: unknown): string {
	return typeof state === 'string' && ACTION_TIMING_STATES.includes(state as ActionTimingState)
		? ACTION_TIMING_DISPLAY_LABELS[state as ActionTimingState]
		: 'Unknown';
}

export function actionSourceDisplayLabel(sourceType: unknown): string {
	return isActionSourceType(sourceType) ? ACTION_SOURCE_DISPLAY_LABELS[sourceType] : 'Source';
}

export function isTerminalActionStatus(status: unknown): boolean {
	return status === 'complete' || status === 'cancelled';
}

export function actionConcernTone(action: ProjectAction, now = new Date()): ActionConcernTone {
	const timingState = deriveActionTimingState(action, now);
	if (timingState === 'complete') return 'green';
	if (timingState === 'cancelled') return 'grey';
	if (timingState === 'overdue' || timingState === 'due_today') return 'red';
	if (
		timingState === 'missing_due_date'
		|| timingState === 'unassigned'
		|| timingState === 'reassignment_required'
		|| timingState === 'due_soon'
	) {
		return 'amber';
	}
	return 'neutral';
}

export function actionDueDateDisplay(action: ProjectAction, now = new Date()): ActionDueDateDisplay {
	const timingState = deriveActionTimingState(action, now);
	const dateLabel = action.due_date
		? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${action.due_date}T00:00:00Z`))
		: 'No due date';
	if (timingState === 'missing_due_date') return { label: 'No due date', tone: 'amber' };
	if (timingState === 'overdue') return { label: `Overdue: ${dateLabel}`, tone: 'red' };
	if (timingState === 'due_today') return { label: `Due today: ${dateLabel}`, tone: 'red' };
	if (timingState === 'due_soon') return { label: `Due soon: ${dateLabel}`, tone: 'amber' };
	if (timingState === 'complete') return { label: dateLabel, tone: 'green' };
	if (timingState === 'cancelled') return { label: dateLabel, tone: 'grey' };
	return { label: dateLabel, tone: actionConcernTone(action, now) };
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

export function actionProfileName(profile: ActionProfile | null | undefined, fallback = 'Unassigned'): string {
	const displayName = profile?.display_name?.trim();
	if (displayName) return displayName;
	return fallback;
}

export function isActionerCurrentlyAssignable(action: Pick<ProjectAction, 'actioner_id' | 'actioner'>): boolean {
	if (!action.actioner_id) return false;
	return action.actioner?.isAssignable === true;
}

function uniqueValues<T>(values: Array<T | null | undefined>): T[] {
	return [...new Set(values.filter((value): value is T => value !== null && value !== undefined))];
}

function daysUntilUtc(dateValue: string, now = new Date()): number {
	const due = new Date(`${dateValue}T00:00:00Z`);
	const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	return Math.floor((due.getTime() - today.getTime()) / 86_400_000);
}

export function deriveActionTimingState(action: ProjectAction, now = new Date()): ActionTimingState {
	if (action.status === 'complete') return 'complete';
	if (action.status === 'cancelled') return 'cancelled';
	if (!action.due_date) return 'missing_due_date';

	const daysUntilDue = daysUntilUtc(action.due_date, now);
	if (daysUntilDue < 0) return 'overdue';
	if (daysUntilDue === 0) return 'due_today';
	if (action.actioner_id && !isActionerCurrentlyAssignable(action)) return 'reassignment_required';
	if (!action.actioner_id) return 'unassigned';
	if (daysUntilDue <= 3) return 'due_soon';
	return 'open';
}

export function deriveProjectActionNeedsAttention(action: ProjectAction, now = new Date()): boolean {
	const timingState = deriveActionTimingState(action, now);
	return ['overdue', 'due_today', 'missing_due_date', 'reassignment_required', 'unassigned', 'due_soon'].includes(timingState)
		|| ['submitted', 'returned_to_raiser', 'rejected_by_actioner'].includes(action.status);
}

export function sourceLabelForAction(action: Pick<ProjectAction, 'source_type' | 'source_ref' | 'source_label'>): string {
	if (action.source_ref) return action.source_ref;
	if (action.source_label) return action.source_label;
	return actionSourceDisplayLabel(action.source_type);
}

export function briefPreview(brief: string, maxLength = 118): string {
	const value = brief.trim().replace(/\s+/g, ' ');
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

export function normaliseActionRegisterTab(value: unknown): ActionRegisterTab {
	return typeof value === 'string' && ACTION_REGISTER_TABS.includes(value as ActionRegisterTab)
		? value as ActionRegisterTab
		: 'outstanding';
}

export function defaultActionRegisterScope(actions: Pick<ProjectAction, 'actioner_id'>[], actorId: string | null | undefined): ActionRegisterScope {
	return actorId && actions.some((action) => action.actioner_id === actorId) ? 'my' : 'project';
}

export function normaliseActionRegisterScope(value: unknown, fallback: ActionRegisterScope = 'project'): ActionRegisterScope {
	return typeof value === 'string' && ACTION_REGISTER_SCOPES.includes(value as ActionRegisterScope)
		? value as ActionRegisterScope
		: fallback;
}

export function filterProjectActionsByScope(actions: ProjectAction[], scope: ActionRegisterScope | string | null | undefined, actorId: string | null | undefined): ProjectAction[] {
	const selectedScope = normaliseActionRegisterScope(scope, defaultActionRegisterScope(actions, actorId));
	if (selectedScope !== 'my') return actions;
	return actorId ? actions.filter((action) => action.actioner_id === actorId) : [];
}

export function normaliseActionTimingFilter(value: unknown): ActionTimingFilter {
	return typeof value === 'string' && ACTION_TIMING_FILTERS.includes(value as ActionTimingFilter)
		? value as ActionTimingFilter
		: 'all';
}

export function normaliseActionRegisterSort(value: unknown, tab: ActionRegisterTab = 'outstanding'): ActionRegisterSort {
	if (typeof value === 'string' && ACTION_REGISTER_SORTS.includes(value as ActionRegisterSort)) return value as ActionRegisterSort;
	return defaultActionRegisterSortForTab(tab);
}

export function defaultActionRegisterSortForTab(tab: ActionRegisterTab): ActionRegisterSort {
	if (tab === 'awaiting_review') return 'submitted_oldest';
	if (tab === 'complete') return 'completed_recent';
	if (tab === 'cancelled') return 'cancelled_recent';
	return 'highest_urgency';
}

export function parseActionRegisterVisibleCount(value: unknown): number {
	const count = Number(value);
	if (!Number.isInteger(count) || count < ACTION_REGISTER_LOAD_INCREMENT) return ACTION_REGISTER_LOAD_INCREMENT;
	return Math.ceil(count / ACTION_REGISTER_LOAD_INCREMENT) * ACTION_REGISTER_LOAD_INCREMENT;
}

export function parseActionRegisterPage(value: unknown): number {
	const page = Number(value);
	return Number.isInteger(page) && page > 0 ? page : 1;
}

export function parseActionRegisterPageSize(value: unknown): ActionRegisterPageSize {
	const pageSize = Number(value);
	return ACTION_REGISTER_PAGE_SIZES.includes(pageSize as ActionRegisterPageSize)
		? pageSize as ActionRegisterPageSize
		: DEFAULT_ACTION_REGISTER_PAGE_SIZE;
}

export function actionMatchesRegisterTab(action: ProjectAction, tab: ActionRegisterTab): boolean {
	if (tab === 'outstanding') return ['open', 'returned_to_raiser', 'rejected_by_actioner', 'returned_to_actioner'].includes(action.status);
	if (tab === 'awaiting_review') return action.status === 'submitted';
	if (tab === 'complete') return action.status === 'complete';
	if (tab === 'cancelled') return action.status === 'cancelled';
	return false;
}

function compareText(a: string, b: string): number {
	return a.localeCompare(b, 'en-GB', { sensitivity: 'base', numeric: true });
}

function compareNullableDate(a: string | null | undefined, b: string | null | undefined, direction: 'asc' | 'desc' = 'asc'): number {
	const aTime = a ? new Date(a).getTime() : 0;
	const bTime = b ? new Date(b).getTime() : 0;
	return direction === 'asc' ? aTime - bTime : bTime - aTime;
}

function outstandingSortBucket(action: ProjectAction, now = new Date()): number {
	if (!action.due_date) return 3;
	const timingState = deriveActionTimingState(action, now);
	if (timingState === 'overdue') return 0;
	if (timingState === 'due_today') return 1;
	return 2;
}

function compareOutstandingDefault(a: ProjectAction, b: ProjectAction, now = new Date()): number {
	const aBucket = outstandingSortBucket(a, now);
	const bBucket = outstandingSortBucket(b, now);
	if (aBucket !== bBucket) return aBucket - bBucket;
	if (aBucket === 3) return compareText(a.action_ref, b.action_ref);
	return compareNullableDate(a.due_date, b.due_date) || compareText(a.action_ref, b.action_ref);
}

export function filterProjectActions(actions: ProjectAction[], filters: ActionRegisterFilters, now = new Date()): ProjectAction[] {
	const tab = normaliseActionRegisterTab(filters.tab);
	const search = filters.search?.trim().toLowerCase() ?? '';
	const timing = normaliseActionTimingFilter(filters.timing);
	const status = isActionStatus(filters.status) ? filters.status : '';
	const sourceType = isActionSourceType(filters.sourceType) ? filters.sourceType : '';
	const actionerId = filters.actionerId?.trim() ?? '';
	const raiserId = filters.raiserId?.trim() ?? '';

	return actions.filter((action) => {
		if (!actionMatchesRegisterTab(action, tab)) return false;
		if (timing !== 'all' && deriveActionTimingState(action, now) !== timing) return false;
		if (status && action.status !== status) return false;
		if (sourceType && action.source_type !== sourceType) return false;
		if (actionerId === 'unassigned') {
			if (action.actioner_id) return false;
		} else if (actionerId && action.actioner_id !== actionerId) {
			return false;
		}
		if (raiserId && action.raiser_id !== raiserId) return false;
		if (!search) return true;
		const haystack = [
			action.action_ref,
			action.brief,
			actionProfileName(action.actioner, ''),
			actionProfileName(action.raiser, ''),
			action.source_ref ?? '',
			action.source_label ?? '',
			actionSourceDisplayLabel(action.source_type),
		].join(' ').toLowerCase();
		return haystack.includes(search);
	});
}

export function sortProjectActions(actions: ProjectAction[], sort: ActionRegisterSort | string | null | undefined, now = new Date()): ProjectAction[] {
	const selectedSort = typeof sort === 'string' && ACTION_REGISTER_SORTS.includes(sort as ActionRegisterSort)
		? sort as ActionRegisterSort
		: 'recently_updated';
	return [...actions].sort((a, b) => {
		if (selectedSort === 'highest_urgency') return compareOutstandingDefault(a, b, now);
		if (selectedSort === 'due_date_earliest') return compareNullableDate(a.due_date, b.due_date) || compareText(a.action_ref, b.action_ref);
		if (selectedSort === 'due_date_latest') return compareNullableDate(a.due_date, b.due_date, 'desc') || compareText(a.action_ref, b.action_ref);
		if (selectedSort === 'oldest_updated') return compareNullableDate(a.updated_at, b.updated_at) || compareText(a.action_ref, b.action_ref);
		if (selectedSort === 'action_ref') return compareText(a.action_ref, b.action_ref);
		if (selectedSort === 'actioner') return compareText(actionProfileName(a.actioner, 'Unassigned'), actionProfileName(b.actioner, 'Unassigned')) || compareText(a.action_ref, b.action_ref);
		if (selectedSort === 'submitted_oldest') return compareNullableDate(a.submitted_at ?? a.updated_at, b.submitted_at ?? b.updated_at) || compareText(a.action_ref, b.action_ref);
		if (selectedSort === 'completed_recent') return compareNullableDate(a.completed_at ?? a.updated_at, b.completed_at ?? b.updated_at, 'desc') || compareText(a.action_ref, b.action_ref);
		if (selectedSort === 'cancelled_recent') return compareNullableDate(a.cancelled_at ?? a.updated_at, b.cancelled_at ?? b.updated_at, 'desc') || compareText(a.action_ref, b.action_ref);
		return compareNullableDate(a.updated_at, b.updated_at, 'desc') || compareText(a.action_ref, b.action_ref);
	});
}

export function filterAndSortProjectActions(actions: ProjectAction[], filters: ActionRegisterFilters, now = new Date()): ProjectAction[] {
	return sortProjectActions(filterProjectActions(actions, filters, now), filters.sort, now);
}

export function paginateProjectActions(actions: ProjectAction[], page: number, pageSize: ActionRegisterPageSize = DEFAULT_ACTION_REGISTER_PAGE_SIZE): PaginatedActions {
	const totalItems = actions.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
	const safePage = Math.min(Math.max(1, page), totalPages);
	const startIndex = (safePage - 1) * pageSize;
	const endIndex = Math.min(startIndex + pageSize, totalItems);
	return {
		items: actions.slice(startIndex, endIndex),
		pagination: {
			page: safePage,
			pageSize,
			totalItems,
			totalPages,
			startItem: totalItems === 0 ? 0 : startIndex + 1,
			endItem: endIndex,
			hasPrevious: safePage > 1,
			hasNext: safePage < totalPages,
		},
	};
}

export function getActionRegisterPageNumbers(page: number, totalPages: number): number[] {
	const start = Math.max(1, page - 2);
	const end = Math.min(totalPages, start + 4);
	return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function summariseProjectActions(actions: ProjectAction[], now = new Date()): ActionRegisterSummary {
	const nonTerminal = actions.filter((action) => !isTerminalActionStatus(action.status));
	const needAction = actions.filter((action) => deriveProjectActionNeedsAttention(action, now)).length;
	const highest = nonTerminal
		.map((action) => deriveActionTimingState(action, now))
		.sort((a, b) => {
			const order: Record<ActionTimingState, number> = {
				overdue: 0,
				due_today: 1,
				reassignment_required: 2,
				missing_due_date: 3,
				unassigned: 4,
				due_soon: 5,
				open: 6,
				complete: 7,
				cancelled: 8,
			};
			return order[a] - order[b];
		})[0] ?? 'none';

	return {
		openActions: nonTerminal.length,
		needAction,
		highestUrgency: highest,
	};
}

export function getProjectActionNeedsAttentionItems(actions: ProjectAction[], limit = 4, now = new Date()): ActionNeedsAttentionItem[] {
	const items = actions
		.filter((action) => deriveProjectActionNeedsAttention(action, now))
		.map((action): ActionNeedsAttentionItem => {
			const timingState = deriveActionTimingState(action, now);
			let type: ActionNeedsAttentionItem['type'] = timingState;
			let label = actionTimingDisplayLabel(timingState);
			let reason = label;
			if (action.status === 'rejected_by_actioner') {
				type = 'rejected_by_actioner';
				label = 'Rejected';
				reason = 'Actioner rejected this Action';
			} else if (action.status === 'returned_to_raiser') {
				type = 'returned_to_raiser';
				label = 'Returned to raiser';
				reason = 'Raiser clarification is needed';
			} else if (action.status === 'submitted') {
				type = 'awaiting_review';
				label = 'Awaiting review';
				reason = 'Acceptance owner review is needed';
			} else if (timingState === 'unassigned') {
				reason = 'No Actioner assigned';
			} else if (timingState === 'reassignment_required') {
				reason = 'Assigned Actioner is no longer eligible';
			} else if (timingState === 'missing_due_date') {
				reason = 'No due date set';
			}
			const priority: Record<ActionNeedsAttentionItem['type'], number> = {
				overdue: 0,
				due_today: 1,
				reassignment_required: 2,
				rejected_by_actioner: 3,
				returned_to_raiser: 4,
				unassigned: 5,
				awaiting_review: 6,
				due_soon: 7,
				missing_due_date: 8,
				open: 8,
				complete: 20,
				cancelled: 21,
			};
			return {
				type,
				priority: priority[type],
				label,
				reason,
				actionId: action.id,
				actionRef: action.action_ref,
				brief: action.brief,
				sourceLabel: sourceLabelForAction(action),
				timingState,
				status: action.status,
				dueDate: action.due_date,
			};
		})
		.sort((a, b) => a.priority - b.priority || compareNullableDate(a.dueDate, b.dueDate) || compareText(a.actionRef, b.actionRef));
	return items.slice(0, Math.max(0, limit));
}

export function deriveActionDistribution(actions: ProjectAction[]): ActionDistribution {
	const open = actions.filter((action) => action.status !== 'submitted' && !isTerminalActionStatus(action.status)).length;
	const awaitingReview = actions.filter((action) => action.status === 'submitted').length;
	const complete = actions.filter((action) => action.status === 'complete').length;
	const cancelled = actions.filter((action) => action.status === 'cancelled').length;
	const total = actions.length;
	const segments: ActionDistributionSegment[] = [
		{ key: 'open', label: 'Open', count: open, percentage: total ? Math.round((open / total) * 100) : 0, tone: 'neutral' },
		{ key: 'awaiting_review', label: 'Awaiting review', count: awaitingReview, percentage: total ? Math.round((awaitingReview / total) * 100) : 0, tone: 'amber' },
		{ key: 'complete', label: 'Complete', count: complete, percentage: total ? Math.round((complete / total) * 100) : 0, tone: 'green' },
		{ key: 'cancelled', label: 'Cancelled', count: cancelled, percentage: total ? Math.round((cancelled / total) * 100) : 0, tone: 'grey' },
	];
	return {
		total,
		segments,
		summary: total === 0
			? 'No Actions to chart.'
			: `${open} open, ${awaitingReview} awaiting review, ${complete} complete and ${cancelled} cancelled Actions.`,
	};
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
		p_due_date: input.dueDate?.trim() || null,
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

export async function saveProjectActionProgress(client: ProjectActionRpcClient, input: SaveProjectActionProgressInput): Promise<ProjectAction> {
	return callProjectActionRpc(client, 'save_project_action_progress', {
		...actionRpcArgs(input),
		p_response: input.response,
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
		p_due_date: input.dueDate?.trim() || null,
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

async function loadActionProfiles(organisationId: string, profileIds: string[], client): Promise<Map<string, ActionProfile>> {
	const uniqueProfileIds = uniqueValues(profileIds);
	const profilesById = new Map<string, ActionProfile>();
	if (uniqueProfileIds.length === 0) return profilesById;

	try {
		const peopleByIdentity = workspacePeopleByIdentity(await listWorkspacePeople(organisationId, client));
		for (const requestedId of uniqueProfileIds) {
			const person = peopleByIdentity.get(requestedId);
			if (!person) continue;
			profilesById.set(requestedId, {
				id: person.profileId,
				display_name: person.displayName,
				role: person.workspaceRole,
				membershipStatus: person.membershipStatus,
				isAssignable: person.assignmentEligible && canHoldActionWorkflowRole(person.workspaceRole),
			});
		}
	} catch {
		for (const profileId of uniqueProfileIds) profilesById.set(profileId, { id: profileId, isAssignable: false });
	}

	return profilesById;
}

async function enrichActionProfiles(actions: ProjectAction[], organisationId: string, client): Promise<ProjectAction[]> {
	const profileIds = uniqueValues(actions.flatMap((action) => [
		action.raiser_id,
		action.actioner_id,
		action.acceptance_owner_id,
		action.created_by,
		action.updated_by,
	]));
	const profiles = await loadActionProfiles(organisationId, profileIds, client);
	return actions.map((action) => ({
		...action,
		raiser: profiles.get(action.raiser_id) ?? { id: action.raiser_id },
		actioner: action.actioner_id ? profiles.get(action.actioner_id) ?? { id: action.actioner_id } : null,
		acceptance_owner: profiles.get(action.acceptance_owner_id) ?? { id: action.acceptance_owner_id },
	}));
}

async function enrichActionHistoryProfiles(history: ProjectActionHistory[], organisationId: string, client): Promise<ProjectActionHistory[]> {
	const profileIds = uniqueValues(history.map((event) => event.actor_user_id));
	const profiles = await loadActionProfiles(organisationId, profileIds, client);
	return history.map((event) => ({
		...event,
		actor: event.actor_user_id ? profiles.get(event.actor_user_id) ?? { id: event.actor_user_id } : null,
	}));
}

export async function listProjectActions(
	organisationId: string,
	projectId: string,
	workspaceRole: WorkspaceRole,
	client,
): Promise<ProjectAction[]> {
	assertCan(workspaceRole, 'action.view', 'Your workspace role does not permit Actions access.');

	const { data, error } = await client
		.from('project_actions')
		.select(ACTION_SELECT)
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.order('updated_at', { ascending: false })
		.order('action_number', { ascending: true });

	if (error) throw error;
	return enrichActionProfiles((data ?? []) as ProjectAction[], organisationId, client);
}

export async function getProjectAction(
	organisationId: string,
	projectId: string,
	actionId: string,
	workspaceRole: WorkspaceRole,
	client,
): Promise<ProjectAction | null> {
	assertCan(workspaceRole, 'action.view', 'Your workspace role does not permit Actions access.');

	const { data, error } = await client
		.from('project_actions')
		.select(ACTION_SELECT)
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.eq('id', actionId)
		.maybeSingle();

	if (error) throw error;
	const [action] = await enrichActionProfiles(data ? [data as ProjectAction] : [], organisationId, client);
	return action ?? null;
}

export async function listProjectActionHistory(
	organisationId: string,
	projectId: string,
	actionId: string,
	workspaceRole: WorkspaceRole,
	client,
): Promise<ProjectActionHistory[]> {
	assertCan(workspaceRole, 'action.view', 'Your workspace role does not permit Actions access.');

	const { data, error } = await client
		.from('project_action_history')
		.select(ACTION_HISTORY_SELECT)
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.eq('action_id', actionId)
		.order('created_at', { ascending: false });

	if (error) throw error;
	return enrichActionHistoryProfiles((data ?? []) as ProjectActionHistory[], organisationId, client);
}

export async function listEligibleActioners(
	organisationId: string,
	workspaceRole: WorkspaceRole,
	client,
): Promise<ActionProfile[]> {
	assertCan(workspaceRole, 'action.view', 'Your workspace role does not permit Actions access.');

	const people = await listWorkspacePeople(organisationId, client, { eligibleOnly: true });
	return people
		.filter((person) => canHoldActionWorkflowRole(person.workspaceRole))
		.map((person) => ({
			id: person.profileId,
			display_name: person.displayName,
			email: null,
			role: person.workspaceRole,
			membershipStatus: person.membershipStatus,
			isAssignable: true,
		}));
}

export function canManageProjectAction(action: ProjectAction, userId: string | null | undefined, workspaceRole: WorkspaceRole | string | null | undefined): boolean {
	return Boolean(userId)
		&& can(workspaceRole, 'action.manage')
		&& !isTerminalActionStatus(action.status)
		&& action.acceptance_owner_id === userId;
}

export function canTakeOverProjectAction(action: ProjectAction, userId: string | null | undefined, workspaceRole: WorkspaceRole | string | null | undefined): boolean {
	return Boolean(userId)
		&& can(workspaceRole, 'action.takeover')
		&& !isTerminalActionStatus(action.status)
		&& action.acceptance_owner_id !== userId;
}
