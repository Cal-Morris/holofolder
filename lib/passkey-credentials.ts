export interface PasskeyCredentialSummary {
  id: string
  device_type: string
  created_at: string
}

export function serializePasskeyCredentials(rows: unknown): PasskeyCredentialSummary[] {
  if (!Array.isArray(rows)) return []

  return rows.flatMap((row): PasskeyCredentialSummary[] => {
    if (!row || typeof row !== "object") return []
    const credential = row as Record<string, unknown>
    if (typeof credential.id !== "string" || typeof credential.created_at !== "string") return []

    return [{
      id: credential.id,
      device_type: typeof credential.device_type === "string" && credential.device_type.length > 0
        ? credential.device_type
        : "Passkey",
      created_at: credential.created_at,
    }]
  })
}

export function isValidPasskeyCredentialId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}
