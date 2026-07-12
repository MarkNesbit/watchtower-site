import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	ACTION_HISTORY_EVENT_TYPES,
	ACTION_SOURCE_TYPES,
	ACTION_STATUSES,
	actionDisplayLabel,
	buildActionReference,
	canBeAssignedActionerRole,
	canHoldActionWorkflowRole,
	canTakeOverActionAcceptanceRole,
	isActionHistoryEventType,
	isActionSourceType,
	isActionStatus,
	isTerminalActionStatus,
	isValidActionReference,
	normaliseActionEvidenceUrl,
} from '../src/lib/projectActions.ts';
import { ACTION_PERMISSIONS, can } from '../src/lib/permissions.ts';

const migrationUrl = new URL('../supabase/migrations/20260712000200_project_actions_schema_foundation.sql', import.meta.url);
const migrationSql = async () => readFile(migrationUrl, 'utf8');

test('Project Action migration creates counters actions and immutable history tables', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create table public\.project_action_counters \(/);
	assert.match(sql, /create table public\.project_actions \(/);
	assert.match(sql, /create table public\.project_action_history \(/);

	for (const field of [
		'project_id uuid primary key',
		'organisation_id uuid not null',
		'last_action_number integer not null default 0',
		'created_at timestamptz not null default now()',
		'updated_at timestamptz not null default now()',
	]) {
		assert.ok(sql.includes(field), `Expected counter migration to contain ${field}`);
	}

	for (const field of [
		'id uuid primary key default gen_random_uuid()',
		'organisation_id uuid not null',
		'project_id uuid not null',
		'action_number integer not null',
		'action_ref text not null',
		'brief text not null',
		"status text not null default 'open'",
		'due_date date not null',
		'raiser_id uuid not null',
		'actioner_id uuid',
		'acceptance_owner_id uuid not null',
		"source_type text not null default 'project'",
		'source_record_id uuid',
		'source_ref text',
		'source_label text',
		"source_context jsonb not null default '{}'::jsonb",
		'latest_response text',
		'latest_evidence_url text',
		'submitted_at timestamptz',
		'completed_at timestamptz',
		'cancelled_at timestamptz',
		'created_by uuid not null',
		'updated_by uuid',
		'created_at timestamptz not null default now()',
		'updated_at timestamptz not null default now()',
	]) {
		assert.ok(sql.includes(field), `Expected actions migration to contain ${field}`);
	}

	for (const field of [
		'action_id uuid not null',
		'event_type text not null',
		'actor_user_id uuid',
		'from_status text',
		'to_status text',
		'reason text',
		'response text',
		'evidence_url text',
		'old_values jsonb',
		'new_values jsonb',
		'created_at timestamptz not null default now()',
	]) {
		assert.ok(sql.includes(field), `Expected history migration to contain ${field}`);
	}
});

test('Project Action migration constrains lifecycle source values validation and scope', async () => {
	const sql = await migrationSql();
	assert.match(sql, /foreign key \(project_id, organisation_id\)[\s\S]*references public\.projects\(id, organisation_id\)/);
	assert.match(sql, /constraint project_action_history_action_scope_fk[\s\S]*foreign key \(action_id, project_id, organisation_id\)[\s\S]*references public\.project_actions\(id, project_id, organisation_id\)/);
	assert.match(sql, /constraint project_actions_status_check[\s\S]*'open', 'submitted', 'returned_to_raiser', 'rejected_by_actioner', 'returned_to_actioner', 'complete', 'cancelled'/);
	assert.match(sql, /constraint project_actions_source_type_check[\s\S]*'project', 'risk', 'project_details', 'narrative'/);
	assert.match(sql, /constraint project_action_history_event_type_check[\s\S]*'created', 'assigned', 'unassigned', 'reassigned', 'brief_amended', 'due_date_changed', 'submitted', 'returned_to_raiser', 'rejected_by_actioner', 'returned_to_actioner', 'reissued', 'acceptance_owner_taken_over', 'completed', 'cancelled'/);
	assert.match(sql, /project_actions_brief_not_empty_check[\s\S]*length\(btrim\(brief\)\) > 0/);
	assert.match(sql, /project_actions_action_number_positive_check[\s\S]*action_number > 0/);
	assert.match(sql, /project_actions_action_ref_format_check[\s\S]*\^Action-\[A-Z\]\[A-Z0-9\]\{2,3\}-\[0-9\]\{3,\}\$/);
	assert.match(sql, /project_actions_latest_evidence_url_safe_check[\s\S]*latest_evidence_url is null or latest_evidence_url ~\* '\^https\?:\/\//);
	assert.match(sql, /project_action_history_evidence_url_safe_check[\s\S]*evidence_url is null or evidence_url ~\* '\^https\?:\/\//);
	assert.match(sql, /project_actions_source_context_object_check[\s\S]*jsonb_typeof\(source_context\) = 'object'/);
	assert.match(sql, /project_action_history_old_values_object_check[\s\S]*old_values is null or jsonb_typeof\(old_values\) = 'object'/);
	assert.match(sql, /project_action_history_new_values_object_check[\s\S]*new_values is null or jsonb_typeof\(new_values\) = 'object'/);
});

test('Project Action references use the Project Narrative counter pattern rather than Risk retry generation', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create or replace function public\.prepare_project_action_insert\(\)/);
	assert.match(sql, /select projects\.organisation_id, projects\.project_ref/);
	assert.match(sql, /insert into public\.project_action_counters \(project_id, organisation_id, last_action_number\)/);
	assert.match(sql, /on conflict \(project_id\) do update/);
	assert.match(sql, /last_action_number = project_action_counters\.last_action_number \+ 1/);
	assert.match(sql, /returning last_action_number[\s\S]*into new\.action_number/);
	assert.match(sql, /'Action-%s-%s'/);
	assert.match(sql, /lpad\(new\.action_number::text, 3, '0'\)/);
	assert.match(sql, /new\.organisation_id = target_organisation_id/);
	assert.match(sql, /new\.created_by = auth\.uid\(\)/);
	assert.match(sql, /new\.updated_by = auth\.uid\(\)/);
	assert.match(sql, /new\.acceptance_owner_id = new\.raiser_id/);
	assert.doesNotMatch(sql, /MAX_RISK_REF_INSERT_ATTEMPTS|getNextRiskSequence|buildRiskReference/);
	assert.match(sql, /unique \(project_id, action_number\)/);
	assert.match(sql, /unique \(project_id, action_ref\)/);
	assert.match(sql, /unique \(organisation_id, action_ref\)/);
});

test('Project Action indexes support project source and user-relative queues without speculative archive fields', async () => {
	const sql = await migrationSql();
	for (const index of [
		'project_actions_project_status_due_idx',
		'project_actions_actioner_status_due_idx',
		'project_actions_acceptance_owner_status_idx',
		'project_actions_raiser_status_idx',
		'project_actions_source_idx',
		'project_action_history_action_created_idx',
		'project_action_history_actor_created_idx',
	]) {
		assert.match(sql, new RegExp(`create index ${index}`));
	}
	assert.match(sql, /on public\.project_actions \(organisation_id, project_id, status, due_date\)/);
	assert.match(sql, /on public\.project_actions \(organisation_id, actioner_id, status, due_date\)[\s\S]*where actioner_id is not null/);
	assert.match(sql, /on public\.project_actions \(organisation_id, project_id, source_type, source_record_id\)[\s\S]*where source_record_id is not null/);
	assert.doesNotMatch(sql, /\barchived_at\b|\bdeleted_at\b/);
});

test('Project Action RLS and grants keep Viewer read-only and expose no direct deletes', async () => {
	const sql = await migrationSql();
	assert.match(sql, /alter table public\.project_action_counters enable row level security/);
	assert.match(sql, /alter table public\.project_actions enable row level security/);
	assert.match(sql, /alter table public\.project_action_history enable row level security/);
	assert.match(sql, /Active members can read project actions/);
	assert.match(sql, /is_active_organisation_member\(project_actions\.organisation_id\)/);
	assert.match(sql, /Active members can read project action history/);
	assert.match(sql, /is_active_organisation_member\(project_action_history\.organisation_id\)/);
	assert.match(sql, /grant select on table public\.project_actions, public\.project_action_history to authenticated/);
	assert.doesNotMatch(sql, /grant (?:insert|update|delete)[^;]*public\.project_actions[^;]*to authenticated/i);
	assert.doesNotMatch(sql, /grant (?:insert|update|delete)[^;]*public\.project_action_history[^;]*to authenticated/i);
	assert.doesNotMatch(sql, /grant [^;]*project_action_counters[^;]*to authenticated/i);

	assert.deepEqual([...ACTION_PERMISSIONS], [
		'action.view',
		'action.create',
		'action.respond',
		'action.review',
		'action.manage',
		'action.takeover',
	]);
	for (const role of ['owner', 'admin']) {
		for (const permission of ACTION_PERMISSIONS) assert.equal(can(role, permission), true);
	}
	for (const permission of ['action.view', 'action.create', 'action.respond', 'action.review', 'action.manage']) {
		assert.equal(can('member', permission), true);
	}
	assert.equal(can('member', 'action.takeover'), false);
	assert.equal(can('viewer', 'action.view'), true);
	for (const permission of ['action.create', 'action.respond', 'action.review', 'action.manage', 'action.takeover']) {
		assert.equal(can('viewer', permission), false);
	}
});

test('Project Action history is append-only and tied to the linked Action scope', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create or replace function public\.prevent_project_action_history_mutation\(\)/);
	assert.match(sql, /raise exception 'Project Action history is immutable\.'/);
	assert.match(sql, /create trigger prevent_project_action_history_update[\s\S]*before update on public\.project_action_history/);
	assert.match(sql, /create trigger prevent_project_action_history_delete[\s\S]*before delete on public\.project_action_history/);
	assert.match(sql, /coalesce\(auth\.role\(\), ''\) = 'service_role'/);
	assert.match(sql, /constraint project_action_history_action_scope_fk[\s\S]*references public\.project_actions\(id, project_id, organisation_id\)/);
	assert.doesNotMatch(sql, /grant update[^;]*project_action_history to authenticated/i);
	assert.doesNotMatch(sql, /grant delete[^;]*project_action_history to authenticated/i);
});

