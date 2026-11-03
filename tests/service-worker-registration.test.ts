import { test } from "node:test"
import assert from "node:assert/strict"
import { registerServiceWorker, requestPersistentStorage, SERVICE_WORKER_URL } from "../lib/service-worker-registration"

function makeEnv(options: { supported?: boolean; saveData?: boolean; readyState?: string } = {}) {
  const registered: string[] = []
  const idle: Array<() => void> = []
  const listeners = new Map<string, () => void>()
  const env = {
    navigator: {
      serviceWorker: options.supported === false ? undefined : { register: async (url: string) => { registered.push(url) } },
      connection: { saveData: options.saveData ?? false },
    },
    document: { readyState: options.readyState ?? "complete" },
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    requestIdleCallback: (callback: () => void) => idle.push(callback),
    cancelIdleCallback: () => undefined,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  }
  return { env: env as never, registered, idle, listeners }
}

test("registers straight away by default (the binder)", () => {
  const { env, registered } = makeEnv()
  registerServiceWorker({}, env)
  assert.deepEqual(registered, [SERVICE_WORKER_URL])
})

test("whenIdle waits for load, then for idle time", () => {
  const { env, registered, idle, listeners } = makeEnv({ readyState: "loading" })
  registerServiceWorker({ whenIdle: true }, env)
  assert.equal(idle.length, 0)
  listeners.get("load")?.()
  assert.deepEqual(registered, [])
  idle.forEach((run) => run())
  assert.deepEqual(registered, [SERVICE_WORKER_URL])
})

test("whenIdle does nothing on Save-Data, without support, or after cleanup", () => {
  const saveData = makeEnv({ saveData: true })
  registerServiceWorker({ whenIdle: true }, saveData.env)
  assert.equal(saveData.idle.length, 0)

  const unsupported = makeEnv({ supported: false })
  registerServiceWorker({ whenIdle: true }, unsupported.env)
  assert.equal(unsupported.idle.length, 0)

  const cleaned = makeEnv()
  registerServiceWorker({ whenIdle: true }, cleaned.env)()
  cleaned.idle.forEach((run) => run())
  assert.deepEqual(cleaned.registered, [])
})

function storageEnv(persisted: boolean, grant: boolean | Error) {
  const calls = { persist: 0 }
  const env = {
    navigator: {
      storage: {
        persisted: async () => persisted,
        persist: async () => {
          calls.persist++
          if (grant instanceof Error) throw grant
          return grant
        },
      },
    },
  }
  return { env, calls }
}

test("requestPersistentStorage: false when the Storage API is missing", async () => {
  assert.equal(await requestPersistentStorage({ navigator: {} }), false)
  assert.equal(await requestPersistentStorage({}), false)
})

test("requestPersistentStorage: true without asking again when already persisted", async () => {
  const { env, calls } = storageEnv(true, false)
  assert.equal(await requestPersistentStorage(env), true)
  assert.equal(calls.persist, 0)
})

test("requestPersistentStorage: asks once and returns true when granted", async () => {
  const { env, calls } = storageEnv(false, true)
  assert.equal(await requestPersistentStorage(env), true)
  assert.equal(calls.persist, 1)
})

test("requestPersistentStorage: false when refused or persist throws", async () => {
  assert.equal(await requestPersistentStorage(storageEnv(false, false).env), false)
  assert.equal(await requestPersistentStorage(storageEnv(false, new Error("nope")).env), false)
})
