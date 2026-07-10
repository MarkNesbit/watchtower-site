import type { APIRoute } from 'astro';
import { buildProjectRiskPath } from '../../../../../../../lib/projects.ts';
import {
	createDraftProjectRisksFromPrompts,
	preflightDraftProjectRisksFromPrompts,
} from '../../../../../../../lib/projectRisks.ts';
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
	const mode = typeof body === 'object' && body && (body as { mode?: unknown }).mode === 'preflight'
		? 'preflight'
		: 'create';

	try {
		if (mode === 'preflight') {
			const result = await preflightDraftProjectRisksFromPrompts(
				params.workspaceSlug ?? '',
				params.projectId ?? '',
				promptIds,
				serverSupabase,
				accessToken,
			);
			return json({
				ok: true,
				mode,
				requestedCount: result.requestedCount,
				selectedPromptCount: result.selectedPromptCount,
				eligiblePromptCount: result.eligiblePromptCount,
				createableCount: result.createableCount,
				duplicateCount: result.duplicateCount,
				invalidPromptCount: result.invalidPromptCount,
				createablePrompts: result.createablePrompts.map((prompt) => ({
					riskPromptId: prompt.riskPromptId,
					title: prompt.title,
				})),
				duplicatePrompts: result.duplicatePrompts.map((prompt) => ({
					riskPromptId: prompt.riskPromptId,
					title: prompt.title,
					existingRiskId: prompt.existingRiskId,
					existingRiskRef: prompt.existingRiskRef,
					existingRiskTitle: prompt.existingRiskTitle,
					existingRiskPath: prompt.existingRiskId
						? buildProjectRiskPath(params.workspaceSlug ?? '', params.projectId ?? '', prompt.existingRiskId)
						: '',
				})),
			});
		}

		const result = await createDraftProjectRisksFromPrompts(
			params.workspaceSlug ?? '',
			params.projectId ?? '',
			promptIds,
			serverSupabase,
			accessToken,
		);
		return json({
			ok: true,
			mode,
			requestedCount: result.requestedCount,
			eligiblePromptCount: result.eligiblePromptCount,
			invalidPromptCount: result.invalidPromptCount,
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
