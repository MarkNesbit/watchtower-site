import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	buildRiskReference,
	createProjectRisk,
	getProjectRisk,
	getRiskAssuranceBlocks,
	isRiskReviewDate,
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

function createRiskMutationClient({ role = 'member', existingSequence = 1, ownerIsActive = true, actionerIsActive = true, authError = null } = {}) {
	const calls = [];
	const membershipWithWorkspace = {
		role,
		organisations: { id: 'workspace-1', name: 'Alpha Workspace', slug: 'alpha' },
	};
	const project = { id: 'project-1', name: 'Delivery Hub', project_ref: 'HHH', slug: 'delivery-hub' };

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
						},
						error: null,
					};
				}
				if (table === 'project_risks') return { data: { risk_sequence: existingSequence }, error: null };
				return { data: null, error: null };
			},
			single() {
				calls.push(['single', table]);
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
	const sql = await migrationSql();
	assert.match(sql, /project_risks_risk_ref_format_check check \(risk_ref ~ '\^Risk-\[A-Z\]\[A-Z0-9\]\{1,9\}-\[0-9\]\{3\}\$'\)/);
	assert.match(sql, /project_risks_status_check check \(status in \('open', 'monitoring', 'mitigating', 'accepted', 'closed'\)\)/);
	assert.match(sql, /project_risks_probability_check check \(probability in \('low', 'medium', 'high'\)\)/);
	assert.match(sql, /project_risks_impact_check check \(impact in \('low', 'medium', 'high'\)\)/);
	assert.match(sql, /project_risks_rag_status_check check \(rag_status in \('blue', 'green', 'amber', 'red'\)\)/);
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
		ragStatus: 'purple',
		reviewDate: '2026-02-31',
		dueDate: '2026-13-01',
	}), {
		title: 'Risk title is required.',
		status: 'Select a valid risk status.',
		ragStatus: 'Select a valid RAG status.',
		reviewDate: 'Enter a valid review date.',
		dueDate: 'Enter a valid due date.',
	});
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
	assert.equal(byId.get('mitigation').tone, 'red');
	assert.equal(byId.get('contingency').tone, 'red');
	assert.equal(byId.get('updated').tone, 'red');
	assert.equal(byId.get('actioner').tone, 'amber');
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
	assert.equal(actionerBlock({ ...baseRisk, status: 'open', actioner_id: null }).tone, 'amber');
	assert.equal(actionerBlock({ ...baseRisk, status: 'monitoring', actioner_id: null }).tone, 'amber');
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

test('Risk create helper writes a project-scoped risk with a generated reference', async () => {
	const client = createRiskMutationClient({ existingSequence: 1 });
	const risk = await createProjectRisk('alpha', 'delivery-hub', {
		title: 'Supplier delay',
		description: 'Critical supplier date is moving.',
		status: 'open',
		ragStatus: 'amber',
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
		rag_status: 'amber',
		owner_id: 'owner-1',
		actioner_id: 'actioner-1',
		review_date: '2026-07-10',
		due_date: '2026-08-01',
		mitigation_plan: 'Confirm alternative supplier.',
		contingency_plan: 'Escalate to steering group.',
	});
	assert.ok(!client.calls.some((call) => call[0] === 'from' && ['project_narrative_entries', 'project_risk_notes', 'notification_events', 'attention_items'].includes(call[1])));
});

test('Risk edit helper updates only scoped editable fields', async () => {
	const client = createRiskMutationClient();
	const risk = await updateProjectRisk('alpha', 'delivery-hub', 'risk-1', {
		title: 'Supplier delay updated',
		description: 'New mitigation agreed.',
		status: 'mitigating',
		ragStatus: 'red',
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
		],
	);
});

test('Viewer writes and inactive owner or actioner assignments are rejected before risk mutation', async () => {
	const viewerClient = createRiskMutationClient({ role: 'viewer' });
	await assert.rejects(
		createProjectRisk('alpha', 'delivery-hub', {
			title: 'No write',
			status: 'open',
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
	assert.match(route, /buildProjectNewRiskPath\(workspaceSlug \?\? '', project\.slug\)/);
	assert.match(route, /<td class="risk-register-table__risk"><strong>\{risk\.title\}<\/strong><\/td>/);
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
	assert.match(route, /Risk not found or you do not have access\./);
	assert.match(route, /Risk assurance view/);
	assert.match(route, /getRiskAssuranceBlocks\(risk, new Date\(\)\)/);
	assert.match(route, /data-risk-assurance-blocks/);
	for (const block of ['description', 'status', 'exposure', 'owner', 'actioner', 'review-date', 'due-date', 'mitigation', 'contingency', 'updated']) {
		assert.match(route, new RegExp(`data-risk-assurance-block=\\{block\\.id\\}`));
	}
	for (const label of ['Risk reference', 'Created by', 'Created at', 'Updated by', 'Updated at', 'Transitional concern signal']) {
		assert.match(route, new RegExp(`<dt>${label}</dt>`));
	}
	assert.match(route, /data-viewer-read-only/);
	assert.match(route, /buildProjectRiskEditPath\(workspaceSlug \?\? '', project\.slug, risk\.risk_id\)/);
	assert.match(route, /data-risk-edit-action/);
	assert.match(route, /disabled[\s\S]*data-risk-edit-disabled/);
	assert.match(route, /Viewer access is read-only\. Risk editing is unavailable\./);
	assert.doesNotMatch(route, /<form\b|<input\b|<select\b|<textarea\b|type="submit"/);
	assert.doesNotMatch(route, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
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

	for (const field of ['name="title"', 'name="description"', 'name="status"', 'name="rag_status"', 'name="owner_id"', 'name="actioner_id"', 'name="review_date"', 'name="due_date"', 'name="mitigation_plan"', 'name="contingency_plan"']) {
		assert.match(form, new RegExp(field));
	}
	assert.match(form, /Concern signal/);
	assert.match(form, /Transitional signal only/);
	assert.match(createRoute, /actionerOptions=\{ownerOptions\}/);
	assert.match(editRoute, /actionerOptions=\{ownerOptions\}/);
	assert.match(createRoute, /actionerId: String\(formData\.get\('actioner_id'\) \?\? ''\)/);
	assert.match(editRoute, /actionerId: record\?\.actioner_id \?\? ''/);
	assert.match(editRoute, /actionerId: String\(formData\.get\('actioner_id'\) \?\? ''\)/);
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

test('Risk create/edit source avoids deferred side effects', async () => {
	const sources = await Promise.all([
		readFile(new URL('../src/lib/projectRisks.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/new.astro', import.meta.url), 'utf8'),
		readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId]/edit.astro', import.meta.url), 'utf8'),
	]);
	const combined = sources.join('\n');
	for (const table of ['project_narrative_entries', 'project_risk_notes', 'attention_items', 'notification_events', 'email_notifications']) {
		assert.doesNotMatch(combined, new RegExp(`from\\('${table}'\\)|insert\\([\\s\\S]*${table}`, 'i'));
	}
	assert.doesNotMatch(combined, /health\s*:/i);
});

test('Project dashboard Risk tile routes to the Risk Register without loading risk records', async () => {
	const dashboard = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	assert.match(dashboard, /title: 'Risks'[\s\S]*destination: 'risks'[\s\S]*featureKey: 'riskManagement'/);
	assert.match(dashboard, /buildProjectRisksPath\(workspaceSlug \?\? '', project\.slug\)/);
	assert.doesNotMatch(dashboard, /from\('project_risks'\)/);
	assert.doesNotMatch(dashboard, /risk_ref/);
});
