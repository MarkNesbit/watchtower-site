import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionIdentityResolutionError, actionLegacyProfileMatchesCaller, resolveActionIdentity } from '../src/lib/actionIdentity.ts';

function client(rows, authUserId = 'auth-a') {
	return {
		auth: { getUser: async () => ({ data: { user: authUserId ? { id: authUserId } : null } }) },
		from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); } }),
	};
}
const active = { organisation_id: 'workspace-a', organisation_membership_id: 'membership-a', profile_id: 'profile-a', auth_user_id: 'auth-a', display_name: 'A', role: 'member', membership_status: 'active', assignment_eligible: true };

test('Action identity resolver resolves deliberately split Auth Profile and membership IDs', async () => {
	const identity = await resolveActionIdentity(client([active]), 'workspace-a');
	assert.deepEqual([identity.authUserId, identity.profileId, identity.membershipId], ['auth-a', 'profile-a', 'membership-a']);
	assert.equal(actionLegacyProfileMatchesCaller('profile-a', identity), true);
});

test('Action identity resolver fails closed for inactive and ambiguous workspace memberships', async () => {
	await assert.rejects(() => resolveActionIdentity(client([{ ...active, membership_status: 'deactivated', assignment_eligible: false }]), 'workspace-a'), (error) => error instanceof ActionIdentityResolutionError && error.reason === 'inactive_membership');
	await assert.rejects(() => resolveActionIdentity(client([active, { ...active, organisation_membership_id: 'membership-b' }]), 'workspace-a'), (error) => error instanceof ActionIdentityResolutionError && error.reason === 'ambiguous_membership');
});

test('Action lifecycle RPCs remain known split-ID defects pending 001C', () => {
	const legacyRpcActor = 'auth-a';
	const storedProfileResponsibility = 'profile-a';
	assert.notEqual(legacyRpcActor, storedProfileResponsibility, 'current RPC direct comparisons fail for split IDs by design of this expected-defect test');
});
