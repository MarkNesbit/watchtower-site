import { defineMiddleware } from 'astro:middleware';
import { AUTH_SESSION_COOKIE } from './lib/authConstants';

const protectedPrefixes = ['/app'];
const guestOnlyPaths = ['/login', '/register'];

export const onRequest = defineMiddleware((context, next) => {
	const path = context.url.pathname.replace(/\/$/, '') || '/';
	const hasSessionCookie = context.cookies.get(AUTH_SESSION_COOKIE)?.value === 'signed-in';

	if (protectedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) && !hasSessionCookie) {
		return context.redirect(`/login?redirectTo=${encodeURIComponent(context.url.pathname)}`);
	}

	if (guestOnlyPaths.includes(path) && hasSessionCookie) {
		return context.redirect('/app');
	}

	return next();
});
