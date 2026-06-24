export const FEATURE_KEYS = [
	'projectDiary',
	'riskManagement',
	'riskToDiary',
	'attentionItems',
	'healthDashboard',
	'manualHealthAdjustment',
	'issues',
	'dependencies',
	'assumptions',
	'forecasting',
] as const;

export const FEATURE_STATES = ['hidden', 'disabled', 'preview', 'enabled'] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureState = (typeof FEATURE_STATES)[number];
export type FeatureStateMap = Partial<Record<FeatureKey, FeatureState>>;

export type FeatureAccessContext = {
	canAccessPreviewFeatures?: boolean;
};

export type FeatureAccess = {
	key: FeatureKey;
	state: FeatureState;
	isVisible: boolean;
	isAccessible: boolean;
	unavailableReason: string | null;
};

const ACCOUNT_UNAVAILABLE_MESSAGE = 'This feature is not currently available to your account.';
const CAPABILITY_UNAVAILABLE_MESSAGE = 'This capability is not available yet.';

export function isFeatureKey(value: unknown): value is FeatureKey {
	return typeof value === 'string' && FEATURE_KEYS.includes(value as FeatureKey);
}

export function normaliseFeatureState(value: unknown): FeatureState {
	return typeof value === 'string' && FEATURE_STATES.includes(value as FeatureState)
		? (value as FeatureState)
		: 'hidden';
}

export function createFeatureStateMap(records: unknown): FeatureStateMap {
	if (!Array.isArray(records)) return {};

	return records.reduce<FeatureStateMap>((states, record) => {
		if (!record || typeof record !== 'object') return states;
		const { key, state } = record as { key?: unknown; state?: unknown };
		if (isFeatureKey(key)) states[key] = normaliseFeatureState(state);
		return states;
	}, {});
}

export function getFeatureState(featureKey: FeatureKey, states: FeatureStateMap = {}): FeatureState {
	return normaliseFeatureState(states[featureKey]);
}

export function getFeatureAccess(
	featureKey: FeatureKey,
	context: FeatureAccessContext = {},
	states: FeatureStateMap = {},
): FeatureAccess {
	const state = getFeatureState(featureKey, states);

	if (state === 'enabled') {
		return { key: featureKey, state, isVisible: true, isAccessible: true, unavailableReason: null };
	}

	if (state === 'preview' && context.canAccessPreviewFeatures === true) {
		return { key: featureKey, state, isVisible: true, isAccessible: true, unavailableReason: null };
	}

	if (state === 'disabled') {
		return {
			key: featureKey,
			state,
			isVisible: true,
			isAccessible: false,
			unavailableReason: CAPABILITY_UNAVAILABLE_MESSAGE,
		};
	}

	if (state === 'preview') {
		return {
			key: featureKey,
			state,
			isVisible: true,
			isAccessible: false,
			unavailableReason: ACCOUNT_UNAVAILABLE_MESSAGE,
		};
	}

	return {
		key: featureKey,
		state: 'hidden',
		isVisible: false,
		isAccessible: false,
		unavailableReason: ACCOUNT_UNAVAILABLE_MESSAGE,
	};
}

export function isFeatureEnabled(
	featureKey: FeatureKey,
	context: FeatureAccessContext = {},
	states: FeatureStateMap = {},
): boolean {
	return getFeatureAccess(featureKey, context, states).isAccessible;
}

export const canAccessFeature = isFeatureEnabled;

export function getFeatureUnavailableReason(
	featureKey: FeatureKey,
	context: FeatureAccessContext = {},
	states: FeatureStateMap = {},
): string | null {
	return getFeatureAccess(featureKey, context, states).unavailableReason;
}

export async function loadFeatureAccess(
	client: SupabaseClient,
	featureKey: FeatureKey,
	accessToken?: string,
): Promise<FeatureAccess> {
	const { data: userData, error: userError } = accessToken
		? await client.auth.getUser(accessToken)
		: await client.auth.getUser();
	if (userError || !userData.user) return getFeatureAccess(featureKey);

	const [profileResult, flagResult] = await Promise.all([
		client
			.from('profiles')
			.select('can_access_preview_features')
			.eq('id', userData.user.id)
			.maybeSingle(),
		client
			.from('feature_flags')
			.select('key, state')
			.eq('key', featureKey)
			.is('organisation_id', null)
			.maybeSingle(),
	]);

	if (flagResult.error || !flagResult.data) return getFeatureAccess(featureKey);

	const states = createFeatureStateMap([flagResult.data]);
	return getFeatureAccess(
		featureKey,
		{ canAccessPreviewFeatures: profileResult.data?.can_access_preview_features === true },
		states,
	);
}
import type { SupabaseClient } from '@supabase/supabase-js';
