import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	ACTIVE_RISK_STATUSES,
	buildRiskReference,
	CLOSED_RISK_STATUSES,
	compareRisksForRegister,
	countDraftRisks,
	countOpenRisks,
	countRisksNeedingAction,
	createDraftProjectRisksFromPrompts,
	createProjectRiskComment,
	createProjectRisk,
	deriveRiskAssuranceRollupTone,
	deriveRiskActionStateTone,
	deriveProjectRiskDashboardAssuranceTone,
	deriveRiskAssuranceTone,
	defaultRiskRegisterSortForView,
	deriveWatchtowerDefaultRiskExposure,
	deriveRiskExposureTone,
	deriveRiskReferenceTone,
	deriveRiskReviewDateTone,
	deriveWatchtowerDefaultRiskExposureTone,
	filterAndSortRisksForRegister,
	getActiveRiskExposureCounts,
	getExposureChartSummary,
	getExposureDistribution,
	getExposurePercentage,
	getRiskActivationReadiness,
	getRiskRegisterPageNumbers,
	getRiskRegisterExposureDisplay,
	getRiskRegisterPaginationRange,
	getProjectRiskActionItems,
	getRiskActionItems,
	getRiskActionStateDrivers,
	getHighestActiveExposure,
	getProjectRisk,
	getRiskAssuranceBlocks,
	getTopRiskActionItems,
	isActiveRiskStatus,
	isClosedRiskStatus,
	isDraftRiskStatus,
	isRiskReviewDate,
	isRiskEligibleForActionPanel,
	listProjectRiskComments,
	listProjectRisksByIds,
	listProjectRisks,
	normaliseRiskRegisterSearch,
	normaliseRiskRegisterSort,
	normaliseRiskRegisterViewTab,
	paginateRisksForRegister,
	parseRiskRegisterPage,
	parseRiskRegisterPageSize,
	preflightDraftProjectRisksFromPrompts,
	DEFAULT_RISK_REGISTER_PAGE_SIZE,
	DRAFT_RISK_STATUSES,
	RISK_ACTIVATION_DESCRIPTION_MIN_LENGTH,
	RISK_REGISTER_EXPOSURE_FILTERS,
	RISK_REGISTER_PAGE_SIZES,
	RISK_REVIEW_DUE_SOON_WINDOW_DAYS,
	riskDisplayLabel,
	riskExposureTone,
	riskExposureToneLabel,
	riskLifecycleCategory,
	riskLifecycleLabel,
	riskMatchesRegisterFilters,
	riskMatchesRegisterSearch,
	riskMatchesRegisterView,
	riskProfileName,
	riskReferenceStatusLabel,
	riskRagTone,
	rankRiskActionItems,
	summarizeRiskRegister,
	transitionProjectRiskLifecycle,
	updateProjectRisk,
	validateRiskFormInput,
} from '../src/lib/projectRisks.ts';
import { deriveRiskTileAttentionSignal } from '../src/lib/dashboardTileSignals.ts';
import { deriveProjectActionState } from '../src/lib/projectAttention.ts';

const migrationUrl = new URL('../supabase/migrations/20260620000100_create_project_risks.sql', import.meta.url);
const migrationSql = async () => readFile(migrationUrl, 'utf8');
const allMigrationSql = async () => {
	const dir = new URL('../supabase/migrations/', import.meta.url);
	const files = await readdir(dir);
	const parts = await Promise.all(files.map((file) => readFile(new URL(file, dir), 'utf8')));
	return parts.join('\n');
};

const assuredRiskFacts = (overrides = {}) => ({
	status: 'open',
	probability: 'low',
	impact: 'low',
	owner_id: 'owner-1',
	actioner_id: 'actioner-1',
	review_date: '2026-07-10',
	due_date: '2026-08-01',
	mitigation_plan: 'Confirmed alternate route.',
	contingency_plan: 'Escalate through steering group.',
	updated_at: '2026-06-20T10:00:00Z',
	...overrides,
});

const registerRisk = (overrides = {}) => ({
	risk_id: 'risk-1',
	organisation_id: 'workspace-1',
	project_id: 'project-1',
	risk_ref: 'Risk-HHH-001',
	risk_sequence: 1,
	title: 'Supplier delay',
	description: 'Supplier delay threatens launch readiness.',
	status: 'open',
	probability: 'low',
	impact: 'low',
	rag_status: 'blue',
	owner_id: 'owner-1',
	actioner_id: 'actioner-1',
	mitigation_plan: 'Confirmed alternate route.',
	contingency_plan: 'Escalate through steering group.',
	review_date: '2026-07-10',
	due_date: '2026-08-01',
	created_by: 'user-1',
	created_at: '2026-06-01T10:00:00Z',
	updated_at: '2026-06-20T10:00:00Z',
	owner: { id: 'owner-1', display_name: 'Aisha Khan', email: 'aisha@example.com' },
	actioner: { id: 'actioner-1', display_name: 'Ben Taylor', email: 'ben@example.com' },
	...overrides,
});

function isoDateOffsetFromToday(days) {
	const date = new Date();
	date.setUTCHours(12, 0, 0, 0);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function createRiskClient(rows = []) {
	const calls = [];
	const riskQuery = {
		data: rows,
		error: null,
		select(value) {
			calls.push(['select', value]);
			return this;
		},
		eq(column, value) {
			calls.push(['eq', column, value]);
			return this;
		},
		is(column, value) {
			calls.push(['is', column, value]);
			return this;
		},
		order(column, options) {
			calls.push(['order', column, options]);
			return this;
		},
		limit(value) {
			calls.push(['limit', value]);
			return this;
		},
		in(column, values) {
			calls.push(['in', column, values]);
			return this;
		},
		maybeSingle() {
			calls.push(['maybeSingle']);
			return { data: rows[0] ?? null, error: null };
		},
	};
	const profileQuery = {
		select(value) {
			calls.push(['profileSelect', value]);
			return this;
		},
		in(column, values) {
			calls.push(['profileIn', column, values]);
			return { data: [], error: null };
		},
	};
	return {
		calls,
		from(table) {
			calls.push(['from', table]);
			return table === 'profiles' ? profileQuery : riskQuery;
		},
	};
}

function createRiskMutationClient({
	role = 'member',
	existingSequence = 1,
	ownerIsActive = true,
	actionerIsActive = true,
	authError = null,
	existingRisk = {},
	updatedRisk = {},
} = {}) {
	const calls = [];
	const membershipWithWorkspace = {
		role,
		organisations: { id: 'workspace-1', name: 'Alpha Workspace', slug: 'alpha' },
	};
	const project = { id: 'project-1', name: 'Delivery Hub', project_ref: 'HHH', slug: 'delivery-hub' };
	const baseExistingRisk = {
		risk_id: 'risk-1',
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-001',
		risk_sequence: 1,
		title: 'Supplier delay',
		status: 'open',
		probability: 'medium',
		impact: 'medium',
		rag_status: 'amber',
		created_by: 'user-1',
		created_at: '2026-06-01T10:00:00Z',
		updated_at: '2026-06-02T10:00:00Z',
		...existingRisk,
	};

	const makeQuery = (table) => {
		const query = {
			table,
			selectValue: '',
			insertPayload: null,
			updatePayload: null,
			filters: {},
			select(value) {
				this.selectValue = value;
				calls.push(['select', table, value]);
				return this;
			},
			insert(payload) {
				this.insertPayload = payload;
				calls.push(['insert', table, payload]);
				return this;
			},
			update(payload) {
				this.updatePayload = payload;
				calls.push(['update', table, payload]);
				return this;
			},
			eq(column, value) {
				this.filters[column] = value;
				calls.push(['eq', table, column, value]);
				return this;
			},
			is(column, value) {
				calls.push(['is', table, column, value]);
				return this;
			},
			order(column, options) {
				calls.push(['order', table, column, options]);
				return this;
			},
			limit(value) {
				calls.push(['limit', table, value]);
				return this;
			},
			in(column, values) {
				calls.push(['in', table, column, values]);
				return { data: [], error: null };
			},
			maybeSingle() {
				calls.push(['maybeSingle', table, this.selectValue]);
				if (table === 'organisation_members' && this.selectValue.includes('organisations')) {
					return { data: membershipWithWorkspace, error: null };
				}
				if (table === 'organisation_members') {
					const isActionerLookup = this.filters.user_id === 'actioner-1';
					const isActive = isActionerLookup ? actionerIsActive : ownerIsActive;
					return { data: isActive ? { user_id: this.filters.user_id } : null, error: null };
				}
				if (table === 'projects') return { data: project, error: null };
				if (table === 'project_risks' && this.updatePayload) {
					return {
						data: {
							risk_id: 'risk-1',
							organisation_id: 'workspace-1',
							project_id: 'project-1',
							risk_ref: 'Risk-HHH-001',
							risk_sequence: 1,
							probability: 'medium',
							impact: 'medium',
							created_by: 'user-1',
							created_at: '2026-06-01T10:00:00Z',
							updated_at: '2026-06-02T10:00:00Z',
							...this.updatePayload,
							...updatedRisk,
						},
						error: null,
					};
				}
				if (table === 'project_risks' && this.selectValue.includes('risk_id')) {
					return { data: { ...baseExistingRisk, risk_id: this.filters.risk_id ?? baseExistingRisk.risk_id }, error: null };
				}
				if (table === 'project_risks') return { data: { risk_sequence: existingSequence }, error: null };
				return { data: null, error: null };
			},
			single() {
				calls.push(['single', table]);
				if (table === 'project_narrative_entries') {
					return {
						data: {
							id: 'narrative-1',
							organisation_id: 'workspace-1',
							project_id: this.insertPayload.project_id,
							narrative_ref: 'NAR-HHH-001',
							entry_number: 1,
							created_by: 'user-1',
							created_at: '2026-06-01T10:00:00Z',
							...this.insertPayload,
						},
						error: null,
					};
				}
				if (table === 'project_risk_notes') {
					return {
						data: {
							risk_note_id: 'comment-1',
							created_by: 'user-1',
							created_at: '2026-06-03T10:00:00Z',
							updated_at: null,
							...this.insertPayload,
						},
						error: null,
					};
				}
				return {
					data: {
						risk_id: 'risk-2',
						probability: 'medium',
						impact: 'medium',
						created_by: 'user-1',
						created_at: '2026-06-01T10:00:00Z',
						updated_at: '2026-06-01T10:00:00Z',
						...this.insertPayload,
					},
					error: null,
				};
			},
		};
		return query;
	};

	return {
		calls,
		auth: {
			getUser() {
				calls.push(['getUser']);
				if (authError) return { data: { user: null }, error: authError };
				return { data: { user: { id: 'user-1' } }, error: null };
			},
		},
		from(table) {
			calls.push(['from', table]);
			return makeQuery(table);
		},
	};
}

function createPromptDraftClient({
	role = 'member',
	existingSequence = 1,
	duplicateSourcePromptIds = [],
	riskRefConflictAttempts = 0,
	sourcePromptConflictIds = [],
} = {}) {
	const calls = [];
	const insertedRisks = [];
	let remainingRiskRefConflictAttempts = riskRefConflictAttempts;
	let sequenceOffset = 0;
	const sourcePromptConflictSet = new Set(sourcePromptConflictIds);
	const membershipWithWorkspace = {
		role,
		organisations: { id: 'workspace-1', name: 'Alpha Workspace', slug: 'alpha' },
	};
	const project = { id: 'project-1', name: 'Delivery Hub', project_ref: 'HHH', slug: 'delivery-hub' };
	const library = { id: 'library-1' };
	const activeAreas = [{ id: 'area-1' }, { id: 'area-2' }];
	const prompts = [
		{
			id: 'prompt-uuid-1',
			risk_prompt_area_id: 'area-1',
			risk_prompt_id: 'WT-RP-001',
			risk_prompt_title: 'Decision-making authority is unclear',
			risk_prompt_guidance: 'Clarify decision ownership and escalation routes.',
			risk_default_status: 'draft',
		},
		{
			id: 'prompt-uuid-2',
			risk_prompt_area_id: 'area-2',
			risk_prompt_id: 'WT-RP-002',
			risk_prompt_title: 'The team does not have enough capacity',
			risk_prompt_guidance: 'Review capacity and confirm delivery cover.',
			risk_default_status: 'draft',
		},
		{
			id: 'prompt-uuid-3',
			risk_prompt_area_id: 'inactive-area',
			risk_prompt_id: 'WT-RP-003',
			risk_prompt_title: 'Inactive area prompt',
			risk_prompt_guidance: 'This prompt should not create a risk.',
			risk_default_status: 'draft',
		},
	];

	const makeQuery = (table) => {
		const query = {
			table,
			selectValue: '',
			insertPayload: null,
			filters: {},
			select(value) {
				this.selectValue = value;
				calls.push(['select', table, value]);
				return this;
			},
			insert(payload) {
				this.insertPayload = payload;
				calls.push(['insert', table, payload]);
				return this;
			},
			eq(column, value) {
				this.filters[column] = value;
				calls.push(['eq', table, column, value]);
				return this;
			},
			is(column, value) {
				calls.push(['is', table, column, value]);
				return this;
			},
			order(column, options) {
				calls.push(['order', table, column, options]);
				return this;
			},
			limit(value) {
				calls.push(['limit', table, value]);
				return this;
			},
			in(column, values) {
				calls.push(['in', table, column, values]);
				if (table === 'risk_prompts') {
					return { data: prompts.filter((prompt) => values.includes(prompt.risk_prompt_id)), error: null };
				}
				if (table === 'project_risks' && column === 'source_risk_prompt_id') {
					return {
						data: duplicateSourcePromptIds.map((id, index) => {
							const prompt = prompts.find((item) => item.id === id);
							return {
								risk_id: `existing-risk-${index + 1}`,
								risk_ref: `Risk-HHH-00${index + 8}`,
								title: prompt?.risk_prompt_title ?? 'Existing risk',
								source_risk_prompt_id: id,
							};
						}),
						error: null,
					};
				}
				return { data: [], error: null };
			},
			maybeSingle() {
				calls.push(['maybeSingle', table, this.selectValue]);
				if (table === 'organisation_members') return { data: membershipWithWorkspace, error: null };
				if (table === 'projects') return { data: project, error: null };
				if (table === 'risk_prompt_libraries') return { data: library, error: null };
				if (table === 'project_risks') {
					return { data: { risk_sequence: existingSequence + insertedRisks.length + sequenceOffset }, error: null };
				}
				return { data: null, error: null };
			},
			single() {
				calls.push(['single', table]);
				if (table === 'project_risks') {
					if (sourcePromptConflictSet.has(this.insertPayload.source_risk_prompt_id)) {
						sourcePromptConflictSet.delete(this.insertPayload.source_risk_prompt_id);
						return {
							data: null,
							error: {
								code: '23505',
								message: 'duplicate key value violates unique constraint "project_risks_project_source_prompt_key"',
							},
						};
					}
					if (remainingRiskRefConflictAttempts > 0) {
						remainingRiskRefConflictAttempts -= 1;
						sequenceOffset += 1;
						return {
							data: null,
							error: {
								code: '23505',
								message: 'duplicate key value violates unique constraint "project_risks_project_sequence_key"',
							},
						};
					}
					const risk = {
						risk_id: `risk-${insertedRisks.length + 1}`,
						created_by: 'user-1',
						updated_by: 'user-1',
						created_at: '2026-07-09T10:00:00Z',
						updated_at: '2026-07-09T10:00:00Z',
						...this.insertPayload,
					};
					insertedRisks.push(risk);
					return { data: risk, error: null };
				}
				return { data: null, error: null };
			},
		};

		if (table === 'risk_prompt_areas') {
			query.eq = function eq(column, value) {
				this.filters[column] = value;
				calls.push(['eq', table, column, value]);
				return this;
			};
			query.select = function select(value) {
				this.selectValue = value;
				calls.push(['select', table, value]);
				return this;
			};
			query.eqResult = { data: activeAreas, error: null };
		}
		return query;
	};

	return {
		calls,
		insertedRisks,
		auth: {
			getUser() {
				calls.push(['getUser']);
				return { data: { user: { id: 'user-1' } }, error: null };
			},
		},
		from(table) {
			calls.push(['from', table]);
			if (table === 'risk_prompt_areas') {
				return {
					select(value) {
						calls.push(['select', table, value]);
						return this;
					},
					eq(column, value) {
						calls.push(['eq', table, column, value]);
						if (column === 'is_active') return { data: activeAreas, error: null };
						return this;
					},
				};
			}
			if (table === 'profiles') {
				return {
					select(value) {
						calls.push(['select', table, value]);
						return this;
					},
					in(column, values) {
						calls.push(['in', table, column, values]);
						return { data: [], error: null };
					},
				};
			}
			return makeQuery(table);
		},
	};
}

test('Risk migration creates explicit risk and note tables with non-generic primary keys', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create table public\.project_risks \(/);
	assert.match(sql, /risk_id uuid primary key default gen_random_uuid\(\)/);
	assert.match(sql, /create table public\.project_risk_notes \(/);
	assert.match(sql, /risk_note_id uuid primary key default gen_random_uuid\(\)/);
	assert.doesNotMatch(sql, /create table public\.project_risks \(\s*id uuid primary key/is);
	assert.doesNotMatch(sql, /create table public\.project_risk_notes \(\s*id uuid primary key/is);
});

test('Project reference support is added safely and scoped to the workspace', async () => {
	const sql = await migrationSql();
	assert.match(sql, /add column if not exists project_ref text/);
	assert.match(sql, /create or replace function public\.normalise_project_ref\(\)/);
	assert.match(sql, /new\.project_ref = upper\(btrim\(new\.project_ref\)\)/);
	assert.match(sql, /projects_project_ref_format_check/);
	assert.match(sql, /on public\.projects \(organisation_id, project_ref\)/);
	assert.match(sql, /where project_ref is not null/);
});

test('Project risks include required MVP fields', async () => {
	const sql = await migrationSql();
	for (const field of [
		'organisation_id uuid not null',
		'project_id uuid not null',
		'risk_ref text not null',
		'risk_sequence integer not null',
		'title text not null',
		"status text not null default 'open'",
		"probability text not null default 'medium'",
		"impact text not null default 'medium'",
		"rag_status text not null default 'blue'",
		'owner_id uuid references public.profiles(id)',
		'created_by uuid not null references public.profiles(id)',
		'updated_by uuid references public.profiles(id)',
		'archived_at timestamptz',
		'deleted_at timestamptz',
	]) {
		assert.match(sql, new RegExp(field.replace(/[()]/g, '\\$&')));
	}
});

test('Risk actioner migration adds a nullable profile reference without creating an Actions module', async () => {
	const sql = await allMigrationSql();
	assert.match(sql, /add column if not exists actioner_id uuid references public\.profiles\(id\)/);
	assert.match(sql, /create index if not exists project_risks_actioner_id_idx/);
	assert.match(sql, /Nullable primary risk actioner for MVP assignment/);
	assert.doesNotMatch(sql, /create\s+table\s+(public\.)?project_risk_actions\b/i);
});

test('Risk assessment completion marker supports Draft activation without backfill', async () => {
	const sql = await allMigrationSql();
	const markerMigration = await readFile(new URL('../supabase/migrations/20260712000100_project_risk_assessment_completion.sql', import.meta.url), 'utf8');
	assert.match(sql, /add column if not exists assessment_completed_at timestamptz/);
	assert.match(sql, /add column if not exists assessment_completed_by uuid references public\.profiles\(id\) on delete set null/);
	assert.match(sql, /Existing compatibility defaults are not backfilled/);
	assert.doesNotMatch(markerMigration, /update\s+public\.project_risks[\s\S]*assessment_completed_at/i);
});

test('Risk prompt-created risks keep source traceability and project duplicate protection', async () => {
	const sql = await allMigrationSql();
	assert.match(sql, /add column if not exists source_risk_prompt_id uuid references public\.risk_prompts\(id\)/);
	assert.match(sql, /project_risks_project_source_prompt_key/);
	assert.match(sql, /on public\.project_risks \(project_id, source_risk_prompt_id\)/);
	assert.match(sql, /where source_risk_prompt_id is not null[\s\S]*and deleted_at is null/);
	assert.match(sql, /project_risks_source_risk_prompt_id_idx/);
});

test('Project risk audit fields set updated_by when a risk is first raised', async () => {
	const sql = await allMigrationSql();
	assert.match(sql, /New manual and prompt-created project risks should carry both created_by and updated_by on insert/);
	assert.match(sql, /if tg_op = 'INSERT' then\s+new\.created_by = auth\.uid\(\);\s+new\.updated_by = auth\.uid\(\);/);
	assert.match(sql, /elsif tg_op = 'UPDATE' then\s+new\.updated_by = auth\.uid\(\);/);
	assert.match(sql, /raised-by and latest-updated-by are available immediately/);
});

test('Risk and note constraints cover status, scoring, references and attention levels', async () => {
	const sql = await allMigrationSql();
	assert.match(sql, /project_risks_risk_ref_format_check check \(risk_ref ~ '\^Risk-\[A-Z\]\[A-Z0-9\]\{1,9\}-\[0-9\]\{3\}\$'\)/);
	assert.match(sql, /update public\.project_risks[\s\S]*set status = 'closed'[\s\S]*where status = 'accepted'/);
	assert.match(sql, /project_risks_status_check[\s\S]*check \(status in \('draft', 'open', 'monitoring', 'mitigating', 'escalated', 'materialised', 'closed'\)\)/);
	assert.match(sql, /project_risks_probability_check check \(probability in \('low', 'medium', 'high'\)\)/);
	assert.match(sql, /project_risks_impact_check check \(impact in \('low', 'medium', 'high'\)\)/);
	assert.match(sql, /project_risks_rag_status_check check \(rag_status in \('blue', 'green', 'amber', 'red'\)\)/);
	assert.match(sql, /Legacy\/transitional stored concern value retained for compatibility/);
	assert.match(sql, /project_risk_notes_attention_level_check check \(attention_level in \('green', 'amber', 'red'\)\)/);
	assert.match(sql, /unique \(project_id, risk_sequence\)/);
	assert.match(sql, /unique \(organisation_id, risk_ref\)/);
});

test('Risk notes support threaded replies and audit fields', async () => {
	const sql = await migrationSql();
	assert.match(sql, /parent_risk_note_id uuid references public\.project_risk_notes\(risk_note_id\) on delete cascade/);
	assert.match(sql, /risk_id uuid not null references public\.project_risks\(risk_id\) on delete cascade/);
	assert.match(sql, /note text not null/);
	assert.match(sql, /attention_level text not null default 'green'/);
	assert.match(sql, /created_by uuid not null references public\.profiles\(id\)/);
	assert.match(sql, /created_at timestamptz not null default now\(\)/);
	assert.match(sql, /updated_at timestamptz/);
	assert.match(sql, /deleted_at timestamptz/);
});

test('Risk and note audit triggers bind created_by to auth.uid and prevent unattributed inserts', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create or replace function public\.set_project_risk_audit_fields\(\)/);
	assert.match(sql, /create trigger set_project_risk_audit_fields/);
	assert.match(sql, /before insert or update on public\.project_risks/);
	assert.match(sql, /new\.created_by = auth\.uid\(\)/);
	assert.match(sql, /Authenticated user is required for risk audit fields/);
	assert.match(sql, /create or replace function public\.set_project_risk_note_audit_fields\(\)/);
	assert.match(sql, /create trigger set_project_risk_note_audit_fields/);
	assert.match(sql, /before insert or update on public\.project_risk_notes/);
	assert.match(sql, /Authenticated user is required for risk note audit fields/);
	assert.match(sql, /new\.updated_by = auth\.uid\(\)/);
});

test('Risk note parent links are constrained to the same risk project and organisation', async () => {
	const sql = await migrationSql();
	assert.match(sql, /project_risk_notes_id_risk_project_organisation_key unique \(risk_note_id, risk_id, project_id, organisation_id\)/);
	assert.match(sql, /project_risk_notes_parent_scope_fk foreign key \(parent_risk_note_id, risk_id, project_id, organisation_id\)/);
	assert.match(sql, /references public\.project_risk_notes\(risk_note_id, risk_id, project_id, organisation_id\) on delete cascade/);
});

test('Risk tables have RLS and role policies matching workspace membership model', async () => {
	const sql = await migrationSql();
	assert.match(sql, /alter table public\.project_risks enable row level security/);
	assert.match(sql, /alter table public\.project_risk_notes enable row level security/);
	assert.match(sql, /is_active_organisation_member\(project_risks\.organisation_id\)/);
	assert.match(sql, /is_active_organisation_member\(project_risk_notes\.organisation_id\)/);
	assert.match(sql, /has_active_organisation_role\(project_risks\.organisation_id, array\['owner', 'admin', 'member'\]\)/);
	assert.match(sql, /has_active_organisation_role\(project_risk_notes\.organisation_id, array\['owner', 'admin', 'member'\]\)/);
	assert.doesNotMatch(sql, /array\['owner', 'admin', 'member', 'viewer'\]/);
});

test('Risk migration adds expected workflow indexes and updated_at triggers', async () => {
	const sql = await migrationSql();
	for (const indexName of [
		'project_risks_organisation_id_idx',
		'project_risks_project_id_idx',
		'project_risks_risk_ref_idx',
		'project_risks_status_idx',
		'project_risks_rag_status_idx',
		'project_risks_owner_id_idx',
		'project_risks_review_date_idx',
		'project_risks_due_date_idx',
		'project_risks_active_project_idx',
		'project_risk_notes_organisation_id_idx',
		'project_risk_notes_project_id_idx',
		'project_risk_notes_risk_id_idx',
		'project_risk_notes_parent_risk_note_id_idx',
		'project_risk_notes_attention_level_idx',
		'project_risk_notes_created_at_idx',
		'project_risk_notes_active_risk_idx',
	]) {
		assert.match(sql, new RegExp(`create index ${indexName}`));
	}
	assert.match(sql, /create trigger set_project_risks_updated_at/);
	assert.match(sql, /create trigger set_project_risk_notes_updated_at/);
	assert.doesNotMatch(sql, /create or replace function public\.set_updated_at/);
});

test('Risk foundation does not add out-of-scope RAID, notification, email, or dashboard live-data work', async () => {
	const sql = await allMigrationSql();
	for (const table of [
		'project_assumptions',
		'project_issues',
		'project_dependencies',
		'project_decisions',
		'project_actions',
		'project_timeline',
		'project_milestones',
		'project_risk_actions',
		'notification_events',
		'email_notifications',
	]) {
		assert.doesNotMatch(sql, new RegExp(`create\\s+table\\s+(public\\.)?${table}\\b`, 'i'));
	}
	const dashboard = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	assert.doesNotMatch(dashboard, /project_risks/);
	assert.doesNotMatch(dashboard, /risk_ref/);
});

test('Risk helper labels and profile fallbacks are stakeholder-friendly', () => {
	assert.equal(riskDisplayLabel('mitigating'), 'Mitigating');
	assert.equal(riskDisplayLabel('not_started'), 'Not Started');
	assert.equal(riskDisplayLabel(null, 'Not available'), 'Not available');
	assert.equal(riskRagTone('red'), 'red');
	assert.equal(riskRagTone('amber'), 'amber');
	assert.equal(riskRagTone('green'), 'green');
	assert.equal(riskRagTone('unexpected'), 'neutral');
	assert.equal(riskProfileName({ id: '1', display_name: 'Aisha Khan', email: 'aisha@example.com' }), 'Aisha Khan');
	assert.equal(riskProfileName(null), 'Unassigned');
});

test('Risk lifecycle helpers centralise Draft Active and Closed categorisation', () => {
	assert.deepEqual([...DRAFT_RISK_STATUSES], ['draft']);
	assert.deepEqual([...ACTIVE_RISK_STATUSES], ['open', 'monitoring', 'mitigating', 'escalated', 'materialised']);
	assert.ok(CLOSED_RISK_STATUSES.includes('closed'));
	assert.ok(CLOSED_RISK_STATUSES.includes('accepted'));
	assert.ok(CLOSED_RISK_STATUSES.includes('resolved'));
	assert.ok(CLOSED_RISK_STATUSES.includes('passed'));
	assert.ok(CLOSED_RISK_STATUSES.includes('retired'));
	assert.ok(CLOSED_RISK_STATUSES.includes('cancelled'));
	assert.ok(CLOSED_RISK_STATUSES.includes('rejected'));
	assert.equal(isDraftRiskStatus('draft'), true);
	for (const status of ACTIVE_RISK_STATUSES) {
		assert.equal(isActiveRiskStatus(status), true);
		assert.equal(riskLifecycleCategory(status), 'active');
	}
	for (const status of CLOSED_RISK_STATUSES) {
		assert.equal(isClosedRiskStatus(status), true);
		assert.equal(isActiveRiskStatus(status), false);
		assert.equal(riskLifecycleCategory(status), 'closed');
	}
	assert.equal(riskLifecycleCategory('draft'), 'draft');
	assert.equal(riskLifecycleCategory('open'), 'active');
	assert.equal(riskLifecycleCategory('closed'), 'closed');
	assert.equal(riskLifecycleLabel('draft'), 'Draft');
	assert.equal(riskLifecycleLabel('monitoring'), 'Active');
	assert.equal(riskLifecycleLabel('closed'), 'Closed');
});

test('Risk assurance roll-up follows the forgiving Amber contract', () => {
	assert.equal(deriveRiskAssuranceRollupTone(['green']), 'green');
	assert.equal(deriveRiskAssuranceRollupTone(['green', 'green']), 'green');
	assert.equal(deriveRiskAssuranceRollupTone(['amber']), 'amber');
	assert.equal(deriveRiskAssuranceRollupTone(['amber', 'green']), 'amber');
	assert.equal(deriveRiskAssuranceRollupTone(['amber', 'amber']), 'amber');
	assert.equal(deriveRiskAssuranceRollupTone(['amber', 'amber', 'amber']), 'amber');
	assert.equal(deriveRiskAssuranceRollupTone(['red']), 'red');
	assert.equal(deriveRiskAssuranceRollupTone(['red', 'amber']), 'red');
	assert.equal(deriveRiskAssuranceRollupTone(['amber', 'red', 'green']), 'red');
	assert.equal(deriveRiskAssuranceRollupTone(['neutral']), 'neutral');
	assert.equal(deriveRiskAssuranceRollupTone([]), 'neutral');
});

test('Risk Register control helpers normalise tabs search and sort safely', () => {
	assert.equal(normaliseRiskRegisterViewTab('need-action'), 'need-action');
	assert.equal(normaliseRiskRegisterViewTab('unexpected'), 'active');
	assert.equal(defaultRiskRegisterSortForView('active'), 'highest-exposure');
	assert.equal(defaultRiskRegisterSortForView('need-action'), 'action-needed');
	assert.equal(defaultRiskRegisterSortForView('draft'), 'highest-exposure');
	assert.equal(defaultRiskRegisterSortForView('closed'), 'recently-updated');
	assert.equal(normaliseRiskRegisterSort('review-due'), 'review-due');
	assert.equal(normaliseRiskRegisterSort('unsafe-sort'), 'highest-exposure');
	assert.deepEqual([...RISK_REGISTER_EXPOSURE_FILTERS], ['low', 'medium', 'high', 'critical', 'unassessed']);
	assert.equal(normaliseRiskRegisterSearch('  Risk-HHH  '), 'risk-hhh');
	assert.equal(riskMatchesRegisterSearch(registerRisk({ risk_ref: 'Risk-HHH-014' }), 'hhh-014'), true);
	assert.equal(riskMatchesRegisterSearch(registerRisk({ title: 'API performance may not meet launch demand' }), 'PERFORMANCE'), true);
	assert.equal(riskMatchesRegisterSearch(registerRisk({ title: 'Payment gateway delay' }), 'content'), false);
});

test('Risk Register view tabs are lifecycle-aware and Need action is driven by action state', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const criticalGreen = registerRisk({
		risk_ref: 'Risk-HHH-001',
		title: 'Critical but controlled',
		probability: 'high',
		impact: 'high',
	});
	const lowAmber = registerRisk({
		risk_id: 'risk-2',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		title: 'Low exposure missing due date',
		due_date: null,
	});
	const mediumRed = registerRisk({
		risk_id: 'risk-3',
		risk_ref: 'Risk-HHH-003',
		risk_sequence: 3,
		title: 'Medium owner missing',
		probability: 'medium',
		impact: 'medium',
		owner_id: null,
		owner: null,
	});
	const draft = registerRisk({
		risk_id: 'risk-4',
		risk_ref: 'Risk-HHH-004',
		risk_sequence: 4,
		status: 'draft',
		title: 'Draft supplier risk',
	});
	const closed = registerRisk({
		risk_id: 'risk-5',
		risk_ref: 'Risk-HHH-005',
		risk_sequence: 5,
		status: 'closed',
		title: 'Closed launch risk',
	});
	const risks = [criticalGreen, lowAmber, mediumRed, draft, closed];

	assert.equal(deriveRiskReferenceTone(criticalGreen, now), 'green');
	assert.equal(deriveRiskReferenceTone(lowAmber, now), 'amber');
	assert.equal(deriveRiskReferenceTone(mediumRed, now), 'red');
	assert.deepEqual(risks.filter((risk) => riskMatchesRegisterView(risk, 'active', now)).map((risk) => risk.risk_ref), [
		'Risk-HHH-001',
		'Risk-HHH-002',
		'Risk-HHH-003',
	]);
	assert.deepEqual(risks.filter((risk) => riskMatchesRegisterView(risk, 'need-action', now)).map((risk) => risk.risk_ref), [
		'Risk-HHH-002',
		'Risk-HHH-003',
	]);
	assert.equal(riskMatchesRegisterView(criticalGreen, 'need-action', now), false);
	assert.equal(riskMatchesRegisterView(lowAmber, 'need-action', now), true);
	assert.equal(riskMatchesRegisterView(draft, 'need-action', now), false);
	assert.equal(riskMatchesRegisterView(closed, 'need-action', now), false);
	assert.deepEqual(risks.filter((risk) => riskMatchesRegisterView(risk, 'draft', now)).map((risk) => risk.risk_ref), ['Risk-HHH-004']);
	assert.deepEqual(risks.filter((risk) => riskMatchesRegisterView(risk, 'closed', now)).map((risk) => risk.risk_ref), ['Risk-HHH-005']);
});

