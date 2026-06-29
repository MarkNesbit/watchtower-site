import { isWorkspaceRole, WORKSPACE_ROLES, type WorkspaceRole } from './permissions.ts';

export const INTERNAL_TEST_WORKSPACE_SLUG = 'mark-nesbit-professional-workspace';
export const ROLE_SIMULATION_TTL_HOURS = 4;

export type OrganisationSummary = {
	id: string;
	name: string;
	slug: string;
};

export type RoleSimulation = {
	id: string;
	user_id: string;
	organisation_id: string;
	simulated_role: WorkspaceRole;
	is_active: boolean;
	expires_at: string;
	created_at?: string;
	updated_at?: string;
};

export type RoleSimulationState = {
	isInternalTester: boolean;
	workspace: OrganisationSummary | null;
	actualRole: WorkspaceRole | null;
	effectiveRole: WorkspaceRole | null;
	activeSimulation: RoleSimulation | null;
};

type MembershipWithOrganisation = {
	role?: string | null;
	organisations?: OrganisationSummary | OrganisationSummary[] | null;
	[key: string]: unknown;
};

export function getMembershipOrganisation(membership: MembershipWithOrganisation | null | undefined): OrganisationSummary | null {
	const organisation = Array.isArray(membership?.organisations)
		? membership?.organisations[0]
		: membership?.organisations;
	return organisation ?? null;
}

export function isInternalTestWorkspace(organisation: Pick<OrganisationSummary, 'slug'> | null | undefined): boolean {
	return organisation?.slug === INTERNAL_TEST_WORKSPACE_SLUG;
}

export function roleLabel(role: unknown): string {
	return typeof role === 'string' && role.length > 0
		? role.charAt(0).toUpperCase() + role.slice(1)
		: 'Unavailable';
}

export function isRoleSimulationExpired(simulation: Pick<RoleSimulation, 'expires_at'> | null | undefined, now = new Date()): boolean {
	if (!simulation?.expires_at) return true;
	const expiresAt = new Date(simulation.expires_at);
	return Number.isNaN(expiresAt.getTime()) || expiresAt <= now;
}

export async function getAuthenticatedUser(client, accessToken?: string) {
	const { data, error } = accessToken
		? await client.auth.getUser(accessToken)
		: await client.auth.getUser();
	if (error) throw error;
	return data.user ?? null;
}

export async function isInternalTester(client, userId: string): Promise<boolean> {
	const { data, error } = await client
		.from('profiles')
		.select('is_internal_tester')
		.eq('id', userId)
		.maybeSingle();

	if (error) throw error;
	return Boolean(data?.is_internal_tester);
}

