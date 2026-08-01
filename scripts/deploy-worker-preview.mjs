import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
	const secrets = await previewSecretsFile(context);
	try {
		const argumentsForUpload = previewUploadArguments({
			...context,
			hasPreviewResendKey: Boolean(context.previewResendApiKey),
		});
		execFileSync('npx', [...argumentsForUpload, '--secrets-file', secrets.file], { stdio: 'inherit' });
	} finally {
		await rm(secrets.directory, { recursive: true, force: true });
	}
	console.log('Preview version uploaded to the dedicated preview Worker without changing production traffic. Wrangler prints the immutable preview URL above.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await uploadPreviewVersion();
}
