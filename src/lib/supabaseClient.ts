import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

function requirePublicEnv(name: string, value: string | undefined): string {
	if (value && value.trim().length > 0) {
		return value;
	}

	throw new Error(
		`Missing required Supabase environment variable: ${name}. ` +
			'Create .env.local from .env.example and add the value from the Supabase project settings.',
	);
}

export const supabase = createClient(
	requirePublicEnv('PUBLIC_SUPABASE_URL', supabaseUrl),
	requirePublicEnv('PUBLIC_SUPABASE_ANON_KEY', supabaseAnonKey),
);
