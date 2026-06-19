export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PERMISSIONS = [
	'project.view',
	'project.create',
	'project.viewDashboard',
	'project.editDetails',
	'workspace.manageSettings',
	'workspace.inviteMembers',
	'workspace.approveMembers',
	'workspace.changeMemberRole',
	'workspace.approveExternalInvites',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<Permission>> = {
	owner: new Set<Permission>([
		'project.view',
		'project.create',
		'project.viewDashboard',
		'project.editDetails',
		'workspace.manageSettings',
		'workspace.inviteMembers',
		'workspace.approveMembers',
		'workspace.changeMemberRole',
		'workspace.approveExternalInvites',
	]),
	admin: new Set<Permission>([
		'project.view',
		'project.create',
		'project.viewDashboard',
		'project.editDetails',
		'workspace.manageSettings',
		'workspace.inviteMembers',
		'workspace.approveMembers',
		'workspace.changeMemberRole',
		'workspace.approveExternalInvites',
	]),
	member: new Set<Permission>([
		'project.view',
		'project.create',
		'project.viewDashboard',
		'project.editDetails',
	]),
	viewer: new Set<Permission>(['project.view', 'project.viewDashboard']),
};

export function isWorkspaceRole(role: unknown): role is WorkspaceRole {
	return typeof role === 'string' && WORKSPACE_ROLES.includes(role as WorkspaceRole);
}

export function can(role: unknown, permission: Permission): boolean {
	if (!isWorkspaceRole(role)) return false;
	return ROLE_PERMISSIONS[role].has(permission);
}
