import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	WORKSPACE_INVITATION_EXPIRY_HOURS,
	buildWorkspaceInvitationAcceptPath,
	generateInvitationToken,
	hashInvitationToken,
	invitationDeliveryMode,
	renderInvitationEmail,
} from '../src/lib/workspaceInvitations.ts';
import {
	resolveInvitationProviderConfig,
	resolveWorkspaceInvitationSiteOrigin,
	sendWorkspaceInvitationEmail,
} from '../src/lib/workspaceInvitationDelivery.ts';
import { buildWorkspaceTeamInvitationSendPath } from '../src/lib/projectRoutes.ts';

const migrationUrl = new URL('../supabase/migrations/20260723001100_workspace_membership_invitation_delivery_activation.sql', import.meta.url);
const internalPolicyMigrationUrl = new URL('../supabase/migrations/20260723001200_workspace_invitation_internal_delivery_policy.sql', import.meta.url);
const retryPolicyMigrationUrl = new URL('../supabase/migrations/20260723001300_workspace_invitation_retry_policy_resolution.sql', import.meta.url);
const controlledIdentityMigrationUrl = new URL('../supabase/migrations/20260723001400_workspace_invitation_controlled_identity_preparation.sql', import.meta.url);
const outboundEmailMigrationUrl = new URL('../supabase/migrations/20260723001500_workspace_invitation_outbound_email_delivery.sql', import.meta.url);
const sendRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/invitations/send.ts', import.meta.url);
const acceptPageUrl = new URL('../src/pages/invitations/accept.astro', import.meta.url);
const teamPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);
const schemaDocsUrl = new URL('../docs/architecture/database-schema-v1.md', import.meta.url);
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const productionAppliedInvitationMigrationHash = '5b588a7284c4238e18b06f83d91d101790eb19a865e663abfb7e5a8b6133a5c9';

function sqlConstraintValues(sql, constraintName) {
	const escapedName = constraintName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = sql.match(new RegExp(`${escapedName}[\\s\\S]*?check \\([\\s\\S]*?\\b(?:status|previous_status|new_status|event_type) in \\(([\\s\\S]*?)\\)[\\s\\S]*?\\)\\s*[,;]`));
	assert.ok(match, `${constraintName} constraint should be present`);
	return new Set([...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]));
}

function sqlFunctionDefinition(sql, functionName) {
	const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = sql.match(new RegExp(`create or replace function public\\.${escapedName}[\\s\\S]*?\\$\\$;`));
	assert.ok(match, `${functionName} function should be present`);
	return match[0];
}

function deterministicInternalAlias(baseEmail, prefix, loginName, profileId) {
	const [localPart, domain] = baseEmail.trim().toLowerCase().split('@');
	const aliasPrefix = prefix.trim().replace(/[^a-zA-Z0-9]+/g, '.').toLowerCase() || 'wt';
	const profileSuffix = profileId.replaceAll('-', '').slice(0, 12);
	const loginIdentity = (loginName.trim().toLowerCase() || profileId)
		.replace(/[^a-z0-9._-]+/g, '.')
		.replace(/^\.+|\.+$/g, '')
		.slice(0, 40) || profileSuffix;
	return `${localPart}+${aliasPrefix}.${loginIdentity}.${profileSuffix}@${domain}`;
}

function internalPolicySeedOutcome(totalOrganisationCount, internalOrganisationCount) {
	if (totalOrganisationCount === 0) return 'skip';
	if (internalOrganisationCount === 0) return 'not_found';
	if (internalOrganisationCount > 1) return 'ambiguous';
	return 'seed';
}

test('Production-applied WT-008 invitation migration remains unchanged', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const hash = createHash('sha256').update(sql).digest('hex');

	assert.equal(hash, productionAppliedInvitationMigrationHash);
	assert.doesNotMatch(sql, /workspace_membership_invitations_current_auth_email_unique/);
	assert.doesNotMatch(sql, /workspace_invitation_internal_alias_base_email\(\)/);
	assert.doesNotMatch(sql, /insert into public\.workspace_invitation_delivery_policies[\s\S]*internal_gmail_alias/);
	assert.doesNotMatch(sql, /prevent_workspace_invitation_delivery_policy_mutation/);
});

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

test('Workspace invitation migration exposes admin directory invitation columns', async () => {
	const sql = await readFile(migrationUrl, 'utf8');

	assert.match(sql, /create or replace view public\.workspace_member_admin_directory/);
	assert.match(sql, /invitation\.expires_at as invitation_expires_at/);
	assert.match(sql, /left join public\.workspace_membership_invitations invitation[\s\S]*invitation\.is_current/);
});

