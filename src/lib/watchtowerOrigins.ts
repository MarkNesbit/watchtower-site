const PRODUCTION_SITE_ORIGIN = 'https://watch-tower.co.uk';
const PREVIEW_WORKER_NAME = 'watchtower-preview';

export type WatchtowerOriginEnv = {
	WATCHTOWER_DEPLOYMENT_KIND?: string;
	WATCHTOWER_SITE_URL?: string;
	WATCHTOWER_PREVIEW_ORIGIN?: string;
};

function normaliseHttpsOrigin(value: unknown): string | null {
	const configured = String(value ?? '').trim();
	if (!configured) return null;
	try {
		const url = new URL(configured);
		if (url.protocol !== 'https:' || url.username || url.password) return null;
		return url.origin;
	} catch {
		return null;
	}
}

function isDedicatedPreviewOrigin(origin: string): boolean {
	const hostname = new URL(origin).hostname;
	return new RegExp(`^[a-z0-9-]+-${PREVIEW_WORKER_NAME}\\.[a-z0-9-]+\\.workers\\.dev$`, 'i').test(hostname);
}

export function resolveWatchtowerSiteOrigin(env: WatchtowerOriginEnv = import.meta.env ?? {}): string | null {
	const configuredSiteOrigin = normaliseHttpsOrigin(env.WATCHTOWER_SITE_URL);
	if (configuredSiteOrigin === PRODUCTION_SITE_ORIGIN) return configuredSiteOrigin;
	if (env.WATCHTOWER_DEPLOYMENT_KIND !== 'preview' || !configuredSiteOrigin) return null;

	const configuredPreviewOrigin = normaliseHttpsOrigin(env.WATCHTOWER_PREVIEW_ORIGIN);
	if (!configuredPreviewOrigin || configuredSiteOrigin !== configuredPreviewOrigin) return null;
	return isDedicatedPreviewOrigin(configuredPreviewOrigin) ? configuredPreviewOrigin : null;
}
