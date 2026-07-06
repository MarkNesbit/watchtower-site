import { assertCan, type WorkspaceRole } from './permissions.ts';
import { createProjectNarrativeEntry } from './projectNarrative.ts';
import { getWorkspaceBySlug } from './projects.ts';

export const RISK_STATUSES = ['draft', 'open', 'monitoring', 'mitigating', 'escalated', 'materialised', 'closed'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];
export const DRAFT_RISK_STATUSES = ['draft'] as const;
export const ACTIVE_RISK_STATUSES = ['open', 'monitoring', 'mitigating', 'escalated', 'materialised'] as const;
export const CLOSED_RISK_STATUSES = ['accepted', 'closed', 'resolved'] as const;
export const DASHBOARD_ACTIVE_RISK_STATUSES = ACTIVE_RISK_STATUSES;
export type RiskLifecycleCategory = 'draft' | 'active' | 'closed';
export type RiskLifecycleTone = 'green' | 'neutral';

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_RAG_STATUSES = ['blue', 'green', 'amber', 'red'] as const;
export type RiskRagStatus = (typeof RISK_RAG_STATUSES)[number];
export type RiskAssuranceTone = 'green' | 'amber' | 'red' | 'neutral';
export type RiskActionStateTone = 'green' | 'amber' | 'red';
export type RiskDashboardAssuranceTone = RiskAssuranceTone;

const RISK_SEQUENCE_CONSTRAINT = 'project_risks_project_sequence_key';
const RISK_REF_CONSTRAINT = 'project_risks_project_ref_key';
const RISK_ORGANISATION_REF_CONSTRAINT = 'project_risks_organisation_ref_key';
const MAX_RISK_REF_INSERT_ATTEMPTS = 3;

export type RiskProfile = {
	id: string;
	display_name?: string | null;
	email?: string | null;
};

export type ProjectRisk = {
	risk_id: string;
	organisation_id: string;
	project_id: string;
	risk_ref: string;
	risk_sequence: number;
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
	tone: RiskAssuranceTone;
	statusLabel: string;
	value: string;
	prompt?: string;
};

export type RiskActionStateDriver = {
	tone: RiskAssuranceTone;
	message: string;
};

export type RiskOwnerOption = RiskProfile & {
	role?: WorkspaceRole | string;
};

export type RiskFormInput = {
	title: string;
	description?: string;
	status: string;
	probability?: string;
	impact?: string;
	ragStatus?: string;
	ownerId?: string;
	actionerId?: string;
	reviewDate?: string;
	dueDate?: string;
	mitigationPlan?: string;
	contingencyPlan?: string;
};

type DatabaseError = { code?: string; message?: string; details?: string; hint?: string };

