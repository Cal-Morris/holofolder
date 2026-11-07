export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const username = value.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(username) ? username : null
}

export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) return null
  const name = value.trim().replace(/\s+/g, ' ')
  return name && name.length <= 60 ? name : null
}

export function accountDisplayName(metadata: Record<string, unknown>): string {
  return normalizeDisplayName(metadata.display_name) ?? normalizeDisplayName(metadata.name) ?? normalizeDisplayName(metadata.full_name) ?? ''
}

export function notificationFirstName(metadata: Record<string, unknown>): string {
  const name = accountDisplayName(metadata)
  return name && name !== 'Your partner' && !name.includes('@') ? name.split(' ')[0] : 'Your partner'
}
