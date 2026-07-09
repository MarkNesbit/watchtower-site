import type { SupabaseClient } from '@supabase/supabase-js';

export type RiskPromptLibrarySummary = {
	id: string;
	risk_library_key: string;
	risk_library_version: string;
	name: string;
	description: string | null;
	is_default: boolean;
	is_active: boolean;
	activeAreaCount: number;
	activePromptCount: number;
};

const countRows = (data: unknown): number => Array.isArray(data) ? data.length : 0;

export async function getDefaultRiskPromptLibrarySummary(client: SupabaseClient): Promise<RiskPromptLibrarySummary | null> {
	const { data: library, error: libraryError } = await client
		.from('risk_prompt_libraries')
		.select('id, risk_library_key, risk_library_version, name, description, is_default, is_active')
		.eq('is_default', true)
		.eq('is_active', true)
		.order('risk_library_version', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (libraryError) throw libraryError;
	if (!library) return null;

	const [areaResult, promptResult] = await Promise.all([
		client
			.from('risk_prompt_areas')
			.select('id')
			.eq('risk_prompt_library_id', library.id)
			.eq('is_active', true),
		client
			.from('risk_prompts')
			.select('id')
			.eq('risk_prompt_library_id', library.id)
			.eq('risk_prompt_is_active', true),
	]);

	if (areaResult.error) throw areaResult.error;
	if (promptResult.error) throw promptResult.error;

	return {
		...library,
		activeAreaCount: countRows(areaResult.data),
		activePromptCount: countRows(promptResult.data),
	};
}
