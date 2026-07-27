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
	existing_valid_auth_user_id?: string | null;
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
		};
	};
	rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: Error | null }>;
};

export const WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE = 'auth_identity_provisioning_failed';

function safeFailureMessage(error: unknown, fallback: string) {
	const message = error instanceof Error ? error.message : String(error ?? fallback);
	return message
		.replace(/https?:\/\/\S+/gi, '[redacted-link]')
		.replace(/[^\s@]+@[^\s@]+/g, '[redacted-email]')
		.replace(/re_[a-z0-9_-]+/gi, '[redacted-secret]')
		.replace(/\b(?:token|password|authorization)\b/gi, '[redacted]')
		.slice(0, 240) || fallback;
}

function quarantineEmailFor(candidate: WorkspaceInvitationAuthIdentityRepairCandidate) {
	const compactAuthUserId = candidate.current_auth_user_id.replaceAll('-', '').slice(0, 24);
	return `invitation-auth-orphan+${compactAuthUserId}@pending.watchtower.invalid`;
}

function repairLogContext(candidate: WorkspaceInvitationAuthIdentityRepairCandidate) {
	return {
		profileId: candidate.profile_id,
		membershipId: candidate.membership_id,
		invitationId: candidate.invitation_id,
		oldAuthUserId: candidate.current_auth_user_id,
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

export async function provisionWorkspaceInvitationAuthIdentities(input: {
	adminClient: SupabaseAdminClient;
	candidates: WorkspaceInvitationAuthIdentityRepairCandidate[];
	correlationId?: string;
}): Promise<WorkspaceInvitationAuthIdentityRepairResult[]> {
	const correlationId = input.correlationId ?? crypto.randomUUID();
	const results: WorkspaceInvitationAuthIdentityRepairResult[] = [];

	for (const candidate of input.candidates) {
		if (candidate.has_email_identity) {
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
		try {
			if (candidate.existing_valid_auth_user_id) {
				repairStage = 'record_existing_valid_user_remap';
				await recordRepair(
					input.adminClient,
					candidate,
					candidate.existing_valid_auth_user_id,
					'remapped_existing_user',
					correlationId,
				);
				results.push({
					invitationId: candidate.invitation_id,
					membershipId: candidate.membership_id,
					profileId: candidate.profile_id,
					authUserId: candidate.existing_valid_auth_user_id,
					status: 'remapped_existing_user',
				});
				logRepairCompleted(candidate, candidate.existing_valid_auth_user_id, 'remapped_existing_user');
				continue;
			}

			const quarantineEmail = quarantineEmailFor(candidate);
			repairStage = 'quarantine_placeholder_auth_user';
			const { error: quarantineError } = await input.adminClient.auth.admin.updateUserById(
				candidate.current_auth_user_id,
				{
					email: quarantineEmail,
					user_metadata: {
						watchtower_invitation_auth_orphan_quarantined: true,
						watchtower_profile_id: candidate.profile_id,
						watchtower_membership_id: candidate.membership_id,
						watchtower_invitation_id: candidate.invitation_id,
					},
				},
			);
			if (quarantineError) throw quarantineError;

			repairStage = 'create_valid_auth_user';
			const { data, error: createError } = await input.adminClient.auth.admin.createUser({
				email: candidate.auth_email,
				email_confirm: false,
				user_metadata: {
					watchtower_invitation_auth_provisioned: true,
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
			const authUserId = data?.user?.id;
			if (!authUserId) throw new Error('Supabase Auth Admin did not return a user id.');

			repairStage = 'record_created_user_remap';
			await recordRepair(input.adminClient, candidate, authUserId, 'remapped_created_user', correlationId);
			results.push({
				invitationId: candidate.invitation_id,
				membershipId: candidate.membership_id,
				profileId: candidate.profile_id,
				authUserId,
				status: 'remapped_created_user',
			});
			logRepairCompleted(candidate, authUserId, 'remapped_created_user');
		} catch (error) {
			const failureMessage = safeFailureMessage(error, 'Invitation Auth identity could not be provisioned.');
			logRepairFailed(candidate, repairStage);
			try {
				repairStage = 'record_repair_failure';
				await recordRepair(
					input.adminClient,
					candidate,
					candidate.current_auth_user_id,
					'failed',
					correlationId,
					{ code: WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE, message: failureMessage },
				);
			} catch {
				// The caller records a controlled delivery/setup failure. Avoid logging secrets here.
			}
			results.push({
				invitationId: candidate.invitation_id,
				membershipId: candidate.membership_id,
				profileId: candidate.profile_id,
				authUserId: candidate.current_auth_user_id,
				status: 'failed',
				failureCode: WORKSPACE_INVITATION_AUTH_IDENTITY_FAILURE_CODE,
				failureMessage,
			});
		}
	}

	return results;
}
