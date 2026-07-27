import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
} from '../../lib/supabaseServer.ts';
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

async function loadInvitation(token: string) {
	const tokenHash = await hashInvitationToken(token);
	const { data, error } = await createSupabaseServerClient().rpc('get_workspace_membership_invitation_by_token', {
		p_token_hash: tokenHash,
	});
	if (error) throw error;
	return Array.isArray(data) ? data[0] as InvitationInfo | undefined : undefined;
}

export const POST: APIRoute = async ({ request, url }) => {
	const formData = await request.formData();
	const token = String(formData.get('token') ?? url.searchParams.get('token') ?? '').trim();
	if (!isWorkspaceInvitationToken(token)) return redirect('/invitations/accept?error=invalid');

	let invitation: InvitationInfo | undefined;
	try {
		invitation = await loadInvitation(token);
	} catch (error) {
		console.error('workspace_invitation_setup_lookup_failed', {
			routeName: 'workspace_invitation_setup',
			message: error instanceof Error ? error.message : 'Invitation lookup failed',
		});
		return redirectToAccept(token, 'failed');
	}
	if (!invitation) return redirectToAccept(token, 'invalid');

	try {
		const runtimeEnv = env as RuntimeEnv;
		const adminSupabase = createSupabaseAdminClient(runtimeEnv);
		const { data: userData, error: userError } = await adminSupabase.auth.admin.getUserById(invitation.auth_user_id);
		const authEmail = userData.user?.email;
		if (userError || !authEmail) throw userError ?? new Error('Linked invitation auth user has no email.');

		const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
			type: 'recovery',
			email: authEmail,
			options: {
				redirectTo: new URL(buildWorkspaceInvitationResetPasswordPath(token), watchtowerReturnOrigin(runtimeEnv, url.origin)).toString(),
			},
		});
		if (linkError) throw linkError;

		const actionLink = safeSupabaseActionLink(linkData.properties?.action_link, runtimeEnv);
		if (!actionLink) throw new Error('Supabase setup link could not be validated.');

		const response = redirect(actionLink);
		clearAuthCookies(response.headers);
		return response;
	} catch (error) {
		console.error('workspace_invitation_setup_link_failed', {
			routeName: 'workspace_invitation_setup',
			message: error instanceof Error ? error.message : 'Invitation setup link failed',
		});
		return redirectToAccept(token, 'setup_unavailable');
	}
};

export const GET: APIRoute = async ({ url }) => {
	const token = String(url.searchParams.get('token') ?? '').trim();
	if (isWorkspaceInvitationToken(token)) return redirect(buildWorkspaceInvitationAcceptRelativePath(token));
	return redirect('/invitations/accept?error=invalid');
};
