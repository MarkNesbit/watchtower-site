import type { AstroCookies } from 'astro';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env?.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env?.PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = import.meta.env?.SUPABASE_SERVICE_ROLE_KEY;
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again to continue.';

function requirePublicEnv(name: string, value: string | undefined): string {
	if (value && value.trim().length > 0) return value;
	throw new Error(`Missing required Supabase environment variable: ${name}.`);
}

function runtimeString(env: Record<string, unknown> | undefined, name: string, fallback: string | undefined): string | undefined {
	const value = env?.[name];
	return typeof value === 'string' ? value : fallback;
}

function requireSecretEnv(name: string, value: string | undefined): string {
	if (value && value.trim().length > 0) return value;
	throw new Error(`Missing required Supabase server secret: ${name}.`);
}

export function getServerAccessToken(cookies: AstroCookies): string | undefined {
	return cookies.get('wt-access-token')?.value;
}

export function buildLoginRedirectPath(pathname = '/app'): string {
	return `/login?redirectTo=${encodeURIComponent(pathname)}`;
}

export function isSupabaseAuthSessionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? '');
	const normalised = message.toLowerCase();
	return (
		normalised.includes('invalid jwt') ||
		normalised.includes('jwt expired') ||
		normalised.includes('token is expired') ||
		normalised.includes('token has invalid claims') ||
		normalised.includes('auth session missing')
	);
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

export function createSupabaseAdminClient(env?: Record<string, unknown>) {
	return createClient(
		requirePublicEnv('PUBLIC_SUPABASE_URL', runtimeString(env, 'PUBLIC_SUPABASE_URL', supabaseUrl)),
		requireSecretEnv('SUPABASE_SERVICE_ROLE_KEY', runtimeString(env, 'SUPABASE_SERVICE_ROLE_KEY', supabaseServiceRoleKey)),
		{
			auth: {
				autoRefreshToken: false,
				detectSessionInUrl: false,
				persistSession: false,
			},
		},
	);
}
