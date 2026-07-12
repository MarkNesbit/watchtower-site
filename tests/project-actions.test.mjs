import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	ACTION_HISTORY_EVENT_TYPES,
	ACTION_SOURCE_TYPES,
	ACTION_STATUSES,
	actionDisplayLabel,
	amendProjectActionBrief,
	assignProjectAction,
	buildActionReference,
	canBeAssignedActionerRole,
	canHoldActionWorkflowRole,
	canTakeOverActionAcceptanceRole,
	cancelProjectAction,
	changeProjectActionDueDate,
	completeProjectAction,
	createProjectAction,
	isActionHistoryEventType,
	isActionSourceType,
	isActionStatus,
	isTerminalActionStatus,
	isValidActionReference,
	mapProjectActionOperationError,
	normaliseActionEvidenceUrl,
	reissueProjectAction,
	rejectProjectAction,
	returnProjectActionToActioner,
	returnProjectActionToRaiser,
	submitProjectAction,
	takeOverProjectActionAcceptance,
} from '../src/lib/projectActions.ts';
import { ACTION_PERMISSIONS, can } from '../src/lib/permissions.ts';

const migrationUrl = new URL('../supabase/migrations/20260712000200_project_actions_schema_foundation.sql', import.meta.url);
const lifecycleMigrationUrl = new URL('../supabase/migrations/20260712000300_project_actions_transactional_lifecycle.sql', import.meta.url);
const migrationSql = async () => readFile(migrationUrl, 'utf8');
const lifecycleMigrationSql = async () => readFile(lifecycleMigrationUrl, 'utf8');

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

