import { assertCan, type WorkspaceRole } from './permissions.ts';

export const RISK_STATUSES = ['open', 'monitoring', 'mitigating', 'accepted', 'closed'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_RAG_STATUSES = ['blue', 'green', 'amber', 'red'] as const;
export type RiskRagStatus = (typeof RISK_RAG_STATUSES)[number];

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
	mitigation_plan?: string | null;
	contingency_plan?: string | null;
	review_date?: string | null;
	due_date?: string | null;
	created_by: string;
	updated_by?: string | null;
	created_at: string;
	updated_at: string;
	owner?: RiskProfile | null;
	creator?: RiskProfile | null;
	updater?: RiskProfile | null;
};

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
	'mitigation_plan',
	'contingency_plan',
	'review_date',
	'due_date',
	'created_by',
	'updated_by',
	'created_at',
	'updated_at',
].join(', ');

function uniqueValues(values: Array<string | null | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function enrichRiskProfiles(risks: ProjectRisk[], client): Promise<ProjectRisk[]> {
	if (risks.length === 0) return risks;

	const profileIds = uniqueValues(risks.flatMap((risk) => [risk.owner_id, risk.created_by, risk.updated_by]));
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
		creator: profileById.get(risk.created_by) ?? null,
		updater: risk.updated_by ? profileById.get(risk.updated_by) ?? null : null,
	}));
}

export function riskRagTone(value: unknown): RiskRagStatus | 'neutral' {
	if (value === 'green' || value === 'amber' || value === 'red' || value === 'blue') return value;
	return 'neutral';
}

export function riskDisplayLabel(value: unknown, fallback = 'Unknown'): string {
	if (typeof value !== 'string' || !value.trim()) return fallback;
	return value
		.split(/[_\s-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export function riskProfileName(profile: RiskProfile | null | undefined, fallback = 'Unassigned'): string {
	return profile?.display_name || profile?.email || fallback;
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
