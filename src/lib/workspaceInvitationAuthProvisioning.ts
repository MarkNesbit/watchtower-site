export type WorkspaceInvitationAuthIdentityRepairCandidate = {
	invitation_id: string;
	organisation_id: string;
	membership_id: string;
	profile_id: string;
	current_auth_user_id: string;
	auth_email: string;
	membership_status: string;
	invitation_status: string;
	has_email_identity: boolean;
	auth_email_matches_invitation?: boolean | null;
	existing_valid_auth_user_id?: string | null;
	previous_auth_user_id?: string | null;
};

export type WorkspaceInvitationAuthIdentityRepairResult = {
	invitationId: string;
	membershipId: string;
	profileId: string;
	authUserId: string;
	status: 'valid_existing' | 'remapped_existing_user' | 'remapped_created_user' | 'failed';
	failureCode?: string;
	failureMessage?: string;
};

type SupabaseAdminClient = {
	auth: {
		admin: {
			createUser(input: {
				email: string;
				email_confirm?: boolean;
				user_metadata?: Record<string, unknown>;
				app_metadata?: Record<string, unknown>;
			}): Promise<{ data: { user?: { id?: string } | null } | null; error: Error | null }>;
			updateUserById(userId: string, input: {
				email?: string;
				user_metadata?: Record<string, unknown>;
				app_metadata?: Record<string, unknown>;
			}): Promise<{ data?: unknown; error: Error | null }>;
			deleteUser(userId: string, shouldSoftDelete?: boolean): Promise<{ data?: unknown; error: Error | null }>;
			getUserById(userId: string): Promise<{ data: { user?: { id?: string; email?: string | null } | null } | null; error: Error | null }>;
			listUsers?(input?: {
				page?: number;
				perPage?: number;
			}): Promise<{ data: { users?: Array<{ id?: string; email?: string | null }> } | null; error: Error | null }>;
		};
	};
	rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: Error | null }>;
};

export const WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE = 'auth_identity_provisioning_failed';
export const WORKSPACE_INVITATION_AUTH_IDENTITY_ALIAS_FAILURE_CODE = 'auth_identity_alias_assignment_failed';

function safeFailureMessage(error: unknown, fallback: string) {
	const message = error instanceof Error ? error.message : String(error ?? fallback);
	return message
		.replace(/https?:\/\/\S+/gi, '[redacted-link]')
		.replace(/[^\s@]+@[^\s@]+/g, '[redacted-email]')
		.replace(/re_[a-z0-9_-]+/gi, '[redacted-secret]')
		.replace(/\b(?:token|password|authorization)\b/gi, '[redacted]')
		.slice(0, 240) || fallback;
}

function temporaryEmailFor(candidate: WorkspaceInvitationAuthIdentityRepairCandidate) {
	const compactInvitationId = candidate.invitation_id.replaceAll('-', '').slice(0, 16);
	const compactAuthUserId = candidate.current_auth_user_id.replaceAll('-', '').slice(0, 16);
	return `invitation-auth-repair+${compactInvitationId}.${compactAuthUserId}@pending.watchtower.invalid`;
}

function placeholderAuthUserIdFor(candidate: WorkspaceInvitationAuthIdentityRepairCandidate) {
	return candidate.previous_auth_user_id ?? candidate.current_auth_user_id;
}

function repairLogContext(candidate: WorkspaceInvitationAuthIdentityRepairCandidate) {
	return {
		profileId: candidate.profile_id,
		membershipId: candidate.membership_id,
		invitationId: candidate.invitation_id,
		oldAuthUserId: placeholderAuthUserIdFor(candidate),
	};
}

function logRepairStarted(candidate: WorkspaceInvitationAuthIdentityRepairCandidate) {
	console.info('auth_identity_repair_started', repairLogContext(candidate));
}

function logRepairCompleted(
	candidate: WorkspaceInvitationAuthIdentityRepairCandidate,
	newAuthUserId: string,
	outcome: WorkspaceInvitationAuthIdentityRepairResult['status'],
) {
	console.info('auth_identity_repair_completed', {
		...repairLogContext(candidate),
		newAuthUserId,
		outcome,
	});
}

function logRepairFailed(
	candidate: WorkspaceInvitationAuthIdentityRepairCandidate,
	stage: string,
	failureCode = WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE,
) {
	console.error('auth_identity_repair_failed', {
		failureCode,
		stage,
		profileId: candidate.profile_id,
		membershipId: candidate.membership_id,
		invitationId: candidate.invitation_id,
	});
}

