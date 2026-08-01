import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	previewAliasForBranch,
	previewOriginFor,
	previewUploadArguments,
	previewWranglerConfigFor,
} from '../scripts/deploy-worker-preview.mjs';
import { resolveWatchtowerSiteOrigin } from '../src/lib/watchtowerOrigins.ts';

test('Worker preview aliases are branch-safe, stable and within the Workers DNS limit', () => {
	assert.equal(previewAliasForBranch('agent/cloudflare-worker-preview-001'), 'agent-cloudflare-worker-preview-001');
	assert.equal(previewAliasForBranch('Feature/Needs Spaces!'), 'feature-needs-spaces');
	assert.throws(() => previewAliasForBranch('123-invalid'), /must start with a lowercase letter/);
	assert.ok(previewAliasForBranch(`feature-${'x'.repeat(100)}`, undefined, 'watchtower-preview').length <= 44);
});

test('Preview upload targets the dedicated Worker with explicit staging bindings and no traffic deployment', () => {
	const args = previewUploadArguments({
		branchName: 'agent/cloudflare-worker-preview-001',
		commitSha: 'abcdef0123456789abcdef0123456789abcdef01',
		previewWorkerName: 'watchtower-preview',
		previewOrigin: 'https://agent-cloudflare-worker-preview-001-watchtower-preview.example.workers.dev',
		previewSupabaseUrl: 'https://staging-project.supabase.co',
		previewSupabaseAnonKey: 'staging-anon-key',
	});
	assert.deepEqual(args.slice(0, 3), ['wrangler', 'versions', 'upload']);
	assert.ok(args.includes('--name'));
	assert.ok(args.includes('watchtower-preview'));
	assert.ok(args.includes('--preview-alias'));
	assert.ok(args.includes('WATCHTOWER_DEPLOYMENT_KIND:preview'));
	assert.ok(args.includes('PUBLIC_SUPABASE_URL:https://staging-project.supabase.co'));
	assert.ok(args.includes('WATCHTOWER_EMAIL_PROVIDER:disabled'));
	assert.ok(!args.includes('deploy'));
	assert.match(args.join(' '), /Preview agent\/cloudflare-worker-preview-001 at abcdef0123456789abcdef0123456789abcdef01/);
});

test('Preview origin accepts only the configured dedicated Worker preview hostname pattern', () => {
	assert.equal(
		previewOriginFor('https://branch-watchtower-preview.example.workers.dev', 'watchtower-preview'),
		'https://branch-watchtower-preview.example.workers.dev',
	);
	assert.throws(() => previewOriginFor('https://watch-tower.co.uk', 'watchtower-preview'), /exact HTTPS workers.dev preview URL/);
	assert.throws(() => previewOriginFor('https://branch-other-worker.example.workers.dev', 'watchtower-preview'), /exact HTTPS workers.dev preview URL/);
});

test('Preview uploads preserve Astro generated settings while explicitly enabling Workers preview URLs', () => {
	const generated = {
		name: 'watchtower-site',
		main: '_worker.js',
		compatibility_date: '2026-06-17',
		compatibility_flags: ['nodejs_compat'],
		assets: { directory: '../client', binding: 'ASSETS' },
		routes: [{ pattern: 'watch-tower.co.uk/*', zone_name: 'watch-tower.co.uk' }],
		custom_domains: ['watch-tower.co.uk'],
		vars: { WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk' },
	};
	const config = previewWranglerConfigFor(generated, 'watchtower-preview');
	assert.equal(config.name, 'watchtower-preview');
	assert.equal(config.workers_dev, true);
	assert.equal(config.preview_urls, true);
	assert.equal(config.main, generated.main);
	assert.deepEqual(config.assets, generated.assets);
	assert.deepEqual(config.routes, generated.routes);
	assert.deepEqual(config.custom_domains, generated.custom_domains);
	assert.deepEqual(config.compatibility_flags, generated.compatibility_flags);
	assert.deepEqual(config.vars, generated.vars);
	assert.throws(() => previewWranglerConfigFor({ assets: generated.assets }, 'watchtower-preview'), /no Worker main entry point/);
	assert.throws(() => previewWranglerConfigFor({ main: generated.main }, 'watchtower-preview'), /no assets directory/);
});

test('Application callback origins keep production strict and accept only the configured preview Worker origin', () => {
	const previewOrigin = 'https://branch-watchtower-preview.example.workers.dev';
	assert.equal(resolveWatchtowerSiteOrigin({ WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk/app' }), 'https://watch-tower.co.uk');
	assert.equal(resolveWatchtowerSiteOrigin({
		WATCHTOWER_DEPLOYMENT_KIND: 'preview',
		WATCHTOWER_SITE_URL: previewOrigin,
		WATCHTOWER_PREVIEW_ORIGIN: previewOrigin,
	}), previewOrigin);
	assert.equal(resolveWatchtowerSiteOrigin({
		WATCHTOWER_DEPLOYMENT_KIND: 'preview',
		WATCHTOWER_SITE_URL: 'https://attacker.example',
		WATCHTOWER_PREVIEW_ORIGIN: 'https://attacker.example',
	}), null);
	assert.equal(resolveWatchtowerSiteOrigin({
		WATCHTOWER_DEPLOYMENT_KIND: 'preview',
		WATCHTOWER_SITE_URL: previewOrigin,
		WATCHTOWER_PREVIEW_ORIGIN: 'https://other-watchtower-preview.example.workers.dev',
	}), null);
});

test('Preview workflow is manual only and never deploys production traffic', async () => {
	const [workflow, wrangler, middleware, packageJson] = await Promise.all([
		readFile(new URL('../.github/workflows/upload-cloudflare-worker-preview.yml', import.meta.url), 'utf8'),
		readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'),
		readFile(new URL('../src/middleware.ts', import.meta.url), 'utf8'),
		readFile(new URL('../package.json', import.meta.url), 'utf8'),
	]);
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /github\.ref_name != 'main'/);
	assert.match(workflow, /environment: cloudflare-preview/);
	assert.match(workflow, /WATCHTOWER_PREVIEW_SUPABASE_URL/);
	assert.match(workflow, /PREVIEW_SUPABASE_ANON_KEY_PRESENT: \$\{\{ vars\.WATCHTOWER_PREVIEW_SUPABASE_ANON_KEY != '' \}\}/);
	assert.match(workflow, /check WATCHTOWER_PREVIEW_SUPABASE_ANON_KEY "\$PREVIEW_SUPABASE_ANON_KEY_PRESENT"/);
	assert.match(workflow, /WATCHTOWER_PREVIEW_SUPABASE_SERVICE_ROLE_KEY/);
	assert.match(workflow, /npm run deploy:preview/);
	assert.doesNotMatch(workflow, /wrangler deploy|versions deploy/);
	assert.match(wrangler, /^preview_urls = true$/m);
	assert.match(packageJson, /"deploy:preview": "node scripts\/deploy-worker-preview\.mjs"/);
	assert.match(middleware, /X-Watchtower-Preview/);
	assert.match(middleware, /WATCHTOWER_DEPLOYMENT_KIND !== 'preview'/);
});
