import { DEFAULT_DEVELOPER_PERMISSIONS, DeveloperAccessError, normalizePermissions } from './permissions';
export function normalizeKeyInput(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 60)
    throw new DeveloperAccessError('invalid_name', 'Name the key using 1 to 60 characters.', 400);
  const expiryDays = body.expiryDays ?? 90;
  if (typeof expiryDays !== 'number' || ![30, 90, 365].includes(expiryDays))
    throw new DeveloperAccessError('invalid_expiry', 'Choose 30, 90 or 365 days.', 400);
  return {
    name,
    expiryDays,
    permissions: normalizePermissions(body.permissions ?? [...DEFAULT_DEVELOPER_PERMISSIONS]),
  };
}
