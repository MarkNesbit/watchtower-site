import type { APIRoute } from 'astro';
import { createDraftProjectRisksFromPrompts } from '../../../../../../../lib/projectRisks.ts';
import {
	buildLoginRedirectPath,
	createSupabaseServerClient,
	getServerAccessToken,
	isSupabaseAuthSessionError,
} from '../../../../../../../lib/supabaseServer.ts';

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
	status,
	headers: {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	},
});

export const POST: APIRoute = async ({ cookies, params, request, url }) => {
	const accessToken = getServerAccessToken(cookies);
	const serverSupabase = createSupabaseServerClient(accessToken);
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		return json({ ok: false, message: 'Select at least one risk prompt.' }, 400);
	}

	const promptIds = typeof body === 'object' && body && Array.isArray((body as { riskPromptIds?: unknown }).riskPromptIds)
		? (body as { riskPromptIds: unknown[] }).riskPromptIds.filter((value): value is string => typeof value === 'string')
		: [];

	try {
		const result = await createDraftProjectRisksFromPrompts(
			params.workspaceSlug ?? '',
			params.projectId ?? '',
			promptIds,
			serverSupabase,
			accessToken,
		);
		return json({
			ok: true,
			requestedCount: result.requestedCount,
			eligiblePromptCount: result.eligiblePromptCount,
			createdCount: result.createdCount,
			skippedDuplicateCount: result.skippedDuplicateCount,
			createdRiskRefs: result.createdRisks.map((risk) => risk.risk_ref),
		});
	} catch (error) {
		if (isSupabaseAuthSessionError(error)) {
			return json({
				ok: false,
				message: 'Your session has expired. Please sign in again to continue.',
				loginPath: buildLoginRedirectPath(url.pathname),
			}, 401);
		}
		const message = error instanceof Error ? error.message : 'Unable to create draft risks from the selected prompts.';
		const status = message.toLowerCase().includes('permission') || message.toLowerCase().includes('role') ? 403 : 400;
		return json({ ok: false, message }, status);
	}
};
