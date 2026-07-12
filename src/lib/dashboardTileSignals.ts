import type { ProjectDateCard } from './projectDates.ts';
import {
	deriveRiskAssuranceTone,
	deriveProjectRiskSignal,
	isDashboardActiveRiskStatus,
	type ProjectRisk,
} from './projectRisks.ts';

export type DashboardTileSignalState = 'red' | 'amber' | 'green' | 'unknown' | 'neutral';
export type ProjectAreaSignalState = DashboardTileSignalState | 'disabled';
export type ProjectAreaKey = 'project_details' | 'project_narrative' | 'risks' | 'timeline' | 'issues' | 'dependencies' | 'assumptions' | 'decisions' | 'actions';
export type ProjectDetailsSectionKey =
	| 'project_identity'
	| 'project_description'
	| 'project_context'
	| 'project_dates'
	| 'governance_escalation'
	| 'project_roles_responsibilities'
	| 'system_metadata';

export type ProjectAreaSignalReason = {
	state: Exclude<ProjectAreaSignalState, 'disabled'>;
	message: string;
	target?: string;
	anchor?: string;
	actionLabel?: string;
	section?: ProjectDetailsSectionKey;
	sectionLabel?: string;
};

export type ProjectAreaSignal = {
	area: ProjectAreaKey;
	state: ProjectAreaSignalState;
	label: string;
	reasons: ProjectAreaSignalReason[];
};

export type ProjectDetailsSectionSignal = {
	section: ProjectDetailsSectionKey;
	state: DashboardTileSignalState;
	label: string;
	anchor: string;
	reasons: ProjectAreaSignalReason[];
};

type ProjectDetailsSignalProject = {
	id?: string | null;
	name?: string | null;
	project_ref?: string | null;
	slug?: string | null;
	status?: string | null;
	description?: string | null;
	project_type?: string | null;
	delivery_method?: string | null;
	priority?: string | null;
	criticality?: string | null;
	target_end_date?: string | null;
	next_review_date?: string | null;
	review_cadence?: string | null;
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
	if (state === 'red') return 'Red action needed';
	if (state === 'amber') return 'Amber action recommended';
	if (state === 'green') return 'Green no action needed';
	if (state === 'neutral') return 'No active action signals';
	return 'Unknown state';
}

const PROJECT_DETAILS_CRITICAL_FIELDS = [
	{ key: 'description', label: 'Project description', section: 'project_description', target: '#project-description-heading', actionLabel: 'Review description' },
] as const;

const PROJECT_DETAILS_IMPORTANT_FIELDS = [
	{ key: 'project_type', label: 'Project type', section: 'project_context', target: '#project-context-heading', actionLabel: 'Review context' },
	{ key: 'delivery_method', label: 'Delivery method', section: 'project_context', target: '#project-context-heading', actionLabel: 'Review context' },
	{ key: 'priority', label: 'Priority', section: 'project_context', target: '#project-context-heading', actionLabel: 'Review context' },
	{ key: 'criticality', label: 'Criticality', section: 'project_context', target: '#project-context-heading', actionLabel: 'Review context' },
	{ key: 'review_cadence', label: 'Review cadence', section: 'governance_escalation', target: '#project-governance-heading', actionLabel: 'Review governance' },
	{ key: 'governance_route', label: 'Governance route', section: 'governance_escalation', target: '#project-governance-heading', actionLabel: 'Review governance' },
	{ key: 'escalation_route', label: 'Escalation route', section: 'governance_escalation', target: '#project-governance-heading', actionLabel: 'Review governance' },
] as const;

const PROJECT_DETAILS_IMPORTANT_ASSIGNMENTS = [
	{ role: 'product_owner', label: 'Product Owner' },
	{ role: 'default_risk_owner', label: 'Default Risk Owner' },
] as const;

