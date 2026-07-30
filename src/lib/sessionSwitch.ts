import { getSafeRedirectPath } from './redirect.js';

export const ACCESS_SESSION_COOKIE = 'wt-access-token';
export const REFRESH_SESSION_COOKIE = 'wt-refresh-token';
export const LOGIN_SWITCH_CSRF_COOKIE = 'wt-login-switch-csrf';

const CSRF_TOKEN_BYTES = 24;

export function sessionCookie(name: string, value: string, maxAge: number) {
	return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearedSessionCookie(name: string, path = '/') {
	return `${name}=; Path=${path}; SameSite=Lax; Max-Age=0`;
}

export function clearedAuthenticationCookieHeaders(): string[] {
	return [
		clearedSessionCookie(ACCESS_SESSION_COOKIE),
		clearedSessionCookie(REFRESH_SESSION_COOKIE),
		clearedSessionCookie(LOGIN_SWITCH_CSRF_COOKIE, '/login'),
	];
}

export function loginSwitchCsrfCookie(token: string) {
	return `${LOGIN_SWITCH_CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/login; SameSite=Lax; Max-Age=300`;
}

export function createLoginSwitchCsrfToken(random = globalThis.crypto): string {
	if (typeof random?.randomUUID === 'function') return random.randomUUID();
	const bytes = new Uint8Array(CSRF_TOKEN_BYTES);
	random.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isValidLoginSwitchCsrf(formValue: unknown, cookieValue: unknown): boolean {
	return typeof formValue === 'string'
		&& typeof cookieValue === 'string'
		&& formValue.length >= 24
		&& formValue === cookieValue;
}

export function isSameOriginPost(request: Request, currentUrl: URL): boolean {
	const origin = request.headers.get('origin');
	if (origin) return safeOrigin(origin) === currentUrl.origin;

	const referer = request.headers.get('referer');
	if (referer) return safeOrigin(referer) === currentUrl.origin;

	return true;
}

export function buildCleanLoginPath(redirectTo: string, switched = false): string {
	const params = new URLSearchParams();
	const safeRedirect = getSafeRedirectPath(redirectTo);
	if (safeRedirect !== '/app') params.set('redirectTo', safeRedirect);
	if (switched) params.set('accountSwitched', '1');
	const query = params.toString();
	return query ? `/login?${query}` : '/login';
}

function safeOrigin(value: string): string | null {
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}
