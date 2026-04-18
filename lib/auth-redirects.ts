const PRODUCTION_ORIGIN = "https://binder.cal.gg"
const PASSWORD_RECOVERY_PATH = "/auth/login?mode=recovery"

export function getMagicLinkRedirectUrl() {
  return `${PRODUCTION_ORIGIN}/auth/callback`
}

export function getPasswordRecoveryRedirectUrl() {
  return `${PRODUCTION_ORIGIN}/auth/callback?next=${encodeURIComponent(PASSWORD_RECOVERY_PATH)}`
}
