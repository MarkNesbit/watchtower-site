import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { buildWorkspaceTeamPath, getWorkspaceBySlug } from '../../../../../../lib/projects.ts';
import { isWorkspaceRole } from '../../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../../lib/supabaseServer.ts';
import {
	sendWorkspaceInvitationEmail,
	workspaceInvitationEmailConfigDiagnostics,
	type InvitationDeliveryEnv,
} from '../../../../../../lib/workspaceInvitationDelivery.ts';
import {
	generateInvitationToken,
	hashInvitationToken,
	summariseInvitationSendResults,
	type InvitationDeliveryResult,
	type PreparedInvitation,
} from '../../../../../../lib/workspaceInvitations.ts';
import { workspaceRoleLabel } from '../../../../../../lib/workspaceTeam.ts';

type SupabaseError = {
	code?: string;
	message?: string;
	details?: string;
	hint?: string;
};

type DirectoryRow = {
	organisation_membership_id: string;
	profile_id: string;
	first_name: string | null;
	last_name: string | null;
	display_name: string | null;
	login_name: string | null;
	role: string | null;
	invitation_status: string | null;
	invitation_expires_at: string | null;
};

type DeliveryClaimRow = {
	should_send?: boolean | null;
	status?: string | null;
	failure_code?: string | null;
	failure_message?: string | null;
};

