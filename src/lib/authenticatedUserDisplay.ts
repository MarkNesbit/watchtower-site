export type AuthenticatedUserDisplayProfile = {
	first_name?: string | null;
	last_name?: string | null;
	display_name?: string | null;
	login_name?: string | null;
};

export const AUTHENTICATED_USER_DISPLAY_FALLBACK = 'Signed-in user';

function cleanProfileText(value: unknown): string {
	return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function authenticatedUserDisplayName(profile: AuthenticatedUserDisplayProfile | null | undefined): string {
	const firstName = cleanProfileText(profile?.first_name);
	const lastName = cleanProfileText(profile?.last_name);
	const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

	return fullName
		|| cleanProfileText(profile?.display_name)
		|| cleanProfileText(profile?.login_name)
		|| AUTHENTICATED_USER_DISPLAY_FALLBACK;
}