test('Risk Register search and filters combine across exposure action state owner and lifecycle', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const risks = [
		registerRisk({
			risk_ref: 'Risk-HHH-001',
			title: 'Critical controlled risk',
			probability: 'high',
			impact: 'high',
		}),
		registerRisk({
			risk_id: 'risk-2',
			risk_ref: 'Risk-HHH-002',
			risk_sequence: 2,
			title: 'Browser compatibility issue',
			due_date: null,
		}),
		registerRisk({
			risk_id: 'risk-3',
			risk_ref: 'Risk-HHH-003',
			risk_sequence: 3,
			title: 'Unassigned content migration risk',
			probability: 'medium',
			impact: 'medium',
			owner_id: null,
			owner: null,
		}),
		registerRisk({
			risk_id: 'risk-4',
			risk_ref: 'Risk-HHH-004',
		risk_sequence: 4,
		title: 'Draft security risk',
		status: 'draft',
		probability: 'medium',
		impact: 'medium',
	}),
		registerRisk({
			risk_id: 'risk-5',
			risk_ref: 'Risk-HHH-005',
			risk_sequence: 5,
			title: 'Resolved analytics risk',
			status: 'resolved',
		}),
	];

	assert.deepEqual(filterAndSortRisksForRegister(risks, {
		view: 'need-action',
		search: 'browser',
		exposure: 'low',
		actionState: 'amber',
		ownerId: 'owner-1',
		lifecycle: 'active',
	}, now).map((risk) => risk.risk_ref), ['Risk-HHH-002']);
	assert.equal(riskMatchesRegisterFilters(risks[0], { exposure: 'critical', actionState: 'green' }, now), true);
	assert.equal(riskMatchesRegisterFilters(risks[1], { exposure: 'low' }, now), true);
	assert.equal(riskExposureToneLabel(deriveRiskExposureTone('low', 'low')), 'Low');
	assert.equal(deriveRiskReferenceTone(risks[1], now), 'amber');
	assert.equal(riskMatchesRegisterFilters(risks[2], { ownerId: 'unassigned' }, now), true);
	assert.equal(riskMatchesRegisterFilters(risks[3], { view: 'draft', lifecycle: 'draft' }, now), true);
	assert.equal(riskMatchesRegisterFilters(risks[3], { view: 'draft', exposure: 'unassessed' }, now), true);
	assert.equal(riskMatchesRegisterFilters(risks[4], { view: 'closed', exposure: 'critical' }, now), false);
	assert.equal(riskMatchesRegisterFilters(risks[4], { view: 'closed', lifecycle: 'closed' }, now), true);
	assert.deepEqual(filterAndSortRisksForRegister(risks, { search: '' }, now).map((risk) => risk.risk_ref), [
		'Risk-HHH-001',
		'Risk-HHH-003',
		'Risk-HHH-002',
	]);
});

test('Risk Register exposure display normalises Draft and Closed lifecycle states', () => {
	const activeCritical = registerRisk({
		risk_ref: 'Risk-HHH-001',
		probability: 'high',
		impact: 'high',
	});
	const draftUnassessed = registerRisk({
		risk_ref: 'Risk-HHH-002',
		status: 'draft',
		probability: 'medium',
		impact: 'medium',
	});
	const draftEstimate = registerRisk({
		risk_ref: 'Risk-HHH-003',
		status: 'draft',
		probability: 'high',
		impact: 'medium',
	});
	const closedHistorical = registerRisk({
		risk_ref: 'Risk-HHH-004',
		status: 'closed',
		probability: 'high',
		impact: 'high',
	});

	assert.deepEqual(getRiskRegisterExposureDisplay(activeCritical), {
		value: 'critical',
		label: 'Critical',
		tone: 'risk-critical',
		ariaLabel: 'Risk-HHH-001 exposure: Critical.',
		isProvisional: false,
	});
	assert.deepEqual(getRiskRegisterExposureDisplay(draftUnassessed), {
		value: 'unassessed',
		label: 'Unassessed',
		tone: 'neutral',
		ariaLabel: 'Risk-HHH-002 estimated exposure is unassessed.',
		isProvisional: true,
	});
	assert.deepEqual(getRiskRegisterExposureDisplay(draftEstimate), {
		value: 'high',
		label: 'High',
		tone: 'risk-high',
		ariaLabel: 'Risk-HHH-003 estimated exposure: High.',
		isProvisional: true,
	});
	assert.deepEqual(getRiskRegisterExposureDisplay(closedHistorical), {
		value: 'none',
		label: '—',
		tone: 'neutral',
		ariaLabel: 'Risk-HHH-004 has no current exposure because it is closed.',
		isProvisional: false,
	});
});

test('Risk Register sort options prioritise exposure action state review date and updates explicitly', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const criticalGreen = registerRisk({
		risk_ref: 'Risk-HHH-001',
		risk_sequence: 1,
		title: 'Critical controlled',
		probability: 'high',
		impact: 'high',
		review_date: '2026-07-30',
		updated_at: '2026-06-20T10:00:00Z',
	});
	const highGreen = registerRisk({
		risk_id: 'risk-2',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		title: 'High controlled',
		probability: 'high',
		impact: 'medium',
		review_date: '2026-07-20',
		updated_at: '2026-06-21T10:00:00Z',
	});
	const mediumRed = registerRisk({
		risk_id: 'risk-3',
		risk_ref: 'Risk-HHH-003',
		risk_sequence: 3,
		title: 'Medium missing owner',
		probability: 'medium',
		impact: 'medium',
		owner_id: null,
		owner: null,
		review_date: '2026-07-15',
		updated_at: '2026-06-22T10:00:00Z',
	});
	const mediumAmber = registerRisk({
		risk_id: 'risk-4',
		risk_ref: 'Risk-HHH-004',
		risk_sequence: 4,
		title: 'Medium missing due',
		probability: 'medium',
		impact: 'medium',
		due_date: null,
		review_date: '2026-07-10',
		updated_at: '2026-06-23T10:00:00Z',
	});
	const mediumRedOverdue = registerRisk({
		risk_id: 'risk-5',
		risk_ref: 'Risk-HHH-005',
		risk_sequence: 5,
		title: 'Medium overdue review',
		probability: 'medium',
		impact: 'medium',
		review_date: '2026-06-01',
		updated_at: '2026-06-24T10:00:00Z',
	});
	const lowGreenRecent = registerRisk({
		risk_id: 'risk-6',
		risk_ref: 'Risk-HHH-006',
		risk_sequence: 6,
		title: 'Low recent',
		review_date: '2026-08-01',
		updated_at: '2026-06-25T10:00:00Z',
	});
	const closedOverdue = registerRisk({
		risk_id: 'risk-7',
		risk_ref: 'Risk-HHH-007',
		risk_sequence: 7,
		title: 'Closed stale review',
		status: 'closed',
		probability: 'medium',
		impact: 'medium',
		review_date: '2026-01-01',
		updated_at: '2026-06-26T10:00:00Z',
	});
	const risks = [lowGreenRecent, mediumAmber, highGreen, closedOverdue, mediumRedOverdue, criticalGreen, mediumRed];

	assert.deepEqual(filterAndSortRisksForRegister(risks, { sort: 'highest-exposure' }, now).map((risk) => risk.risk_ref), [
		'Risk-HHH-001',
		'Risk-HHH-002',
		'Risk-HHH-005',
		'Risk-HHH-003',
		'Risk-HHH-004',
		'Risk-HHH-006',
	]);
	assert.equal(compareRisksForRegister(mediumRed, mediumAmber, 'highest-exposure', now) < 0, true);
	assert.deepEqual(filterAndSortRisksForRegister(risks, { sort: 'action-needed' }, now).slice(0, 4).map((risk) => risk.risk_ref), [
		'Risk-HHH-005',
		'Risk-HHH-003',
		'Risk-HHH-004',
		'Risk-HHH-001',
	]);
	assert.deepEqual(filterAndSortRisksForRegister(risks, { sort: 'review-due' }, now).map((risk) => risk.risk_ref), [
		'Risk-HHH-005',
		'Risk-HHH-004',
		'Risk-HHH-003',
		'Risk-HHH-002',
		'Risk-HHH-001',
		'Risk-HHH-006',
	]);
	assert.deepEqual(filterAndSortRisksForRegister(risks, { sort: 'recently-updated' }, now).slice(0, 3).map((risk) => risk.risk_ref), [
		'Risk-HHH-006',
		'Risk-HHH-005',
		'Risk-HHH-004',
	]);
	assert.equal(filterAndSortRisksForRegister([closedOverdue, lowGreenRecent], { sort: 'review-due' }, now)[0].risk_ref, 'Risk-HHH-006');
});