async function recordRepair(
	client: SupabaseAdminClient,
	candidate: WorkspaceInvitationAuthIdentityRepairCandidate,
	authUserId: string,
	outcome: 'skipped_valid' | 'remapped_existing_user' | 'remapped_created_user' | 'failed',
	correlationId: string,
	failure?: { code: string; message: string },
) {
	const { error } = await client.rpc('record_workspace_invitation_auth_identity_repair', {
		p_invitation_id: candidate.invitation_id,
		p_old_auth_user_id: candidate.current_auth_user_id,
		p_new_auth_user_id: authUserId,
		p_outcome: outcome,
		p_failure_code: failure?.code ?? null,
		p_failure_message: failure?.message ?? null,
		p_correlation_id: correlationId,
	});
	if (error) throw error;
}

async function recordRepairFailure(
	client: SupabaseAdminClient,
	candidate: WorkspaceInvitationAuthIdentityRepairCandidate,
	currentAuthUserId: string,
	correlationId: string,
	failure: { code: string; message: string },
) {
	await recordRepair(
		client,
		{ ...candidate, current_auth_user_id: currentAuthUserId },
		currentAuthUserId,
		'failed',
		correlationId,
		failure,
	);
}

async function findAuthUserByEmail(client: SupabaseAdminClient, email: string) {
	if (typeof client.auth.admin.listUsers !== 'function') return null;
	const targetEmail = email.trim().toLowerCase();
	for (let page = 1; page <= 10; page += 1) {
		const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
		if (error) throw error;
		const users = data?.users ?? [];
		const match = users.find((user) => typeof user.email === 'string' && user.email.trim().toLowerCase() === targetEmail);
		if (match?.id) return match.id;
		if (users.length < 1000) return null;
	}
	return null;
}

function isMissingUserError(error: Error | null | undefined) {
	return /not found|no user|user.*missing/i.test(error?.message ?? '');
}

async function softDeleteAuthUser(client: SupabaseAdminClient, authUserId: string) {
	const { error } = await client.auth.admin.deleteUser(authUserId, true);
	if (error && !isMissingUserError(error)) throw error;
}

async function hardDeleteAuthUser(client: SupabaseAdminClient, authUserId: string) {
	const { error } = await client.auth.admin.deleteUser(authUserId, false);
	if (error && !isMissingUserError(error)) throw error;
}

async function verifyPlaceholderRelease(
	client: SupabaseAdminClient,
	candidate: WorkspaceInvitationAuthIdentityRepairCandidate,
	replacementAuthUserId: string,
) {
	const { error } = await client.rpc('verify_workspace_invitation_auth_placeholder_release', {
		p_invitation_id: candidate.invitation_id,
		p_old_auth_user_id: placeholderAuthUserIdFor(candidate),
		p_new_auth_user_id: replacementAuthUserId,
	});
	if (error) throw error;
}

async function verifyFinalAuthIdentity(
	client: SupabaseAdminClient,
	candidate: WorkspaceInvitationAuthIdentityRepairCandidate,
	authUserId: string,
) {
	const { data: userData, error: userError } = await client.auth.admin.getUserById(authUserId);
	if (userError) throw userError;
	if (userData?.user?.email?.trim().toLowerCase() !== candidate.auth_email.trim().toLowerCase()) {
		throw new Error('Final invitation Auth user email does not match the deterministic alias.');
	}

	const { data, error } = await client.rpc('get_workspace_invitation_auth_identity_repair_candidates', {
		p_invitation_ids: [candidate.invitation_id],
		p_membership_ids: null,
		p_token_hash: null,
	});
	if (error) throw error;
	const [reloaded] = (data ?? []) as WorkspaceInvitationAuthIdentityRepairCandidate[];
	if (
		!reloaded
		|| reloaded.current_auth_user_id !== authUserId
		|| !reloaded.has_email_identity
		|| reloaded.auth_email_matches_invitation !== true
		|| reloaded.profile_id !== candidate.profile_id
		|| reloaded.membership_id !== candidate.membership_id
	) {
		throw new Error('Final invitation Auth identity verification failed.');
	}
}

