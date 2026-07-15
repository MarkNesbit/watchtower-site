import { assertCan, can, type WorkspaceRole } from './permissions.ts';
import { getWorkspaceBySlug } from './projects.ts';

export const PROJECT_DATE_TYPES = [
	'project-start',
	'target-end',
	'review',
	'gateway',
	'milestone',
	'uat',
	'testing',
	'load-testing',
	'integration',
	'deployment',
	'cutover',
	'training',
	'go-live',
	'hypercare',
	'other',
] as const;
export type ProjectDateType = (typeof PROJECT_DATE_TYPES)[number];
export type ProjectDateCategory = ProjectDateType;
export const DEFAULT_PROJECT_DATE_TYPES: ProjectDateType[] = ['project-start', 'target-end', 'review'];
export const PROJECT_DATE_WARNING_DAYS = 14;
export const PROJECT_DATE_TYPE_WARNING_DAYS: Record<ProjectDateType, number> = {
	'project-start': 0,
	'target-end': 14,
	review: 2,
	gateway: 14,
	milestone: 14,
	uat: 7,
	testing: 7,
	'load-testing': 7,
	integration: 7,
	deployment: 7,
	cutover: 7,
	training: 7,
	'go-live': 7,
	hypercare: 7,
	other: 14,
};
export const PROJECT_DATE_EDIT_ASSIGNMENT_ROLES = ['project_manager', 'delivery_lead', 'product_owner'] as const;
export const PROJECT_DATE_STATUSES = ['scheduled', 'upcoming', 'started', 'complete', 'delayed', 'at-risk', 'cancelled'] as const;
export type ProjectDateLifecycleStatus = (typeof PROJECT_DATE_STATUSES)[number];

export type ProjectDateStatusTone = 'green' | 'amber' | 'red';

export type ProjectDateRecord = {
	id: string;
	organisation_id: string;
	project_id: string;
	date_type: ProjectDateType | string;
	custom_label?: string | null;
	title?: string | null;
	start_date?: string | null;
	target_date?: string | null;
	end_date?: string | null;
	description?: string | null;
	status?: ProjectDateLifecycleStatus | string | null;
	show_on_timeline?: boolean | null;
	warning_days: number;
	is_key_date: boolean;
	created_by?: string | null;
	updated_by?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	removed_at?: string | null;
	comments?: ProjectDateComment[];
};

export type ProjectDateComment = {
	id: string;
	organisation_id: string;
	project_id: string;
	project_date_id: string;
	comment: string;
	created_by?: string | null;
	created_at: string;
	updated_at?: string | null;
	removed_at?: string | null;
	author?: { id: string; display_name?: string | null; email?: string | null } | null;
};

export type ProjectDateCard = {
	id?: string | null;
	dateType: ProjectDateType;
	customLabel?: string | null;
	label: string;
	title: string;
	startDate?: string | null;
	targetDate?: string | null;
	endDate?: string | null;
	description?: string | null;
	lifecycleStatus: ProjectDateLifecycleStatus;
	showOnTimeline: boolean;
	warningDays: number;
	isDefault: boolean;
	isKeyDate: boolean;
	status: ReturnType<typeof deriveProjectDateStatus>;
	comments: ProjectDateComment[];
	commentCount: number;
};

const DATE_SELECT = [
	'id',
	'organisation_id',
	'project_id',
	'date_type',
	'custom_label',
	'title',
	'start_date',
	'target_date',
	'end_date',
	'description',
	'status',
	'show_on_timeline',
	'warning_days',
	'is_key_date',
	'created_by',
	'updated_by',
	'created_at',
	'updated_at',
	'removed_at',
].join(', ');

const COMMENT_SELECT = [
	'id',
	'organisation_id',
	'project_id',
	'project_date_id',
	'comment',
	'created_by',
	'created_at',
	'updated_at',
	'removed_at',
].join(', ');

function uniqueValues(values: Array<string | null | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function cleanOptionalDate(value: unknown, fieldLabel = 'date'): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Enter a valid ${fieldLabel}.`);
	const date = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Enter a valid ${fieldLabel}.`);
	return value;
}

function cleanRequiredDate(value: unknown, fieldLabel = 'date'): string {
	const date = cleanOptionalDate(value, fieldLabel);
	if (!date) throw new Error(`${fieldLabel.charAt(0).toUpperCase()}${fieldLabel.slice(1)} is required.`);
	return date;
}