test('Risk Register applies tab-specific default sorting for Draft and Closed views', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const draftUnassessed = registerRisk({
		risk_id: 'risk-1',
		risk_ref: 'Risk-HHH-001',
		risk_sequence: 1,
		status: 'draft',
		probability: 'medium',
		impact: 'medium',
		created_at: '2026-06-01T10:00:00Z',
	});
	const draftLow = registerRisk({
		risk_id: 'risk-2',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		status: 'draft',
		probability: 'low',
		impact: 'low',
		created_at: '2026-06-02T10:00:00Z',
	});
	const draftHighOlder = registerRisk({
		risk_id: 'risk-3',
		risk_ref: 'Risk-HHH-003',
		risk_sequence: 3,
		status: 'draft',
		probability: 'high',
		impact: 'medium',
		created_at: '2026-05-30T10:00:00Z',
		updated_at: '2026-06-22T10:00:00Z',
	});
	const draftHighNewer = registerRisk({
		risk_id: 'risk-4',
		risk_ref: 'Risk-HHH-004',
		risk_sequence: 4,
		status: 'draft',
		probability: 'high',
		impact: 'medium',
		created_at: '2026-06-03T10:00:00Z',
		updated_at: '2026-06-25T10:00:00Z',
	});
	const draftCritical = registerRisk({
		risk_id: 'risk-5',
		risk_ref: 'Risk-HHH-005',
		risk_sequence: 5,
		status: 'draft',
		probability: 'high',
		impact: 'high',
		created_at: '2026-06-04T10:00:00Z',
		updated_at: '2026-06-26T10:00:00Z',
	});
	const closedOlder = registerRisk({
		risk_id: 'risk-6',
		risk_ref: 'Risk-HHH-006',
		risk_sequence: 6,
		status: 'closed',
		updated_at: '2026-06-10T10:00:00Z',
	});
	const closedNewer = registerRisk({
		risk_id: 'risk-7',
		risk_ref: 'Risk-HHH-007',
		risk_sequence: 7,
		status: 'closed',
		updated_at: '2026-06-20T10:00:00Z',
	});

	const risks = [draftUnassessed, draftLow, draftHighNewer, closedOlder, draftCritical, closedNewer, draftHighOlder];
	assert.deepEqual(filterAndSortRisksForRegister(risks, { view: 'draft' }, now).map((risk) => risk.risk_ref), [
		'Risk-HHH-005',
		'Risk-HHH-003',
		'Risk-HHH-004',
		'Risk-HHH-002',
		'Risk-HHH-001',
	]);
	assert.deepEqual(filterAndSortRisksForRegister(risks, { view: 'closed' }, now).map((risk) => risk.risk_ref), [
		'Risk-HHH-007',
		'Risk-HHH-006',
	]);
	assert.deepEqual(filterAndSortRisksForRegister(risks, { view: 'draft', sort: 'recently-updated' }, now).slice(0, 2).map((risk) => risk.risk_ref), [
		'Risk-HHH-005',
		'Risk-HHH-004',
	]);
});

test('Risk Register pagination helpers normalise page state and ranges safely', () => {
	assert.equal(DEFAULT_RISK_REGISTER_PAGE_SIZE, 25);
	assert.deepEqual([...RISK_REGISTER_PAGE_SIZES], [10, 25, 50]);
	assert.equal(parseRiskRegisterPage(null), 1);
	assert.equal(parseRiskRegisterPage('0'), 1);
	assert.equal(parseRiskRegisterPage('-2'), 1);
	assert.equal(parseRiskRegisterPage('abc'), 1);
	assert.equal(parseRiskRegisterPage('2abc'), 1);
	assert.equal(parseRiskRegisterPage('3'), 3);
	assert.equal(parseRiskRegisterPageSize('10'), 10);
	assert.equal(parseRiskRegisterPageSize('25'), 25);
	assert.equal(parseRiskRegisterPageSize('50'), 50);
	assert.equal(parseRiskRegisterPageSize('7'), 25);
	assert.equal(parseRiskRegisterPageSize('abc'), 25);
	assert.equal(parseRiskRegisterPageSize('50px'), 25);

	assert.deepEqual(getRiskRegisterPaginationRange(68, 1, 25), {
		page: 1,
		pageSize: 25,
		totalItems: 68,
		totalPages: 3,
		startIndex: 0,
		endIndex: 25,
		startItem: 1,
		endItem: 25,
		hasPrevious: false,
		hasNext: true,
	});
	assert.deepEqual(getRiskRegisterPaginationRange(68, 2, 25), {
		page: 2,
		pageSize: 25,
		totalItems: 68,
		totalPages: 3,
		startIndex: 25,
		endIndex: 50,
		startItem: 26,
		endItem: 50,
		hasPrevious: true,
		hasNext: true,
	});
	assert.deepEqual(getRiskRegisterPaginationRange(68, 99, 25), {
		page: 3,
		pageSize: 25,
		totalItems: 68,
		totalPages: 3,
		startIndex: 50,
		endIndex: 68,
		startItem: 51,
		endItem: 68,
		hasPrevious: true,
		hasNext: false,
	});
	assert.deepEqual(getRiskRegisterPaginationRange(0, 4, 25), {
		page: 1,
		pageSize: 25,
		totalItems: 0,
		totalPages: 1,
		startIndex: 0,
		endIndex: 0,
		startItem: 0,
		endItem: 0,
		hasPrevious: false,
		hasNext: false,
	});
	assert.deepEqual(getRiskRegisterPageNumbers(6, 10, 5), [4, 5, 6, 7, 8]);
	assert.deepEqual(getRiskRegisterPageNumbers(1, 3, 5), [1, 2, 3]);
	assert.deepEqual(getRiskRegisterPageNumbers(4, Number.NaN, Number.NaN), [1]);
});

test('Risk Register pagination applies after filtering and deterministic sorting', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const risks = Array.from({ length: 32 }, (_, index) => {
		const sequence = index + 1;
		return registerRisk({
			risk_id: `risk-${sequence}`,
			risk_ref: `Risk-HHH-${String(sequence).padStart(3, '0')}`,
			risk_sequence: sequence,
			title: sequence % 2 === 0 ? `Payment search risk ${sequence}` : `Other risk ${sequence}`,
			probability: sequence % 3 === 0 ? 'high' : 'low',
			impact: sequence % 3 === 0 ? 'medium' : 'low',
			updated_at: new Date(Date.UTC(2026, 5, sequence, 10, 0, 0)).toISOString(),
		});
	});
	const filtered = filterAndSortRisksForRegister(risks, { search: 'payment search', sort: 'recently-updated' }, now);
	const firstPage = paginateRisksForRegister(filtered, 1, 10);
	const secondPage = paginateRisksForRegister(filtered, 2, 10);
	const lastPage = paginateRisksForRegister(filtered, 9, 10);
	const summary = summarizeRiskRegister(risks, now);
	const needsActionItems = getProjectRiskActionItems(risks, now);

	assert.equal(filtered.length, 16);
	assert.deepEqual(firstPage.items.map((risk) => risk.risk_ref), [
		'Risk-HHH-032',
		'Risk-HHH-030',
		'Risk-HHH-028',
		'Risk-HHH-026',
		'Risk-HHH-024',
		'Risk-HHH-022',
		'Risk-HHH-020',
		'Risk-HHH-018',
		'Risk-HHH-016',
		'Risk-HHH-014',
	]);
	assert.deepEqual(secondPage.items.map((risk) => risk.risk_ref), [
		'Risk-HHH-012',
		'Risk-HHH-010',
		'Risk-HHH-008',
		'Risk-HHH-006',
		'Risk-HHH-004',
		'Risk-HHH-002',
	]);
	assert.equal(lastPage.pagination.page, 2);
	assert.equal(lastPage.pagination.totalPages, 2);
	assert.equal(secondPage.pagination.startItem, 11);
	assert.equal(secondPage.pagination.endItem, 16);
	assert.deepEqual(summarizeRiskRegister(risks, now), summary);
	assert.deepEqual(getProjectRiskActionItems(risks, now), needsActionItems);
});

test('Risk Register summary helpers count lifecycle action state and exposure separately', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const highGreen = registerRisk({
		risk_ref: 'Risk-HHH-001',
		title: 'High exposure controlled risk',
		probability: 'high',
		impact: 'medium',
	});
	const lowRed = registerRisk({
		risk_id: 'risk-2',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		title: 'Low exposure missing owner',
		owner_id: null,
		owner: null,
	});
	const mediumAmber = registerRisk({
		risk_id: 'risk-3',
		risk_ref: 'Risk-HHH-003',
		risk_sequence: 3,
		title: 'Medium exposure missing due date',
		probability: 'medium',
		impact: 'medium',
		due_date: null,
	});
	const draftCritical = registerRisk({
		risk_id: 'risk-4',
		risk_ref: 'Risk-HHH-004',
		risk_sequence: 4,
		title: 'Draft unassessed risk',
		status: 'draft',
		probability: '',
		impact: '',
	});
	const closedCriticalRed = registerRisk({
		risk_id: 'risk-5',
		risk_ref: 'Risk-HHH-005',
		risk_sequence: 5,
		title: 'Closed critical historical risk',
		status: 'closed',
		probability: 'high',
		impact: 'high',
		owner_id: null,
		owner: null,
		review_date: '2026-01-01',
	});
	const risks = [highGreen, lowRed, mediumAmber, draftCritical, closedCriticalRed];

	assert.equal(countOpenRisks(risks), 3);
	assert.equal(countDraftRisks(risks), 1);
	assert.equal(countRisksNeedingAction(risks, now), 2);
	assert.equal(deriveRiskReferenceTone(highGreen, now), 'green');
	assert.equal(deriveRiskReferenceTone(lowRed, now), 'red');
	assert.equal(deriveRiskReferenceTone(mediumAmber, now), 'amber');
	assert.equal(getHighestActiveExposure(risks), 'high');
	assert.equal(getHighestActiveExposure([draftCritical, closedCriticalRed]), null);
	assert.deepEqual(summarizeRiskRegister(risks, now), {
		openRisks: 3,
		needAction: 2,
		highestExposure: 'high',
		draftRisks: 1,
	});
});

test('Risk Register summary handles empty closed-only and Low-highest scenarios without using health', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const closed = registerRisk({
		status: 'resolved',
		probability: 'high',
		impact: 'high',
		owner_id: null,
		owner: null,
	});
	const lowOnly = registerRisk({
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		title: 'Low exposure active risk',
		probability: 'low',
		impact: 'low',
	});

	assert.deepEqual(summarizeRiskRegister([], now), {
		openRisks: 0,
		needAction: 0,
		highestExposure: null,
		draftRisks: 0,
	});
	assert.deepEqual(summarizeRiskRegister([closed], now), {
		openRisks: 0,
		needAction: 0,
		highestExposure: null,
		draftRisks: 0,
	});
	assert.deepEqual(summarizeRiskRegister([lowOnly], now), {
		openRisks: 1,
		needAction: 0,
		highestExposure: 'low',
		draftRisks: 0,
	});
	assert.equal(riskExposureTone('low'), 'risk-low');
	assert.equal(riskExposureToneLabel(riskExposureTone('low')), 'Low');
});

test('Risk Register exposure distribution counts active exposure and closed risks only', () => {
	const risks = [
		registerRisk({
			risk_ref: 'Risk-HHH-001',
			risk_sequence: 1,
			title: 'Critical active risk',
			probability: 'high',
			impact: 'high',
		}),
		registerRisk({
			risk_id: 'risk-2',
			risk_ref: 'Risk-HHH-002',
			risk_sequence: 2,
			title: 'High active risk',
			probability: 'high',
			impact: 'medium',
		}),
		registerRisk({
			risk_id: 'risk-3',
			risk_ref: 'Risk-HHH-003',
			risk_sequence: 3,
			title: 'Medium active risk',
			probability: 'medium',
			impact: 'medium',
		}),
		registerRisk({
			risk_id: 'risk-4',
			risk_ref: 'Risk-HHH-004',
			risk_sequence: 4,
			title: 'Low active risk',
			probability: 'low',
			impact: 'low',
		}),
		registerRisk({
			risk_id: 'risk-5',
			risk_ref: 'Risk-HHH-005',
			risk_sequence: 5,
			title: 'Unassessed active risk',
			probability: '',
			impact: 'low',
		}),
		registerRisk({
			risk_id: 'risk-6',
			risk_ref: 'Risk-HHH-006',
			risk_sequence: 6,
			title: 'Draft critical risk',
			status: 'draft',
			probability: 'high',
			impact: 'high',
		}),
		registerRisk({
			risk_id: 'risk-7',
			risk_ref: 'Risk-HHH-007',
			risk_sequence: 7,
			title: 'Resolved critical risk',
			status: 'resolved',
			probability: 'high',
			impact: 'high',
		}),
		registerRisk({
			risk_id: 'risk-8',
			risk_ref: 'Risk-HHH-008',
			risk_sequence: 8,
			title: 'Retired high risk',
			status: 'retired',
			probability: 'high',
			impact: 'medium',
		}),
	];

	const counts = getActiveRiskExposureCounts(risks);
	const distribution = getExposureDistribution(risks);

	assert.deepEqual(counts, {
		low: 1,
		medium: 1,
		high: 1,
		critical: 1,
	});
	assert.equal(distribution.totalActiveRisks, 5);
	assert.equal(distribution.assessedActiveRisks, 4);
	assert.equal(distribution.unassessedActiveRisks, 1);
	assert.equal(distribution.closedRisks, 2);
	assert.equal(distribution.chartedRisks, 6);
	assert.deepEqual(distribution.segments.map(({ exposure, label, tone, count, percentage }) => ({
		exposure,
		label,
		tone,
		count,
		percentage,
	})), [
		{ exposure: 'critical', label: 'Critical', tone: 'risk-critical', count: 1, percentage: 17 },
		{ exposure: 'high', label: 'High', tone: 'risk-high', count: 1, percentage: 17 },
		{ exposure: 'medium', label: 'Medium', tone: 'risk-medium', count: 1, percentage: 17 },
		{ exposure: 'low', label: 'Low', tone: 'risk-low', count: 1, percentage: 17 },
		{ exposure: 'closed', label: 'Closed', tone: 'neutral', count: 2, percentage: 33 },
	]);
	assert.match(distribution.summary, /1 Critical/);
	assert.match(distribution.summary, /2 Closed/);
	assert.match(distribution.summary, /1 unassessed/);
	assert.equal(getHighestActiveExposure(risks), 'critical');
	assert.equal(summarizeRiskRegister(risks).highestExposure, 'critical');
	assert.equal(riskExposureTone('low'), 'risk-low');
	assert.notEqual(riskExposureTone('low'), 'green');
});

test('Risk Register exposure distribution handles lifecycle transitions and unassessed states honestly', () => {
	const activeMedium = registerRisk({
		risk_ref: 'Risk-HHH-001',
		risk_sequence: 1,
		title: 'Active medium risk',
		probability: 'medium',
		impact: 'medium',
	});
	const closedMedium = { ...activeMedium, status: 'closed' };
	const draftHigh = registerRisk({
		risk_id: 'risk-2',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		title: 'Draft high risk',
		status: 'draft',
		probability: 'high',
		impact: 'medium',
	});
	const openedHigh = { ...draftHigh, status: 'open' };
	const unassessedActive = registerRisk({
		risk_id: 'risk-3',
		risk_ref: 'Risk-HHH-003',
		risk_sequence: 3,
		title: 'Unassessed active risk',
		probability: '',
		impact: '',
	});

	assert.equal(getExposureDistribution([activeMedium]).segments.find((segment) => segment.exposure === 'medium')?.count, 1);
	assert.equal(getExposureDistribution([closedMedium]).assessedActiveRisks, 0);
	assert.equal(getExposureDistribution([closedMedium]).closedRisks, 1);
	assert.equal(getExposureDistribution([closedMedium]).chartedRisks, 1);
	assert.equal(getExposureDistribution([closedMedium]).segments.find((segment) => segment.exposure === 'closed')?.percentage, 100);
	assert.equal(getExposureDistribution([draftHigh]).assessedActiveRisks, 0);
	assert.equal(getExposureDistribution([draftHigh]).chartedRisks, 0);
	assert.equal(getExposureDistribution([openedHigh]).segments.find((segment) => segment.exposure === 'high')?.count, 1);
	assert.equal(getExposureDistribution([unassessedActive]).totalActiveRisks, 1);
	assert.equal(getExposureDistribution([unassessedActive]).assessedActiveRisks, 0);
	assert.equal(getExposureDistribution([unassessedActive]).unassessedActiveRisks, 1);
	assert.deepEqual(getActiveRiskExposureCounts([unassessedActive]), {
		low: 0,
		medium: 0,
		high: 0,
		critical: 0,
	});
	assert.equal(getHighestActiveExposure([unassessedActive]), null);
	assert.equal(getExposureChartSummary([], 0), 'No active or closed risks to chart.');
});

test('Risk Register exposure distribution percentages and summaries remain project-level', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const risks = Array.from({ length: 12 }, (_, index) => {
		const sequence = index + 1;
		const exposureFacts = sequence <= 2
			? { probability: 'high', impact: 'high' }
			: sequence <= 5
				? { probability: 'high', impact: 'medium' }
				: sequence <= 10
					? { probability: 'medium', impact: 'medium' }
					: { probability: 'low', impact: 'low' };
		return registerRisk({
			risk_id: `risk-${sequence}`,
			risk_ref: `Risk-HHH-${String(sequence).padStart(3, '0')}`,
			risk_sequence: sequence,
			title: sequence % 2 === 0 ? `Payment risk ${sequence}` : `Delivery risk ${sequence}`,
			...exposureFacts,
		});
	});
	const distribution = getExposureDistribution(risks);
	const filtered = filterAndSortRisksForRegister(risks, { search: 'Payment', exposure: 'low' }, now);
	const paginated = paginateRisksForRegister(filtered, 1, 10);

	assert.equal(getExposurePercentage(1, 3), 33);
	assert.deepEqual(distribution.segments.map(({ exposure, count, percentage }) => ({ exposure, count, percentage })), [
		{ exposure: 'critical', count: 2, percentage: 17 },
		{ exposure: 'high', count: 3, percentage: 25 },
		{ exposure: 'medium', count: 5, percentage: 42 },
		{ exposure: 'low', count: 2, percentage: 17 },
		{ exposure: 'closed', count: 0, percentage: 0 },
	]);
	assert.equal(filtered.length, 1);
	assert.equal(paginated.items.length, 1);
	assert.deepEqual(getExposureDistribution(risks), distribution);
	assert.equal(summarizeRiskRegister(risks, now).highestExposure, 'critical');
	assert.notDeepEqual(getExposureDistribution(filtered), distribution);
});

test('Risk Register summary remains an overall project summary while table filters narrow rows', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const risks = [
		registerRisk({
			risk_ref: 'Risk-HHH-001',
			title: 'High controlled risk',
			probability: 'high',
			impact: 'medium',
		}),
		registerRisk({
			risk_id: 'risk-2',
			risk_ref: 'Risk-HHH-002',
			risk_sequence: 2,
			title: 'Low missing owner',
			owner_id: null,
			owner: null,
		}),
		registerRisk({
			risk_id: 'risk-3',
			risk_ref: 'Risk-HHH-003',
			risk_sequence: 3,
			title: 'Draft risk',
			status: 'draft',
		}),
	];

	const filtered = filterAndSortRisksForRegister(risks, { view: 'need-action', exposure: 'low' }, now);
	assert.deepEqual(filtered.map((risk) => risk.risk_ref), ['Risk-HHH-002']);
	assert.deepEqual(summarizeRiskRegister(risks, now), {
		openRisks: 2,
		needAction: 1,
		highestExposure: 'high',
		draftRisks: 1,
	});
});

