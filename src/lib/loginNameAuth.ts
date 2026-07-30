export const LOGIN_NAME_AUTH_ERROR_MESSAGE = 'Login name or password is incorrect.';

export type LoginNameResolutionStatus =
	| 'resolved'
	| 'malformed_login_name'
	| 'profile_not_found'
	| 'ambiguous_login_name'
	| 'auth_identity_missing'
	| 'auth_account_invalid'
	| 'no_active_membership';

export type LoginNameResolutionSuccess = {
	status: 'resolved';
	authUserId: string;
	authEmail: string;
	profileId: string;
	activeMembershipCount: number;
};

export type LoginNameResolutionFailure = {
	status: Exclude<LoginNameResolutionStatus, 'resolved'>;
	candidateCount?: number;
	activeMembershipCount?: number;
};

export type LoginNameResolutionResult = LoginNameResolutionSuccess | LoginNameResolutionFailure;

type ProfileRow = {
	id?: string | null;
	auth_user_id?: string | null;
};

type AuthUser = {
	id?: string | null;
	email?: string | null;
};

const LOGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseLoginNameInput(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const loginName = value.trim().toLowerCase();
	if (!LOGIN_NAME_PATTERN.test(loginName)) return null;
	return loginName;
}

function cleanAuthEmail(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const email = value.trim().toLowerCase();
	if (!EMAIL_PATTERN.test(email)) return null;
	return email;
}

async function loadActiveMembershipCount(adminClient, authUserId: string) {
	const { data, error } = await adminClient
		.from('organisation_members')
		.select('id')
		.eq('status', 'active')
		.or(`auth_user_id.eq.${authUserId},and(auth_user_id.is.null,user_id.eq.${authUserId})`)
		.limit(2);

	if (error) throw error;
	return data?.length ?? 0;
}

export async function resolveLoginNameAuthIdentity(adminClient, rawLoginName: unknown): Promise<LoginNameResolutionResult> {
	const loginName = normaliseLoginNameInput(rawLoginName);
	if (!loginName) return { status: 'malformed_login_name' };

	const { data: profiles, error: profileError } = await adminClient
		.from('profiles')
		.select('id, auth_user_id')
		.eq('login_name', loginName)
		.limit(2);

	if (profileError) throw profileError;
	const candidateCount = profiles?.length ?? 0;
	if (candidateCount === 0) return { status: 'profile_not_found', candidateCount };
	if (candidateCount !== 1) return { status: 'ambiguous_login_name', candidateCount };

	const profile = profiles[0] as ProfileRow;
	if (!profile.id || !profile.auth_user_id) return { status: 'auth_identity_missing', candidateCount };

	const activeMembershipCount = await loadActiveMembershipCount(adminClient, profile.auth_user_id);
	if (activeMembershipCount < 1) return { status: 'no_active_membership', candidateCount, activeMembershipCount };

	const { data: authUserData, error: authUserError } = await adminClient.auth.admin.getUserById(profile.auth_user_id);
	const authUser = authUserData?.user as AuthUser | undefined;
	const authEmail = cleanAuthEmail(authUser?.email);
	if (authUserError || authUser?.id !== profile.auth_user_id || !authEmail) {
		return { status: 'auth_account_invalid', candidateCount, activeMembershipCount };
	}

	return {
		status: 'resolved',
		authUserId: profile.auth_user_id,
		authEmail,
		profileId: profile.id,
		activeMembershipCount,
	};
}

export function safeLoginDiagnostic(details: LoginNameResolutionResult | { status: string }) {
	return {
		status: details.status,
		candidateCount: 'candidateCount' in details ? details.candidateCount ?? null : null,
		activeMembershipCount: 'activeMembershipCount' in details ? details.activeMembershipCount ?? null : null,
	};
}
