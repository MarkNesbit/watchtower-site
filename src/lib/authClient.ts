import { supabase } from './supabaseClient';

export function deriveDisplayName(email: string): string {
	const localPart = email.split('@')[0] ?? '';
	const displayName = localPart
		.replace(/[._+-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\b\w/g, (letter) => letter.toUpperCase());

	return displayName || 'WatchTower User';
}

export async function recordAuthAuditEvent(action: string, metadata: Record<string, unknown> = {}) {
	await supabase.rpc('record_auth_audit_event', {
		action_name: action,
		event_metadata: metadata,
	});
}