export async function provisionWorkspaceInvitationAuthIdentities(input: {
	adminClient: SupabaseAdminClient;
	candidates: WorkspaceInvitationAuthIdentityRepairCandidate[];
	correlationId?: string;
}): Promise<WorkspaceInvitationAuthIdentityRepairResult[]> {
	const correlationId = input.correlationId ?? crypto.randomUUID();
	const results: WorkspaceInvitationAuthIdentityRepairResult[] = [];

	for (const candidate of input.candidates) {
		const authEmailMatchesInvitation = candidate.auth_email_matches_invitation !== false;
		if (candidate.has_email_identity && authEmailMatchesInvitation) {
			results.push({
				invitationId: candidate.invitation_id,
				membershipId: candidate.membership_id,
				profileId: candidate.profile_id,
				authUserId: candidate.current_auth_user_id,
				status: 'valid_existing',
			});
			continue;
		}

		let repairStage = 'started';
		logRepairStarted(candidate);
		let replacementAuthUserId = candidate.has_email_identity && !authEmailMatchesInvitation
			? candidate.current_auth_user_id
			: candidate.existing_valid_auth_user_id ?? null;
		let createdReplacementThisAttempt = false;
		let watchtowerLinkageRemapped = candidate.has_email_identity && !authEmailMatchesInvitation;
		try {
			if (!replacementAuthUserId) {
				const temporaryEmail = temporaryEmailFor(candidate);
				repairStage = 'create_temporary_valid_auth_user';
				replacementAuthUserId = await findAuthUserByEmail(input.adminClient, temporaryEmail);
				if (!replacementAuthUserId) {
					const { data, error: createError } = await input.adminClient.auth.admin.createUser({
						email: temporaryEmail,
						email_confirm: false,
						user_metadata: {
							watchtower_invitation_auth_provisioned: true,
							watchtower_invitation_auth_temporary: true,
							watchtower_profile_id: candidate.profile_id,
							watchtower_membership_id: candidate.membership_id,
							watchtower_invitation_id: candidate.invitation_id,
						},
						app_metadata: {
							provider: 'email',
							providers: ['email'],
						},
					});
					if (createError) throw createError;
					replacementAuthUserId = data?.user?.id ?? null;
					createdReplacementThisAttempt = true;
				}
				if (!replacementAuthUserId) throw new Error('Supabase Auth Admin did not return a user id.');
			}

			if (!watchtowerLinkageRemapped) {
				repairStage = 'record_created_user_remap';
				try {
					await recordRepair(
						input.adminClient,
						candidate,
						replacementAuthUserId,
						candidate.existing_valid_auth_user_id ? 'remapped_existing_user' : 'remapped_created_user',
						correlationId,
					);
					watchtowerLinkageRemapped = true;
				} catch (error) {
					if (createdReplacementThisAttempt) {
						try {
							await softDeleteAuthUser(input.adminClient, replacementAuthUserId);
						} catch {
							// Best-effort cleanup only. The original Watchtower linkage was not changed.
						}
					}
					throw error;
				}
			}

			repairStage = 'verify_placeholder_unreferenced';
			await verifyPlaceholderRelease(input.adminClient, candidate, replacementAuthUserId);

			repairStage = 'hard_delete_identityless_placeholder';
			await hardDeleteAuthUser(input.adminClient, placeholderAuthUserIdFor(candidate));

			repairStage = 'assign_deterministic_alias';
			if (!candidate.existing_valid_auth_user_id || !authEmailMatchesInvitation) {
				const { error: aliasError } = await input.adminClient.auth.admin.updateUserById(replacementAuthUserId, {
					email: candidate.auth_email,
					user_metadata: {
						watchtower_invitation_auth_provisioned: true,
						watchtower_invitation_auth_temporary: false,
						watchtower_profile_id: candidate.profile_id,
						watchtower_membership_id: candidate.membership_id,
						watchtower_invitation_id: candidate.invitation_id,
					},
				});
				if (aliasError) throw aliasError;
			}

			repairStage = 'verify_valid_email_identity';
			await verifyFinalAuthIdentity(input.adminClient, candidate, replacementAuthUserId);

			const outcome = candidate.existing_valid_auth_user_id ? 'remapped_existing_user' : 'remapped_created_user';
			results.push({
				invitationId: candidate.invitation_id,
				membershipId: candidate.membership_id,
				profileId: candidate.profile_id,
				authUserId: replacementAuthUserId,
				status: outcome,
			});
			logRepairCompleted(candidate, replacementAuthUserId, outcome);
		} catch (error) {
			const failureMessage = safeFailureMessage(error, 'Invitation Auth identity could not be provisioned.');
			const failureCode = repairStage === 'assign_deterministic_alias'
				? WORKSPACE_INVITATION_AUTH_IDENTITY_ALIAS_FAILURE_CODE
				: WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE;
			logRepairFailed(candidate, repairStage, failureCode);
			try {
				await recordRepairFailure(
					input.adminClient,
					candidate,
					watchtowerLinkageRemapped && replacementAuthUserId ? replacementAuthUserId : candidate.current_auth_user_id,
					correlationId,
					{ code: failureCode, message: failureMessage },
				);
			} catch {
				// The caller records a controlled delivery/setup failure. Avoid logging secrets here.
			}
			results.push({
				invitationId: candidate.invitation_id,
				membershipId: candidate.membership_id,
				profileId: candidate.profile_id,
				authUserId: watchtowerLinkageRemapped && replacementAuthUserId ? replacementAuthUserId : candidate.current_auth_user_id,
				status: 'failed',
				failureCode,
				failureMessage,
			});
		}
	}

	return results;
}
