import type { AstroCookies } from 'astro';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

function requirePublicEnv(name: string, value: string | undefined): string {
	if (value && value.trim().length > 0) return value;
	throw new Error(`Missing required Supabase environment variable: ${name}.`);
}

export function getServerAccessToken(cookies: AstroCookies): string | undefined {
	return cookies.get('wt-access-token')?.value;
}

export function createSupabaseServerClient(accessToken?: string) {
	return createClient(
		requirePublicEnv('PUBLIC_SUPABASE_URL', supabaseUrl),
		requirePublicEnv('PUBLIC_SUPABASE_ANON_KEY', supabaseAnonKey),
		{
			auth: {
				autoRefreshToken: false,
				detectSessionInUrl: false,
				persistSession: false,
			},
			global: accessToken
				? {
					headers: {
						Authorization: `Bearer ${accessToken}`,
					},
				}
				: undefined,
		},
	);
}
