/** A device-local invalidation signal, never membership or owner authority. */
export const MEMBERSHIP_LIFECYCLE_KEY = "holofolder-membership-lifecycle-v1"
export type MembershipLifecyclePhase = "pause" | "recheck"

export function signalMembershipLifecycle(phase: MembershipLifecyclePhase) {
  window.dispatchEvent(new CustomEvent(MEMBERSHIP_LIFECYCLE_KEY, { detail: phase }))
  try { window.localStorage.setItem(MEMBERSHIP_LIFECYCLE_KEY, JSON.stringify([phase, crypto.randomUUID()])) } catch { /* Local invalidation still applies without storage. */ }
}

export function subscribeMembershipLifecycle(listener: (phase: MembershipLifecyclePhase) => void) {
  const local = (event: Event) => {
    const phase = (event as CustomEvent<unknown>).detail
    if (phase === "pause" || phase === "recheck") listener(phase)
  }
  const remote = (event: StorageEvent) => {
    if (event.key !== MEMBERSHIP_LIFECYCLE_KEY || !event.newValue) return
    try {
      const value: unknown = JSON.parse(event.newValue)
      if (Array.isArray(value) && value.length === 2 && (value[0] === "pause" || value[0] === "recheck") && typeof value[1] === "string") listener(value[0])
    } catch { /* Untrusted browser messages cannot grant scope. */ }
  }
  window.addEventListener(MEMBERSHIP_LIFECYCLE_KEY, local)
  window.addEventListener("storage", remote)
  return () => { window.removeEventListener(MEMBERSHIP_LIFECYCLE_KEY, local); window.removeEventListener("storage", remote) }
}

let pendingChanges = 0
export const membershipChangePending = () => pendingChanges > 0

/** Starts synchronously, including before a request whose result may be unknown. */
export async function changeMembership<T>(change: () => Promise<T>) {
  pendingChanges++
  signalMembershipLifecycle("pause")
  try { return await change() }
  finally { if (--pendingChanges === 0) signalMembershipLifecycle("recheck") }
}

/** Every invalidation fences outstanding claims, membership reads and command callbacks. */
export function collectionScopeLifetime<T>() {
  let generation = 0
  let scope: T | null = null
  return {
    current: () => scope,
    isCurrent: (request: number) => request === generation,
    invalidate: () => { scope = null; return ++generation },
    /** Fences older checks but keeps the current scope until a check proves it changed. */
    recheck: () => ++generation,
    establish: (request: number, value: T) => {
      if (request !== generation) return false
      scope = value
      return true
    },
  }
}
