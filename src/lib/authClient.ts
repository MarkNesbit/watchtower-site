import { supabase } from './supabaseClient';
import { AUTH_SESSION_COOKIE } from './authConstants';

export function deriveDisplayName(email: string): string {
	const localPart = email.split('@')[0] ?? '';
	const displayName = localPart
		.replace(/[._+-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\b\w/g, (letter) => letter.toUpperCase());

	return displayName || 'WatchTower User';
}

export function setSessionCookie(isSignedIn: boolean) {
	document.cookie = `${AUTH_SESSION_COOKIE}=${isSignedIn ? 'signed-in' : ''}; Path=/; SameSite=Lax; Max-Age=${isSignedIn ? 60 * 60 * 24 * 7 : 0}`;
}

export async function refreshSessionCookie() {
	const { data } = await supabase.auth.getSession();
	setSessionCookie(Boolean(data.session));
	return data.session;
}

export async function recordAuthAuditEvent(action: string, metadata: Record<string, unknown> = {}) {
	await supabase.rpc('record_auth_audit_event', {
		action_name: action,
		event_metadata: metadata,
	});
}
