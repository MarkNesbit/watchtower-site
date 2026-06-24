export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PROJECT_PERMISSIONS = [
	'project.view',
	'project.create',
	'project.viewDashboard',
	'project.editDetails',
] as const;
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number];

export const RISK_PERMISSIONS = ['risk.view', 'risk.create', 'risk.edit'] as const;
export type RiskPermission = (typeof RISK_PERMISSIONS)[number];
export type Permission = ProjectPermission | RiskPermission;

const ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<Permission>> = {
	owner: new Set([...PROJECT_PERMISSIONS, ...RISK_PERMISSIONS]),
	admin: new Set([...PROJECT_PERMISSIONS, ...RISK_PERMISSIONS]),
	member: new Set([...PROJECT_PERMISSIONS, ...RISK_PERMISSIONS]),
	viewer: new Set(['project.view', 'project.viewDashboard', 'risk.view']),
};

export function isWorkspaceRole(role: unknown): role is WorkspaceRole {
	return typeof role === 'string' && WORKSPACE_ROLES.includes(role as WorkspaceRole);
}

export function can(role: unknown, permission: Permission): boolean {
	if (!isWorkspaceRole(role)) return false;
	return ROLE_PERMISSIONS[role].has(permission);
}

export function assertCan(role: unknown, permission: Permission, message = 'Your workspace role does not permit this action.') {
	if (!can(role, permission)) throw new Error(message);
}