function redirectToTeam(workspaceSlug: string, params: Record<string, string>) {
	const query = new URLSearchParams(params);
	return new Response(null, {
		status: 303,
		headers: {
			location: `${buildWorkspaceTeamPath(workspaceSlug)}?${query.toString()}`,
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

function invitationErrorCode(error: SupabaseError | null | undefined) {
	const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
	if (/WT_MEMBERSHIP_PERMISSION_DENIED|permission denied/i.test(text)) return 'permission_denied';
	if (/WT_INVITATION_NOT_FOUND/i.test(text)) return 'not_found';
	if (/retry_requires_new_operation_key/i.test(text)) return 'retry_requires_new_operation_key';
	if (/shared_contact_policy_required/i.test(text)) return 'shared_contact_policy_required';
	return 'failed';
}

function personName(row: DirectoryRow) {
	const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
	return fullName || row.display_name || row.login_name || 'Workspace user';
}

function logInvitationDeliveryOperationError(eventName: string, workspaceId: string, invitationId: string | null, error: SupabaseError | Error | unknown) {
	const supabaseError = error as SupabaseError;
	console.error(eventName, {
		routeName: 'workspace_team_invitation_send',
		workspaceId,
		invitationId,
		code: supabaseError?.code,
		message: error instanceof Error ? error.message : supabaseError?.message,
		details: supabaseError?.details,
		hint: supabaseError?.hint,
	});
}

async function eligibleMembershipIds(client, organisationId: string) {
	const { data, error } = await client
		.from('workspace_member_admin_directory')
		.select('organisation_membership_id, invitation_status, membership_status')
		.eq('organisation_id', organisationId)
		.in('membership_status', ['invited', 'invite_expired']);
	if (error) throw error;
	return (data ?? [])
		.filter((row) => (
			!row.invitation_status
			|| ['pending_delivery', 'delivery_failed', 'expired', 'cancelled', 'superseded'].includes(String(row.invitation_status))
		))
		.map((row) => row.organisation_membership_id);
}

async function markDeliveryResult(client, result: InvitationDeliveryResult) {
	const { error } = await client.rpc('record_workspace_membership_invitation_delivery_result', {
		p_invitation_id: result.invitationId,
		p_delivery_status: result.status,
		p_failure_code: result.failureCode ?? null,
		p_failure_message: result.failureMessage ?? null,
		p_email_provider: result.providerName ?? null,
		p_provider_message_id: result.providerMessageId ?? null,
	});
	if (error) throw error;
}

async function claimDeliveryAttempt(client, invitationId: string, operationKey: string): Promise<DeliveryClaimRow> {
	const { data, error } = await client.rpc('begin_workspace_membership_invitation_delivery_attempt', {
		p_invitation_id: invitationId,
		p_delivery_operation_key: operationKey,
	});
	if (error) throw error;
	const rows = (data ?? []) as DeliveryClaimRow[];
	return rows[0] ?? { should_send: false, status: 'delivery_failed', failure_code: 'delivery_claim_failed', failure_message: 'Invitation delivery could not be claimed safely.' };
}

export const POST: APIRoute = async ({ cookies, params, request, url }) => {
	const workspaceSlug = params.workspaceSlug ?? '';
	const invitationDeliveryEnv = env as InvitationDeliveryEnv;
	const accessToken = getServerAccessToken(cookies);
	if (!accessToken) {
		return redirectToTeam(workspaceSlug, {
			invitation_delivery: 'error',
			invitation_delivery_error: 'signin',
		});
	}

	const serverSupabase = createSupabaseServerClient(accessToken);
	const workspace = await getWorkspaceBySlug(serverSupabase, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation || !isWorkspaceRole(workspace.role)) {
		return redirectToTeam(workspaceSlug, {
			invitation_delivery: 'error',
			invitation_delivery_error: 'workspace',
		});
	}
	if (workspace.role !== 'owner' && workspace.role !== 'admin') {
		return redirectToTeam(workspaceSlug, {
			invitation_delivery: 'error',
			invitation_delivery_error: 'permission',
		});
	}

	const formData = await request.formData();
	const submittedAction = String(formData.get('invitation_action') ?? 'send').trim();
	const requestedAction = ['send', 'resend', 'retry', 'cancel'].includes(submittedAction) ? submittedAction : 'send';
	const submittedOperationKey = String(formData.get('operation_key') ?? '').trim();
	const retryOperationKey = String(formData.get('retry_operation_key') ?? '').trim();
	const operationKey = requestedAction === 'retry'
		? retryOperationKey || crypto.randomUUID()
		: submittedOperationKey || crypto.randomUUID();

	if (requestedAction === 'cancel') {
		const invitationId = String(formData.get('invitation_id') ?? '').trim();
		if (!invitationId) {
			return redirectToTeam(workspaceSlug, {
				invitation_delivery: 'error',
				invitation_delivery_error: 'missing_invitation',
			});
		}
		const { error } = await serverSupabase.rpc('cancel_workspace_membership_invitation', {
			p_organisation_id: organisation.id,
			p_invitation_id: invitationId,
		});
		if (error) {
			console.error('workspace_team_invitation_cancel_failed', {
				routeName: 'workspace_team_invitation_send',
				workspaceId: organisation.id,
				invitationId,
				code: error.code,
				message: error.message,
				details: error.details,
				hint: error.hint,
			});
			return redirectToTeam(workspaceSlug, {
				invitation_delivery: 'error',
				invitation_delivery_error: invitationErrorCode(error),
			});
		}
		return redirectToTeam(workspaceSlug, { invitation_delivery: 'cancelled' });
	}

	let membershipIds = formData.getAll('membership_id').map((value) => String(value).trim()).filter(Boolean);
	if (membershipIds.length === 0 && String(formData.get('scope') ?? '') === 'eligible') {
		membershipIds = await eligibleMembershipIds(serverSupabase, organisation.id);
	}
	if (membershipIds.length === 0) {
		return redirectToTeam(workspaceSlug, {
			invitation_delivery: 'error',
			invitation_delivery_error: 'empty_selection',
		});
	}

	const tokenByMembership = new Map<string, string>();
	const tokenHashes: Record<string, string> = {};
	for (const membershipId of membershipIds) {
		const token = generateInvitationToken();
		tokenByMembership.set(membershipId, token);
		tokenHashes[membershipId] = await hashInvitationToken(token);
	}

	const { data, error } = await serverSupabase.rpc('prepare_workspace_membership_invitations', {
		p_organisation_id: organisation.id,
		p_membership_ids: membershipIds,
		p_idempotency_key: operationKey,
		p_token_hashes: tokenHashes,
		p_request_intent: requestedAction,
	});

	if (error) {
		console.error('workspace_team_invitation_prepare_failed', {
			routeName: 'workspace_team_invitation_send',
			workspaceId: organisation.id,
			action: requestedAction,
			code: error.code,
			message: error.message,
			details: error.details,
			hint: error.hint,
		});
		return redirectToTeam(workspaceSlug, {
			invitation_delivery: 'error',
			invitation_delivery_error: invitationErrorCode(error),
		});
	}

	const prepared = (data ?? []) as PreparedInvitation[];
	const deliverable = prepared.filter((invitation) => invitation.status === 'pending_delivery');
	const deliveryResults: InvitationDeliveryResult[] = prepared
		.filter((invitation) => invitation.status === 'delivery_failed')
		.map((invitation) => ({
			invitationId: invitation.invitation_id,
			membershipId: invitation.membership_id,
			status: 'delivery_failed',
			failureCode: invitation.failure_code ?? 'preparation_failed',
			failureMessage: invitation.failure_message ?? 'Invitation could not be prepared.',
		}));

	const { data: directoryData, error: directoryError } = deliverable.length > 0
		? await serverSupabase
			.from('workspace_member_admin_directory')
			.select('organisation_membership_id, profile_id, first_name, last_name, display_name, login_name, role, invitation_status, invitation_expires_at')
			.eq('organisation_id', organisation.id)
			.in('organisation_membership_id', deliverable.map((invitation) => invitation.membership_id))
		: { data: [], error: null };
	if (directoryError) {
		console.error('workspace_team_invitation_directory_lookup_failed', {
			routeName: 'workspace_team_invitation_send',
			workspaceId: organisation.id,
			code: directoryError.code,
			message: directoryError.message,
			details: directoryError.details,
			hint: directoryError.hint,
		});
	}
	const directoryByMembership = new Map((directoryData ?? []).map((row: DirectoryRow) => [row.organisation_membership_id, row]));
	let loggedProviderConfigDiagnostics = false;

	for (const invitation of deliverable) {
		const row = directoryByMembership.get(invitation.membership_id);
		const rawToken = tokenByMembership.get(invitation.membership_id);
		if (!row || !rawToken) {
			const result: InvitationDeliveryResult = {
				invitationId: invitation.invitation_id,
				membershipId: invitation.membership_id,
				status: 'delivery_failed',
				failureCode: 'delivery_context_missing',
				failureMessage: 'Invitation was prepared, but delivery context could not be loaded.',
			};
			try {
				await markDeliveryResult(serverSupabase, result);
			} catch (error) {
				logInvitationDeliveryOperationError('workspace_team_invitation_delivery_result_record_failed', organisation.id, invitation.invitation_id, error);
				return redirectToTeam(workspaceSlug, {
					invitation_delivery: 'error',
					invitation_delivery_error: 'failed',
				});
			}
			deliveryResults.push(result);
			continue;
		}

		let claim: DeliveryClaimRow;
		try {
			claim = await claimDeliveryAttempt(serverSupabase, invitation.invitation_id, operationKey);
		} catch (error) {
			logInvitationDeliveryOperationError('workspace_team_invitation_delivery_claim_failed', organisation.id, invitation.invitation_id, error);
			return redirectToTeam(workspaceSlug, {
				invitation_delivery: 'error',
				invitation_delivery_error: 'failed',
			});
		}
		if (!claim.should_send) {
			if (claim.status === 'delivered' || claim.status === 'delivery_failed') {
				deliveryResults.push({
					invitationId: invitation.invitation_id,
					membershipId: invitation.membership_id,
					status: claim.status,
					failureCode: claim.failure_code ?? undefined,
					failureMessage: claim.failure_message ?? undefined,
				});
			}
			continue;
		}

		let result: InvitationDeliveryResult;
		try {
			result = await sendWorkspaceInvitationEmail({
				invitationId: invitation.invitation_id,
				membershipId: invitation.membership_id,
				recipientEmail: invitation.recipient_email,
				rawToken,
				workspaceName: organisation.name,
				personName: personName(row),
				roleLabel: workspaceRoleLabel(row.role),
				expiresAt: row.invitation_expires_at,
				requestOrigin: url.origin,
				env: invitationDeliveryEnv,
			});
		} catch (error) {
			logInvitationDeliveryOperationError('workspace_team_invitation_email_provider_unexpected_failed', organisation.id, invitation.invitation_id, error);
			result = {
				invitationId: invitation.invitation_id,
				membershipId: invitation.membership_id,
				status: 'delivery_failed',
				failureCode: 'provider_unavailable',
				failureMessage: 'Invitation email provider could not be reached. Retry is available.',
			};
		}
		if (result.status === 'delivery_failed' && result.failureCode === 'provider_not_configured' && !loggedProviderConfigDiagnostics) {
			console.warn('workspace_team_invitation_email_provider_not_configured', workspaceInvitationEmailConfigDiagnostics(invitationDeliveryEnv));
			loggedProviderConfigDiagnostics = true;
		}

		try {
			await markDeliveryResult(serverSupabase, result);
		} catch (error) {
			logInvitationDeliveryOperationError('workspace_team_invitation_delivery_result_record_failed', organisation.id, invitation.invitation_id, error);
			return redirectToTeam(workspaceSlug, {
				invitation_delivery: 'error',
				invitation_delivery_error: 'failed',
			});
		}
		deliveryResults.push(result);
	}

	const summary = summariseInvitationSendResults(deliveryResults);
	const state = summary.failed > 0 && summary.delivered > 0
		? 'partial'
		: summary.failed > 0
			? 'error'
			: 'success';

	return redirectToTeam(workspaceSlug, {
		invitation_delivery: state,
		invitation_delivery_sent: String(summary.delivered),
		invitation_delivery_failed: String(summary.failed),
	});
};

export const GET: APIRoute = async ({ params }) => redirectToTeam(
	params.workspaceSlug ?? '',
	{
		invitation_delivery: 'error',
		invitation_delivery_error: 'method',
	},
);
