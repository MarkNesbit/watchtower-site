import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	buildRiskReference,
	createProjectRiskComment,
	createProjectRisk,
	deriveProjectRiskDashboardAssuranceTone,
	deriveRiskAssuranceTone,
	deriveRiskConcernTone,
	deriveRiskExposureTone,
	getProjectRisk,
	getRiskAssuranceBlocks,
	isRiskReviewDate,
	listProjectRiskComments,
	listProjectRisksByIds,
	listProjectRisks,
	riskDisplayLabel,
	riskProfileName,
	riskRagTone,
	updateProjectRisk,
	validateRiskFormInput,
} from '../src/lib/projectRisks.ts';

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
});

test('Risk exposure derives from probability and impact without manual concern input', () => {
	assert.equal(deriveRiskExposureTone('low', 'low'), 'green');
	assert.equal(deriveRiskExposureTone('low', 'medium'), 'amber');
	assert.equal(deriveRiskExposureTone('medium', 'low'), 'amber');
	assert.equal(deriveRiskExposureTone('medium', 'medium'), 'amber');
	assert.equal(deriveRiskExposureTone('high', 'low'), 'amber');
	assert.equal(deriveRiskExposureTone('low', 'high'), 'amber');
	assert.equal(deriveRiskExposureTone('medium', 'high'), 'red');
	assert.equal(deriveRiskExposureTone('high', 'medium'), 'red');
	assert.equal(deriveRiskExposureTone('high', 'high'), 'red');
	assert.equal(deriveRiskExposureTone('', 'low'), 'red');
	assert.equal(deriveRiskExposureTone('low', undefined), 'red');
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

test('Overall risk concern uses exposure plus assurance overrides', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	assert.equal(deriveRiskConcernTone(assuredRiskFacts({ owner_id: null }), now), 'red');
	assert.equal(deriveRiskConcernTone(assuredRiskFacts({ probability: 'medium', impact: 'medium' }), now), 'amber');
	assert.equal(deriveRiskConcernTone(assuredRiskFacts({ probability: 'high', impact: 'high' }), now), 'red');
	assert.equal(deriveRiskConcernTone(assuredRiskFacts({ due_date: null }), now), 'amber');
	assert.equal(deriveRiskConcernTone(assuredRiskFacts(), now), 'green');
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

test('Project dashboard risk icon is not driven by exposure', () => {
	const now = new Date('2026-06-28T12:00:00Z');
	const highExposureWithGreenAssurance = assuredRiskFacts({
		probability: 'high',
		impact: 'high',
		mitigation_plan: 'Confirmed supplier alternate.',
		contingency_plan: 'Escalate through steering group.',
	});

	assert.equal(deriveRiskExposureTone(highExposureWithGreenAssurance.probability, highExposureWithGreenAssurance.impact), 'red');
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
	assert.equal(byId.get('exposure').tone, 'red');
	assert.equal(byId.get('overall-concern').tone, 'red');
	assert.match(byId.get('overall-concern').value, /Derived from Red exposure and Red assurance/);
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

test('Risk create helper writes a project-scoped risk with a generated reference', async () => {
	const client = createRiskMutationClient({ existingSequence: 1 });
	const risk = await createProjectRisk('alpha', 'delivery-hub', {
		title: 'Supplier delay',
		description: 'Critical supplier date is moving.',
		status: 'open',
		probability: 'high',
		impact: 'medium',
		ragStatus: 'green',
		ownerId: 'owner-1',
		actionerId: 'actioner-1',
		reviewDate: '2026-07-10',
		dueDate: '2026-08-01',
		mitigationPlan: 'Confirm alternative supplier.',
		contingencyPlan: 'Escalate to steering group.',
	}, client);

	assert.equal(risk.risk_ref, 'Risk-HHH-002');
	const insertCall = client.calls.find((call) => call[0] === 'insert' && call[1] === 'project_risks');
	assert.ok(insertCall);
	assert.deepEqual(insertCall[2], {
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		risk_ref: 'Risk-HHH-002',
		risk_sequence: 2,
		title: 'Supplier delay',
		description: 'Critical supplier date is moving.',
		status: 'open',
		probability: 'high',
		impact: 'medium',
		rag_status: 'red',
		owner_id: 'owner-1',
		actioner_id: 'actioner-1',
		review_date: '2026-07-10',
		due_date: '2026-08-01',
		mitigation_plan: 'Confirm alternative supplier.',
		contingency_plan: 'Escalate to steering group.',
	});
	const narrativeCalls = client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries');
	assert.equal(narrativeCalls.length, 1);
	assert.deepEqual(narrativeCalls[0][2], {
		project_id: 'project-1',
		source_type: 'risk',
		source_record_id: 'risk-2',
		source_ref: 'Risk-HHH-002',
		attention_level: 'red',
		title: 'Risk raised: Risk-HHH-002 — Supplier delay',
		details: 'Concern: Red. Lifecycle status: Open.',
		created_timezone: null,
	});
	assert.ok(!client.calls.some((call) => call[0] === 'from' && ['project_risk_notes', 'notification_events', 'attention_items'].includes(call[1])));
	assert.ok(!narrativeCalls.some((call) => call[2].title.includes('Risk became Red')));
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

test('Creating a Red risk creates only the raised narrative entry', async () => {
	const client = createRiskMutationClient({ existingSequence: 1 });
	await createProjectRisk('alpha', 'delivery-hub', {
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

	const narrativeCalls = client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries');
	assert.equal(narrativeCalls.length, 1);
	assert.match(narrativeCalls[0][2].title, /^Risk raised: Risk-HHH-002/);
	assert.doesNotMatch(narrativeCalls[0][2].title, /became Red/);
	assert.equal(narrativeCalls[0][2].source_type, 'risk');
	assert.equal(narrativeCalls[0][2].source_record_id, 'risk-2');
});

test('Updating an existing non-Red risk to Red creates a source-linked narrative entry', async () => {
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
	});
	const client = createRiskMutationClient({ existingRisk: greenRisk });

	await updateProjectRisk('alpha', 'delivery-hub', 'risk-1', {
		title: 'Supplier delay',
		description: 'Critical supplier date is moving.',
		status: 'open',
		probability: 'high',
		impact: 'high',
		ownerId: 'owner-1',
		actionerId: 'actioner-1',
		reviewDate: '2026-07-10',
		dueDate: '2026-08-01',
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
		details: 'Concern: Red. Lifecycle status: Open. Reason: Exposure is Red.',
		created_timezone: null,
	});
});

test('Updating a Green risk to Amber does not create a narrative entry', async () => {
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
		reviewDate: '2026-07-10',
		dueDate: '2026-08-01',
		mitigationPlan: 'Confirm alternative supplier.',
		contingencyPlan: 'Escalate to steering group.',
	}, client);

	assert.equal(client.calls.filter((call) => call[0] === 'insert' && call[1] === 'project_narrative_entries').length, 0);
});

test('Routine owner, actioner and review date edits do not create narrative entries while concern stays non-Red', async () => {
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
	});

	for (const input of [
		{ ownerId: 'owner-2', actionerId: 'actioner-1', reviewDate: '2026-07-10' },
		{ ownerId: 'owner-1', actionerId: 'actioner-2', reviewDate: '2026-07-10' },
		{ ownerId: 'owner-1', actionerId: 'actioner-1', reviewDate: '2026-07-20' },
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
			dueDate: '2026-08-01',
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

test('Risk Register route renders a cleaned scoped table and create access state', async () => {
	const route = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro', import.meta.url), 'utf8');

	assert.match(route, /data-risk-register-route/);
	assert.match(route, /ProjectPageHero/);
	assert.match(route, /title="Risk Register"/);
	assert.match(route, /listProjectRisks\(organisation\.id, data\.id, workspace\.role, serverSupabase\)/);
	assert.match(route, /\.eq\('slug', projectSlug\)/);
	assert.match(route, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug \?\? '', accessToken\)/);
	for (const heading of ['Ref', 'Risk', 'Status', 'Review date', 'Updated']) {
		assert.match(route, new RegExp(`<th scope="col">${heading}</th>`));
	}
	for (const removedHeading of ['RAG', 'Owner', 'Actioner']) {
		assert.doesNotMatch(route, new RegExp(`<th scope="col">${removedHeading}</th>`));
	}
	assert.match(route, /No risks have been recorded for this project yet\./);
	assert.match(route, /buildProjectRiskPath\(workspaceSlug \?\? '', project\.slug, risk\.risk_id\)/);
	assert.match(route, /deriveRiskConcernTone\(risk\)/);
	assert.match(route, /buildProjectNewRiskPath\(workspaceSlug \?\? '', project\.slug\)/);
	assert.match(route, /<td class="risk-register-table__risk"><strong>\{risk\.title\}<\/strong><\/td>/);
	assert.match(route, /tone=\{derivedConcernTone\}/);
	assert.match(route, /statusLabel=\{riskDisplayLabel\(derivedConcernTone\)\}/);
	assert.match(route, /derived concern/);
	assert.doesNotMatch(route, /riskRagTone/);
	assert.doesNotMatch(route, /risk\.description && <span>/);
	assert.match(route, /data-risk-create-action/);
	assert.match(route, /disabled[\s\S]*data-risk-create-disabled/);
	assert.match(route, /Viewer access is read-only, so risk creation is unavailable for your role\./);
	assert.match(route, /Viewer access is read-only\. Risk creation is unavailable\./);
	assert.doesNotMatch(route, /<form\b|<input\b|<select\b|<textarea\b|type="submit"/);
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
	assert.match(route, /title="Core Risk Detail"/);
	assert.doesNotMatch(route, /What needs attention/);
	assert.doesNotMatch(route, /Risk assurance view/);
	assert.match(route, /class="risk-detail-heading"/);
	assert.match(route, /label=\{risk\.risk_ref\}/);
	assert.match(route, /deriveRiskConcernTone\(risk, new Date\(\)\)/);
	assert.match(route, /tone=\{derivedConcernTone\}/);
	assert.match(route, /statusLabel=\{riskDisplayLabel\(derivedConcernTone\)\}/);
	assert.match(route, /derived concern/);
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
	assert.match(route, /getRiskAssuranceBlocks\(risk, new Date\(\)\)/);
	assert.match(route, /data-risk-assurance-blocks/);
	assert.match(route, /risk-assurance-block--\$\{block\.tone\} rag-card rag-card--\$\{block\.tone\}/);
	assert.match(route, /<RagReferencePill tone=\{block\.tone\} label=\{block\.statusLabel\} \/>/);
	for (const block of ['description', 'status', 'overall-concern', 'exposure', 'owner', 'actioner', 'review-date', 'due-date', 'mitigation', 'contingency', 'updated']) {
		assert.match(route, new RegExp(`data-risk-assurance-block=\\{block\\.id\\}`));
	}
	assert.match(route, /hasModalConfig\(block\.id\)/);
	assert.match(route, /risk-assurance-block__button--static/);
	assert.match(route, /data-risk-dialog-open/);
	assert.match(route, /exposure: \{ title: 'Edit exposure', fields: \['probability', 'impact'\], submit: 'Save exposure' \}/);
	assert.doesNotMatch(route, /name="rag_status"/);
	assert.doesNotMatch(route, /Concern signal/);
	assert.match(route, /data-risk-modal-backdrop-blur/);
	assert.match(route, /backdrop-filter: blur\(10px\)/);
	assert.match(route, /\.risk-action-form__actions \[data-risk-dialog-cancel\]/);
	assert.match(route, /background: #0c1724/);
	assert.match(route, /color: #f3f8fc/);
	assert.match(route, /data-risk-detail-save-form/);
	assert.match(route, /data-risk-comment-form/);
	assert.match(route, /data-risk-comments-section/);
	assert.match(route, /title="Core Risk Detail"[\s\S]*data-risk-comments-section/);
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
	const editRoute = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId]/edit.astro', import.meta.url), 'utf8');
	const form = await readFile(new URL('../src/components/app/RiskForm.astro', import.meta.url), 'utf8');

	assert.match(createRoute, /data-risk-new-route/);
	assert.match(createRoute, /can\(workspace\.role, 'risk\.create'\)/);
	assert.match(createRoute, /Astro\.request\.method === 'POST'/);
	assert.match(createRoute, /validateRiskFormInput\(formValues\)/);
	assert.match(createRoute, /createProjectRisk\(workspaceSlug \?\? '', projectSlug \?\? '', formValues, serverSupabase, accessToken\)/);
	assert.match(createRoute, /buildProjectRiskPath\(workspaceSlug \?\? '', data\.slug, risk\.risk_id\)/);
	assert.match(createRoute, /\.eq\('slug', projectSlug\)[\s\S]*\.eq\('organisation_id', organisation\.id\)/);
	assert.match(createRoute, /buildLoginRedirectPath\(Astro\.url\.pathname\)/);
	assert.match(createRoute, /isSupabaseAuthSessionError\(error\)[\s\S]*Astro\.redirect\(sessionRedirectPath\)/);
	assert.match(createRoute, /Viewer access is read-only\. Risk creation is unavailable\./);

	assert.match(editRoute, /data-risk-edit-route/);
	assert.match(editRoute, /can\(workspace\.role, 'risk\.edit'\)/);
	assert.match(editRoute, /getProjectRisk\(organisation\.id, data\.id, riskId, workspace\.role, serverSupabase\)/);
	assert.match(editRoute, /updateProjectRisk\(workspaceSlug \?\? '', projectSlug \?\? '', risk\.risk_id, formValues, serverSupabase, accessToken\)/);
	assert.match(editRoute, /buildLoginRedirectPath\(Astro\.url\.pathname\)/);
	assert.match(editRoute, /isSupabaseAuthSessionError\(error\)[\s\S]*Astro\.redirect\(sessionRedirectPath\)/);
	assert.match(editRoute, /Viewer access is read-only\. Risk editing is unavailable\./);

	for (const field of ['name="title"', 'name="description"', 'name="status"', 'name="probability"', 'name="impact"', 'name="owner_id"', 'name="actioner_id"', 'name="review_date"', 'name="due_date"', 'name="mitigation_plan"', 'name="contingency_plan"']) {
		assert.match(form, new RegExp(field));
	}
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
	assert.match(createRoute, /probability: String\(formData\.get\('probability'\) \?\? 'medium'\)/);
	assert.match(editRoute, /probability: record\?\.probability \?\? 'medium'/);
	assert.match(editRoute, /impact: String\(formData\.get\('impact'\) \?\? 'medium'\)/);
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
	assert.match(combined, /!isRedRiskConcern\(previousConcern\) && isRedRiskConcern\(nextConcern\)/);
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
	assert.match(dashboard, /title: 'Risks'[\s\S]*destination: 'risks'[\s\S]*featureKey: 'riskManagement'/);
	assert.match(dashboard, /buildProjectRisksPath\(workspaceSlug \?\? '', project\.slug\)/);
	assert.match(dashboard, /listProjectRisks\(organisation\.id, project\.id, workspace\.role, serverSupabase\)/);
	assert.match(dashboard, /deriveRiskTileAttentionSignal\(risks, new Date\(\)\)/);
	assert.doesNotMatch(dashboard, /deriveRiskConcernTone\(risks|deriveRiskExposureTone\(risks|deriveProjectRiskDashboardAssuranceTone\(risks/);
	assert.doesNotMatch(dashboard, /risk_ref/);
	assert.doesNotMatch(dashboard, /badge|count|attention_items|notification_events|healthScore|AI summar|AI analys/i);
});