function cleanOptionalText(value: unknown, fieldLabel: string, maxLength: number): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	if (!text) return null;
	if (text.length > maxLength) throw new Error(`${fieldLabel} must be ${maxLength} characters or fewer.`);
	return text;
}

export function isProjectDateType(value: unknown): value is ProjectDateType {
	return typeof value === 'string' && PROJECT_DATE_TYPES.includes(value as ProjectDateType);
}

export function isProjectDateStatus(value: unknown): value is ProjectDateLifecycleStatus {
	return typeof value === 'string' && PROJECT_DATE_STATUSES.includes(value as ProjectDateLifecycleStatus);
}

export function normaliseProjectDateType(value: unknown): ProjectDateType | null {
	if (isProjectDateType(value)) return value;
	if (value === 'start_date') return 'project-start';
	if (value === 'target_end_date') return 'target-end';
	if (value === 'review_date') return 'review';
	if (value === 'stage_gate') return 'gateway';
	if (value === 'load_test') return 'load-testing';
	return null;
}

export function projectDateWarningDays(dateType: unknown): number {
	const category = normaliseProjectDateType(dateType);
	return category ? PROJECT_DATE_TYPE_WARNING_DAYS[category] : PROJECT_DATE_WARNING_DAYS;
}

export function projectDateTypeLabel(value: unknown, customLabel?: string | null): string {
	if (value === 'other' && customLabel?.trim()) return customLabel.trim();
	if (value === 'project-start' || value === 'start_date') return 'Project start';
	if (value === 'target-end' || value === 'target_end_date') return 'Target end';
	if (value === 'review' || value === 'review_date') return 'Review';
	if (value === 'gateway' || value === 'stage_gate') return 'Gateway';
	if (value === 'milestone') return 'Milestone';
	if (value === 'uat') return 'UAT';
	if (value === 'testing') return 'Testing';
	if (value === 'load-testing' || value === 'load_test') return 'Load testing';
	if (value === 'integration') return 'Integration';
	if (value === 'deployment') return 'Deployment';
	if (value === 'cutover') return 'Cutover';
	if (value === 'training') return 'Training';
	if (value === 'go-live') return 'Go-live';
	if (value === 'hypercare') return 'Hypercare';
	if (value === 'other') return 'Other';
	return 'Project date';
}

export function projectDateStatusLabel(value: unknown): string {
	if (value === 'at-risk') return 'At risk';
	if (value === 'go-live') return 'Go-live';
	if (isProjectDateStatus(value)) return value.charAt(0).toUpperCase() + value.slice(1);
	return 'Scheduled';
}

export function deriveProjectDateStatus(
	targetDate?: string | null,
	warningDays = PROJECT_DATE_WARNING_DAYS,
	now = new Date(),
	dateType: ProjectDateType | string = 'other',
) {
	if (!targetDate) {
		return { tone: 'amber' as const, label: 'Amber', text: 'Amber - date not set' };
	}

	const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const target = Date.parse(`${targetDate}T00:00:00Z`);
	if (Number.isNaN(target)) {
		return { tone: 'amber' as const, label: 'Amber', text: 'Amber - date not set' };
	}

	const daysUntil = Math.floor((target - today) / 86400000);
	const category = normaliseProjectDateType(dateType) ?? 'other';
	if (category === 'project-start') {
		if (daysUntil < 0) return { tone: 'green' as const, label: 'Green', text: 'Green - started' };
		if (daysUntil === 0) return { tone: 'green' as const, label: 'Green', text: 'Green - starting today' };
		if (daysUntil <= warningDays) return { tone: 'amber' as const, label: 'Amber', text: 'Amber - start approaching' };
		return { tone: 'green' as const, label: 'Green', text: 'Green - scheduled' };
	}
	if (daysUntil < 0) {
		const overdueText = category === 'review' ? 'Red - review overdue' : 'Red - overdue';
		return { tone: 'red' as const, label: 'Red', text: overdueText };
	}
	if (daysUntil <= warningDays) return { tone: 'amber' as const, label: 'Amber', text: `Amber - within ${warningDays} days` };
	return { tone: 'green' as const, label: 'Green', text: 'Green - scheduled' };
}

