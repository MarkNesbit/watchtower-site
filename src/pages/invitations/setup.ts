import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
} from '../../lib/supabaseServer.ts';
import {
	provisionWorkspaceInvitationAuthIdentities,
	type WorkspaceInvitationAuthIdentityRepairCandidate,
} from '../../lib/workspaceInvitationAuthProvisioning.ts';
import {
	buildWorkspaceInvitationAcceptRelativePath,
	buildWorkspaceInvitationResetPasswordPath,
	hashInvitationToken,
	isWorkspaceInvitationToken,
} from '../../lib/workspaceInvitations.ts';

type InvitationInfo = {
	auth_user_id: string;
};

type RuntimeEnv = Record<string, unknown>;

const noStoreHeaders = {
	'cache-control': 'private, no-store, no-cache, must-revalidate',
	pragma: 'no-cache',
	expires: '0',
};

function redirect(location: string, status = 303) {
	return new Response(null, {
		status,
		headers: {
			location,
			...noStoreHeaders,
		},
	});
}

function redirectToAccept(token: string, error: string) {
	return redirect(`${buildWorkspaceInvitationAcceptRelativePath(token)}&error=${encodeURIComponent(error)}`);
}

function clearAuthCookies(headers: Headers) {
	headers.append('Set-Cookie', 'wt-access-token=; Path=/; Max-Age=0; SameSite=Lax');
	headers.append('Set-Cookie', 'wt-refresh-token=; Path=/; Max-Age=0; SameSite=Lax');
}

function runtimeString(runtimeEnv: RuntimeEnv, name: string): string | null {
	const value = runtimeEnv[name] ?? import.meta.env?.[name];
	return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function safeLogMessage(error: unknown, fallback: string) {
	const message = error instanceof Error ? error.message : String(error ?? fallback);
	return message
		.replace(/https?:\/\/\S+/gi, '[redacted-link]')
		.replace(/[^\s@]+@[^\s@]+/g, '[redacted-email]')
		.replace(/\b(?:token|password|authorization)\b/gi, '[redacted]')
		.slice(0, 240) || fallback;
}

function safeSupabaseActionLink(actionLink: string | undefined, runtimeEnv: RuntimeEnv) {
	if (!actionLink) return null;
	const supabaseUrl = runtimeString(runtimeEnv, 'PUBLIC_SUPABASE_URL');
	if (!supabaseUrl) return null;

	try {
		const parsedAction = new URL(actionLink);
		const parsedSupabase = new URL(supabaseUrl);
		return parsedAction.origin === parsedSupabase.origin ? parsedAction.toString() : null;
	} catch {
		return null;
	}
}

function watchtowerReturnOrigin(runtimeEnv: RuntimeEnv, requestOrigin: string) {
	const configuredSiteUrl = runtimeString(runtimeEnv, 'WATCHTOWER_SITE_URL');
	try {
		const parsed = new URL(configuredSiteUrl ?? requestOrigin);
		return parsed.origin;
	} catch {
		return requestOrigin;
	}
}

function logRepairCandidateLookupCompleted(candidates: WorkspaceInvitationAuthIdentityRepairCandidate[]) {
	const candidate = candidates[0];
	console.info('repair_candidate_lookup_completed', {
		routeName: 'workspace_invitation_setup',
		candidateFound: Boolean(candidate),
		candidateCount: candidates.length,
		membershipId: candidate?.membership_id ?? null,
		invitationId: candidate?.invitation_id ?? null,
		currentAuthUserId: candidate?.current_auth_user_id ?? null,
		hasEmailIdentity: candidate?.has_email_identity ?? null,
	});
}

async function loadInvitation(token: string) {
	const tokenHash = await hashInvitationToken(token);
	const { data, error } = await createSupabaseServerClient().rpc('get_workspace_membership_invitation_by_token', {
		p_token_hash: tokenHash,
	});
	if (error) throw error;
	return {
		invitation: Array.isArray(data) ? data[0] as InvitationInfo | undefined : undefined,
		tokenHash,
	};
}

async function resolveLinkedAuthUserId(adminSupabase, invitation: InvitationInfo, tokenHash: string) {
	const { data, error } = await adminSupabase.rpc('get_workspace_invitation_auth_identity_repair_candidates', {
		p_invitation_ids: null,
		p_membership_ids: null,
		p_token_hash: tokenHash,
	});
	if (error) throw error;

	const candidates = (data ?? []) as WorkspaceInvitationAuthIdentityRepairCandidate[];
	logRepairCandidateLookupCompleted(candidates);
	const candidate = candidates[0];
	if (!candidate) return invitation.auth_user_id;
	if (candidate.has_email_identity) return candidate.current_auth_user_id;

	const [result] = await provisionWorkspaceInvitationAuthIdentities({
		adminClient: adminSupabase,
		candidates: [candidate],
	});
	if (!result || result.status === 'failed') {
		throw new Error(result?.failureCode ?? 'Invitation Auth identity could not be provisioned.');
	}
	return result.authUserId;
}

export const POST: APIRoute = async ({ request, url }) => {
	const formData = await request.formData();
	const token = String(formData.get('token') ?? url.searchParams.get('token') ?? '').trim();
	if (!isWorkspaceInvitationToken(token)) return redirect('/invitations/accept?error=invalid');

	let invitation: InvitationInfo | undefined;
	let tokenHash = '';
	try {
		const loaded = await loadInvitation(token);
		invitation = loaded.invitation;
		tokenHash = loaded.tokenHash;
	} catch (error) {
		console.error('workspace_invitation_setup_lookup_failed', {
			routeName: 'workspace_invitation_setup',
			message: safeLogMessage(error, 'Invitation lookup failed'),
		});
		return redirectToAccept(token, 'failed');
	}
	if (!invitation) return redirectToAccept(token, 'invalid');

	let setupStage = 'auth_identity_repair';
	try {
		const runtimeEnv = env as RuntimeEnv;
		const adminSupabase = createSupabaseAdminClient(runtimeEnv);
		const linkedAuthUserId = await resolveLinkedAuthUserId(adminSupabase, invitation, tokenHash);
		setupStage = 'get_user_by_id';
		const { data: userData, error: userError } = await adminSupabase.auth.admin.getUserById(linkedAuthUserId);
		const authEmail = userData.user?.email;
		if (userError || !authEmail) throw userError ?? new Error('Linked invitation auth user has no email.');

		setupStage = 'generate_link';
		const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
			type: 'recovery',
			email: authEmail,
			options: {
				redirectTo: new URL(buildWorkspaceInvitationResetPasswordPath(token), watchtowerReturnOrigin(runtimeEnv, url.origin)).toString(),
			},
		});
		if (linkError) throw linkError;

		setupStage = 'validate_action_link';
		const actionLink = safeSupabaseActionLink(linkData.properties?.action_link, runtimeEnv);
		if (!actionLink) throw new Error('Supabase setup link could not be validated.');

		const response = redirect(actionLink);
		clearAuthCookies(response.headers);
		return response;
	} catch (error) {
		console.error('workspace_invitation_setup_link_failed', {
			routeName: 'workspace_invitation_setup',
			stage: setupStage,
			message: safeLogMessage(error, 'Invitation setup link failed'),
		});
		return redirectToAccept(token, 'setup_unavailable');
	}
};

export const GET: APIRoute = async ({ url }) => {
	const token = String(url.searchParams.get('token') ?? '').trim();
	if (isWorkspaceInvitationToken(token)) return redirect(buildWorkspaceInvitationAcceptRelativePath(token));
	return redirect('/invitations/accept?error=invalid');
};
