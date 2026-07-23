import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const applicationMigrationUrl = new URL('../supabase/migrations/20260723000900_workspace_membership_application_shared_contact_policy.sql', import.meta.url);
const policyMigrationUrl = new URL('../supabase/migrations/20260630000100_fix_internal_test_workspace_scope.sql', import.meta.url);
const teamPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team.astro', import.meta.url);
const reviewPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/team/imports/[importRunId]/review.astro', import.meta.url);
const docsUrl = new URL('../docs/access-foundation.md', import.meta.url);
const schemaDocsUrl = new URL('../docs/architecture/database-schema-v1.md', import.meta.url);

function sqlFunctionBody(sql, functionName) {
	const start = sql.indexOf(`create or replace function public.${functionName}`);
	assert.notEqual(start, -1, `${functionName} should be present`);
	const end = sql.indexOf('\n$$;', start);
	assert.notEqual(end, -1, `${functionName} should terminate`);
	return sql.slice(start, end + 4);
}

function duplicateContactAdditionCount(changeSet) {
	const counts = new Map();
	for (const item of changeSet) {
		if (item.decision !== 'approved' || item.proposal_type !== 'addition') continue;
		const email = item.proposed_values?.email?.trim().toLowerCase();
		if (!email) continue;
		counts.set(email, (counts.get(email) ?? 0) + 1);
	}
	return [...counts.values()].filter((count) => count > 1).reduce((total, count) => total + count, 0);
}

function approvedAddition(rowNumber, email = 'Mark.Nesbit.Professional@gmail.com') {
	return {
		decision: 'approved',
		proposal_type: 'addition',
		source_row_number: rowNumber,
		proposed_values: {
			first_name: `Internal${rowNumber}`,
			last_name: 'Simulation',
			email,
			workspace_role: rowNumber % 2 === 0 ? 'member' : 'viewer',
		},
	};
}

test('WT-007 resolves shared-contact eligibility through the existing immutable internal workspace policy', async () => {
	const applicationSql = await readFile(applicationMigrationUrl, 'utf8');
	const policySql = await readFile(policyMigrationUrl, 'utf8');
	const body = sqlFunctionBody(applicationSql, 'apply_workspace_membership_change_set');

	assert.match(policySql, /create or replace function public\.internal_test_workspace_slug\(\)/);
	assert.match(policySql, /select 'mark-nesbit-professional-workspace'::text/);
	assert.match(policySql, /create or replace function public\.is_internal_role_simulation_workspace\(target_organisation_id uuid\)/);
	assert.match(applicationSql, /v_shared_contact_exception_enabled := coalesce\(public\.is_internal_role_simulation_workspace\(p_organisation_id\), false\)/);
	assert.match(applicationSql, /v_shared_contact_policy_source := 'public\.is_internal_role_simulation_workspace'/);
	assert.doesNotMatch(body, /from public\.organisations|\.slug\b|\.name\b/i);
	assert.doesNotMatch(body, /workspace_name|workspace_slug|organisation_name|organisation_slug/i);
});

