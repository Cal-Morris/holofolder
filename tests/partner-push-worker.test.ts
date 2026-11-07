import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const person = '00000000-0000-4000-8000-000000000001'
const eventId = '00000000-0000-4000-8000-000000000002'
const binder = '00000000-0000-4000-8000-000000000003'
function runtime(account: string | null, response: { ok: boolean; json?: () => Promise<unknown> }) {
  const handlers = new Map<string, (event: unknown) => void>()
  const notifications: Array<{ title: string; options: Record<string, unknown> }> = []
  const destinations: string[] = []
  let reads = 0
  const transaction = { objectStore: () => ({ get: () => {
    const request: { result: unknown; onsuccess?: () => void } = { result: { userId: account } }
    queueMicrotask(() => request.onsuccess?.())
    return request
  } }) }
  runInNewContext(worker, {
    URL, AbortSignal, console, setTimeout, clearTimeout,
    indexedDB: { open: () => {
      const request: { result: unknown; onsuccess?: () => void } = { result: { transaction: () => transaction, close() {} } }
      queueMicrotask(() => request.onsuccess?.())
      return request
    } },
    fetch: async () => { reads++; return response },
    self: { location: { origin: 'https://binder.test' }, addEventListener: (name: string, callback: (event: unknown) => void) => handlers.set(name, callback),
      registration: { showNotification: async (title: string, options: Record<string, unknown>) => { notifications.push({ title, options }) } },
      clients: { matchAll: async () => [], openWindow: async (url: string) => { destinations.push(url) } },
    },
  })
  const dispatch = async (name: string, data: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve()
    handlers.get(name)?.({ ...data, waitUntil: (work: Promise<unknown>) => { pending = work } })
    await pending
  }
  return { notifications, destinations, reads: () => reads, dispatch }
}

test('worker fetches an authorized preview, constrains click destinations and rechecks membership', async () => {
  const app = runtime(person, { ok: true, json: async () => ({ title: 'Partner got Bulbasaur', body: 'Synthetic card fixture', url: `/?binder=${binder}` }) })
  await app.dispatch('push', { data: { json: () => ({ recipientId: person, eventId, tag: 'synthetic-event' }) } })
  assert.equal(app.notifications[0].title, 'Partner got Bulbasaur')
  assert.equal(app.reads(), 1)
  await app.dispatch('notificationclick', { notification: { close() {}, data: app.notifications[0].options.data } })
  assert.equal(app.reads(), 2)
  assert.deepEqual(app.destinations, [`/?binder=${binder}`])
  const unsafe = runtime(person, { ok: true, json: async () => ({ title: 'Update', url: 'https://evil.test/' }) })
  await unsafe.dispatch('push', { data: { json: () => ({ recipientId: person, eventId }) } })
  assert.equal((unsafe.notifications[0].options.data as { url: string }).url, '/')
})

test('worker redacts previews after unlink, signout, account change and unavailable authorization', async () => {
  for (const account of [person, null, 'different-account']) {
    const app = runtime(account, { ok: false })
    await app.dispatch('push', { data: { json: () => ({ recipientId: person, eventId, title: 'Private payload is ignored', body: 'Secret card' }) } })
    assert.equal(app.notifications[0].title, 'BinderDex update')
    assert.equal(app.notifications[0].options.body, 'Open the app to see your update.')
    assert.equal(app.reads(), account === person ? 1 : 0)
    await app.dispatch('notificationclick', { notification: { close() {}, data: app.notifications[0].options.data } })
    assert.deepEqual(app.destinations, ['/'])
  }
})