function legacyProjectDateForType(
	dateType: ProjectDateType,
	legacyProject?: { start_date?: string | null; target_end_date?: string | null; next_review_date?: string | null } | null,
): string | null {
	if (dateType === 'project-start') return legacyProject?.start_date ?? null;
	if (dateType === 'target-end') return legacyProject?.target_end_date ?? null;
	if (dateType === 'review') return legacyProject?.next_review_date ?? null;
	return null;
}

function projectDateStartDate(record?: Pick<ProjectDateRecord, 'start_date' | 'target_date'> | null): string | null {
	return record?.start_date ?? record?.target_date ?? null;
}

function projectDateTitle(record: Pick<ProjectDateRecord, 'title' | 'date_type' | 'custom_label'> | undefined, dateType: ProjectDateType): string {
	return record?.title?.trim() || projectDateTypeLabel(dateType, record?.custom_label);
}

function defaultProjectDateRecord(
	activeRecords: ProjectDateRecord[],
	dateType: ProjectDateType,
	legacyDate: string | null,
): ProjectDateRecord | undefined {
	const candidates = activeRecords.filter((date) => normaliseProjectDateType(date.date_type) === dateType);
	if (legacyDate) {
		return candidates.find((date) => projectDateStartDate(date) === legacyDate)
			?? candidates.find((date) => !projectDateStartDate(date))
			?? candidates[0];
	}
	return candidates.find((date) => Boolean(projectDateStartDate(date))) ?? candidates[0];
}

export function buildProjectDateCards(
	projectDates: ProjectDateRecord[],
	legacyProject?: { start_date?: string | null; target_end_date?: string | null; next_review_date?: string | null } | null,
	now = new Date(),
): ProjectDateCard[] {
	const activeRecords = projectDates.filter((date) => !date.removed_at);
	const firstByDefaultType = new Map<ProjectDateType, ProjectDateRecord>();
	for (const dateType of DEFAULT_PROJECT_DATE_TYPES) {
		const legacyDate = legacyProjectDateForType(dateType, legacyProject);
		const record = defaultProjectDateRecord(activeRecords, dateType, legacyDate);
		if (record) firstByDefaultType.set(dateType, record);
	}

	const defaultCards = DEFAULT_PROJECT_DATE_TYPES.map((dateType) => {
		const record = firstByDefaultType.get(dateType);
		const legacyDate = legacyProjectDateForType(dateType, legacyProject);
		const startDate = legacyDate ?? projectDateStartDate(record) ?? null;
		const warningDays = projectDateWarningDays(dateType);
		const comments = record?.comments ?? [];
		const title = projectDateTitle(record, dateType);
		return {
			id: record?.id ?? null,
			dateType,
			customLabel: null,
			label: projectDateTypeLabel(dateType),
			title,
			startDate,
			targetDate: startDate,
			endDate: record?.end_date ?? null,
			description: record?.description ?? null,
			lifecycleStatus: isProjectDateStatus(record?.status) ? record.status : 'scheduled',
			showOnTimeline: record?.show_on_timeline ?? true,
			warningDays,
			isDefault: true,
			isKeyDate: record?.is_key_date ?? true,
			status: deriveProjectDateStatus(startDate, warningDays, now, dateType),
			comments,
			commentCount: comments.length,
		};
	});

	const usedDefaultIds = new Set([...firstByDefaultType.values()].map((date) => date.id));
	const additionalCards = activeRecords
		.filter((date) => normaliseProjectDateType(date.date_type) && !usedDefaultIds.has(date.id))
		.map((date) => {
			const dateType = normaliseProjectDateType(date.date_type) ?? 'other';
			const comments = date.comments ?? [];
			const startDate = projectDateStartDate(date);
			const title = projectDateTitle(date, dateType);
			return {
				id: date.id,
				dateType,
				customLabel: date.custom_label ?? null,
				label: title,
				title,
				startDate,
				targetDate: startDate,
				endDate: date.end_date ?? null,
				description: date.description ?? null,
				lifecycleStatus: isProjectDateStatus(date.status) ? date.status : 'scheduled',
				showOnTimeline: date.show_on_timeline ?? true,
				warningDays: projectDateWarningDays(dateType),
				isDefault: false,
				isKeyDate: date.is_key_date,
				status: deriveProjectDateStatus(startDate, projectDateWarningDays(dateType), now, dateType),
				comments,
				commentCount: comments.length,
			};
		});

	return [...defaultCards, ...additionalCards];
}

