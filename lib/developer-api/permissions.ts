export const DEVELOPER_PERMISSIONS = [
  'catalog:read', 'prices:read', 'prices:refresh', 'binders:read', 'binders:write',
  'collection:read', 'collection:write', 'settings:read', 'settings:write', 'sharing:manage', 'partners:manage',
] as const
export type DeveloperPermission = typeof DEVELOPER_PERMISSIONS[number]
export const DEFAULT_DEVELOPER_PERMISSIONS: readonly DeveloperPermission[] = ['catalog:read', 'prices:read', 'binders:read', 'collection:read', 'settings:read']
export class DeveloperAccessError extends Error {
  constructor(public code: string, message: string, public status: number, public retryAfter?: number) { super(message) }
}
export function developerEntitled(access: { source?: unknown; enforced?: unknown }): boolean {
  return access.source === 'subscription' || access.source === 'perpetual'
}
export function normalizePermissions(value: unknown): DeveloperPermission[] {
  if (!Array.isArray(value) || value.length > DEVELOPER_PERMISSIONS.length || value.some(p => !DEVELOPER_PERMISSIONS.includes(p))) {
    throw new DeveloperAccessError('invalid_permissions', 'Choose valid permissions.', 400)
  }
  return [...new Set(value)] as DeveloperPermission[]
}
export function requirePermissions(granted: readonly DeveloperPermission[], required: readonly DeveloperPermission[]) {
  if (required.some(p => !granted.includes(p))) throw new DeveloperAccessError('insufficient_permissions', 'This credential does not have permission for this operation.', 403)
}
