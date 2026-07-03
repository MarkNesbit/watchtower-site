import { assertCan, can, type WorkspaceRole } from './permissions.ts';
import { getWorkspaceBySlug } from './projects.ts';

export const PROJECT_DATE_TYPES = ['start_date', 'target_end_date', 'review_date', 'uat', 'stage_gate', 'load_test', 'other'] as const;
export type ProjectDateType = (typeof PROJECT_DATE_TYPES)[number];
export const DEFAULT_PROJECT_DATE_TYPES: ProjectDateType[] = ['start_date', 'target_end_date', 'review_date'];
export const PROJECT_DATE_WARNING_DAYS = 14;
export const PROJECT_DATE_TYPE_WARNING_DAYS: Record<ProjectDateType, number> = {
	start_date: 0,
	target_end_date: 14,
	review_date: 2,
	uat: 7,
	stage_gate: 14,
	load_test: 7,
	other: 14,
};
export const PROJECT_DATE_EDIT_ASSIGNMENT_ROLES = ['project_manager', 'delivery_lead', 'product_owner'] as const;

export type ProjectDateStatusTone = 'green' | 'amber' | 'red';

export type ProjectDateRecord = {
	id: string;
	organisation_id: string;
	project_id: string;
	date_type: ProjectDateType | string;
	custom_label?: string | null;
	target_date?: string | null;
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
	targetDate?: string | null;
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
	'target_date',
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

export function projectDateWarningDays(dateType: unknown): number {
	return isProjectDateType(dateType) ? PROJECT_DATE_TYPE_WARNING_DAYS[dateType] : PROJECT_DATE_WARNING_DAYS;
}

export function projectDateTypeLabel(value: unknown, customLabel?: string | null): string {
	if (value === 'other' && customLabel?.trim()) return customLabel.trim();
	if (value === 'uat') return 'UAT';
	if (value === 'target_end_date') return 'Target end date';
	if (value === 'review_date') return 'Review date';
	if (value === 'stage_gate') return 'Stage gate';
	if (value === 'load_test') return 'Load test';
	if (value === 'start_date') return 'Start date';
	return 'Project date';
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
	if (dateType === 'start_date') {
		if (daysUntil < 0) return { tone: 'green' as const, label: 'Green', text: 'Green - started' };
		if (daysUntil === 0) return { tone: 'green' as const, label: 'Green', text: 'Green - starting today' };
		if (daysUntil <= warningDays) return { tone: 'amber' as const, label: 'Amber', text: 'Amber - start approaching' };
		return { tone: 'green' as const, label: 'Green', text: 'Green - scheduled' };
	}
	if (daysUntil < 0) {
		const overdueText = dateType === 'review_date' ? 'Red - review overdue' : 'Red - overdue';
		return { tone: 'red' as const, label: 'Red', text: overdueText };
	}
	if (daysUntil <= warningDays) return { tone: 'amber' as const, label: 'Amber', text: `Amber - within ${warningDays} days` };
	return { tone: 'green' as const, label: 'Green', text: 'Green - scheduled' };
}

function legacyProjectDateForType(
	dateType: ProjectDateType,
	legacyProject?: { start_date?: string | null; target_end_date?: string | null; next_review_date?: string | null } | null,
): string | null {
	if (dateType === 'start_date') return legacyProject?.start_date ?? null;
	if (dateType === 'target_end_date') return legacyProject?.target_end_date ?? null;
	if (dateType === 'review_date') return legacyProject?.next_review_date ?? null;
	return null;
}

function defaultProjectDateRecord(
	activeRecords: ProjectDateRecord[],
	dateType: ProjectDateType,
	legacyDate: string | null,
): ProjectDateRecord | undefined {
	const candidates = activeRecords.filter((date) => date.date_type === dateType);
	if (legacyDate) {
		return candidates.find((date) => date.target_date === legacyDate)
			?? candidates.find((date) => !date.target_date)
			?? candidates[0];
	}
	return candidates.find((date) => Boolean(date.target_date)) ?? candidates[0];
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
		const targetDate = legacyDate ?? record?.target_date ?? null;
		const warningDays = projectDateWarningDays(dateType);
		const comments = record?.comments ?? [];
		return {
			id: record?.id ?? null,
			dateType,
			customLabel: null,
			label: projectDateTypeLabel(dateType),
			targetDate,
			warningDays,
			isDefault: true,
			isKeyDate: record?.is_key_date ?? true,
			status: deriveProjectDateStatus(targetDate, warningDays, now, dateType),
			comments,
			commentCount: comments.length,
		};
	});

	const usedDefaultIds = new Set([...firstByDefaultType.values()].map((date) => date.id));
	const additionalCards = activeRecords
		.filter((date) => isProjectDateType(date.date_type) && !usedDefaultIds.has(date.id))
		.map((date) => {
			const dateType = date.date_type as ProjectDateType;
			const comments = date.comments ?? [];
			return {
				id: date.id,
				dateType,
				customLabel: date.custom_label ?? null,
				label: projectDateTypeLabel(dateType, date.custom_label),
				targetDate: date.target_date ?? null,
				warningDays: projectDateWarningDays(dateType),
				isDefault: false,
				isKeyDate: date.is_key_date,
				status: deriveProjectDateStatus(date.target_date, projectDateWarningDays(dateType), now, dateType),
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

function cleanProjectDatePayload(input: { dateType?: string | null; customLabel?: string | null; targetDate?: string | null }) {
	if (!isProjectDateType(input.dateType)) throw new Error('Select a valid date type.');
	const customLabel = input.dateType === 'other'
		? cleanOptionalText(input.customLabel, 'Custom date label', 120)
		: null;
	if (input.dateType === 'other' && !customLabel) throw new Error('Custom date label is required when Other is selected.');
	return {
		dateType: input.dateType,
		customLabel,
		targetDate: cleanOptionalDate(input.targetDate, 'project date'),
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
	const column = dateType === 'start_date'
		? 'start_date'
		: dateType === 'target_end_date'
			? 'target_end_date'
			: dateType === 'review_date'
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
		targetDate?: string | null;
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
				target_date: cleaned.targetDate,
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
				target_date: cleaned.targetDate,
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
	await mirrorLegacyProjectDate(projectSlug, organisation.id, savedDate.date_type, savedDate.target_date ?? null, client);

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