test('Project Action lifecycle migration exposes explicit transactional RPCs only', async () => {
	const sql = await lifecycleMigrationSql();
	const rpcFunctions = [
		'create_project_action',
		'submit_project_action',
		'return_project_action_to_raiser',
		'reject_project_action',
		'return_project_action_to_actioner',
		'complete_project_action',
		'cancel_project_action',
		'assign_project_action',
		'amend_project_action_brief',
		'change_project_action_due_date',
		'reissue_project_action',
		'take_over_project_action_acceptance',
	];

	for (const functionName of rpcFunctions) {
		assert.match(sql, new RegExp(`create or replace function public\\.${functionName}\\(`), `Expected ${functionName} RPC`);
		assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}`), `Expected authenticated grant for ${functionName}`);
	}

	assert.match(sql, /language plpgsql[\s\S]*security definer[\s\S]*set search_path = public/);
	assert.match(sql, /create or replace function public\.project_action_insert_history/);
	assert.match(sql, /insert into public\.project_action_history/);
	assert.doesNotMatch(sql, /grant (?:insert|update|delete)[^;]*public\.project_actions[^;]*to authenticated/i);
	assert.doesNotMatch(sql, /grant (?:insert|update|delete)[^;]*public\.project_action_history[^;]*to authenticated/i);
});

test('Project Action lifecycle migration enforces creation role assignment and atomic history rules', async () => {
	const sql = await lifecycleMigrationSql();
	assert.match(sql, /actor_id := public\.project_action_require_authenticated_actor\(\)/);
	assert.match(sql, /public\.project_action_assert_actor_can_create\(project_organisation_id, actor_id\)/);
	assert.match(sql, /public\.project_action_assert_assignable_actioner\(project_organisation_id, p_actioner_id\)/);
	assert.match(sql, /om\.status = 'active'/);
	assert.match(sql, /om\.role in \('owner', 'admin', 'member'\)/);
	assert.match(sql, /raise exception 'WT_ACTION_PERMISSION_DENIED: Only active Owners, Admins and Members can create Actions\.'/);
	assert.match(sql, /raise exception 'WT_ACTION_INELIGIBLE_ACTIONER: Actioner must be an active Owner, Admin or Member in this workspace\.'/);
	assert.match(sql, /values \([\s\S]*p_project_id,[\s\S]*btrim\(p_brief\),[\s\S]*'open',[\s\S]*p_due_date,[\s\S]*actor_id,[\s\S]*p_actioner_id,[\s\S]*actor_id/);
	assert.match(sql, /perform public\.project_action_insert_history\([\s\S]*new_action,[\s\S]*'created'/);
});

test('Project Action lifecycle migration locks rows and rejects stale or terminal operations', async () => {
	const sql = await lifecycleMigrationSql();
	assert.match(sql, /for update;/);
	assert.match(sql, /create or replace function public\.project_action_assert_expected_state/);
	assert.match(sql, /current_status is distinct from expected_status/);
	assert.match(sql, /current_updated_at is distinct from expected_updated_at/);
	assert.match(sql, /WT_ACTION_STALE: Action has changed since it was loaded\./);
	assert.match(sql, /create or replace function public\.project_action_assert_non_terminal/);
	assert.match(sql, /action_status in \('complete', 'cancelled'\)/);
	assert.match(sql, /WT_ACTION_TERMINAL: Complete and cancelled Actions cannot be changed\./);
	assert.match(sql, /create or replace function public\.project_action_assert_timestamp_expected/);
	assert.match(sql, /Expected Action update timestamp is required for this operation/);
});

test('Project Action lifecycle migration implements the locked state transition matrix', async () => {
	const sql = await lifecycleMigrationSql();
	assert.match(sql, /current_action\.status not in \('open', 'returned_to_actioner'\)[\s\S]*Action can only be submitted/);
	assert.match(sql, /set status = 'submitted'[\s\S]*submitted_at = now\(\)/);
	assert.match(sql, /current_action\.status not in \('open', 'returned_to_actioner'\)[\s\S]*Action can only be returned to the raiser/);
	assert.match(sql, /set status = 'returned_to_raiser'/);
	assert.match(sql, /current_action\.status not in \('open', 'returned_to_actioner'\)[\s\S]*Action can only be rejected/);
	assert.match(sql, /set status = 'rejected_by_actioner'/);
	assert.match(sql, /current_action\.status <> 'submitted'[\s\S]*Only submitted Actions can be returned to the Actioner/);
	assert.match(sql, /set status = 'returned_to_actioner'/);
	assert.match(sql, /current_action\.status <> 'submitted'[\s\S]*Only submitted Actions can be completed/);
	assert.match(sql, /set status = 'complete'[\s\S]*completed_at = now\(\)/);
	assert.match(sql, /set status = 'cancelled'[\s\S]*cancelled_at = now\(\)/);
	assert.match(sql, /current_action\.status not in \('returned_to_raiser', 'rejected_by_actioner'\)[\s\S]*Only returned or rejected Actions can be reissued/);
	assert.match(sql, /set status = 'open'[\s\S]*latest_response = null,[\s\S]*latest_evidence_url = null,[\s\S]*submitted_at = null/);
});

test('Project Action lifecycle migration keeps actor authority distinct by role', async () => {
	const sql = await lifecycleMigrationSql();
	assert.match(sql, /project_action_assert_current_actioner\(current_action\.organisation_id, current_action\.actioner_id, actor_id\)/);
	assert.match(sql, /expected_actioner_id is null or expected_actioner_id is distinct from actor_id/);
	assert.match(sql, /project_action_assert_acceptance_owner\(current_action\.organisation_id, current_action\.acceptance_owner_id, actor_id\)/);
	assert.match(sql, /expected_acceptance_owner_id is distinct from actor_id/);
	assert.match(sql, /project_action_assert_owner_admin\(current_action\.organisation_id, actor_id\)/);
	assert.match(sql, /has_active_organisation_role\(target_organisation_id, array\['owner', 'admin'\], actor_id\)/);
	assert.match(sql, /acceptance_owner_id = actor_id/);
	assert.match(sql, /'acceptance_owner_taken_over'/);
	assert.match(sql, /'raiser_id', current_action\.raiser_id/);
});

test('Project Action lifecycle migration records before and after values for changes', async () => {
	const sql = await lifecycleMigrationSql();
	assert.match(sql, /event_type := case[\s\S]*'assigned'[\s\S]*'unassigned'[\s\S]*'reassigned'/);
	assert.match(sql, /current_action\.status = 'submitted'[\s\S]*Reassignment is blocked while an Action is submitted/);
	assert.match(sql, /'brief_amended'[\s\S]*jsonb_build_object\('brief', current_action\.brief\)[\s\S]*jsonb_build_object\('brief', updated_action\.brief\)/);
	assert.match(sql, /'due_date_changed'[\s\S]*jsonb_build_object\('due_date', current_action\.due_date\)[\s\S]*jsonb_build_object\('due_date', updated_action\.due_date\)/);
	assert.match(sql, /'reissued'[\s\S]*'latest_response', current_action\.latest_response[\s\S]*'latest_evidence_url', updated_action\.latest_evidence_url/);
	assert.match(sql, /'acceptance_owner_taken_over'[\s\S]*'acceptance_owner_id', current_action\.acceptance_owner_id[\s\S]*'acceptance_owner_id', updated_action\.acceptance_owner_id/);
});

test('Project Action operation errors map controlled database failures for future UI', () => {
	const expectations = [
		['WT_ACTION_PERMISSION_DENIED: no', 'permission_denied'],
		['WT_ACTION_INVALID_TRANSITION: no', 'invalid_transition'],
		['WT_ACTION_INELIGIBLE_ACTIONER: no', 'ineligible_actioner'],
		['WT_ACTION_STALE: no', 'stale_operation'],
		['WT_ACTION_MISSING_RESPONSE: no', 'missing_response'],
		['WT_ACTION_MISSING_REASON: no', 'missing_reason'],
		['WT_ACTION_MISSING_BRIEF: no', 'missing_brief'],
		['WT_ACTION_MISSING_DUE_DATE: no', 'missing_due_date'],
		['WT_ACTION_UNSAFE_EVIDENCE_URL: no', 'unsafe_evidence_url'],
		['WT_ACTION_TERMINAL: no', 'terminal_action'],
		['WT_ACTION_SCOPE: no', 'cross_workspace_access'],
		['WT_ACTION_INVALID_SOURCE: no', 'invalid_source'],
	];

	for (const [message, code] of expectations) {
		assert.equal(mapProjectActionOperationError({ message }).code, code);
	}
	assert.equal(mapProjectActionOperationError({ message: 'database unavailable' }).code, 'unknown');
});

test('Project Action RPC wrappers call explicit lifecycle functions with expected state', async () => {
	const calls = [];
	const action = { id: 'action-1', status: 'open' };
	const client = {
		async rpc(functionName, args) {
			calls.push({ functionName, args });
			return { data: { ...action, functionName }, error: null };
		},
	};
	const expected = { actionId: 'action-1', expectedStatus: 'open', expectedUpdatedAt: '2026-07-12T10:00:00.000Z' };

	await createProjectAction(client, {
		projectId: 'project-1',
		brief: 'Confirm hosting fallback approach',
		dueDate: '2026-07-20',
		actionerId: null,
		sourceType: 'project',
	});
	await submitProjectAction(client, { ...expected, response: 'Done', evidenceUrl: 'https://example.com/evidence' });
	await returnProjectActionToRaiser(client, { ...expected, reason: 'Need clarification' });
	await rejectProjectAction(client, { ...expected, reason: 'Cannot accept ownership' });
	await returnProjectActionToActioner(client, { ...expected, reason: 'Please expand the evidence' });
	await completeProjectAction(client, expected);
	await cancelProjectAction(client, { ...expected, reason: 'No longer required' });
	await assignProjectAction(client, { ...expected, actionerId: 'profile-2' });
	await amendProjectActionBrief(client, { ...expected, brief: 'Updated brief' });
	await changeProjectActionDueDate(client, { ...expected, dueDate: '2026-07-24' });
	await reissueProjectAction(client, { ...expected, brief: 'Reissued brief', actionerId: null });
	await takeOverProjectActionAcceptance(client, { ...expected, reason: 'Acceptance owner unavailable' });

	assert.deepEqual(calls.map((call) => call.functionName), [
		'create_project_action',
		'submit_project_action',
		'return_project_action_to_raiser',
		'reject_project_action',
		'return_project_action_to_actioner',
		'complete_project_action',
		'cancel_project_action',
		'assign_project_action',
		'amend_project_action_brief',
		'change_project_action_due_date',
		'reissue_project_action',
		'take_over_project_action_acceptance',
	]);
	assert.equal(calls[1].args.p_expected_status, 'open');
	assert.equal(calls[1].args.p_expected_updated_at, '2026-07-12T10:00:00.000Z');
	assert.equal(calls[1].args.p_evidence_url, 'https://example.com/evidence');
	assert.equal(calls[10].args.p_change_actioner, true);
	assert.equal(calls[10].args.p_actioner_id, null);
});

test('Project Action RPC wrappers surface controlled operation errors', async () => {
	const client = {
		async rpc() {
			return { data: null, error: { message: 'WT_ACTION_STALE: Action has changed since it was loaded.' } };
		},
	};

	await assert.rejects(
		() => completeProjectAction(client, { actionId: 'action-1', expectedStatus: 'submitted' }),
		(error) => error.code === 'stale_operation',
	);
});
