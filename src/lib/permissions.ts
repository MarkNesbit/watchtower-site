export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PROJECT_PERMISSIONS = [
	'project.view',
	'project.create',
	'project.viewDashboard',
	'project.editDetails',
] as const;
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number];

const ROLE_PROJECT_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<ProjectPermission>> = {
	owner: new Set(PROJECT_PERMISSIONS),
	admin: new Set(PROJECT_PERMISSIONS),
	member: new Set(PROJECT_PERMISSIONS),
	viewer: new Set(['project.view', 'project.viewDashboard']),
};

export function isWorkspaceRole(role: unknown): role is WorkspaceRole {
	return typeof role === 'string' && WORKSPACE_ROLES.includes(role as WorkspaceRole);
}

export function can(role: unknown, permission: ProjectPermission): boolean {
	if (!isWorkspaceRole(role)) return false;
	return ROLE_PROJECT_PERMISSIONS[role].has(permission);
}

export function assertCan(role: unknown, permission: ProjectPermission, message = 'Your workspace role does not permit this action.') {
	if (!can(role, permission)) throw new Error(message);
}
