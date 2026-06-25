export function buildProjectPath(workspaceSlug: string, projectSlug: string): string {
	return `/app/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectSlug)}`;
}

export function buildProjectEditPath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/edit`;
}

export function buildProjectRisksPath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/risks`;
}

export function buildProjectNarrativePath(workspaceSlug: string, projectSlug: string): string {
	return `${buildProjectPath(workspaceSlug, projectSlug)}/narrative`;
}