test('Project Action identity and scope cannot be changed after creation', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create or replace function public\.prevent_project_action_identity_update\(\)/);
	for (const identity of ['organisation_id', 'project_id', 'action_number', 'action_ref', 'raiser_id', 'created_by', 'created_at']) {
		assert.match(sql, new RegExp(`old\\.${identity} is distinct from new\\.${identity}`));
	}
	assert.match(sql, /before update on public\.project_actions/);
});

test('Project Action helper constants and type guards match the locked MVP model', () => {
	assert.deepEqual(ACTION_STATUSES, ['open', 'submitted', 'returned_to_raiser', 'rejected_by_actioner', 'returned_to_actioner', 'complete', 'cancelled']);
	assert.deepEqual(ACTION_SOURCE_TYPES, ['project', 'risk', 'project_details', 'narrative']);
	assert.deepEqual(ACTION_HISTORY_EVENT_TYPES, ['created', 'assigned', 'unassigned', 'reassigned', 'brief_amended', 'due_date_changed', 'submitted', 'returned_to_raiser', 'rejected_by_actioner', 'returned_to_actioner', 'reissued', 'acceptance_owner_taken_over', 'completed', 'cancelled']);
	assert.equal(isActionStatus('submitted'), true);
	assert.equal(isActionStatus('done'), false);
	assert.equal(isActionSourceType('risk'), true);
	assert.equal(isActionSourceType('issue'), false);
	assert.equal(isActionHistoryEventType('acceptance_owner_taken_over'), true);
	assert.equal(isActionHistoryEventType('commented'), false);
	assert.equal(actionDisplayLabel('submitted'), 'Awaiting raiser review');
	assert.equal(actionDisplayLabel('returned_to_actioner'), 'Further work required');
	assert.equal(actionDisplayLabel('unknown'), 'Unknown');
	assert.equal(isTerminalActionStatus('complete'), true);
	assert.equal(isTerminalActionStatus('cancelled'), true);
	assert.equal(isTerminalActionStatus('open'), false);
});