test('Risk Register Needs Action helper only derives items for active risks', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const activeMissingOwner = registerRisk({
		owner_id: null,
		owner: null,
	});
	const draftMissingOwner = registerRisk({
		risk_id: 'risk-2',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		status: 'draft',
		owner_id: null,
		owner: null,
	});
	const closedOverdue = registerRisk({
		risk_id: 'risk-3',
		risk_ref: 'Risk-HHH-003',
		risk_sequence: 3,
		status: 'closed',
		review_date: '2026-01-01',
		owner_id: null,
		owner: null,
	});
	const resolvedCritical = registerRisk({
		risk_id: 'risk-4',
		risk_ref: 'Risk-HHH-004',
		risk_sequence: 4,
		status: 'resolved',
		probability: 'high',
		impact: 'high',
		mitigation_plan: '',
	});

	assert.equal(isRiskEligibleForActionPanel(activeMissingOwner), true);
	assert.equal(isRiskEligibleForActionPanel(draftMissingOwner), false);
	assert.equal(isRiskEligibleForActionPanel(closedOverdue), false);
	for (const terminalStatus of ['accepted', 'resolved', 'passed', 'retired', 'cancelled', 'rejected']) {
		assert.equal(isRiskEligibleForActionPanel({ status: terminalStatus }), false);
		assert.deepEqual(getRiskActionItems({ ...closedOverdue, status: terminalStatus }, now), []);
	}
	assert.equal(getRiskActionItems(activeMissingOwner, now).some((item) => item.type === 'assign-owner'), true);
	assert.deepEqual(getRiskActionItems(draftMissingOwner, now), []);
	assert.deepEqual(getRiskActionItems(closedOverdue, now), []);
	assert.deepEqual(getRiskActionItems(resolvedCritical, now), []);
	assert.equal(getRiskActionItems({ ...activeMissingOwner, status: 'closed' }, now).length, 0);
	assert.equal(getRiskActionItems({ ...draftMissingOwner, status: 'open' }, now).some((item) => item.type === 'assign-owner'), true);
});

test('Risk Register Needs Action helper derives specific actions rather than exposure-only labels', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const incomplete = registerRisk({
		probability: '',
		impact: '',
		owner_id: null,
		owner: null,
		actioner_id: null,
		actioner: null,
		mitigation_plan: '',
		contingency_plan: '',
		review_date: null,
		due_date: null,
	});
	const completeCritical = registerRisk({
		risk_id: 'risk-2',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		title: 'Critical but well managed',
		probability: 'high',
		impact: 'high',
	});
	const lowMissingOwner = registerRisk({
		risk_id: 'risk-3',
		risk_ref: 'Risk-HHH-003',
		risk_sequence: 3,
		title: 'Low exposure unmanaged',
		owner_id: null,
		owner: null,
	});

	const itemTypes = getRiskActionItems(incomplete, now).map((item) => item.type);
	for (const expected of ['assign-owner', 'assign-actioner', 'add-mitigation', 'add-contingency', 'assess-exposure', 'set-review-date', 'set-due-date']) {
		assert.equal(itemTypes.includes(expected), true);
	}
	assert.deepEqual(getRiskActionItems(completeCritical, now), []);
	assert.equal(getRiskActionItems(lowMissingOwner, now).some((item) => item.type === 'assign-owner'), true);
	assert.equal(countRisksNeedingAction([incomplete], now), 1);
	assert.equal(getRiskActionItems(incomplete, now).length > countRisksNeedingAction([incomplete], now), true);
});

test('Risk Register Needs Action priority is deterministic and uses exposure as a tie-breaker', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const overdue = registerRisk({
		risk_ref: 'Risk-HHH-001',
		risk_sequence: 1,
		title: 'Overdue review',
		review_date: '2026-06-01',
	});
	const highMissingOwner = registerRisk({
		risk_id: 'risk-2',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		title: 'High missing owner',
		probability: 'high',
		impact: 'medium',
		owner_id: null,
		owner: null,
	});
	const lowMissingOwner = registerRisk({
		risk_id: 'risk-3',
		risk_ref: 'Risk-HHH-003',
		risk_sequence: 3,
		title: 'Low missing owner',
		owner_id: null,
		owner: null,
	});
	const dueSoon = registerRisk({
		risk_id: 'risk-4',
		risk_ref: 'Risk-HHH-004',
		risk_sequence: 4,
		title: 'Review due soon',
		review_date: '2026-07-01',
	});
	const highMissingMitigation = registerRisk({
		risk_id: 'risk-5',
		risk_ref: 'Risk-HHH-005',
		risk_sequence: 5,
		title: 'High missing mitigation',
		probability: 'high',
		impact: 'medium',
		mitigation_plan: '',
	});
	const ranked = getProjectRiskActionItems([dueSoon, highMissingMitigation, lowMissingOwner, highMissingOwner, overdue], now);

	assert.deepEqual(ranked.slice(0, 5).map((item) => `${item.riskReference}:${item.type}`), [
		'Risk-HHH-001:review-overdue',
		'Risk-HHH-002:assign-owner',
		'Risk-HHH-003:assign-owner',
		'Risk-HHH-004:review-due-soon',
		'Risk-HHH-005:add-mitigation',
	]);
	assert.equal(ranked.findIndex((item) => item.riskReference === 'Risk-HHH-002'), 1);
	assert.equal(ranked.findIndex((item) => item.riskReference === 'Risk-HHH-003'), 2);
	assert.deepEqual(getTopRiskActionItems([dueSoon, highMissingMitigation, lowMissingOwner, highMissingOwner, overdue], 2, now).map((item) => item.riskReference), [
		'Risk-HHH-001',
		'Risk-HHH-002',
	]);
	assert.deepEqual(rankRiskActionItems([ranked[3], ranked[0], ranked[1]]).map((item) => item.riskReference), [
		'Risk-HHH-001',
		'Risk-HHH-002',
		'Risk-HHH-004',
	]);
});

test('Risk Register Needs Action panel remains an overall project queue while table filters narrow rows', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const risks = [
		registerRisk({
			risk_ref: 'Risk-HHH-001',
			title: 'High controlled risk',
			probability: 'high',
			impact: 'medium',
		}),
		registerRisk({
			risk_id: 'risk-2',
			risk_ref: 'Risk-HHH-002',
			risk_sequence: 2,
			title: 'Low missing owner',
			owner_id: null,
			owner: null,
		}),
		registerRisk({
			risk_id: 'risk-3',
			risk_ref: 'Risk-HHH-003',
			risk_sequence: 3,
			title: 'Draft missing owner',
			status: 'draft',
			owner_id: null,
			owner: null,
		}),
	];
	const filtered = filterAndSortRisksForRegister(risks, { search: 'High controlled risk' }, now);
	const queue = getProjectRiskActionItems(risks, now);

	assert.deepEqual(filtered.map((risk) => risk.risk_ref), ['Risk-HHH-001']);
	assert.deepEqual(queue.map((item) => `${item.riskReference}:${item.type}`), ['Risk-HHH-002:assign-owner']);
	assert.equal(getTopRiskActionItems([risks[0]], 4, now).length, 0);
});

test('Risk create/edit validation covers references, required fields and dates', () => {
	assert.equal(buildRiskReference('HHH', 3), 'Risk-HHH-003');
	assert.throws(() => buildRiskReference('bad slug', 1), /valid project reference/);
	assert.equal(isRiskReviewDate('2026-02-28'), true);
	assert.equal(isRiskReviewDate('2026-02-31'), false);
	assert.deepEqual(validateRiskFormInput({
		title: ' ',
		status: 'unknown',
		probability: 'unknown',
		impact: 'unknown',
		reviewDate: '2026-02-31',
		dueDate: '2026-13-01',
	}), {
		title: 'Risk title is required.',
		status: 'Select a valid risk status.',
		probability: 'Select a valid probability.',
		impact: 'Select a valid impact.',
		reviewDate: 'Enter a valid review date.',
		dueDate: 'Enter a valid due date.',
	});
	assert.deepEqual(validateRiskFormInput({
		title: 'Title only draft',
		status: '',
		probability: '',
		impact: '',
		reviewDate: '',
		dueDate: '',
	}, { mode: 'create' }), {});
	assert.deepEqual(validateRiskFormInput({
		title: '   ',
		status: 'open',
		probability: '',
		impact: '',
		reviewDate: '',
		dueDate: '',
	}, { mode: 'create' }), {
		title: 'Risk title is required.',
	});
});

test('Risk activation readiness requires minimum Draft activation information only', () => {
	const now = new Date('2026-07-12T12:00:00Z');
	const readyDraft = registerRisk({
		status: 'draft',
		title: 'Supplier authority unclear',
		description: 'Supplier authority is unclear and could delay project decisions.',
		owner_id: 'owner-1',
		probability: 'medium',
		impact: 'high',
		assessment_completed_at: '2026-07-12T10:00:00Z',
		assessment_completed_by: 'user-1',
		review_date: '2026-07-12',
		actioner_id: null,
		due_date: null,
		mitigation_plan: '',
		contingency_plan: '',
	});

	assert.deepEqual(getRiskActivationReadiness(readyDraft, { now }), { ready: true, missing: [] });
	assert.equal(deriveRiskReferenceTone({ ...readyDraft, status: 'open' }, now), 'red');

	const missing = getRiskActivationReadiness({
		...readyDraft,
		title: ' ',
		description: 'short',
		owner_id: null,
		assessment_completed_at: null,
		review_date: '',
	}, { now });
	assert.equal(missing.ready, false);
	assert.deepEqual(missing.missing.map((requirement) => requirement.key), ['title', 'description', 'owner', 'assessment', 'review_date']);
	assert.match(missing.missing.find((requirement) => requirement.key === 'description')?.message ?? '', new RegExp(String(RISK_ACTIVATION_DESCRIPTION_MIN_LENGTH)));

	const overdue = getRiskActivationReadiness({ ...readyDraft, review_date: '2026-07-11' }, { now });
	assert.deepEqual(overdue.missing.map((requirement) => requirement.key), ['review_date']);

	const placeholderMedium = getRiskActivationReadiness({
		...readyDraft,
		probability: 'medium',
		impact: 'medium',
		assessment_completed_at: null,
	}, { now });
	assert.deepEqual(placeholderMedium.missing.map((requirement) => requirement.key), ['assessment']);
});

test('Risk exposure derives from probability and impact through the Watchtower default assessment', () => {
	assert.equal(deriveWatchtowerDefaultRiskExposure('low', 'low'), 'low');
	assert.equal(deriveWatchtowerDefaultRiskExposure('low', 'medium'), 'medium');
	assert.equal(deriveWatchtowerDefaultRiskExposure('medium', 'low'), 'medium');
	assert.equal(deriveWatchtowerDefaultRiskExposure('medium', 'medium'), 'medium');
	assert.equal(deriveWatchtowerDefaultRiskExposure('high', 'low'), 'medium');
	assert.equal(deriveWatchtowerDefaultRiskExposure('low', 'high'), 'medium');
	assert.equal(deriveWatchtowerDefaultRiskExposure('medium', 'high'), 'high');
	assert.equal(deriveWatchtowerDefaultRiskExposure('high', 'medium'), 'high');
	assert.equal(deriveWatchtowerDefaultRiskExposure('high', 'high'), 'critical');
	assert.equal(deriveWatchtowerDefaultRiskExposure('', 'low'), 'critical');
	assert.equal(deriveWatchtowerDefaultRiskExposure('low', undefined), 'critical');
	assert.equal(deriveRiskExposureTone('low', 'low'), 'risk-low');
	assert.equal(deriveRiskExposureTone('high', 'high'), 'risk-critical');
	assert.equal(deriveWatchtowerDefaultRiskExposureTone('high', 'medium'), 'risk-high');
	assert.equal(riskExposureToneLabel(deriveRiskExposureTone('low', 'low')), 'Low');
});

test('Watchtower default risk exposure display does not use green for Low exposure', async () => {
	const styles = await readFile(new URL('../src/styles/rag.css', import.meta.url), 'utf8');
	const component = await readFile(new URL('../src/components/app/RagReferencePill.astro', import.meta.url), 'utf8');
	const lowExposureRule = styles.slice(styles.indexOf('.rag-pill--risk-low,'), styles.indexOf('.rag-tile--attention-red'));

	assert.match(styles, /--risk-exposure-low-accent: #fde047/);
	assert.match(styles, /\.rag-pill--risk-low,[\s\S]*?--rag-accent: var\(--risk-exposure-low-accent\);/);
	assert.doesNotMatch(styles, /risk-exposure-low-accent: #6ee7a8/);
	assert.doesNotMatch(lowExposureRule, /--rag-green/);
	assert.match(component, /'risk-low'/);
	assert.equal(riskExposureToneLabel('risk-low'), 'Low');
});

test('Risk terminology contract leaves project health as Unknown', async () => {
	const dashboard = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	const projectDetails = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/details.astro', import.meta.url), 'utf8');
	const projectList = await readFile(new URL('../src/pages/app/projects/index.astro', import.meta.url), 'utf8');
	const combined = [dashboard, projectDetails, projectList].join('\n');

	assert.match(combined, /projectHealthLabel = 'Unknown'/);
	assert.doesNotMatch(combined, /healthTone\(projectAction|projectActionStates.*health|deriveRiskExposureTone\(.*health|deriveRiskActionStateTone\(.*health/i);
});

test('Risk assurance derives from governance and control quality signals', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ owner_id: null }), now), 'red');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ actioner_id: null }), now), 'red');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ review_date: null }), now), 'amber');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ review_date: '2026-06-01' }), now), 'red');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ due_date: null }), now), 'amber');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ contingency_plan: '' }), now), 'red');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ mitigation_plan: '', probability: 'high', impact: 'high' }), now), 'red');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ mitigation_plan: '', probability: 'medium', impact: 'medium' }), now), 'amber');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ status: 'materialised' }), now), 'red');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ status: 'escalated', owner_id: null }), now), 'red');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ status: 'escalated' }), now), 'green');
});

test('Risk review-date tone uses Red today and the MVP three-calendar-day Amber window', () => {
	const now = new Date('2026-07-12T12:00:00Z');

	assert.equal(RISK_REVIEW_DUE_SOON_WINDOW_DAYS, 3);
	assert.deepEqual(deriveRiskReviewDateTone(null, now), {
		tone: 'amber',
		value: 'No review date',
		status: 'missing',
	});
	assert.equal(deriveRiskReviewDateTone('2026-07-11', now).tone, 'red');
	assert.equal(deriveRiskReviewDateTone('2026-07-11', now).status, 'overdue');
	assert.equal(deriveRiskReviewDateTone('2026-07-12', now).tone, 'red');
	assert.equal(deriveRiskReviewDateTone('2026-07-12', now).status, 'overdue');
	assert.equal(deriveRiskReviewDateTone('2026-07-12', now).value, 'Due today');
	assert.equal(deriveRiskReviewDateTone('2026-07-13', now).tone, 'amber');
	assert.equal(deriveRiskReviewDateTone('2026-07-13', now).status, 'due-soon');
	assert.equal(deriveRiskReviewDateTone('2026-07-14', now).tone, 'amber');
	assert.equal(deriveRiskReviewDateTone('2026-07-15', now).tone, 'amber');
	assert.equal(deriveRiskReviewDateTone('2026-07-15', now).daysUntil, 3);
	assert.equal(deriveRiskReviewDateTone('2026-07-16', now).tone, 'green');
	assert.equal(deriveRiskReviewDateTone('2026-07-16', now).status, 'scheduled');
});

test('Review-date due-soon state feeds active action state without cumulative Amber escalation', () => {
	const now = new Date('2026-07-12T12:00:00Z');
	const dueTomorrow = assuredRiskFacts({
		review_date: '2026-07-13',
		due_date: '2026-08-01',
		updated_at: '2026-07-01T10:00:00Z',
	});

	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ status: 'draft', review_date: '2026-07-13' }), now), 'neutral');
	assert.equal(deriveRiskAssuranceTone(assuredRiskFacts({ status: 'closed', review_date: '2026-07-13' }), now), 'neutral');
	assert.equal(deriveRiskAssuranceTone(dueTomorrow, now), 'amber');
	assert.equal(deriveRiskActionStateTone(dueTomorrow, now), 'amber');
	assert.equal(deriveRiskActionStateTone({ ...dueTomorrow, due_date: null }, now), 'amber');
	assert.equal(deriveRiskActionStateTone({ ...dueTomorrow, owner_id: null }, now), 'red');
});

test('Risk action state uses governance assurance drivers separately from exposure', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	assert.equal(deriveRiskActionStateTone(assuredRiskFacts({ owner_id: null }), now), 'red');
	assert.equal(deriveRiskActionStateTone(assuredRiskFacts({ probability: 'medium', impact: 'medium' }), now), 'green');
	assert.equal(deriveRiskActionStateTone(assuredRiskFacts({ probability: 'high', impact: 'high' }), now), 'green');
	assert.equal(deriveRiskActionStateTone(assuredRiskFacts({ due_date: null }), now), 'amber');
	assert.equal(deriveRiskActionStateTone(assuredRiskFacts(), now), 'green');
});

test('Risk action state rationale names drivers separately from exposure display', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const criticalExposureManagedRisk = assuredRiskFacts({ probability: 'high', impact: 'high' });
	const lowerExposureGovernanceGap = assuredRiskFacts({
		probability: 'low',
		impact: 'low',
		owner_id: null,
		review_date: '2026-06-01',
	});

	const governanceDrivers = getRiskActionStateDrivers(lowerExposureGovernanceGap, now);

	assert.equal(deriveRiskExposureTone(criticalExposureManagedRisk.probability, criticalExposureManagedRisk.impact), 'risk-critical');
	assert.equal(riskExposureToneLabel(deriveRiskExposureTone(criticalExposureManagedRisk.probability, criticalExposureManagedRisk.impact)), 'Critical');
	assert.equal(deriveRiskActionStateTone(criticalExposureManagedRisk, now), 'green');
	assert.deepEqual(getRiskActionStateDrivers(criticalExposureManagedRisk, now), [{
		tone: 'green',
		message: 'No current action-state drivers found from exposure, governance data or review cadence.',
	}]);
	assert.equal(deriveRiskExposureTone(lowerExposureGovernanceGap.probability, lowerExposureGovernanceGap.impact), 'risk-low');
	assert.equal(deriveRiskActionStateTone(lowerExposureGovernanceGap, now), 'red');
	assert.ok(governanceDrivers.some((driver) => driver.message === 'Risk owner is missing.'));
	assert.ok(governanceDrivers.some((driver) => driver.message === 'Review date is overdue.'));
});

test('Long risk text does not alter exposure or action state', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const longManagedRisk = assuredRiskFacts({
		probability: 'low',
		impact: 'low',
		description: 'A detailed narrative '.repeat(40),
		mitigation_plan: 'Mitigation step with enough operational detail to fill the card. '.repeat(20),
		contingency_plan: 'Contingency step with named fallback owners and criteria. '.repeat(20),
	});

	assert.equal(deriveRiskExposureTone(longManagedRisk.probability, longManagedRisk.impact), 'risk-low');
	assert.equal(deriveRiskActionStateTone(longManagedRisk, now), 'green');
	assert.equal(deriveRiskAssuranceTone(longManagedRisk, now), 'green');
	assert.equal(getRiskAssuranceBlocks(registerRisk(longManagedRisk), now).find((block) => block.id === 'description')?.value, longManagedRisk.description.trim());
	assert.equal(getRiskAssuranceBlocks(registerRisk(longManagedRisk), now).find((block) => block.id === 'mitigation')?.value, longManagedRisk.mitigation_plan.trim());
	assert.equal(getRiskAssuranceBlocks(registerRisk(longManagedRisk), now).find((block) => block.id === 'contingency')?.value, longManagedRisk.contingency_plan.trim());
});

test('Project dashboard risk icon derives highest active risk assurance state only', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const greenRisk = assuredRiskFacts();
	const amberRisk = assuredRiskFacts({ review_date: null });
	const redRisk = assuredRiskFacts({ owner_id: null });

	assert.equal(deriveProjectRiskDashboardAssuranceTone([greenRisk, amberRisk, redRisk], now), 'red');
	assert.equal(deriveProjectRiskDashboardAssuranceTone([greenRisk, amberRisk], now), 'amber');
	assert.equal(deriveProjectRiskDashboardAssuranceTone([greenRisk], now), 'green');
	assert.equal(deriveProjectRiskDashboardAssuranceTone([], now), 'neutral');
});

