import { defineMiddleware } from 'astro:middleware';
import {
	NO_ACTIVE_WORKSPACE_PATH,
	getCurrentWorkspace,
	getWorkspaceBySlug,
	resolveWorkspaceAccessFallbackPath,
} from './lib/projects';
import { createSupabaseServerClient, getServerAccessToken } from './lib/supabaseServer';

function workspaceSlugFromPath(pathname: string): string {
	const match = pathname.match(/^\/app\/workspaces\/([^/]+)/);
	if (!match) return '';
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return '';
	}
}

function acceptsHtml(request: Request): boolean {
	const accept = request.headers.get('accept') ?? '';
	return accept.includes('text/html') || accept.includes('*/*');
}

// Do not treat client-written marker cookies as authentication; protected pages
// perform real Supabase checks before revealing app content.
export const onRequest = defineMiddleware(async (context, next) => {
	const requestedWorkspaceSlug = workspaceSlugFromPath(context.url.pathname);
	const isAppHtmlRequest = context.url.pathname.startsWith('/app')
		&& (context.request.method === 'GET' || context.request.method === 'HEAD')
		&& acceptsHtml(context.request);
	if (isAppHtmlRequest) {
		const accessToken = getServerAccessToken(context.cookies);
		if (accessToken) {
			try {
				const serverSupabase = createSupabaseServerClient(accessToken);
				if (requestedWorkspaceSlug) {
					const workspace = await getWorkspaceBySlug(serverSupabase, requestedWorkspaceSlug, accessToken);
					if (!workspace) {
						const fallbackPath = await resolveWorkspaceAccessFallbackPath(serverSupabase, accessToken);
						return context.redirect(fallbackPath, 303);
					}
				} else {
					const workspace = await getCurrentWorkspace(serverSupabase, accessToken);
					if (!workspace && context.url.pathname !== NO_ACTIVE_WORKSPACE_PATH) {
						return context.redirect(NO_ACTIVE_WORKSPACE_PATH, 303);
					}
					if (workspace && context.url.pathname === NO_ACTIVE_WORKSPACE_PATH) {
						return context.redirect('/app', 303);
					}
				}
			} catch {
				// Let the authoritative page/auth checks handle expired sessions or transient database errors.
			}
		}
	}

	const response = await next();
	if (context.url.pathname.startsWith('/app')) {
		response.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
		response.headers.set('Pragma', 'no-cache');
		response.headers.set('Expires', '0');
	}
	return response;
});
