import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	getProjectRisk,
	listProjectRisks,
	riskDisplayLabel,
	riskProfileName,
	riskRagTone,
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

test('Project risks include required MVP fields and exclude actioners', async () => {
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
	assert.doesNotMatch(sql, /actioner_id/i);
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

test('Risk Register route renders a read-only scoped table and empty state', async () => {
	const route = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro', import.meta.url), 'utf8');

	assert.match(route, /data-risk-register-route/);
	assert.match(route, /ProjectPageHero/);
	assert.match(route, /title="Risk Register"/);
	assert.match(route, /listProjectRisks\(organisation\.id, data\.id, workspace\.role, serverSupabase\)/);
	assert.match(route, /\.eq\('slug', projectSlug\)/);
	assert.match(route, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug \?\? '', accessToken\)/);
	for (const heading of ['Ref', 'Risk', 'RAG', 'Status', 'Owner', 'Actioner', 'Review date', 'Updated']) {
		assert.match(route, new RegExp(`<th scope="col">${heading}</th>`));
	}
	assert.match(route, /No risks have been recorded for this project yet\./);
	assert.match(route, /buildProjectRiskPath\(workspaceSlug \?\? '', project\.slug, risk\.risk_id\)/);
	assert.match(route, /disabled[\s\S]*data-risk-create-disabled/);
	assert.match(route, /Viewer access is read-only, so risk creation is unavailable for your role\./);
	assert.match(route, /Viewer access is read-only\. Risk creation is unavailable\./);
	assert.doesNotMatch(route, /<form\b|<input\b|<select\b|<textarea\b|type="submit"/);
	assert.doesNotMatch(route, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
});

test('Risk detail route is read-only and requires the risk to belong to the selected project', async () => {
	const route = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId].astro', import.meta.url), 'utf8');

	assert.match(route, /data-risk-detail-route/);
	assert.match(route, /getProjectRisk\(organisation\.id, data\.id, riskId, workspace\.role, serverSupabase\)/);
	assert.match(route, /Risk not found or you do not have access\./);
	assert.match(route, /Read-only source-of-truth record/);
	for (const label of ['Risk reference', 'Status', 'RAG', 'Exposure', 'Risk owner', 'Actioner', 'Review date', 'Due date', 'Created by', 'Created at', 'Updated by', 'Updated at']) {
		assert.match(route, new RegExp(`<dt>${label}</dt>`));
	}
	assert.match(route, /Mitigation plan/);
	assert.match(route, /Contingency plan/);
	assert.match(route, /disabled[\s\S]*data-risk-edit-disabled/);
	assert.match(route, /Viewer access is read-only\. Risk editing is unavailable\./);
	assert.doesNotMatch(route, /<form\b|<input\b|<select\b|<textarea\b|type="submit"/);
	assert.doesNotMatch(route, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
});

test('Project dashboard Risk tile routes to the Risk Register without loading risk records', async () => {
	const dashboard = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	assert.match(dashboard, /title: 'Risks'[\s\S]*destination: 'risks'[\s\S]*featureKey: 'riskManagement'/);
	assert.match(dashboard, /buildProjectRisksPath\(workspaceSlug \?\? '', project\.slug\)/);
	assert.doesNotMatch(dashboard, /from\('project_risks'\)/);
	assert.doesNotMatch(dashboard, /risk_ref/);
});