async function enrichCommentAuthors(comments: ProjectDateComment[], client): Promise<ProjectDateComment[]> {
	if (comments.length === 0) return comments;
	const profileIds = uniqueValues(comments.map((comment) => comment.created_by));
	const profilesById = new Map<string, { id: string; display_name?: string | null; email?: string | null }>();

	if (profileIds.length > 0) {
		try {
			const { data: profiles } = await client
				.from('profiles')
				.select('id, display_name, email')
				.in('id', profileIds);
			for (const profile of profiles ?? []) profilesById.set(profile.id, profile);
		} catch {
			// Comment author labels are optional enrichment.
		}
	}

	return comments.map((comment) => ({
		...comment,
		author: comment.created_by ? profilesById.get(comment.created_by) ?? null : null,
	}));
}

export async function listProjectDates(
	organisationId: string,
	projectId: string,
	workspaceRole: WorkspaceRole,
	client,
): Promise<ProjectDateRecord[]> {
	assertCan(workspaceRole, 'project.view', 'Your workspace role does not permit project access.');

	const { data, error } = await client
		.from('project_dates')
		.select(DATE_SELECT)
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.is('removed_at', null)
		.order('target_date', { ascending: true, nullsFirst: false })
		.order('created_at', { ascending: true });

	if (error) throw error;
	const dates = (data ?? []) as ProjectDateRecord[];
	if (dates.length === 0) return dates;

	const { data: commentsData, error: commentsError } = await client
		.from('project_date_comments')
		.select(COMMENT_SELECT)
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.in('project_date_id', dates.map((date) => date.id))
		.is('removed_at', null)
		.order('created_at', { ascending: false });

	if (commentsError) throw commentsError;
	const comments = await enrichCommentAuthors((commentsData ?? []) as ProjectDateComment[], client);
	const commentsByDate = new Map<string, ProjectDateComment[]>();
	for (const comment of comments) {
		const bucket = commentsByDate.get(comment.project_date_id) ?? [];
		bucket.push(comment);
		commentsByDate.set(comment.project_date_id, bucket);
	}

	return dates.map((date) => ({ ...date, comments: commentsByDate.get(date.id) ?? [] }));
}

async function resolveScopedProject(workspaceSlug: string, projectSlug: string, client, accessToken?: string) {
	const workspace = await getWorkspaceBySlug(client, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation) throw new Error('Project not found or you do not have access.');
	assertCan(workspace.role, 'project.view', 'Your workspace role does not permit project access.');

	const { data: project, error } = await client
		.from('projects')
		.select('id, organisation_id, slug')
		.eq('slug', projectSlug)
		.eq('organisation_id', organisation.id)
		.is('deleted_at', null)
		.is('archived_at', null)
		.maybeSingle();

	if (error) throw error;
	if (!project) throw new Error('Project not found or you do not have access.');
	return { workspace, organisation, project };
}

async function getAuthenticatedUserId(client, accessToken?: string): Promise<string | null> {
	const { data, error } = accessToken
		? await client.auth.getUser(accessToken)
		: await client.auth.getUser();
	if (error) throw error;
	return data.user?.id ?? null;
}

async function hasActiveProjectPersonAssignment(
	organisationId: string,
	projectId: string,
	client,
	userId?: string | null,
	demoPersonId?: string | null,
	projectRoles?: readonly string[],
): Promise<boolean> {
	if (!userId && !demoPersonId) return false;
	let query = client
		.from('project_people')
		.select('id')
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.eq('status', 'active')
		.limit(1);

	if (projectRoles?.length) query = query.in('project_role', [...projectRoles]);
	if (demoPersonId) query = query.eq('demo_person_id', demoPersonId);
	else query = query.eq('user_id', userId);

	const { data, error } = await query.maybeSingle();
	if (error) throw error;
	return Boolean(data);
}

export async function canChangeProjectDates(
	workspace: { role?: WorkspaceRole | string | null; activeRoleSimulation?: { demo_person_id?: string | null } | null },
	organisationId: string,
	projectId: string,
	client,
	accessToken?: string,
): Promise<boolean> {
	if (workspace.role === 'owner' || workspace.role === 'admin') return true;
	if (!can(workspace.role, 'project.editDetails')) return false;
	const userId = await getAuthenticatedUserId(client, accessToken);
	const demoPersonId = workspace.activeRoleSimulation?.demo_person_id ?? null;
	return hasActiveProjectPersonAssignment(
		organisationId,
		projectId,
		client,
		userId,
		demoPersonId,
		PROJECT_DATE_EDIT_ASSIGNMENT_ROLES,
	);
}

