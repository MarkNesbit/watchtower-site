import { supabase } from './supabaseClient';

export type AuthSessionStatus = 'unknown' | 'signed-in' | 'signed-out';

export async function getCurrentSession() {
	return supabase.auth.getSession();
}

export async function getAuthSessionStatus(): Promise<AuthSessionStatus> {
	const { data } = await getCurrentSession();

	return data.session ? 'signed-in' : 'signed-out';
}
