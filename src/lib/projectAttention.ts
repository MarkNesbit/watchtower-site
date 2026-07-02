import {
	deriveRiskConcernTone,
	isDashboardActiveRiskStatus,
	type ProjectRisk,
} from './projectRisks.ts';

export type ProjectAttentionState = 'red' | 'amber' | 'green' | 'unknown' | 'neutral';

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
>;

export function projectAttentionLabel(state: ProjectAttentionState): string {
	if (state === 'red') return 'Red';
	if (state === 'amber') return 'Amber';
	if (state === 'green') return 'Green';
	if (state === 'neutral') return 'Neutral';
	return 'Unknown';
}

export function deriveProjectAttentionState(
	risks: ProjectAttentionRisk[] | null | undefined,
	now = new Date(),
): ProjectAttentionState {
	if (!risks) return 'unknown';

	const activeRiskConcerns = risks
		.filter((risk) => isDashboardActiveRiskStatus(risk.status))
		.map((risk) => deriveRiskConcernTone(risk, now));

	if (activeRiskConcerns.includes('red')) return 'red';
	if (activeRiskConcerns.includes('amber')) return 'amber';
	return 'green';
}

export function deriveProjectAttentionStatesByProject(
	projectIds: string[],
	risks: ProjectAttentionRisk[] | null | undefined,
	now = new Date(),
): Map<string, ProjectAttentionState> {
	const stateByProjectId = new Map<string, ProjectAttentionState>();
	if (!risks) {
		for (const projectId of projectIds) stateByProjectId.set(projectId, 'unknown');
		return stateByProjectId;
	}

	const risksByProjectId = new Map<string, ProjectAttentionRisk[]>();
	for (const risk of risks) {
		const bucket = risksByProjectId.get(risk.project_id) ?? [];
		bucket.push(risk);
		risksByProjectId.set(risk.project_id, bucket);
	}

	for (const projectId of projectIds) {
		stateByProjectId.set(
			projectId,
			deriveProjectAttentionState(risksByProjectId.get(projectId) ?? [], now),
		);
	}
	return stateByProjectId;
}
