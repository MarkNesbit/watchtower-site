import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	WORKSPACE_INVITATION_EXPIRY_HOURS,
	buildWorkspaceInvitationAcceptPath,
	buildWorkspaceInvitationAcceptRelativePath,
	buildWorkspaceInvitationLoginPath,
	buildWorkspaceInvitationResetPasswordPath,
	buildWorkspaceInvitationSetupPath,
	generateInvitationToken,
	hashInvitationToken,
	invitationDeliveryMode,
	renderInvitationEmail,
} from '../src/lib/workspaceInvitations.ts';
import {
	resolveInvitationProviderConfig,
	resolveWorkspaceInvitationSiteOrigin,
	sendWorkspaceInvitationEmail,
	workspaceInvitationEmailConfigDiagnostics,
} from '../src/lib/workspaceInvitationDelivery.ts';
import {
	WORKSPACE_INVITATION_AUTH_IDENTITY_ALIAS_FAILURE_CODE,
	WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE,
	provisionWorkspaceInvitationAuthIdentities,
} from '../src/lib/workspaceInvitationAuthProvisioning.ts';
import { buildWorkspaceTeamInvitationSendPath } from '../src/lib/projectRoutes.ts';

const migrationUrl = new URL('../supabase/migrations/20260723001100_workspace_membership_invitation_delivery_activation.sql', import.meta.url);
const internalPolicyMigrationUrl = new URL('../supabase/migrations/20260723001200_workspace_invitation_internal_delivery_policy.sql', import.meta.url);
const retryPolicyMigrationUrl = new URL('../supabase/migrations/20260723001300_workspace_invitation_retry_policy_resolution.sql', import.meta.url);
const controlledIdentityMigrationUrl = new URL('../supabase/migrations/20260723001400_workspace_invitation_controlled_identity_preparation.sql', import.meta.url);
const outboundEmailMigrationUrl = new URL('../supabase/migrations/20260723001500_workspace_invitation_outbound_email_delivery.sql', import.meta.url);
const validAuthIdentityMigrationUrl = new URL('../supabase/migrations/20260723001600_workspace_invitation_valid_auth_identity_provisioning.sql', import.meta.url);
const authRepairRetryStateMigrationUrl = new URL('../supabase/migrations/20260723001700_workspace_invitation_auth_repair_retry_state.sql', import.meta.url);
const authPlaceholderReleaseMigrationUrl = new URL('../supabase/migrations/20260723001800_workspace_invitation_auth_placeholder_release.sql', import.meta.url);
const apiInvisibleAuthPlaceholderReleaseMigrationUrl = new URL('../supabase/migrations/20260723001900_workspace_invitation_api_invisible_placeholder_release.sql', import.meta.url);
const acceptanceLifecycleGuardMigrationUrl = new URL('../supabase/migrations/20260723002000_workspace_invitation_acceptance_lifecycle_guard.sql', import.meta.url);
const acceptanceAuditIdentityMigrationUrl = new URL('../supabase/migrations/20260723002100_workspace_invitation_acceptance_audit_identity.sql', import.meta.url);
const acceptanceJoinedAtMigrationUrl = new URL('../supabase/migrations/20260723002200_workspace_invitation_acceptance_joined_at.sql', import.meta.url);
const workspaceResolutionMigrationUrl = new URL('../supabase/migrations/20260723002300_workspace_invitation_workspace_resolution.sql', import.meta.url);
const sendRouteUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/invitations/send.ts', import.meta.url);
const acceptPageUrl = new URL('../src/pages/invitations/accept.astro', import.meta.url);
const setupRouteUrl = new URL('../src/pages/invitations/setup.ts', import.meta.url);
const resetPasswordFormUrl = new URL('../src/components/auth/ResetPasswordForm.astro', import.meta.url);
const teamPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);
const schemaDocsUrl = new URL('../docs/architecture/database-schema-v1.md', import.meta.url);
const cloudflareDeploymentDocsUrl = new URL('../docs/cloudflare-workers-deployment.md', import.meta.url);
const wranglerConfigUrl = new URL('../wrangler.toml', import.meta.url);
const cloudflareDeployWorkflowUrl = new URL('../.github/workflows/deploy-cloudflare-worker.yml', import.meta.url);
const envExampleUrl = new URL('../.env.example', import.meta.url);
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const productionAppliedInvitationMigrationHash = '5b588a7284c4238e18b06f83d91d101790eb19a865e663abfb7e5a8b6133a5c9';
const productionAppliedValidAuthIdentityMigrationHash = 'a3a29e25b0c908f7c4beac654954888fcdaffe51db697751e095b8f6dd5723ec';

function contrastRatio(foreground, background) {
	const relativeLuminance = (hex) => {
		const [, r, g, b] = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i) ?? [];
		const channels = [r, g, b].map((value) => {
			const normalised = Number.parseInt(value, 16) / 255;
			return normalised <= 0.03928 ? normalised / 12.92 : ((normalised + 0.055) / 1.055) ** 2.4;
		});
		return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
	};
	const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
	const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
	return (lighter + 0.05) / (darker + 0.05);
}

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

async function captureConsole(callback) {
	const originalInfo = console.info;
	const originalError = console.error;
	const entries = [];
	console.info = (...args) => entries.push(['info', ...args]);
	console.error = (...args) => entries.push(['error', ...args]);
	try {
		const result = await callback(entries);
		return { entries, result };
	} finally {
		console.info = originalInfo;
		console.error = originalError;
	}
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

test('Production-applied WT-008A valid Auth identity migration remains unchanged', async () => {
	const sql = await readFile(validAuthIdentityMigrationUrl, 'utf8');
	const hash = createHash('sha256').update(sql).digest('hex');

	assert.equal(hash, productionAppliedValidAuthIdentityMigrationHash);
	assert.doesNotMatch(sql, /auth_email_matches_invitation|previous_auth_user_id|join auth\.users current_au/);
});

test('Workspace Team invitation route helpers and token helpers are opaque and stable', async () => {
	const token = generateInvitationToken();
	const tokenHash = await hashInvitationToken(token);

	assert.equal(buildWorkspaceTeamInvitationSendPath('alpha workspace'), '/app/workspaces/alpha%20workspace/team/invitations/send');
	assert.match(token, /^[a-f0-9]{64}$/);
	assert.match(tokenHash, /^[a-f0-9]{64}$/);
	assert.notEqual(tokenHash, token);
	assert.equal(buildWorkspaceInvitationAcceptPath(token, 'https://watchtower.example').startsWith('https://watchtower.example/invitations/accept?token='), true);
	assert.equal(buildWorkspaceInvitationAcceptRelativePath(token), `/invitations/accept?token=${token}`);
	assert.equal(buildWorkspaceInvitationSetupPath(token), `/invitations/setup?token=${token}`);
	assert.equal(buildWorkspaceInvitationLoginPath(token), `/login?redirectTo=%2Finvitations%2Faccept%3Ftoken%3D${token}`);
	assert.equal(buildWorkspaceInvitationResetPasswordPath(token), `/reset-password?returnTo=%2Finvitations%2Faccept%3Ftoken%3D${token}`);
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
	const validAuthIdentityIndex = files.indexOf('20260723001600_workspace_invitation_valid_auth_identity_provisioning.sql');
	const authRepairRetryStateIndex = files.indexOf('20260723001700_workspace_invitation_auth_repair_retry_state.sql');
	const authPlaceholderReleaseIndex = files.indexOf('20260723001800_workspace_invitation_auth_placeholder_release.sql');
	const apiInvisibleAuthPlaceholderReleaseIndex = files.indexOf('20260723001900_workspace_invitation_api_invisible_placeholder_release.sql');
	const acceptanceLifecycleGuardIndex = files.indexOf('20260723002000_workspace_invitation_acceptance_lifecycle_guard.sql');
	const acceptanceAuditIdentityIndex = files.indexOf('20260723002100_workspace_invitation_acceptance_audit_identity.sql');
	const acceptanceJoinedAtIndex = files.indexOf('20260723002200_workspace_invitation_acceptance_joined_at.sql');
	const workspaceResolutionIndex = files.indexOf('20260723002300_workspace_invitation_workspace_resolution.sql');
	const policySql = await readFile(internalPolicyMigrationUrl, 'utf8');
	const seedBlock = policySql.match(/do \$\$[\s\S]*?end;\n\$\$;/)?.[0] ?? '';

	assert.ok(migrationIndex >= 0, 'WT-008 production migration should exist');
	assert.equal(policyIndex, migrationIndex + 1, 'internal policy migration should immediately follow 20260723001100');
	assert.equal(retryIndex, policyIndex + 1, 'retry policy-resolution migration should follow the internal policy migration');
	assert.equal(controlledIdentityIndex, retryIndex + 1, 'controlled identity migration should follow the retry policy-resolution migration');
	assert.equal(outboundEmailIndex, controlledIdentityIndex + 1, 'outbound email delivery migration should follow controlled identity preparation');
	assert.equal(validAuthIdentityIndex, outboundEmailIndex + 1, 'valid Auth identity provisioning migration should follow outbound email delivery');
	assert.equal(authRepairRetryStateIndex, validAuthIdentityIndex + 1, 'Auth repair retry-state migration should follow valid Auth identity provisioning');
	assert.equal(authPlaceholderReleaseIndex, authRepairRetryStateIndex + 1, 'Auth placeholder release migration should follow retry-state migration');
	assert.equal(apiInvisibleAuthPlaceholderReleaseIndex, authPlaceholderReleaseIndex + 1, 'API-invisible placeholder release migration should follow placeholder release migration');
	assert.equal(acceptanceLifecycleGuardIndex, apiInvisibleAuthPlaceholderReleaseIndex + 1, 'acceptance lifecycle-guard migration should follow API-invisible placeholder release migration');
	assert.equal(acceptanceAuditIdentityIndex, acceptanceLifecycleGuardIndex + 1, 'acceptance audit identity migration should follow acceptance lifecycle guard migration');
	assert.equal(acceptanceJoinedAtIndex, acceptanceAuditIdentityIndex + 1, 'acceptance joined-at migration should follow acceptance audit identity migration');
	assert.equal(workspaceResolutionIndex, acceptanceJoinedAtIndex + 1, 'workspace resolution migration should follow acceptance joined-at migration');
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
		WATCHTOWER_EMAIL_FROM_NAME: 'Watchtower',
		WATCHTOWER_EMAIL_FROM_ADDRESS: 'invitations@watch-tower.co.uk',
		WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
	}).mode, 'resend');
	assert.deepEqual(resolveInvitationProviderConfig({
		WATCHTOWER_EMAIL_PROVIDER: 'resend',
		WATCHTOWER_RESEND_API_KEY: 're_secret',
		WATCHTOWER_INVITATION_FROM_NAME: 'Watchtower',
		WATCHTOWER_INVITATION_FROM_EMAIL: 'invitations@watch-tower.co.uk',
		WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
	}).mode, 'resend');
	assert.deepEqual(workspaceInvitationEmailConfigDiagnostics({
		WATCHTOWER_EMAIL_PROVIDER: 'resend',
		WATCHTOWER_RESEND_API_KEY: 're_secret',
		WATCHTOWER_EMAIL_FROM_ADDRESS: 'invitations@watch-tower.co.uk',
		WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
	}), {
		providerBindingPresent: true,
		apiKeyBindingPresent: true,
		senderBindingPresent: true,
		siteUrlBindingPresent: true,
	});
	assert.deepEqual(workspaceInvitationEmailConfigDiagnostics({ WATCHTOWER_EMAIL_PROVIDER: 'resend' }), {
		providerBindingPresent: true,
		apiKeyBindingPresent: false,
		senderBindingPresent: false,
		siteUrlBindingPresent: false,
	});
});

