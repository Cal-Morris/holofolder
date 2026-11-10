import { test } from "node:test"
import assert from "node:assert/strict"
import { changeMembership, collectionScopeLifetime, MEMBERSHIP_LIFECYCLE_KEY, subscribeMembershipLifecycle } from "../lib/collection/membership-lifecycle"

// Synthetic browser and identities. No queue adapter is supplied to lifecycle invalidation.
test("accept/disconnect pause synchronously, retain records and only signal payload-free phases", async () => {
  const target = new EventTarget()
  const messages: string[] = []
  const prior = Object.getOwnPropertyDescriptor(globalThis, "window")
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(target, { localStorage: { setItem: (key: string, value: string) => { assert.equal(key, MEMBERSHIP_LIFECYCLE_KEY); messages.push(value) } } }) })
  try {
    const lifetime = collectionScopeLifetime<{ owner: string; epoch: string }>()
    const record = { pending: [{ operationId: "synthetic-original", status: "unavailable" }], legacy: ["opaque original bytes"] }
    const before = JSON.stringify(record)
    const phases: string[] = []
    const stop = subscribeMembershipLifecycle(phase => { phases.push(phase); lifetime.invalidate() })
    for (const action of ["accept", "disconnect"]) {
      lifetime.establish(lifetime.invalidate(), { owner: "synthetic-same-owner", epoch: action })
      let finish!: () => void
      const pending = changeMembership(() => {
        assert.equal(lifetime.current(), null)
        return new Promise<void>(resolve => { finish = resolve })
      })
      assert.equal(lifetime.current(), null)
      finish(); await pending
    }
    assert.deepEqual(phases, ["pause", "recheck", "pause", "recheck"])
    assert.equal(JSON.stringify(record), before)
    for (const message of messages) {
      const [phase, nonce] = JSON.parse(message)
      assert.ok(["pause", "recheck"].includes(phase)); assert.match(nonce, /^[a-f0-9-]{36}$/)
      assert.equal(JSON.parse(message).length, 2)
    }
    const event = new Event("storage")
    Object.assign(event, { key: MEMBERSHIP_LIFECYCLE_KEY, newValue: JSON.stringify(["pause", "synthetic-nonce"]) })
    target.dispatchEvent(event)
    assert.equal(phases.at(-1), "pause")
    stop()
  } finally { if (prior) Object.defineProperty(globalThis, "window", prior); else Reflect.deleteProperty(globalThis, "window") }
})

test("same-owner relink cannot revive an old request or completion", () => {
  const lifetime = collectionScopeLifetime<{ owner: string; session: string; epoch: string }>()
  const first = lifetime.invalidate()
  const old = { owner: "same", session: "same-auth", epoch: "old" }
  assert.equal(lifetime.establish(first, old), true)
  lifetime.invalidate()
  assert.equal(lifetime.current(), null)
  const next = lifetime.invalidate()
  const fresh = { ...old, epoch: "fresh" }
  assert.equal(lifetime.establish(next, fresh), true)
  assert.equal(lifetime.establish(first, old), false)
  assert.equal(lifetime.isCurrent(first), false)
  assert.equal(lifetime.current(), fresh)
})

test("actual scope hook checks current claims and membership across invalidation", async () => {
  const { execFileSync } = await import("node:child_process")
  execFileSync(process.execPath, [new URL("./fixtures/membership-scope.ts", import.meta.url).pathname], { stdio: "pipe" })
})

test("actual partner accept/disconnect invalidate the same account and block stale loads", async () => {
  const { execFileSync } = await import("node:child_process")
  execFileSync(process.execPath, [new URL("./fixtures/membership-partner.ts", import.meta.url).pathname], { stdio: "pipe" })
})
