import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	WORKSPACE_INVITATION_EXPIRY_HOURS,
	buildWorkspaceInvitationAcceptPath,
	generateInvitationToken,
	hashInvitationToken,
	invitationDeliveryMode,
	renderInvitationEmail,
} from '../src/lib/workspaceInvitations.ts';
import { buildWorkspaceTeamInvitationSendPath } from '../src/lib/projectRoutes.ts';

const migrationUrl = new URL('../supabase/migrations/20260723001100_workspace_membership_invitation_delivery_activation.sql', import.meta.url);
const sendRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/invitations/send.ts', import.meta.url);
const acceptPageUrl = new URL('../src/pages/invitations/accept.astro', import.meta.url);
const teamPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);
const schemaDocsUrl = new URL('../docs/architecture/database-schema-v1.md', import.meta.url);

test('Workspace Team invitation route helpers and token helpers are opaque and stable', async () => {
	const token = generateInvitationToken();
	const tokenHash = await hashInvitationToken(token);

	assert.equal(buildWorkspaceTeamInvitationSendPath('alpha workspace'), '/app/workspaces/alpha%20workspace/team/invitations/send');
	assert.match(token, /^[a-f0-9]{64}$/);
	assert.match(tokenHash, /^[a-f0-9]{64}$/);
	assert.notEqual(tokenHash, token);
	assert.equal(buildWorkspaceInvitationAcceptPath(token, 'https://watchtower.example').startsWith('https://watchtower.example/invitations/accept?token='), true);
	assert.equal(WORKSPACE_INVITATION_EXPIRY_HOURS, 72);
	assert.equal(invitationDeliveryMode(), 'provider_required');
});

test('Workspace invitation migration creates separate invitation lifecycle with token hashes only', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /create table if not exists public\.workspace_membership_invitations/);
	assert.match(sql, /token_hash text/);
	assert.match(sql, /workspace_membership_invitations_token_hash_unique/);
	assert.match(sql, /workspace_membership_invitations_current_unique/);
	assert.match(sql, /workspace_invitation_expiry_interval\(\)[\s\S]*interval '72 hours'/);
	for (const status of ['pending_delivery', 'sending', 'delivered', 'delivery_failed', 'opened', 'accepted', 'expired', 'cancelled', 'superseded']) {
		assert.match(sql, new RegExp(`'${status}'`));
	}
	assert.doesNotMatch(sql, /raw_token|plain_token|password text|encrypted_password.*token/i);
});

test('Workspace invitation migration derives identity from handoff and blocks shared contacts without immutable policy', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /create table if not exists public\.workspace_invitation_delivery_policies/);
	assert.match(sql, /delivery_strategy in \('normal_smtp', 'internal_gmail_alias', 'test_record_only'\)/);
	assert.match(sql, /public\.is_internal_role_simulation_workspace\(p_organisation_id\)/);
	assert.match(sql, /shared_contact_policy_required/);
	assert.match(sql, /existing_account_link_required/);
	assert.match(sql, /workspace_invitation_internal_alias_email/);
	assert.match(sql, /update auth\.users as au[\s\S]*set email = v_auth_email/);
	assert.match(sql, /update public\.profiles as profile[\s\S]*set email = v_auth_email/);
	assert.doesNotMatch(sql, /where lower\(p\.contact_email\) = .*return.*profile_id/is);
});

test('Workspace invitation RPCs enforce admin delivery and linked-account acceptance', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	for (const fn of [
		'prepare_workspace_membership_invitations',
		'record_workspace_membership_invitation_delivery_result',
		'cancel_workspace_membership_invitation',
		'get_workspace_membership_invitation_by_token',
		'accept_workspace_membership_invitation',
	]) {
		assert.match(sql, new RegExp(`create or replace function public\\.${fn}`));
	}
	assert.match(sql, /workspace_membership_require_admin_actor\(p_organisation_id\)/);
	assert.match(sql, /workspace_membership_require_admin_actor\(v_invitation\.organisation_id\)/);
	assert.match(sql, /auth\.uid\(\) <> v_invitation\.auth_user_id/);
	assert.match(sql, /and om\.role = v_invitation\.intended_role/);
	assert.match(sql, /status = 'active'/);
	assert.match(sql, /workspace_invitation_replay_rejected/);
	assert.match(sql, /grant execute on function public\.get_workspace_membership_invitation_by_token\(text\) to anon, authenticated, service_role/);
	assert.doesNotMatch(sql, /grant update .*workspace_membership_invitations to authenticated/i);
});

test('Workspace invitation send route does not expose privileged keys or fake provider delivery', async () => {
	const route = await readFile(sendRouteUrl, 'utf8');

	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(route, /workspace\.role !== 'owner' && workspace\.role !== 'admin'/);
	assert.match(route, /generateInvitationToken\(\)/);
	assert.match(route, /hashInvitationToken\(token\)/);
	assert.match(route, /prepare_workspace_membership_invitations/);
	assert.match(route, /record_workspace_membership_invitation_delivery_result/);
	assert.match(route, /provider_not_configured/);
	assert.match(route, /test_record_only/);
	assert.match(route, /renderInvitationEmail/);
	assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE|service_role|auth\.admin|console\.log\(.*token|rawToken.*console/i);
});

test('Workspace invitation acceptance page validates before disclosure and blocks wrong account', async () => {
	const page = await readFile(acceptPageUrl, 'utf8');

	assert.match(page, /get_workspace_membership_invitation_by_token/);
	assert.match(page, /accept_workspace_membership_invitation/);
	assert.match(page, /This invitation link is invalid, expired, cancelled or has already been used/);
	assert.match(page, /This invitation belongs to another account/);
	assert.match(page, /Password setup is completed through the secure provider invitation email/);
	assert.doesNotMatch(page, /from\('workspace_membership_invitations'\)\.select|auth\.admin|service_role/i);
});

test('Workspace invitation UI and documentation describe delivery without activation', async () => {
	const page = await readFile(teamPageUrl, 'utf8');
	const docs = await readFile(docsUrl, 'utf8');
	const schemaDocs = await readFile(schemaDocsUrl, 'utf8');
	const email = renderInvitationEmail({
		workspaceName: 'Alpha Workspace',
		personName: 'Amelia Bennett',
		roleLabel: 'Viewer',
		acceptUrl: 'https://watchtower.example/invitations/accept?token=abc',
		expiresAt: '2026-07-26T12:00:00Z',
	});

	assert.match(page, /Delivery alone does not activate workspace access/);
	assert.match(page, /id="workspace-team-invitation-bulk-dialog"/);
	assert.match(page, /workspaceInvitationStatusLabel/);
	assert.match(page, /Cancel invitation/);
	assert.match(email.subject, /invited to the Watchtower workspace/);
	assert.match(email.text, /You have been invited to join Alpha Workspace/);
	assert.match(email.html, /Accept invitation/);
	assert.match(docs, /WT-WORKSPACE-TEAM-008/);
	assert.match(docs, /Delivery alone does not activate workspace access/);
	assert.match(schemaDocs, /workspace_membership_invitations/);
	assert.match(schemaDocs, /token hashes only/);
});
