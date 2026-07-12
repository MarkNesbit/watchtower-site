import {
	aggregateProjectAreaSignalState,
	deriveProjectDetailsAreaSignal,
	deriveRiskAreaSignal,
	type ProjectAreaSignal,
} from './dashboardTileSignals.ts';
import type { ProjectDateCard } from './projectDates.ts';
import type { ProjectRisk } from './projectRisks.ts';

export type ProjectAttentionState = 'red' | 'amber' | 'green' | 'unknown' | 'neutral';
export type ProjectActionState = ProjectAttentionState;

export type ProjectAttentionRisk = Pick<ProjectRisk,
	| 'project_id'
	| 'status'
	| 'owner_id'
	| 'actioner_id'
	| 'review_date'
	| 'due_date'
	| 'mitigation_plan'
	| 'contingency_plan'
	| 'probability'
	| 'impact'
	| 'updated_at'
> & Partial<Pick<ProjectRisk, 'risk_ref' | 'title'>>;
export type ProjectActionStateRisk = ProjectAttentionRisk;

export type ProjectAttentionProject = {
	id?: string | null;
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
export type ProjectActionStateProject = ProjectAttentionProject;

export type ProjectAttentionAssignment = {
	project_id?: string | null;
	project_role?: string | null;
	status?: string | null;
	user_id?: string | null;
	demo_person_id?: string | null;
};
export type ProjectActionStateAssignment = ProjectAttentionAssignment;

export type ProjectAttentionFacts = {
	project?: ProjectAttentionProject | null;
	projectDateCards?: ProjectDateCard[] | null;
	projectPeople?: ProjectAttentionAssignment[] | null;
	risks?: ProjectAttentionRisk[] | null;
};
export type ProjectActionStateFacts = ProjectAttentionFacts;

export function projectAttentionLabel(state: ProjectAttentionState): string {
	if (state === 'red') return 'Red';
	if (state === 'amber') return 'Amber';
	if (state === 'green') return 'Green';
	if (state === 'neutral') return 'Neutral';
	return 'Unknown';
}

export const projectActionStateLabel = projectAttentionLabel;

function deriveRiskOnlyAttentionState(
	risks: ProjectAttentionRisk[] | null | undefined,
	now: Date,
): ProjectAttentionState {
	const riskSignal = deriveRiskAreaSignal(risks, now);
	return riskSignal.state === 'disabled' ? 'neutral' : riskSignal.state;
}

export function deriveProjectAreaSignals(
	facts: ProjectAttentionFacts | null | undefined,
	now = new Date(),
): ProjectAreaSignal[] | null {
	if (!facts) return null;
	return [
		deriveProjectDetailsAreaSignal(facts.project, facts.projectDateCards, facts.projectPeople),
		deriveRiskAreaSignal(facts.risks, now),
	];
}

export function deriveProjectAttentionState(
	factsOrRisks: ProjectAttentionFacts | ProjectAttentionRisk[] | null | undefined,
	now = new Date(),
): ProjectAttentionState {
	if (Array.isArray(factsOrRisks) || !factsOrRisks) return deriveRiskOnlyAttentionState(factsOrRisks, now);
	return aggregateProjectAreaSignalState(deriveProjectAreaSignals(factsOrRisks, now));
}

export const deriveProjectActionState = deriveProjectAttentionState;

export function deriveProjectAttentionStatesByProject(
	projectIds: string[],
	factsByProjectIdOrRisks: Map<string, ProjectAttentionFacts> | ProjectAttentionRisk[] | null | undefined,
	now = new Date(),
): Map<string, ProjectAttentionState> {
	const stateByProjectId = new Map<string, ProjectAttentionState>();
	if (!factsByProjectIdOrRisks) {
		for (const projectId of projectIds) stateByProjectId.set(projectId, 'unknown');
		return stateByProjectId;
	}

	if (Array.isArray(factsByProjectIdOrRisks)) {
		const risksByProjectId = new Map<string, ProjectAttentionRisk[]>();
		for (const risk of factsByProjectIdOrRisks) {
			const bucket = risksByProjectId.get(risk.project_id) ?? [];
			bucket.push(risk);
			risksByProjectId.set(risk.project_id, bucket);
		}
		for (const projectId of projectIds) {
			stateByProjectId.set(
				projectId,
				deriveRiskOnlyAttentionState(risksByProjectId.get(projectId) ?? [], now),
			);
		}
		return stateByProjectId;
	}

	for (const projectId of projectIds) {
		stateByProjectId.set(
			projectId,
			deriveProjectAttentionState(factsByProjectIdOrRisks.get(projectId), now),
		);
	}
	return stateByProjectId;
}

export const deriveProjectActionStatesByProject = deriveProjectAttentionStatesByProject;
