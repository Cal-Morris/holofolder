const PASSWORD_RECOVERY_PATH = "/auth/login?mode=recovery"

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin
  }

  const envUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    process.env.VERCEL_URL

  if (!envUrl) {
    return "http://localhost:3000"
  }

  if (envUrl.startsWith("http://") || envUrl.startsWith("https://")) {
    return envUrl.replace(/\/$/, "")
  }

  return `https://${envUrl.replace(/\/$/, "")}`
}

export function getMagicLinkRedirectUrl() {
  return `${getBaseUrl()}/auth/callback`
}

export function getPasswordRecoveryRedirectUrl() {
  return `${getBaseUrl()}/auth/callback?next=${encodeURIComponent(PASSWORD_RECOVERY_PATH)}`
}
