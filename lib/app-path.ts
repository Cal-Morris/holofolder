export const APP_BASE_PATH = "/app"

/** Raw browser URLs need the prefix; Next Link/router add it themselves. */
export function appPath(path: string) {
  if (/^\/app(?:[/?#]|$)/.test(path)) return path
  return path === "/" ? APP_BASE_PATH : `${APP_BASE_PATH}${path}`
}

/** Auth links may contain an old app-relative next path, but may never leave the app. */
export function appReturnPath(path: string | null) {
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020]/.test(path)) return APP_BASE_PATH
  try {
    const url = new URL(appPath(decodeURI(path)), "https://app.local")
    return /^\/app(?:\/|$)/.test(url.pathname) ? `${url.pathname}${url.search}${url.hash}` : APP_BASE_PATH
  } catch {
    return APP_BASE_PATH
  }
}