test('Project Action reference and evidence URL helpers validate safely', () => {
	assert.equal(buildActionReference('HHH', 1), 'Action-HHH-001');
	assert.equal(buildActionReference('H1H2', 12), 'Action-H1H2-012');
	assert.equal(isValidActionReference('Action-HHH-001'), true);
	assert.equal(isValidActionReference('Action-HH-001'), false);
	assert.equal(isValidActionReference('Risk-HHH-001'), false);
	assert.throws(() => buildActionReference('HH', 1), /valid project reference/);
	assert.throws(() => buildActionReference('HHH', 0), /valid Action reference/);

	assert.equal(normaliseActionEvidenceUrl('https://example.com/path?q=1'), 'https://example.com/path?q=1');
	assert.equal(normaliseActionEvidenceUrl(' http://example.com '), 'http://example.com/');
	assert.equal(normaliseActionEvidenceUrl(''), null);
	assert.throws(() => normaliseActionEvidenceUrl('javascript:alert(1)'), /safe evidence URL/);
	assert.throws(() => normaliseActionEvidenceUrl('not-a-url'), /valid evidence URL/);
});

test('Project Action role helpers keep assignment and takeover eligibility explicit', () => {
	for (const role of ['owner', 'admin', 'member']) {
		assert.equal(canHoldActionWorkflowRole(role), true);
		assert.equal(canBeAssignedActionerRole(role), true);
	}
	assert.equal(canHoldActionWorkflowRole('viewer'), false);
	assert.equal(canBeAssignedActionerRole('viewer'), false);
	assert.equal(canHoldActionWorkflowRole('unknown'), false);
	assert.equal(canTakeOverActionAcceptanceRole('owner'), true);
	assert.equal(canTakeOverActionAcceptanceRole('admin'), true);
	assert.equal(canTakeOverActionAcceptanceRole('member'), false);
	assert.equal(canTakeOverActionAcceptanceRole('viewer'), false);
});
