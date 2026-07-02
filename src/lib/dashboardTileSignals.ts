import type { ProjectDateCard } from './projectDates.ts';
import {
	deriveRiskAssuranceTone,
	isDashboardActiveRiskStatus,
	type ProjectRisk,
} from './projectRisks.ts';

export type DashboardTileSignalState = 'red' | 'amber' | 'green' | 'unknown' | 'neutral';
export type ProjectAreaSignalState = DashboardTileSignalState | 'disabled';
export type ProjectAreaKey = 'project_details' | 'project_narrative' | 'risks' | 'timeline' | 'issues' | 'dependencies' | 'assumptions' | 'decisions' | 'actions';

export type ProjectAreaSignalReason = {
	state: Exclude<ProjectAreaSignalState, 'disabled'>;
	message: string;
	target?: string;
	actionLabel?: string;
};

export type ProjectAreaSignal = {
	area: ProjectAreaKey;
	state: ProjectAreaSignalState;
	label: string;
	reasons: ProjectAreaSignalReason[];
};

type ProjectDetailsSignalProject = {
	description?: string | null;
	project_type?: string | null;
	delivery_method?: string | null;
	priority?: string | null;
	criticality?: string | null;
	target_end_date?: string | null;
	next_review_date?: string | null;
	governance_route?: string | null;
	escalation_route?: string | null;
};

type ProjectDetailsSignalAssignment = {
	project_role?: string | null;
	status?: string | null;
	user_id?: string | null;
	demo_person_id?: string | null;
};

type NarrativeReadState = {
	unseenEntries?: number | null;
};

type RiskTileSignalRisk = Pick<ProjectRisk,
	'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
> & Partial<Pick<ProjectRisk, 'risk_ref' | 'title'>>;

function hasText(value: unknown): boolean {
	return typeof value === 'string' && value.trim().length > 0;
}

export function dashboardTileSignalLabel(state: DashboardTileSignalState): string {
	if (state === 'red') return 'Red';
	if (state === 'amber') return 'Amber';
	if (state === 'green') return 'Green';
	if (state === 'neutral') return 'Neutral';
	return 'Unknown';
}

export function dashboardTileSignalStatusLabel(state: DashboardTileSignalState): string {
	if (state === 'red' || state === 'amber' || state === 'green') return `${dashboardTileSignalLabel(state)} attention`;
	if (state === 'neutral') return 'No active attention signals';
	return 'Unknown state';
}

const PROJECT_DETAILS_CRITICAL_FIELDS = [
	{ key: 'description', label: 'Project description', target: '#project-description-heading', actionLabel: 'Review description' },
	{ key: 'target_end_date', label: 'Target end date', target: '#project-dates-heading', actionLabel: 'Review dates' },
	{ key: 'next_review_date', label: 'Review date', target: '#project-dates-heading', actionLabel: 'Review dates' },
] as const;

const PROJECT_DETAILS_IMPORTANT_FIELDS = [
	{ key: 'project_type', label: 'Project type', target: '#project-context-heading', actionLabel: 'Review context' },
	{ key: 'delivery_method', label: 'Delivery method', target: '#project-context-heading', actionLabel: 'Review context' },
	{ key: 'priority', label: 'Priority', target: '#project-context-heading', actionLabel: 'Review context' },
	{ key: 'criticality', label: 'Criticality', target: '#project-context-heading', actionLabel: 'Review context' },
	{ key: 'governance_route', label: 'Governance route', target: '#project-governance-heading', actionLabel: 'Review governance' },
	{ key: 'escalation_route', label: 'Escalation route', target: '#project-governance-heading', actionLabel: 'Review governance' },
] as const;

const PROJECT_DETAILS_IMPORTANT_ASSIGNMENTS = [
	{ role: 'product_owner', label: 'Product Owner' },
	{ role: 'default_risk_owner', label: 'Default Risk Owner' },
] as const;

function hasActiveAssignment(assignments: ProjectDetailsSignalAssignment[], role: string): boolean {
	return assignments.some((assignment) => (
		assignment.project_role === role
		&& assignment.status !== 'removed'
		&& (Boolean(assignment.user_id) || Boolean(assignment.demo_person_id))
	));
}

