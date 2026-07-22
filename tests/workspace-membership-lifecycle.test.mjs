import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20260722000100_workspace_membership_lifecycle_audit_schema.sql', import.meta.url);

async function migrationSql() {
	return readFile(migrationUrl, 'utf8');
}

function objectBlock(sql, startPattern, endPattern) {
	const start = sql.search(startPattern);
	assert.notEqual(start, -1, `Expected block start ${startPattern}`);
	const rest = sql.slice(start);
	const end = rest.search(endPattern);
	assert.notEqual(end, -1, `Expected block end ${endPattern}`);
	return rest.slice(0, end);
}

test('Workspace Team lifecycle migration adds profile identity fields safely', async () => {
	const sql = await migrationSql();
	assert.match(sql, /alter table public\.profiles[\s\S]*add column if not exists first_name text/);
	assert.match(sql, /add column if not exists last_name text/);
	assert.match(sql, /add column if not exists login_name text/);
	assert.match(sql, /add column if not exists contact_email text/);
	assert.match(sql, /update public\.profiles\s+set contact_email = lower\(btrim\(email\)\)/);
	assert.match(sql, /profiles_login_name_normalised_check[\s\S]*login_name = lower\(btrim\(login_name\)\)/);
	assert.match(sql, /create unique index profiles_login_name_normalised_key[\s\S]*lower\(login_name\)[\s\S]*where login_name is not null/);
	assert.match(sql, /profiles_contact_email_normalised_check[\s\S]*contact_email = lower\(btrim\(contact_email\)\)/);
	assert.match(sql, /comment on column public\.profiles\.email[\s\S]*Compatibility mirror of auth\.users\.email/);
});

test('Membership status model resolves removed to deactivated and preserves active as the RLS boundary', async () => {
	const sql = await migrationSql();
	assert.match(sql, /set status = 'deactivated'[\s\S]*where status = 'removed'/);
	assert.match(sql, /drop constraint if exists organisation_members_status_check/);
	assert.match(sql, /status in \('invited', 'invite_expired', 'active', 'suspended', 'deactivated'\)/);
	assert.doesNotMatch(sql, /status in \('active', 'invited', 'suspended', 'removed'\)/);
	assert.match(sql, /comment on column public\.organisation_members\.status[\s\S]*Legacy removed values are migrated to deactivated/);
});

test('Membership lifecycle fields and constraints reject invalid state combinations', async () => {
	const sql = await migrationSql();
	for (const field of [
		'invitation_expires_at',
		'accepted_at',
		'suspended_at',
		'suspended_by',
		'suspension_reason',
		'deactivated_at',
		'deactivated_by',
		'deactivation_reason',
		'reactivated_at',
		'reactivated_by',
		'reactivation_reason',
		'updated_by',
	]) {
		assert.match(sql, new RegExp(`add column if not exists ${field}`));
	}
	assert.match(sql, /organisation_members_invited_state_check[\s\S]*status not in \('invited', 'invite_expired'\) or invited_at is not null/);
	assert.match(sql, /organisation_members_invite_expired_state_check[\s\S]*status <> 'invite_expired' or invitation_expires_at is not null/);
	assert.match(sql, /organisation_members_suspended_state_check[\s\S]*status <> 'suspended' or suspended_at is not null/);
	assert.match(sql, /organisation_members_deactivated_state_check[\s\S]*status <> 'deactivated' or deactivated_at is not null/);
	assert.match(sql, /organisation_members_active_after_deactivation_check[\s\S]*reactivated_at is not null and reactivated_at >= deactivated_at/);
});