test('Workspace invitation Cloudflare deployment preserves non-secret email bindings through Wrangler config', async () => {
	const wrangler = await readFile(wranglerConfigUrl, 'utf8');
	const workflow = await readFile(cloudflareDeployWorkflowUrl, 'utf8');
	const docs = await readFile(cloudflareDeploymentDocsUrl, 'utf8');
	const envExample = await readFile(envExampleUrl, 'utf8');
	const varsBlock = wrangler.match(/\[vars\][\s\S]*?(?=\n\[|$)/)?.[0] ?? '';

	assert.match(workflow, /npx wrangler deploy/);
	assert.match(varsBlock, /WATCHTOWER_EMAIL_PROVIDER = "resend"/);
	assert.match(varsBlock, /WATCHTOWER_EMAIL_FROM_ADDRESS = "invitations@watch-tower\.co\.uk"/);
	assert.match(varsBlock, /WATCHTOWER_EMAIL_FROM_NAME = "Watchtower"/);
	assert.match(varsBlock, /WATCHTOWER_INVITATION_REPLY_TO = "mark\.nesbit\.professional@gmail\.com"/);
	assert.match(varsBlock, /WATCHTOWER_SITE_URL = "https:\/\/watch-tower\.co\.uk"/);
	assert.doesNotMatch(wrangler, /WATCHTOWER_RESEND_API_KEY|SUPABASE_SERVICE_ROLE_KEY|re_[a-z0-9]/i);
	assert.doesNotMatch(wrangler, /keep_vars\s*=\s*true/i);
	assert.match(docs, /non-secret Worker variables are committed in `wrangler\.toml` under `\[vars\]`/);
	assert.match(docs, /`keep_vars` is intentionally not enabled/);
	assert.match(docs, /`WATCHTOWER_RESEND_API_KEY` as a Worker secret/);
	assert.match(docs, /`SUPABASE_SERVICE_ROLE_KEY`/);
	assert.match(docs, /Do not commit it to Wrangler plaintext variables/);
	assert.match(envExample, /SUPABASE_SERVICE_ROLE_KEY=/);
});

test('Workspace invitation delivery uses runtime Worker bindings for Resend without browser-controlled origin', async () => {
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
			WATCHTOWER_EMAIL_FROM_NAME: 'Watchtower',
			WATCHTOWER_EMAIL_FROM_ADDRESS: 'invitations@watch-tower.co.uk',
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

test('Workspace invitation delivery reaches Resend from explicit runtime env independently of build-time env', async () => {
	let fetched = false;
	const result = await sendWorkspaceInvitationEmail({
		invitationId: '11111111-1111-4111-8111-111111111111',
		membershipId: '22222222-2222-4222-8222-222222222222',
		recipientEmail: 'ruby.atkinson@example.com',
		rawToken: 'c'.repeat(64),
		workspaceName: 'Internal Simulation',
		personName: 'Ruby Atkinson',
		roleLabel: 'Viewer',
		env: {
			WATCHTOWER_EMAIL_PROVIDER: 'resend',
			WATCHTOWER_RESEND_API_KEY: 'runtime_secret',
			WATCHTOWER_EMAIL_FROM_NAME: 'Runtime Watchtower',
			WATCHTOWER_EMAIL_FROM_ADDRESS: 'runtime-invitations@watch-tower.co.uk',
			WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
		},
		fetchImpl: async (_url, init) => {
			fetched = true;
			assert.equal(String(init?.headers?.authorization ?? ''), 'Bearer runtime_secret');
			const body = JSON.parse(String(init?.body ?? '{}'));
			assert.equal(body.from, 'Runtime Watchtower <runtime-invitations@watch-tower.co.uk>');
			return new Response(JSON.stringify({ id: 'resend_runtime_123' }), { status: 200, headers: { 'content-type': 'application/json' } });
		},
	});

	assert.equal(fetched, true);
	assert.equal(result.status, 'delivered');
	assert.equal(result.providerName, 'resend');
	assert.equal(result.providerMessageId, 'resend_runtime_123');
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
			WATCHTOWER_EMAIL_FROM_ADDRESS: 'invitations@watch-tower.co.uk',
			WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
		},
		fetchImpl: async () => new Response(JSON.stringify({ message: 'raw provider detail' }), { status: 422 }),
	});
	const unavailable = await sendWorkspaceInvitationEmail({
		...baseRequest,
		env: {
			WATCHTOWER_EMAIL_PROVIDER: 'resend',
			WATCHTOWER_RESEND_API_KEY: 're_test',
			WATCHTOWER_EMAIL_FROM_ADDRESS: 'invitations@watch-tower.co.uk',
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

test('Workspace invitation valid Auth identity migration separates profile UUID from sign-in Auth UUID', async () => {
	const sql = await readFile(validAuthIdentityMigrationUrl, 'utf8');
	const acceptSql = sqlFunctionDefinition(sql, 'accept_workspace_membership_invitation');
	const reportSql = sqlFunctionDefinition(sql, 'workspace_invitation_identityless_auth_user_report');
	const candidateSql = sqlFunctionDefinition(sql, 'get_workspace_invitation_auth_identity_repair_candidates');
	const recordSql = sqlFunctionDefinition(sql, 'record_workspace_invitation_auth_identity_repair');

	assert.match(sql, /alter table public\.profiles[\s\S]*add column if not exists auth_user_id uuid references auth\.users\(id\)/);
	assert.match(sql, /alter table public\.organisation_members[\s\S]*add column if not exists auth_user_id uuid references auth\.users\(id\)/);
	assert.match(sql, /update public\.profiles[\s\S]*set auth_user_id = id[\s\S]*where auth_user_id is null/);
	assert.match(sql, /update public\.organisation_members[\s\S]*set auth_user_id = user_id[\s\S]*where auth_user_id is null/);
	assert.match(sql, /create unique index if not exists profiles_auth_user_id_key/);
	assert.match(sql, /create unique index if not exists organisation_members_organisation_auth_user_id_key/);
	assert.match(sql, /profiles\.id remains the immutable Watchtower profile UUID/);
	assert.match(sql, /organisation_members\.user_id remains the immutable Watchtower profile\/person UUID/);
	assert.match(sql, /workspace_invitation_auth_identity_repairs/);
	assert.match(sql, /revoke all on public\.workspace_invitation_auth_identity_repairs from authenticated/);
	assert.match(sql, /grant select, insert on public\.workspace_invitation_auth_identity_repairs to service_role/);
	assert.match(reportSql, /join auth\.users au[\s\S]*on au\.id = invitation\.auth_user_id/);
	assert.match(reportSql, /from auth\.identities identity[\s\S]*identity\.user_id = invitation\.auth_user_id[\s\S]*identity\.provider = 'email'/);
	assert.match(reportSql, /split_part\(lower\(coalesce\(au\.email, invitation\.auth_email, ''\)\), '@', 2\)/);
	assert.match(candidateSql, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
	assert.match(candidateSql, /existing_valid_auth_user_id/);
	assert.doesNotMatch(candidateSql, /auth_email_matches_invitation|previous_auth_user_id|join auth\.users current_au/);
	assert.match(recordSql, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
	assert.match(recordSql, /not v_new_has_identity[\s\S]*WT_INVITATION_AUTH_IDENTITY_REPAIR_INVALID/);
	assert.match(recordSql, /update public\.profiles profile[\s\S]*set auth_user_id = p_new_auth_user_id/);
	assert.match(recordSql, /update public\.organisation_members om[\s\S]*set auth_user_id = p_new_auth_user_id/);
	assert.match(recordSql, /update public\.workspace_membership_invitations invitation[\s\S]*set auth_user_id = p_new_auth_user_id/);
	assert.match(recordSql, /om\.status in \('invited', 'invite_expired'\)/);
	assert.match(recordSql, /'membership_activated', false/);
	assert.match(acceptSql, /set status = 'active',[\s\S]*auth_user_id = v_invitation\.auth_user_id/);
	assert.match(acceptSql, /and om\.user_id = v_invitation\.profile_id/);
	assert.match(sql, /om\.auth_user_id = target_user_id[\s\S]*or \(om\.auth_user_id is null and om\.user_id = target_user_id\)/);
	assert.doesNotMatch(sql, /insert into auth\.users|insert into auth\.identities|update auth\.identities|delete from auth\.identities/i);
	assert.doesNotMatch(recordSql, /status = 'active'/);
});

test('Workspace invitation Auth repair retry-state migration advances the deployed candidate function', async () => {
	const sql = await readFile(authRepairRetryStateMigrationUrl, 'utf8');
	const candidateSql = sqlFunctionDefinition(sql, 'get_workspace_invitation_auth_identity_repair_candidates');

	assert.match(sql, /drop function if exists public\.get_workspace_invitation_auth_identity_repair_candidates\(uuid\[\], uuid\[\], text\)/);
	assert.match(candidateSql, /returns table \([\s\S]*auth_email_matches_invitation boolean,[\s\S]*existing_valid_auth_user_id uuid,[\s\S]*previous_auth_user_id uuid/);
	assert.match(candidateSql, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
	assert.match(candidateSql, /join auth\.users current_au[\s\S]*on current_au\.id = invitation\.auth_user_id/);
	assert.match(candidateSql, /lower\(current_au\.email\) = lower\(invitation\.auth_email\) as auth_email_matches_invitation/);
	assert.match(candidateSql, /repair\.new_auth_user_id = invitation\.auth_user_id/);
	assert.match(candidateSql, /repair\.outcome in \('remapped_existing_user', 'remapped_created_user'\)/);
	assert.match(sql, /revoke all on function public\.get_workspace_invitation_auth_identity_repair_candidates\(uuid\[\], uuid\[\], text\) from authenticated/);
	assert.match(sql, /grant execute on function public\.get_workspace_invitation_auth_identity_repair_candidates\(uuid\[\], uuid\[\], text\) to service_role/);
	assert.doesNotMatch(sql, /insert into auth\.users|insert into auth\.identities|update auth\.identities/i);
});

test('Workspace invitation Auth placeholder release migration gates hard deletion safely', async () => {
	const sql = await readFile(authPlaceholderReleaseMigrationUrl, 'utf8');
	const releaseSql = sqlFunctionDefinition(sql, 'verify_workspace_invitation_auth_placeholder_release');

	assert.match(sql, /alter table public\.organisation_members[\s\S]*drop constraint if exists organisation_members_user_id_fkey/);
	assert.match(sql, /alter table public\.profiles[\s\S]*drop constraint if exists profiles_id_fkey/);
	assert.match(sql, /from pg_constraint c[\s\S]*join pg_attribute a[\s\S]*a\.attname = 'old_auth_user_id'/);
	assert.match(sql, /execute format\([\s\S]*alter table public\.workspace_invitation_auth_identity_repairs drop constraint %I/);
	assert.match(sql, /organisation_members_user_id_profile_fkey[\s\S]*foreign key \(user_id\) references public\.profiles\(id\) on delete cascade[\s\S]*not valid/);
	assert.doesNotMatch(sql, /validate constraint organisation_members_user_id_profile_fkey/);
	assert.match(releaseSql, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
	assert.match(releaseSql, /v_invitation\.profile_id is distinct from p_old_auth_user_id/);
	assert.match(releaseSql, /v_invitation\.auth_user_id is distinct from p_new_auth_user_id[\s\S]*v_invitation\.profile_auth_user_id is distinct from p_new_auth_user_id[\s\S]*v_invitation\.membership_auth_user_id is distinct from p_new_auth_user_id/);
	assert.match(releaseSql, /profile\.auth_user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /om\.auth_user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /invitation\.auth_user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /om\.status = 'active'[\s\S]*om\.auth_user_id = p_old_auth_user_id or om\.user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /project_people[\s\S]*user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /internal_role_simulations[\s\S]*user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /project_narrative_read_states[\s\S]*user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /repair\.old_auth_user_id = p_old_auth_user_id[\s\S]*repair\.new_auth_user_id = p_new_auth_user_id/);
	assert.match(releaseSql, /coalesce\(v_old_auth_user\.encrypted_password, ''\) <> ''/);
	assert.match(releaseSql, /from auth\.identities identity[\s\S]*identity\.user_id = p_old_auth_user_id/);
	assert.match(sql, /grant execute on function public\.verify_workspace_invitation_auth_placeholder_release\(uuid, uuid, uuid\) to service_role/);
	assert.doesNotMatch(sql, /delete from auth\.users|insert into auth\.users|insert into auth\.identities|update auth\.identities/i);
});

test('Workspace invitation API-invisible Auth placeholder release migration is evidence-bound', async () => {
	const sql = await readFile(apiInvisibleAuthPlaceholderReleaseMigrationUrl, 'utf8');
	const releaseSql = sqlFunctionDefinition(sql, 'release_workspace_invitation_auth_placeholder');

	assert.match(sql, /workspace_invitation_auth_identity_repairs_outcome_check[\s\S]*'placeholder_deleted'[\s\S]*'placeholder_already_absent'[\s\S]*'placeholder_release_blocked'/);
	assert.match(releaseSql, /returns table\(result text, reason text\)/);
	assert.match(releaseSql, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
	assert.match(releaseSql, /from public\.workspace_invitation_auth_identity_repairs repair[\s\S]*repair\.invitation_id = p_invitation_id[\s\S]*repair\.old_auth_user_id = p_old_auth_user_id[\s\S]*repair\.new_auth_user_id = p_new_auth_user_id[\s\S]*for update/);
	assert.match(releaseSql, /from public\.workspace_membership_invitations invitation[\s\S]*for update/);
	assert.match(releaseSql, /from public\.profiles profile[\s\S]*for update/);
	assert.match(releaseSql, /from public\.organisation_members om[\s\S]*for update/);
	assert.match(releaseSql, /v_profile\.auth_user_id is distinct from p_new_auth_user_id[\s\S]*v_membership\.auth_user_id is distinct from p_new_auth_user_id[\s\S]*v_invitation\.auth_user_id is distinct from p_new_auth_user_id/);
	assert.match(releaseSql, /v_membership\.status not in \('invited', 'invite_expired'\)/);
	assert.match(releaseSql, /active_membership\.status = 'active'[\s\S]*active_membership\.auth_user_id = p_old_auth_user_id[\s\S]*active_membership\.user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /profile\.auth_user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /om\.auth_user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /invitation\.auth_user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /project_people[\s\S]*user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /internal_role_simulations[\s\S]*user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /project_narrative_read_states[\s\S]*user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /from auth\.users au[\s\S]*where au\.id = p_old_auth_user_id[\s\S]*for update/);
	assert.match(releaseSql, /lower\(coalesce\(v_old_auth_user\.email, ''\)\) <> lower\(coalesce\(v_invitation\.auth_email, ''\)\)/);
	assert.match(releaseSql, /coalesce\(v_old_auth_user\.encrypted_password, ''\) <> ''/);
	assert.match(releaseSql, /v_old_auth_user\.email_confirmed_at is not null/);
	assert.match(releaseSql, /v_old_auth_user\.deleted_at is not null/);
	assert.match(releaseSql, /from auth\.identities identity[\s\S]*identity\.user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /from auth\.sessions session[\s\S]*session\.user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /from auth\.mfa_factors factor[\s\S]*factor\.user_id = p_old_auth_user_id/);
	assert.match(releaseSql, /delete from auth\.users au[\s\S]*where au\.id = p_old_auth_user_id[\s\S]*and au\.id = v_old_auth_user\.id/);
	assert.match(releaseSql, /'membership_activated', false/);
	assert.match(sql, /grant execute on function public\.release_workspace_invitation_auth_placeholder\(uuid, uuid, uuid, uuid\) to service_role/);
	assert.doesNotMatch(sql, /grant execute on function public\.release_workspace_invitation_auth_placeholder\(uuid, uuid, uuid, uuid\) to authenticated/);
	assert.doesNotMatch(sql, /delete from auth\.identities|insert into auth\.identities|update auth\.identities/i);
	assert.doesNotMatch(sql, /v_old_auth_user\.email[^;]*metadata|auth_email[^;]*metadata|token_hash|p_token/i);
});

test('Workspace invitation Auth provisioning source and remediation are documented', async () => {
	const releaseCheckoutSql = await readFile(new URL('../supabase/migrations/20260723001000_workspace_membership_application_release_source_checkout.sql', import.meta.url), 'utf8');
	const fixSql = await readFile(validAuthIdentityMigrationUrl, 'utf8');
	const docs = await readFile(docsUrl, 'utf8');
	const schemaDocs = await readFile(schemaDocsUrl, 'utf8');

	assert.match(releaseCheckoutSql, /create or replace function public\.apply_workspace_membership_change_set/);
	assert.match(releaseCheckoutSql, /insert into auth\.users \(/);
	assert.match(releaseCheckoutSql, /v_new_profile_id,[\s\S]*'authenticated',[\s\S]*v_auth_email/);
	assert.match(releaseCheckoutSql, /jsonb_build_object\('provider', 'email', 'providers', jsonb_build_array\('email'\)\)/);
	assert.match(fixSql, /workspace_invitation_identityless_auth_user_report/);
	assert.match(docs, /Historical WT-007 migrations created a pending Supabase Auth identity by inserting a minimal placeholder `auth\.users` row directly/);
	assert.match(docs, /creates a valid temporary internal Auth user, transactionally remaps only explicit `auth_user_id` links/);
	assert.match(docs, /hard-deletes that placeholder to release the deterministic alias, and then assigns the alias to the replacement/);
	assert.match(docs, /never writes to `auth\.identities` directly/);
	assert.match(schemaDocs, /verify_workspace_invitation_auth_placeholder_release/);
	assert.match(schemaDocs, /hard-deletes a historical identity-less Auth placeholder to free the deterministic invitation alias/);
	assert.match(schemaDocs, /placeholder-only Auth rows as requiring Supabase Auth Admin provisioning/);
	assert.match(schemaDocs, /profile\/person UUIDs after invitation Auth repair/);
});

test('Workspace invitation Auth provisioning helper uses Supabase Admin without duplicate identities', async () => {
	const calls = [];
	const replacementAuthUserId = '99999999-9999-4999-8999-999999999999';
	const client = {
		auth: {
			admin: {
				async updateUserById(userId, input) {
					calls.push(['updateUserById', userId, input]);
					return { data: {}, error: null };
				},
				async createUser(input) {
					calls.push(['createUser', input]);
					return { data: { user: { id: replacementAuthUserId } }, error: null };
				},
				async deleteUser(userId, shouldSoftDelete) {
					calls.push(['deleteUser', userId, shouldSoftDelete]);
					return { data: {}, error: null };
				},
				async getUserById(userId) {
					calls.push(['getUserById', userId]);
					if (userId === candidate.current_auth_user_id) {
						return { data: { user: null }, error: null };
					}
					return { data: { user: { id: userId, email: 'mark.nesbit.professional+wt.ruby.atkinson.444444444444@gmail.com' } }, error: null };
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			if (name === 'get_workspace_invitation_auth_identity_repair_candidates') {
				return {
					data: [{
						...candidate,
						current_auth_user_id: replacementAuthUserId,
						has_email_identity: true,
						auth_email_matches_invitation: true,
					}],
					error: null,
				};
			}
			return { data: 'repair-id', error: null };
		},
	};
	const candidate = {
		invitation_id: '11111111-1111-4111-8111-111111111111',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'mark.nesbit.professional+wt.ruby.atkinson.444444444444@gmail.com',
		membership_status: 'invited',
		invitation_status: 'pending_delivery',
		has_email_identity: false,
		existing_valid_auth_user_id: null,
	};

	const { result: helperResults } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [candidate],
		correlationId: '66666666-6666-4666-8666-666666666666',
	}));
	const [result] = helperResults;

	assert.equal(result.status, 'remapped_created_user');
	assert.equal(result.profileId, candidate.profile_id);
	assert.equal(result.membershipId, candidate.membership_id);
	assert.equal(result.authUserId, replacementAuthUserId);
	assert.deepEqual(calls[0], ['createUser', {
		email: 'invitation-auth-repair+1111111111114111.5555555555554555@pending.watchtower.invalid',
		email_confirm: false,
		user_metadata: {
			watchtower_invitation_auth_provisioned: true,
			watchtower_invitation_auth_temporary: true,
			watchtower_profile_id: candidate.profile_id,
			watchtower_membership_id: candidate.membership_id,
			watchtower_invitation_id: candidate.invitation_id,
		},
		app_metadata: {
			provider: 'email',
			providers: ['email'],
		},
	}]);
	assert.equal(calls[1][0], 'rpc');
	assert.equal(calls[1][1], 'record_workspace_invitation_auth_identity_repair');
	assert.equal(calls[1][2].p_outcome, 'remapped_created_user');
	assert.equal(calls[1][2].p_old_auth_user_id, candidate.current_auth_user_id);
	assert.equal(calls[1][2].p_new_auth_user_id, replacementAuthUserId);
	assert.equal(calls[1][2].p_correlation_id, '66666666-6666-4666-8666-666666666666');
	assert.equal(calls[2][0], 'rpc');
	assert.equal(calls[2][1], 'verify_workspace_invitation_auth_placeholder_release');
	assert.equal(calls[2][2].p_invitation_id, candidate.invitation_id);
	assert.equal(calls[2][2].p_old_auth_user_id, candidate.current_auth_user_id);
	assert.equal(calls[2][2].p_new_auth_user_id, replacementAuthUserId);
	assert.deepEqual(calls[3], ['deleteUser', candidate.current_auth_user_id, false]);
	assert.deepEqual(calls[4], ['getUserById', candidate.current_auth_user_id]);
	assert.deepEqual(calls[5], ['updateUserById', replacementAuthUserId, {
		email: candidate.auth_email,
		user_metadata: {
			watchtower_invitation_auth_provisioned: true,
			watchtower_invitation_auth_temporary: false,
			watchtower_profile_id: candidate.profile_id,
			watchtower_membership_id: candidate.membership_id,
			watchtower_invitation_id: candidate.invitation_id,
		},
	}]);
	assert.deepEqual(calls[6], ['getUserById', replacementAuthUserId]);
	assert.equal(calls[7][1], 'get_workspace_invitation_auth_identity_repair_candidates');
	assert.equal(calls.filter((call) => call[0] === 'updateUserById' && call[1] === candidate.current_auth_user_id).length, 0);
});

test('Workspace invitation Auth provisioning logs safe repair lifecycle diagnostics', async () => {
	const replacementAuthUserId = '99999999-9999-4999-8999-999999999999';
	const candidate = {
		invitation_id: '11111111-1111-4111-8111-111111111111',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'mark.nesbit.professional+wt.ruby.atkinson.444444444444@gmail.com',
		membership_status: 'invited',
		invitation_status: 'pending_delivery',
		has_email_identity: false,
		existing_valid_auth_user_id: null,
	};
	const client = {
		auth: {
			admin: {
				async updateUserById() {
					return { data: {}, error: null };
				},
				async createUser() {
					return { data: { user: { id: replacementAuthUserId } }, error: null };
				},
				async deleteUser() {
					return { data: {}, error: null };
				},
				async getUserById(userId) {
					if (userId === candidate.current_auth_user_id) {
						return { data: { user: null }, error: null };
					}
					return { data: { user: { id: userId, email: candidate.auth_email } }, error: null };
				},
			},
		},
		async rpc(name) {
			if (name === 'get_workspace_invitation_auth_identity_repair_candidates') {
				return {
					data: [{
						...candidate,
						current_auth_user_id: replacementAuthUserId,
						has_email_identity: true,
						auth_email_matches_invitation: true,
					}],
					error: null,
				};
			}
			return { data: 'repair-id', error: null };
		},
	};

	const { entries } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [candidate],
		correlationId: '66666666-6666-4666-8666-666666666666',
	}));

	assert.deepEqual(entries.map((entry) => entry[1]), [
		'auth_identity_repair_started',
		'placeholder_delete_started',
		'placeholder_delete_api_completed',
		'placeholder_delete_verified',
		'deterministic_alias_assignment_started',
		'deterministic_alias_assignment_verified',
		'auth_identity_repair_completed',
	]);
	assert.deepEqual(entries.at(-1), ['info', 'auth_identity_repair_completed', {
		profileId: candidate.profile_id,
		membershipId: candidate.membership_id,
		invitationId: candidate.invitation_id,
		oldAuthUserId: candidate.current_auth_user_id,
		newAuthUserId: replacementAuthUserId,
		remapOperationName: 'record_workspace_invitation_auth_identity_repair',
		cleanupRequired: false,
		outcome: 'remapped_created_user',
	}]);
	for (const entry of entries.slice(1, 6)) {
		assert.deepEqual(entry[2], {
			profileId: candidate.profile_id,
			membershipId: candidate.membership_id,
			invitationId: candidate.invitation_id,
			oldAuthUserId: candidate.current_auth_user_id,
			newAuthUserId: replacementAuthUserId,
		});
	}
	assert.doesNotMatch(JSON.stringify(entries), /mark\.nesbit\.professional|ruby\.atkinson|gmail\.com|token|password|action_link|https?:\/\//i);
});

test('Workspace invitation Auth provisioning helper is idempotent for existing valid users and redacts failures', async () => {
	const calls = [];
	const existingValidCandidate = {
		invitation_id: '11111111-1111-4111-8111-111111111111',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'secret@example.test',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: true,
		existing_valid_auth_user_id: null,
	};
	const failingCandidate = { ...existingValidCandidate, has_email_identity: false, invitation_id: '77777777-7777-4777-8777-777777777777' };
	const client = {
		auth: {
			admin: {
				async updateUserById() {
					calls.push(['updateUserById']);
					return { data: {}, error: null };
				},
				async createUser() {
					calls.push(['createUser']);
					return { data: null, error: new Error('User secret@example.test failed with token https://example.test/action') };
				},
				async deleteUser() {
					calls.push(['deleteUser']);
					return { data: {}, error: null };
				},
				async getUserById() {
					throw new Error('getUserById should not run after create failure');
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			return { data: 'repair-id', error: null };
		},
	};

	const { result: results } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [existingValidCandidate, failingCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(results[0].status, 'valid_existing');
	assert.equal(results[0].authUserId, existingValidCandidate.current_auth_user_id);
	assert.equal(results[1].status, 'failed');
	assert.equal(results[1].failureCode, WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE);
	assert.doesNotMatch(results[1].failureMessage, /secret@example\.test|https:\/\/example\.test|token/i);
	assert.equal(calls.filter((call) => call[0] === 'createUser').length, 1);
	assert.equal(calls.filter((call) => call[0] === 'updateUserById').length, 0);
	assert.equal(calls.filter((call) => call[0] === 'deleteUser').length, 0);
	assert.equal(calls.filter((call) => call[0] === 'rpc').length, 1);
	assert.equal(calls.find((call) => call[0] === 'rpc')[2].p_outcome, 'failed');
});

test('Workspace invitation Auth provisioning rolls back replacement user when remap recording fails', async () => {
	const calls = [];
	const replacementAuthUserId = '99999999-9999-4999-8999-999999999999';
	const jwtLikeToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXRAZXhhbXBsZS50ZXN0In0.signature123';
	const longHexSecret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
	const remapError = Object.assign(
		new Error(`remap transaction failed for secret@example.test with token ${jwtLikeToken} https://example.test/action?token_hash=${longHexSecret}`),
		{
			code: '23503',
			details: `Key (auth_user_id)=(99999999-9999-4999-8999-999999999999) failed for secret@example.test password=topsecret secret ${longHexSecret}`,
			hint: `Check service_role key re_secret and invitation token ${jwtLikeToken} before retry`,
		},
	);
	const failingCandidate = {
		invitation_id: '77777777-7777-4777-8777-777777777777',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'secret@example.test',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: false,
		existing_valid_auth_user_id: null,
	};
	const client = {
		auth: {
			admin: {
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: {}, error: null };
				},
				async createUser(input) {
					calls.push(['createUser', input]);
					return { data: { user: { id: replacementAuthUserId } }, error: null };
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: {}, error: null };
				},
				async getUserById() {
					throw new Error('getUserById should not run after remap failure');
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			if (name === 'record_workspace_invitation_auth_identity_repair' && args.p_outcome === 'remapped_created_user') {
				return { data: null, error: remapError };
			}
			return { data: 'repair-id', error: null };
		},
	};

	const { entries, result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [failingCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(result[0].status, 'failed');
	assert.equal(result[0].authUserId, failingCandidate.current_auth_user_id);
	assert.deepEqual(calls.filter((call) => call[0] === 'deleteUser'), [['deleteUser', replacementAuthUserId, true]]);
	assert.equal(calls.filter((call) => call[0] === 'updateUserById').length, 0);
	const failureLog = entries.at(-1);
	assert.equal(failureLog[0], 'error');
	assert.equal(failureLog[1], 'auth_identity_repair_failed');
	assert.deepEqual(failureLog[2], {
		failureCode: WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE,
		stage: 'record_created_user_remap',
		profileId: failingCandidate.profile_id,
		membershipId: failingCandidate.membership_id,
		invitationId: failingCandidate.invitation_id,
		supabaseErrorCode: '23503',
		safeErrorMessage: 'remap transaction failed for [redacted-email] with [redacted] [redacted-jwt] [redacted-link]',
		safeDetails: 'Key (auth_user_id)=(99999999-9999-4999-8999-999999999999) failed for [redacted-email] [redacted]=[redacted] secret [redacted-secret]',
		safeHint: 'Check [redacted-secret] [redacted-secret] and invitation [redacted] [redacted-jwt] before retry',
		oldAuthUserId: failingCandidate.current_auth_user_id,
		newAuthUserId: replacementAuthUserId,
		remapOperationName: 'record_workspace_invitation_auth_identity_repair',
		cleanupAttempted: true,
		cleanupOutcome: 'deleted_new_auth_user',
		newAuthUserRetained: false,
		requiresManualRepair: false,
	});
	assert.doesNotMatch(JSON.stringify(entries), /secret@example\.test|example\.test\/action|re_secret|service[_ -]?role key|eyJ|abcdef0123456789|topsecret/i);
});

test('Workspace invitation Auth provisioning logs cleanup outcome when remap rollback cannot delete replacement', async () => {
	const calls = [];
	const replacementAuthUserId = '99999999-9999-4999-8999-999999999999';
	const cleanupError = Object.assign(
		new Error('rollback delete failed for secret@example.test access_token=abc123'),
		{
			code: '500',
			details: 'delete failed with password=topsecret',
			hint: 'retry without token abc123',
		},
	);
	const failingCandidate = {
		invitation_id: '77777777-7777-4777-8777-777777777777',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'secret@example.test',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: false,
		existing_valid_auth_user_id: null,
	};
	const client = {
		auth: {
			admin: {
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: {}, error: null };
				},
				async createUser(input) {
					calls.push(['createUser', input]);
					return { data: { user: { id: replacementAuthUserId } }, error: null };
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: null, error: cleanupError };
				},
				async getUserById() {
					throw new Error('getUserById should not run after remap failure');
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			if (name === 'record_workspace_invitation_auth_identity_repair' && args.p_outcome === 'remapped_created_user') {
				return { data: null, error: Object.assign(new Error('remap transaction failed'), { code: '23503' }) };
			}
			return { data: 'repair-id', error: null };
		},
	};

	const { entries, result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [failingCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(result[0].status, 'failed');
	assert.equal(result[0].authUserId, failingCandidate.current_auth_user_id);
	assert.deepEqual(calls.filter((call) => call[0] === 'deleteUser'), [['deleteUser', replacementAuthUserId, true]]);
	assert.equal(calls.filter((call) => call[0] === 'updateUserById').length, 0);
	const failureLog = entries.at(-1);
	assert.equal(failureLog[2].stage, 'record_created_user_remap');
	assert.equal(failureLog[2].newAuthUserId, replacementAuthUserId);
	assert.equal(failureLog[2].remapOperationName, 'record_workspace_invitation_auth_identity_repair');
	assert.equal(failureLog[2].cleanupAttempted, true);
	assert.equal(failureLog[2].cleanupOutcome, 'delete_failed');
	assert.equal(failureLog[2].newAuthUserRetained, true);
	assert.equal(failureLog[2].requiresManualRepair, true);
	assert.equal(failureLog[2].cleanupErrorCode, '500');
	assert.equal(failureLog[2].safeCleanupErrorMessage, 'rollback delete failed for [redacted-email] [redacted]=[redacted]');
	assert.equal(failureLog[2].safeCleanupDetails, 'delete failed with [redacted]=[redacted]');
	assert.equal(failureLog[2].safeCleanupHint, 'retry without [redacted] abc123');
	assert.doesNotMatch(JSON.stringify(entries), /secret@example\.test|topsecret/);
});

test('Workspace invitation Auth provisioning logs retained replacement when reused Auth remap fails', async () => {
	const calls = [];
	const replacementAuthUserId = '99999999-9999-4999-8999-999999999999';
	const failingCandidate = {
		invitation_id: '77777777-7777-4777-8777-777777777777',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'secret@example.test',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: false,
		existing_valid_auth_user_id: replacementAuthUserId,
	};
	const client = {
		auth: {
			admin: {
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: {}, error: null };
				},
				async createUser(...args) {
					calls.push(['createUser', ...args]);
					throw new Error('createUser should not run when replacement exists');
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: {}, error: null };
				},
				async getUserById() {
					throw new Error('getUserById should not run after remap failure');
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			if (name === 'record_workspace_invitation_auth_identity_repair' && args.p_outcome === 'remapped_existing_user') {
				return { data: null, error: Object.assign(new Error('remap failed for secret@example.test'), { code: '23514' }) };
			}
			return { data: 'repair-id', error: null };
		},
	};

	const { entries, result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [failingCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(result[0].status, 'failed');
	assert.equal(result[0].authUserId, failingCandidate.current_auth_user_id);
	assert.equal(calls.filter((call) => call[0] === 'createUser').length, 0);
	assert.equal(calls.filter((call) => call[0] === 'deleteUser').length, 0);
	assert.equal(calls.filter((call) => call[0] === 'updateUserById').length, 0);
	const failureLog = entries.at(-1);
	assert.equal(failureLog[2].stage, 'record_created_user_remap');
	assert.equal(failureLog[2].oldAuthUserId, failingCandidate.current_auth_user_id);
	assert.equal(failureLog[2].newAuthUserId, replacementAuthUserId);
	assert.equal(failureLog[2].remapOperationName, 'record_workspace_invitation_auth_identity_repair');
	assert.equal(failureLog[2].cleanupAttempted, false);
	assert.equal(failureLog[2].cleanupOutcome, 'retained_existing_auth_user');
	assert.equal(failureLog[2].newAuthUserRetained, true);
	assert.equal(failureLog[2].requiresManualRepair, true);
	assert.doesNotMatch(JSON.stringify(entries), /secret@example\.test/);
});

test('Workspace invitation Auth provisioning stops before alias move when placeholder hard delete fails', async () => {
	const calls = [];
	const replacementAuthUserId = '99999999-9999-4999-8999-999999999999';
	const failingCandidate = {
		invitation_id: '77777777-7777-4777-8777-777777777777',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'secret@example.test',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: false,
		existing_valid_auth_user_id: null,
	};
	const client = {
		auth: {
			admin: {
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: {}, error: null };
				},
				async createUser() {
					calls.push(['createUser']);
					return { data: { user: { id: replacementAuthUserId } }, error: null };
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: null, error: new Error('hard delete denied') };
				},
				async getUserById() {
					throw new Error('getUserById should not run after hard delete failure');
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			return { data: 'repair-id', error: null };
		},
	};

	const { entries, result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [failingCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(result[0].status, 'failed');
	assert.equal(result[0].authUserId, replacementAuthUserId);
	assert.equal(entries.at(-1)[2].stage, 'placeholder_delete_failed');
	assert.equal(calls.find((call) => call[0] === 'rpc' && call[1] === 'verify_workspace_invitation_auth_placeholder_release')[2].p_old_auth_user_id, failingCandidate.current_auth_user_id);
	assert.deepEqual(calls.filter((call) => call[0] === 'deleteUser'), [['deleteUser', failingCandidate.current_auth_user_id, false]]);
	assert.equal(calls.filter((call) => call[0] === 'updateUserById').length, 0);
	assert.equal(calls.filter((call) => call[0] === 'rpc').at(-1)[2].p_old_auth_user_id, failingCandidate.current_auth_user_id);
});

test('Workspace invitation Auth provisioning verifies placeholder deletion before alias assignment', async () => {
	const calls = [];
	const replacementAuthUserId = '99999999-9999-4999-8999-999999999999';
	const failingCandidate = {
		invitation_id: '77777777-7777-4777-8777-777777777777',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'secret@example.test',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: false,
		existing_valid_auth_user_id: null,
	};
	const client = {
		auth: {
			admin: {
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: {}, error: null };
				},
				async createUser() {
					calls.push(['createUser']);
					return { data: { user: { id: replacementAuthUserId } }, error: null };
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: {}, error: null };
				},
				async getUserById(userId) {
					calls.push(['getUserById', userId]);
					return { data: { user: { id: userId, email: null } }, error: null };
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			return { data: 'repair-id', error: null };
		},
	};

	const { entries, result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [failingCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(result[0].status, 'failed');
	assert.equal(result[0].authUserId, replacementAuthUserId);
	assert.equal(entries.at(-1)[2].stage, 'placeholder_delete_failed');
	assert.deepEqual(calls.filter((call) => call[0] === 'deleteUser'), [['deleteUser', failingCandidate.current_auth_user_id, false]]);
	assert.deepEqual(calls.filter((call) => call[0] === 'getUserById'), [['getUserById', failingCandidate.current_auth_user_id]]);
	assert.equal(calls.filter((call) => call[0] === 'updateUserById').length, 0);
	assert.equal(calls.filter((call) => call[0] === 'rpc').at(-1)[2].p_old_auth_user_id, failingCandidate.current_auth_user_id);
	assert.equal(calls.filter((call) => call[0] === 'rpc').at(-1)[2].p_new_auth_user_id, replacementAuthUserId);
	assert.equal(entries.some((entry) => entry[1] === 'deterministic_alias_assignment_started'), false);
});

test('Workspace invitation Auth provisioning releases API-invisible placeholders before alias assignment', async () => {
	const calls = [];
	const placeholderAuthUserId = 'df702c09-60ec-44df-b262-b5902726dc76';
	const replacementAuthUserId = 'fb483350-23d9-4eac-a056-54b4afbfad96';
	const retryCandidate = {
		invitation_id: '77777777-7777-4777-8777-777777777777',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: replacementAuthUserId,
		auth_email: 'mark.nesbit.professional+wt.ruby.atkinson.444444444444@gmail.com',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: true,
		auth_email_matches_invitation: false,
		existing_valid_auth_user_id: null,
		previous_auth_user_id: placeholderAuthUserId,
	};
	const client = {
		auth: {
			admin: {
				async createUser() {
					throw new Error('partially repaired retry must reuse the replacement Auth user');
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: null, error: new Error('User not found') };
				},
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: {}, error: null };
				},
				async getUserById(userId) {
					calls.push(['getUserById', userId]);
					if (userId === placeholderAuthUserId) return { data: null, error: new Error('User not found') };
					return { data: { user: { id: userId, email: retryCandidate.auth_email } }, error: null };
				},
				async listUsers() {
					calls.push(['listUsers']);
					return { data: { users: [{ id: replacementAuthUserId, email: retryCandidate.auth_email }] }, error: null };
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			if (name === 'release_workspace_invitation_auth_placeholder') {
				return { data: [{ result: 'deleted', reason: 'old_auth_user_deleted' }], error: null };
			}
			if (name === 'get_workspace_invitation_auth_identity_repair_candidates') {
				return {
					data: [{
						...retryCandidate,
						has_email_identity: true,
						auth_email_matches_invitation: true,
					}],
					error: null,
				};
			}
			return { data: 'repair-id', error: null };
		},
	};

	const { entries, result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [retryCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(result[0].status, 'remapped_created_user');
	assert.equal(result[0].authUserId, replacementAuthUserId);
	assert.equal(result[0].profileId, retryCandidate.profile_id);
	assert.equal(result[0].membershipId, retryCandidate.membership_id);
	assert.deepEqual(calls.filter((call) => call[0] === 'deleteUser'), [['deleteUser', placeholderAuthUserId, false]]);
	assert.equal(calls.filter((call) => call[0] === 'createUser').length, 0);
	const releaseCall = calls.find((call) => call[0] === 'rpc' && call[1] === 'release_workspace_invitation_auth_placeholder');
	assert.equal(releaseCall[2].p_invitation_id, retryCandidate.invitation_id);
	assert.equal(releaseCall[2].p_old_auth_user_id, placeholderAuthUserId);
	assert.equal(releaseCall[2].p_new_auth_user_id, replacementAuthUserId);
	assert.equal(releaseCall[2].p_correlation_id, '88888888-8888-4888-8888-888888888888');
	assert.deepEqual(calls.filter((call) => call[0] === 'updateUserById'), [['updateUserById', replacementAuthUserId, {
		email: retryCandidate.auth_email,
		user_metadata: {
			watchtower_invitation_auth_provisioned: true,
			watchtower_invitation_auth_temporary: false,
			watchtower_profile_id: retryCandidate.profile_id,
			watchtower_membership_id: retryCandidate.membership_id,
			watchtower_invitation_id: retryCandidate.invitation_id,
		},
	}]]);
	assert.deepEqual(entries.map((entry) => entry[1]), [
		'auth_identity_repair_started',
		'placeholder_delete_started',
		'placeholder_delete_api_completed',
		'placeholder_sql_release_started',
		'placeholder_sql_release_verified',
		'placeholder_delete_verified',
		'deterministic_alias_assignment_started',
		'deterministic_alias_assignment_verified',
		'auth_identity_repair_completed',
	]);
	assert.doesNotMatch(JSON.stringify(entries), /ruby\.atkinson|gmail\.com|token|password|action_link|https?:\/\//i);
});

test('Workspace invitation Auth provisioning blocks alias assignment when SQL placeholder release is blocked', async () => {
	const calls = [];
	const placeholderAuthUserId = 'df702c09-60ec-44df-b262-b5902726dc76';
	const replacementAuthUserId = 'fb483350-23d9-4eac-a056-54b4afbfad96';
	const retryCandidate = {
		invitation_id: '77777777-7777-4777-8777-777777777777',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: replacementAuthUserId,
		auth_email: 'secret@example.test',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: true,
		auth_email_matches_invitation: false,
		existing_valid_auth_user_id: null,
		previous_auth_user_id: placeholderAuthUserId,
	};
	const client = {
		auth: {
			admin: {
				async createUser() {
					throw new Error('blocked release must not create another replacement');
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: null, error: new Error('User not found') };
				},
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: {}, error: null };
				},
				async getUserById() {
					throw new Error('getUserById should not run after blocked SQL release');
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			if (name === 'release_workspace_invitation_auth_placeholder') {
				return { data: [{ result: 'blocked', reason: 'identity_present' }], error: null };
			}
			return { data: 'repair-id', error: null };
		},
	};

	const { entries, result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [retryCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(result[0].status, 'failed');
	assert.equal(result[0].authUserId, replacementAuthUserId);
	assert.equal(result[0].failureCode, WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE);
	assert.doesNotMatch(result[0].failureMessage, /secret@example\.test/i);
	assert.equal(entries.at(-1)[2].stage, 'placeholder_delete_failed');
	assert.equal(calls.filter((call) => call[0] === 'createUser').length, 0);
	assert.equal(calls.filter((call) => call[0] === 'updateUserById').length, 0);
	assert.equal(calls.filter((call) => call[0] === 'rpc').at(-1)[1], 'record_workspace_invitation_auth_identity_repair');
	assert.equal(calls.filter((call) => call[0] === 'rpc').at(-1)[2].p_old_auth_user_id, placeholderAuthUserId);
	assert.equal(calls.filter((call) => call[0] === 'rpc').at(-1)[2].p_new_auth_user_id, replacementAuthUserId);
});

test('Workspace invitation Auth provisioning blocks hard delete when placeholder verification fails', async () => {
	const calls = [];
	const replacementAuthUserId = '99999999-9999-4999-8999-999999999999';
	const failingCandidate = {
		invitation_id: '77777777-7777-4777-8777-777777777777',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'secret@example.test',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: false,
		existing_valid_auth_user_id: null,
	};
	const client = {
		auth: {
			admin: {
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: {}, error: null };
				},
				async createUser() {
					calls.push(['createUser']);
					return { data: { user: { id: replacementAuthUserId } }, error: null };
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: {}, error: null };
				},
				async getUserById() {
					throw new Error('getUserById should not run after placeholder verification failure');
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			if (name === 'verify_workspace_invitation_auth_placeholder_release') {
				return { data: null, error: new Error('WT_INVITATION_AUTH_PLACEHOLDER_RELEASE_REFERENCED: old user still referenced') };
			}
			return { data: 'repair-id', error: null };
		},
	};

	const { entries, result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [failingCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(result[0].status, 'failed');
	assert.equal(result[0].authUserId, replacementAuthUserId);
	assert.equal(entries.at(-1)[2].stage, 'verify_placeholder_unreferenced');
	assert.equal(calls.find((call) => call[0] === 'rpc' && call[1] === 'verify_workspace_invitation_auth_placeholder_release')[2].p_old_auth_user_id, failingCandidate.current_auth_user_id);
	assert.equal(calls.filter((call) => call[0] === 'deleteUser').length, 0);
	assert.equal(calls.filter((call) => call[0] === 'updateUserById').length, 0);
});

test('Workspace invitation Auth provisioning records incomplete repair when final alias assignment fails', async () => {
	const calls = [];
	const replacementAuthUserId = '99999999-9999-4999-8999-999999999999';
	const failingCandidate = {
		invitation_id: '77777777-7777-4777-8777-777777777777',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'secret@example.test',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: false,
		existing_valid_auth_user_id: null,
	};
	const client = {
		auth: {
			admin: {
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: null, error: new Error('alias secret@example.test denied') };
				},
				async createUser() {
					calls.push(['createUser']);
					return { data: { user: { id: replacementAuthUserId } }, error: null };
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: {}, error: null };
				},
				async getUserById() {
					return { data: { user: null }, error: null };
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			return { data: 'repair-id', error: null };
		},
	};

	const { entries, result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [failingCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(result[0].status, 'failed');
	assert.equal(result[0].authUserId, replacementAuthUserId);
	assert.equal(result[0].failureCode, WORKSPACE_INVITATION_AUTH_IDENTITY_ALIAS_FAILURE_CODE);
	assert.doesNotMatch(result[0].failureMessage, /secret@example\.test/i);
	assert.equal(entries.at(-1)[2].stage, 'deterministic_alias_assignment_started');
	assert.equal(calls.find((call) => call[0] === 'rpc' && call[1] === 'verify_workspace_invitation_auth_placeholder_release')[2].p_old_auth_user_id, failingCandidate.current_auth_user_id);
	assert.deepEqual(calls.filter((call) => call[0] === 'deleteUser'), [['deleteUser', failingCandidate.current_auth_user_id, false]]);
	assert.equal(calls.filter((call) => call[0] === 'rpc').at(-1)[2].p_old_auth_user_id, failingCandidate.current_auth_user_id);
});

test('Workspace invitation Auth provisioning rejects duplicate deterministic alias ownership after assignment', async () => {
	const calls = [];
	const oldAuthUserId = '55555555-5555-4555-8555-555555555555';
	const replacementAuthUserId = '99999999-9999-4999-8999-999999999999';
	const failingCandidate = {
		invitation_id: '77777777-7777-4777-8777-777777777777',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: oldAuthUserId,
		auth_email: 'secret@example.test',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: false,
		existing_valid_auth_user_id: null,
	};
	const client = {
		auth: {
			admin: {
				async listUsers() {
					calls.push(['listUsers']);
					return {
						data: {
							users: [
								{ id: replacementAuthUserId, email: failingCandidate.auth_email },
								{ id: oldAuthUserId, email: failingCandidate.auth_email },
							],
						},
						error: null,
					};
				},
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: {}, error: null };
				},
				async createUser() {
					calls.push(['createUser']);
					return { data: { user: { id: replacementAuthUserId } }, error: null };
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: {}, error: null };
				},
				async getUserById(userId) {
					calls.push(['getUserById', userId]);
					if (userId === oldAuthUserId) return { data: { user: null }, error: null };
					return { data: { user: { id: userId, email: failingCandidate.auth_email } }, error: null };
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			if (name === 'get_workspace_invitation_auth_identity_repair_candidates') {
				return {
					data: [{
						...failingCandidate,
						current_auth_user_id: replacementAuthUserId,
						has_email_identity: true,
						auth_email_matches_invitation: true,
					}],
					error: null,
				};
			}
			return { data: 'repair-id', error: null };
		},
	};

	const { entries, result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [failingCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(result[0].status, 'failed');
	assert.equal(result[0].authUserId, replacementAuthUserId);
	assert.equal(result[0].failureCode, WORKSPACE_INVITATION_AUTH_IDENTITY_ALIAS_FAILURE_CODE);
	assert.equal(entries.at(-1)[2].stage, 'deterministic_alias_assignment_started');
	assert.equal(entries.some((entry) => entry[1] === 'deterministic_alias_assignment_verified'), false);
	assert.deepEqual(calls.filter((call) => call[0] === 'deleteUser'), [['deleteUser', oldAuthUserId, false]]);
	assert.equal(calls.filter((call) => call[0] === 'updateUserById').length, 1);
	assert.equal(calls.filter((call) => call[0] === 'rpc').at(-1)[2].p_old_auth_user_id, oldAuthUserId);
});

test('Workspace invitation Auth provisioning reuses temporary replacement users on retry', async () => {
	const calls = [];
	const replacementAuthUserId = '99999999-9999-4999-8999-999999999999';
	const retryCandidate = {
		invitation_id: '11111111-1111-4111-8111-111111111111',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'mark.nesbit.professional+wt.ruby.atkinson.444444444444@gmail.com',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: false,
		existing_valid_auth_user_id: null,
	};
	const client = {
		auth: {
			admin: {
				async listUsers(input) {
					calls.push(['listUsers', input]);
					return {
						data: {
							users: [{
								id: replacementAuthUserId,
								email: 'invitation-auth-repair+1111111111114111.5555555555554555@pending.watchtower.invalid',
							}],
						},
						error: null,
					};
				},
				async createUser() {
					throw new Error('retry should reuse the temporary replacement instead of creating a duplicate');
				},
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: {}, error: null };
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: {}, error: null };
				},
				async getUserById(userId) {
					calls.push(['getUserById', userId]);
					if (userId === retryCandidate.current_auth_user_id) {
						return { data: { user: null }, error: null };
					}
					return { data: { user: { id: userId, email: retryCandidate.auth_email } }, error: null };
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			if (name === 'get_workspace_invitation_auth_identity_repair_candidates') {
				return {
					data: [{
						...retryCandidate,
						current_auth_user_id: replacementAuthUserId,
						has_email_identity: true,
						auth_email_matches_invitation: true,
					}],
					error: null,
				};
			}
			return { data: 'repair-id', error: null };
		},
	};

	const { result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [retryCandidate],
		correlationId: '66666666-6666-4666-8666-666666666666',
	}));

	assert.equal(result[0].status, 'remapped_created_user');
	assert.equal(result[0].authUserId, replacementAuthUserId);
	assert.equal(calls.filter((call) => call[0] === 'listUsers').length, 2);
	assert.equal(calls.filter((call) => call[0] === 'createUser').length, 0);
	assert.equal(calls.find((call) => call[0] === 'rpc' && call[1] === 'verify_workspace_invitation_auth_placeholder_release')[2].p_old_auth_user_id, retryCandidate.current_auth_user_id);
	assert.deepEqual(calls.filter((call) => call[0] === 'deleteUser'), [['deleteUser', retryCandidate.current_auth_user_id, false]]);
});

test('Workspace invitation Auth provisioning finalises an already-remapped temporary user without duplicate records', async () => {
	const calls = [];
	const placeholderAuthUserId = '55555555-5555-4555-8555-555555555555';
	const temporaryAuthUserId = '99999999-9999-4999-8999-999999999999';
	const retryCandidate = {
		invitation_id: '11111111-1111-4111-8111-111111111111',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: temporaryAuthUserId,
		auth_email: 'mark.nesbit.professional+wt.ruby.atkinson.444444444444@gmail.com',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: true,
		auth_email_matches_invitation: false,
		existing_valid_auth_user_id: null,
		previous_auth_user_id: placeholderAuthUserId,
	};
	const client = {
		auth: {
			admin: {
				async createUser() {
					throw new Error('already-remapped retry should not create a duplicate Auth user');
				},
				async updateUserById(...args) {
					calls.push(['updateUserById', ...args]);
					return { data: {}, error: null };
				},
				async deleteUser(...args) {
					calls.push(['deleteUser', ...args]);
					return { data: {}, error: null };
				},
				async getUserById(userId) {
					calls.push(['getUserById', userId]);
					if (userId === placeholderAuthUserId) {
						return { data: { user: null }, error: null };
					}
					return { data: { user: { id: userId, email: retryCandidate.auth_email } }, error: null };
				},
			},
		},
		async rpc(name, args) {
			calls.push(['rpc', name, args]);
			if (name === 'get_workspace_invitation_auth_identity_repair_candidates') {
				return {
					data: [{
						...retryCandidate,
						has_email_identity: true,
						auth_email_matches_invitation: true,
					}],
					error: null,
				};
			}
			return { data: 'repair-id', error: null };
		},
	};

	const { result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [retryCandidate],
		correlationId: '66666666-6666-4666-8666-666666666666',
	}));

	assert.equal(result[0].status, 'remapped_created_user');
	assert.equal(result[0].authUserId, temporaryAuthUserId);
	assert.equal(calls.filter((call) => call[0] === 'createUser').length, 0);
	assert.equal(calls.filter((call) => call[0] === 'rpc' && call[1] === 'record_workspace_invitation_auth_identity_repair').length, 0);
	assert.equal(calls.find((call) => call[0] === 'rpc' && call[1] === 'verify_workspace_invitation_auth_placeholder_release')[2].p_old_auth_user_id, placeholderAuthUserId);
	assert.deepEqual(calls.filter((call) => call[0] === 'deleteUser'), [['deleteUser', placeholderAuthUserId, false]]);
	assert.equal(calls.filter((call) => call[0] === 'updateUserById').length, 1);
});

test('Workspace invitation Auth provisioning logs safe failure stage without raw provider details', async () => {
	const failingCandidate = {
		invitation_id: '77777777-7777-4777-8777-777777777777',
		organisation_id: '22222222-2222-4222-8222-222222222222',
		membership_id: '33333333-3333-4333-8333-333333333333',
		profile_id: '44444444-4444-4444-8444-444444444444',
		current_auth_user_id: '55555555-5555-4555-8555-555555555555',
		auth_email: 'secret@example.test',
		membership_status: 'invited',
		invitation_status: 'delivery_failed',
		has_email_identity: false,
		existing_valid_auth_user_id: null,
	};
	const client = {
		auth: {
			admin: {
				async updateUserById() {
					throw new Error('updateUserById should not run after create failure');
				},
				async createUser() {
					return { data: null, error: new Error('User secret@example.test failed with token https://example.test/action') };
				},
				async deleteUser() {
					throw new Error('deleteUser should not run after create failure');
				},
				async getUserById() {
					throw new Error('getUserById should not run after create failure');
				},
			},
		},
		async rpc() {
			return { data: 'repair-id', error: null };
		},
	};

	const { entries, result } = await captureConsole(() => provisionWorkspaceInvitationAuthIdentities({
		adminClient: client,
		candidates: [failingCandidate],
		correlationId: '88888888-8888-4888-8888-888888888888',
	}));

	assert.equal(result[0].status, 'failed');
	assert.deepEqual(entries, [
		['info', 'auth_identity_repair_started', {
			profileId: failingCandidate.profile_id,
			membershipId: failingCandidate.membership_id,
			invitationId: failingCandidate.invitation_id,
			oldAuthUserId: failingCandidate.current_auth_user_id,
		}],
		['error', 'auth_identity_repair_failed', {
			failureCode: WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE,
			stage: 'create_temporary_valid_auth_user',
			profileId: failingCandidate.profile_id,
			membershipId: failingCandidate.membership_id,
			invitationId: failingCandidate.invitation_id,
		}],
	]);
	assert.doesNotMatch(JSON.stringify(entries), /secret@example\.test|example\.test\/action|token|password|authorization|re_[a-z0-9_-]+/i);
});

test('Workspace invitation send and setup routes repair Auth identity before delivery and recovery', async () => {
	const route = await readFile(sendRouteUrl, 'utf8');
	const setupRoute = await readFile(setupRouteUrl, 'utf8');
	const failedIdentityBlock = route.match(/const failedIdentityResults = new Map[\s\S]*?deliverable = deliverable\.filter\(\(invitation\) => !failedIdentityResults\.has\(invitation\.invitation_id\)\);/)?.[0] ?? '';

	assert.match(route, /createSupabaseAdminClient\(invitationDeliveryEnv as Record<string, unknown>\)/);
	assert.match(route, /get_workspace_invitation_auth_identity_repair_candidates/);
	assert.match(route, /provisionWorkspaceInvitationAuthIdentities/);
	assert.match(route, /WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE/);
	assert.match(route, /Invitation account setup could not be completed safely\. Retry is available\./);
	assert.match(route, /markDeliveryResult\(serverSupabase, result\)/);
	assert.match(route, /deliverable = deliverable\.filter\(\(invitation\) => !failedIdentityResults\.has\(invitation\.invitation_id\)\)/);
	assert.match(failedIdentityBlock, /status: 'delivery_failed'/);
	assert.match(failedIdentityBlock, /failureCode: failedIdentity\.failureCode \?\? WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE/);
	assert.match(failedIdentityBlock, /failureMessage: 'Invitation account setup could not be completed safely\. Retry is available\.'/);
	assert.match(failedIdentityBlock, /markDeliveryResult\(serverSupabase, result\)/);
	assert.doesNotMatch(failedIdentityBlock, /sendWorkspaceInvitationEmail/);
	assert.ok(route.indexOf('deliverable = deliverable.filter((invitation) => !failedIdentityResults.has(invitation.invitation_id))') < route.indexOf('result = await sendWorkspaceInvitationEmail'));
	assert.match(setupRoute, /get_workspace_invitation_auth_identity_repair_candidates/);
	assert.match(setupRoute, /provisionWorkspaceInvitationAuthIdentities/);
	assert.match(setupRoute, /candidate\.has_email_identity && candidate\.auth_email_matches_invitation !== false/);
	assert.match(setupRoute, /const linkedAuthUserId = await resolveLinkedAuthUserId/);
	assert.match(setupRoute, /auth\.admin\.getUserById\(linkedAuthUserId\)/);
	assert.match(setupRoute, /auth\.admin\.generateLink\(\{/);
	assert.doesNotMatch(route, /insert into auth\.identities|auth_email|contact_email|console\.log\(.*token|rawToken.*console/i);
	assert.doesNotMatch(setupRoute, /insert into auth\.identities|formData\.get\('auth_user_id'\)|formData\.get\('email'\)|contact_email|login_name/);
});

test('Workspace invitation setup route logs candidate lookup and stage-specific setup failures safely', async () => {
	const setupRoute = await readFile(setupRouteUrl, 'utf8');

	assert.match(setupRoute, /repair_candidate_lookup_completed/);
	assert.match(setupRoute, /candidateFound: Boolean\(candidate\)/);
	assert.match(setupRoute, /candidateCount: candidates\.length/);
	assert.match(setupRoute, /membershipId: candidate\?\.membership_id \?\? null/);
	assert.match(setupRoute, /invitationId: candidate\?\.invitation_id \?\? null/);
	assert.match(setupRoute, /currentAuthUserId: candidate\?\.current_auth_user_id \?\? null/);
	assert.match(setupRoute, /hasEmailIdentity: candidate\?\.has_email_identity \?\? null/);
	assert.match(setupRoute, /let setupStage = 'auth_identity_repair'/);
	assert.match(setupRoute, /setupStage = 'get_user_by_id'[\s\S]*auth\.admin\.getUserById\(linkedAuthUserId\)/);
	assert.match(setupRoute, /setupStage = 'generate_link'[\s\S]*auth\.admin\.generateLink\(\{/);
	assert.match(setupRoute, /setupStage = 'validate_action_link'[\s\S]*safeSupabaseActionLink/);
	assert.match(setupRoute, /stage: setupStage/);
	assert.match(setupRoute, /safeLogMessage\(error, 'Invitation setup link failed'\)/);
	assert.doesNotMatch(setupRoute, /console\.(?:info|warn|error)\([^)]*(?:tokenHash|token|authEmail|actionLink|email: authEmail)/i);
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

test('Workspace invitation acceptance is authorised through the lifecycle guard only for exact activation', async () => {
	const sql = await readFile(acceptanceLifecycleGuardMigrationUrl, 'utf8');
	const docs = await readFile(docsUrl, 'utf8');
	const schemaDocs = await readFile(schemaDocsUrl, 'utf8');
	const guardSql = sqlFunctionDefinition(sql, 'prevent_unsafe_workspace_membership_update');
	const acceptSql = sqlFunctionDefinition(sql, 'accept_workspace_membership_invitation');
	const sqlWithoutAccept = sql.replace(acceptSql, '');
	const membershipActivationSet = acceptSql.match(/update public\.organisation_members as om[\s\S]*?where om\.id = v_invitation\.membership_id/)?.[0] ?? '';

	assert.match(guardSql, /lifecycle_operation text := coalesce\(current_setting\('watchtower\.membership_lifecycle_operation', true\), ''\)/);
	assert.match(guardSql, /invitation_acceptance boolean := lifecycle_operation = 'workspace_invitation_acceptance'/);
	assert.match(guardSql, /old\.auth_user_id is distinct from new\.auth_user_id/);
	assert.match(guardSql, /if invitation_acceptance then[\s\S]*marker_auth_user_id := nullif\(current_setting\('watchtower\.membership_lifecycle_auth_user_id', true\), ''\)/);
	assert.match(guardSql, /old\.organisation_id <> marker_organisation_id::uuid[\s\S]*old\.id <> marker_membership_id::uuid[\s\S]*old\.user_id <> marker_profile_id::uuid[\s\S]*old\.auth_user_id <> marker_auth_user_id::uuid/);
	assert.match(guardSql, /old\.status <> 'invited'[\s\S]*new\.status <> 'active'/);
	assert.match(guardSql, /old\.accepted_at is not null[\s\S]*new\.accepted_at is null/);
	assert.match(guardSql, /new\.role is distinct from old\.role/);
	assert.match(guardSql, /new\.invited_by is distinct from old\.invited_by/);
	assert.match(guardSql, /new\.invitation_expires_at is distinct from old\.invitation_expires_at/);
	assert.match(guardSql, /old\.joined_at is not null and new\.joined_at is distinct from old\.joined_at/);
	assert.match(guardSql, /new\.joined_at is null/);
	assert.match(guardSql, /new\.deactivated_at is distinct from old\.deactivated_at/);
	assert.match(guardSql, /new\.reactivated_at is distinct from old\.reactivated_at/);
	assert.match(guardSql, /WT_INVITATION_ACCEPTANCE_SCOPE/);
	assert.match(guardSql, /Use controlled workspace membership lifecycle functions for membership lifecycle changes/);
	assert.match(acceptSql, /v_actor_auth_user_id uuid := auth\.uid\(\)/);
	assert.match(acceptSql, /where invitation\.token_hash = p_token_hash[\s\S]*and invitation\.is_current[\s\S]*for update/);
	assert.match(acceptSql, /where om\.id = v_invitation\.membership_id[\s\S]*for update/);
	assert.match(acceptSql, /v_actor_auth_user_id <> v_invitation\.auth_user_id[\s\S]*WT_INVITATION_WRONG_ACCOUNT/);
	assert.match(acceptSql, /v_invitation\.status in \('cancelled', 'superseded'\)[\s\S]*cancelled_at is not null[\s\S]*superseded_at is not null/);
	assert.match(acceptSql, /v_invitation\.expires_at <= v_accepted_at[\s\S]*WT_INVITATION_EXPIRED/);
	assert.match(acceptSql, /v_invitation\.status not in \('opened', 'delivered'\)/);
	assert.match(acceptSql, /v_membership\.organisation_id <> v_invitation\.organisation_id[\s\S]*v_membership\.id <> v_invitation\.membership_id[\s\S]*v_membership\.user_id <> v_invitation\.profile_id[\s\S]*v_membership\.role <> v_invitation\.intended_role/);
	assert.match(acceptSql, /v_membership\.status <> 'invited'/);
	assert.match(acceptSql, /v_membership\.auth_user_id is null or v_membership\.auth_user_id <> v_actor_auth_user_id/);
	assert.match(acceptSql, /set_config\('watchtower\.membership_lifecycle_operation', 'workspace_invitation_acceptance', true\)/);
	assert.match(acceptSql, /set_config\('watchtower\.membership_lifecycle_organisation_id', v_invitation\.organisation_id::text, true\)/);
	assert.match(acceptSql, /set_config\('watchtower\.membership_lifecycle_membership_id', v_invitation\.membership_id::text, true\)/);
	assert.match(acceptSql, /set_config\('watchtower\.membership_lifecycle_profile_id', v_invitation\.profile_id::text, true\)/);
	assert.match(acceptSql, /set_config\('watchtower\.membership_lifecycle_auth_user_id', v_actor_auth_user_id::text, true\)/);
	assert.match(acceptSql, /set_config\('watchtower\.membership_lifecycle_invitation_id', v_invitation\.id::text, true\)/);
	assert.match(acceptSql, /update public\.workspace_membership_invitations as invitation[\s\S]*set status = 'accepted'[\s\S]*accepted_at = v_accepted_at[\s\S]*accepted_by = v_actor_auth_user_id[\s\S]*token_hash = null/);
	assert.match(acceptSql, /where invitation\.id = v_invitation\.id[\s\S]*and invitation\.is_current[\s\S]*and invitation\.status in \('opened', 'delivered'\)[\s\S]*and invitation\.auth_user_id = v_actor_auth_user_id/);
	assert.match(acceptSql, /update public\.organisation_members as om[\s\S]*set status = 'active',[\s\S]*accepted_at = v_accepted_at,[\s\S]*joined_at = coalesce\(om\.joined_at, v_accepted_at\),[\s\S]*updated_by = v_actor_auth_user_id/);
	assert.match(acceptSql, /where om\.id = v_invitation\.membership_id[\s\S]*and om\.organisation_id = v_invitation\.organisation_id[\s\S]*and om\.user_id = v_invitation\.profile_id[\s\S]*and om\.auth_user_id = v_actor_auth_user_id[\s\S]*and om\.role = v_invitation\.intended_role[\s\S]*and om\.status = 'invited'/);
	assert.match(acceptSql, /workspace_invitation_replay_rejected/);
	assert.match(acceptSql, /workspace_invitation_accepted/);
	assert.match(acceptSql, /workspace_membership_activated/);
	assert.doesNotMatch(membershipActivationSet, /\brole\s*=|\buser_id\s*=|\bauth_user_id\s*=|\borganisation_id\s*=/);
	assert.doesNotMatch(sqlWithoutAccept, /set_config\('watchtower\.membership_lifecycle_operation', 'workspace_invitation_acceptance'/);
	assert.doesNotMatch(sql, /disable trigger|session_replication_role|grant update .*public\.organisation_members to authenticated/i);
	assert.match(docs, /Invitation acceptance is the only user-facing activation path through the membership lifecycle guard/);
	assert.match(schemaDocs, /Acceptance is authorised by a transaction-local `workspace_invitation_acceptance` lifecycle marker/);
});

test('Workspace invitation acceptance audit records Auth user identity rather than profile identity', async () => {
	const sql = await readFile(acceptanceAuditIdentityMigrationUrl, 'utf8');
	const schemaDocs = await readFile(schemaDocsUrl, 'utf8');
	const acceptSql = sqlFunctionDefinition(sql, 'accept_workspace_membership_invitation');
	const replayAudit = acceptSql.match(/record_workspace_membership_audit_event\([\s\S]*?'workspace_invitation_replay_rejected'[\s\S]*?\);/)?.[0] ?? '';
	const acceptedAudit = acceptSql.match(/record_workspace_membership_audit_event\([\s\S]*?'workspace_invitation_accepted'[\s\S]*?\);/)?.[0] ?? '';
	const activatedAudit = acceptSql.match(/record_workspace_membership_audit_event\([\s\S]*?'workspace_membership_activated'[\s\S]*?\);/)?.[0] ?? '';
	const membershipActivationSet = acceptSql.match(/update public\.organisation_members as om[\s\S]*?where om\.id = v_invitation\.membership_id/)?.[0] ?? '';
	const invitationAcceptedIndex = acceptSql.indexOf("set status = 'accepted'");
	const membershipActivatedIndex = acceptSql.indexOf("set status = 'active'");
	const auditAcceptedIndex = acceptSql.indexOf("'workspace_invitation_accepted'");

	assert.match(sql, /workspace_membership_audit_events\.target_user_id references auth\.users\(id\)/);
	assert.match(acceptSql, /v_actor_auth_user_id uuid := auth\.uid\(\)/);
	assert.match(acceptSql, /if v_actor_auth_user_id <> v_invitation\.auth_user_id/);
	assert.match(acceptSql, /if v_membership\.auth_user_id is null or v_membership\.auth_user_id <> v_actor_auth_user_id/);
	assert.match(replayAudit, /v_invitation\.organisation_id,\s+v_invitation\.membership_id,\s+v_invitation\.auth_user_id,\s+v_actor_auth_user_id,\s+'workspace_invitation_replay_rejected'/);
	assert.match(acceptedAudit, /v_invitation\.organisation_id,\s+v_invitation\.membership_id,\s+v_membership\.auth_user_id,\s+v_actor_auth_user_id,\s+'workspace_invitation_accepted'/);
	assert.match(activatedAudit, /v_invitation\.organisation_id,\s+v_invitation\.membership_id,\s+v_membership\.auth_user_id,\s+v_actor_auth_user_id,\s+'workspace_membership_activated'/);
	assert.match(acceptedAudit, /'profile_id', v_invitation\.profile_id/);
	assert.match(activatedAudit, /'profile_id', v_invitation\.profile_id/);
	assert.match(acceptedAudit, /'target_auth_user_id', v_membership\.auth_user_id/);
	assert.match(activatedAudit, /'target_auth_user_id', v_membership\.auth_user_id/);
	assert.doesNotMatch(acceptSql, /record_workspace_membership_audit_event\(\s*v_invitation\.organisation_id,\s*v_invitation\.membership_id,\s*v_invitation\.profile_id,/);
	assert.doesNotMatch(sql, /alter table public\.workspace_membership_audit_events[\s\S]*target_user_id[\s\S]*references public\.profiles|drop constraint .*target_user_id_fkey/i);
	assert.match(acceptSql, /where om\.id = v_invitation\.membership_id[\s\S]*and om\.user_id = v_invitation\.profile_id[\s\S]*and om\.auth_user_id = v_actor_auth_user_id[\s\S]*and om\.role = v_invitation\.intended_role[\s\S]*and om\.status = 'invited'/);
	assert.doesNotMatch(membershipActivationSet, /\brole\s*=|\buser_id\s*=|\bauth_user_id\s*=|\borganisation_id\s*=/i);
	assert.match(acceptSql, /workspace_invitation_replay_rejected/);
	assert.ok(invitationAcceptedIndex > 0 && membershipActivatedIndex > invitationAcceptedIndex && auditAcceptedIndex > membershipActivatedIndex);
	assert.match(schemaDocs, /`target_user_id` and `actor_user_id` reference `auth\.users\.id`; profile UUIDs are recorded only in JSON payload fields/);
});

test('Workspace invitation acceptance populates and exposes membership joined_at safely', async () => {
	const sql = await readFile(acceptanceJoinedAtMigrationUrl, 'utf8');
	const acceptSql = sqlFunctionDefinition(sql, 'accept_workspace_membership_invitation');
	const replayBlock = acceptSql.match(/if v_invitation\.status = 'accepted' or v_membership\.status = 'active' then[\s\S]*?return v_invitation\.membership_id;\n  end if;/)?.[0] ?? '';
	const memberView = sql.match(/create or replace view public\.workspace_member_directory[\s\S]*?where public\.is_active_organisation_member\(om\.organisation_id\);/)?.[0] ?? '';
	const adminView = sql.match(/create or replace view public\.workspace_member_admin_directory[\s\S]*?where public\.has_real_active_organisation_role/)?.[0] ?? '';
	const backfillBlock = sql.match(/do \$\$[\s\S]*?WT_INVITATION_JOINED_AT_BACKFILL[\s\S]*?end;\n\$\$;/)?.[0] ?? '';
	const backfillSet = backfillBlock.match(/update public\.organisation_members as om[\s\S]*?from public\.workspace_membership_invitations/)?.[0] ?? '';

	assert.match(acceptSql, /v_accepted_at timestamptz := now\(\)/);
	assert.match(acceptSql, /update public\.workspace_membership_invitations as invitation[\s\S]*accepted_at = v_accepted_at[\s\S]*accepted_by = v_actor_auth_user_id/);
	assert.match(acceptSql, /update public\.organisation_members as om[\s\S]*accepted_at = v_accepted_at,[\s\S]*joined_at = coalesce\(om\.joined_at, v_accepted_at\),[\s\S]*updated_at = v_accepted_at/);
	assert.match(acceptSql, /and om\.role = v_invitation\.intended_role[\s\S]*and om\.status = 'invited'/);
	assert.doesNotMatch(replayBlock, /update public\.organisation_members|joined_at =/);
	assert.match(acceptSql, /'joined_at', coalesce\(v_membership\.joined_at, v_accepted_at\)/);
	assert.match(backfillBlock, /set_config\('watchtower\.membership_lifecycle_rpc', 'true', true\)/);
	assert.match(backfillBlock, /joined_at = coalesce\(om\.joined_at, om\.accepted_at, invitation\.accepted_at\)/);
	assert.match(backfillBlock, /accepted_at = coalesce\(om\.accepted_at, invitation\.accepted_at\)/);
	assert.match(backfillBlock, /invitation\.status = 'accepted'/);
	assert.match(backfillBlock, /om\.status = 'active'/);
	assert.match(backfillBlock, /om\.joined_at is null/);
	assert.match(backfillBlock, /invitation\.profile_id = om\.user_id[\s\S]*invitation\.auth_user_id = om\.auth_user_id/);
	assert.doesNotMatch(backfillSet, /\brole\s*=|\buser_id\s*=|\bauth_user_id\s*=|\borganisation_id\s*=/i);
	assert.match(memberView, /om\.deactivated_at,[\s\S]*om\.reactivated_at,[\s\S]*om\.joined_at/);
	assert.match(adminView, /invitation\.delivery_strategy as invitation_delivery_strategy,[\s\S]*om\.joined_at/);
	assert.match(sql, /comment on view public\.workspace_member_admin_directory[\s\S]*joined_at/);
});

test('Workspace invitation workspace-resolution migration exposes Auth UUID for server-side current member checks', async () => {
	const sql = await readFile(workspaceResolutionMigrationUrl, 'utf8');
	const memberView = sql.match(/create or replace view public\.workspace_member_directory[\s\S]*?where public\.is_active_organisation_member\(om\.organisation_id\);/)?.[0] ?? '';
	const adminView = sql.match(/create or replace view public\.workspace_member_admin_directory[\s\S]*?where public\.has_real_active_organisation_role/)?.[0] ?? '';

	assert.match(memberView, /om\.deactivated_at,[\s\S]*om\.reactivated_at,[\s\S]*om\.joined_at,[\s\S]*om\.auth_user_id/);
	assert.match(adminView, /invitation\.delivery_strategy as invitation_delivery_strategy,[\s\S]*om\.joined_at,[\s\S]*om\.auth_user_id/);
	assert.match(sql, /auth_user_id is exposed for server-side current-member resolution only/);
	assert.match(sql, /grant select on public\.workspace_member_directory to authenticated/);
	assert.match(sql, /grant select on public\.workspace_member_admin_directory to authenticated/);
	assert.doesNotMatch(memberView, /contact_email|auth_email|p\.email/i);
	assert.doesNotMatch(sql, /drop view|drop table|delete from auth\.users|insert into auth\.users/i);
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
	assert.match(route, /import \{ env \} from 'cloudflare:workers'/);
	assert.match(route, /POST: APIRoute = async \(\{ cookies, params, request, url \}\)/);
	assert.match(route, /const invitationDeliveryEnv = env as InvitationDeliveryEnv/);
	assert.match(route, /generateInvitationToken\(\)/);
	assert.match(route, /hashInvitationToken\(token\)/);
	assert.match(route, /prepare_workspace_membership_invitations/);
	assert.match(route, /begin_workspace_membership_invitation_delivery_attempt/);
	assert.match(route, /record_workspace_membership_invitation_delivery_result/);
	assert.match(route, /sendWorkspaceInvitationEmail/);
	assert.match(route, /env: invitationDeliveryEnv/);
	assert.match(route, /workspaceInvitationEmailConfigDiagnostics\(invitationDeliveryEnv\)/);
	assert.match(route, /workspace_team_invitation_delivery_claim_failed/);
	assert.match(route, /workspace_team_invitation_delivery_result_record_failed/);
	assert.match(route, /return redirectToTeam\(workspaceSlug, \{\s*invitation_delivery: 'error',\s*invitation_delivery_error: 'failed'/);
	assert.match(delivery, /provider_not_configured/);
	assert.match(delivery, /test_record_only/);
	assert.match(delivery, /renderInvitationEmail/);
	assert.match(delivery, /https:\/\/api\.resend\.com\/emails/);
	assert.match(delivery, /WATCHTOWER_SITE_URL/);
	assert.match(delivery, /WATCHTOWER_EMAIL_FROM_ADDRESS/);
	assert.match(delivery, /WATCHTOWER_EMAIL_FROM_NAME/);
	assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE|service_role|auth\.admin|console\.log\(.*token|rawToken.*console/i);
	assert.doesNotMatch(route, /locals\.runtime|runtime\.env|workspaceInvitationDeliveryEnvFromLocals|import\.meta\.env|WATCHTOWER_RESEND_API_KEY|WATCHTOWER_EMAIL_FROM_ADDRESS|WATCHTOWER_EMAIL_FROM_NAME|WATCHTOWER_INVITATION_REPLY_TO|WATCHTOWER_SITE_URL/);
	assert.doesNotMatch(delivery, /console\.log\(.*token|rawToken.*console|provider_response/i);
});

test('Workspace invitation acceptance page validates before disclosure and blocks wrong account', async () => {
	const page = await readFile(acceptPageUrl, 'utf8');

	assert.match(page, /get_workspace_membership_invitation_by_token/);
	assert.match(page, /accept_workspace_membership_invitation/);
	assert.match(page, /currentAuthUserId/);
	assert.match(page, /accountState === 'matching'/);
	assert.match(page, /accountState === 'wrong_account'/);
	assert.match(page, /This invitation link is invalid, expired, cancelled or has already been used/);
	assert.match(page, /Set up or sign in to the account created for this invitation before accepting it/);
	assert.match(page, /You are currently signed in with a different Watchtower account/);
	assert.match(page, /You are signed in as the invited person/);
	assert.match(page, /Sign out and continue with this invitation/);
	assert.match(page, /data-invitation-sign-out-form/);
	assert.match(page, /supabase\.auth\.signOut\(\)/);
	assert.match(page, /<dl class="invitation-accept-card__summary" aria-label="Invitation details">/);
	assert.match(page, /<dt>Workspace<\/dt>[\s\S]*<dd>\{invitation\.workspace_name\}<\/dd>/);
	assert.match(page, /role="alert" aria-live="assertive"/);
	assert.match(page, /buildWorkspaceInvitationSetupPath\(token\)/);
	assert.match(page, /buildWorkspaceInvitationLoginPath\(token\)/);
	assert.doesNotMatch(page, /Password setup is completed through the secure provider invitation email/);
	assert.doesNotMatch(page, /from\('workspace_membership_invitations'\)\.select|auth\.admin|service_role/i);
});

test('Workspace invitation acceptance page logs safe acceptance outcomes', async () => {
	const page = await readFile(acceptPageUrl, 'utf8');
	const failureLog = page.match(/console\.error\('workspace_invitation_acceptance_failed'[\s\S]*?\n\t\}\);/)?.[0] ?? '';
	const successLog = page.match(/console\.info\('workspace_invitation_acceptance_completed'[\s\S]*?\n\t\}\);/)?.[0] ?? '';

	assert.match(page, /type AcceptanceOutcome = 'wrong_account' \| 'invalid' \| 'failed'/);
	assert.match(page, /const routeName = 'workspace_invitation_acceptance'/);
	assert.match(page, /safeLogText/);
	assert.match(page, /https\?:\\\/\\\/\[\^\\s\]\+/);
	assert.match(page, /\[redacted-email\]/);
	assert.match(page, /\[redacted-token\]/);
	assert.match(page, /\[redacted-token-hash\]/);
	assert.match(page, /\[redacted\]/);
	assert.match(page, /WRONG_ACCOUNT[\s\S]*return 'wrong_account'/);
	assert.match(page, /INVALID\|NOT_ACCEPTABLE\|EXPIRED\|CANCELLED\|SUPERSEDED[\s\S]*return 'invalid'/);
	assert.match(page, /return 'failed'/);
	assert.match(page, /const acceptanceLogIds[\s\S]*invitationId: currentInvitation\?\.invitation_id \?\? null/);
	assert.match(page, /const acceptanceLogIds[\s\S]*membershipId: currentInvitation\?\.membership_id \?\? null/);
	assert.match(page, /const acceptanceLogIds[\s\S]*profileId: currentInvitation\?\.profile_id \?\? null/);
	assert.match(failureLog, /routeName/);
	assert.match(failureLog, /\.\.\.acceptanceLogIds\(currentInvitation\)/);
	assert.match(failureLog, /signedInAuthUserId/);
	assert.match(failureLog, /supabaseErrorCode: safeLogText\(error\.code\)/);
	assert.match(failureLog, /safeErrorMessage: safeLogText\(error\.message\)/);
	assert.match(failureLog, /safeDetails: safeLogText\(error\.details\)/);
	assert.match(failureLog, /safeHint: safeLogText\(error\.hint\)/);
	assert.match(failureLog, /outcome/);
	assert.match(successLog, /\.\.\.acceptanceLogIds\(currentInvitation\)/);
	assert.match(successLog, /signedInAuthUserId/);
	assert.match(successLog, /resultingWorkspaceSlug/);
	assert.match(page, /logAcceptanceFailed\(\{[\s\S]*currentInvitation,[\s\S]*signedInAuthUserId,[\s\S]*error,[\s\S]*outcome: code/);
	assert.match(page, /logAcceptanceCompleted\(\{[\s\S]*currentInvitation,[\s\S]*signedInAuthUserId,[\s\S]*resultingWorkspaceSlug: slug \?\? null/);
	assert.doesNotMatch(failureLog, /tokenHash|p_token_hash|token|Astro\.url|email|password|accessToken|refreshToken|url\.href/i);
	assert.doesNotMatch(successLog, /tokenHash|p_token_hash|token|Astro\.url|email|password|accessToken|refreshToken|url\.href/i);
});

test('Workspace invitation acceptance page meets static accessibility guardrails', async () => {
	const page = await readFile(acceptPageUrl, 'utf8');

	assert.match(page, /font-size: clamp\(1\.75rem, 4vw, 2\.4rem\)/);
	assert.match(page, /letter-spacing: 0/);
	assert.match(page, /min-height: 44px/);
	assert.match(page, /focus-visible/);
	assert.match(page, /overflow-wrap: anywhere/);
	assert.match(page, /@media \(max-width: 34rem\)/);
	assert.match(page, /inline-size: min\(100%, 42rem\)/);
	assert.ok(contrastRatio('#102033', '#ffffff') >= 4.5, 'main text on white should meet WCAG AA');
	assert.ok(contrastRatio('#475569', '#ffffff') >= 4.5, 'muted text on white should meet WCAG AA');
	assert.ok(contrastRatio('#7f1d1d', '#fff1f2') >= 4.5, 'error text should meet WCAG AA');
	assert.ok(contrastRatio('#00111e', '#39c2ff') >= 4.5, 'primary button text should meet WCAG AA');
});

test('Workspace invitation setup route generates setup link for exact invited auth user only', async () => {
	const route = await readFile(setupRouteUrl, 'utf8');
	const resetForm = await readFile(resetPasswordFormUrl, 'utf8');

	assert.match(route, /import \{ env \} from 'cloudflare:workers'/);
	assert.match(route, /get_workspace_membership_invitation_by_token/);
	assert.match(route, /createSupabaseAdminClient\(runtimeEnv\)/);
	assert.match(route, /resolveLinkedAuthUserId\(adminSupabase, invitation, tokenHash\)/);
	assert.match(route, /auth\.admin\.getUserById\(linkedAuthUserId\)/);
	assert.match(route, /auth\.admin\.generateLink\(\{/);
	assert.match(route, /type: 'recovery'/);
	assert.match(route, /buildWorkspaceInvitationResetPasswordPath\(token\)/);
	assert.match(route, /watchtowerReturnOrigin\(runtimeEnv, url\.origin\)/);
	assert.match(route, /WATCHTOWER_SITE_URL/);
	assert.match(route, /safeSupabaseActionLink/);
	assert.match(route, /clearAuthCookies\(response\.headers\)/);
	assert.doesNotMatch(route, /formData\.get\('auth_user_id'\)|formData\.get\('email'\)|contact_email|login_name/);
	assert.doesNotMatch(route, /console\.(?:log|warn|error)\([^)]*(?:token|authEmail|actionLink|email)/i);
	assert.match(resetForm, /getSafeRedirectPath\(new URLSearchParams\(window\.location\.search\)\.get\('returnTo'\)\)/);
	assert.match(resetForm, /document\.cookie = `wt-access-token=\$\{session\.access_token\}/);
	assert.match(resetForm, /window\.location\.assign\(returnTo\)/);
	assert.doesNotMatch(resetForm, /window\.location\.assign\('\/app'\)/);
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
