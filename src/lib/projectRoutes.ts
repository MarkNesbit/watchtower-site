export function buildProjectPath(workspaceSlug: string, projectSlug: string): string {
	return `/app/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectSlug)}`;
}

export function buildProjectEditPath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/edit`;
}

export function buildProjectDetailsPath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/details`;
}

export function buildProjectRisksPath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/risks`;
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
