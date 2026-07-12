import { assertCan, type WorkspaceRole } from './permissions.ts';
import { createProjectNarrativeEntry } from './projectNarrative.ts';
import { getWorkspaceBySlug } from './projects.ts';

export const RISK_STATUSES = ['draft', 'open', 'monitoring', 'mitigating', 'escalated', 'materialised', 'closed'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];
export const DRAFT_RISK_STATUSES = ['draft'] as const;
export const ACTIVE_RISK_STATUSES = ['open', 'monitoring', 'mitigating', 'escalated', 'materialised'] as const;
export const CLOSED_RISK_STATUSES = ['accepted', 'closed', 'resolved', 'passed', 'retired', 'cancelled', 'rejected'] as const;
export const DASHBOARD_ACTIVE_RISK_STATUSES = ACTIVE_RISK_STATUSES;
export type RiskLifecycleCategory = 'draft' | 'active' | 'closed';
export type RiskLifecycleTone = 'green' | 'neutral';

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_RAG_STATUSES = ['blue', 'green', 'amber', 'red'] as const;
export type RiskRagStatus = (typeof RISK_RAG_STATUSES)[number];
export const RISK_EXPOSURES = ['low', 'medium', 'high', 'critical'] as const;
export type RiskExposure = (typeof RISK_EXPOSURES)[number];
export const RISK_REGISTER_EXPOSURE_FILTERS = ['low', 'medium', 'high', 'critical', 'unassessed'] as const;
export type RiskRegisterExposureFilter = (typeof RISK_REGISTER_EXPOSURE_FILTERS)[number];
export type RiskRegisterExposureDisplay = {
	value: RiskExposure | 'unassessed' | 'none';
	label: string;
	tone: RiskExposureTone | 'neutral';
	ariaLabel: string;
	isProvisional: boolean;
};
export type RiskExposureTone = 'risk-low' | 'risk-medium' | 'risk-high' | 'risk-critical';
export type RiskAssuranceTone = 'green' | 'amber' | 'red' | 'neutral';
export type RiskActionStateTone = 'green' | 'amber' | 'red';
export type RiskDashboardAssuranceTone = RiskAssuranceTone;
export type RiskDisplayTone = RiskAssuranceTone | RiskExposureTone;
export const RISK_REGISTER_VIEW_TABS = ['active', 'need-action', 'draft', 'closed'] as const;
export type RiskRegisterViewTab = (typeof RISK_REGISTER_VIEW_TABS)[number];
export const RISK_REGISTER_SORTS = ['highest-exposure', 'action-needed', 'review-due', 'recently-updated'] as const;
export type RiskRegisterSort = (typeof RISK_REGISTER_SORTS)[number];
export const RISK_REGISTER_PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_RISK_REGISTER_PAGE_SIZE = 25;
export type RiskRegisterPageSize = (typeof RISK_REGISTER_PAGE_SIZES)[number];
export type RiskRegisterFilters = {
	view?: RiskRegisterViewTab | string | null;
	search?: string | null;
	exposure?: RiskRegisterExposureFilter | string | null;
	actionState?: RiskActionStateTone | string | null;
	ownerId?: string | null;
	lifecycle?: RiskLifecycleCategory | string | null;
	sort?: RiskRegisterSort | string | null;
};
export type RiskRegisterPagination = {
	page: number;
	pageSize: RiskRegisterPageSize;
	totalItems: number;
	totalPages: number;
	startIndex: number;
	endIndex: number;
	startItem: number;
	endItem: number;
	hasPrevious: boolean;
	hasNext: boolean;
};
export type RiskExposureDistributionSegment = {
	exposure: RiskExposure | 'closed';
	label: string;
	tone: RiskExposureTone | 'neutral';
	count: number;
	percentage: number;
};
export type RiskExposureDistribution = {
	totalActiveRisks: number;
	assessedActiveRisks: number;
	unassessedActiveRisks: number;
	closedRisks: number;
	chartedRisks: number;
	segments: RiskExposureDistributionSegment[];
	summary: string;
};
export type RiskRegisterSummary = {
	openRisks: number;
	needAction: number;
	highestExposure: RiskExposure | null;
	draftRisks: number;
};
export type RiskActionItemType =
	| 'review-overdue'
	| 'assign-owner'
	| 'add-mitigation'
	| 'assign-actioner'
	| 'add-contingency'
	| 'assess-exposure'
	| 'due-date-overdue'
	| 'set-review-date'
	| 'review-due-soon'
	| 'set-due-date'
	| 'update-stale-risk';
export type RiskRegisterActionItem = {
	type: RiskActionItemType;
	priority: number;
	tone: RiskActionStateTone;
	label: string;
	reason: string;
	riskId: string;
	riskReference: string;
	riskTitle: string;
	lifecycle: RiskLifecycleCategory;
	actionState: RiskRagStatus | 'neutral';
	exposure: RiskExposure;
	reviewDate?: string | null;
	updatedAt?: string | null;
};

const RISK_SEQUENCE_CONSTRAINT = 'project_risks_project_sequence_key';
const RISK_REF_CONSTRAINT = 'project_risks_project_ref_key';
const RISK_ORGANISATION_REF_CONSTRAINT = 'project_risks_organisation_ref_key';
const RISK_SOURCE_PROMPT_CONSTRAINT = 'project_risks_project_source_prompt_key';
const MAX_RISK_REF_INSERT_ATTEMPTS = 3;
export const RISK_REVIEW_DUE_SOON_WINDOW_DAYS = 3;
export const RISK_ACTIVATION_DESCRIPTION_MIN_LENGTH = 30;

export type RiskProfile = {
	id: string;
	display_name?: string | null;
	email?: string | null;
};

export type RiskActivationRequirementKey =
	| 'title'
	| 'description'
	| 'owner'
	| 'assessment'
	| 'review_date'
	| 'activation_path';

export type RiskActivationRequirement = {
	key: RiskActivationRequirementKey;
	label: string;
	message: string;
};

export type RiskActivationReadiness = {
	ready: boolean;
	missing: RiskActivationRequirement[];
};

export type ProjectRisk = {
	risk_id: string;
	organisation_id: string;
	project_id: string;
	risk_ref: string;
	risk_sequence: number;
	source_risk_prompt_id?: string | null;
	title: string;
	description?: string | null;
	status: RiskStatus | string;
	probability: RiskLevel | string;
	impact: RiskLevel | string;
	rag_status: RiskRagStatus | string;
	owner_id?: string | null;
	actioner_id?: string | null;
	mitigation_plan?: string | null;
	contingency_plan?: string | null;
	review_date?: string | null;
	due_date?: string | null;
	assessment_completed_at?: string | null;
	assessment_completed_by?: string | null;
	created_by: string;
	updated_by?: string | null;
	created_at: string;
	updated_at: string;
	owner?: RiskProfile | null;
	actioner?: RiskProfile | null;
	creator?: RiskProfile | null;
	updater?: RiskProfile | null;
};

export type ProjectRiskComment = {
	risk_note_id: string;
	organisation_id: string;
	project_id: string;
	risk_id: string;
	parent_risk_note_id?: string | null;
	note: string;
	attention_level: 'green' | 'amber' | 'red' | string;
	created_by: string;
	updated_by?: string | null;
	created_at: string;
	updated_at?: string | null;
	author?: RiskProfile | null;
};

export type RiskAssuranceBlock = {
	id: string;
	title: string;
	tone: RiskDisplayTone;
	statusLabel: string;
	value: string;
	prompt?: string;
};

export type RiskActionStateDriver = {
	tone: RiskAssuranceTone;
	message: string;
};
export type RiskDateToneStatus = 'missing' | 'overdue' | 'due-soon' | 'scheduled';
export type RiskDateToneResult = {
	tone: RiskAssuranceTone;
	value: string;
	status: RiskDateToneStatus;
	daysUntil?: number;
};

export type RiskOwnerOption = RiskProfile & {
	role?: WorkspaceRole | string;
};

export type RiskFormInput = {
	title: string;
	description?: string;
	status?: string;
	probability?: string;
	impact?: string;
	ragStatus?: string;
	ownerId?: string;
	actionerId?: string;
	reviewDate?: string;
	dueDate?: string;
	mitigationPlan?: string;
	contingencyPlan?: string;
	assessmentCompleted?: string;
};

export class RiskActivationError extends Error {
	missing: RiskActivationRequirement[];

	constructor(message: string, missing: RiskActivationRequirement[]) {
		super(message);
		this.name = 'RiskActivationError';
		this.missing = missing;
	}
}

export type CreateDraftRisksFromPromptsResult = {
	requestedCount: number;
	eligiblePromptCount: number;
	invalidPromptCount: number;
	createdCount: number;
	skippedDuplicateCount: number;
	createdRisks: ProjectRisk[];
};

export type DraftRiskPromptPreflightItem = {
	riskPromptId: string;
	sourceRiskPromptId: string;
	title: string;
	guidance: string | null;
};

export type DraftRiskPromptDuplicateItem = {
	riskPromptId: string;
	sourceRiskPromptId: string;
	title: string;
	existingRiskId: string;
	existingRiskRef: string;
	existingRiskTitle: string;
};

export type DraftRiskPromptPreflightResult = {
	requestedCount: number;
	selectedPromptCount: number;
	eligiblePromptCount: number;
	createableCount: number;
	duplicateCount: number;
	invalidPromptCount: number;
	createablePrompts: DraftRiskPromptPreflightItem[];
	duplicatePrompts: DraftRiskPromptDuplicateItem[];
};

type DatabaseError = { code?: string; message?: string; details?: string; hint?: string };

const RISK_SELECT = [
	'risk_id',
	'organisation_id',
	'project_id',
	'risk_ref',
	'risk_sequence',
	'source_risk_prompt_id',
	'title',
	'description',
	'status',
	'probability',
	'impact',
	'rag_status',
	'owner_id',
	'actioner_id',
	'mitigation_plan',
	'contingency_plan',
	'review_date',
	'due_date',
	'assessment_completed_at',
	'assessment_completed_by',
	'created_by',
	'updated_by',
	'created_at',
	'updated_at',
].join(', ');

const RISK_COMMENT_SELECT = [
	'risk_note_id',
	'organisation_id',
	'project_id',
	'risk_id',
	'parent_risk_note_id',
	'note',
	'attention_level',
	'created_by',
	'updated_by',
	'created_at',
	'updated_at',
].join(', ');

const RISK_RAISED_NARRATIVE_PREFIX = 'Risk raised:';
const RISK_BECAME_RED_NARRATIVE_PREFIX = 'Risk became Red:';
const RISK_OPENED_NARRATIVE_PREFIX = 'Risk opened:';
const RISK_CLOSED_NARRATIVE_PREFIX = 'Risk closed:';
const RISK_REOPENED_NARRATIVE_PREFIX = 'Risk reopened:';

function isConstraintViolation(error: DatabaseError | null, constraintName: string): boolean {
	if (!error || error.code !== '23505') return false;
	return [error.message, error.details, error.hint].filter(Boolean).join(' ').includes(constraintName);
}

function isRiskRefConstraintViolation(error: DatabaseError | null): boolean {
	return [RISK_SEQUENCE_CONSTRAINT, RISK_REF_CONSTRAINT, RISK_ORGANISATION_REF_CONSTRAINT]
		.some((constraint) => isConstraintViolation(error, constraint));
}