test('Project dashboard risk icon excludes Draft and Closed risks', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const excludedRedRisks = [
		assuredRiskFacts({ status: 'draft', owner_id: null }),
		assuredRiskFacts({ status: 'closed', contingency_plan: '' }),
	];

	assert.equal(deriveProjectRiskDashboardAssuranceTone(excludedRedRisks, now), 'neutral');
	assert.equal(deriveProjectRiskDashboardAssuranceTone([
		...excludedRedRisks,
		assuredRiskFacts({ status: 'monitoring' }),
	], now), 'green');
});

test('Draft and Closed risks remain neutral across active action-state consumers', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const inactiveRedDriverRisks = [
		registerRisk({
			risk_id: 'risk-draft',
			risk_ref: 'Risk-HHH-010',
			risk_sequence: 10,
			status: 'draft',
			owner_id: null,
			actioner_id: null,
			review_date: '2026-01-01',
			due_date: '2026-01-01',
			mitigation_plan: '',
			contingency_plan: '',
			probability: 'high',
			impact: 'high',
			updated_at: '2026-01-01T10:00:00Z',
		}),
		registerRisk({
			risk_id: 'risk-closed',
			risk_ref: 'Risk-HHH-011',
			risk_sequence: 11,
			status: 'closed',
			owner_id: null,
			actioner_id: null,
			review_date: '2026-01-01',
			due_date: '2026-01-01',
			mitigation_plan: '',
			contingency_plan: '',
			probability: 'high',
			impact: 'high',
			updated_at: '2026-01-01T10:00:00Z',
		}),
	];

	for (const risk of inactiveRedDriverRisks) {
		assert.equal(deriveRiskAssuranceTone(risk, now), 'neutral');
		assert.equal(deriveRiskReferenceTone(risk, now), 'neutral');
		assert.equal(getRiskActionItems(risk, now).length, 0);
	}
	assert.deepEqual(inactiveRedDriverRisks.map((risk) => riskReferenceStatusLabel(risk, now)), ['Draft', 'Closed']);
	assert.equal(countRisksNeedingAction(inactiveRedDriverRisks, now), 0);
	assert.equal(deriveProjectRiskDashboardAssuranceTone(inactiveRedDriverRisks, now), 'neutral');
	assert.equal(deriveRiskTileAttentionSignal(inactiveRedDriverRisks, now), 'neutral');
	assert.equal(deriveProjectActionState(inactiveRedDriverRisks, now), 'green');
});

test('Active risk action state is consistent across detail register dashboard and project attention consumers', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const amberRisk = registerRisk({
		due_date: null,
	});
	const redRisk = registerRisk({
		risk_id: 'risk-2',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		owner_id: null,
		owner: null,
	});

	assert.equal(deriveRiskReferenceTone(amberRisk, now), 'amber');
	assert.equal(countRisksNeedingAction([amberRisk], now), 1);
	assert.deepEqual(getRiskActionItems(amberRisk, now).map((item) => item.type), ['set-due-date']);
	assert.equal(deriveProjectRiskDashboardAssuranceTone([amberRisk], now), 'amber');
	assert.equal(deriveRiskTileAttentionSignal([amberRisk], now), 'amber');
	assert.equal(deriveProjectActionState([amberRisk], now), 'amber');

	assert.equal(deriveRiskReferenceTone(redRisk, now), 'red');
	assert.equal(countRisksNeedingAction([redRisk], now), 1);
	assert.ok(getRiskActionItems(redRisk, now).some((item) => item.type === 'assign-owner'));
	assert.equal(deriveProjectRiskDashboardAssuranceTone([redRisk], now), 'red');
	assert.equal(deriveRiskTileAttentionSignal([redRisk], now), 'red');
	assert.equal(deriveProjectActionState([redRisk], now), 'red');
});

test('Review-date due tomorrow is Amber across detail register dashboard and project attention consumers', () => {
	const now = new Date('2026-07-12T12:00:00Z');
	const dueTomorrowRisk = registerRisk({
		review_date: '2026-07-13',
		due_date: '2026-08-01',
		updated_at: '2026-07-01T10:00:00Z',
	});
	const reviewBlock = getRiskAssuranceBlocks(dueTomorrowRisk, now).find((block) => block.id === 'review-date');

	assert.equal(reviewBlock?.tone, 'amber');
	assert.equal(reviewBlock?.prompt, 'Review risk soon');
	assert.equal(deriveRiskReferenceTone(dueTomorrowRisk, now), 'amber');
	assert.equal(deriveRiskActionStateTone(dueTomorrowRisk, now), 'amber');
	assert.equal(countRisksNeedingAction([dueTomorrowRisk], now), 1);
	assert.deepEqual(getRiskActionItems(dueTomorrowRisk, now).map((item) => item.type), ['review-due-soon']);
	assert.equal(deriveProjectRiskDashboardAssuranceTone([dueTomorrowRisk], now), 'amber');
	assert.equal(deriveRiskTileAttentionSignal([dueTomorrowRisk], now), 'amber');
	assert.equal(deriveProjectActionState([dueTomorrowRisk], now), 'amber');
});

test('Review-date due today is Red across detail register dashboard and project attention consumers', () => {
	const now = new Date('2026-07-12T12:00:00Z');
	const dueTodayRisk = registerRisk({
		review_date: '2026-07-12',
		due_date: '2026-08-01',
		updated_at: '2026-07-01T10:00:00Z',
	});
	const reviewBlock = getRiskAssuranceBlocks(dueTodayRisk, now).find((block) => block.id === 'review-date');

	assert.equal(reviewBlock?.tone, 'red');
	assert.equal(reviewBlock?.value, 'Due today');
	assert.equal(reviewBlock?.prompt, 'Update review date');
	assert.equal(deriveRiskReferenceTone(dueTodayRisk, now), 'red');
	assert.equal(deriveRiskActionStateTone(dueTodayRisk, now), 'red');
	assert.equal(countRisksNeedingAction([dueTodayRisk], now), 1);
	assert.deepEqual(getRiskActionItems(dueTodayRisk, now).map((item) => item.type), ['review-overdue']);
	assert.equal(deriveProjectRiskDashboardAssuranceTone([dueTodayRisk], now), 'red');
	assert.equal(deriveRiskTileAttentionSignal([dueTodayRisk], now), 'red');
	assert.equal(deriveProjectActionState([dueTodayRisk], now), 'red');
});

test('Risk Detail exposure uses the shared Draft display contract from the Register', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const untouchedDraft = registerRisk({
		status: 'draft',
		probability: 'medium',
		impact: 'medium',
	});
	const draftLowEstimate = registerRisk({
		risk_id: 'risk-low-draft',
		risk_ref: 'Risk-HHH-011',
		risk_sequence: 11,
		status: 'draft',
		probability: 'low',
		impact: 'low',
	});
	const draftHighEstimate = registerRisk({
		risk_id: 'risk-high-draft',
		risk_ref: 'Risk-HHH-012',
		risk_sequence: 12,
		status: 'draft',
		probability: 'high',
		impact: 'medium',
	});
	const activeMedium = registerRisk({
		risk_id: 'risk-active-medium',
		risk_ref: 'Risk-HHH-013',
		risk_sequence: 13,
		status: 'open',
		probability: 'medium',
		impact: 'medium',
	});
	const draftExposureBlock = getRiskAssuranceBlocks(untouchedDraft, now).find((block) => block.id === 'exposure');
	const draftRegisterExposure = getRiskRegisterExposureDisplay(untouchedDraft);
	const lowExposureBlock = getRiskAssuranceBlocks(draftLowEstimate, now).find((block) => block.id === 'exposure');
	const highExposureBlock = getRiskAssuranceBlocks(draftHighEstimate, now).find((block) => block.id === 'exposure');
	const activeExposureBlock = getRiskAssuranceBlocks(activeMedium, now).find((block) => block.id === 'exposure');

	assert.deepEqual(draftRegisterExposure, {
		value: 'unassessed',
		label: 'Unassessed',
		tone: 'neutral',
		ariaLabel: 'Risk-HHH-001 estimated exposure is unassessed.',
		isProvisional: true,
	});
	assert.equal(draftExposureBlock?.title, 'Estimated exposure');
	assert.equal(draftExposureBlock?.tone, draftRegisterExposure.tone);
	assert.equal(draftExposureBlock?.statusLabel, draftRegisterExposure.label);
	assert.equal(draftExposureBlock?.value, 'No estimated exposure has been recorded for this Draft risk.');
	assert.doesNotMatch(draftExposureBlock?.value ?? '', /Medium exposure|Medium probability \/ Medium impact/);

	assert.equal(lowExposureBlock?.title, 'Estimated exposure');
	assert.equal(lowExposureBlock?.tone, 'risk-low');
	assert.equal(lowExposureBlock?.statusLabel, 'Low');
	assert.match(lowExposureBlock?.value ?? '', /^Low estimated exposure\./);
	assert.match(lowExposureBlock?.value ?? '', /Watchtower default estimate: Low probability \/ Low impact/);
	assert.equal(getRiskRegisterExposureDisplay(draftLowEstimate).label, lowExposureBlock?.statusLabel);

	assert.equal(highExposureBlock?.title, 'Estimated exposure');
	assert.equal(highExposureBlock?.tone, 'risk-high');
	assert.equal(highExposureBlock?.statusLabel, 'High');
	assert.match(highExposureBlock?.value ?? '', /^High estimated exposure\./);
	assert.match(highExposureBlock?.value ?? '', /Watchtower default estimate: High probability \/ Medium impact/);
	assert.equal(getRiskRegisterExposureDisplay(draftHighEstimate).label, highExposureBlock?.statusLabel);

	assert.equal(activeExposureBlock?.title, 'Exposure');
	assert.equal(activeExposureBlock?.tone, 'risk-medium');
	assert.equal(activeExposureBlock?.statusLabel, 'Medium');
	assert.match(activeExposureBlock?.value ?? '', /^Medium exposure\./);
	assert.match(activeExposureBlock?.value ?? '', /Watchtower default assessment: Medium probability \/ Medium impact/);
	assert.equal(deriveRiskReferenceTone(untouchedDraft, now), 'neutral');
	assert.equal(deriveRiskReferenceTone(activeMedium, now), 'green');
	assert.equal(countRisksNeedingAction([untouchedDraft], now), 0);
	assert.equal(deriveProjectRiskDashboardAssuranceTone([untouchedDraft], now), 'neutral');
});

test('Draft and Closed risk display is neutral while exposure remains available', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const draftRisk = assuredRiskFacts({
		status: 'draft',
		owner_id: null,
		actioner_id: null,
		review_date: null,
		mitigation_plan: '',
		contingency_plan: '',
		probability: 'high',
		impact: 'high',
	});
	const closedRisk = assuredRiskFacts({
		status: 'closed',
		owner_id: null,
		actioner_id: null,
		review_date: null,
		mitigation_plan: '',
		contingency_plan: '',
		probability: 'high',
		impact: 'high',
	});
	const draftBlocks = new Map(getRiskAssuranceBlocks({
		risk_id: 'risk-draft',
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-010',
		risk_sequence: 10,
		title: 'Draft risk',
		description: '',
		rag_status: 'green',
		created_by: 'user-1',
		created_at: '2026-06-01T10:00:00Z',
		...draftRisk,
	}, now).map((block) => [block.id, block]));

	assert.equal(deriveRiskExposureTone(draftRisk.probability, draftRisk.impact), 'risk-critical');
	assert.equal(deriveRiskAssuranceTone(draftRisk, now), 'neutral');
	assert.equal(deriveRiskAssuranceTone(closedRisk, now), 'neutral');
	assert.equal(deriveRiskReferenceTone(draftRisk, now), 'neutral');
	assert.equal(deriveRiskReferenceTone(closedRisk, now), 'neutral');
	assert.equal(riskReferenceStatusLabel(draftRisk, now), 'Draft');
	assert.equal(riskReferenceStatusLabel(closedRisk, now), 'Closed');
	assert.equal(getRiskActionStateDrivers(draftRisk, now)[0].message, 'Draft risks do not drive active risk action state.');
	assert.equal(draftBlocks.get('owner').tone, 'neutral');
	assert.equal(draftBlocks.get('review-date').tone, 'neutral');
	assert.equal(draftBlocks.get('mitigation').tone, 'neutral');
	assert.equal(draftBlocks.get('contingency').tone, 'neutral');
	assert.equal(draftBlocks.get('exposure').tone, 'risk-critical');
	assert.equal(draftBlocks.get('exposure').statusLabel, 'Critical');
});

test('Project dashboard risk icon is not driven by exposure', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const highExposureWithGreenAssurance = assuredRiskFacts({
		probability: 'high',
		impact: 'high',
		mitigation_plan: 'Confirmed supplier alternate.',
		contingency_plan: 'Escalate through steering group.',
	});

	assert.equal(deriveRiskExposureTone(highExposureWithGreenAssurance.probability, highExposureWithGreenAssurance.impact), 'risk-critical');
	assert.equal(deriveRiskAssuranceTone(highExposureWithGreenAssurance, now), 'green');
	assert.equal(deriveProjectRiskDashboardAssuranceTone([highExposureWithGreenAssurance], now), 'green');
});

test('Risk assurance blocks derive MVP quality signals without using manual RAG as truth', () => {
	const blocks = getRiskAssuranceBlocks({
		risk_id: 'risk-1',
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-001',
		risk_sequence: 1,
		title: 'Supplier delay',
		description: '',
		status: 'open',
		probability: 'high',
		impact: 'high',
		rag_status: 'green',
		owner_id: null,
		review_date: '2026-06-01',
		due_date: null,
		mitigation_plan: '',
		contingency_plan: '',
		created_by: 'user-1',
		created_at: '2026-06-01T10:00:00Z',
		updated_at: '2026-04-01T10:00:00Z',
	}, new Date('2026-06-28T12:00:00Z'));
	const byId = new Map(blocks.map((block) => [block.id, block]));

	assert.equal(byId.get('description').tone, 'red');
	assert.equal(byId.get('owner').tone, 'red');
	assert.equal(byId.get('review-date').tone, 'red');
	assert.equal(byId.get('exposure').tone, 'risk-critical');
	assert.equal(byId.get('exposure').statusLabel, 'Critical');
	assert.match(byId.get('exposure').value, /Watchtower default assessment: High probability \/ High impact/);
	assert.match(byId.get('exposure').value, /^Critical exposure\./);
	assert.equal(byId.has('overall-concern'), false);
	assert.ok(getRiskActionStateDrivers({
		status: 'open',
		probability: 'high',
		impact: 'high',
		owner_id: null,
		actioner_id: null,
		review_date: '2026-06-01',
		due_date: null,
		mitigation_plan: '',
		contingency_plan: '',
		updated_at: '2026-04-01T10:00:00Z',
	}, new Date('2026-06-28T12:00:00Z')).some((driver) => driver.message === 'Risk owner is missing.'));
	assert.equal(byId.get('mitigation').tone, 'red');
	assert.equal(byId.get('contingency').tone, 'red');
	assert.equal(byId.get('updated').tone, 'red');
	assert.equal(byId.get('due-date').tone, 'amber');
	assert.equal(byId.get('actioner').tone, 'red');
	assert.equal(byId.get('actioner').value, 'No actioner assigned for a risk requiring action.');
	assert.equal(byId.get('owner').prompt, 'Set owner');
	assert.equal(byId.get('actioner').prompt, 'Assign actioner');
	assert.equal(byId.get('review-date').prompt, 'Update review date');
});

test('Risk action responsibility assurance follows WT-RISK-003 assignment states', () => {
	const baseRisk = {
		risk_id: 'risk-1',
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-001',
		risk_sequence: 1,
		title: 'Supplier delay',
		description: 'Supplier delivery may miss the agreed implementation window.',
		status: 'mitigating',
		probability: 'medium',
		impact: 'medium',
		rag_status: 'amber',
		owner_id: 'owner-1',
		review_date: null,
		due_date: null,
		mitigation_plan: '',
		contingency_plan: '',
		created_by: 'user-1',
		created_at: '2026-06-01T10:00:00Z',
		updated_at: '2026-06-20T10:00:00Z',
	};
	const actionerBlock = (risk) => getRiskAssuranceBlocks(risk, new Date('2026-06-28T12:00:00Z')).find((block) => block.id === 'actioner');

	assert.equal(actionerBlock({ ...baseRisk, status: 'mitigating', actioner_id: null }).tone, 'red');
	assert.equal(actionerBlock({ ...baseRisk, status: 'open', actioner_id: null }).tone, 'red');
	assert.equal(actionerBlock({ ...baseRisk, status: 'monitoring', actioner_id: null }).tone, 'red');
	assert.deepEqual(
		{
			tone: actionerBlock({ ...baseRisk, status: 'closed', actioner_id: null }).tone,
			statusLabel: actionerBlock({ ...baseRisk, status: 'closed', actioner_id: null }).statusLabel,
		},
		{ tone: 'neutral', statusLabel: 'Neutral' },
	);
	assert.deepEqual(
		{
			tone: actionerBlock({
				...baseRisk,
				actioner_id: 'actioner-1',
				actioner: { id: 'actioner-1', display_name: 'Mark Nesbit Professional' },
			}).tone,
			value: actionerBlock({
				...baseRisk,
				actioner_id: 'actioner-1',
				actioner: { id: 'actioner-1', display_name: 'Mark Nesbit Professional' },
			}).value,
			prompt: actionerBlock({
				...baseRisk,
				actioner_id: 'actioner-1',
				actioner: { id: 'actioner-1', display_name: 'Mark Nesbit Professional' },
			}).prompt,
		},
		{
			tone: 'green',
			value: 'Assigned to: Mark Nesbit Professional',
			prompt: 'Change actioner',
		},
	);
});

test('Risk Register data access filters by selected workspace and project', async () => {
	const client = createRiskClient([
		{
			risk_id: 'risk-1',
			organisation_id: 'workspace-1',
			project_id: 'project-1',
			risk_ref: 'Risk-HHH-001',
			risk_sequence: 1,
			title: 'Supplier delay',
			status: 'open',
			probability: 'medium',
			impact: 'high',
			rag_status: 'amber',
			created_by: 'user-1',
			created_at: '2026-06-01T10:00:00Z',
			updated_at: '2026-06-02T10:00:00Z',
		},
	]);

	const risks = await listProjectRisks('workspace-1', 'project-1', 'viewer', client);
	assert.equal(risks.length, 1);
	assert.deepEqual(
		client.calls.filter((call) => call[0] === 'eq'),
		[
			['eq', 'organisation_id', 'workspace-1'],
			['eq', 'project_id', 'project-1'],
		],
	);
	assert.deepEqual(
		client.calls.filter((call) => call[0] === 'is'),
		[
			['is', 'deleted_at', null],
			['is', 'archived_at', null],
		],
	);
	assert.ok(client.calls.some((call) => call[0] === 'from' && call[1] === 'project_risks'));
});

test('Source risk preview data access stays scoped to selected workspace and project', async () => {
	const client = createRiskClient([
		{
			risk_id: 'risk-1',
			organisation_id: 'workspace-1',
			project_id: 'project-1',
			risk_ref: 'Risk-HHH-001',
			risk_sequence: 1,
			title: 'Supplier delay',
			status: 'open',
			probability: 'low',
			impact: 'low',
			rag_status: 'green',
			created_by: 'user-1',
			created_at: '2026-06-01T10:00:00Z',
			updated_at: '2026-06-02T10:00:00Z',
		},
	]);

	const risks = await listProjectRisksByIds('workspace-1', 'project-1', ['risk-1', 'risk-1'], 'viewer', client);
	assert.equal(risks.length, 1);
	assert.deepEqual(
		client.calls.filter((call) => call[0] === 'eq'),
		[
			['eq', 'organisation_id', 'workspace-1'],
			['eq', 'project_id', 'project-1'],
		],
	);
	assert.deepEqual(client.calls.find((call) => call[0] === 'in'), ['in', 'risk_id', ['risk-1']]);
	assert.ok(client.calls.some((call) => call[0] === 'from' && call[1] === 'project_risks'));
});

test('Risk detail data access blocks cross-project and cross-workspace URL tampering', async () => {
	const client = createRiskClient([]);
	const risk = await getProjectRisk('workspace-1', 'project-1', 'risk-elsewhere', 'viewer', client);

	assert.equal(risk, null);
	assert.deepEqual(
		client.calls.filter((call) => call[0] === 'eq'),
		[
			['eq', 'organisation_id', 'workspace-1'],
			['eq', 'project_id', 'project-1'],
			['eq', 'risk_id', 'risk-elsewhere'],
		],
	);
	assert.ok(client.calls.some((call) => call[0] === 'maybeSingle'));
});

