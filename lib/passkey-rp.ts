function normalizeHost(input: string) {
  const value = input.trim()

  if (!value) return null

  try {
    const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`)
    return url.hostname
  } catch {
    return value.split(":")[0] || null
  }
}

export function getPasskeyRpId(host?: string | null) {
  const explicitRpId = process.env.PASSKEY_RP_ID
  if (explicitRpId) {
    return explicitRpId
  }

  const runtimeHost =
    normalizeHost(host || "") ||
    normalizeHost(process.env.NEXT_PUBLIC_SITE_URL || "") ||
    normalizeHost(process.env.NEXT_PUBLIC_VERCEL_URL || "") ||
    normalizeHost(process.env.VERCEL_URL || "")

  return runtimeHost || "localhost"
}