function isSourcePromptConstraintViolation(error: DatabaseError | null): boolean {
	return isConstraintViolation(error, RISK_SOURCE_PROMPT_CONSTRAINT);
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function enrichRiskProfiles(risks: ProjectRisk[], client): Promise<ProjectRisk[]> {
	if (risks.length === 0) return risks;

	const profileIds = uniqueValues(risks.flatMap((risk) => [risk.owner_id, risk.actioner_id, risk.created_by, risk.updated_by]));
	const profileById = new Map<string, RiskProfile>();

	if (profileIds.length > 0) {
		try {
			const { data: profiles } = await client
				.from('profiles')
				.select('id, display_name, email')
				.in('id', profileIds);
			for (const profile of profiles ?? []) {
				profileById.set(profile.id, profile);
			}
		} catch {
			// Profile names are optional enrichment; the risk register must still render.
		}
	}

	return risks.map((risk) => ({
		...risk,
		owner: risk.owner_id ? profileById.get(risk.owner_id) ?? null : null,
		actioner: risk.actioner_id ? profileById.get(risk.actioner_id) ?? null : null,
		creator: profileById.get(risk.created_by) ?? null,
		updater: risk.updated_by ? profileById.get(risk.updated_by) ?? null : null,
	}));
}

async function enrichRiskCommentProfiles(comments: ProjectRiskComment[], client): Promise<ProjectRiskComment[]> {
	if (comments.length === 0) return comments;

	const profileIds = uniqueValues(comments.map((comment) => comment.created_by));
	const profileById = new Map<string, RiskProfile>();

	if (profileIds.length > 0) {
		try {
			const { data: profiles } = await client
				.from('profiles')
				.select('id, display_name, email')
				.in('id', profileIds);
			for (const profile of profiles ?? []) {
				profileById.set(profile.id, profile);
			}
		} catch {
			// Comment author labels are optional enrichment; comments should still render.
		}
	}

	return comments.map((comment) => ({
		...comment,
		author: profileById.get(comment.created_by) ?? null,
	}));
}

export function isRiskStatus(value: unknown): value is RiskStatus {
	return typeof value === 'string' && RISK_STATUSES.includes(value as RiskStatus);
}

export function isDraftRiskStatus(status: unknown): boolean {
	return DRAFT_RISK_STATUSES.includes(trimmedText(status).toLowerCase() as (typeof DRAFT_RISK_STATUSES)[number]);
}

export function isClosedRiskStatus(status: unknown): boolean {
	return CLOSED_RISK_STATUSES.includes(trimmedText(status).toLowerCase() as (typeof CLOSED_RISK_STATUSES)[number]);
}

export function isActiveRiskStatus(status: unknown): boolean {
	return ACTIVE_RISK_STATUSES.includes(trimmedText(status).toLowerCase() as (typeof ACTIVE_RISK_STATUSES)[number]);
}

export function riskLifecycleCategory(status: unknown): RiskLifecycleCategory {
	if (isDraftRiskStatus(status)) return 'draft';
	if (isClosedRiskStatus(status)) return 'closed';
	return 'active';
}

export function riskLifecycleTone(status: unknown): RiskLifecycleTone {
	return riskLifecycleCategory(status) === 'active' ? 'green' : 'neutral';
}

export function riskLifecycleLabel(status: unknown): string {
	const category = riskLifecycleCategory(status);
	if (category === 'draft') return 'Draft';
	if (category === 'closed') return 'Closed';
	return 'Active';
}

export function isRiskRagStatus(value: unknown): value is RiskRagStatus {
	return typeof value === 'string' && RISK_RAG_STATUSES.includes(value as RiskRagStatus);
}

export function isRiskReviewDate(value: unknown): boolean {
	if (value === null || value === undefined || value === '') return true;
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidRiskProjectRef(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Z][A-Z0-9]{1,9}$/.test(value);
}

export function buildRiskReference(projectRef: string, sequence: number): string {
	if (!isValidRiskProjectRef(projectRef)) {
		throw new Error('This project needs a valid project reference before risks can be created.');
	}
	if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) {
		throw new Error('Watchtower could not assign a valid risk reference. Please try again.');
	}
	return `Risk-${projectRef}-${String(sequence).padStart(3, '0')}`;
}

export function validateRiskFormInput(input: RiskFormInput, options: { mode?: 'create' | 'draft' | 'edit' } = {}): Record<string, string> {
	const errors: Record<string, string> = {};
	const mode = options.mode ?? 'edit';
	const requiresAssessment = mode === 'edit';
	if (!input.title.trim()) errors.title = 'Risk title is required.';
	if (mode !== 'create' && !isRiskStatus(input.status)) errors.status = 'Select a valid risk status.';
	if (requiresAssessment && !RISK_LEVELS.includes(input.probability as RiskLevel)) errors.probability = 'Select a valid probability.';
	if (requiresAssessment && !RISK_LEVELS.includes(input.impact as RiskLevel)) errors.impact = 'Select a valid impact.';
	if (!isRiskReviewDate(input.reviewDate)) errors.reviewDate = 'Enter a valid review date.';
	if (!isRiskReviewDate(input.dueDate)) errors.dueDate = 'Enter a valid due date.';
	return errors;
}

function riskActivationRequirement(
	key: RiskActivationRequirementKey,
	label: string,
	message: string,
): RiskActivationRequirement {
	return { key, label, message };
}

function hasCompletedRiskAssessment(risk: Pick<ProjectRisk, 'assessment_completed_at' | 'probability' | 'impact'>): boolean {
	return Boolean(risk.assessment_completed_at)
		&& RISK_LEVELS.includes(risk.probability as RiskLevel)
		&& RISK_LEVELS.includes(risk.impact as RiskLevel);
}

function hasSubmittedRiskAssessment(input: Pick<RiskFormInput, 'probability' | 'impact'>): boolean {
	return RISK_LEVELS.includes(input.probability as RiskLevel)
		&& RISK_LEVELS.includes(input.impact as RiskLevel);
}

function hasMeaningfulRiskDescription(value: unknown): boolean {
	return trimmedText(value).length >= RISK_ACTIVATION_DESCRIPTION_MIN_LENGTH;
}

export function getRiskActivationReadiness(
	risk: Pick<ProjectRisk, 'title' | 'description' | 'owner_id' | 'probability' | 'impact' | 'review_date' | 'assessment_completed_at'>,
	options: { now?: Date } = {},
): RiskActivationReadiness {
	const now = options.now ?? new Date();
	const missing: RiskActivationRequirement[] = [];
	const reviewDaysUntil = daysUntilUtcDate(risk.review_date, now);

	if (!trimmedText(risk.title)) {
		missing.push(riskActivationRequirement('title', 'Risk title', 'Add a risk title.'));
	}
	if (!hasMeaningfulRiskDescription(risk.description)) {
		missing.push(riskActivationRequirement(
			'description',
			'Risk description',
			`Add a project-specific risk description of at least ${RISK_ACTIVATION_DESCRIPTION_MIN_LENGTH} characters.`,
		));
	}
	if (!risk.owner_id) {
		missing.push(riskActivationRequirement('owner', 'Risk owner', 'Assign a risk owner.'));
	}
	if (!hasCompletedRiskAssessment(risk)) {
		missing.push(riskActivationRequirement('assessment', 'Probability and impact assessment', 'Assess probability and impact.'));
	}
	if (reviewDaysUntil === null) {
		missing.push(riskActivationRequirement('review_date', 'Review date', 'Set a review date.'));
	} else if (reviewDaysUntil < 0) {
		missing.push(riskActivationRequirement('review_date', 'Review date', 'Set a review date that is not overdue.'));
	}

	return {
		ready: missing.length === 0,
		missing,
	};
}

export function riskRagTone(value: unknown): RiskRagStatus | 'neutral' {
	if (value === 'green' || value === 'amber' || value === 'red' || value === 'blue') return value;
	return 'neutral';
}

export function riskAssuranceToneLabel(tone: RiskAssuranceTone): string {
	if (tone === 'green') return 'Green';
	if (tone === 'amber') return 'Amber';
	if (tone === 'red') return 'Red';
	return 'Neutral';
}

export function riskExposureLabel(exposure: RiskExposure): string {
	if (exposure === 'critical') return 'Critical';
	if (exposure === 'high') return 'High';
	if (exposure === 'medium') return 'Medium';
	return 'Low';
}

export function riskExposureTone(exposure: RiskExposure): RiskExposureTone {
	if (exposure === 'critical') return 'risk-critical';
	if (exposure === 'high') return 'risk-high';
	if (exposure === 'medium') return 'risk-medium';
	return 'risk-low';
}

export function riskExposureToneLabel(tone: RiskExposureTone): string {
	if (tone === 'risk-critical') return 'Critical';
	if (tone === 'risk-high') return 'High';
	if (tone === 'risk-medium') return 'Medium';
	return 'Low';
}

export function isDraftRiskExposureUnassessed(
	risk: Pick<ProjectRisk, 'status' | 'probability' | 'impact'> & Pick<Partial<ProjectRisk>, 'assessment_completed_at'>,
): boolean {
	return riskLifecycleCategory(risk.status) === 'draft'
		&& !risk.assessment_completed_at
		&& risk.probability === 'medium'
		&& risk.impact === 'medium';
}

export function getRiskRegisterExposureDisplay(
	risk: Pick<ProjectRisk, 'risk_ref' | 'status' | 'probability' | 'impact'> & Pick<Partial<ProjectRisk>, 'assessment_completed_at'>,
): RiskRegisterExposureDisplay {
	const lifecycle = riskLifecycleCategory(risk.status);
	if (lifecycle === 'closed') {
		return {
			value: 'none',
			label: '—',
			tone: 'neutral',
			ariaLabel: `${risk.risk_ref} has no current exposure because it is closed.`,
			isProvisional: false,
		};
	}
	if (lifecycle === 'draft' && isDraftRiskExposureUnassessed(risk)) {
		return {
			value: 'unassessed',
			label: 'Unassessed',
			tone: 'neutral',
			ariaLabel: `${risk.risk_ref} estimated exposure is unassessed.`,
			isProvisional: true,
		};
	}
	const exposure = deriveWatchtowerDefaultRiskExposure(risk.probability, risk.impact);
	const label = riskExposureLabel(exposure);
	return {
		value: exposure,
		label,
		tone: riskExposureTone(exposure),
		ariaLabel: lifecycle === 'draft'
			? `${risk.risk_ref} estimated exposure: ${label}.`
			: `${risk.risk_ref} exposure: ${label}.`,
		isProvisional: lifecycle === 'draft',
	};
}

