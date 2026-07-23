import type { APIRoute } from 'astro';
import { buildWorkspaceTeamPath, getWorkspaceBySlug } from '../../../../../../../lib/projects.ts';
import { isWorkspaceRole } from '../../../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../../../lib/supabaseServer.ts';

type SupabaseError = {
	code?: string;
	message?: string;
	details?: string;
	hint?: string;
};

type ApplicationRun = {
	id: string;
	status: string;
	failure_code: string | null;
};

function redirectToTeam(workspaceSlug: string, importRunId: string, params: Record<string, string>) {
	const query = new URLSearchParams({ import_run: importRunId, ...params });
	return new Response(null, {
		status: 303,
		headers: {
			location: `${buildWorkspaceTeamPath(workspaceSlug)}?${query.toString()}`,
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

function applicationRedirectState(applicationRun: ApplicationRun | null) {
	if (applicationRun?.status === 'applied') return { membership_application: 'success' };
	if (applicationRun?.status === 'already_applied') return { membership_application: 'already_applied' };
	if (applicationRun?.status === 'drift_detected') {
		return {
			membership_application: 'error',
			membership_application_error: 'drift_detected',
		};
	}
	return {
		membership_application: 'error',
		membership_application_error: applicationRun?.failure_code || 'failed',
	};
}

function applicationErrorCode(error: SupabaseError) {
	const text = [error.message, error.details, error.hint].filter(Boolean).join(' ');
	if (/WT_MEMBERSHIP_PERMISSION_DENIED|permission denied/i.test(text)) return 'permission_denied';
	if (/WT_MEMBERSHIP_IMPORT_NOT_FOUND/i.test(text)) return 'import_not_found';
	if (/WT_MEMBERSHIP_APPLICATION_STATUS/i.test(text)) return 'not_ready';
	if (/WT_MEMBERSHIP_APPLICATION_SOURCE_SUPERSEDED/i.test(text)) return 'superseded';
	if (/WT_MEMBERSHIP_APPLICATION_SNAPSHOT_DRIFT/i.test(text)) return 'drift_detected';
	if (/WT_MEMBERSHIP_APPLICATION_DECISION_DRIFT/i.test(text)) return 'decision_drift';
	if (/WT_MEMBERSHIP_APPLICATION_TARGET_DRIFT/i.test(text)) return 'target_drift';
	return 'failed';
}

export const POST: APIRoute = async ({ cookies, params, request }) => {
	const workspaceSlug = params.workspaceSlug ?? '';
	const importRunId = params.importRunId ?? '';
	const accessToken = getServerAccessToken(cookies);
	if (!accessToken) return redirectToTeam(workspaceSlug, importRunId, {
		membership_application: 'error',
		membership_application_error: 'signin',
	});

	const serverSupabase = createSupabaseServerClient(accessToken);
	const workspace = await getWorkspaceBySlug(serverSupabase, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation || !isWorkspaceRole(workspace.role)) {
		return redirectToTeam(workspaceSlug, importRunId, {
			membership_application: 'error',
			membership_application_error: 'workspace',
		});
	}
	if (workspace.role !== 'owner' && workspace.role !== 'admin') {
		return redirectToTeam(workspaceSlug, importRunId, {
			membership_application: 'error',
			membership_application_error: 'permission',
		});
	}

	const formData = await request.formData();
	const operationKey = String(formData.get('operation_key') ?? '').trim() || crypto.randomUUID();
	const { data: actorData } = await serverSupabase.auth.getUser(accessToken);
	const actorId = actorData.user?.id ?? null;

	const { data: applicationRunId, error } = await serverSupabase.rpc('apply_workspace_membership_change_set', {
		p_organisation_id: organisation.id,
		p_import_run_id: importRunId,
		p_operation_key: operationKey,
	});

	if (error || !applicationRunId) {
		console.error('workspace_team_membership_application_failed', {
			routeName: 'workspace_team_membership_application',
			workspaceId: organisation.id,
			importRunId,
			actorId,
			rpcName: 'apply_workspace_membership_change_set',
			code: error?.code,
			message: error?.message,
			details: error?.details,
			hint: error?.hint,
		});
		return redirectToTeam(workspaceSlug, importRunId, {
			membership_application: 'error',
			membership_application_error: error ? applicationErrorCode(error) : 'failed',
		});
	}

	const { data: runData, error: runError } = await serverSupabase
		.from('workspace_membership_change_application_runs')
		.select('id, status, failure_code')
		.eq('organisation_id', organisation.id)
		.eq('import_run_id', importRunId)
		.eq('id', String(applicationRunId))
		.maybeSingle();

	if (runError) {
		console.error('workspace_team_membership_application_result_lookup_failed', {
			routeName: 'workspace_team_membership_application',
			workspaceId: organisation.id,
			importRunId,
			applicationRunId,
			actorId,
			code: runError.code,
			message: runError.message,
			details: runError.details,
			hint: runError.hint,
		});
		return redirectToTeam(workspaceSlug, importRunId, {
			membership_application: 'error',
			membership_application_error: 'result_lookup_failed',
		});
	}

	return redirectToTeam(workspaceSlug, importRunId, applicationRedirectState(runData as ApplicationRun | null));
};

export const GET: APIRoute = async ({ params }) => redirectToTeam(
	params.workspaceSlug ?? '',
	params.importRunId ?? '',
	{
		membership_application: 'error',
		membership_application_error: 'method',
	},
);