test('Risk comments use project risk notes as a scoped top-level comment stream', async () => {
	const listClient = createRiskClient([
		{
			risk_note_id: 'comment-1',
			organisation_id: 'workspace-1',
			project_id: 'project-1',
			risk_id: 'risk-1',
			parent_risk_note_id: null,
			note: 'Supplier response added.',
			attention_level: 'green',
			created_by: 'user-1',
			created_at: '2026-06-03T10:00:00Z',
		},
	]);
	const comments = await listProjectRiskComments('workspace-1', 'project-1', 'risk-1', 'viewer', listClient);

	assert.equal(comments.length, 1);
	assert.deepEqual(
		listClient.calls.filter((call) => call[0] === 'eq'),
		[
			['eq', 'organisation_id', 'workspace-1'],
			['eq', 'project_id', 'project-1'],
			['eq', 'risk_id', 'risk-1'],
		],
	);
	assert.ok(listClient.calls.some((call) => call[0] === 'from' && call[1] === 'project_risk_notes'));
	assert.ok(listClient.calls.some((call) => call[0] === 'is' && call[1] === 'parent_risk_note_id' && call[2] === null));
	assert.ok(listClient.calls.some((call) => call[0] === 'order' && call[1] === 'created_at' && call[2].ascending === false));

	const createClient = createRiskMutationClient();
	const comment = await createProjectRiskComment('alpha', 'delivery-hub', 'risk-1', '  Supplier response added.  ', createClient);
	const insertCall = createClient.calls.find((call) => call[0] === 'insert' && call[1] === 'project_risk_notes');

	assert.equal(comment.note, 'Supplier response added.');
	assert.deepEqual(insertCall[2], {
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_id: 'risk-1',
		parent_risk_note_id: null,
		note: 'Supplier response added.',
		attention_level: 'green',
	});
	assert.ok(!createClient.calls.some((call) => call[0] === 'from' && ['project_narrative_entries', 'attention_items', 'notification_events'].includes(call[1])));
});

test('Risk create helper writes a title-only manual Draft with generated reference and neutral consumers', async () => {
	const client = createRiskMutationClient({ existingSequence: 1 });
	const risk = await createProjectRisk('alpha', 'delivery-hub', {
		title: '  Supplier delay  ',
	}, client);

	assert.equal(risk.risk_ref, 'Risk-HHH-002');
	assert.equal(risk.status, 'draft');
	assert.equal(risk.rag_status, 'blue');
	assert.equal(getRiskRegisterExposureDisplay(risk).value, 'unassessed');
	assert.equal(getRiskRegisterExposureDisplay(risk).label, 'Unassessed');
	assert.equal(riskMatchesRegisterView(risk, 'draft'), true);
	assert.equal(riskMatchesRegisterView(risk, 'active'), false);
	assert.equal(riskMatchesRegisterView(risk, 'need-action'), false);
	assert.equal(countOpenRisks([risk]), 0);
	assert.equal(countDraftRisks([risk]), 1);
	assert.equal(countRisksNeedingAction([risk]), 0);
	assert.equal(deriveRiskReferenceTone(risk), 'neutral');
	assert.equal(deriveProjectRiskDashboardAssuranceTone([risk]), 'neutral');
	assert.equal(deriveRiskTileAttentionSignal([risk]), 'neutral');
	assert.equal(deriveProjectActionState([risk]), 'green');
	const insertCall = client.calls.find((call) => call[0] === 'insert' && call[1] === 'project_risks');
	assert.ok(insertCall);
	assert.deepEqual(insertCall[2], {
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		title: 'Supplier delay',
		description: null,
		status: 'draft',
		probability: 'medium',
		impact: 'medium',
		rag_status: 'blue',
		owner_id: null,
		actioner_id: null,
		review_date: null,
		due_date: null,
		mitigation_plan: null,
		contingency_plan: null,
	});
	assert.equal(Object.hasOwn(insertCall[2], 'source_risk_prompt_id'), false);
	const narrativeCalls = client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries');
	assert.equal(narrativeCalls.length, 0);
	assert.ok(!client.calls.some((call) => call[0] === 'from' && ['project_risk_notes', 'notification_events', 'attention_items'].includes(call[1])));
});