export function riskDisplayLabel(value: unknown, fallback = 'Unknown'): string {
	if (typeof value !== 'string' || !value.trim()) return fallback;
	return value
		.split(/[_\s-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export function normaliseRiskRegisterViewTab(value: unknown): RiskRegisterViewTab {
	return RISK_REGISTER_VIEW_TABS.includes(value as RiskRegisterViewTab) ? value as RiskRegisterViewTab : 'active';
}

export function normaliseRiskRegisterSort(value: unknown): RiskRegisterSort {
	return RISK_REGISTER_SORTS.includes(value as RiskRegisterSort) ? value as RiskRegisterSort : 'highest-exposure';
}

export function parseRiskRegisterPage(value: unknown): number {
	const rawValue = typeof value === 'number' ? String(value) : trimmedText(value);
	const parsed = /^\d+$/.test(rawValue) ? Number(rawValue) : Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function parseRiskRegisterPageSize(value: unknown): RiskRegisterPageSize {
	const rawValue = typeof value === 'number' ? String(value) : trimmedText(value);
	const parsed = /^\d+$/.test(rawValue) ? Number(rawValue) : Number.NaN;
	return RISK_REGISTER_PAGE_SIZES.includes(parsed as RiskRegisterPageSize)
		? parsed as RiskRegisterPageSize
		: DEFAULT_RISK_REGISTER_PAGE_SIZE;
}

export function normaliseRiskRegisterPage(value: unknown, totalPages = 1): number {
	const page = parseRiskRegisterPage(value);
	const parsedTotalPages = Math.floor(Number(totalPages) || 1);
	const lastPage = Math.max(1, parsedTotalPages);
	return Math.min(page, lastPage);
}

export function normaliseRiskRegisterSearch(value: unknown): string {
	return trimmedText(value).toLowerCase();
}

export function riskMatchesRegisterSearch(risk: Pick<ProjectRisk, 'risk_ref' | 'title'>, search: unknown): boolean {
	const query = normaliseRiskRegisterSearch(search);
	if (!query) return true;
	return normaliseRiskRegisterSearch(risk.risk_ref).includes(query)
		|| normaliseRiskRegisterSearch(risk.title).includes(query);
}

export function riskMatchesRegisterView(
	risk: Pick<ProjectRisk,
		'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
	>,
	view: unknown,
	now = new Date(),
): boolean {
	const tab = normaliseRiskRegisterViewTab(view);
	if (tab === 'active') return riskLifecycleCategory(risk.status) === 'active';
	if (tab === 'draft') return riskLifecycleCategory(risk.status) === 'draft';
	if (tab === 'closed') return riskLifecycleCategory(risk.status) === 'closed';
	return riskLifecycleCategory(risk.status) === 'active'
		&& (deriveRiskReferenceTone(risk, now) === 'red' || deriveRiskReferenceTone(risk, now) === 'amber');
}

function normalisedExposureFilter(value: unknown): RiskRegisterExposureFilter | '' {
	return RISK_REGISTER_EXPOSURE_FILTERS.includes(value as RiskRegisterExposureFilter) ? value as RiskRegisterExposureFilter : '';
}

function normalisedActionStateFilter(value: unknown): RiskActionStateTone | '' {
	return value === 'red' || value === 'amber' || value === 'green' ? value : '';
}

function normalisedLifecycleFilter(value: unknown): RiskLifecycleCategory | '' {
	return value === 'draft' || value === 'active' || value === 'closed' ? value : '';
}

export function riskMatchesRegisterFilters(
	risk: Pick<ProjectRisk,
		'status' | 'risk_ref' | 'title' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
	>,
	filters: RiskRegisterFilters = {},
	now = new Date(),
): boolean {
	if (!riskMatchesRegisterView(risk, filters.view, now)) return false;
	if (!riskMatchesRegisterSearch(risk, filters.search)) return false;

	const exposure = normalisedExposureFilter(filters.exposure);
	if (exposure && getRiskRegisterExposureDisplay(risk).value !== exposure) return false;

	const actionState = normalisedActionStateFilter(filters.actionState);
	if (actionState && deriveRiskReferenceTone(risk, now) !== actionState) return false;

	const ownerId = trimmedText(filters.ownerId);
	if (ownerId === 'unassigned' && risk.owner_id) return false;
	if (ownerId && ownerId !== 'unassigned' && risk.owner_id !== ownerId) return false;

	const lifecycle = normalisedLifecycleFilter(filters.lifecycle);
	if (lifecycle && riskLifecycleCategory(risk.status) !== lifecycle) return false;

	return true;
}

export function defaultRiskRegisterSortForView(view: unknown): RiskRegisterSort {
	const tab = normaliseRiskRegisterViewTab(view);
	if (tab === 'need-action') return 'action-needed';
	if (tab === 'closed') return 'recently-updated';
	return 'highest-exposure';
}

function riskExposureSortRank(risk: Pick<ProjectRisk, 'risk_ref' | 'status' | 'probability' | 'impact'>): number {
	const exposure = getRiskRegisterExposureDisplay(risk).value;
	if (exposure === 'critical') return 0;
	if (exposure === 'high') return 1;
	if (exposure === 'medium') return 2;
	if (exposure === 'low') return 3;
	return 4;
}

function compareRiskCreatedOldest(a: Pick<ProjectRisk, 'created_at'>, b: Pick<ProjectRisk, 'created_at'>): number {
	return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();
}

function riskActionStateSortRank(risk: Pick<ProjectRisk,
	'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
>, now: Date): number {
	const actionState = deriveRiskReferenceTone(risk, now);
	if (actionState === 'red') return 0;
	if (actionState === 'amber') return 1;
	if (actionState === 'green') return 2;
	return 3;
}

function riskReviewDateSortRank(risk: Pick<ProjectRisk, 'status' | 'review_date'>, now: Date): number {
	const lifecycle = riskLifecycleCategory(risk.status);
	if (lifecycle === 'closed') return 3;
	const date = parseUtcDate(risk.review_date);
	if (!date) return 2;
	return date < startOfUtcDay(now) ? 0 : 1;
}

function compareRiskReviewDate(a: Pick<ProjectRisk, 'status' | 'review_date'>, b: Pick<ProjectRisk, 'status' | 'review_date'>, now: Date): number {
	const rank = riskReviewDateSortRank(a, now) - riskReviewDateSortRank(b, now);
	if (rank) return rank;
	const aDate = parseUtcDate(a.review_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
	const bDate = parseUtcDate(b.review_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
	return aDate - bDate;
}

function compareRiskUpdated(a: Pick<ProjectRisk, 'updated_at'>, b: Pick<ProjectRisk, 'updated_at'>): number {
	return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
}

function compareRiskStable(a: Pick<ProjectRisk, 'risk_sequence' | 'risk_ref'>, b: Pick<ProjectRisk, 'risk_sequence' | 'risk_ref'>): number {
	return (a.risk_sequence ?? 0) - (b.risk_sequence ?? 0)
		|| String(a.risk_ref ?? '').localeCompare(String(b.risk_ref ?? ''));
}

export function compareRisksForRegister(a: ProjectRisk, b: ProjectRisk, sort: unknown = 'highest-exposure', now = new Date(), view: unknown = 'active'): number {
	const selectedSort = normaliseRiskRegisterSort(sort);
	const selectedView = normaliseRiskRegisterViewTab(view);
	if (selectedView === 'draft' && selectedSort === 'highest-exposure') {
		return riskExposureSortRank(a) - riskExposureSortRank(b)
			|| compareRiskCreatedOldest(a, b)
			|| compareRiskStable(a, b);
	}
	if (selectedSort === 'action-needed') {
		return riskActionStateSortRank(a, now) - riskActionStateSortRank(b, now)
			|| riskExposureSortRank(a) - riskExposureSortRank(b)
			|| compareRiskReviewDate(a, b, now)
			|| compareRiskUpdated(a, b)
			|| compareRiskStable(a, b);
	}
	if (selectedSort === 'review-due') {
		return compareRiskReviewDate(a, b, now)
			|| riskActionStateSortRank(a, now) - riskActionStateSortRank(b, now)
			|| riskExposureSortRank(a) - riskExposureSortRank(b)
			|| compareRiskUpdated(a, b)
			|| compareRiskStable(a, b);
	}
	if (selectedSort === 'recently-updated') {
		return compareRiskUpdated(a, b)
			|| riskExposureSortRank(a) - riskExposureSortRank(b)
			|| riskActionStateSortRank(a, now) - riskActionStateSortRank(b, now)
			|| compareRiskStable(a, b);
	}
	return riskExposureSortRank(a) - riskExposureSortRank(b)
		|| riskActionStateSortRank(a, now) - riskActionStateSortRank(b, now)
		|| compareRiskReviewDate(a, b, now)
		|| compareRiskUpdated(a, b)
		|| compareRiskStable(a, b);
}

export function filterAndSortRisksForRegister(risks: ProjectRisk[], filters: RiskRegisterFilters = {}, now = new Date()): ProjectRisk[] {
	const selectedView = normaliseRiskRegisterViewTab(filters.view);
	const selectedSort = filters.sort ? normaliseRiskRegisterSort(filters.sort) : defaultRiskRegisterSortForView(selectedView);
	return risks
		.filter((risk) => riskMatchesRegisterFilters(risk, filters, now))
		.sort((a, b) => compareRisksForRegister(a, b, selectedSort, now, selectedView));
}

export function getRiskRegisterPaginationRange(totalItems: number, requestedPage: unknown = 1, requestedPageSize: unknown = DEFAULT_RISK_REGISTER_PAGE_SIZE): RiskRegisterPagination {
	const safeTotal = Math.max(0, Math.floor(Number(totalItems) || 0));
	const pageSize = parseRiskRegisterPageSize(requestedPageSize);
	const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
	const page = normaliseRiskRegisterPage(requestedPage, totalPages);
	const startIndex = safeTotal === 0 ? 0 : (page - 1) * pageSize;
	const endIndex = safeTotal === 0 ? 0 : Math.min(startIndex + pageSize, safeTotal);

	return {
		page,
		pageSize,
		totalItems: safeTotal,
		totalPages,
		startIndex,
		endIndex,
		startItem: safeTotal === 0 ? 0 : startIndex + 1,
		endItem: endIndex,
		hasPrevious: page > 1,
		hasNext: page < totalPages,
	};
}

export function paginateRisksForRegister(risks: ProjectRisk[], requestedPage: unknown = 1, requestedPageSize: unknown = DEFAULT_RISK_REGISTER_PAGE_SIZE) {
	const pagination = getRiskRegisterPaginationRange(risks.length, requestedPage, requestedPageSize);
	return {
		items: risks.slice(pagination.startIndex, pagination.endIndex),
		pagination,
	};
}

export function getRiskRegisterPageNumbers(currentPage: number, totalPages: number, maxVisible = 5): number[] {
	const safeTotal = Math.max(1, Math.floor(Number(totalPages) || 1));
	const safeCurrent = normaliseRiskRegisterPage(currentPage, safeTotal);
	const safeVisible = Math.max(1, Math.floor(Number(maxVisible) || 1));
	const count = Math.min(safeVisible, safeTotal);
	const start = Math.min(Math.max(1, safeCurrent - Math.floor(count / 2)), safeTotal - count + 1);
	return Array.from({ length: count }, (_, index) => start + index);
}

export function countOpenRisks(risks: Array<Pick<ProjectRisk, 'status'>>): number {
	return risks.filter((risk) => riskLifecycleCategory(risk.status) === 'active').length;
}

export function countDraftRisks(risks: Array<Pick<ProjectRisk, 'status'>>): number {
	return risks.filter((risk) => riskLifecycleCategory(risk.status) === 'draft').length;
}

export function countRisksNeedingAction(risks: Array<Pick<ProjectRisk,
	'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
>>, now = new Date()): number {
	return risks.filter((risk) => {
		if (riskLifecycleCategory(risk.status) !== 'active') return false;
		const actionState = deriveRiskReferenceTone(risk, now);
		return actionState === 'red' || actionState === 'amber';
	}).length;
}

export function hasAssessedRiskExposure(risk: Pick<ProjectRisk, 'probability' | 'impact'>): boolean {
	return RISK_LEVELS.includes(risk.probability as RiskLevel) && RISK_LEVELS.includes(risk.impact as RiskLevel);
}

export function getHighestActiveExposure(risks: Array<Pick<ProjectRisk, 'status' | 'probability' | 'impact'>>): RiskExposure | null {
	const assessedActiveRisks = risks.filter((risk) => riskLifecycleCategory(risk.status) === 'active' && hasAssessedRiskExposure(risk));
	if (assessedActiveRisks.length === 0) return null;
	return assessedActiveRisks
		.map((risk) => deriveWatchtowerDefaultRiskExposure(risk.probability, risk.impact))
		.sort((a, b) => RISK_EXPOSURES.indexOf(b) - RISK_EXPOSURES.indexOf(a))[0] ?? null;
}

export function getExposurePercentage(count: number, total: number): number {
	if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0 || count <= 0) return 0;
	return Math.round((count / total) * 100);
}

export function getActiveRiskExposureCounts(risks: Array<Pick<ProjectRisk, 'status' | 'probability' | 'impact'>>): Record<RiskExposure, number> {
	const counts = Object.fromEntries(RISK_EXPOSURES.map((exposure) => [exposure, 0])) as Record<RiskExposure, number>;
	for (const risk of risks) {
		if (riskLifecycleCategory(risk.status) !== 'active' || !hasAssessedRiskExposure(risk)) continue;
		counts[deriveWatchtowerDefaultRiskExposure(risk.probability, risk.impact)] += 1;
	}
	return counts;
}

export function getExposureDistribution(risks: Array<Pick<ProjectRisk, 'status' | 'probability' | 'impact'>>): RiskExposureDistribution {
	const activeRisks = risks.filter((risk) => riskLifecycleCategory(risk.status) === 'active');
	const closedRisks = risks.filter((risk) => riskLifecycleCategory(risk.status) === 'closed').length;
	const counts = getActiveRiskExposureCounts(activeRisks);
	const assessedActiveRisks = activeRisks.filter((risk) => hasAssessedRiskExposure(risk)).length;
	const chartedRisks = assessedActiveRisks + closedRisks;
	const exposureSegments = [...RISK_EXPOSURES].reverse().map((exposure) => ({
		exposure,
		label: riskExposureLabel(exposure),
		tone: riskExposureTone(exposure),
		count: counts[exposure],
		percentage: getExposurePercentage(counts[exposure], chartedRisks),
	}));
	const segments = [
		...exposureSegments,
		{
			exposure: 'closed' as const,
			label: 'Closed',
			tone: 'neutral' as const,
			count: closedRisks,
			percentage: getExposurePercentage(closedRisks, chartedRisks),
		},
	];
	return {
		totalActiveRisks: activeRisks.length,
		assessedActiveRisks,
		unassessedActiveRisks: activeRisks.length - assessedActiveRisks,
		closedRisks,
		chartedRisks,
		segments,
		summary: getExposureChartSummary(segments, activeRisks.length - assessedActiveRisks),
	};
}

export function getExposureChartSummary(segments: RiskExposureDistributionSegment[], unassessedActiveRisks = 0): string {
	const assessedParts = segments
		.filter((segment) => segment.count > 0)
		.map((segment) => `${segment.count} ${segment.label}`);
	const unassessedPart = unassessedActiveRisks > 0 ? `${unassessedActiveRisks} unassessed` : '';
	const parts = [...assessedParts, unassessedPart].filter(Boolean);
	return parts.length > 0 ? `Risk exposure distribution: ${parts.join(', ')}.` : 'No active or closed risks to chart.';
}

export function summarizeRiskRegister(risks: ProjectRisk[], now = new Date()): RiskRegisterSummary {
	return {
		openRisks: countOpenRisks(risks),
		needAction: countRisksNeedingAction(risks, now),
		highestExposure: getHighestActiveExposure(risks),
		draftRisks: countDraftRisks(risks),
	};
}

export function isRiskEligibleForActionPanel(risk: Pick<ProjectRisk, 'status'>): boolean {
	return riskLifecycleCategory(risk.status) === 'active';
}

function riskActionItemBase(risk: ProjectRisk, now: Date) {
	return {
		riskId: risk.risk_id,
		riskReference: risk.risk_ref,
		riskTitle: risk.title,
		lifecycle: riskLifecycleCategory(risk.status),
		actionState: deriveRiskReferenceTone(risk, now),
		exposure: deriveWatchtowerDefaultRiskExposure(risk.probability, risk.impact),
		reviewDate: risk.review_date,
		updatedAt: risk.updated_at,
	};
}

function daysUntilUtcDate(value: unknown, now: Date): number | null {
	const date = parseUtcDate(value);
	if (!date) return null;
	return Math.ceil((date.getTime() - startOfUtcDay(now).getTime()) / 86_400_000);
}

function riskActionItem(
	risk: ProjectRisk,
	now: Date,
	type: RiskActionItemType,
	priority: number,
	tone: RiskActionStateTone,
	label: string,
	reason: string,
): RiskRegisterActionItem {
	return {
		type,
		priority,
		tone,
		label,
		reason,
		...riskActionItemBase(risk, now),
	};
}

export function getRiskActionItems(risk: ProjectRisk, now = new Date()): RiskRegisterActionItem[] {
	if (!isRiskEligibleForActionPanel(risk)) return [];

	const exposure = deriveWatchtowerDefaultRiskExposure(risk.probability, risk.impact);
	const review = deriveRiskReviewDateTone(risk.review_date, now);
	const due = dateTone(risk.due_date, now, 'amber', 'No due date');
	const mitigation = trimmedText(risk.mitigation_plan);
	const contingency = trimmedText(risk.contingency_plan);
	const updated = staleUpdateTone(risk.updated_at, now);
	const items: RiskRegisterActionItem[] = [];

	if (review.status === 'overdue') {
		items.push(riskActionItem(risk, now, 'review-overdue', 0, 'red', 'Review overdue risk', 'Overdue'));
	}
	if (!risk.owner_id) {
		items.push(riskActionItem(risk, now, 'assign-owner', 10, 'red', 'Assign owner', 'Missing owner'));
	}
	if (!mitigation && exposure === 'critical') {
		items.push(riskActionItem(risk, now, 'add-mitigation', 20, 'red', 'Add mitigation plan', 'Missing mitigation for Critical exposure'));
	}
	if (actionerTone(risk.status, risk.actioner_id) === 'red') {
		items.push(riskActionItem(risk, now, 'assign-actioner', 30, 'red', 'Assign actioner', 'Missing actioner'));
	}
	if (!contingency) {
		items.push(riskActionItem(risk, now, 'add-contingency', 40, 'red', 'Add contingency plan', 'Missing contingency'));
	}
	if (!hasAssessedRiskExposure(risk)) {
		items.push(riskActionItem(risk, now, 'assess-exposure', 50, 'red', 'Assess risk exposure', 'Probability or impact missing'));
	}
	if (due.tone === 'red') {
		items.push(riskActionItem(risk, now, 'due-date-overdue', 60, 'red', 'Review overdue due date', 'Due date overdue'));
	}
	if (review.status === 'missing') {
		items.push(riskActionItem(risk, now, 'set-review-date', 70, 'amber', 'Set review date', 'Missing review date'));
	} else if (review.status === 'due-soon') {
		const reviewDays = review.daysUntil ?? 0;
		items.push(riskActionItem(
			risk,
			now,
			'review-due-soon',
			80,
			'amber',
			reviewDays === 0 ? 'Review risk today' : 'Review risk soon',
			reviewDays === 0 ? 'Due today' : `Due in ${reviewDays} day${reviewDays === 1 ? '' : 's'}`,
		));
	}
	if (due.tone === 'amber') {
		items.push(riskActionItem(risk, now, 'set-due-date', 90, 'amber', 'Set due date', 'Missing due date'));
	}
	if (updated === 'red') {
		items.push(riskActionItem(risk, now, 'update-stale-risk', 100, 'red', 'Update stale risk', 'Update overdue'));
	}
	if (updated === 'amber') {
		items.push(riskActionItem(risk, now, 'update-stale-risk', 110, 'amber', 'Update stale risk', 'Update getting stale'));
	}
	if (!mitigation && (exposure === 'high' || exposure === 'medium')) {
		items.push(riskActionItem(risk, now, 'add-mitigation', 120, 'amber', 'Add mitigation plan', `Missing mitigation for ${riskExposureLabel(exposure)} exposure`));
	}

	return items;
}

function compareRiskActionItems(a: RiskRegisterActionItem, b: RiskRegisterActionItem): number {
	return (a.tone === 'red' ? 0 : 1) - (b.tone === 'red' ? 0 : 1)
		|| a.priority - b.priority
		|| RISK_EXPOSURES.indexOf(b.exposure) - RISK_EXPOSURES.indexOf(a.exposure)
		|| (parseUtcDate(a.reviewDate)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (parseUtcDate(b.reviewDate)?.getTime() ?? Number.MAX_SAFE_INTEGER)
		|| new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
		|| a.riskReference.localeCompare(b.riskReference)
		|| a.type.localeCompare(b.type);
}

export function rankRiskActionItems(items: RiskRegisterActionItem[]): RiskRegisterActionItem[] {
	return [...items].sort(compareRiskActionItems);
}

export function getProjectRiskActionItems(risks: ProjectRisk[], now = new Date()): RiskRegisterActionItem[] {
	return rankRiskActionItems(risks.flatMap((risk) => getRiskActionItems(risk, now)));
}

export function getTopRiskActionItems(risks: ProjectRisk[], limit = 4, now = new Date()): RiskRegisterActionItem[] {
	return getProjectRiskActionItems(risks, now).slice(0, Math.max(0, limit));
}

function isRedRiskActionState(value: unknown): boolean {
	return value === 'red';
}

function riskActionStateToNarrativeAttention(actionState: RiskActionStateTone): 'green' | 'amber' | 'red' {
	return actionState;
}

function compactSentence(parts: Array<string | null | undefined>): string {
	return parts.filter((part): part is string => Boolean(part?.trim())).map((part) => part.trim()).join(' ');
}

export function riskProfileName(profile: RiskProfile | null | undefined, fallback = 'Unassigned'): string {
	return profile?.display_name || profile?.email || fallback;
}

function trimmedText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function parseUtcDate(value: unknown): Date | null {
	if (!isRiskReviewDate(value)) return null;
	const text = trimmedText(value);
	return text ? new Date(`${text}T00:00:00Z`) : null;
}

function startOfUtcDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateTone(value: unknown, now: Date, missingTone: RiskAssuranceTone, missingValue: string): RiskDateToneResult {
	const date = parseUtcDate(value);
	if (!date) return { tone: missingTone, value: missingValue, status: 'missing' };
	return date < startOfUtcDay(now)
		? { tone: 'red', value: 'Overdue', status: 'overdue' }
		: { tone: 'green', value: 'Scheduled', status: 'scheduled' };
}

export function deriveRiskReviewDateTone(value: unknown, now = new Date()): RiskDateToneResult {
	const daysUntil = daysUntilUtcDate(value, now);
	if (daysUntil === null) return { tone: 'amber', value: 'No review date', status: 'missing' };
	if (daysUntil <= 0) {
		return {
			tone: 'red',
			value: daysUntil === 0 ? 'Due today' : 'Overdue',
			status: 'overdue',
			daysUntil,
		};
	}
	if (daysUntil <= RISK_REVIEW_DUE_SOON_WINDOW_DAYS) {
		return {
			tone: 'amber',
			value: `Due in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
			status: 'due-soon',
			daysUntil,
		};
	}
	return { tone: 'green', value: 'Scheduled', status: 'scheduled', daysUntil };
}

function riskReviewDateIsOverdue(value: unknown, now: Date): boolean {
	const date = parseUtcDate(value);
	return Boolean(date && date < startOfUtcDay(now));
}

export function deriveWatchtowerDefaultRiskExposure(probability: unknown, impact: unknown): RiskExposure {
	if (!RISK_LEVELS.includes(probability as RiskLevel) || !RISK_LEVELS.includes(impact as RiskLevel)) return 'critical';
	if (probability === 'high' && impact === 'high') return 'critical';
	if (probability === 'low' && impact === 'low') return 'low';
	if (
		(probability === 'medium' && impact === 'high') ||
		(probability === 'high' && impact === 'medium')
	) return 'high';
	if (probability === 'high' || impact === 'high' || probability === 'medium' || impact === 'medium') return 'medium';
	return 'low';
}

export function deriveWatchtowerDefaultRiskExposureTone(probability: unknown, impact: unknown): RiskExposureTone {
	return riskExposureTone(deriveWatchtowerDefaultRiskExposure(probability, impact));
}

export function deriveRiskExposureTone(probability: unknown, impact: unknown): RiskExposureTone {
	return deriveWatchtowerDefaultRiskExposureTone(probability, impact);
}

function lifecycleStatusTone(status: unknown): RiskAssuranceTone {
	const normalised = trimmedText(status).toLowerCase();
	if (!normalised) return 'neutral';
	if (isDraftRiskStatus(status) || isClosedRiskStatus(status)) return 'neutral';
	if (normalised === 'materialised') return 'red';
	if (normalised === 'closed' || normalised === 'accepted' || normalised === 'open' || normalised === 'monitoring' || normalised === 'mitigating' || normalised === 'escalated') return 'green';
	return 'neutral';
}

function actionerTone(status: unknown, actionerId: unknown): RiskAssuranceTone {
	if (actionerId) return 'green';
	if (!isActiveRiskStatus(status)) return 'neutral';
	return 'red';
}

function actionerValue(risk: ProjectRisk, tone: RiskAssuranceTone): string {
	if (risk.actioner_id) return `Assigned to: ${riskProfileName(risk.actioner, 'Workspace member')}`;
	if (tone === 'neutral') return 'No actioner required for this risk state.';
	return 'No actioner assigned for a risk requiring action.';
}

function actionerToneLabel(tone: RiskAssuranceTone): string {
	return tone === 'neutral' ? 'Neutral' : riskAssuranceToneLabel(tone);
}

function staleUpdateTone(updatedAt: unknown, now: Date): RiskAssuranceTone {
	const text = trimmedText(updatedAt);
	const updated = text ? new Date(text) : null;
	if (!updated || Number.isNaN(updated.getTime())) return 'neutral';
	const ageDays = Math.floor((now.getTime() - updated.getTime()) / 86_400_000);
	if (ageDays > 60) return 'red';
	if (ageDays > 30) return 'amber';
	return 'green';
}

export function deriveRiskAssuranceRollupTone(tones: RiskAssuranceTone[]): RiskAssuranceTone {
	if (tones.includes('red')) return 'red';
	if (tones.includes('amber')) return 'amber';
	if (tones.includes('green')) return 'green';
	return 'neutral';
}

export function deriveRiskAssuranceTone(risk: Pick<ProjectRisk,
	'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
>, now = new Date()): RiskAssuranceTone {
	if (!isActiveRiskStatus(risk.status)) return 'neutral';
	const exposure = deriveWatchtowerDefaultRiskExposure(risk.probability, risk.impact);
	const status = trimmedText(risk.status).toLowerCase();
	const review = deriveRiskReviewDateTone(risk.review_date, now);
	const due = dateTone(risk.due_date, now, 'amber', 'No due date');
	const mitigation = trimmedText(risk.mitigation_plan);
	const contingency = trimmedText(risk.contingency_plan);
	const missingMitigationTone: RiskAssuranceTone = mitigation ? 'green' : exposure === 'critical' ? 'red' : exposure === 'high' || exposure === 'medium' ? 'amber' : 'green';
	const updated = staleUpdateTone(risk.updated_at, now);
	const statusTone: RiskAssuranceTone = status === 'materialised'
		? 'red'
		: status === 'escalated' && (!risk.owner_id || !risk.actioner_id || review.tone !== 'green')
		? 'red'
		: 'green';

	return deriveRiskAssuranceRollupTone([
		risk.owner_id ? 'green' : 'red',
		actionerTone(risk.status, risk.actioner_id),
		review.tone,
		due.tone,
		missingMitigationTone,
		contingency ? 'green' : 'red',
		statusTone,
		updated === 'red' || updated === 'amber' ? updated : 'green',
	]);
}

export function deriveRiskActionStateTone(risk: Pick<ProjectRisk,
	'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
>, now = new Date()): RiskActionStateTone {
	const assurance = deriveRiskAssuranceTone(risk, now);
	if (assurance === 'red') return 'red';
	if (assurance === 'amber') return 'amber';
	return 'green';
}

export function isDashboardActiveRiskStatus(status: unknown): boolean {
	return isActiveRiskStatus(status);
}

export function deriveRiskReferenceTone(risk: Pick<ProjectRisk,
	'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
>, now = new Date()): RiskRagStatus | 'neutral' {
	return isActiveRiskStatus(risk.status) ? deriveRiskActionStateTone(risk, now) : 'neutral';
}

export function riskReferenceStatusLabel(risk: Pick<ProjectRisk,
	'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
>, now = new Date()): string {
	return isActiveRiskStatus(risk.status)
		? riskDisplayLabel(deriveRiskActionStateTone(risk, now))
		: riskLifecycleLabel(risk.status);
}

export function deriveProjectRiskDashboardAssuranceTone(
	risks: Array<Pick<ProjectRisk,
		'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
	>>,
	now = new Date(),
): RiskDashboardAssuranceTone {
	const activeRisks = risks.filter((risk) => isDashboardActiveRiskStatus(risk.status));
	if (activeRisks.length === 0) return 'neutral';
	return deriveRiskAssuranceRollupTone(activeRisks.map((risk) => deriveRiskAssuranceTone(risk, now)));
}

export function deriveRiskRedNarrativeReason(risk: Pick<ProjectRisk,
	'owner_id' | 'actioner_id' | 'review_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact'
>, now = new Date()): string | null {
	const exposure = deriveWatchtowerDefaultRiskExposure(risk.probability, risk.impact);
	if (!risk.owner_id) return 'Owner is missing.';
	if (!risk.actioner_id) return 'Actioner is missing.';
	if (exposure === 'critical' && !trimmedText(risk.mitigation_plan)) return 'Mitigation plan is missing for Critical exposure.';
	if (!trimmedText(risk.contingency_plan)) return 'Contingency plan is missing.';
	if (riskReviewDateIsOverdue(risk.review_date, now)) return 'Review date is overdue.';
	return null;
}

export function getRiskActionStateDrivers(risk: Pick<ProjectRisk,
	'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
>, now = new Date()): RiskActionStateDriver[] {
	if (!isActiveRiskStatus(risk.status)) {
		return [{
			tone: 'neutral',
			message: `${riskLifecycleLabel(risk.status)} risks do not drive active risk action state.`,
		}];
	}

	const exposure = deriveWatchtowerDefaultRiskExposure(risk.probability, risk.impact);
	const review = deriveRiskReviewDateTone(risk.review_date, now);
	const due = dateTone(risk.due_date, now, 'amber', 'No due date');
	const mitigation = trimmedText(risk.mitigation_plan);
	const contingency = trimmedText(risk.contingency_plan);
	const updated = staleUpdateTone(risk.updated_at, now);
	const status = trimmedText(risk.status).toLowerCase();
	const drivers: RiskActionStateDriver[] = [];

	if (!risk.owner_id) drivers.push({ tone: 'red', message: 'Risk owner is missing.' });
	if (actionerTone(risk.status, risk.actioner_id) === 'red') drivers.push({ tone: 'red', message: 'Actioner is missing.' });
	if (review.status === 'overdue') drivers.push({ tone: 'red', message: 'Review date is overdue.' });
	if (review.status === 'missing') drivers.push({ tone: 'amber', message: 'Review date is missing.' });
	if (review.status === 'due-soon') drivers.push({ tone: 'amber', message: 'Review date is due soon.' });
	if (due.tone === 'red') drivers.push({ tone: 'red', message: 'Due date is overdue.' });
	if (due.tone === 'amber') drivers.push({ tone: 'amber', message: 'Due date is missing.' });
	if (!mitigation && exposure === 'critical') drivers.push({ tone: 'red', message: 'Mitigation plan is missing for Critical exposure.' });
	if (!mitigation && (exposure === 'high' || exposure === 'medium')) drivers.push({ tone: 'amber', message: `Mitigation plan is missing for ${riskExposureLabel(exposure)} exposure.` });
	if (!contingency) drivers.push({ tone: 'red', message: 'Contingency plan is missing.' });
	if (status === 'materialised') drivers.push({ tone: 'red', message: 'Lifecycle status is Materialised.' });
	if (status === 'escalated' && (!risk.owner_id || !risk.actioner_id || review.tone !== 'green')) {
		drivers.push({ tone: 'red', message: 'Escalated risks need owner, actioner and current review data.' });
	}
	if (updated === 'red') drivers.push({ tone: 'red', message: 'Risk has not been updated recently.' });
	if (updated === 'amber') drivers.push({ tone: 'amber', message: 'Risk update is getting stale.' });

	return drivers.length > 0
		? drivers
		: [{ tone: 'green', message: 'No current action-state drivers found from exposure, governance data or review cadence.' }];
}

function buildRiskNarrativeDetails(risk: ProjectRisk, actionState: RiskActionStateTone, reason?: string | null): string {
	return compactSentence([
		`Action state: ${riskDisplayLabel(actionState)}.`,
		`Lifecycle status: ${riskDisplayLabel(risk.status)}.`,
		reason ? `Reason: ${reason}` : null,
	]);
}

async function createRiskRaisedNarrativeEntry(risk: ProjectRisk, workspaceRole: WorkspaceRole, client, now = new Date()) {
	const actionState = deriveRiskActionStateTone(risk, now);
	return createProjectNarrativeEntry(
		{
			projectId: risk.project_id,
			sourceType: 'risk',
			sourceRecordId: risk.risk_id,
			sourceRef: risk.risk_ref,
			attentionLevel: riskActionStateToNarrativeAttention(actionState),
			title: `${RISK_RAISED_NARRATIVE_PREFIX} ${risk.risk_ref} — ${risk.title}`,
			details: buildRiskNarrativeDetails(risk, actionState),
		},
		workspaceRole,
		client,
	);
}

async function createRiskBecameRedNarrativeEntry(risk: ProjectRisk, workspaceRole: WorkspaceRole, client, now = new Date()) {
	const reason = deriveRiskRedNarrativeReason(risk, now);
	return createProjectNarrativeEntry(
		{
			projectId: risk.project_id,
			sourceType: 'risk',
			sourceRecordId: risk.risk_id,
			sourceRef: risk.risk_ref,
			attentionLevel: 'red',
			title: `${RISK_BECAME_RED_NARRATIVE_PREFIX} ${risk.risk_ref} — ${risk.title}`,
			details: buildRiskNarrativeDetails(risk, 'red', reason),
		},
		workspaceRole,
		client,
	);
}

async function createRiskOpenedNarrativeEntry(risk: ProjectRisk, workspaceRole: WorkspaceRole, client, now = new Date()) {
	const actionState = deriveRiskActionStateTone(risk, now);
	return createProjectNarrativeEntry(
		{
			projectId: risk.project_id,
			sourceType: 'risk',
			sourceRecordId: risk.risk_id,
			sourceRef: risk.risk_ref,
			attentionLevel: riskActionStateToNarrativeAttention(actionState),
			title: `${RISK_OPENED_NARRATIVE_PREFIX} ${risk.risk_ref}`,
			details: `${risk.risk_ref} was opened for active management.`,
		},
		workspaceRole,
		client,
	);
}

async function createRiskClosedNarrativeEntry(risk: ProjectRisk, reason: string | null, workspaceRole: WorkspaceRole, client) {
	return createProjectNarrativeEntry(
		{
			projectId: risk.project_id,
			sourceType: 'risk',
			sourceRecordId: risk.risk_id,
			sourceRef: risk.risk_ref,
			attentionLevel: 'neutral',
			title: `${RISK_CLOSED_NARRATIVE_PREFIX} ${risk.risk_ref}`,
			details: compactSentence([`${risk.risk_ref} was closed.`, reason]),
		},
		workspaceRole,
		client,
	);
}

async function createRiskReopenedNarrativeEntry(risk: ProjectRisk, reason: string | null, workspaceRole: WorkspaceRole, client) {
	return createProjectNarrativeEntry(
		{
			projectId: risk.project_id,
			sourceType: 'risk',
			sourceRecordId: risk.risk_id,
			sourceRef: risk.risk_ref,
			attentionLevel: 'neutral',
			title: `${RISK_REOPENED_NARRATIVE_PREFIX} ${risk.risk_ref}`,
			details: compactSentence([`${risk.risk_ref} was reopened for active management.`, reason]),
		},
		workspaceRole,
		client,
	);
}

async function createRiskLifecycleNote(risk: ProjectRisk, note: string, client) {
	const trimmedNote = note.trim();
	if (!trimmedNote) return null;
	const { data, error } = await client
		.from('project_risk_notes')
		.insert({
			organisation_id: risk.organisation_id,
			project_id: risk.project_id,
			risk_id: risk.risk_id,
			parent_risk_note_id: null,
			note: trimmedNote,
			attention_level: 'green',
		})
		.select(RISK_COMMENT_SELECT)
		.single();

	if (error) throw error;
	return data as ProjectRiskComment;
}

export function getRiskAssuranceBlocks(risk: ProjectRisk, now = new Date()): RiskAssuranceBlock[] {
	const isActiveLifecycle = isActiveRiskStatus(risk.status);
	const lifecycle = riskLifecycleCategory(risk.status);
	const description = trimmedText(risk.description);
	const descriptionTone: RiskAssuranceTone = !isActiveLifecycle ? 'neutral' : !description ? 'red' : description.length < 30 ? 'amber' : 'green';
	const exposure = deriveWatchtowerDefaultRiskExposure(risk.probability, risk.impact);
	const exposureDisplay = getRiskRegisterExposureDisplay(risk);
	const isDraftEstimatedExposure = lifecycle === 'draft' && exposureDisplay.value !== 'unassessed';
	const exposureTitle = lifecycle === 'draft' ? 'Estimated exposure' : 'Exposure';
	const exposureTone = lifecycle === 'draft' ? exposureDisplay.tone : riskExposureTone(exposure);
	const exposureStatusLabel = lifecycle === 'draft' ? exposureDisplay.label : riskExposureLabel(exposure);
	const exposureValue = exposureDisplay.value === 'unassessed'
		? 'No estimated exposure has been recorded for this Draft risk.'
		: isDraftEstimatedExposure
			? `${exposureDisplay.label} estimated exposure. Watchtower default estimate: ${riskDisplayLabel(risk.probability)} probability / ${riskDisplayLabel(risk.impact)} impact`
			: `${riskExposureLabel(exposure)} exposure. Watchtower default assessment: ${riskDisplayLabel(risk.probability)} probability / ${riskDisplayLabel(risk.impact)} impact`;
	const review = deriveRiskReviewDateTone(risk.review_date, now);
	const due = dateTone(risk.due_date, now, 'amber', 'No due date');
	const mitigation = trimmedText(risk.mitigation_plan);
	const contingency = trimmedText(risk.contingency_plan);
	const mitigationTone: RiskAssuranceTone = !isActiveLifecycle ? 'neutral' : mitigation ? 'green' : exposure === 'critical' ? 'red' : exposure === 'high' || exposure === 'medium' ? 'amber' : 'green';
	const contingencyTone: RiskAssuranceTone = !isActiveLifecycle ? 'neutral' : contingency ? 'green' : 'red';
	const actionResponsibilityTone = actionerTone(risk.status, risk.actioner_id);
	const updatedTone = isActiveLifecycle ? staleUpdateTone(risk.updated_at, now) : 'neutral';
	const reviewTone = isActiveLifecycle ? review.tone : 'neutral';
	const dueTone = isActiveLifecycle ? due.tone : 'neutral';
	const ownerTone: RiskAssuranceTone = !isActiveLifecycle ? 'neutral' : risk.owner_id ? 'green' : 'red';

	return [
		{
			id: 'description',
			title: 'Summary',
			tone: descriptionTone,
			statusLabel: riskAssuranceToneLabel(descriptionTone),
			value: description || 'No description recorded.',
			prompt: !description ? 'Add description' : descriptionTone === 'amber' ? 'Strengthen description' : undefined,
		},
		{
			id: 'status',
			title: 'Lifecycle status',
			tone: lifecycleStatusTone(risk.status),
			statusLabel: riskAssuranceToneLabel(lifecycleStatusTone(risk.status)),
			value: `${riskLifecycleLabel(risk.status)} / ${riskDisplayLabel(risk.status)}`,
			prompt: lifecycleStatusTone(risk.status) === 'red' ? 'Review status' : lifecycleStatusTone(risk.status) === 'amber' ? 'Confirm status' : undefined,
		},
		{
			id: 'exposure',
			title: exposureTitle,
			tone: exposureTone,
			statusLabel: exposureStatusLabel,
			value: exposureValue,
			prompt: exposureDisplay.value === 'unassessed' ? 'Estimate exposure' : exposure === 'critical' ? 'Review exposure' : undefined,
		},
		{
			id: 'owner',
			title: 'Risk owner',
			tone: ownerTone,
			statusLabel: riskAssuranceToneLabel(ownerTone),
			value: riskProfileName(risk.owner, 'Unassigned'),
			prompt: risk.owner_id || !isActiveLifecycle ? undefined : 'Set owner',
		},
		{
			id: 'actioner',
			title: 'Action responsibility',
			tone: actionResponsibilityTone,
			statusLabel: actionerToneLabel(actionResponsibilityTone),
			value: actionerValue(risk, actionResponsibilityTone),
			prompt: risk.actioner_id ? 'Change actioner' : actionResponsibilityTone === 'neutral' ? undefined : 'Assign actioner',
		},
		{
			id: 'review-date',
			title: 'Review cadence',
			tone: reviewTone,
			statusLabel: riskAssuranceToneLabel(reviewTone),
			value: review.value,
			prompt: review.status === 'overdue'
				? 'Update review date'
				: review.status === 'missing'
					? 'Add review date'
					: review.status === 'due-soon'
						? 'Review risk soon'
						: undefined,
		},
		{
			id: 'due-date',
			title: 'Due date',
			tone: dueTone,
			statusLabel: riskAssuranceToneLabel(dueTone),
			value: due.value,
			prompt: dueTone === 'red' ? 'Review due date' : undefined,
		},
		{
			id: 'mitigation',
			title: 'Mitigation plan',
			tone: mitigationTone,
			statusLabel: riskAssuranceToneLabel(mitigationTone),
			value: mitigation || 'No mitigation plan recorded.',
			prompt: mitigation ? undefined : 'Add mitigation plan',
		},
		{
			id: 'contingency',
			title: 'Contingency plan',
			tone: contingencyTone,
			statusLabel: riskAssuranceToneLabel(contingencyTone),
			value: contingency || 'No contingency plan recorded.',
			prompt: contingency ? undefined : 'Add contingency plan',
		},
		{
			id: 'updated',
			title: 'Latest update',
			tone: updatedTone,
			statusLabel: riskAssuranceToneLabel(updatedTone),
			value: updatedTone === 'red' ? 'Stale' : updatedTone === 'amber' ? 'Needs review' : updatedTone === 'green' ? 'Recent' : 'Not available',
			prompt: updatedTone === 'red' || updatedTone === 'amber' ? 'Review risk record' : undefined,
		},
	];
}

export async function listProjectRisks(
	organisationId: string,
	projectId: string,
	workspaceRole: WorkspaceRole,
	client,
): Promise<ProjectRisk[]> {
	assertCan(workspaceRole, 'risk.view', 'Your workspace role does not permit Risk Management access.');

	const { data, error } = await client
		.from('project_risks')
		.select(RISK_SELECT)
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.is('deleted_at', null)
		.is('archived_at', null)
		.order('updated_at', { ascending: false })
		.order('risk_sequence', { ascending: true });

	if (error) throw error;
	return enrichRiskProfiles((data ?? []) as ProjectRisk[], client);
}

export async function getProjectRisk(
	organisationId: string,
	projectId: string,
	riskId: string,
	workspaceRole: WorkspaceRole,
	client,
): Promise<ProjectRisk | null> {
	assertCan(workspaceRole, 'risk.view', 'Your workspace role does not permit Risk Management access.');

	const { data, error } = await client
		.from('project_risks')
		.select(RISK_SELECT)
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.eq('risk_id', riskId)
		.is('deleted_at', null)
		.is('archived_at', null)
		.maybeSingle();

	if (error) throw error;
	const [risk] = await enrichRiskProfiles(data ? [data as ProjectRisk] : [], client);
	return risk ?? null;
}

export async function listProjectRiskComments(
	organisationId: string,
	projectId: string,
	riskId: string,
	workspaceRole: WorkspaceRole,
	client,
): Promise<ProjectRiskComment[]> {
	assertCan(workspaceRole, 'risk.view', 'Your workspace role does not permit Risk Management access.');

	const { data, error } = await client
		.from('project_risk_notes')
		.select(RISK_COMMENT_SELECT)
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.eq('risk_id', riskId)
		.is('parent_risk_note_id', null)
		.is('deleted_at', null)
		.order('created_at', { ascending: false });

	if (error) throw error;
	return enrichRiskCommentProfiles((data ?? []) as ProjectRiskComment[], client);
}

export async function listProjectRisksByIds(
	organisationId: string,
	projectId: string,
	riskIds: string[],
	workspaceRole: WorkspaceRole,
	client,
): Promise<ProjectRisk[]> {
	assertCan(workspaceRole, 'risk.view', 'Your workspace role does not permit Risk Management access.');

	const scopedRiskIds = uniqueValues(riskIds);
	if (scopedRiskIds.length === 0) return [];

	const { data, error } = await client
		.from('project_risks')
		.select(RISK_SELECT)
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.in('risk_id', scopedRiskIds)
		.is('deleted_at', null)
		.is('archived_at', null);

	if (error) throw error;
	return enrichRiskProfiles((data ?? []) as ProjectRisk[], client);
}

export async function listRiskOwnerOptions(
	organisationId: string,
	workspaceRole: WorkspaceRole,
	client,
): Promise<RiskOwnerOption[]> {
	assertCan(workspaceRole, 'risk.view', 'Your workspace role does not permit Risk Management access.');

	const { data: memberships, error: membershipError } = await client
		.from('organisation_members')
		.select('user_id, role')
		.eq('organisation_id', organisationId)
		.eq('status', 'active')
		.order('joined_at', { ascending: true, nullsFirst: false })
		.order('created_at', { ascending: true });

	if (membershipError) throw membershipError;

	const memberRows = memberships ?? [];
	const memberIds = uniqueValues(memberRows.map((membership) => membership.user_id));
	const profilesById = new Map<string, RiskProfile>();

	if (memberIds.length > 0) {
		try {
			const { data: profiles } = await client
				.from('profiles')
				.select('id, display_name, email')
				.in('id', memberIds);
			for (const profile of profiles ?? []) {
				profilesById.set(profile.id, profile);
			}
		} catch {
			// Member IDs are enough for safe assignment; profile labels are best-effort enrichment.
		}
	}

	return memberRows.map((membership) => {
		const profile = profilesById.get(membership.user_id);
		return {
			id: membership.user_id,
			display_name: profile?.display_name ?? null,
			email: profile?.email ?? null,
			role: membership.role,
		};
	});
}

async function assertActiveRiskMember(
	organisationId: string,
	memberId: string | null,
	client,
	fieldLabel = 'workspace member',
): Promise<void> {
	if (!memberId) return;
	const { data, error } = await client
		.from('organisation_members')
		.select('user_id')
		.eq('organisation_id', organisationId)
		.eq('user_id', memberId)
		.eq('status', 'active')
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	if (!data) throw new Error(`Select an active workspace member as ${fieldLabel}.`);
}

async function resolveScopedRiskProject(
	workspaceSlug: string,
	projectSlug: string,
	permission: 'risk.create' | 'risk.edit',
	client,
	accessToken?: string,
) {
	const workspace = await getWorkspaceBySlug(client, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation) throw new Error('Project not found or you do not have access.');
	assertCan(workspace.role, permission, permission === 'risk.create'
		? 'Your workspace role does not permit risk creation.'
		: 'Your workspace role does not permit risk editing.');

	const { data: project, error } = await client
		.from('projects')
		.select('id, name, project_ref, slug')
		.eq('slug', projectSlug)
		.eq('organisation_id', organisation.id)
		.is('deleted_at', null)
		.is('archived_at', null)
		.maybeSingle();

	if (error) throw error;
	if (!project) throw new Error('Project not found or you do not have access.');
	if (!isValidRiskProjectRef(project.project_ref)) {
		throw new Error('This project needs a valid project reference before risks can be created.');
	}

	return { workspace, organisation, project };
}

async function getNextRiskSequence(organisationId: string, projectId: string, client): Promise<number> {
	const { data, error } = await client
		.from('project_risks')
		.select('risk_sequence')
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.order('risk_sequence', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	return Number(data?.risk_sequence ?? 0) + 1;
}

async function getAuthenticatedRiskUserId(client): Promise<string | null> {
	const { data, error } = await client.auth.getUser();
	if (error) throw error;
	return data?.user?.id ?? null;
}

function activationBlockedMessage(missing: RiskActivationRequirement[]): string {
	const labels = missing.map((requirement) => requirement.label).join(', ');
	return labels
		? `Draft risk cannot be activated until these fields are complete: ${labels}.`
		: 'Draft risk cannot be activated until the minimum activation information is complete.';
}

async function assertDraftActivationAllowed(
	existingRisk: ProjectRisk,
	nextRisk: ProjectRisk,
	organisationId: string,
	client,
	now = new Date(),
): Promise<void> {
	if (riskLifecycleCategory(existingRisk.status) !== 'draft') return;

	const nextLifecycle = riskLifecycleCategory(nextRisk.status);
	if (nextLifecycle === 'draft') return;
	if (nextLifecycle === 'closed') {
		throw new RiskActivationError('Draft risks cannot be closed before activation.', [
			riskActivationRequirement('activation_path', 'Activation path', 'Activate the Draft risk before closure.'),
		]);
	}
	if (nextRisk.status !== 'open') {
		throw new RiskActivationError('Draft risks must be activated as Open before moving to another active status.', [
			riskActivationRequirement('activation_path', 'Activation path', 'Activate the Draft risk as Open before using another active status.'),
		]);
	}

	await assertActiveRiskMember(organisationId, nextRisk.owner_id ?? null, client, 'risk owner');
	const readiness = getRiskActivationReadiness(nextRisk, { now });
	if (!readiness.ready) throw new RiskActivationError(activationBlockedMessage(readiness.missing), readiness.missing);
}

function normaliseRiskPayload(
	input: RiskFormInput,
	now = new Date(),
	options: { assessmentCompletedBy?: string | null; clearAssessment?: boolean } = {},
) {
	const probability = RISK_LEVELS.includes(input.probability as RiskLevel) ? input.probability as RiskLevel : 'medium';
	const impact = RISK_LEVELS.includes(input.impact as RiskLevel) ? input.impact as RiskLevel : 'medium';
	const payload = {
		title: input.title.trim(),
		description: input.description?.trim() || null,
		status: input.status as RiskStatus,
		probability,
		impact,
		owner_id: input.ownerId?.trim() || null,
		actioner_id: input.actionerId?.trim() || null,
		review_date: input.reviewDate?.trim() || null,
		due_date: input.dueDate?.trim() || null,
		mitigation_plan: input.mitigationPlan?.trim() || null,
		contingency_plan: input.contingencyPlan?.trim() || null,
	};
	const normalised = {
		...payload,
		rag_status: isActiveRiskStatus(payload.status)
			? deriveRiskActionStateTone({
				...payload,
				updated_at: now.toISOString(),
			})
			: 'blue',
	};
	if (options.assessmentCompletedBy) {
		return {
			...normalised,
			assessment_completed_at: now.toISOString(),
			assessment_completed_by: options.assessmentCompletedBy,
		};
	}
	if (options.clearAssessment) {
		return {
			...normalised,
			assessment_completed_at: null,
			assessment_completed_by: null,
		};
	}
	return normalised;
}

async function insertProjectRiskWithGeneratedReference(
	organisationId: string,
	projectId: string,
	projectRef: string,
	payload: ReturnType<typeof normaliseRiskPayload> & { source_risk_prompt_id?: string | null },
	client,
): Promise<ProjectRisk> {
	for (let attempt = 1; attempt <= MAX_RISK_REF_INSERT_ATTEMPTS; attempt += 1) {
		const riskSequence = await getNextRiskSequence(organisationId, projectId, client);
		const riskRef = buildRiskReference(projectRef, riskSequence);
		const { data, error } = await client
			.from('project_risks')
			.insert({
				organisation_id: organisationId,
				project_id: projectId,
				risk_ref: riskRef,
				risk_sequence: riskSequence,
				...payload,
			})
			.select(RISK_SELECT)
			.single();

		if (!error) return data as ProjectRisk;
		if (isRiskRefConstraintViolation(error) && attempt < MAX_RISK_REF_INSERT_ATTEMPTS) continue;
		throw error;
	}

	throw new Error('Watchtower could not assign a unique risk reference. Please try again.');
}

export async function createProjectRisk(
	workspaceSlug: string,
	projectSlug: string,
	input: RiskFormInput,
	client,
	accessToken?: string,
): Promise<ProjectRisk> {
	const draftInput = { ...input, status: 'draft' };
	const errors = validateRiskFormInput(draftInput, { mode: 'create' });
	if (Object.keys(errors).length > 0) throw new Error(Object.values(errors)[0]);

	const { workspace, organisation, project } = await resolveScopedRiskProject(workspaceSlug, projectSlug, 'risk.create', client, accessToken);
	const ownerId = draftInput.ownerId?.trim() || null;
	const actionerId = draftInput.actionerId?.trim() || null;
	await assertActiveRiskMember(organisation.id, ownerId, client, 'risk owner');
	await assertActiveRiskMember(organisation.id, actionerId, client, 'risk actioner');
	const eventTime = new Date();
	const assessmentCompletedBy = hasSubmittedRiskAssessment(draftInput)
		? await getAuthenticatedRiskUserId(client)
		: null;
	const risk = await insertProjectRiskWithGeneratedReference(
		organisation.id,
		project.id,
		project.project_ref,
		normaliseRiskPayload({ ...draftInput, ownerId, actionerId }, eventTime, { assessmentCompletedBy }),
		client,
	);
	if (isActiveRiskStatus(risk.status)) {
		await createRiskRaisedNarrativeEntry(risk, workspace.role, client, eventTime);
	}
	const [enrichedRisk] = await enrichRiskProfiles([risk], client);
	return enrichedRisk;
}

async function planDraftProjectRisksFromPrompts(
	workspaceSlug: string,
	projectSlug: string,
	riskPromptIds: string[],
	client,
	accessToken?: string,
): Promise<{
	organisationId: string;
	projectId: string;
	projectRef: string;
	requestedPromptIds: string[];
	preflight: DraftRiskPromptPreflightResult;
}> {
	const requestedPromptIds = uniqueValues(riskPromptIds.map((riskPromptId) => trimmedText(riskPromptId)));
	if (requestedPromptIds.length === 0) throw new Error('Select at least one risk prompt.');

	const { organisation, project } = await resolveScopedRiskProject(workspaceSlug, projectSlug, 'risk.create', client, accessToken);

	const { data: library, error: libraryError } = await client
		.from('risk_prompt_libraries')
		.select('id')
		.eq('is_default', true)
		.eq('is_active', true)
		.order('risk_library_version', { ascending: false })
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (libraryError) throw libraryError;
	if (!library) throw new Error('The Watchtower Default Risk Prompt Library is not currently available.');

	const { data: activeAreas, error: areaError } = await client
		.from('risk_prompt_areas')
		.select('id')
		.eq('risk_prompt_library_id', library.id)
		.eq('is_active', true);
	if (areaError) throw areaError;
	const activeAreaIds = new Set((activeAreas ?? []).map((area) => area.id));
	if (activeAreaIds.size === 0) throw new Error('No active risk prompt areas are available.');

	const { data: prompts, error: promptError } = await client
		.from('risk_prompts')
		.select('id, risk_prompt_area_id, risk_prompt_id, risk_prompt_title, risk_prompt_guidance, risk_default_status')
		.eq('risk_prompt_library_id', library.id)
		.eq('risk_prompt_is_active', true)
		.order('risk_prompt_order', { ascending: true })
		.order('risk_prompt_id', { ascending: true })
		.in('risk_prompt_id', requestedPromptIds);
	if (promptError) throw promptError;

	const eligiblePrompts = (prompts ?? []).filter((prompt) =>
		activeAreaIds.has(prompt.risk_prompt_area_id) && prompt.risk_default_status === 'draft',
	);

	const sourcePromptIds = eligiblePrompts.map((prompt) => prompt.id);
	const duplicates = sourcePromptIds.length > 0
		? await client
			.from('project_risks')
			.select('risk_id, risk_ref, title, source_risk_prompt_id')
			.eq('organisation_id', organisation.id)
			.eq('project_id', project.id)
			.is('deleted_at', null)
			.is('archived_at', null)
			.in('source_risk_prompt_id', sourcePromptIds)
		: { data: [], error: null };
	if (duplicates.error) throw duplicates.error;

	const duplicateRisksBySourcePromptId = new Map((duplicates.data ?? [])
		.filter((risk) => Boolean(risk.source_risk_prompt_id))
		.map((risk) => [risk.source_risk_prompt_id, risk]));
	const duplicateSourcePromptIds = new Set((duplicates.data ?? [])
		.map((risk) => risk.source_risk_prompt_id)
		.filter((value): value is string => Boolean(value)));
	const duplicatePrompts = eligiblePrompts
		.filter((prompt) => duplicateSourcePromptIds.has(prompt.id))
		.map((prompt) => {
			const existingRisk = duplicateRisksBySourcePromptId.get(prompt.id);
			return {
				riskPromptId: prompt.risk_prompt_id,
				sourceRiskPromptId: prompt.id,
				title: prompt.risk_prompt_title,
				existingRiskId: existingRisk?.risk_id ?? '',
				existingRiskRef: existingRisk?.risk_ref ?? '',
				existingRiskTitle: existingRisk?.title ?? prompt.risk_prompt_title,
			};
		});
	const createablePrompts = eligiblePrompts
		.filter((prompt) => !duplicateSourcePromptIds.has(prompt.id))
		.map((prompt) => ({
			riskPromptId: prompt.risk_prompt_id,
			sourceRiskPromptId: prompt.id,
			title: prompt.risk_prompt_title,
			guidance: prompt.risk_prompt_guidance ?? null,
		}));

	return {
		organisationId: organisation.id,
		projectId: project.id,
		projectRef: project.project_ref,
		requestedPromptIds,
		preflight: {
			requestedCount: requestedPromptIds.length,
			selectedPromptCount: requestedPromptIds.length,
			eligiblePromptCount: eligiblePrompts.length,
			createableCount: createablePrompts.length,
			duplicateCount: duplicatePrompts.length,
			invalidPromptCount: Math.max(0, requestedPromptIds.length - eligiblePrompts.length),
			createablePrompts,
			duplicatePrompts,
		},
	};
}

export async function preflightDraftProjectRisksFromPrompts(
	workspaceSlug: string,
	projectSlug: string,
	riskPromptIds: string[],
	client,
	accessToken?: string,
): Promise<DraftRiskPromptPreflightResult> {
	const plan = await planDraftProjectRisksFromPrompts(workspaceSlug, projectSlug, riskPromptIds, client, accessToken);
	return plan.preflight;
}

export async function createDraftProjectRisksFromPrompts(
	workspaceSlug: string,
	projectSlug: string,
	riskPromptIds: string[],
	client,
	accessToken?: string,
): Promise<CreateDraftRisksFromPromptsResult> {
	const plan = await planDraftProjectRisksFromPrompts(workspaceSlug, projectSlug, riskPromptIds, client, accessToken);
	const createdRisks: ProjectRisk[] = [];
	let skippedDuplicateCount = plan.preflight.duplicateCount;
	const eventTime = new Date();

	for (const prompt of plan.preflight.createablePrompts) {
		try {
			const risk = await insertProjectRiskWithGeneratedReference(
				plan.organisationId,
				plan.projectId,
				plan.projectRef,
				{
					...normaliseRiskPayload({
						title: prompt.title,
						description: prompt.guidance ?? '',
						status: 'draft',
						probability: 'medium',
						impact: 'medium',
						ownerId: '',
						actionerId: '',
						reviewDate: '',
						dueDate: '',
						mitigationPlan: '',
						contingencyPlan: '',
					}, eventTime),
					source_risk_prompt_id: prompt.sourceRiskPromptId,
				},
				client,
			);
			createdRisks.push(risk);
		} catch (error) {
			if (isSourcePromptConstraintViolation(error as DatabaseError)) {
				skippedDuplicateCount += 1;
				continue;
			}
			throw error;
		}
	}

	const enrichedRisks = await enrichRiskProfiles(createdRisks, client);
	return {
		requestedCount: plan.preflight.requestedCount,
		eligiblePromptCount: plan.preflight.eligiblePromptCount,
		invalidPromptCount: plan.preflight.invalidPromptCount,
		createdCount: enrichedRisks.length,
		skippedDuplicateCount,
		createdRisks: enrichedRisks,
	};
}

export async function updateProjectRisk(
	workspaceSlug: string,
	projectSlug: string,
	riskId: string,
	input: RiskFormInput,
	client,
	accessToken?: string,
): Promise<ProjectRisk> {
	const { workspace, organisation, project } = await resolveScopedRiskProject(workspaceSlug, projectSlug, 'risk.edit', client, accessToken);
	const ownerId = input.ownerId?.trim() || null;
	const actionerId = input.actionerId?.trim() || null;
	const eventTime = new Date();

	const { data: existingRiskData, error: existingRiskError } = await client
		.from('project_risks')
		.select(RISK_SELECT)
		.eq('organisation_id', organisation.id)
		.eq('project_id', project.id)
		.eq('risk_id', riskId)
		.is('deleted_at', null)
		.is('archived_at', null)
		.maybeSingle();

	if (existingRiskError) throw existingRiskError;
	if (!existingRiskData) throw new Error('Risk not found or you do not have access.');
	const existingRisk = existingRiskData as ProjectRisk;
	const validationMode = riskLifecycleCategory(existingRisk.status) === 'draft' ? 'draft' : 'edit';
	const isExistingDraft = validationMode === 'draft';
	const errors = validateRiskFormInput(input, { mode: validationMode });
	if (Object.keys(errors).length > 0) throw new Error(Object.values(errors)[0]);
	await assertActiveRiskMember(organisation.id, ownerId, client, 'risk owner');
	await assertActiveRiskMember(organisation.id, actionerId, client, 'risk actioner');

	const assessmentCompletedBy = isExistingDraft && hasSubmittedRiskAssessment(input)
		? await getAuthenticatedRiskUserId(client)
		: null;
	const nextPayload = normaliseRiskPayload({ ...input, ownerId, actionerId }, eventTime, {
		assessmentCompletedBy,
		clearAssessment: isExistingDraft && !hasSubmittedRiskAssessment(input),
	});
	const proposedRisk = {
		...existingRisk,
		...nextPayload,
		updated_at: eventTime.toISOString(),
	} as ProjectRisk;
	await assertDraftActivationAllowed(existingRisk, proposedRisk, organisation.id, client, eventTime);
	const previousActionState = deriveRiskActionStateTone(existingRisk, eventTime);

	const { data, error } = await client
		.from('project_risks')
		.update(nextPayload)
		.eq('organisation_id', organisation.id)
		.eq('project_id', project.id)
		.eq('risk_id', riskId)
		.is('deleted_at', null)
		.is('archived_at', null)
		.select(RISK_SELECT)
		.maybeSingle();

	if (error) throw error;
	if (!data) throw new Error('Risk not found or you do not have access.');
	const nextActionState = deriveRiskActionStateTone(data as ProjectRisk, eventTime);
	const previousLifecycle = riskLifecycleCategory(existingRisk.status);
	const nextLifecycle = riskLifecycleCategory((data as ProjectRisk).status);
	if (previousLifecycle === 'draft' && nextLifecycle === 'active') {
		await createRiskOpenedNarrativeEntry(data as ProjectRisk, workspace.role, client, eventTime);
	} else if (previousLifecycle === 'active' && nextLifecycle === 'closed') {
		await createRiskClosedNarrativeEntry(data as ProjectRisk, null, workspace.role, client);
	} else if (previousLifecycle === 'closed' && nextLifecycle === 'active') {
		await createRiskReopenedNarrativeEntry(data as ProjectRisk, null, workspace.role, client);
	} else if (nextLifecycle === 'active' && !isRedRiskActionState(previousActionState) && isRedRiskActionState(nextActionState)) {
		await createRiskBecameRedNarrativeEntry(data as ProjectRisk, workspace.role, client, eventTime);
	}
	const [risk] = await enrichRiskProfiles([data as ProjectRisk], client);
	return risk;
}

export async function transitionProjectRiskLifecycle(
	workspaceSlug: string,
	projectSlug: string,
	riskId: string,
	action: string,
	reason: string | null | undefined,
	client,
	accessToken?: string,
): Promise<ProjectRisk> {
	if (action !== 'open' && action !== 'close' && action !== 'reopen') throw new Error('Select a valid risk lifecycle action.');
	const { workspace, organisation, project } = await resolveScopedRiskProject(workspaceSlug, projectSlug, 'risk.edit', client, accessToken);
	const existingRisk = await getProjectRisk(organisation.id, project.id, riskId, workspace.role, client);
	if (!existingRisk) throw new Error('Risk not found or you do not have access.');

	const currentLifecycle = riskLifecycleCategory(existingRisk.status);
	const nextStatus = action === 'close' ? 'closed' : 'open';
	if (action === 'open' && currentLifecycle !== 'draft') throw new Error('Only draft risks can be opened.');
	if (action === 'close' && currentLifecycle !== 'active') throw new Error('Only active risks can be closed.');
	if (action === 'reopen' && currentLifecycle !== 'closed') throw new Error('Only closed risks can be reopened.');

	const eventTime = new Date();
	if (action === 'open') {
		await assertDraftActivationAllowed(
			existingRisk,
			{ ...existingRisk, status: nextStatus, updated_at: eventTime.toISOString() },
			organisation.id,
			client,
			eventTime,
		);
	}
	const nextPayload = {
		status: nextStatus,
		rag_status: deriveRiskActionStateTone({ ...existingRisk, status: nextStatus, updated_at: eventTime.toISOString() }, eventTime),
	};
	const { data, error } = await client
		.from('project_risks')
		.update(nextPayload)
		.eq('organisation_id', organisation.id)
		.eq('project_id', project.id)
		.eq('risk_id', riskId)
		.is('deleted_at', null)
		.is('archived_at', null)
		.select(RISK_SELECT)
		.maybeSingle();

	if (error) throw error;
	if (!data) throw new Error('Risk not found or you do not have access.');

	const updatedRisk = data as ProjectRisk;
	const trimmedReason = trimmedText(reason);
	if (trimmedReason) {
		const notePrefix = action === 'close' ? 'Closure note' : action === 'reopen' ? 'Reopen note' : 'Open note';
		await createRiskLifecycleNote(updatedRisk, `${notePrefix}: ${trimmedReason}`, client);
	}
	if (action === 'open') await createRiskOpenedNarrativeEntry(updatedRisk, workspace.role, client, eventTime);
	if (action === 'close') await createRiskClosedNarrativeEntry(updatedRisk, trimmedReason || null, workspace.role, client);
	if (action === 'reopen') await createRiskReopenedNarrativeEntry(updatedRisk, trimmedReason || null, workspace.role, client);

	const [risk] = await enrichRiskProfiles([updatedRisk], client);
	return risk;
}

export async function createProjectRiskComment(
	workspaceSlug: string,
	projectSlug: string,
	riskId: string,
	note: string,
	client,
	accessToken?: string,
): Promise<ProjectRiskComment> {
	const trimmedNote = note.trim();
	if (!trimmedNote) throw new Error('Comment is required.');

	const { workspace, organisation, project } = await resolveScopedRiskProject(workspaceSlug, projectSlug, 'risk.edit', client, accessToken);
	const risk = await getProjectRisk(organisation.id, project.id, riskId, workspace.role, client);
	if (!risk) throw new Error('Risk not found or you do not have access.');

	const { data, error } = await client
		.from('project_risk_notes')
		.insert({
			organisation_id: organisation.id,
			project_id: project.id,
			risk_id: riskId,
			parent_risk_note_id: null,
			note: trimmedNote,
			attention_level: 'green',
		})
		.select(RISK_COMMENT_SELECT)
		.single();

	if (error) throw error;
	const [comment] = await enrichRiskCommentProfiles([data as ProjectRiskComment], client);
	return comment;
}