export async function canCommentOnProjectDates(
	workspace: { role?: WorkspaceRole | string | null; activeRoleSimulation?: { demo_person_id?: string | null } | null },
	organisationId: string,
	projectId: string,
	client,
	accessToken?: string,
): Promise<boolean> {
	if (!can(workspace.role, 'project.view')) return false;
	if (await canChangeProjectDates(workspace, organisationId, projectId, client, accessToken)) return true;
	const userId = await getAuthenticatedUserId(client, accessToken);
	const demoPersonId = workspace.activeRoleSimulation?.demo_person_id ?? null;
	return hasActiveProjectPersonAssignment(organisationId, projectId, client, userId, demoPersonId);
}

function cleanBoolean(value: unknown, defaultValue = true): boolean {
	if (value === null || value === undefined || value === '') return defaultValue;
	if (value === true || value === 'true' || value === 'on' || value === '1') return true;
	if (value === false || value === 'false' || value === '0') return false;
	return defaultValue;
}

function cleanProjectDatePayload(input: {
	dateType?: string | null;
	customLabel?: string | null;
	title?: string | null;
	startDate?: string | null;
	targetDate?: string | null;
	endDate?: string | null;
	description?: string | null;
	status?: string | null;
	showOnTimeline?: unknown;
}) {
	const dateType = normaliseProjectDateType(input.dateType);
	if (!dateType) throw new Error('Select a valid project date category.');
	const customLabel = dateType === 'other'
		? cleanOptionalText(input.customLabel, 'Custom category label', 120)
		: null;
	const fallbackTitle = projectDateTypeLabel(dateType, customLabel);
	const title = cleanOptionalText(input.title, 'Title', 160) ?? fallbackTitle;
	if (!title) throw new Error('Title is required.');
	const startDate = cleanRequiredDate(input.startDate ?? input.targetDate, 'start date');
	const endDate = cleanOptionalDate(input.endDate, 'end date');
	if (endDate && endDate < startDate) throw new Error('End date cannot be before start date.');
	const status = isProjectDateStatus(input.status) ? input.status : 'scheduled';
	return {
		dateType,
		customLabel,
		title,
		startDate,
		targetDate: startDate,
		endDate,
		description: cleanOptionalText(input.description, 'Description', 500),
		status,
		showOnTimeline: cleanBoolean(input.showOnTimeline, true),
	};
}

async function getScopedProjectDate(organisationId: string, projectId: string, projectDateId: string, client): Promise<ProjectDateRecord> {
	const { data, error } = await client
		.from('project_dates')
		.select(DATE_SELECT)
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.eq('id', projectDateId)
		.is('removed_at', null)
		.maybeSingle();
	if (error) throw error;
	if (!data) throw new Error('Project date not found or you do not have access.');
	return data as ProjectDateRecord;
}

async function mirrorLegacyProjectDate(projectSlug: string, organisationId: string, dateType: string | null | undefined, targetDate: string | null, client) {
	const category = normaliseProjectDateType(dateType);
	const column = category === 'project-start'
		? 'start_date'
		: category === 'target-end'
			? 'target_end_date'
			: category === 'review'
				? 'next_review_date'
				: null;
	if (!column) return;
	const { error } = await client
		.from('projects')
		.update({ [column]: targetDate })
		.eq('slug', projectSlug)
		.eq('organisation_id', organisationId)
		.is('deleted_at', null)
		.is('archived_at', null);
	if (error) throw error;
}

