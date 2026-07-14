import { getNarrativeDisplayRef } from './projectNarrative.ts';
import {
	deriveRiskReferenceTone,
	isDraftRiskStatus,
	isActiveRiskStatus,
	riskLifecycleLabel,
	riskReferenceStatusLabel,
	type ProjectRisk,
	type RiskAssuranceTone,
} from './projectRisks.ts';

export type ReferencePillTone = RiskAssuranceTone | 'blue' | 'unknown' | 'risk-low' | 'risk-medium' | 'risk-high' | 'risk-critical';

export type ReferencePillPresentation = {
	tone: ReferencePillTone;
	label: string;
	statusLabel: string;
	ariaLabel: string;
	title: string;
	compactActionState: boolean;
	riskDetailAvailable: boolean;
};

type NarrativeLikeEntry = {
	narrative_ref: string;
	source_type?: string | null;
	source_record_id?: string | null;
	source_ref?: string | null;
	attention_level?: string | null;
};

function formatAttentionLabel(value: unknown): string {
	if (value === 'green') return 'Green';
	if (value === 'amber') return 'Amber';
	if (value === 'red') return 'Red';
	return 'Neutral';
}

function narrativeAttentionTone(value: unknown): RiskAssuranceTone {
	if (value === 'green' || value === 'amber' || value === 'red') return value;
	return 'neutral';
}

export function getRiskReferencePillPresentation(
	risk: Pick<ProjectRisk, 'risk_ref' | 'status' | 'owner_id' | 'actioner_id' | 'review_date' | 'due_date' | 'mitigation_plan' | 'contingency_plan' | 'probability' | 'impact' | 'updated_at'>,
	now = new Date(),
): ReferencePillPresentation {
	const lifecycle = riskLifecycleLabel(risk.status);
	if (!isActiveRiskStatus(risk.status)) {
		return {
			tone: isDraftRiskStatus(risk.status) ? 'blue' : 'neutral',
			label: risk.risk_ref,
			statusLabel: '',
			ariaLabel: `${risk.risk_ref}, ${lifecycle} risk`,
			title: `${risk.risk_ref}, ${lifecycle} risk`,
			compactActionState: false,
			riskDetailAvailable: true,
		};
	}

	const statusLabel = riskReferenceStatusLabel(risk, now);
	return {
		tone: deriveRiskReferenceTone(risk, now),
		label: risk.risk_ref,
		statusLabel,
		ariaLabel: `${risk.risk_ref}, action state ${statusLabel}`,
		title: `${risk.risk_ref}, action state ${statusLabel}`,
		compactActionState: true,
		riskDetailAvailable: true,
	};
}

export function getNarrativeReferencePillPresentation(
	entry: NarrativeLikeEntry,
	linkedRisk: ProjectRisk | null | undefined,
	now = new Date(),
): ReferencePillPresentation {
	if (entry.source_type !== 'risk') {
		const displayRef = getNarrativeDisplayRef(entry);
		const attentionLabel = formatAttentionLabel(entry.attention_level);
		return {
			tone: narrativeAttentionTone(entry.attention_level),
			label: displayRef,
			statusLabel: attentionLabel,
			ariaLabel: `Open ${displayRef}, ${attentionLabel} attention`,
			title: `${displayRef}, ${attentionLabel} attention`,
			compactActionState: false,
			riskDetailAvailable: false,
		};
	}

	if (linkedRisk) return getRiskReferencePillPresentation(linkedRisk, now);

	const fallbackRef = entry.source_ref?.trim() || entry.narrative_ref;
	return {
		tone: 'neutral',
		label: fallbackRef,
		statusLabel: '',
		ariaLabel: `${fallbackRef}, linked risk unavailable`,
		title: 'Linked risk unavailable',
		compactActionState: false,
		riskDetailAvailable: false,
	};
}
