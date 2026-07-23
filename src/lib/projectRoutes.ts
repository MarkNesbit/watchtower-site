export function buildProjectPath(workspaceSlug: string, projectSlug: string): string {
	return `/app/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectSlug)}`;
}

export function buildWorkspaceTeamPath(workspaceSlug: string): string {
	return `/app/workspaces/${encodeURIComponent(workspaceSlug)}/team`;
}

export function buildWorkspaceTeamExportPath(workspaceSlug: string): string {
	return `${buildWorkspaceTeamPath(workspaceSlug)}/export`;
}

export function buildWorkspaceTeamCheckoutReleasePath(workspaceSlug: string): string {
	return `${buildWorkspaceTeamExportPath(workspaceSlug)}/release`;
}

export function buildWorkspaceTeamImportPath(workspaceSlug: string): string {
	return `${buildWorkspaceTeamPath(workspaceSlug)}/import`;
}

export function buildWorkspaceTeamImportReviewPath(workspaceSlug: string, importRunId: string): string {
	return `${buildWorkspaceTeamPath(workspaceSlug)}/imports/${encodeURIComponent(importRunId)}/review`;
}

export function buildWorkspaceTeamImportReviewConfirmPath(workspaceSlug: string, importRunId: string): string {
	return `${buildWorkspaceTeamImportReviewPath(workspaceSlug, importRunId)}/confirm`;
}

export function buildWorkspaceTeamImportReviewDraftPath(workspaceSlug: string, importRunId: string): string {
	return `${buildWorkspaceTeamImportReviewPath(workspaceSlug, importRunId)}/draft`;
}

export function buildWorkspaceTeamImportApplyPath(workspaceSlug: string, importRunId: string): string {
	return `${buildWorkspaceTeamPath(workspaceSlug)}/imports/${encodeURIComponent(importRunId)}/apply`;
}

export function buildWorkspaceTeamInvitationSendPath(workspaceSlug: string): string {
	return `${buildWorkspaceTeamPath(workspaceSlug)}/invitations/send`;
}

export function buildProjectEditPath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/edit`;
}

export function buildProjectDetailsPath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/details`;
}

export function buildProjectTimelinePath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/timeline`;
}

export function buildProjectRisksPath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/risks`;
}

export function buildProjectActionsPath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/actions`;
}

export function buildProjectActionPath(workspaceSlug: string, projectSlug: string, actionId: string): string {
	return `${buildProjectActionsPath(workspaceSlug, projectSlug)}/${encodeURIComponent(actionId)}`;
}

export function buildProjectNewRiskPath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectRisksPath(workspaceSlug, projectSlug)}/new`;
}

export function buildProjectRiskPath(workspaceSlug: string, projectSlug: string, riskId: string): string {
	return `${buildProjectRisksPath(workspaceSlug, projectSlug)}/${encodeURIComponent(riskId)}`;
}

export function buildProjectRiskEditPath(workspaceSlug: string, projectSlug: string, riskId: string): string {
	return `${buildProjectRiskPath(workspaceSlug, projectSlug, riskId)}/edit`;
}

export function buildProjectNarrativePath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/narrative`;
}