const PROJECT_DETAILS_SECTION_META: Record<ProjectDetailsSectionKey, { label: string; anchor: string }> = {
	project_identity: { label: 'Project Identity', anchor: '#project-identity-heading' },
	project_description: { label: 'Project Description', anchor: '#project-description-heading' },
	project_context: { label: 'Project Context', anchor: '#project-context-heading' },
	project_dates: { label: 'Project Dates', anchor: '#project-dates-heading' },
	governance_escalation: { label: 'Governance and Escalation', anchor: '#project-governance-heading' },
	project_roles_responsibilities: { label: 'Project Roles and Responsibilities', anchor: '#project-people-heading' },
	system_metadata: { label: 'System Metadata', anchor: '#project-system-metadata-heading' },
};

function hasActiveAssignment(assignments: ProjectDetailsSignalAssignment[], role: string): boolean {
	return assignments.some((assignment) => (
		assignment.project_role === role
		&& assignment.status !== 'removed'
		&& (Boolean(assignment.user_id) || Boolean(assignment.demo_person_id))
	));
}

function reason(
	section: ProjectDetailsSectionKey,
	state: ProjectAreaSignalReason['state'],
	message: string,
	actionLabel?: string,
): ProjectAreaSignalReason {
	const meta = PROJECT_DETAILS_SECTION_META[section];
	return {
		state,
		message,
		target: meta.anchor,
		anchor: meta.anchor,
		actionLabel,
		section,
		sectionLabel: meta.label,
	};
}

function sectionState(reasons: ProjectAreaSignalReason[]): DashboardTileSignalState {
	if (reasons.some((item) => item.state === 'red')) return 'red';
	if (reasons.some((item) => item.state === 'amber')) return 'amber';
	if (reasons.some((item) => item.state === 'unknown')) return 'unknown';
	if (reasons.some((item) => item.state === 'neutral')) return 'neutral';
	return 'green';
}

function buildSectionSignal(
	section: ProjectDetailsSectionKey,
	reasons: ProjectAreaSignalReason[],
	greenMessage: string,
	neutralMessage?: string,
): ProjectDetailsSectionSignal {
	const meta = PROJECT_DETAILS_SECTION_META[section];
	const state = sectionState(reasons);
	const resolvedReasons = reasons.length > 0
		? reasons
		: [reason(section, neutralMessage ? 'neutral' : 'green', neutralMessage ?? greenMessage)];
	return {
		section,
		state: reasons.length > 0 ? state : (neutralMessage ? 'neutral' : 'green'),
		label: meta.label,
		anchor: meta.anchor,
		reasons: resolvedReasons,
	};
}

