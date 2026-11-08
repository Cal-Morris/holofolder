import { appPath, appReturnPath } from "@/lib/app-path"

const PASSWORD_RECOVERY_PATH = "/auth/login?mode=recovery"
const PRODUCTION_SITE_URL = "https://holofolder.com"

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

  return "http://localhost:3000"
}

export function getMagicLinkRedirectUrl(returnTo?: string) {
  const callback = `${new URL(getBaseUrl()).origin}${appPath("/auth/callback")}`
  return returnTo ? `${callback}?next=${encodeURIComponent(appReturnPath(returnTo))}` : callback
}

export function getPasswordRecoveryRedirectUrl() {
  return `${getMagicLinkRedirectUrl()}?next=${encodeURIComponent(appPath(PASSWORD_RECOVERY_PATH))}`
}

/**
 * Where a request should go before any page renders: signed-out visitors to the binder (`/`) go to the
 * sign-in page. The proxy answers with this redirect up front, so they never download the binder's HTML
 * and JS (`app/page.tsx` keeps the same redirect as a fallback). Returns null when no redirect applies.
 */
export function getSignedOutRedirectPath(pathname: string, isSignedIn: boolean) {
  if (isSignedIn) return null
  return pathname === "/" ? "/auth/login" : null
}

/** Production proxy requests can reach Vercel with its origin hostname. Never trust arbitrary forwarded hosts. */
export function appRedirectUrl(path: string | null, requestUrl: string) {
  const url = new URL(requestUrl)
  const origin = ["app.holofolder.com", "holofolder.com"].includes(url.hostname)
    ? PRODUCTION_SITE_URL
    : url.origin
  return new URL(appReturnPath(path), origin)
}
