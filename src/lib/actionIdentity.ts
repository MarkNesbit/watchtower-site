import type { WorkspaceRole } from './permissions.ts';
import { listWorkspacePeople, type WorkspacePerson } from './workspacePeople.ts';

export type ActionIdentityFailure = 'unauthenticated' | 'profile_not_found' | 'membership_not_found' | 'ambiguous_membership' | 'inactive_membership' | 'workspace_mismatch';

export class ActionIdentityResolutionError extends Error {
	readonly reason: ActionIdentityFailure;
	constructor(reason: ActionIdentityFailure) {
		super(`Action identity resolution failed: ${reason}.`);
		this.reason = reason;
	}
}

export type ActionIdentity = {
	authUserId: string;
	profileId: string;
	membershipId: string;
	organisationId: string;
	workspaceRole: WorkspaceRole | string | null;
	membershipStatus: string;
	lifecycleEligible: boolean;
	person: WorkspacePerson;
};

export async function resolveActionIdentity(
	client,
	organisationId: string,
	options: { authUserId?: string | null; requireEligible?: boolean } = {},
): Promise<ActionIdentity> {
	const authUserId = options.authUserId ?? (await client.auth.getUser()).data?.user?.id ?? null;
	if (!authUserId) throw new ActionIdentityResolutionError('unauthenticated');
	const candidates = (await listWorkspacePeople(organisationId, client)).filter((person) => person.authUserId === authUserId || (!person.authUserId && person.profileId === authUserId));
	if (candidates.length === 0) throw new ActionIdentityResolutionError('membership_not_found');
	if (candidates.length > 1) throw new ActionIdentityResolutionError('ambiguous_membership');
	const person = candidates[0];
	if (options.requireEligible !== false && !person.assignmentEligible) throw new ActionIdentityResolutionError('inactive_membership');
	return {
		authUserId,
		profileId: person.profileId,
		membershipId: person.membershipId,
		organisationId: person.workspaceId,
		workspaceRole: person.workspaceRole,
		membershipStatus: person.membershipStatus,
		lifecycleEligible: person.assignmentEligible,
		person,
	};
}

// Temporary compatibility: Action persistence remains profile-keyed until 001D.
export function actionLegacyProfileMatchesCaller(storedProfileId: string | null | undefined, identity: ActionIdentity | null | undefined): boolean {
	return Boolean(storedProfileId && identity?.lifecycleEligible && storedProfileId === identity.profileId);
}
