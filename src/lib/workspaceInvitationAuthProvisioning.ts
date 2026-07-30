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
			getUserById(userId: string): Promise<{
				data: { user?: { id?: string; email?: string | null } | null } | null;
				error: Error | null;
			}>;
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

type PlaceholderDeleteResult = 'deleted' | 'admin_missing';
type SupabaseLikeError = Error & { code?: string; details?: string; hint?: string };
type ExtractedStructuredError = {
	code: string | null;
	message: string | null;
	details: string | null;
	hint: string | null;
};

function isObjectLike(value: unknown): value is Record<string, unknown> {
	return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function safeScalarText(value: unknown) {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
	if (value instanceof Error) return value.message;
	return null;
}

function safeStructuralFallback(value: unknown) {
	if (!isObjectLike(value)) return null;
	const safeKeys = Object.keys(value)
		.filter((key) => !/headers?|cookies?|authorization|password|token|secret|payload|request|body/i.test(key))
		.slice(0, 6);
	return safeKeys.length > 0
		? `Unrecognised structured error. Available fields: ${safeKeys.join(', ')}`
		: 'Unrecognised structured error';
}

function extractStructuredSupabaseError(input: unknown): ExtractedStructuredError {
	const extracted: ExtractedStructuredError = {
		code: null,
		message: null,
		details: null,
		hint: null,
	};
	const visited = new WeakSet<object>();
	const queue: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
	const nestedKeys = ['error', 'cause', 'data', 'response', 'body'];

	while (queue.length > 0) {
		const { value, depth } = queue.shift()!;
		if (!extracted.message) extracted.message = safeScalarText(value);
		if (!isObjectLike(value)) continue;

		const objectValue = value as Record<string, unknown>;
		if (visited.has(objectValue)) continue;
		visited.add(objectValue);

		extracted.code ??= safeScalarText(objectValue.code);
		extracted.message ??= safeScalarText(objectValue.message);
		extracted.details ??= safeScalarText(objectValue.details);
		extracted.hint ??= safeScalarText(objectValue.hint);

		if (depth >= 4) continue;
		for (const key of nestedKeys) {
			const nestedValue = objectValue[key];
			if (key !== 'body' && !extracted.message) {
				extracted.message = safeScalarText(nestedValue);
			}
			if (isObjectLike(nestedValue)) {
				queue.push({ value: nestedValue, depth: depth + 1 });
			}
		}
	}

	extracted.message ??= safeStructuralFallback(input);
	return extracted;
}

function safeFailureMessage(error: unknown, fallback: string) {
	const message = safeScalarText(error) ?? extractStructuredSupabaseError(error).message ?? fallback;
	return message
		.replace(/https?:\/\/\S+/gi, '[redacted-link]')
		.replace(/[^\s@]+@[^\s@]+/g, '[redacted-email]')
		.replace(/re_[a-z0-9_-]+/gi, '[redacted-secret]')
		.replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, '[redacted-jwt]')
		.replace(/\b[a-f0-9]{48,}\b/gi, '[redacted-secret]')
		.replace(/\b(password|token|access_token|refresh_token|authorization|service[_ -]?role(?: key)?)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
		.replace(/\bservice[_ -]?role(?: key)?\b/gi, '[redacted-secret]')
		.replace(/\b(?:token|password|authorization|access_token|refresh_token)\b/gi, '[redacted]')
		.slice(0, 240) || fallback;
}

function safeOptionalFailureMessage(value: unknown) {
	if (value === null || value === undefined || value === '') return undefined;
	return safeFailureMessage(value, 'Invitation Auth repair detail redacted.');
}

function safeSupabaseErrorDiagnostics(error: unknown) {
	const supabaseError = extractStructuredSupabaseError(error);
	return {
		supabaseErrorCode: safeOptionalFailureMessage(supabaseError.code),
		safeErrorMessage: safeFailureMessage(error, 'Invitation Auth identity could not be provisioned.'),
		safeDetails: safeOptionalFailureMessage(supabaseError.details),
		safeHint: safeOptionalFailureMessage(supabaseError.hint),
	};
}

function remapFailureCleanupDiagnostics(input: {
	attempted: boolean;
	outcome: string | null;
	newAuthUserRetained: boolean | null;
	requiresManualRepair: boolean;
	cleanupError?: unknown;
}) {
	const cleanupErrorDiagnostics = input.cleanupError
		? {
			cleanupErrorCode: safeOptionalFailureMessage((input.cleanupError as SupabaseLikeError).code),
			safeCleanupErrorMessage: safeFailureMessage(input.cleanupError, 'Invitation Auth repair cleanup failed.'),
			safeCleanupDetails: safeOptionalFailureMessage((input.cleanupError as SupabaseLikeError).details),
			safeCleanupHint: safeOptionalFailureMessage((input.cleanupError as SupabaseLikeError).hint),
		}
		: {};
	return {
		cleanupAttempted: input.attempted,
		cleanupOutcome: input.outcome,
		newAuthUserRetained: input.newAuthUserRetained,
		requiresManualRepair: input.requiresManualRepair,
		...cleanupErrorDiagnostics,
	};
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
		remapOperationName: 'record_workspace_invitation_auth_identity_repair',
		cleanupRequired: false,
		outcome,
	});
}

