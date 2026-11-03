/**
 * Registers the service worker (public/sw.js). The binder registers it straight away; public entry pages
 * (/home, sign-in) register it once the page has loaded and gone idle, so first-visit and signed-out users
 * also get the offline shell without it competing with the page's own loading. Skipped on Save-Data.
 */
export const SERVICE_WORKER_URL = "/sw.js"

interface RegistrationEnvironment {
  navigator: {
    serviceWorker?: { register: (url: string) => Promise<unknown> }
    connection?: { saveData?: boolean }
  }
  document?: { readyState: string }
  addEventListener?: (type: "load", listener: () => void, options?: { once?: boolean }) => void
  removeEventListener?: (type: "load", listener: () => void) => void
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
  setTimeout: (callback: () => void, delay: number) => number
  clearTimeout: (handle: number) => void
}

function register(env: RegistrationEnvironment) {
  env.navigator.serviceWorker?.register(SERVICE_WORKER_URL).catch((error: unknown) => {
    console.error("[binderdex] Failed to register service worker:", error)
  })
}

/** Returns a cleanup function that cancels a registration that hasn't started yet. */
export function registerServiceWorker(
  options: { whenIdle?: boolean } = {},
  env: RegistrationEnvironment = window as unknown as RegistrationEnvironment,
): () => void {
  if (!env.navigator.serviceWorker) return () => undefined
  if (!options.whenIdle) {
    register(env)
    return () => undefined
  }
  if (env.navigator.connection?.saveData) return () => undefined

  let cancelled = false
  let idleHandle: number | null = null
  let timeoutHandle: number | null = null

  const run = () => {
    idleHandle = null
    timeoutHandle = null
    if (!cancelled) register(env)
  }
  const scheduleIdle = () => {
    if (cancelled) return
    if (typeof env.requestIdleCallback === "function") {
      idleHandle = env.requestIdleCallback(run, { timeout: 5000 })
    } else {
      timeoutHandle = env.setTimeout(run, 2000)
    }
  }

  const loaded = !env.document || env.document.readyState === "complete"
  if (loaded) {
    scheduleIdle()
  } else {
    env.addEventListener?.("load", scheduleIdle, { once: true })
  }

  return () => {
    cancelled = true
    env.removeEventListener?.("load", scheduleIdle)
    if (idleHandle !== null) env.cancelIdleCallback?.(idleHandle)
    if (timeoutHandle !== null) env.clearTimeout(timeoutHandle)
  }
}

interface StorageEnvironment {
  navigator?: { storage?: { persisted?: () => Promise<boolean>; persist?: () => Promise<boolean> } }
}

/**
 * Asks the browser to keep this site's caches (prepared show thumbnails, OCR, card data) instead of
 * evicting them under storage pressure. Best effort: resolves false when unsupported or on error.
 */
export async function requestPersistentStorage(
  env: StorageEnvironment = (typeof window === "undefined" ? {} : window) as unknown as StorageEnvironment,
): Promise<boolean> {
  const storage = env.navigator?.storage
  if (!storage || typeof storage.persist !== "function") return false
  try {
    if (typeof storage.persisted === "function" && (await storage.persisted())) return true
    return Boolean(await storage.persist())
  } catch {
    return false
  }
}