export function deriveProjectDetailsSectionSignals(
	project: ProjectDetailsSignalProject | null | undefined,
	dateCards: ProjectDateCard[] | null | undefined,
	assignments?: ProjectDetailsSignalAssignment[] | null,
): ProjectDetailsSectionSignal[] {
	if (!project) {
		return (Object.keys(PROJECT_DETAILS_SECTION_META) as ProjectDetailsSectionKey[]).map((section) => (
			buildSectionSignal(section, [
				reason(section, 'unknown', `${PROJECT_DETAILS_SECTION_META[section].label} cannot be calculated safely.`),
			], '')
		));
	}

	const identityReasons: ProjectAreaSignalReason[] = [];
	for (const field of [
		{ key: 'name', label: 'Project name' },
		{ key: 'project_ref', label: 'Project reference' },
		{ key: 'slug', label: 'Project slug' },
		{ key: 'status', label: 'Project status' },
		{ key: 'id', label: 'Internal project ID' },
	] as const) {
		if (Object.prototype.hasOwnProperty.call(project, field.key) && !hasText(project[field.key])) {
			identityReasons.push(reason('project_identity', 'red', `${field.label} is not set.`, 'Review identity'));
		}
	}

	const descriptionReasons = PROJECT_DETAILS_CRITICAL_FIELDS
		.filter((field) => field.section === 'project_description' && !hasText(project[field.key]))
		.map((field) => reason('project_description', 'red', `${field.label} is not set.`, field.actionLabel));

	const contextReasons = PROJECT_DETAILS_IMPORTANT_FIELDS
		.filter((field) => field.section === 'project_context' && !hasText(project[field.key]))
		.map((field) => reason('project_context', 'amber', `${field.label} is not set.`, field.actionLabel));

	const governanceReasons = PROJECT_DETAILS_IMPORTANT_FIELDS
		.filter((field) => field.section === 'governance_escalation' && !hasText(project[field.key]))
		.map((field) => reason('governance_escalation', 'amber', `${field.label} is not set.`, field.actionLabel));

	const dateReasons: ProjectAreaSignalReason[] = [];
	if (!dateCards) {
		dateReasons.push(reason('project_dates', 'unknown', 'Project date readiness could not be checked.', 'Review dates'));
	} else {
		for (const card of dateCards) {
			if (card.status.tone === 'red') {
				dateReasons.push(reason('project_dates', 'red', `${card.label}: ${card.status.text}.`, 'Review dates'));
			} else if (card.status.tone === 'amber') {
				dateReasons.push(reason('project_dates', 'amber', `${card.label}: ${card.status.text}.`, 'Review dates'));
			}
		}
	}

	const roleReasons: ProjectAreaSignalReason[] = [];
	if (Array.isArray(assignments)) {
		for (const assignment of PROJECT_DETAILS_IMPORTANT_ASSIGNMENTS) {
			if (!hasActiveAssignment(assignments, assignment.role)) {
				roleReasons.push(reason('project_roles_responsibilities', 'amber', `${assignment.label} is not assigned.`, 'Review responsibilities'));
			}
		}
	} else if (assignments === null) {
		roleReasons.push(reason('project_roles_responsibilities', 'unknown', 'Project responsibility assignments could not be checked.', 'Review responsibilities'));
	}

	return [
		buildSectionSignal('project_identity', identityReasons, 'Expected identity fields are present.'),
		buildSectionSignal('project_description', descriptionReasons, 'A usable project description is present.'),
		buildSectionSignal('project_context', contextReasons, 'Expected project context fields are present.'),
		buildSectionSignal('project_dates', dateReasons, 'Project dates have no current readiness concerns.'),
		buildSectionSignal('governance_escalation', governanceReasons, 'Review cadence, governance route and escalation route are present.'),
		buildSectionSignal('project_roles_responsibilities', roleReasons, 'Required project responsibilities are assigned.'),
		buildSectionSignal('system_metadata', [], '', 'System metadata is informational.'),
	];
}

export function deriveProjectDetailsAreaSignal(
	project: ProjectDetailsSignalProject | null | undefined,
	dateCards: ProjectDateCard[] | null | undefined,
	assignments?: ProjectDetailsSignalAssignment[] | null,
): ProjectAreaSignal {
	const sectionSignals = deriveProjectDetailsSectionSignals(project, dateCards, assignments);
	const reasons = sectionSignals.flatMap((section) => section.reasons);

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
			: [{ state: 'green', message: 'Project setup has no current action signals.' }],
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
			reasons: [{ state: 'unknown', message: 'Risk action state could not be calculated safely.' }],
		};
	}
	const activeRisks = risks.filter((risk) => isDashboardActiveRiskStatus(risk.status));
	const signal = deriveProjectRiskSignal(risks, now);
	if (signal.activeCount === 0) {
		return {
			area: 'risks',
			state: 'neutral',
			label: 'Risks',
			reasons: [{ state: 'neutral', message: 'No active risks currently require action.' }],
		};
	}

	const attentionStates = activeRisks.map((risk) => deriveRiskAssuranceTone(risk, now));
	const state = signal.state === 'neutral' ? 'unknown' : signal.state;
	const reasons = activeRisks
		.map((risk, index) => ({ risk, state: attentionStates[index] }))
		.filter((item) => item.state === 'red' || item.state === 'amber')
		.map((item) => ({
			state: item.state,
			message: `${item.risk.risk_ref ?? 'A risk'} has ${dashboardTileSignalLabel(item.state)} action state${item.risk.title ? `: ${item.risk.title}` : '.'}`,
			target: '#risk-register-heading',
			actionLabel: 'Review risks',
		}));

	return {
		area: 'risks',
		state,
		label: 'Risks',
		reasons: reasons.length > 0
			? reasons
			: [{ state: state === 'unknown' ? 'unknown' : 'green', message: state === 'unknown' ? 'Risk action state could not be calculated safely.' : 'Active risks have no current assurance action signals.' }],
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