function logRepairFailed(
	candidate: WorkspaceInvitationAuthIdentityRepairCandidate,
	stage: string,
	failureCode = WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE,
	extra: Record<string, unknown> = {},
) {
	console.error('auth_identity_repair_failed', {
		failureCode,
		stage,
		profileId: candidate.profile_id,
		membershipId: candidate.membership_id,
		invitationId: candidate.invitation_id,
		...extra,
	});
}

function logRepairStage(
	candidate: WorkspaceInvitationAuthIdentityRepairCandidate,
	stage: string,
	newAuthUserId?: string | null,
) {
	console.info(stage, {
		...repairLogContext(candidate),
		...(newAuthUserId ? { newAuthUserId } : {}),
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
		p_old_auth_user_id: placeholderAuthUserIdFor(candidate),
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
		candidate,
		currentAuthUserId,
		'failed',
		correlationId,
		failure,
	);
}

async function findAuthUsersByEmail(client: SupabaseAdminClient, email: string) {
	if (typeof client.auth.admin.listUsers !== 'function') return [];
	const targetEmail = email.trim().toLowerCase();
	const matches: string[] = [];
	for (let page = 1; page <= 10; page += 1) {
		const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
		if (error) throw error;
		const users = data?.users ?? [];
		for (const user of users) {
			if (user.id && typeof user.email === 'string' && user.email.trim().toLowerCase() === targetEmail) {
				matches.push(user.id);
			}
		}
		if (users.length < 1000) break;
	}
	return matches;
}

async function findAuthUserByEmail(client: SupabaseAdminClient, email: string) {
	return (await findAuthUsersByEmail(client, email))[0] ?? null;
}

function isMissingUserError(error: Error | null | undefined) {
	return /not found|no user|user.*missing/i.test(error?.message ?? '');
}

async function softDeleteAuthUser(client: SupabaseAdminClient, authUserId: string) {
	const { error } = await client.auth.admin.deleteUser(authUserId, true);
	if (error && !isMissingUserError(error)) throw error;
}

async function hardDeleteAuthUser(client: SupabaseAdminClient, authUserId: string): Promise<PlaceholderDeleteResult> {
	const { error } = await client.auth.admin.deleteUser(authUserId, false);
	if (error && isMissingUserError(error)) return 'admin_missing';
	if (error) throw error;
	return 'deleted';
}

async function getAuthUserById(client: SupabaseAdminClient, authUserId: string) {
	const { data, error } = await client.auth.admin.getUserById(authUserId);
	if (error && isMissingUserError(error)) return null;
	if (error) throw error;
	return data?.user?.id ? data.user : null;
}

async function verifyAuthUserDeleted(client: SupabaseAdminClient, authUserId: string) {
	const user = await getAuthUserById(client, authUserId);
	if (user?.id) {
		throw new Error('Malformed invitation Auth placeholder still exists after hard deletion.');
	}
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

async function releaseApiInvisiblePlaceholder(
	client: SupabaseAdminClient,
	candidate: WorkspaceInvitationAuthIdentityRepairCandidate,
	replacementAuthUserId: string,
	correlationId: string,
) {
	const { data, error } = await client.rpc('release_workspace_invitation_auth_placeholder', {
		p_invitation_id: candidate.invitation_id,
		p_old_auth_user_id: placeholderAuthUserIdFor(candidate),
		p_new_auth_user_id: replacementAuthUserId,
		p_correlation_id: correlationId,
	});
	if (error) throw error;

	const [release] = (Array.isArray(data) ? data : [data]) as Array<{ result?: string; reason?: string } | null>;
	if (release?.result === 'deleted' || release?.result === 'already_absent') return release.result;

	throw new Error(`Controlled invitation Auth placeholder release was blocked: ${release?.reason ?? 'unknown_reason'}.`);
}

async function verifyFinalAuthIdentity(
	client: SupabaseAdminClient,
	candidate: WorkspaceInvitationAuthIdentityRepairCandidate,
	authUserId: string,
) {
	const user = await getAuthUserById(client, authUserId);
	if (user?.email?.trim().toLowerCase() !== candidate.auth_email.trim().toLowerCase()) {
		throw new Error('Final invitation Auth user email does not match the deterministic alias.');
	}
	const aliasOwners = await findAuthUsersByEmail(client, candidate.auth_email);
	if (aliasOwners.some((ownerId) => ownerId !== authUserId)) {
		throw new Error('Deterministic invitation Auth alias is still owned by another Auth user.');
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
		let repairFailureLogContext: Record<string, unknown> = {};
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
					let cleanupAttempted = false;
					let cleanupOutcome: string | null = replacementAuthUserId ? 'not_attempted' : null;
					let newAuthUserRetained: boolean | null = replacementAuthUserId ? true : null;
					let requiresManualRepair = false;
					let cleanupError: unknown;
					if (createdReplacementThisAttempt) {
						cleanupAttempted = true;
						try {
							await softDeleteAuthUser(input.adminClient, replacementAuthUserId);
							cleanupOutcome = 'deleted_new_auth_user';
							newAuthUserRetained = false;
						} catch (caughtCleanupError) {
							cleanupError = caughtCleanupError;
							cleanupOutcome = 'delete_failed';
							newAuthUserRetained = true;
							requiresManualRepair = true;
							// Best-effort cleanup only. The original Watchtower linkage was not changed.
						}
					} else if (replacementAuthUserId) {
						cleanupOutcome = 'retained_existing_auth_user';
						requiresManualRepair = true;
					}
					repairFailureLogContext = {
						...safeSupabaseErrorDiagnostics(error),
						profileId: candidate.profile_id,
						membershipId: candidate.membership_id,
						invitationId: candidate.invitation_id,
						oldAuthUserId: placeholderAuthUserIdFor(candidate),
						newAuthUserId: replacementAuthUserId,
						remapOperationName: 'record_workspace_invitation_auth_identity_repair',
						...remapFailureCleanupDiagnostics({
							attempted: cleanupAttempted,
							outcome: cleanupOutcome,
							newAuthUserRetained,
							requiresManualRepair,
							cleanupError,
						}),
					};
					throw error;
				}
			}

			repairStage = 'verify_placeholder_unreferenced';
			await verifyPlaceholderRelease(input.adminClient, candidate, replacementAuthUserId);

			const placeholderAuthUserId = placeholderAuthUserIdFor(candidate);
			repairStage = 'placeholder_delete_started';
			logRepairStage(candidate, repairStage, replacementAuthUserId);
			try {
				const deleteResult = await hardDeleteAuthUser(input.adminClient, placeholderAuthUserId);
				repairStage = 'placeholder_delete_api_completed';
				logRepairStage(candidate, repairStage, replacementAuthUserId);
				if (deleteResult === 'admin_missing') {
					repairStage = 'placeholder_sql_release_started';
					logRepairStage(candidate, repairStage, replacementAuthUserId);
					await releaseApiInvisiblePlaceholder(input.adminClient, candidate, replacementAuthUserId, correlationId);
					repairStage = 'placeholder_sql_release_verified';
					logRepairStage(candidate, repairStage, replacementAuthUserId);
				}
				await verifyAuthUserDeleted(input.adminClient, placeholderAuthUserId);
				repairStage = 'placeholder_delete_verified';
				logRepairStage(candidate, repairStage, replacementAuthUserId);
			} catch (error) {
				repairStage = 'placeholder_delete_failed';
				logRepairStage(candidate, repairStage, replacementAuthUserId);
				throw error;
			}

			repairStage = 'deterministic_alias_assignment_started';
			logRepairStage(candidate, repairStage, replacementAuthUserId);
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

			await verifyFinalAuthIdentity(input.adminClient, candidate, replacementAuthUserId);
			repairStage = 'deterministic_alias_assignment_verified';
			logRepairStage(candidate, repairStage, replacementAuthUserId);

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
			const failureCode = repairStage.startsWith('deterministic_alias_assignment')
				? WORKSPACE_INVITATION_AUTH_IDENTITY_ALIAS_FAILURE_CODE
				: WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE;
			logRepairFailed(candidate, repairStage, failureCode, repairFailureLogContext);
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