test('Internal delivery policy migration keeps audit event catalogue as a complete historical superset', async () => {
	const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
	const finalSql = await readFile(internalPolicyMigrationUrl, 'utf8');
	const finalEventTypes = sqlConstraintValues(finalSql, 'workspace_membership_audit_events_event_type_check');
	const historicalEventTypes = new Set();

	for (const file of files) {
		const sql = await readFile(new URL(file, migrationsDir), 'utf8');
		if (!sql.includes('workspace_membership_audit_events_event_type_check')) continue;
		for (const eventType of sqlConstraintValues(sql, 'workspace_membership_audit_events_event_type_check')) {
			historicalEventTypes.add(eventType);
		}
	}

	for (const eventType of historicalEventTypes) {
		assert.ok(finalEventTypes.has(eventType), `${eventType} should remain accepted by the WT-008 final audit catalogue`);
	}
	for (const eventType of [
		'membership_change_set_confirmed',
		'membership_change_set_reconfirmed',
		'workspace_invitation_prepared',
		'workspace_invitation_delivery_attempted',
		'workspace_invitation_delivered',
		'workspace_invitation_delivery_failed',
		'workspace_invitation_opened',
		'workspace_invitation_expired',
		'workspace_invitation_cancelled',
		'workspace_invitation_superseded',
		'workspace_invitation_accepted',
		'workspace_membership_activated',
		'workspace_invitation_replay_rejected',
	]) {
		assert.ok(finalEventTypes.has(eventType), `${eventType} should be accepted`);
	}
});

test('Workspace invitation migration derives identity from handoff and blocks shared contacts without immutable policy', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const prepareSql = sqlFunctionDefinition(sql, 'prepare_workspace_membership_invitations');

	assert.match(sql, /create table if not exists public\.workspace_invitation_delivery_policies/);
	assert.match(sql, /delivery_strategy in \('normal_smtp', 'internal_gmail_alias', 'test_record_only'\)/);
	assert.match(prepareSql, /v_delivery_strategy := coalesce\(v_policy\.delivery_strategy, 'normal_smtp'\)/);
	assert.match(prepareSql, /public\.is_internal_role_simulation_workspace\(p_organisation_id\)/);
	assert.match(sql, /shared_contact_policy_required/);
	assert.match(sql, /existing_account_link_required/);
	assert.match(sql, /workspace_invitation_internal_alias_email/);
	assert.match(sql, /update auth\.users as au[\s\S]*set email = v_auth_email/);
	assert.match(sql, /update public\.profiles as profile[\s\S]*set email = v_auth_email/);
	assert.doesNotMatch(prepareSql, /organisation\.name|organisation\.slug|workspaceSlug/i);
	assert.doesNotMatch(prepareSql, /where lower\(p\.contact_email\) = .*return.*profile_id/is);
});

test('Internal delivery policy migration introduces the locked policy and upgrade-safe ordering', async () => {
	const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
	const migrationIndex = files.indexOf('20260723001100_workspace_membership_invitation_delivery_activation.sql');
	const policyIndex = files.indexOf('20260723001200_workspace_invitation_internal_delivery_policy.sql');
	const retryIndex = files.indexOf('20260723001300_workspace_invitation_retry_policy_resolution.sql');
	const controlledIdentityIndex = files.indexOf('20260723001400_workspace_invitation_controlled_identity_preparation.sql');
	const outboundEmailIndex = files.indexOf('20260723001500_workspace_invitation_outbound_email_delivery.sql');
	const policySql = await readFile(internalPolicyMigrationUrl, 'utf8');
	const seedBlock = policySql.match(/do \$\$[\s\S]*?end;\n\$\$;/)?.[0] ?? '';

	assert.ok(migrationIndex >= 0, 'WT-008 production migration should exist');
	assert.equal(policyIndex, migrationIndex + 1, 'internal policy migration should immediately follow 20260723001100');
	assert.equal(retryIndex, policyIndex + 1, 'retry policy-resolution migration should follow the internal policy migration');
	assert.equal(controlledIdentityIndex, retryIndex + 1, 'controlled identity migration should follow the retry policy-resolution migration');
	assert.equal(outboundEmailIndex, controlledIdentityIndex + 1, 'outbound email delivery migration should follow controlled identity preparation');
	assert.match(policySql, /create table if not exists public\.workspace_invitation_delivery_policies/);
	assert.match(policySql, /workspace_membership_invitations_current_auth_email_unique/);
	assert.match(policySql, /drop trigger if exists set_workspace_invitation_delivery_policies_updated_at/);
	assert.match(policySql, /drop trigger if exists prevent_workspace_invitation_delivery_policy_mutation/);
	assert.match(policySql, /prevent_workspace_invitation_delivery_policy_mutation[\s\S]*old\.locked_at is not null/);
	assert.match(seedBlock, /where public\.is_internal_role_simulation_workspace\(o\.id\)/);
	assert.match(seedBlock, /WT_INVITATION_INTERNAL_POLICY_SKIPPED/);
	assert.match(seedBlock, /WT_INVITATION_INTERNAL_POLICY_NOT_FOUND/);
	assert.match(seedBlock, /WT_INVITATION_INTERNAL_POLICY_AMBIGUOUS/);
	assert.match(seedBlock, /on conflict \(organisation_id\) do update/);
	assert.doesNotMatch(seedBlock, /\.slug|\.name|contact_email|email domain|gmail\.com/i);
	assert.match(policySql, /revoke all on public\.workspace_invitation_delivery_policies from authenticated/);
	assert.doesNotMatch(policySql, /grant select on public\.workspace_invitation_delivery_policies to authenticated/i);
});

