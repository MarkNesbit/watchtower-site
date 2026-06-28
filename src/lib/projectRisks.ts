import { assertCan, type WorkspaceRole } from './permissions.ts';
import { getWorkspaceBySlug } from './projects.ts';

export const RISK_STATUSES = ['open', 'monitoring', 'mitigating', 'accepted', 'closed'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_RAG_STATUSES = ['blue', 'green', 'amber', 'red'] as const;
export type RiskRagStatus = (typeof RISK_RAG_STATUSES)[number];

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

export type RiskOwnerOption = RiskProfile & {
	role?: WorkspaceRole | string;
};

export type RiskFormInput = {
	title: string;
	description?: string;
	status: string;
	ragStatus: string;
	ownerId?: string;
	reviewDate?: string;
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
	'mitigation_plan',
	'contingency_plan',
	'review_date',
	'due_date',
	'created_by',
	'updated_by',
	'created_at',
	'updated_at',
].join(', ');

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

export function isRiskStatus(value: unknown): value is RiskStatus {
	return typeof value === 'string' && RISK_STATUSES.includes(value as RiskStatus);
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
	if (!isRiskRagStatus(input.ragStatus)) errors.ragStatus = 'Select a valid RAG status.';
	if (!isRiskReviewDate(input.reviewDate)) errors.reviewDate = 'Enter a valid review date.';
	return errors;
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

async function assertActiveRiskOwner(organisationId: string, ownerId: string | null, client): Promise<void> {
	if (!ownerId) return;
	const { data, error } = await client
		.from('organisation_members')
		.select('user_id')
		.eq('organisation_id', organisationId)
		.eq('user_id', ownerId)
		.eq('status', 'active')
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	if (!data) throw new Error('Select an active workspace member as risk owner.');
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

function normaliseRiskPayload(input: RiskFormInput) {
	return {
		title: input.title.trim(),
		description: input.description?.trim() || null,
		status: input.status as RiskStatus,
		rag_status: input.ragStatus as RiskRagStatus,
		owner_id: input.ownerId?.trim() || null,
		review_date: input.reviewDate?.trim() || null,
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

	const { organisation, project } = await resolveScopedRiskProject(workspaceSlug, projectSlug, 'risk.create', client, accessToken);
	const ownerId = input.ownerId?.trim() || null;
	await assertActiveRiskOwner(organisation.id, ownerId, client);

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
				...normaliseRiskPayload({ ...input, ownerId }),
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

	const { organisation, project } = await resolveScopedRiskProject(workspaceSlug, projectSlug, 'risk.edit', client, accessToken);
	const ownerId = input.ownerId?.trim() || null;
	await assertActiveRiskOwner(organisation.id, ownerId, client);

	const { data, error } = await client
		.from('project_risks')
		.update(normaliseRiskPayload({ ...input, ownerId }))
		.eq('organisation_id', organisation.id)
		.eq('project_id', project.id)
		.eq('risk_id', riskId)
		.is('deleted_at', null)
		.is('archived_at', null)
		.select(RISK_SELECT)
		.maybeSingle();

	if (error) throw error;
	if (!data) throw new Error('Risk not found or you do not have access.');
	const [risk] = await enrichRiskProfiles([data as ProjectRisk], client);
	return risk;
}