test('Risk create helper enforces Draft for crafted status payloads and retains optional detail', async () => {
	const client = createRiskMutationClient({ existingSequence: 1 });
	const reviewDate = isoDateOffsetFromToday(14);
	const dueDate = isoDateOffsetFromToday(30);
	const risk = await createProjectRisk('alpha', 'delivery-hub', {
		title: 'Supplier delay',
		description: 'Critical supplier date is moving.',
		status: 'open',
		probability: 'high',
		impact: 'medium',
		ragStatus: 'red',
		ownerId: 'owner-1',
		actionerId: 'actioner-1',
		reviewDate,
		dueDate,
		mitigationPlan: 'Confirm alternative supplier.',
		contingencyPlan: 'Escalate to steering group.',
	}, client);

	assert.equal(risk.status, 'draft');
	assert.equal(getRiskRegisterExposureDisplay(risk).value, 'high');
	const insertCall = client.calls.find((call) => call[0] === 'insert' && call[1] === 'project_risks');
	const { assessment_completed_at: assessmentCompletedAt, assessment_completed_by: assessmentCompletedBy, ...insertPayload } = insertCall[2];
	assert.match(assessmentCompletedAt, /^\d{4}-\d{2}-\d{2}T/);
	assert.equal(assessmentCompletedBy, 'user-1');
	assert.deepEqual(insertPayload, {
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		title: 'Supplier delay',
		description: 'Critical supplier date is moving.',
		status: 'draft',
		probability: 'high',
		impact: 'medium',
		rag_status: 'blue',
		owner_id: 'owner-1',
		actioner_id: 'actioner-1',
		review_date: reviewDate,
		due_date: dueDate,
		mitigation_plan: 'Confirm alternative supplier.',
		contingency_plan: 'Escalate to steering group.',
	});
	assert.equal(client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries').length, 0);

	for (const submittedStatus of ['closed', 'escalated', 'not-a-status']) {
		const craftedClient = createRiskMutationClient({ existingSequence: 1 });
		await createProjectRisk('alpha', 'delivery-hub', {
			title: `Crafted ${submittedStatus}`,
			status: submittedStatus,
			probability: '',
			impact: '',
		}, craftedClient);
		const craftedInsert = craftedClient.calls.find((call) => call[0] === 'insert' && call[1] === 'project_risks');
		assert.equal(craftedInsert[2].status, 'draft');
		assert.equal(craftedInsert[2].probability, 'medium');
		assert.equal(craftedInsert[2].impact, 'medium');
		assert.equal(craftedClient.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries').length, 0);
	}
});

test('Manual risk creation rejects missing or whitespace-only titles before mutation', async () => {
	for (const title of ['', '   ']) {
		const client = createRiskMutationClient();
		await assert.rejects(
			createProjectRisk('alpha', 'delivery-hub', {
				title,
				status: 'open',
				probability: '',
				impact: '',
			}, client),
			/Risk title is required/,
		);
		assert.ok(!client.calls.some((call) => call[0] === 'insert' && call[1] === 'project_risks'));
	}
});

test('Risk prompt selection creates scoped Draft risks with source prompt traceability', async () => {
	const client = createPromptDraftClient({ existingSequence: 1 });
	const result = await createDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001', 'WT-RP-001', 'WT-RP-002'], client);

	assert.equal(result.requestedCount, 2);
	assert.equal(result.createdCount, 2);
	assert.equal(result.skippedDuplicateCount, 0);
	assert.deepEqual(result.createdRisks.map((risk) => risk.risk_ref), ['Risk-HHH-002', 'Risk-HHH-003']);
	assert.deepEqual(result.createdRisks.map((risk) => getRiskRegisterExposureDisplay(risk).value), ['unassessed', 'unassessed']);
	assert.deepEqual(
		{
			risk_id: result.createdRisks[0].risk_id,
			organisation_id: result.createdRisks[0].organisation_id,
			project_id: result.createdRisks[0].project_id,
			risk_ref: result.createdRisks[0].risk_ref,
			risk_sequence: result.createdRisks[0].risk_sequence,
			created_by: result.createdRisks[0].created_by,
			updated_by: result.createdRisks[0].updated_by,
			created_at: result.createdRisks[0].created_at,
			updated_at: result.createdRisks[0].updated_at,
			source_risk_prompt_id: result.createdRisks[0].source_risk_prompt_id,
		},
		{
			risk_id: 'risk-1',
			organisation_id: 'workspace-1',
			project_id: 'project-1',
			risk_ref: 'Risk-HHH-002',
			risk_sequence: 2,
			created_by: 'user-1',
			updated_by: 'user-1',
			created_at: '2026-07-09T10:00:00Z',
			updated_at: '2026-07-09T10:00:00Z',
			source_risk_prompt_id: 'prompt-uuid-1',
		},
	);
	const riskInserts = client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_risks');
	assert.equal(riskInserts.length, 2);
	assert.deepEqual(riskInserts[0][2], {
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		title: 'Decision-making authority is unclear',
		description: 'Clarify decision ownership and escalation routes.',
		status: 'draft',
		probability: 'medium',
		impact: 'medium',
		owner_id: null,
		actioner_id: null,
		review_date: null,
		due_date: null,
		mitigation_plan: null,
		contingency_plan: null,
		rag_status: 'blue',
		source_risk_prompt_id: 'prompt-uuid-1',
	});
	assert.equal(riskInserts[1][2].source_risk_prompt_id, 'prompt-uuid-2');
	assert.ok(client.calls.some((call) => call[0] === 'in' && call[1] === 'risk_prompts' && call[2] === 'risk_prompt_id'));
	assert.ok(!client.calls.some((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries'));
});

test('Risk prompt draft preflight reports all-new, mixed and duplicate-only selections', async () => {
	const allNewClient = createPromptDraftClient();
	const allNew = await preflightDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001', 'WT-RP-002'], allNewClient);

	assert.equal(allNew.selectedPromptCount, 2);
	assert.equal(allNew.createableCount, 2);
	assert.equal(allNew.duplicateCount, 0);
	assert.equal(allNew.invalidPromptCount, 0);
	assert.deepEqual(allNew.createablePrompts.map((prompt) => prompt.title), [
		'Decision-making authority is unclear',
		'The team does not have enough capacity',
	]);
	assert.equal(allNewClient.insertedRisks.length, 0);

	const mixedClient = createPromptDraftClient({ duplicateSourcePromptIds: ['prompt-uuid-1'] });
	const mixed = await preflightDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001', 'WT-RP-002', 'WT-RP-003'], mixedClient);

	assert.equal(mixed.selectedPromptCount, 3);
	assert.equal(mixed.eligiblePromptCount, 2);
	assert.equal(mixed.createableCount, 1);
	assert.equal(mixed.duplicateCount, 1);
	assert.equal(mixed.invalidPromptCount, 1);
	assert.deepEqual(mixed.createablePrompts.map((prompt) => prompt.riskPromptId), ['WT-RP-002']);
	assert.deepEqual(mixed.duplicatePrompts.map((prompt) => ({
		riskPromptId: prompt.riskPromptId,
		existingRiskId: prompt.existingRiskId,
		existingRiskRef: prompt.existingRiskRef,
		title: prompt.title,
	})), [{
		riskPromptId: 'WT-RP-001',
		existingRiskId: 'existing-risk-1',
		existingRiskRef: 'Risk-HHH-008',
		title: 'Decision-making authority is unclear',
	}]);

	const duplicateOnlyClient = createPromptDraftClient({ duplicateSourcePromptIds: ['prompt-uuid-1', 'prompt-uuid-2'] });
	const duplicateOnly = await preflightDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001', 'WT-RP-002'], duplicateOnlyClient);
	assert.equal(duplicateOnly.createableCount, 0);
	assert.equal(duplicateOnly.duplicateCount, 2);
	assert.equal(duplicateOnlyClient.insertedRisks.length, 0);
});

test('Risk prompt draft creation skips duplicates and rejects read-only roles', async () => {
	const duplicateClient = createPromptDraftClient({
		existingSequence: 1,
		duplicateSourcePromptIds: ['prompt-uuid-1'],
	});
	const result = await createDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001', 'WT-RP-002'], duplicateClient);

	assert.equal(result.createdCount, 1);
	assert.equal(result.skippedDuplicateCount, 1);
	assert.equal(duplicateClient.insertedRisks[0].source_risk_prompt_id, 'prompt-uuid-2');
	assert.equal(duplicateClient.insertedRisks[0].risk_ref, 'Risk-HHH-002');

	const duplicateOnlyClient = createPromptDraftClient({
		duplicateSourcePromptIds: ['prompt-uuid-1', 'prompt-uuid-2'],
	});
	const duplicateOnlyResult = await createDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001', 'WT-RP-002'], duplicateOnlyClient);
	assert.equal(duplicateOnlyResult.createdCount, 0);
	assert.equal(duplicateOnlyResult.skippedDuplicateCount, 2);
	assert.equal(duplicateOnlyClient.insertedRisks.length, 0);

	const concurrentDuplicateClient = createPromptDraftClient({
		sourcePromptConflictIds: ['prompt-uuid-1'],
	});
	const concurrentResult = await createDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001', 'WT-RP-002'], concurrentDuplicateClient);
	assert.equal(concurrentResult.createdCount, 1);
	assert.equal(concurrentResult.skippedDuplicateCount, 1);
	assert.equal(concurrentDuplicateClient.insertedRisks[0].source_risk_prompt_id, 'prompt-uuid-2');
	assert.equal(concurrentDuplicateClient.insertedRisks[0].risk_ref, 'Risk-HHH-002');

	const viewerClient = createPromptDraftClient({ role: 'viewer' });
	await assert.rejects(
		createDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001'], viewerClient),
		/does not permit risk creation/,
	);
	assert.ok(!viewerClient.calls.some((call) => call[0] === 'from' && call[1] === 'risk_prompts'));

	const viewerPreflightClient = createPromptDraftClient({ role: 'viewer' });
	await assert.rejects(
		preflightDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001'], viewerPreflightClient),
		/does not permit risk creation/,
	);
	assert.ok(!viewerPreflightClient.calls.some((call) => call[0] === 'from' && call[1] === 'risk_prompts'));
});

test('Risk prompt draft creation re-checks duplicates after preflight', async () => {
	const preflightClient = createPromptDraftClient();
	const preflight = await preflightDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001', 'WT-RP-002'], preflightClient);
	assert.equal(preflight.createableCount, 2);

	const createClientAfterDuplicateAppears = createPromptDraftClient({
		duplicateSourcePromptIds: ['prompt-uuid-1'],
	});
	const result = await createDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001', 'WT-RP-002'], createClientAfterDuplicateAppears);

	assert.equal(result.createdCount, 1);
	assert.equal(result.skippedDuplicateCount, 1);
	assert.deepEqual(createClientAfterDuplicateAppears.insertedRisks.map((risk) => risk.source_risk_prompt_id), ['prompt-uuid-2']);
});

test('Risk prompt draft creation retries project reference collisions', async () => {
	const client = createPromptDraftClient({ existingSequence: 1, riskRefConflictAttempts: 1 });
	const result = await createDraftProjectRisksFromPrompts('alpha', 'delivery-hub', ['WT-RP-001'], client);
	const riskInsertCalls = client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_risks');

	assert.equal(result.createdCount, 1);
	assert.equal(result.createdRisks[0].risk_ref, 'Risk-HHH-003');
	assert.deepEqual(riskInsertCalls.map((call) => call[2].risk_ref), ['Risk-HHH-002', 'Risk-HHH-003']);
	assert.deepEqual(riskInsertCalls.map((call) => call[2].risk_sequence), [2, 3]);
	assert.equal(client.insertedRisks.length, 1);
});

test('Risk edit helper updates only scoped editable fields without narrative for Red staying Red', async () => {
	const client = createRiskMutationClient();
	const risk = await updateProjectRisk('alpha', 'delivery-hub', 'risk-1', {
		title: 'Supplier delay updated',
		description: 'New mitigation agreed.',
		status: 'mitigating',
		probability: 'medium',
		impact: 'high',
		ragStatus: 'green',
		ownerId: '',
		actionerId: '',
		reviewDate: '',
		dueDate: '',
		mitigationPlan: '',
		contingencyPlan: '',
	}, client);

	assert.equal(risk.title, 'Supplier delay updated');
	const updateCall = client.calls.find((call) => call[0] === 'update' && call[1] === 'project_risks');
	assert.deepEqual(updateCall[2], {
		title: 'Supplier delay updated',
		description: 'New mitigation agreed.',
		status: 'mitigating',
		probability: 'medium',
		impact: 'high',
		rag_status: 'red',
		owner_id: null,
		actioner_id: null,
		review_date: null,
		due_date: null,
		mitigation_plan: null,
		contingency_plan: null,
	});
	assert.deepEqual(
		client.calls.filter((call) => call[0] === 'eq' && call[1] === 'project_risks').map((call) => call.slice(2)),
		[
			['organisation_id', 'workspace-1'],
			['project_id', 'project-1'],
			['risk_id', 'risk-1'],
			['organisation_id', 'workspace-1'],
			['project_id', 'project-1'],
			['risk_id', 'risk-1'],
		],
	);
	assert.equal(client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries').length, 0);
});

test('Crafted Red active create payload still creates a neutral Draft without Narrative', async () => {
	const client = createRiskMutationClient({ existingSequence: 1 });
	const risk = await createProjectRisk('alpha', 'delivery-hub', {
		title: 'Critical supplier delay',
		description: 'Critical supplier date is moving.',
		status: 'open',
		probability: 'high',
		impact: 'high',
		ownerId: '',
		actionerId: '',
		reviewDate: '2026-07-10',
		dueDate: '2026-08-01',
		mitigationPlan: '',
		contingencyPlan: '',
	}, client);

	assert.equal(risk.status, 'draft');
	assert.equal(risk.rag_status, 'blue');
	assert.equal(deriveRiskReferenceTone(risk), 'neutral');
	const narrativeCalls = client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries');
	assert.equal(narrativeCalls.length, 0);
});

test('Updating an existing non-Red risk to Red action state creates a source-linked narrative entry', async () => {
	const reviewDate = isoDateOffsetFromToday(14);
	const dueDate = isoDateOffsetFromToday(30);
	const greenRisk = assuredRiskFacts({
		title: 'Supplier delay',
		risk_id: 'risk-1',
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-001',
		risk_sequence: 1,
		rag_status: 'green',
		created_by: 'user-1',
		created_at: '2026-06-01T10:00:00Z',
		review_date: reviewDate,
		due_date: dueDate,
	});
	const client = createRiskMutationClient({ existingRisk: greenRisk });

	await updateProjectRisk('alpha', 'delivery-hub', 'risk-1', {
		title: 'Supplier delay',
		description: 'Critical supplier date is moving.',
		status: 'open',
		probability: 'high',
		impact: 'high',
		ownerId: '',
		actionerId: 'actioner-1',
		reviewDate,
		dueDate,
		mitigationPlan: 'Confirm alternative supplier.',
		contingencyPlan: 'Escalate to steering group.',
	}, client);

	const narrativeCalls = client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries');
	assert.equal(narrativeCalls.length, 1);
	assert.deepEqual(narrativeCalls[0][2], {
		project_id: 'project-1',
		source_type: 'risk',
		source_record_id: 'risk-1',
		source_ref: 'Risk-HHH-001',
		attention_level: 'red',
		title: 'Risk became Red: Risk-HHH-001 — Supplier delay',
		details: 'Action state: Red. Lifecycle status: Open. Reason: Owner is missing.',
		created_timezone: null,
	});
});

test('Opening a Draft risk creates an opened narrative without a duplicate Red narrative', async () => {
	const reviewDate = isoDateOffsetFromToday(14);
	const dueDate = isoDateOffsetFromToday(30);
	const draftRisk = assuredRiskFacts({
		title: 'Supplier delay',
		risk_id: 'risk-1',
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-001',
		risk_sequence: 1,
		status: 'draft',
		probability: 'high',
		impact: 'high',
		rag_status: 'red',
		created_by: 'user-1',
		created_at: '2026-06-01T10:00:00Z',
	});
	const client = createRiskMutationClient({ existingRisk: draftRisk });

	await updateProjectRisk('alpha', 'delivery-hub', 'risk-1', {
		title: 'Supplier delay',
		description: 'Critical supplier date is moving.',
		status: 'open',
		probability: 'high',
		impact: 'high',
		ownerId: 'owner-1',
		actionerId: 'actioner-1',
		reviewDate,
		dueDate,
		mitigationPlan: 'Confirm alternative supplier.',
		contingencyPlan: 'Escalate to steering group.',
	}, client);

	const narrativeCalls = client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries');
	assert.equal(narrativeCalls.length, 1);
	assert.equal(narrativeCalls[0][2].title, 'Risk opened: Risk-HHH-001');
	assert.equal(narrativeCalls[0][2].source_type, 'risk');
	assert.equal(narrativeCalls[0][2].source_record_id, 'risk-1');
	assert.doesNotMatch(narrativeCalls[0][2].title, /became Red/);
});

test('Lifecycle transition helper opens closes and reopens risks with notes and source-linked narrative', async () => {
	const draftClient = createRiskMutationClient({
		existingRisk: {
			status: 'draft',
			rag_status: 'red',
			description: 'Supplier authority is unclear and could delay project decisions.',
			owner_id: 'owner-1',
			probability: 'high',
			impact: 'high',
			assessment_completed_at: '2026-07-12T10:00:00Z',
			assessment_completed_by: 'user-1',
			review_date: isoDateOffsetFromToday(14),
		},
	});
	await transitionProjectRiskLifecycle('alpha', 'delivery-hub', 'risk-1', 'open', 'Ready for active management.', draftClient);
	let updateCall = draftClient.calls.find((call) => call[0] === 'update' && call[1] === 'project_risks');
	let noteCall = draftClient.calls.find((call) => call[0] === 'insert' && call[1] === 'project_risk_notes');
	let narrativeCall = draftClient.calls.find((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries');
	assert.deepEqual(updateCall[2], { status: 'open', rag_status: 'red' });
	assert.equal(noteCall[2].note, 'Open note: Ready for active management.');
	assert.equal(narrativeCall[2].title, 'Risk opened: Risk-HHH-001');

	const closeClient = createRiskMutationClient({ existingRisk: { status: 'open', rag_status: 'green' } });
	await transitionProjectRiskLifecycle('alpha', 'delivery-hub', 'risk-1', 'close', 'Mitigation completed.', closeClient);
	updateCall = closeClient.calls.find((call) => call[0] === 'update' && call[1] === 'project_risks');
	noteCall = closeClient.calls.find((call) => call[0] === 'insert' && call[1] === 'project_risk_notes');
	narrativeCall = closeClient.calls.find((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries');
	assert.deepEqual(updateCall[2], { status: 'closed', rag_status: 'green' });
	assert.equal(noteCall[2].note, 'Closure note: Mitigation completed.');
	assert.equal(narrativeCall[2].title, 'Risk closed: Risk-HHH-001');
	assert.equal(narrativeCall[2].attention_level, 'neutral');
	assert.match(narrativeCall[2].details, /Mitigation completed/);

	const reopenClient = createRiskMutationClient({ existingRisk: { status: 'closed', rag_status: 'green' } });
	await transitionProjectRiskLifecycle('alpha', 'delivery-hub', 'risk-1', 'reopen', 'Supplier date moved again.', reopenClient);
	updateCall = reopenClient.calls.find((call) => call[0] === 'update' && call[1] === 'project_risks');
	noteCall = reopenClient.calls.find((call) => call[0] === 'insert' && call[1] === 'project_risk_notes');
	narrativeCall = reopenClient.calls.find((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries');
	assert.deepEqual(updateCall[2], { status: 'open', rag_status: 'red' });
	assert.equal(noteCall[2].note, 'Reopen note: Supplier date moved again.');
	assert.equal(narrativeCall[2].title, 'Risk reopened: Risk-HHH-001');
	assert.equal(narrativeCall[2].attention_level, 'neutral');
	assert.match(narrativeCall[2].details, /Supplier date moved again/);
});

test('Draft activation gate blocks incomplete and crafted lifecycle changes before mutation or narrative', async () => {
	const incompleteClient = createRiskMutationClient({
		existingRisk: {
			status: 'draft',
			title: 'Supplier delay',
			description: 'Too short',
			owner_id: null,
			probability: 'medium',
			impact: 'medium',
			assessment_completed_at: null,
			review_date: null,
		},
	});
	await assert.rejects(
		transitionProjectRiskLifecycle('alpha', 'delivery-hub', 'risk-1', 'open', 'Ready?', incompleteClient),
		/minimum activation information|Draft risk cannot be activated/,
	);
	assert.ok(!incompleteClient.calls.some((call) => call[0] === 'update' && call[1] === 'project_risks'));
	assert.ok(!incompleteClient.calls.some((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries'));

	for (const submittedStatus of ['monitoring', 'mitigating', 'escalated', 'materialised', 'closed']) {
		const client = createRiskMutationClient({
			existingRisk: {
				status: 'draft',
				description: 'Supplier authority is unclear and could delay project decisions.',
				owner_id: 'owner-1',
				probability: 'medium',
				impact: 'high',
				assessment_completed_at: '2026-07-12T10:00:00Z',
				assessment_completed_by: 'user-1',
				review_date: isoDateOffsetFromToday(14),
			},
		});
		await assert.rejects(
			updateProjectRisk('alpha', 'delivery-hub', 'risk-1', {
				title: 'Supplier delay',
				description: 'Supplier authority is unclear and could delay project decisions.',
				status: submittedStatus,
				probability: 'medium',
				impact: 'high',
				ownerId: 'owner-1',
				actionerId: '',
				reviewDate: isoDateOffsetFromToday(14),
				dueDate: '',
				mitigationPlan: '',
				contingencyPlan: '',
			}, client),
			submittedStatus === 'closed'
				? /cannot be closed before activation/
				: /must be activated as Open/,
		);
		assert.ok(!client.calls.some((call) => call[0] === 'update' && call[1] === 'project_risks'));
		assert.ok(!client.calls.some((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries'));
	}
});

test('Updating a Green risk to Amber does not create a narrative entry', async () => {
	const reviewDate = isoDateOffsetFromToday(14);
	const dueDate = isoDateOffsetFromToday(30);
	const greenRisk = assuredRiskFacts({
		title: 'Supplier delay',
		risk_id: 'risk-1',
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-001',
		risk_sequence: 1,
		rag_status: 'green',
		created_by: 'user-1',
		created_at: '2026-06-01T10:00:00Z',
		review_date: reviewDate,
		due_date: dueDate,
	});
	const client = createRiskMutationClient({ existingRisk: greenRisk });

	await updateProjectRisk('alpha', 'delivery-hub', 'risk-1', {
		title: 'Supplier delay',
		description: 'Critical supplier date is moving.',
		status: 'open',
		probability: 'medium',
		impact: 'low',
		ownerId: 'owner-1',
		actionerId: 'actioner-1',
		reviewDate,
		dueDate: '',
		mitigationPlan: 'Confirm alternative supplier.',
		contingencyPlan: 'Escalate to steering group.',
	}, client);

	assert.equal(client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries').length, 0);
});

test('Routine owner, actioner and review date edits do not create narrative entries while concern stays non-Red', async () => {
	const reviewDate = isoDateOffsetFromToday(14);
	const laterReviewDate = isoDateOffsetFromToday(21);
	const dueDate = isoDateOffsetFromToday(30);
	const greenRisk = assuredRiskFacts({
		title: 'Supplier delay',
		risk_id: 'risk-1',
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-001',
		risk_sequence: 1,
		rag_status: 'green',
		created_by: 'user-1',
		created_at: '2026-06-01T10:00:00Z',
		review_date: reviewDate,
		due_date: dueDate,
	});

	for (const input of [
		{ ownerId: 'owner-2', actionerId: 'actioner-1', reviewDate },
		{ ownerId: 'owner-1', actionerId: 'actioner-2', reviewDate },
		{ ownerId: 'owner-1', actionerId: 'actioner-1', reviewDate: laterReviewDate },
	]) {
		const client = createRiskMutationClient({ existingRisk: greenRisk });
		await updateProjectRisk('alpha', 'delivery-hub', 'risk-1', {
			title: 'Supplier delay',
			description: 'Critical supplier date is moving.',
			status: 'open',
			probability: 'low',
			impact: 'low',
			ownerId: input.ownerId,
			actionerId: input.actionerId,
			reviewDate: input.reviewDate,
			dueDate,
			mitigationPlan: 'Confirm alternative supplier.',
			contingencyPlan: 'Escalate to steering group.',
		}, client);
		assert.equal(client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries').length, 0);
	}
});

test('Viewer writes and inactive owner or actioner assignments are rejected before risk mutation', async () => {
	const viewerClient = createRiskMutationClient({ role: 'viewer' });
	await assert.rejects(
		createProjectRisk('alpha', 'delivery-hub', {
			title: 'No write',
			status: 'open',
			probability: 'medium',
			impact: 'medium',
			ragStatus: 'blue',
		}, viewerClient),
		/risk creation/,
	);
	assert.ok(!viewerClient.calls.some((call) => call[0] === 'insert'));

	const ownerClient = createRiskMutationClient({ ownerIsActive: false });
	await assert.rejects(
		updateProjectRisk('alpha', 'delivery-hub', 'risk-1', {
			title: 'Owner mismatch',
			status: 'open',
			probability: 'medium',
			impact: 'medium',
			ragStatus: 'blue',
			ownerId: 'owner-1',
		}, ownerClient),
		/active workspace member/,
	);
	assert.ok(!ownerClient.calls.some((call) => call[0] === 'update'));

	const actionerClient = createRiskMutationClient({ actionerIsActive: false });
	await assert.rejects(
		createProjectRisk('alpha', 'delivery-hub', {
			title: 'Actioner mismatch',
			status: 'open',
			probability: 'medium',
			impact: 'medium',
			ragStatus: 'blue',
			actionerId: 'actioner-1',
		}, actionerClient),
		/active workspace member/,
	);
	assert.ok(!actionerClient.calls.some((call) => call[0] === 'insert'));
});

test('Expired risk create/edit sessions fail before mutation', async () => {
	const authError = new Error('invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired');
	const createClient = createRiskMutationClient({ authError });
	await assert.rejects(
		createProjectRisk('alpha', 'delivery-hub', {
			title: 'Expired session',
			status: 'open',
			probability: 'medium',
			impact: 'medium',
			ragStatus: 'blue',
		}, createClient, 'expired-token'),
		/invalid JWT/,
	);
	assert.ok(!createClient.calls.some((call) => call[0] === 'insert'));

	const updateClient = createRiskMutationClient({ authError });
	await assert.rejects(
		updateProjectRisk('alpha', 'delivery-hub', 'risk-1', {
			title: 'Expired session',
			status: 'open',
			probability: 'medium',
			impact: 'medium',
			ragStatus: 'blue',
		}, updateClient, 'expired-token'),
		/invalid JWT/,
	);
	assert.ok(!updateClient.calls.some((call) => call[0] === 'update'));
});

test('Risk Register route renders a table-led scoped register and create access state', async () => {
	const route = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro', import.meta.url), 'utf8');

	assert.match(route, /data-risk-register-route/);
	assert.match(route, /ProjectPageHero/);
	assert.match(route, /title="Risk Register"/);
	assert.match(route, /title="Project risks"/);
	assert.match(route, /helper="Scan all project risks in one register\. Exposure, action state and lifecycle\/status are shown separately\."/);
	assert.doesNotMatch(route, /ProjectControlPanel/);
	assert.doesNotMatch(route, /Risk controls/);
	assert.doesNotMatch(route, /Create and edit enabled/);
	assert.doesNotMatch(route, /Create a new project risk\./);
	assert.match(route, /listProjectRisks\(organisation\.id, data\.id, workspace\.role, serverSupabase\)/);
	assert.match(route, /\.eq\('slug', projectSlug\)/);
	assert.match(route, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug \?\? '', accessToken\)/);
	assert.match(route, /data-risk-register-table/);
	for (const heading of ['Ref', 'Risk', 'Exposure', 'Lifecycle / Status', 'Owner', 'Review due', 'Updated']) {
		assert.match(route, new RegExp(`<th scope="col">${heading}</th>`));
	}
	for (const removedHeading of ['RAG', 'Actioner', 'Action state', 'Actions']) {
		assert.doesNotMatch(route, new RegExp(`<th scope="col">${removedHeading}</th>`));
	}
	assert.match(route, /No risks have been recorded for this project yet\./);
	assert.match(route, /buildProjectRiskPath\(workspaceSlug \?\? '', project\.slug, risk\.risk_id\)/);
	assert.match(route, /filterAndSortRisksForRegister\(risks, registerFilters, registerNow\)/);
	assert.match(route, /riskLifecycleCategory\(risk\.status\)/);
	assert.match(route, /data-risk-lifecycle=\{lifecycleCategory\}/);
	assert.match(route, /normaliseRiskRegisterViewTab\(registerParams\.get\('view'\)\)/);
	assert.match(route, /selectedSort = requestedSort \? normaliseRiskRegisterSort\(requestedSort\) : defaultSort/);
	assert.match(route, /parseRiskRegisterPage\(registerParams\.get\('page'\)\)/);
	assert.match(route, /parseRiskRegisterPageSize\(registerParams\.get\('pageSize'\)\)/);
	assert.match(route, /paginateRisksForRegister\(filteredRisks, requestedPage, selectedPageSize\)/);
	assert.match(route, /const pagedRisks = paginatedRegister\.items/);
	assert.match(route, /getRiskRegisterPageNumbers\(pagination\.page, pagination\.totalPages\)/);
	assert.match(route, /summarizeRiskRegister\(risks, registerNow\)/);
	assert.match(route, /getTopRiskActionItems\(risks, 4, registerNow\)/);
	assert.match(route, /getExposureDistribution\(risks\)/);
	assert.match(route, /data-risk-needs-action-panel/);
	assert.match(route, /Highest-priority risk work/);
	assert.match(route, /No active risk work currently needs attention\./);
	assert.match(route, /data-risk-needs-action-view-all/);
	assert.match(route, /view: 'need-action'/);
	assert.match(route, /sort: 'action-needed'/);
	assert.match(route, /buildProjectRiskPath\(workspaceSlug \?\? '', project\.slug, item\.riskId\)/);
	assert.match(route, /aria-label=\{`\$\{item\.label\} for \$\{item\.riskReference\}: \$\{item\.riskTitle\}`\}/);
	assert.doesNotMatch(route, /activeRisks = risks\.filter/);
	assert.doesNotMatch(route, /draftRisks = risks\.filter/);
	assert.doesNotMatch(route, /closedRisks = risks\.filter/);
	assert.doesNotMatch(route, /data-active-risk-register/);
	assert.doesNotMatch(route, /data-draft-risk-register/);
	assert.doesNotMatch(route, /data-closed-risk-register/);
	assert.doesNotMatch(route, /data-closed-risks-section/);
	assert.match(route, /getRiskRegisterExposureDisplay\(risk\)/);
	assert.doesNotMatch(route, /statusLabel="Exposure"/);
	assert.match(route, /actionStateFor\(risk\)/);
	assert.match(route, /deriveRiskReferenceTone\(risk\)/);
	assert.match(route, /riskReferenceStatusLabel\(risk\)/);
	assert.match(route, /label: 'Not active'/);
	assert.match(route, /referenceTone = lifecycleCategory === 'active' \? actionState\.tone : 'neutral'/);
	assert.match(route, /referenceStatusLabel = lifecycleCategory === 'active' \? actionState\.label : ''/);
	assert.match(route, /riskProfileName\(risk\.owner, 'Unassigned'\)/);
	assert.match(route, /risk-register-table__owner--missing/);
	assert.match(route, /reviewDueState\(risk\)/);
	assert.match(route, /deriveRiskReviewDateTone\(risk\.review_date, now\)/);
	assert.match(route, /No review date/);
	assert.match(route, /Overdue/);
	assert.match(route, /Due soon/);
	assert.doesNotMatch(route, /parseReviewDate/);
	assert.match(route, /ariaLabel=\{exposure\.ariaLabel\}/);
	assert.match(route, /tone=\{referenceTone\}/);
	assert.match(route, /statusLabel=\{referenceStatusLabel\}/);
	assert.match(route, /ariaLabel=\{referenceAriaLabel\}/);
	assert.match(route, /Estimated exposure/);
	assert.match(route, /buildProjectNewRiskPath\(workspaceSlug \?\? '', project\.slug\)/);
	assert.match(route, /data-risk-register-summary/);
	for (const card of ['Open risks', 'Need action', 'Highest exposure']) {
		assert.match(route, new RegExp(card));
	}
	const summaryCardsSource = route.match(/const summaryCards = \[[\s\S]*?\];/)?.[0] ?? '';
	assert.doesNotMatch(summaryCardsSource, /Draft risks/);
	assert.doesNotMatch(route, /Need completion/);
	for (const helper of ['Active project risks', 'Red or Amber action state', 'Across active risks']) {
		assert.match(route, new RegExp(helper));
	}
	assert.match(route, /risk-register-summary-card__icon/);
	assert.match(route, /highestExposureLabel = registerSummary\.highestExposure \? riskDisplayLabel\(registerSummary\.highestExposure\) : 'Not assessed'/);
	assert.match(route, /risk-register-summary-card--risk-low/);
	assert.match(route, /data-risk-register-tabs/);
	assert.match(route, /draftTabTone = \(count\) => count > 5 \? 'red' : count > 0 \? 'amber' : 'neutral'/);
	assert.match(route, /risk-register-tab__count--\$\{tab\.countTone\}/);
	assert.match(route, /data-risk-register-controls/);
	for (const tab of ['Active risks', 'Need action', 'Draft', 'Closed']) {
		assert.match(route, new RegExp(tab));
	}
	assert.doesNotMatch(route, /All risks/);
	for (const control of ['Search risks', 'Exposure', 'Action state', 'Owner', 'Lifecycle', 'Sort']) {
		assert.match(route, new RegExp(control));
	}
	assert.match(route, /Closed risks have no current exposure\./);
	assert.match(route, /RISK_REGISTER_EXPOSURE_FILTERS/);
	assert.match(route, /Highest exposure first/);
	assert.match(route, /Action needed first/);
	assert.match(route, /Review due soonest/);
	assert.match(route, /Recently updated/);
	assert.match(route, /data-risk-register-reset/);
	assert.match(route, /No risks match the current filters\./);
	assert.match(route, /No risks currently need action\./);
	assert.match(route, /No draft risks\./);
	assert.match(route, /No closed risks\./);
	assert.match(route, /<strong title=\{risk\.title\}>\{risk\.title\}<\/strong>/);
	assert.doesNotMatch(route, /risk-register-table__open/);
	assert.doesNotMatch(route, />Open<\/a>/);
	assert.match(route, /pagedRisks\.map\(\(risk\) =>/);
	assert.match(route, /data-risk-register-pagination/);
	assert.match(route, /data-risk-register-page-size/);
	assert.match(route, /data-risk-register-result-range/);
	assert.match(route, /RISK_REGISTER_PAGE_SIZES\.map/);
	assert.match(route, /name="pageSize"/);
	assert.match(route, /Previous/);
	assert.match(route, /Next/);
	assert.match(route, /aria-current="page"/);
	assert.match(route, /aria-label="Go to previous Risk Register page"/);
	assert.match(route, /aria-label="Go to next Risk Register page"/);
	assert.match(route, /page: 1/);
	assert.match(route, /data-risk-exposure-distribution/);
	assert.match(route, /Exposure distribution/);
	assert.match(route, /Active exposure and closed risks/);
	assert.match(route, /data-risk-exposure-chart-summary/);
	assert.match(route, /No active or closed risks to chart\./);
	assert.match(route, /Exposure distribution will appear when active risks are assessed\./);
	assert.match(route, /excluded from percentages/);
	assert.match(route, /risk-register-exposure-chart__segment--critical/);
	assert.match(route, /risk-register-exposure-chart__segment--high/);
	assert.match(route, /risk-register-exposure-chart__segment--medium/);
	assert.match(route, /risk-register-exposure-chart__segment--low/);
	assert.match(route, /risk-register-exposure-chart__segment--closed/);
	assert.match(route, /risk-register-exposure-chart__legend-item--critical/);
	assert.match(route, /risk-register-exposure-chart__legend-item--low/);
	assert.match(route, /risk-register-exposure-chart__legend-item--closed/);
	assert.match(route, /risk-register-exposure-chart__swatch/);
	assert.match(route, /aria-hidden="true"/);
	assert.match(route, /focusable="false"/);
	assert.match(route, /charted/);
	assert.match(route, /action state/);
	assert.doesNotMatch(route, /riskRagTone/);
	assert.doesNotMatch(route, /risk\.description && <span>/);
	assert.doesNotMatch(route, /Help me identify risks|More filters|acknowledge|dismiss|notification controls|new Chart\(|Chart\.js|\brecharts\b/i);
	assert.match(route, /data-risk-create-action/);
	assert.match(route, /disabled[\s\S]*data-risk-create-disabled/);
	assert.match(route, /Viewer access is read-only, so risk creation is unavailable for your role\./);
	assert.match(route, /Viewer access is read-only\. Risk creation is unavailable\./);
	assert.match(route, /<form class="risk-register-toolbar" method="get"/);
	assert.match(route, /<input type="search" name="q"/);
	assert.match(route, /<select name="exposure" disabled=\{selectedView === 'closed'\}/);
	assert.match(route, /<select name="actionState">/);
	assert.match(route, /<select name="owner">/);
	assert.match(route, /<select name="lifecycle">/);
	assert.match(route, /<select name="sort">/);
	assert.doesNotMatch(route, /<textarea\b/);
	assert.doesNotMatch(route, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
});

test('Risk detail route renders edit access state and requires the risk to belong to the selected project', async () => {
	const route = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId].astro', import.meta.url), 'utf8');

	assert.match(route, /data-risk-detail-route/);
	assert.match(route, /getProjectRisk\(organisation\.id, data\.id, riskId, workspace\.role, serverSupabase\)/);
	assert.match(route, /listProjectRiskComments\(organisation\.id, data\.id, risk\.risk_id, workspace\.role, serverSupabase\)/);
	assert.match(route, /createProjectRiskComment\(workspaceSlug \?\? '', data\.slug, risk\.risk_id/);
	assert.match(route, /Risk not found or you do not have access\./);
	assert.match(route, /title="Current risk"/);
	assert.doesNotMatch(route, /status="Actionable assurance"/);
	assert.match(route, /title="Current Risk Detail"/);
	assert.doesNotMatch(route, /What needs attention/);
	assert.doesNotMatch(route, /Risk assurance view/);
	assert.match(route, /class="risk-detail-heading"/);
	assert.match(route, /label=\{risk\.risk_ref\}/);
	assert.match(route, /deriveRiskReferenceTone\(risk, now\)/);
	assert.match(route, /riskReferenceStatusLabel\(risk, now\)/);
	assert.match(route, /tone=\{referenceTone\}/);
	assert.match(route, /statusLabel=\{referenceStatus\}/);
	assert.doesNotMatch(route, /RISK_RAG_STATUSES/);
	assert.doesNotMatch(route, /riskRagTone/);
	assert.match(route, /font-size: clamp\(1\.55rem, 2\.35vw, 2\.45rem\)/);
	assert.match(route, /data-risk-summary-strip/);
	for (const label of ['Lifecycle status', 'Created by', 'Updated by', 'Updated']) {
		assert.match(route, new RegExp(`<dt>${label}</dt>`));
	}
	for (const removedLabel of ['Concern', 'Owner', 'Created at', 'Updated at']) {
		assert.doesNotMatch(route, new RegExp(`<dt>${removedLabel}</dt>`));
	}
	assert.match(route, /creatorName\(risk\)/);
	assert.match(route, /updaterName\(risk\)/);
	assert.doesNotMatch(route, /ownerName\(risk\)/);
	assert.match(route, /getRiskAssuranceBlocks\(risk, now\)/);
	assert.match(route, /getRiskActionStateDrivers\(risk, now\)/);
	assert.match(route, /data-risk-action-state-summary/);
	assert.match(route, /data-risk-action-state-rationale/);
	assert.match(route, /data-risk-assurance-blocks/);
	assert.match(route, /longTextBlockConfigs = \{/);
	for (const label of ['Risk description', 'Mitigation plan', 'Contingency plan']) {
		assert.match(route, new RegExp(`fieldLabel: '${label}'`));
	}
	for (const label of ['View full description', 'View full mitigation plan', 'View full contingency plan']) {
		assert.match(route, new RegExp(`triggerLabel: '${label}'`));
	}
	assert.match(route, /LONG_TEXT_PREVIEW_THRESHOLD = 180/);
	assert.match(route, /normaliseLongText = \(value\) => String\(value \?\? ''\)\.trim\(\)/);
	assert.match(route, /getLongTextModalId = \(block\) => `risk-full-text-dialog-\$\{block\.id\}`/);
	assert.match(route, /value\.length > LONG_TEXT_PREVIEW_THRESHOLD/);
	assert.match(route, /risk-assurance-block--\$\{block\.tone\} rag-card rag-card--\$\{block\.tone\}/);
	assert.match(route, /<RagReferencePill tone=\{block\.tone\} label=\{block\.statusLabel\} \/>/);
	for (const block of ['description', 'status', 'exposure', 'owner', 'actioner', 'review-date', 'due-date', 'mitigation', 'contingency', 'updated']) {
		assert.match(route, new RegExp(`data-risk-assurance-block=\\{block\\.id\\}`));
	}
	assert.match(route, /risk-assurance-block__value--long-text/);
	assert.match(route, /data-risk-long-text-preview/);
	assert.match(route, /fullTextValue \? ' risk-assurance-block__value--long-text' : ''/);
	assert.match(route, /data-risk-long-text-preview=\{fullTextValue \? block\.id : undefined\}/);
	assert.match(route, /data-risk-full-text-trigger=\{block\.id\}/);
	assert.match(route, /aria-label=\{`\$\{viewFullLabel\(block\)\} for \$\{risk\.risk_ref\}`\}/);
	assert.match(route, /tabindex="-1" data-risk-dialog-focus/);
	assert.match(route, /data-risk-full-text-dialog/);
	assert.match(route, /data-risk-full-text-content=\{block\.id\}/);
	assert.match(route, /data-risk-full-text-close/);
	assert.match(route, /<p>\{fullTextValue\}<\/p>/);
	assert.match(route, /risk-full-text-dialog__content/);
	assert.match(route, /-webkit-line-clamp: 3/);
	assert.match(route, /activeDialogTrigger\.focus\(\)/);
	assert.match(route, /document\.querySelectorAll\('dialog\[open\]'\)/);
	assert.match(route, /openDialog !== dialog/);
	assert.match(route, /dialog\.querySelector\('\[data-risk-dialog-focus\], \[data-risk-dialog-cancel\], button, input, select, textarea'\)/);
	assert.match(route, /document\.querySelectorAll\('\[data-risk-dialog\], \[data-risk-full-text-dialog\]'\)/);
	assert.doesNotMatch(route, /overall-concern/);
	assert.match(route, /Action state rationale/);
	assert.match(route, /hasModalConfig\(block\.id\)/);
	assert.match(route, /risk-assurance-block__button--static/);
	assert.match(route, /data-risk-dialog-open/);
	assert.match(route, /exposure: \{ title: 'Edit exposure', fields: \['probability', 'impact'\], submit: 'Save exposure' \}/);
	assert.doesNotMatch(route, /name="rag_status"/);
	assert.doesNotMatch(route, /Concern signal/);
	assert.doesNotMatch(route, /Overall concern/);
	assert.match(route, /data-risk-modal-backdrop-blur/);
	assert.match(route, /backdrop-filter: blur\(10px\)/);
	assert.match(route, /\.risk-action-form__actions \[data-risk-dialog-cancel\]/);
	assert.match(route, /background: #0c1724/);
	assert.match(route, /color: #f3f8fc/);
	assert.match(route, /data-risk-detail-save-form/);
	assert.match(route, /data-risk-comment-form/);
	assert.match(route, /data-risk-lifecycle-form/);
	assert.match(route, /transitionProjectRiskLifecycle\(/);
	assert.match(route, /name="lifecycle_action" value="open"/);
	assert.match(route, /name="lifecycle_action" value="close"/);
	assert.match(route, /name="lifecycle_action" value="reopen"/);
	assert.match(route, /data-risk-open-action/);
	assert.match(route, /data-risk-close-action/);
	assert.match(route, /data-risk-reopen-action/);
	assert.match(route, /Continue editing/);
	assert.match(route, /data-risk-comments-section/);
	assert.match(route, /title="Current Risk Detail"[\s\S]*data-risk-comments-section/);
	assert.doesNotMatch(route, /<ProjectContentPanel[\s\S]*title="Comments"/);
	assert.match(route, /name="intent" value="add-comment"/);
	assert.match(route, /Back to Risk Register/);
	assert.match(route, /Back to project/);
	assert.match(route, /<div class="risk-detail-links">[\s\S]*class="button button--secondary"[\s\S]*Back to Risk Register[\s\S]*class="button button--secondary"[\s\S]*Back to project/);
	assert.doesNotMatch(route, /<dt>Risk reference<\/dt>/);
	assert.doesNotMatch(route, /<dt>Transitional concern signal<\/dt>/);
	assert.match(route, /data-viewer-read-only/);
	assert.match(route, /buildProjectRiskEditPath\(workspaceSlug \?\? '', project\.slug, risk\.risk_id\)/);
	assert.match(route, /data-risk-edit-action/);
	assert.match(route, /disabled[\s\S]*data-risk-edit-disabled/);
	assert.match(route, /Viewer access is read-only\. Risk editing is unavailable\./);
	assert.match(route, /action=\{editHref\}/);
	assert.doesNotMatch(route, /\.update\(|\.upsert\(|\.delete\(/);
});

test('Risk create and edit routes enforce permissions, validation and scoped mutations', async () => {
	const createRoute = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/new.astro', import.meta.url), 'utf8');
	const detailRoute = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId].astro', import.meta.url), 'utf8');
	const editRoute = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId]/edit.astro', import.meta.url), 'utf8');
	const registerRoute = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro', import.meta.url), 'utf8');
	const promptDraftRoute = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/prompt-drafts.ts', import.meta.url), 'utf8');
	const form = await readFile(new URL('../src/components/app/RiskForm.astro', import.meta.url), 'utf8');

	assert.match(createRoute, /data-risk-new-route/);
	assert.match(createRoute, /can\(workspace\.role, 'risk\.create'\)/);
	assert.match(createRoute, /Astro\.request\.method === 'POST'/);
	assert.match(createRoute, /status: 'draft'/);
	assert.match(createRoute, /validateRiskFormInput\(formValues, \{ mode: 'create' \}\)/);
	assert.match(createRoute, /createProjectRisk\(workspaceSlug \?\? '', projectSlug \?\? '', formValues, serverSupabase, accessToken\)/);
	assert.match(createRoute, /buildProjectRiskPath\(workspaceSlug \?\? '', data\.slug, risk\.risk_id\)}\?created=draft/);
	assert.match(createRoute, /\.eq\('slug', projectSlug\)[\s\S]*\.eq\('organisation_id', organisation\.id\)/);
	assert.match(createRoute, /buildLoginRedirectPath\(Astro\.url\.pathname\)/);
	assert.match(createRoute, /isSupabaseAuthSessionError\(error\)[\s\S]*Astro\.redirect\(sessionRedirectPath\)/);
	assert.match(createRoute, /Viewer access is read-only\. Risk creation is unavailable\./);
	assert.match(createRoute, /This risk will be created as a Draft for review and assessment\./);
	assert.match(registerRoute, /data-risk-prompt-create-action=\{riskPromptDraftCreatePath\}/);
	assert.match(registerRoute, /data-risk-prompt-can-create=\{canCreateRisk \? 'true' : 'false'\}/);
	assert.match(registerRoute, /fetch\(endpoint/);
	assert.match(registerRoute, /mode: 'preflight'/);
	assert.match(registerRoute, /mode: 'create'/);
	assert.match(registerRoute, /Create \$\{createableCount\} Draft \$\{createableCount === 1 \? 'risk' : 'risks'\}/);
	assert.match(registerRoute, /No new Draft risks to create/);
	assert.match(registerRoute, /data-risk-prompt-confirmation-view/);
	assert.match(registerRoute, /data-risk-prompt-confirm-back/);
	assert.match(registerRoute, /risk-prompt-confirmation__metric--selected/);
	assert.match(registerRoute, /risk-prompt-confirmation__metric--create/);
	assert.match(registerRoute, /risk-prompt-confirmation__metric--duplicate/);
	assert.match(registerRoute, /prompts selected/);
	assert.match(registerRoute, /Draft risks will be created/);
	assert.match(registerRoute, /risks already exist in this project/);
	assert.match(registerRoute, /risk-prompt-confirmation__section--create/);
	assert.match(registerRoute, /risk-prompt-confirmation__section--duplicate/);
	assert.match(registerRoute, /link\.textContent = ref/);
	assert.match(registerRoute, /link\.target = '_blank'/);
	assert.match(registerRoute, /link\.rel = 'noopener noreferrer'/);
	assert.match(registerRoute, /risk-prompt-confirmation__risk-ref/);
	assert.match(registerRoute, /risk-prompt-confirmation__risk-title/);
	assert.doesNotMatch(registerRoute, /Watchtower will create \$\{createableCount\} new risks in Draft for this project/);
	assert.doesNotMatch(registerRoute, /selected prompts already exist and will not be created again/);
	assert.doesNotMatch(registerRoute, /link\.textContent = 'Open'/);
	assert.doesNotMatch(registerRoute, /View existing risks/);
	assert.doesNotMatch(registerRoute, /data-risk-prompt-view-existing/);
	assert.match(registerRoute, /Already in this project/);
	assert.doesNotMatch(registerRoute, /window\.confirm/);
	assert.match(registerRoute, /nextUrl\.searchParams\.set\('view', 'draft'\)/);
	assert.match(promptDraftRoute, /createDraftProjectRisksFromPrompts\(/);
	assert.match(promptDraftRoute, /preflightDraftProjectRisksFromPrompts\(/);
	assert.match(promptDraftRoute, /buildProjectRiskPath/);
	assert.match(promptDraftRoute, /getServerAccessToken\(cookies\)/);
	assert.match(promptDraftRoute, /isSupabaseAuthSessionError\(error\)/);
	assert.match(detailRoute, /Astro\.url\.searchParams\.get\('created'\) === 'draft' \? 'Draft risk created\.' : ''/);
	assert.match(detailRoute, /data-risk-detail-success/);
	assert.match(detailRoute, /getRiskActivationReadiness\(risk, \{ now \}\)/);
	assert.match(detailRoute, /data-risk-activation-readiness/);
	assert.match(detailRoute, /data-risk-activation-missing=\{requirement\.key\}/);
	assert.match(detailRoute, /Complete the minimum information before activating this Draft risk\./);
	assert.match(detailRoute, /Activate risk/);
	assert.match(detailRoute, /disabled=\{!activationReadiness\?\.ready \|\| undefined\}/);
	assert.match(detailRoute, /data-risk-draft-status-readonly/);

	assert.match(editRoute, /data-risk-edit-route/);
	assert.match(editRoute, /can\(workspace\.role, 'risk\.edit'\)/);
	assert.match(editRoute, /getProjectRisk\(organisation\.id, data\.id, riskId, workspace\.role, serverSupabase\)/);
	assert.match(editRoute, /updateProjectRisk\(workspaceSlug \?\? '', projectSlug \?\? '', risk\.risk_id, formValues, serverSupabase, accessToken\)/);
	assert.match(editRoute, /validateRiskFormInput\(formValues, \{ mode: risk && isDraftRiskStatus\(risk\.status\) \? 'draft' : 'edit' \}\)/);
	assert.match(editRoute, /isDraftRiskExposureUnassessed\(record\)/);
	assert.match(editRoute, /buildLoginRedirectPath\(Astro\.url\.pathname\)/);
	assert.match(editRoute, /isSupabaseAuthSessionError\(error\)[\s\S]*Astro\.redirect\(sessionRedirectPath\)/);
	assert.match(editRoute, /Viewer access is read-only\. Risk editing is unavailable\./);

	for (const field of ['name="title"', 'name="description"', 'name="status"', 'name="probability"', 'name="impact"', 'name="owner_id"', 'name="actioner_id"', 'name="review_date"', 'name="due_date"', 'name="mitigation_plan"', 'name="contingency_plan"']) {
		assert.match(form, new RegExp(field));
	}
	assert.match(form, /isEditMode && !isDraftEditMode \? \([\s\S]*name="status"[\s\S]*\) : \(/);
	assert.match(form, /data-risk-draft-edit-status=\{isDraftEditMode \|\| undefined\}/);
	assert.match(form, /Use Activate risk from the detail page when the minimum information is complete\./);
	assert.match(form, /data-risk-create-draft-status/);
	assert.match(form, /This risk will be created as a Draft for review and assessment\./);
	assert.match(form, /<option value="" selected=\{!values\.probability\}>Unassessed<\/option>/);
	assert.match(form, /<option value="" selected=\{!values\.impact\}>Unassessed<\/option>/);
	assert.doesNotMatch(form, /name="rag_status"/);
	assert.doesNotMatch(form, /Concern signal/);
	assert.doesNotMatch(form, /Transitional signal only/);
	assert.doesNotMatch(createRoute, /ragStatus: String\(formData\.get\('rag_status'\)/);
	assert.doesNotMatch(editRoute, /ragStatus: record\?\.rag_status/);
	assert.doesNotMatch(editRoute, /ragStatus: String\(formData\.get\('rag_status'\)/);
	assert.match(createRoute, /actionerOptions=\{ownerOptions\}/);
	assert.match(editRoute, /actionerOptions=\{ownerOptions\}/);
	assert.match(createRoute, /actionerId: String\(formData\.get\('actioner_id'\) \?\? ''\)/);
	assert.match(editRoute, /actionerId: record\?\.actioner_id \?\? ''/);
	assert.match(editRoute, /actionerId: String\(formData\.get\('actioner_id'\) \?\? ''\)/);
	assert.match(createRoute, /probability: String\(formData\.get\('probability'\) \?\? ''\)/);
	assert.match(createRoute, /impact: String\(formData\.get\('impact'\) \?\? ''\)/);
	assert.match(editRoute, /probability: isUnassessedDraft \? '' : record\?\.probability \?\? 'medium'/);
	assert.match(editRoute, /impact: String\(formData\.get\('impact'\) \?\? ''\)/);
	assert.match(form, /The actioner is responsible for carrying out mitigation, contingency, review, or follow-up activity\./);
	assert.match(form, /data-review-date-offset="7"/);
	assert.match(form, /data-review-date-offset="14"/);
	assert.match(form, /data-review-date-manual/);
	assert.doesNotMatch(form, /Actioners will be handled through risk actions in a later slice\./);
	assert.match(form, /supabase\.auth\.getSession\(\)/);
	assert.match(form, /document\.cookie = `wt-access-token=\$\{session\.access_token\}/);
	assert.match(form, /document\.cookie = `wt-refresh-token=\$\{session\.refresh_token\}/);
	assert.match(form, /window\.location\.assign\(`\/login\?redirectTo=\$\{encodeURIComponent\(window\.location\.pathname\)\}`\)/);
});

test('Risk create/edit/comment source avoids deferred side effects', async () => {
	const sources = await Promise.all([
		readFile(new URL('../src/lib/projectRisks.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/new.astro', import.meta.url), 'utf8'),
		readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId].astro', import.meta.url), 'utf8'),
		readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId]/edit.astro', import.meta.url), 'utf8'),
	]);
	const combined = sources.join('\n');
	assert.match(combined, /createProjectNarrativeEntry/);
	assert.match(combined, /Risk raised:/);
	assert.match(combined, /Risk became Red:/);
	assert.match(combined, /Risk opened:/);
	assert.match(combined, /Risk closed:/);
	assert.match(combined, /Risk reopened:/);
	assert.match(combined, /!isRedRiskActionState\(previousActionState\) && isRedRiskActionState\(nextActionState\)/);
	for (const table of ['attention_items', 'notification_events', 'email_notifications']) {
		assert.doesNotMatch(combined, new RegExp(`from\\('${table}'\\)|insert\\([\\s\\S]*${table}`, 'i'));
	}
	assert.doesNotMatch(combined, /health\s*:|AI summar|AI analys/i);
});

test('Risk activity assurance and temporary handover remain documented future-ready scope', async () => {
	const docs = await Promise.all([
		readFile(new URL('../docs/risk-foundation.md', import.meta.url), 'utf8'),
		readFile(new URL('../docs/project-model.md', import.meta.url), 'utf8'),
		readFile(new URL('../docs/watchtower-platform.md', import.meta.url), 'utf8'),
	]);
	const combined = docs.join('\n');

	assert.match(combined, /last_login_at/);
	assert.match(combined, /future-ready/i);
	assert.match(combined, /temporary actioner/i);
	assert.match(combined, /handover reason/i);
	assert.match(combined, /original actioner/i);
	assert.match(combined, /Governance Profile \/ Assessment Profile/);

	const source = await readFile(new URL('../src/lib/projectRisks.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(source, /last_login_at/);
});

test('Project dashboard Risk tile routes to the Risk Register and loads only scoped assurance state', async () => {
	const dashboard = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	const riskTileDefinition = dashboard.slice(dashboard.indexOf("title: 'Risks'"), dashboard.indexOf("title: 'Issues'"));
	assert.match(dashboard, /title: 'Risks'[\s\S]*destination: 'risks'[\s\S]*featureKey: 'riskManagement'/);
	assert.match(dashboard, /buildProjectRisksPath\(workspaceSlug \?\? '', project\.slug\)/);
	assert.match(dashboard, /listProjectRisks\(organisation\.id, project\.id, workspace\.role, serverSupabase\)/);
	assert.match(dashboard, /deriveRiskTileAttentionSignal\(risks, new Date\(\)\)/);
	assert.doesNotMatch(dashboard, /deriveRiskConcernTone\(risks|deriveRiskExposureTone\(risks|deriveProjectRiskDashboardAssuranceTone\(risks/);
	assert.doesNotMatch(riskTileDefinition, /risk_ref/);
	assert.doesNotMatch(riskTileDefinition, /badge|count|attention_items|notification_events|healthScore|AI summar|AI analys/i);
});