test('WT-007 keeps normal workspace duplicate contact email as a blocking transactional error', async () => {
	const sql = await readFile(applicationMigrationUrl, 'utf8');

	assert.match(sql, /if v_duplicate_count > 0 and not v_shared_contact_exception_enabled then\s+v_failure_code := 'duplicate_addition_contact_email'/);
	assert.match(sql, /Approved additions contain duplicate contact email values/);
	assert.match(sql, /if not v_shared_contact_exception_enabled and exists \(\s+select 1\s+from public\.organisation_members as om\s+join public\.profiles as p on p\.id = om\.user_id[\s\S]*lower\(coalesce\(p\.contact_email, ''\)\) = v_contact_email/);
	assert.match(sql, /v_failure_code := 'duplicate_contact_email'/);
	assert.match(sql, /status = 'application_failed_pending_review'/);
	assert.match(sql, /return v_application\.id/);
});

test('WT-007 allows internal duplicate contact email while preserving separate identities and handoffs', async () => {
	const sql = await readFile(applicationMigrationUrl, 'utf8');
	const sharedContactSet = Array.from({ length: 28 }, (_, index) => approvedAddition(index + 1));
	const excludedRows = [
		{ ...approvedAddition(29), decision: 'excluded' },
		{ ...approvedAddition(30), decision: 'excluded' },
	];

	assert.equal(duplicateContactAdditionCount(sharedContactSet), 28);
	assert.equal(duplicateContactAdditionCount([...sharedContactSet, ...excludedRows]), 28);
	assert.match(sql, /v_shared_contact_addition_count := coalesce\(v_shared_contact_addition_count, 0\)/);
	assert.match(sql, /'shared_contact_exception_applied', v_shared_contact_exception_enabled and v_shared_contact_addition_count > 0/);
	assert.match(sql, /'shared_contact_policy_source', v_shared_contact_policy_source/);
	assert.match(sql, /'shared_contact_addition_count', v_shared_contact_addition_count/);
	assert.match(sql, /v_new_profile_id := gen_random_uuid\(\)/);
	assert.match(sql, /v_login_name := public\.workspace_profile_next_login_name\(v_display_name, v_new_profile_id\)/);
	assert.match(sql, /v_auth_email := public\.workspace_membership_pending_auth_email\(v_login_name, v_new_profile_id\)/);
	assert.match(sql, /insert into auth\.users/);
	assert.match(sql, /insert into public\.profiles/);
	assert.match(sql, /insert into public\.organisation_members/);
	assert.match(sql, /insert into public\.workspace_membership_invitation_handoffs/);
	assert.match(sql, /v_additions := v_additions \+ 1/);
	assert.match(sql, /v_handoffs := v_handoffs \+ 1/);
	assert.match(sql, /where approved\.value->>'decision' = 'approved'/);
	assert.doesNotMatch(sql, /inviteUserByEmail|generateLink|auth\.admin|confirmation_token|recovery_token/i);
});

test('WT-007 never uses contact email to resolve or reuse profile identity', async () => {
	const sql = await readFile(applicationMigrationUrl, 'utf8');
	const body = sqlFunctionBody(sql, 'apply_workspace_membership_change_set');

	assert.match(body, /v_new_profile_id := gen_random_uuid\(\)/);
	assert.match(body, /insert into public\.profiles \(/);
	assert.match(body, /values \(\s+v_new_profile_id,/);
	assert.doesNotMatch(body, /select\s+\*\s+into\s+v_profile[\s\S]{0,280}contact_email/i);
	assert.doesNotMatch(body, /select\s+id\s+into\s+v_new_profile_id[\s\S]{0,280}contact_email/i);
	assert.doesNotMatch(body, /from auth\.users[\s\S]{0,280}v_contact_email/i);
	assert.doesNotMatch(body, /where\s+[^;]*(?:email|contact_email)\s*=\s*v_contact_email[\s\S]{0,120}returning/i);
});

test('WT-007 preserves rollback and approved-set recovery without CSV re-upload', async () => {
	const sql = await readFile(applicationMigrationUrl, 'utf8');
	const teamPage = await readFile(teamPageUrl, 'utf8');
	const reviewPage = await readFile(reviewPageUrl, 'utf8');

	assert.match(sql, /exception\s+when others then/);
	assert.match(sql, /transaction_rolled_back/);
	assert.match(sql, /No partial membership changes were committed/);
	assert.match(sql, /application_failed_pending_review/);
	assert.match(sql, /'shared_contact_exception_applied', v_shared_contact_exception_enabled and v_shared_contact_addition_count > 0/);
	assert.match(teamPage, /application_failed_pending_review/);
	assert.match(teamPage, /Re-review approved changes/);
	assert.match(reviewPage, /reconfirm_workspace_membership_approved_change_set/);
	assert.match(reviewPage, /No CSV re-upload is required while the proposals remain valid/);
});

test('WT-007 shared-contact documentation records normal and internal behaviour', async () => {
	const docs = await readFile(docsUrl, 'utf8');
	const schemaDocs = await readFile(schemaDocsUrl, 'utf8');

	assert.match(docs, /public\.is_internal_role_simulation_workspace/);
	assert.match(docs, /duplicate contact email remains a blocking application error/);
	assert.match(docs, /28 approved additions/);
	assert.match(docs, /28 distinct profiles/);
	assert.match(docs, /28 distinct memberships/);
	assert.match(docs, /28 invitation handoff records/);
	assert.match(docs, /Invitation delivery remains separate/);
	assert.match(schemaDocs, /shared_contact_exception_applied/);
	assert.match(schemaDocs, /email is never used as identity/);
	assert.match(schemaDocs, /production migration deployment is required/);
});
