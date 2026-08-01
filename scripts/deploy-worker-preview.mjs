import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const defaultPreviewWorkerName = 'watchtower-preview';

function commandOutput(command, args) {
	return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function requiredEnvironmentValue(environment, name) {
	const value = String(environment[name] ?? '').trim();
	if (!value) throw new Error(`Missing required preview deployment environment variable: ${name}`);
	return value;
}

export function previewWorkerNameFor(value) {
	const workerName = String(value ?? defaultPreviewWorkerName).trim().toLowerCase();
	if (!/^[a-z][a-z0-9-]{0,62}$/.test(workerName)) {
		throw new Error('Preview Worker name must start with a lowercase letter and contain only lowercase letters, numbers, and dashes.');
	}
	return workerName;
}

export function previewAliasForBranch(branchName, explicitAlias, workerName = defaultPreviewWorkerName) {
	const rawAlias = String(explicitAlias ?? branchName ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	const maxLength = 63 - previewWorkerNameFor(workerName).length - 1;
	if (!rawAlias || !/^[a-z]/.test(rawAlias)) {
		throw new Error('Preview alias must start with a lowercase letter and contain only lowercase letters, numbers, and dashes.');
	}
	return rawAlias.slice(0, maxLength).replace(/-+$/g, '');
}

export function previewOriginFor(value, workerName = defaultPreviewWorkerName) {
	try {
		const url = new URL(String(value ?? '').trim());
		const expectedWorkerSuffix = `-${previewWorkerNameFor(workerName)}.`;
		if (
			url.protocol !== 'https:'
			|| url.username
			|| url.password
			|| !url.hostname.endsWith('.workers.dev')
			|| !url.hostname.includes(expectedWorkerSuffix)
		) {
			throw new Error();
		}
		return url.origin;
	} catch {
		throw new Error(`WATCHTOWER_PREVIEW_ORIGIN must be the exact HTTPS workers.dev preview URL for ${previewWorkerNameFor(workerName)}.`);
	}
}

export function previewUploadArguments({
	branchName,
	commitSha,
	previewAlias,
	previewWorkerName,
	previewOrigin,
	previewSupabaseUrl,
	previewSupabaseAnonKey,
	hasPreviewResendKey,
}) {
	const commit = String(commitSha ?? '').trim();
	if (!/^[0-9a-f]{7,64}$/i.test(commit)) throw new Error('Preview deployment requires a Git commit SHA.');
	const workerName = previewWorkerNameFor(previewWorkerName);
	const alias = previewAliasForBranch(branchName, previewAlias, workerName);
	const origin = previewOriginFor(previewOrigin, workerName);
	const shortCommit = commit.slice(0, 12).toLowerCase();
	return [
		'wrangler',
		'versions',
		'upload',
		'--name', workerName,
		'--tag', `preview-${shortCommit}`,
		'--message', `Preview ${branchName} at ${commit}`,
		'--preview-alias', alias,
		'--var', `PUBLIC_SUPABASE_URL:${previewSupabaseUrl}`,
		'--var', `PUBLIC_SUPABASE_ANON_KEY:${previewSupabaseAnonKey}`,
		'--var', 'WATCHTOWER_DEPLOYMENT_KIND:preview',
		'--var', `WATCHTOWER_PREVIEW_BRANCH:${alias}`,
		'--var', `WATCHTOWER_PREVIEW_COMMIT:${shortCommit}`,
		'--var', `WATCHTOWER_PREVIEW_ORIGIN:${origin}`,
		'--var', `WATCHTOWER_SITE_URL:${origin}`,
		'--var', `WATCHTOWER_EMAIL_PROVIDER:${hasPreviewResendKey ? 'resend' : 'disabled'}`,
		'--var', `WATCHTOWER_INVITATION_DELIVERY_MODE:${hasPreviewResendKey ? 'provider_required' : 'test_record_only'}`,
		'--var', `WATCHTOWER_PASSWORD_RESET_DELIVERY_MODE:${hasPreviewResendKey ? 'provider_required' : 'test_record_only'}`,
	];
}

export function previewTriggerArguments(configFile) {
	const file = String(configFile ?? '').trim();
	if (!file) throw new Error('Preview trigger deployment requires an effective Wrangler configuration file.');
	return ['wrangler', '--config', file, 'triggers', 'deploy'];
}

export function previewWranglerConfigFor(generatedConfig, previewWorkerName) {
	if (!generatedConfig || typeof generatedConfig !== 'object' || Array.isArray(generatedConfig)) {
		throw new Error('Astro-generated Preview Wrangler configuration must be a JSON object.');
	}
	if (typeof generatedConfig.main !== 'string' || !generatedConfig.main.trim()) {
		throw new Error('Astro-generated Preview Wrangler configuration has no Worker main entry point.');
	}
	if (!generatedConfig.assets || typeof generatedConfig.assets.directory !== 'string' || !generatedConfig.assets.directory.trim()) {
		throw new Error('Astro-generated Preview Wrangler configuration has no assets directory.');
	}

	return {
		...generatedConfig,
		name: previewWorkerNameFor(previewWorkerName),
		workers_dev: true,
		preview_urls: true,
	};
}

function previewWranglerConfigSummary(config) {
	return {
		name: config.name,
		workers_dev: config.workers_dev,
		preview_urls: config.preview_urls,
		main: config.main,
		assets: {
			directory: Boolean(config.assets?.directory),
			binding: Boolean(config.assets?.binding),
			not_found_handling: config.assets?.not_found_handling ?? null,
		},
		routes: Boolean(config.routes || config.route),
		custom_domains: Boolean(config.custom_domains),
		compatibility_date: config.compatibility_date ?? null,
		compatibility_flags: Boolean(config.compatibility_flags),
	};
}

async function previewWranglerConfigFile(previewWorkerName) {
	const generatedFile = join(process.cwd(), 'dist', 'server', 'wrangler.json');
	let generatedConfig;
	try {
		generatedConfig = JSON.parse(await readFile(generatedFile, 'utf8'));
	} catch (error) {
		throw new Error(`Unable to read Astro-generated Wrangler configuration at ${generatedFile}: ${error.message}`);
	}

	console.log(`Astro-generated Wrangler configuration: ${JSON.stringify(previewWranglerConfigSummary(generatedConfig))}`);
	const config = previewWranglerConfigFor(generatedConfig, previewWorkerName);
	if (config.workers_dev !== true || config.preview_urls !== true) {
		throw new Error('Effective Preview Wrangler configuration must explicitly enable workers_dev and preview_urls.');
	}

	const file = join(dirname(generatedFile), 'wrangler.preview.json');
	await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
	console.log(`Effective Preview Wrangler configuration: ${JSON.stringify(previewWranglerConfigSummary(config))}`);
	return file;
}

export function previewDeploymentContext(environment = process.env) {
	const branchName = String(environment.GITHUB_HEAD_REF || environment.GITHUB_REF_NAME || commandOutput('git', ['branch', '--show-current'])).trim();
	const commitSha = String(environment.GITHUB_SHA || commandOutput('git', ['rev-parse', 'HEAD'])).trim();
	const previewWorkerName = previewWorkerNameFor(environment.WATCHTOWER_PREVIEW_WORKER_NAME);
	return {
		branchName,
		commitSha,
		previewAlias: environment.WATCHTOWER_PREVIEW_ALIAS,
		previewWorkerName,
		previewOrigin: previewOriginFor(requiredEnvironmentValue(environment, 'WATCHTOWER_PREVIEW_ORIGIN'), previewWorkerName),
		previewSupabaseUrl: requiredEnvironmentValue(environment, 'WATCHTOWER_PREVIEW_SUPABASE_URL'),
		previewSupabaseAnonKey: requiredEnvironmentValue(environment, 'WATCHTOWER_PREVIEW_SUPABASE_ANON_KEY'),
		previewSupabaseServiceRoleKey: requiredEnvironmentValue(environment, 'WATCHTOWER_PREVIEW_SUPABASE_SERVICE_ROLE_KEY'),
		previewResendApiKey: String(environment.WATCHTOWER_PREVIEW_RESEND_API_KEY ?? '').trim(),
	};
}

async function previewSecretsFile(context) {
	const directory = await mkdtemp(join(tmpdir(), 'watchtower-preview-'));
	const file = join(directory, 'secrets.json');
	const secrets = { SUPABASE_SERVICE_ROLE_KEY: context.previewSupabaseServiceRoleKey };
	if (context.previewResendApiKey) secrets.WATCHTOWER_RESEND_API_KEY = context.previewResendApiKey;
	await writeFile(file, JSON.stringify(secrets), { mode: 0o600 });
	return { directory, file };
}

export async function uploadPreviewVersion(context = previewDeploymentContext()) {
	const alias = previewAliasForBranch(context.branchName, context.previewAlias, context.previewWorkerName);
	console.log(`Building ${context.previewWorkerName} preview for ${context.branchName} at ${context.commitSha.slice(0, 12)} (alias: ${alias}).`);
	process.env.PUBLIC_SUPABASE_URL = context.previewSupabaseUrl;
	process.env.PUBLIC_SUPABASE_ANON_KEY = context.previewSupabaseAnonKey;
	execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
	const configFile = await previewWranglerConfigFile(context.previewWorkerName);
	const secrets = await previewSecretsFile(context);
	try {
		console.log('Applying workers.dev and Preview URL settings to the dedicated Preview Worker only.');
		execFileSync('npx', previewTriggerArguments(configFile), { stdio: 'inherit' });
		const argumentsForUpload = previewUploadArguments({
			...context,
			hasPreviewResendKey: Boolean(context.previewResendApiKey),
		});
		const [command, ...commandArguments] = argumentsForUpload;
		execFileSync('npx', [command, '--config', configFile, ...commandArguments, '--secrets-file', secrets.file], { stdio: 'inherit' });
	} finally {
		await rm(configFile, { force: true });
		await rm(secrets.directory, { recursive: true, force: true });
	}
	console.log('Preview version uploaded to the dedicated preview Worker without changing production traffic. Wrangler prints the immutable preview URL above.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await uploadPreviewVersion();
}
