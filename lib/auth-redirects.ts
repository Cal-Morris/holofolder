const PASSWORD_RECOVERY_PATH = "/auth/login?mode=recovery"
const PRODUCTION_SITE_URL = "https://binder.cal.gg"

function normalizeBaseUrl(value?: string | null) {
  if (!value) return null
  const trimmed = value.trim().replace(/\/$/, "")
  if (!trimmed) return null
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed
  }
  return `https://${trimmed}`
}

function getConfiguredBaseUrl() {
  const envUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    process.env.VERCEL_URL

  return normalizeBaseUrl(envUrl)
}

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin.replace(/\/$/, "")
  }

  const configuredBaseUrl = getConfiguredBaseUrl()
  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  if (process.env.NODE_ENV === "production") {
    return PRODUCTION_SITE_URL
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000"
  }
}

export function getMagicLinkRedirectUrl() {
  return `${getBaseUrl()}/auth/callback`
}

export function getPasswordRecoveryRedirectUrl() {
  return `${getBaseUrl()}/auth/callback?next=${encodeURIComponent(PASSWORD_RECOVERY_PATH)}`
}
