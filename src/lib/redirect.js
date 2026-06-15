const DEFAULT_REDIRECT_PATH = '/app';
const SAME_ORIGIN_BASE = 'https://watchtower.local';

export function getSafeRedirectPath(value, fallback = DEFAULT_REDIRECT_PATH) {
	if (typeof value !== 'string') {
		return fallback;
	}

	const candidate = value.trim();
	if (
		candidate.length === 0 ||
		!candidate.startsWith('/') ||
		candidate.startsWith('//') ||
		candidate.includes('\\') ||
		/[\u0000-\u001f\u007f]/.test(candidate)
	) {
		return fallback;
	}

	try {
		const parsed = new URL(candidate, SAME_ORIGIN_BASE);
		if (parsed.origin !== SAME_ORIGIN_BASE) {
			return fallback;
		}

		return `${parsed.pathname}${parsed.search}${parsed.hash}` || fallback;
	} catch {
		return fallback;
	}
}