export async function saveProjectDate(
	workspaceSlug: string,
	projectSlug: string,
	input: {
		projectDateId?: string | null;
		dateType?: string | null;
		customLabel?: string | null;
		title?: string | null;
		startDate?: string | null;
		targetDate?: string | null;
		endDate?: string | null;
		description?: string | null;
		status?: string | null;
		showOnTimeline?: unknown;
		comment?: string | null;
		remove?: boolean;
	},
	client,
	accessToken?: string,
): Promise<ProjectDateRecord | null> {
	const { workspace, organisation, project } = await resolveScopedProject(workspaceSlug, projectSlug, client, accessToken);
	if (!await canChangeProjectDates(workspace, organisation.id, project.id, client, accessToken)) {
		throw new Error('Your project role does not permit project date changes.');
	}

	if (input.remove) {
		if (!input.projectDateId) throw new Error('Select a project date to remove.');
		const existing = await getScopedProjectDate(organisation.id, project.id, input.projectDateId, client);
		const { error } = await client
			.from('project_dates')
			.update({ removed_at: new Date().toISOString() })
			.eq('organisation_id', organisation.id)
			.eq('project_id', project.id)
			.eq('id', input.projectDateId)
			.is('removed_at', null);
		if (error) throw error;
		await mirrorLegacyProjectDate(projectSlug, organisation.id, existing.date_type, null, client);
		return null;
	}

	const cleaned = cleanProjectDatePayload(input);
	const comment = cleanOptionalText(input.comment, 'Comment', 1000);
	let savedDate: ProjectDateRecord;
	let previousDateType: string | null = null;

	if (input.projectDateId) {
		const existing = await getScopedProjectDate(organisation.id, project.id, input.projectDateId, client);
		previousDateType = existing.date_type;
		const { data, error } = await client
			.from('project_dates')
			.update({
				date_type: cleaned.dateType,
				custom_label: cleaned.customLabel,
				title: cleaned.title,
				start_date: cleaned.startDate,
				target_date: cleaned.targetDate,
				end_date: cleaned.endDate,
				description: cleaned.description,
				status: cleaned.status,
				show_on_timeline: cleaned.showOnTimeline,
				warning_days: projectDateWarningDays(cleaned.dateType),
				is_key_date: existing.is_key_date ?? true,
			})
			.eq('organisation_id', organisation.id)
			.eq('project_id', project.id)
			.eq('id', input.projectDateId)
			.is('removed_at', null)
			.select(DATE_SELECT)
			.single();
		if (error) throw error;
		savedDate = data as ProjectDateRecord;
	} else {
		const { data, error } = await client
			.from('project_dates')
			.insert({
				organisation_id: organisation.id,
				project_id: project.id,
				date_type: cleaned.dateType,
				custom_label: cleaned.customLabel,
				title: cleaned.title,
				start_date: cleaned.startDate,
				target_date: cleaned.targetDate,
				end_date: cleaned.endDate,
				description: cleaned.description,
				status: cleaned.status,
				show_on_timeline: cleaned.showOnTimeline,
				warning_days: projectDateWarningDays(cleaned.dateType),
				is_key_date: true,
			})
			.select(DATE_SELECT)
			.single();
		if (error) throw error;
		savedDate = data as ProjectDateRecord;
	}

	if (previousDateType && previousDateType !== savedDate.date_type) {
		await mirrorLegacyProjectDate(projectSlug, organisation.id, previousDateType, null, client);
	}
	await mirrorLegacyProjectDate(projectSlug, organisation.id, savedDate.date_type, projectDateStartDate(savedDate), client);

	if (comment) {
		await createProjectDateComment(workspaceSlug, projectSlug, savedDate.id, comment, client, accessToken);
	}

	return savedDate;
}

export async function createProjectDateComment(
	workspaceSlug: string,
	projectSlug: string,
	projectDateId: string,
	comment: string,
	client,
	accessToken?: string,
): Promise<ProjectDateComment> {
	const trimmedComment = cleanOptionalText(comment, 'Comment', 1000);
	if (!trimmedComment) throw new Error('Comment is required.');
	const { workspace, organisation, project } = await resolveScopedProject(workspaceSlug, projectSlug, client, accessToken);
	if (!await canCommentOnProjectDates(workspace, organisation.id, project.id, client, accessToken)) {
		throw new Error('Your project role does not permit project date comments.');
	}
	const projectDate = await getScopedProjectDate(organisation.id, project.id, projectDateId, client);

	const { data, error } = await client
		.from('project_date_comments')
		.insert({
			organisation_id: organisation.id,
			project_id: project.id,
			project_date_id: projectDate.id,
			comment: trimmedComment,
		})
		.select(COMMENT_SELECT)
		.single();

	if (error) throw error;
	const [enriched] = await enrichCommentAuthors([data as ProjectDateComment], client);
	return enriched;
}