test('Same-workspace identity views expose safe fields and keep contact email admin-only', async () => {
	const sql = await migrationSql();
	const memberView = objectBlock(sql, /create or replace view public\.workspace_member_directory/, /create or replace view public\.workspace_member_admin_directory/);
	const adminView = objectBlock(sql, /create or replace view public\.workspace_member_admin_directory/, /comment on view public\.workspace_member_directory/);
	assert.match(memberView, /where public\.is_active_organisation_member\(om\.organisation_id\)/);
	assert.match(memberView, /p\.display_name/);
	assert.match(memberView, /p\.login_name/);
	assert.match(memberView, /om\.status as membership_status/);
	assert.doesNotMatch(memberView, /contact_email|auth_email|p\.email/);
	assert.match(adminView, /p\.contact_email/);
	assert.match(adminView, /p\.email as auth_email/);
	assert.match(adminView, /public\.has_real_active_organisation_role\(om\.organisation_id, array\['owner', 'admin'\]\)/);
	assert.match(sql, /grant select on public\.workspace_member_directory to authenticated/);
	assert.match(sql, /grant select on public\.workspace_member_admin_directory to authenticated/);
});

test('Lifecycle functions exist, lock memberships and write audit events transactionally', async () => {
	const sql = await migrationSql();
	for (const functionName of [
		'create_workspace_membership_invitation',
		'expire_workspace_membership_invitation',
		'activate_workspace_membership',
		'suspend_workspace_membership',
		'deactivate_workspace_membership',
		'reactivate_workspace_membership',
		'correct_workspace_member_profile_identity',
	]) {
		assert.match(sql, new RegExp(`create or replace function public\\.${functionName}`));
		assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}`));
	}
	assert.match(sql, /where id = target_membership_id\s+for update/);
	assert.match(sql, /perform public\.record_workspace_membership_audit_event/);
	assert.match(sql, /perform set_config\('watchtower\.membership_lifecycle_rpc', 'true', true\)/);
	assert.match(sql, /WT_MEMBERSHIP_INVALID_TRANSITION/);
});

test('Lifecycle protection uses real stored roles rather than simulated effective roles', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create or replace function public\.has_real_active_organisation_role/);
	assert.match(sql, /create or replace function public\.real_active_organisation_role/);
	const realRoleHelper = objectBlock(sql, /create or replace function public\.real_active_organisation_role/, /create or replace view public\.workspace_member_directory/);
	assert.match(realRoleHelper, /om\.status = 'active'/);
	assert.match(realRoleHelper, /select om\.role/);
	assert.doesNotMatch(realRoleHelper, /active_internal_role_simulation|coalesce\(/);
	const adminActorHelper = objectBlock(sql, /create or replace function public\.workspace_membership_require_admin_actor/, /create or replace function public\.workspace_membership_assert_actor_can_change_target/);
	assert.match(adminActorHelper, /om\.status = 'active'/);
	assert.match(adminActorHelper, /actor_role not in \('owner', 'admin'\)/);
	assert.doesNotMatch(adminActorHelper, /has_active_organisation_role|active_internal_role_simulation/);
});

test('Owner Admin and self-deactivation safeguards are enforced in the database', async () => {
	const sql = await migrationSql();
	assert.match(sql, /WT_MEMBERSHIP_SELF_CHANGE_DENIED/);
	assert.match(sql, /target_membership\.user_id = actor_user_id/);
	assert.match(sql, /actor_role = 'admin' and target_membership\.role in \('owner', 'admin'\)/);
	assert.match(sql, /WT_MEMBERSHIP_PROTECTED_ROLE/);
	assert.match(sql, /create or replace function public\.workspace_membership_assert_not_final_owner/);
	assert.match(sql, /om\.role = 'owner'\s+and om\.status = 'active'/);
	assert.match(sql, /WT_MEMBERSHIP_FINAL_OWNER/);
	assert.match(sql, /old\.role = 'owner'[\s\S]*old\.status = 'active'[\s\S]*new\.role <> 'owner' or new\.status <> 'active'/);
});

test('Direct unsafe membership lifecycle updates are narrowed once RPCs exist', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create or replace function public\.prevent_unsafe_workspace_membership_update/);
	assert.match(sql, /drop trigger if exists prevent_unsafe_workspace_membership_update/);
	assert.match(sql, /create trigger prevent_unsafe_workspace_membership_update[\s\S]*before update on public\.organisation_members/);
	assert.match(sql, /Use controlled workspace membership lifecycle functions/);
	assert.match(sql, /revoke update \([\s\S]*role,[\s\S]*status,[\s\S]*invited_by,[\s\S]*invited_at,[\s\S]*joined_at,[\s\S]*updated_at[\s\S]*\) on public\.organisation_members from authenticated/);
});

test('Membership audit events are append-only and owner/admin scoped', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create table public\.workspace_membership_audit_events/);
	assert.match(sql, /event_type in \([\s\S]*'membership_invited'[\s\S]*'invitation_expired'[\s\S]*'membership_activated'[\s\S]*'membership_suspended'[\s\S]*'membership_deactivated'[\s\S]*'membership_reactivated'[\s\S]*'profile_identity_corrected'/);
	assert.match(sql, /'membership_import_proposed'[\s\S]*'membership_import_applied'[\s\S]*'membership_import_failed'[\s\S]*'membership_export_generated'[\s\S]*'membership_export_superseded'/);
	assert.match(sql, /previous_values jsonb not null default '\{\}'::jsonb/);
	assert.match(sql, /new_values jsonb not null default '\{\}'::jsonb/);
	assert.match(sql, /create trigger prevent_workspace_membership_audit_update/);
	assert.match(sql, /create trigger prevent_workspace_membership_audit_delete/);
	assert.match(sql, /Workspace membership audit events are append-only/);
	assert.match(sql, /create policy "Owners and admins can read workspace membership audit events"/);
	assert.doesNotMatch(sql, /workspace_membership_audit_events for update[\s\S]*to authenticated/);
	assert.doesNotMatch(sql, /grant insert on public\.workspace_membership_audit_events to authenticated/);
});

test('CSV administration schema foundation is present and workspace-isolated', async () => {
	const sql = await migrationSql();
	for (const tableName of [
		'workspace_membership_export_runs',
		'workspace_membership_import_runs',
		'workspace_membership_import_rows',
		'workspace_membership_change_decisions',
	]) {
		assert.match(sql, new RegExp(`create table public\\.${tableName}`));
		assert.match(sql, new RegExp(`alter table public\\.${tableName} enable row level security`));
		assert.match(sql, new RegExp(`public\\.has_real_active_organisation_role\\(${tableName}\\.organisation_id, array\\['owner', 'admin'\\]`));
	}
	assert.match(sql, /membership_snapshot_version bigint not null/);
	assert.match(sql, /source_snapshot_version bigint/);
	assert.match(sql, /source_row_number integer not null/);
	assert.match(sql, /validation_messages jsonb not null default '\[\]'::jsonb/);
	assert.match(sql, /decision text not null default 'pending'/);
	assert.match(sql, /superseded_by_export_id uuid references public\.workspace_membership_export_runs/);
	assert.match(sql, /takeover_of_export_id uuid references public\.workspace_membership_export_runs/);
});

test('New security definer functions use safe search path and least privilege grants', async () => {
	const sql = await migrationSql();
	const functionCount = (sql.match(/security definer\s+set search_path = public/g) ?? []).length;
	assert.ok(functionCount >= 12, 'expected membership functions to use security definer with explicit search path');
	assert.match(sql, /revoke all on function public\.record_workspace_membership_audit_event/);
	assert.match(sql, /grant execute on function public\.record_workspace_membership_audit_event[\s\S]*to service_role/);
	assert.doesNotMatch(sql, /grant execute on function public\.record_workspace_membership_audit_event[\s\S]*to authenticated/);
	assert.match(sql, /grant execute on function public\.deactivate_workspace_membership[\s\S]*to authenticated, service_role/);
});

test('Slice does not implement UI CSV parsing invitation delivery auth user creation or login-name auth', async () => {
	const sql = await migrationSql();
	assert.doesNotMatch(sql, /supabase\.auth|auth\.admin|inviteUserByEmail|generateLink|createUser/i);
	assert.doesNotMatch(sql, /copy .*csv|parse csv|file_bytes|storage\.objects/i);
	assert.doesNotMatch(sql, /signInWithPassword|resetPasswordForEmail|login_name authentication/i);
});