test('Workspace invitation outbound email migration records provider evidence and claims idempotent sends', async () => {
	const migrationSql = await readFile(outboundEmailMigrationUrl, 'utf8');
	const beginSql = sqlFunctionDefinition(migrationSql, 'begin_workspace_membership_invitation_delivery_attempt');
	const recordSql = sqlFunctionDefinition(migrationSql, 'record_workspace_membership_invitation_delivery_result');

	assert.match(migrationSql, /add column if not exists delivery_operation_key uuid/);
	assert.match(migrationSql, /add column if not exists email_provider text/);
	assert.match(migrationSql, /add column if not exists provider_message_id text/);
	assert.match(migrationSql, /add column if not exists provider_accepted_at timestamptz/);
	assert.match(beginSql, /where invitation\.id = p_invitation_id[\s\S]*and invitation\.is_current[\s\S]*for update/);
	assert.match(beginSql, /if v_invitation\.status <> 'pending_delivery'[\s\S]*should_send := false/);
	assert.match(beginSql, /set status = 'sending'[\s\S]*delivery_operation_key = p_delivery_operation_key[\s\S]*delivery_attempt_count = invitation\.delivery_attempt_count \+ 1/);
	assert.match(beginSql, /workspace_invitation_delivery_attempted/);
	assert.match(recordSql, /p_email_provider text[\s\S]*p_provider_message_id text/);
	assert.match(recordSql, /email_provider = v_email_provider/);
	assert.match(recordSql, /provider_message_id = case when p_delivery_status = 'delivered' then v_provider_message_id else null end/);
	assert.match(recordSql, /provider_accepted_at = case when p_delivery_status = 'delivered' then now\(\) else invitation\.provider_accepted_at end/);
	assert.match(recordSql, /case\s+when v_invitation\.status = 'sending' then v_invitation\.delivery_attempt_count[\s\S]*else v_invitation\.delivery_attempt_count \+ 1/);
	assert.match(recordSql, /jsonb_strip_nulls\(jsonb_build_object\([\s\S]*'email_provider', v_email_provider[\s\S]*'provider_message_id'/);
	assert.doesNotMatch(recordSql, /token_hash|raw_token|html_message|text_message|email_body|api_key|authorization|provider_response/i);
	assert.doesNotMatch(recordSql, /organisation_members[\s\S]*status = 'active'/i);
	assert.match(migrationSql, /grant execute on function public\.begin_workspace_membership_invitation_delivery_attempt\(uuid, uuid\) to authenticated, service_role/);
	assert.match(migrationSql, /grant execute on function public\.record_workspace_membership_invitation_delivery_result\(uuid, text, text, text, text, text\) to authenticated, service_role/);
});

test('Workspace invitation delivery provider configuration is server-side and production-origin bounded', () => {
	assert.equal(resolveWorkspaceInvitationSiteOrigin({ WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk/app' }), 'https://watch-tower.co.uk');
	assert.equal(resolveWorkspaceInvitationSiteOrigin({ WATCHTOWER_SITE_URL: 'http://watch-tower.co.uk' }), null);
	assert.equal(resolveWorkspaceInvitationSiteOrigin({ WATCHTOWER_SITE_URL: 'https://evil.example' }), null);
	assert.deepEqual(resolveInvitationProviderConfig({}).mode, 'provider_required');
	assert.deepEqual(resolveInvitationProviderConfig({ WATCHTOWER_INVITATION_DELIVERY_MODE: 'test_record_only' }).mode, 'test_record_only');
	assert.deepEqual(resolveInvitationProviderConfig({
		WATCHTOWER_EMAIL_PROVIDER: 'resend',
		WATCHTOWER_RESEND_API_KEY: 're_secret',
		WATCHTOWER_INVITATION_FROM_NAME: 'Watchtower',
		WATCHTOWER_INVITATION_FROM_EMAIL: 'invitations@watch-tower.co.uk',
		WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
	}).mode, 'resend');
});

test('Workspace invitation delivery sends HTML and text through Resend without browser-controlled origin', async () => {
	let requestUrl = '';
	let requestBody = {};
	let authorization = '';
	const result = await sendWorkspaceInvitationEmail({
		invitationId: '11111111-1111-4111-8111-111111111111',
		membershipId: '22222222-2222-4222-8222-222222222222',
		recipientEmail: 'Ruby.Atkinson+Test@Example.com',
		rawToken: 'a'.repeat(64),
		workspaceName: 'Internal Simulation',
		personName: 'Ruby Atkinson',
		roleLabel: 'Viewer',
		expiresAt: '2026-07-26T12:00:00Z',
		requestOrigin: 'https://attacker.example',
		env: {
			WATCHTOWER_EMAIL_PROVIDER: 'resend',
			WATCHTOWER_RESEND_API_KEY: 're_test',
			WATCHTOWER_INVITATION_FROM_NAME: 'Watchtower',
			WATCHTOWER_INVITATION_FROM_EMAIL: 'invitations@watch-tower.co.uk',
			WATCHTOWER_INVITATION_REPLY_TO: 'support@watch-tower.co.uk',
			WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
		},
		fetchImpl: async (url, init) => {
			requestUrl = String(url);
			authorization = String(init?.headers?.authorization ?? init?.headers?.Authorization ?? '');
			requestBody = JSON.parse(String(init?.body ?? '{}'));
			return new Response(JSON.stringify({ id: 'resend_123' }), { status: 200, headers: { 'content-type': 'application/json' } });
		},
	});

	assert.equal(result.status, 'delivered');
	assert.equal(result.providerName, 'resend');
	assert.equal(result.providerMessageId, 'resend_123');
	assert.equal(requestUrl, 'https://api.resend.com/emails');
	assert.equal(authorization, 'Bearer re_test');
	assert.equal(requestBody.from, 'Watchtower <invitations@watch-tower.co.uk>');
	assert.deepEqual(requestBody.to, ['ruby.atkinson+test@example.com']);
	assert.equal(requestBody.reply_to, 'support@watch-tower.co.uk');
	assert.match(requestBody.subject, /invited to a Watchtower workspace/);
	assert.match(requestBody.text, /https:\/\/watch-tower\.co\.uk\/invitations\/accept\?token=/);
	assert.match(requestBody.html, /https:\/\/watch-tower\.co\.uk\/invitations\/accept\?token=/);
	assert.doesNotMatch(requestBody.text, /attacker\.example/);
	assert.doesNotMatch(requestBody.html, /attacker\.example/);
});

test('Workspace invitation delivery fails safely when provider is missing, rejected or unavailable', async () => {
	const baseRequest = {
		invitationId: '11111111-1111-4111-8111-111111111111',
		membershipId: '22222222-2222-4222-8222-222222222222',
		recipientEmail: 'ruby.atkinson@example.com',
		rawToken: 'b'.repeat(64),
		workspaceName: 'Internal Simulation',
		personName: 'Ruby Atkinson',
		roleLabel: 'Viewer',
	};
	const missing = await sendWorkspaceInvitationEmail({ ...baseRequest, env: {} });
	const rejected = await sendWorkspaceInvitationEmail({
		...baseRequest,
		env: {
			WATCHTOWER_EMAIL_PROVIDER: 'resend',
			WATCHTOWER_RESEND_API_KEY: 're_test',
			WATCHTOWER_INVITATION_FROM_EMAIL: 'invitations@watch-tower.co.uk',
			WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
		},
		fetchImpl: async () => new Response(JSON.stringify({ message: 'raw provider detail' }), { status: 422 }),
	});
	const unavailable = await sendWorkspaceInvitationEmail({
		...baseRequest,
		env: {
			WATCHTOWER_EMAIL_PROVIDER: 'resend',
			WATCHTOWER_RESEND_API_KEY: 're_test',
			WATCHTOWER_INVITATION_FROM_EMAIL: 'invitations@watch-tower.co.uk',
			WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
		},
		fetchImpl: async () => {
			throw new Error('network includes secret re_test and raw response');
		},
	});

	assert.equal(missing.status, 'delivery_failed');
	assert.equal(missing.failureCode, 'provider_not_configured');
	assert.equal(rejected.status, 'delivery_failed');
	assert.equal(rejected.failureCode, 'provider_rejected');
	assert.equal(rejected.providerName, 'resend');
	assert.doesNotMatch(rejected.failureMessage ?? '', /raw provider detail|re_test/i);
	assert.equal(unavailable.status, 'delivery_failed');
	assert.equal(unavailable.failureCode, 'provider_unavailable');
	assert.doesNotMatch(unavailable.failureMessage ?? '', /raw response|re_test/i);
});

test('Internal delivery policy seed counts UUID organisations without aggregate selection', async () => {
	const policySql = await readFile(internalPolicyMigrationUrl, 'utf8');
	const seedBlock = policySql.match(/do \$\$[\s\S]*?end;\n\$\$;/)?.[0] ?? '';

	assert.equal(internalPolicySeedOutcome(0, 0), 'skip');
	assert.equal(internalPolicySeedOutcome(2, 1), 'seed');
	assert.equal(internalPolicySeedOutcome(2, 0), 'not_found');
	assert.equal(internalPolicySeedOutcome(3, 2), 'ambiguous');
	assert.match(seedBlock, /select count\(\*\)::integer\s+into v_total_organisation_count\s+from public\.organisations/);
	assert.match(seedBlock, /select count\(\*\)::integer\s+into v_internal_organisation_count\s+from public\.organisations as o\s+where public\.is_internal_role_simulation_workspace\(o\.id\);/);
	assert.match(seedBlock, /select o\.id\s+into v_internal_organisation_id\s+from public\.organisations as o\s+where public\.is_internal_role_simulation_workspace\(o\.id\)\s+limit 1;/);
	assert.match(seedBlock, /elsif v_internal_organisation_count > 1[\s\S]*else[\s\S]*select o\.id/);
	assert.doesNotMatch(seedBlock, /\b(?:min|max)\s*\(\s*o\.id\s*\)/i);
	assert.doesNotMatch(seedBlock, /o\.id::text|cast\s*\(\s*o\.id\s+as\s+text\s*\)|order by\s+o\.id/i);
});

test('Workspace invitation internal alias policy is deterministic unique and rename-safe', async () => {
	const policySql = await readFile(internalPolicyMigrationUrl, 'utf8');
	const aliasSql = sqlFunctionDefinition(policySql, 'workspace_invitation_internal_alias_email');
	const prepareSql = sqlFunctionDefinition(policySql, 'prepare_workspace_membership_invitations');
	const rubyProfileId = 'aaaaaaaa-1111-2222-3333-444444444444';
	const alexProfileId = 'bbbbbbbb-1111-2222-3333-444444444444';
	const rubyAlias = deterministicInternalAlias('Mark.Nesbit.Professional@gmail.com', 'wt', 'ruby.atkinson', rubyProfileId);
	const rubyRetryAlias = deterministicInternalAlias('Mark.Nesbit.Professional@gmail.com', 'wt', 'ruby.atkinson', rubyProfileId);
	const alexAlias = deterministicInternalAlias('Mark.Nesbit.Professional@gmail.com', 'wt', 'alex.atkinson', alexProfileId);

	assert.equal(rubyAlias, 'mark.nesbit.professional+wt.ruby.atkinson.aaaaaaaa1111@gmail.com');
	assert.equal(rubyRetryAlias, rubyAlias);
	assert.notEqual(rubyAlias, alexAlias);
	assert.match(aliasSql, /split_part\(base_email, '@', 1\)[\s\S]*\|\| '\+'[\s\S]*alias_prefix[\s\S]*login_identity[\s\S]*profile_suffix[\s\S]*split_part\(base_email, '@', 2\)/);
	assert.match(aliasSql, /left\(replace\(p_profile_id::text, '-', ''\), 12\) as profile_suffix/);
	assert.match(policySql, /select 'mark\.nesbit\.professional@gmail\.com'::text/);
	assert.match(policySql, /select 'wt'::text/);
	assert.match(prepareSql, /v_recipient_email := v_auth_email/);
	assert.match(prepareSql, /where policy\.organisation_id = p_organisation_id/);
	assert.doesNotMatch(prepareSql, /from public\.organisations|\.slug|\.name/);
});

test('Workspace invitation retry reuses existing identities without duplicate account creation or activation', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	const controlledIdentitySql = await readFile(controlledIdentityMigrationUrl, 'utf8');
	const outboundEmailSql = await readFile(outboundEmailMigrationUrl, 'utf8');
	const prepareSql = sqlFunctionDefinition(controlledIdentitySql, 'prepare_workspace_membership_invitations');
	const deliverySql = sqlFunctionDefinition(outboundEmailSql, 'record_workspace_membership_invitation_delivery_result');
	const route = await readFile(sendRouteUrl, 'utf8');

	assert.match(route, /\['pending_delivery', 'delivery_failed', 'expired', 'cancelled', 'superseded'\]\.includes\(String\(row\.invitation_status\)\)/);
	assert.match(route, /claimDeliveryAttempt/);
	assert.match(route, /sendWorkspaceInvitationEmail/);
	assert.match(prepareSql, /if v_has_current and v_current\.idempotency_key = p_idempotency_key/);
	assert.match(prepareSql, /v_current\.delivery_strategy is distinct from v_delivery_strategy/);
	assert.match(prepareSql, /set is_current = false,[\s\S]*status = 'superseded'/);
	assert.match(prepareSql, /v_row\.profile_id,[\s\S]*v_row\.profile_id,[\s\S]*v_handoff\.application_run_id/);
	assert.match(prepareSql, /where au\.id = v_row\.profile_id/);
	assert.match(prepareSql, /where profile\.id = v_row\.profile_id/);
	assert.doesNotMatch(prepareSql, /insert into auth\.users|insert into public\.profiles|insert into public\.organisation_members/i);
	assert.doesNotMatch(deliverySql, /organisation_members[\s\S]*status = 'active'/i);
	assert.match(sql, /auth\.uid\(\) <> v_invitation\.auth_user_id/);
});

test('Workspace invitation retry uses a fresh retry key while preserving send and bulk idempotency', async () => {
	const route = await readFile(sendRouteUrl, 'utf8');
	const page = await readFile(teamPageUrl, 'utf8');

	assert.match(route, /const submittedOperationKey = String\(formData\.get\('operation_key'\) \?\? ''\)\.trim\(\)/);
	assert.match(route, /const retryOperationKey = String\(formData\.get\('retry_operation_key'\) \?\? ''\)\.trim\(\)/);
	assert.match(route, /const operationKey = requestedAction === 'retry'[\s\S]*\? retryOperationKey \|\| crypto\.randomUUID\(\)[\s\S]*: submittedOperationKey \|\| crypto\.randomUUID\(\)/);
	assert.match(route, /p_request_intent: requestedAction/);
	assert.match(page, /name="scope" value="eligible"[\s\S]*name="operation_key" value={invitationOperationKey}/);
	assert.match(page, /currentInvitationActionForSubmission\(member\.invitation_status\) === 'retry'[\s\S]*name="retry_operation_key" value={crypto\.randomUUID\(\)}/);
	assert.match(page, /retry_requires_new_operation_key: 'Refresh the Team page before retrying this failed invitation\.'/);
});

test('Workspace invitation retry migration re-resolves policy and rejects stale failed replay keys', async () => {
	const retrySql = await readFile(retryPolicyMigrationUrl, 'utf8');
	const controlledIdentitySql = await readFile(controlledIdentityMigrationUrl, 'utf8');
	const prepareSql = sqlFunctionDefinition(controlledIdentitySql, 'prepare_workspace_membership_invitations');
	const insertBlock = prepareSql.match(/insert into public\.workspace_membership_invitations[\s\S]*?\)\s*returning \* into v_new;/)?.[0] ?? '';

	assert.match(retrySql, /create or replace function public\.prepare_workspace_membership_invitations\([\s\S]*p_request_intent text[\s\S]*\)/);
	assert.match(controlledIdentitySql, /create or replace function public\.prepare_workspace_membership_invitations\([\s\S]*p_request_intent text[\s\S]*\)/);
	assert.doesNotMatch(retrySql, /p_request_intent text default/i);
	assert.doesNotMatch(controlledIdentitySql, /p_request_intent text default/i);
	assert.match(prepareSql, /v_request_intent := lower\(coalesce\(nullif\(btrim\(p_request_intent\), ''\), 'send'\)\)/);
	assert.match(prepareSql, /v_request_intent not in \('send', 'resend', 'retry'\)/);
	assert.match(prepareSql, /select \* into v_policy[\s\S]*where policy\.organisation_id = p_organisation_id/);
	assert.match(prepareSql, /v_delivery_strategy := coalesce\(v_policy\.delivery_strategy, 'normal_smtp'\)[\s\S]*if v_has_current and v_current\.idempotency_key = p_idempotency_key/);
	assert.match(prepareSql, /v_request_intent = 'retry'[\s\S]*v_current\.status = 'delivery_failed'[\s\S]*retry_requires_new_operation_key/);
	assert.match(prepareSql, /v_current\.failure_code = 'shared_contact_policy_required'/);
	assert.match(prepareSql, /v_current\.auth_email, ''\)\) ~ '@pending\\\.watchtower\\\.invalid\$'/);
	assert.match(prepareSql, /v_auth_email := public\.workspace_invitation_internal_alias_email/);
	assert.match(prepareSql, /v_recipient_email := v_auth_email/);
	assert.match(prepareSql, /v_failure_code := 'shared_contact_policy_required'[\s\S]*v_failure_code := 'existing_account_link_required'/);
	assert.match(prepareSql, /v_failure_code := 'token_hash_required'/);
	assert.match(insertBlock, /v_recipient_email,[\s\S]*v_auth_email,[\s\S]*v_delivery_strategy,[\s\S]*v_token_hash,[\s\S]*p_idempotency_key/);
	assert.doesNotMatch(insertBlock, /v_current\.(?:recipient_email|auth_email|delivery_strategy|failure_code|failure_message)/);
	assert.match(prepareSql, /'retry_requested', case when v_request_intent = 'retry' then true else null end/);
	assert.match(prepareSql, /'previous_invitation_id', case when v_has_current then v_current\.id else null end/);
	assert.match(prepareSql, /'previous_invitation_version', case when v_has_current then v_current\.invitation_version else null end/);
	assert.match(prepareSql, /'previous_delivery_strategy', case when v_has_current then v_current\.delivery_strategy else null end/);
	assert.match(prepareSql, /'policy_source', v_policy_source/);
	assert.match(prepareSql, /'recipient_domain', split_part\(v_new\.recipient_email, '@', 2\)/);
	assert.match(controlledIdentitySql, /create or replace function public\.prepare_workspace_membership_invitations\([\s\S]*p_token_hashes jsonb default '\{\}'::jsonb[\s\S]*\)[\s\S]*language sql[\s\S]*'send'/);
	assert.match(controlledIdentitySql, /grant execute on function public\.prepare_workspace_membership_invitations\(uuid, uuid\[\], uuid, jsonb, text\) to authenticated, service_role/);
});

test('Workspace invitation controlled identity preparation extends the lifecycle guard narrowly', async () => {
	const baselineSql = await readFile(new URL('../supabase/migrations/20260614000300_enable_rls_and_baseline_policies.sql', import.meta.url), 'utf8');
	const controlledIdentitySql = await readFile(controlledIdentityMigrationUrl, 'utf8');
	const route = await readFile(sendRouteUrl, 'utf8');
	const guardSql = sqlFunctionDefinition(controlledIdentitySql, 'prevent_unsafe_workspace_membership_update');
	const prepareSql = sqlFunctionDefinition(controlledIdentitySql, 'prepare_workspace_membership_invitations');
	const sqlWithoutPrepare = controlledIdentitySql.replace(prepareSql, '');

	assert.match(guardSql, /current_setting\('watchtower\.membership_lifecycle_operation', true\)[\s\S]*workspace_invitation_identity_preparation/);
	assert.match(guardSql, /marker_organisation_id := nullif\(current_setting\('watchtower\.membership_lifecycle_organisation_id', true\), ''\)/);
	assert.match(guardSql, /marker_membership_id := nullif\(current_setting\('watchtower\.membership_lifecycle_membership_id', true\), ''\)/);
	assert.match(guardSql, /marker_profile_id := nullif\(current_setting\('watchtower\.membership_lifecycle_profile_id', true\), ''\)/);
	assert.match(guardSql, /old\.organisation_id <> marker_organisation_id::uuid/);
	assert.match(guardSql, /old\.id <> marker_membership_id::uuid/);
	assert.match(guardSql, /old\.user_id <> marker_profile_id::uuid/);
	assert.match(guardSql, /old\.status not in \('invited', 'invite_expired'\)/);
	assert.match(guardSql, /new\.status is distinct from old\.status/);
	assert.match(guardSql, /new\.role is distinct from old\.role/);
	assert.match(guardSql, /new\.accepted_at is distinct from old\.accepted_at/);
	assert.match(guardSql, /new\.deactivated_at is distinct from old\.deactivated_at/);
	assert.match(guardSql, /new\.reactivated_at is distinct from old\.reactivated_at/);
	assert.match(guardSql, /new\.invitation_expires_at is null/);
	assert.match(guardSql, /WT_INVITATION_CONTROLLED_IDENTITY_SCOPE/);
	assert.match(guardSql, /Use controlled workspace membership lifecycle functions for membership lifecycle changes/);
	assert.match(prepareSql, /set_config\('watchtower\.membership_lifecycle_operation', 'workspace_invitation_identity_preparation', true\)/);
	assert.match(prepareSql, /set_config\('watchtower\.membership_lifecycle_organisation_id', p_organisation_id::text, true\)/);
	assert.match(prepareSql, /set_config\('watchtower\.membership_lifecycle_membership_id', v_row\.membership_id::text, true\)/);
	assert.match(prepareSql, /set_config\('watchtower\.membership_lifecycle_profile_id', v_row\.profile_id::text, true\)/);
	assert.match(prepareSql, /set_config\('watchtower\.membership_lifecycle_invitation_id', v_new\.id::text, true\)/);
	assert.match(prepareSql, /update public\.organisation_members as om[\s\S]*set invitation_expires_at = v_new\.expires_at,[\s\S]*updated_by = v_actor\.actor_user_id,[\s\S]*where om\.id = v_row\.membership_id/);
	assert.match(prepareSql, /set_config\('watchtower\.membership_lifecycle_operation', '', true\)/);
	assert.match(prepareSql, /'controlled_operation', 'workspace_invitation_identity_preparation'/);
	assert.match(prepareSql, /'temporary_auth_email_replaced', v_temporary_auth_email_replaced/);
	assert.match(prepareSql, /where au\.id = v_row\.profile_id[\s\S]*lower\(coalesce\(au\.email, ''\)\) ~ '@pending\\\.watchtower\\\.invalid\$'/);
	assert.match(prepareSql, /where profile\.id = v_row\.profile_id[\s\S]*lower\(coalesce\(profile\.email, ''\)\) ~ '@pending\\\.watchtower\\\.invalid\$'/);
	assert.match(prepareSql, /WT_INVITATION_AUTH_IDENTITY_CONTEXT/);
	assert.match(prepareSql, /WT_INVITATION_PROFILE_IDENTITY_CONTEXT/);
	assert.match(prepareSql, /v_next_version := coalesce\(v_current\.invitation_version, 0\) \+ 1/);
	assert.match(prepareSql, /set is_current = false,[\s\S]*status = 'superseded'/);
	assert.doesNotMatch(prepareSql, /set status = 'active'|set role =|contact_email =/);
	assert.doesNotMatch(route, /membership_lifecycle_operation|membership_lifecycle_rpc|set_config/);
	assert.doesNotMatch(sqlWithoutPrepare, /set_config\('watchtower\.membership_lifecycle_operation', 'workspace_invitation_identity_preparation'/);
	assert.doesNotMatch(controlledIdentitySql, /disable trigger|session_replication_role/i);
	assert.doesNotMatch(controlledIdentitySql, /grant update .*public\.organisation_members to authenticated|grant update .*public\.profiles to authenticated/i);
	assert.doesNotMatch(baselineSql, /on public\.profiles for update|grant update .*public\.profiles to authenticated/i);
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
	const delivery = await readFile(new URL('../src/lib/workspaceInvitationDelivery.ts', import.meta.url), 'utf8');

	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug, accessToken\)/);
	assert.match(route, /workspace\.role !== 'owner' && workspace\.role !== 'admin'/);
	assert.match(route, /generateInvitationToken\(\)/);
	assert.match(route, /hashInvitationToken\(token\)/);
	assert.match(route, /prepare_workspace_membership_invitations/);
	assert.match(route, /begin_workspace_membership_invitation_delivery_attempt/);
	assert.match(route, /record_workspace_membership_invitation_delivery_result/);
	assert.match(route, /sendWorkspaceInvitationEmail/);
	assert.match(delivery, /provider_not_configured/);
	assert.match(delivery, /test_record_only/);
	assert.match(delivery, /renderInvitationEmail/);
	assert.match(delivery, /https:\/\/api\.resend\.com\/emails/);
	assert.match(delivery, /WATCHTOWER_SITE_URL/);
	assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE|service_role|auth\.admin|console\.log\(.*token|rawToken.*console/i);
	assert.doesNotMatch(delivery, /console\.log\(.*token|rawToken.*console|provider_response/i);
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
	assert.doesNotMatch(page, /auth_email|recipient_email|internal_alias_base_email|workspace_invitation_delivery_policies/);
	assert.match(email.subject, /invited to a Watchtower workspace/);
	assert.match(email.text, /You have been invited to join Alpha Workspace/);
	assert.match(email.text, /not active until you accept/);
	assert.match(email.html, /Accept invitation/);
	assert.match(docs, /WT-WORKSPACE-TEAM-008/);
	assert.match(docs, /Delivery alone does not activate workspace access/);
	assert.match(schemaDocs, /workspace_membership_invitations/);
	assert.match(schemaDocs, /token hashes only/);
});