const RISK_SELECT = [
	'risk_id',
	'organisation_id',
	'project_id',
	'risk_ref',
	'risk_sequence',
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

export function validateRiskFormInput(input: RiskFormInput): Record<string, string> {
	const errors: Record<string, string> = {};
	if (!input.title.trim()) errors.title = 'Risk title is required.';
	if (!isRiskStatus(input.status)) errors.status = 'Select a valid risk status.';
	if (!RISK_LEVELS.includes(input.probability as RiskLevel)) errors.probability = 'Select a valid probability.';
	if (!RISK_LEVELS.includes(input.impact as RiskLevel)) errors.impact = 'Select a valid impact.';
	if (!isRiskReviewDate(input.reviewDate)) errors.reviewDate = 'Enter a valid review date.';
	if (!isRiskReviewDate(input.dueDate)) errors.dueDate = 'Enter a valid due date.';
	return errors;
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

export function riskDisplayLabel(value: unknown, fallback = 'Unknown'): string {
	if (typeof value !== 'string' || !value.trim()) return fallback;
	return value
		.split(/[_\s-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
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

function dateTone(value: unknown, now: Date, missingTone: RiskAssuranceTone, missingValue: string) {
	const date = parseUtcDate(value);
	if (!date) return { tone: missingTone, value: missingValue };
	return date < startOfUtcDay(now)
		? { tone: 'red' as RiskAssuranceTone, value: 'Overdue' }
		: { tone: 'green' as RiskAssuranceTone, value: 'Scheduled' };
}

function riskReviewDateIsOverdue(value: unknown, now: Date): boolean {
	const date = parseUtcDate(value);
	return Boolean(date && date < startOfUtcDay(now));
}

export function deriveWatchtowerDefaultRiskExposureTone(probability: unknown, impact: unknown): RiskAssuranceTone {
	if (!RISK_LEVELS.includes(probability as RiskLevel) || !RISK_LEVELS.includes(impact as RiskLevel)) return 'red';
	if (probability === 'high' && impact === 'high') return 'red';
	if (probability === 'low' && impact === 'low') return 'green';
	if (
		(probability === 'medium' && impact === 'high') ||
		(probability === 'high' && impact === 'medium')
	) return 'red';
	if (probability === 'high' || impact === 'high' || probability === 'medium' || impact === 'medium') return 'amber';
	return 'green';
}

export function deriveRiskExposureTone(probability: unknown, impact: unknown): RiskAssuranceTone {
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

function worstTone(tones: RiskAssuranceTone[]): RiskAssuranceTone {
	if (tones.includes('red')) return 'red';
	if (tones.includes('amber')) return 'amber';
	if (tones.includes('green')) return 'green';
	return 'neutral';
}

export function deriveRiskAssuranceTone(risk: Pick<ProjectRisk,
	'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
>, now = new Date()): RiskAssuranceTone {
	if (!isActiveRiskStatus(risk.status)) return 'neutral';
	const exposure = deriveWatchtowerDefaultRiskExposureTone(risk.probability, risk.impact);
	const status = trimmedText(risk.status).toLowerCase();
	const review = dateTone(risk.review_date, now, 'amber', 'No review date');
	const due = dateTone(risk.due_date, now, 'amber', 'No due date');
	const mitigation = trimmedText(risk.mitigation_plan);
	const contingency = trimmedText(risk.contingency_plan);
	const missingMitigationTone: RiskAssuranceTone = mitigation ? 'green' : exposure === 'red' ? 'red' : exposure === 'amber' ? 'amber' : 'green';
	const updated = staleUpdateTone(risk.updated_at, now);
	const statusTone: RiskAssuranceTone = status === 'materialised'
		? 'red'
		: status === 'escalated' && (!risk.owner_id || !risk.actioner_id || review.tone !== 'green')
		? 'red'
		: 'green';

	return worstTone([
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
	const exposure = deriveWatchtowerDefaultRiskExposureTone(risk.probability, risk.impact);
	const assurance = deriveRiskAssuranceTone(risk, now);
	if (assurance === 'red' || exposure === 'red') return 'red';
	if (assurance === 'amber' || exposure === 'amber') return 'amber';
	return 'green';
}

export function deriveRiskConcernTone(risk: Pick<ProjectRisk,
	'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
>, now = new Date()): RiskRagStatus {
	return deriveRiskActionStateTone(risk, now);
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
	return worstTone(activeRisks.map((risk) => deriveRiskAssuranceTone(risk, now)));
}

export function deriveRiskRedNarrativeReason(risk: Pick<ProjectRisk,
	'owner_id' | 'actioner_id' | 'review_date' | 'contingency_plan' | 'probability' | 'impact'
>, now = new Date()): string | null {
	if (deriveRiskExposureTone(risk.probability, risk.impact) === 'red') return 'Exposure is Red.';
	if (!risk.owner_id) return 'Owner is missing.';
	if (!risk.actioner_id) return 'Actioner is missing.';
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

	const exposure = deriveWatchtowerDefaultRiskExposureTone(risk.probability, risk.impact);
	const review = dateTone(risk.review_date, now, 'amber', 'No review date');
	const due = dateTone(risk.due_date, now, 'amber', 'No due date');
	const mitigation = trimmedText(risk.mitigation_plan);
	const contingency = trimmedText(risk.contingency_plan);
	const updated = staleUpdateTone(risk.updated_at, now);
	const status = trimmedText(risk.status).toLowerCase();
	const drivers: RiskActionStateDriver[] = [];

	if (exposure === 'red' || exposure === 'amber') {
		drivers.push({
			tone: exposure,
			message: `Exposure is ${riskAssuranceToneLabel(exposure)} using the Watchtower default assessment.`,
		});
	}
	if (!risk.owner_id) drivers.push({ tone: 'red', message: 'Risk owner is missing.' });
	if (actionerTone(risk.status, risk.actioner_id) === 'red') drivers.push({ tone: 'red', message: 'Actioner is missing.' });
	if (review.tone === 'red') drivers.push({ tone: 'red', message: 'Review date is overdue.' });
	if (review.tone === 'amber') drivers.push({ tone: 'amber', message: 'Review date is missing.' });
	if (due.tone === 'red') drivers.push({ tone: 'red', message: 'Due date is overdue.' });
	if (due.tone === 'amber') drivers.push({ tone: 'amber', message: 'Due date is missing.' });
	if (!mitigation && exposure === 'red') drivers.push({ tone: 'red', message: 'Mitigation plan is missing for Red exposure.' });
	if (!mitigation && exposure === 'amber') drivers.push({ tone: 'amber', message: 'Mitigation plan is missing for Amber exposure.' });
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
	const description = trimmedText(risk.description);
	const descriptionTone: RiskAssuranceTone = !isActiveLifecycle ? 'neutral' : !description ? 'red' : description.length < 30 ? 'amber' : 'green';
	const exposure = deriveWatchtowerDefaultRiskExposureTone(risk.probability, risk.impact);
	const review = dateTone(risk.review_date, now, 'amber', 'No review date');
	const due = dateTone(risk.due_date, now, 'amber', 'No due date');
	const mitigation = trimmedText(risk.mitigation_plan);
	const contingency = trimmedText(risk.contingency_plan);
	const mitigationTone: RiskAssuranceTone = !isActiveLifecycle ? 'neutral' : mitigation ? 'green' : exposure === 'red' ? 'red' : exposure === 'amber' ? 'amber' : 'green';
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
			title: 'Exposure',
			tone: exposure,
			statusLabel: riskAssuranceToneLabel(exposure),
			value: `Watchtower default assessment: ${riskDisplayLabel(risk.probability)} probability / ${riskDisplayLabel(risk.impact)} impact`,
			prompt: exposure === 'red' ? 'Review exposure' : undefined,
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
			prompt: reviewTone === 'red' ? 'Update review date' : reviewTone === 'amber' ? 'Add review date' : undefined,
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

function normaliseRiskPayload(input: RiskFormInput, now = new Date()) {
	const payload = {
		title: input.title.trim(),
		description: input.description?.trim() || null,
		status: input.status as RiskStatus,
		probability: input.probability as RiskLevel,
		impact: input.impact as RiskLevel,
		owner_id: input.ownerId?.trim() || null,
		actioner_id: input.actionerId?.trim() || null,
		review_date: input.reviewDate?.trim() || null,
		due_date: input.dueDate?.trim() || null,
		mitigation_plan: input.mitigationPlan?.trim() || null,
		contingency_plan: input.contingencyPlan?.trim() || null,
	};
	return {
		...payload,
		rag_status: deriveRiskActionStateTone({
			...payload,
			updated_at: now.toISOString(),
		}),
	};
}

export async function createProjectRisk(
	workspaceSlug: string,
	projectSlug: string,
	input: RiskFormInput,
	client,
	accessToken?: string,
): Promise<ProjectRisk> {
	const errors = validateRiskFormInput(input);
	if (Object.keys(errors).length > 0) throw new Error(Object.values(errors)[0]);

	const { workspace, organisation, project } = await resolveScopedRiskProject(workspaceSlug, projectSlug, 'risk.create', client, accessToken);
	const ownerId = input.ownerId?.trim() || null;
	const actionerId = input.actionerId?.trim() || null;
	await assertActiveRiskMember(organisation.id, ownerId, client, 'risk owner');
	await assertActiveRiskMember(organisation.id, actionerId, client, 'risk actioner');
	const eventTime = new Date();

	let risk: ProjectRisk | null = null;
	for (let attempt = 1; attempt <= MAX_RISK_REF_INSERT_ATTEMPTS; attempt += 1) {
		const riskSequence = await getNextRiskSequence(organisation.id, project.id, client);
		const riskRef = buildRiskReference(project.project_ref, riskSequence);
		const { data, error } = await client
			.from('project_risks')
			.insert({
				organisation_id: organisation.id,
				project_id: project.id,
				risk_ref: riskRef,
				risk_sequence: riskSequence,
				...normaliseRiskPayload({ ...input, ownerId, actionerId }, eventTime),
			})
			.select(RISK_SELECT)
			.single();

		if (!error) {
			risk = data as ProjectRisk;
			break;
		}
		if (isRiskRefConstraintViolation(error) && attempt < MAX_RISK_REF_INSERT_ATTEMPTS) continue;
		throw error;
	}

	if (!risk) throw new Error('Watchtower could not assign a unique risk reference. Please try again.');
	if (isActiveRiskStatus(risk.status)) {
		await createRiskRaisedNarrativeEntry(risk, workspace.role, client, eventTime);
	}
	const [enrichedRisk] = await enrichRiskProfiles([risk], client);
	return enrichedRisk;
}

export async function updateProjectRisk(
	workspaceSlug: string,
	projectSlug: string,
	riskId: string,
	input: RiskFormInput,
	client,
	accessToken?: string,
): Promise<ProjectRisk> {
	const errors = validateRiskFormInput(input);
	if (Object.keys(errors).length > 0) throw new Error(Object.values(errors)[0]);

	const { workspace, organisation, project } = await resolveScopedRiskProject(workspaceSlug, projectSlug, 'risk.edit', client, accessToken);
	const ownerId = input.ownerId?.trim() || null;
	const actionerId = input.actionerId?.trim() || null;
	await assertActiveRiskMember(organisation.id, ownerId, client, 'risk owner');
	await assertActiveRiskMember(organisation.id, actionerId, client, 'risk actioner');
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
	const previousActionState = deriveRiskActionStateTone(existingRiskData as ProjectRisk, eventTime);

	const { data, error } = await client
		.from('project_risks')
		.update(normaliseRiskPayload({ ...input, ownerId, actionerId }, eventTime))
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
	const previousLifecycle = riskLifecycleCategory((existingRiskData as ProjectRisk).status);
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