export function deriveProjectDetailsAreaSignal(
	project: ProjectDetailsSignalProject | null | undefined,
	dateCards: ProjectDateCard[] | null | undefined,
	assignments?: ProjectDetailsSignalAssignment[] | null,
): ProjectAreaSignal {
	if (!project) {
		return {
			area: 'project_details',
			state: 'unknown',
			label: 'Project Details',
			reasons: [{ state: 'unknown', message: 'Project Details attention cannot be calculated safely.' }],
		};
	}

	const reasons: ProjectAreaSignalReason[] = [];
	const resolvedDateCards = dateCards ?? [];

	if (!dateCards) {
		reasons.push({
			state: 'unknown',
			message: 'Project date readiness could not be checked.',
			target: '#project-dates-heading',
			actionLabel: 'Review dates',
		});
	}

	for (const field of PROJECT_DETAILS_CRITICAL_FIELDS) {
		if (!hasText(project[field.key])) {
			reasons.push({
				state: 'red',
				message: `${field.label} is not set.`,
				target: field.target,
				actionLabel: field.actionLabel,
			});
		}
	}

	for (const card of resolvedDateCards) {
		if (card.dateType !== 'start_date' && card.status.tone === 'red') {
			reasons.push({
				state: 'red',
				message: `${card.label}: ${card.status.text}.`,
				target: '#project-dates-heading',
				actionLabel: 'Review dates',
			});
		}
	}

	for (const field of PROJECT_DETAILS_IMPORTANT_FIELDS) {
		if (!hasText(project[field.key])) {
			reasons.push({
				state: 'amber',
				message: `${field.label} is not set.`,
				target: field.target,
				actionLabel: field.actionLabel,
			});
		}
	}

	if (Array.isArray(assignments)) {
		for (const assignment of PROJECT_DETAILS_IMPORTANT_ASSIGNMENTS) {
			if (!hasActiveAssignment(assignments, assignment.role)) {
				reasons.push({
					state: 'amber',
					message: `${assignment.label} is not assigned.`,
					target: '#project-people-heading',
					actionLabel: 'Review responsibilities',
				});
			}
		}
	} else if (assignments === null) {
		reasons.push({
			state: 'unknown',
			message: 'Project responsibility assignments could not be checked.',
			target: '#project-people-heading',
			actionLabel: 'Review responsibilities',
		});
	}

	for (const card of resolvedDateCards) {
		if (card.status.tone === 'amber') {
			reasons.push({
				state: 'amber',
				message: `${card.label}: ${card.status.text}.`,
				target: '#project-dates-heading',
				actionLabel: 'Review dates',
			});
		}
	}

	const state = reasons.some((reason) => reason.state === 'red')
		? 'red'
		: reasons.some((reason) => reason.state === 'amber')
			? 'amber'
			: reasons.some((reason) => reason.state === 'unknown')
				? 'unknown'
				: 'green';

	return {
		area: 'project_details',
		state,
		label: 'Project Details',
		reasons: reasons.length > 0
			? reasons
			: [{ state: 'green', message: 'Project setup has no current attention items.' }],
	};
}

export function deriveProjectDetailsTileSignal(
	project: ProjectDetailsSignalProject | null | undefined,
	dateCards: ProjectDateCard[] | null | undefined,
	assignments?: ProjectDetailsSignalAssignment[] | null,
): DashboardTileSignalState {
	const state = deriveProjectDetailsAreaSignal(project, dateCards, assignments).state;
	return state === 'disabled' ? 'neutral' : state;
}

export function deriveProjectNarrativeTileSignal(readState: NarrativeReadState | null | undefined): DashboardTileSignalState {
	if (!readState || !Number.isInteger(readState.unseenEntries) || readState.unseenEntries < 0) return 'unknown';
	if (readState.unseenEntries === 0) return 'green';
	if (readState.unseenEntries <= 3) return 'amber';
	return 'red';
}

export function deriveRiskTileAttentionSignal(
	risks: RiskTileSignalRisk[] | null | undefined,
	now = new Date(),
): DashboardTileSignalState {
	const state = deriveRiskAreaSignal(risks, now).state;
	return state === 'disabled' ? 'neutral' : state;
}

export function deriveRiskAreaSignal(
	risks: RiskTileSignalRisk[] | null | undefined,
	now = new Date(),
): ProjectAreaSignal {
	if (!risks) {
		return {
			area: 'risks',
			state: 'unknown',
			label: 'Risks',
			reasons: [{ state: 'unknown', message: 'Risk attention could not be calculated safely.' }],
		};
	}
	const activeRisks = risks.filter((risk) => isDashboardActiveRiskStatus(risk.status));
	if (activeRisks.length === 0) {
		return {
			area: 'risks',
			state: 'neutral',
			label: 'Risks',
			reasons: [{ state: 'neutral', message: 'No active risks currently require attention.' }],
		};
	}

	const attentionStates = activeRisks.map((risk) => deriveRiskAssuranceTone(risk, now));
	const state = attentionStates.includes('red')
		? 'red'
		: attentionStates.includes('amber')
			? 'amber'
			: attentionStates.includes('green')
				? 'green'
				: 'unknown';
	const reasons = activeRisks
		.map((risk, index) => ({ risk, state: attentionStates[index] }))
		.filter((item) => item.state === 'red' || item.state === 'amber')
		.map((item) => ({
			state: item.state,
			message: `${item.risk.risk_ref ?? 'A risk'} needs ${dashboardTileSignalLabel(item.state)} attention${item.risk.title ? `: ${item.risk.title}` : '.'}`,
			target: '#risk-register-heading',
			actionLabel: 'Review risks',
		}));

	return {
		area: 'risks',
		state,
		label: 'Risks',
		reasons: reasons.length > 0
			? reasons
			: [{ state: state === 'unknown' ? 'unknown' : 'green', message: state === 'unknown' ? 'Risk attention could not be calculated safely.' : 'Active risks have no current assurance attention items.' }],
	};
}

export function aggregateProjectAreaSignalState(signals: ProjectAreaSignal[] | null | undefined): DashboardTileSignalState {
	if (!signals || signals.length === 0) return 'unknown';
	const activeSignals = signals.filter((signal) => signal.state !== 'disabled');
	if (activeSignals.some((signal) => signal.state === 'red')) return 'red';
	if (activeSignals.some((signal) => signal.state === 'amber')) return 'amber';
	if (activeSignals.some((signal) => signal.state === 'unknown')) return 'unknown';
	if (activeSignals.length === 0) return 'unknown';
	return 'green';
}
