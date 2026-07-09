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

export type RiskPromptForSelection = {
	id: string;
	risk_prompt_id: string;
	risk_prompt_title: string;
	risk_prompt_guidance: string;
	risk_prompt_order: number;
};

export type RiskPromptAreaForSelection = {
	id: string;
	risk_area_key: string;
	risk_area_title: string;
	risk_area_order: number;
	prompts: RiskPromptForSelection[];
};

export type RiskPromptLibraryForSelection = {
	id: string;
	risk_library_key: string;
	risk_library_version: string;
	name: string;
	areas: RiskPromptAreaForSelection[];
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

export async function getDefaultRiskPromptLibraryForSelection(client: SupabaseClient): Promise<RiskPromptLibraryForSelection | null> {
	const { data: library, error: libraryError } = await client
		.from('risk_prompt_libraries')
		.select('id, risk_library_key, risk_library_version, name')
		.eq('is_default', true)
		.eq('is_active', true)
		.order('risk_library_version', { ascending: false })
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (libraryError) throw libraryError;
	if (!library) return null;

	const { data: areas, error: areaError } = await client
		.from('risk_prompt_areas')
		.select('id, risk_area_key, risk_area_title, risk_area_order')
		.eq('risk_prompt_library_id', library.id)
		.eq('is_active', true)
		.order('risk_area_order', { ascending: true })
		.order('risk_area_key', { ascending: true });

	if (areaError) throw areaError;

	const activeAreas = Array.isArray(areas) ? areas : [];
	if (activeAreas.length === 0) {
		return { ...library, areas: [] };
	}

	const { data: prompts, error: promptError } = await client
		.from('risk_prompts')
		.select('id, risk_prompt_area_id, risk_prompt_id, risk_prompt_title, risk_prompt_guidance, risk_prompt_order')
		.eq('risk_prompt_library_id', library.id)
		.eq('risk_prompt_is_active', true)
		.order('risk_prompt_order', { ascending: true })
		.order('risk_prompt_id', { ascending: true });

	if (promptError) throw promptError;

	const promptsByAreaId = new Map<string, RiskPromptForSelection[]>();
	for (const prompt of Array.isArray(prompts) ? prompts : []) {
		const areaPrompts = promptsByAreaId.get(prompt.risk_prompt_area_id) ?? [];
		areaPrompts.push({
			id: prompt.id,
			risk_prompt_id: prompt.risk_prompt_id,
			risk_prompt_title: prompt.risk_prompt_title,
			risk_prompt_guidance: prompt.risk_prompt_guidance,
			risk_prompt_order: prompt.risk_prompt_order,
		});
		promptsByAreaId.set(prompt.risk_prompt_area_id, areaPrompts);
	}

	return {
		...library,
		areas: activeAreas.map((area) => ({
			...area,
			prompts: promptsByAreaId.get(area.id) ?? [],
		})),
	};
}
