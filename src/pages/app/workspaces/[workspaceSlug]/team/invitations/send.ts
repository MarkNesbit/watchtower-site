import type { APIRoute } from 'astro';
import { buildWorkspaceTeamPath, getWorkspaceBySlug } from '../../../../../../lib/projects.ts';
import { isWorkspaceRole } from '../../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../../lib/supabaseServer.ts';
import {
	buildWorkspaceInvitationAcceptPath,
	generateInvitationToken,
	hashInvitationToken,
	invitationDeliveryMode,
	renderInvitationEmail,
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
	if (/shared_contact_policy_required/i.test(text)) return 'shared_contact_policy_required';
	return 'failed';
}

function personName(row: DirectoryRow) {
	const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
	return fullName || row.display_name || row.login_name || 'Workspace user';
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
	});
	if (error) throw error;
}

export const POST: APIRoute = async ({ cookies, params, request, url }) => {
	const workspaceSlug = params.workspaceSlug ?? '';
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
	const requestedAction = String(formData.get('invitation_action') ?? 'send').trim();
	const operationKey = String(formData.get('operation_key') ?? '').trim() || crypto.randomUUID();

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
	const deliveryMode = invitationDeliveryMode();
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
			await markDeliveryResult(serverSupabase, result);
			deliveryResults.push(result);
			continue;
		}

		const acceptUrl = buildWorkspaceInvitationAcceptPath(rawToken, url.origin);
		renderInvitationEmail({
			workspaceName: organisation.name,
			personName: personName(row),
			roleLabel: workspaceRoleLabel(row.role),
			acceptUrl,
			expiresAt: row.invitation_expires_at,
		});

		const result: InvitationDeliveryResult = deliveryMode === 'test_record_only'
			? {
				invitationId: invitation.invitation_id,
				membershipId: invitation.membership_id,
				status: 'delivered',
			}
			: {
				invitationId: invitation.invitation_id,
				membershipId: invitation.membership_id,
				status: 'delivery_failed',
				failureCode: 'provider_not_configured',
				failureMessage: 'Invitation email provider is not configured. Retry after enabling a server-side delivery provider.',
			};

		await markDeliveryResult(serverSupabase, result);
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
