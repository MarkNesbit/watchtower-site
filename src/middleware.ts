import { defineMiddleware } from 'astro:middleware';

// Do not treat client-written marker cookies as authentication; protected pages
// perform real Supabase checks before revealing app content.
export const onRequest = defineMiddleware(async (context, next) => {
	const response = await next();
	if (context.url.pathname.startsWith('/app')) {
		response.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
		response.headers.set('Pragma', 'no-cache');
		response.headers.set('Expires', '0');
	}
	return response;
});
