import type { ProjectDateCard } from './projectDates.ts';
import {
	deriveRiskAssuranceTone,
	isDashboardActiveRiskStatus,
	type ProjectRisk,
} from './projectRisks.ts';

export type DashboardTileSignalState = 'red' | 'amber' | 'green' | 'unknown' | 'neutral';

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

type NarrativeReadState = {
	unseenEntries?: number | null;
};

type RiskTileSignalRisk = Pick<ProjectRisk,
	'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'
>;

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

export function deriveProjectDetailsTileSignal(
	project: ProjectDetailsSignalProject | null | undefined,
	dateCards: ProjectDateCard[] | null | undefined,
): DashboardTileSignalState {
	if (!project || !dateCards) return 'unknown';

	const criticalSetupMissing = [
		project.description,
		project.target_end_date,
		project.next_review_date,
	].some((value) => !hasText(value));
	if (criticalSetupMissing) return 'red';

	if (dateCards.some((card) => card.dateType !== 'start_date' && card.status.tone === 'red')) return 'red';

	const importantSetupMissing = [
		project.project_type,
		project.delivery_method,
		project.priority,
		project.criticality,
		project.governance_route,
		project.escalation_route,
	].some((value) => !hasText(value));
	if (importantSetupMissing) return 'amber';

	if (dateCards.some((card) => card.status.tone === 'amber')) return 'amber';
	return 'green';
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
	if (!risks) return 'unknown';
	const activeRisks = risks.filter((risk) => isDashboardActiveRiskStatus(risk.status));
	if (activeRisks.length === 0) return 'neutral';

	const attentionStates = activeRisks.map((risk) => deriveRiskAssuranceTone(risk, now));
	if (attentionStates.includes('red')) return 'red';
	if (attentionStates.includes('amber')) return 'amber';
	if (attentionStates.includes('green')) return 'green';
	return 'unknown';
}