export async function getActiveRoleSimulation(
	client,
	userId: string,
	organisationId: string,
	now = new Date(),
): Promise<RoleSimulation | null> {
	const { data, error } = await client
		.from('internal_role_simulations')
		.select('id, user_id, organisation_id, simulated_role, is_active, expires_at, created_at, updated_at')
		.eq('user_id', userId)
		.eq('organisation_id', organisationId)
		.eq('is_active', true)
		.gt('expires_at', now.toISOString())
		.order('updated_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	if (!data || data.is_active !== true || !isWorkspaceRole(data.simulated_role) || isRoleSimulationExpired(data, now)) return null;
	return data as RoleSimulation;
}

export async function applyRoleSimulationToMembership<T extends MembershipWithOrganisation>(
	membership: T | null,
	client,
	userId: string,
	now = new Date(),
): Promise<(T & { actualRole: WorkspaceRole | null; effectiveRole: WorkspaceRole | null; activeRoleSimulation: RoleSimulation | null }) | null> {
	if (!membership) return null;

	const organisation = getMembershipOrganisation(membership);
	const actualRole = isWorkspaceRole(membership.role) ? membership.role : null;
	let effectiveRole = actualRole;
	let activeRoleSimulation: RoleSimulation | null = null;

	if (organisation && actualRole && isInternalTestWorkspace(organisation) && await isInternalTester(client, userId)) {
		activeRoleSimulation = await getActiveRoleSimulation(client, userId, organisation.id, now);
		if (activeRoleSimulation) effectiveRole = activeRoleSimulation.simulated_role;
	}

	return {
		...membership,
		role: effectiveRole,
		actualRole,
		effectiveRole,
		activeRoleSimulation,
	};
}

export async function getInternalRoleSimulationState(client, accessToken?: string, now = new Date()): Promise<RoleSimulationState> {
	const user = await getAuthenticatedUser(client, accessToken);
	if (!user) {
		return { isInternalTester: false, workspace: null, actualRole: null, effectiveRole: null, activeSimulation: null };
	}

	const tester = await isInternalTester(client, user.id);
	if (!tester) {
		return { isInternalTester: false, workspace: null, actualRole: null, effectiveRole: null, activeSimulation: null };
	}

	const { data: membership, error } = await client
		.from('organisation_members')
		.select('role, organisations!inner(id, name, slug)')
		.eq('status', 'active')
		.eq('user_id', user.id)
		.eq('organisations.slug', INTERNAL_TEST_WORKSPACE_SLUG)
		.limit(1)
		.maybeSingle();

	if (error) throw error;

	const organisation = getMembershipOrganisation(membership);
	const actualRole = isWorkspaceRole(membership?.role) ? membership.role : null;
	if (!membership || !organisation || !actualRole || !isInternalTestWorkspace(organisation)) {
		return { isInternalTester: true, workspace: null, actualRole: null, effectiveRole: null, activeSimulation: null };
	}

	const activeSimulation = await getActiveRoleSimulation(client, user.id, organisation.id, now);
	return {
		isInternalTester: true,
		workspace: organisation,
		actualRole,
		effectiveRole: activeSimulation?.simulated_role ?? actualRole,
		activeSimulation,
	};
}

async function requireInternalRoleSimulationScope(client, accessToken?: string) {
	const user = await getAuthenticatedUser(client, accessToken);
	if (!user) throw new Error('You must be signed in to use internal test tools.');

	const state = await getInternalRoleSimulationState(client, accessToken);
	if (!state.isInternalTester || !state.workspace || !state.actualRole) {
		throw new Error('Internal test tools are not available for this account or workspace.');
	}

	return { user, state };
}

export async function activateRoleSimulation(client, simulatedRole: WorkspaceRole, accessToken?: string): Promise<RoleSimulationState> {
	if (!WORKSPACE_ROLES.includes(simulatedRole)) throw new Error('Select a valid simulated role.');
	const { user, state } = await requireInternalRoleSimulationScope(client, accessToken);
	const expiresAt = new Date(Date.now() + ROLE_SIMULATION_TTL_HOURS * 60 * 60 * 1000).toISOString();

	const { error: deactivateError } = await client
		.from('internal_role_simulations')
		.update({ is_active: false })
		.eq('user_id', user.id)
		.eq('organisation_id', state.workspace?.id)
		.eq('is_active', true);
	if (deactivateError) throw deactivateError;

	const { error } = await client
		.from('internal_role_simulations')
		.insert({
			user_id: user.id,
			organisation_id: state.workspace?.id,
			simulated_role: simulatedRole,
			is_active: true,
			expires_at: expiresAt,
		});

	if (error) throw error;
	return getInternalRoleSimulationState(client, accessToken);
}

export async function resetRoleSimulation(client, accessToken?: string): Promise<RoleSimulationState> {
	const { user, state } = await requireInternalRoleSimulationScope(client, accessToken);

	const { error } = await client
		.from('internal_role_simulations')
		.update({ is_active: false })
		.eq('user_id', user.id)
		.eq('organisation_id', state.workspace?.id)
		.eq('is_active', true);

	if (error) throw error;
	return getInternalRoleSimulationState(client, accessToken);
}
