import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER } from './fixtures'
import type { Page } from '@playwright/test'
import type { SlotOfflineRecord } from '../lib/collection/slot-offline-queue'

const collection = '22222222-2222-4222-8222-222222222222'
const remaining = '33333333-3333-4333-8333-333333333333'
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`
const button = (p: Page, name: string) => p.getByRole('button', { name, exact: true })
const dialog = (p: Page) => p.getByRole('dialog', { name: 'Delete collection', exact: true })
async function record(page: Page): Promise<SlotOfflineRecord> {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some(db => db.name === 'binderdex-offline')) return undefined as unknown as SlotOfflineRecord
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open('binderdex-offline'); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction('records').objectStore('records').getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close(); return rows.find(r => !!r && typeof r === 'object' && 'pending' in r) as SlotOfflineRecord
  })
}
async function review(page: Page, isDefault = true) {
  await button(page, 'Delete collection').click()
  if (isDefault) {
    await expect(button(page, 'Review collection deletion')).toBeDisabled()
    await page.getByRole('combobox', { name: 'Replacement default collection', exact: true }).selectOption(remaining)
  }
  await button(page, 'Review collection deletion').click()
  await expect(button(page, 'Confirm collection deletion')).toBeDisabled()
  await dialog(page).getByRole('checkbox').check()
}
async function confirm(page: Page) { await button(page, 'Confirm collection deletion').click() }
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  // Synthetic auth/PostgREST/ledger only; actual host, handlers, complete reads, sender and IDB.
  await context.addCookies([{ name: 'hf-storage-fixture', value: `delete-${crypto.randomUUID()}`, url: baseURL! }])
})

test('explicit default replacement and exact consequences retain duplicate raw, graded and unknown copies atomically', async ({ page, insets }) => {
  const bodies: { commands: { kind: string; slots: { id: string }[]; replacementDefaultCollectionId: string }[] }[] = []
  await page.route('**/app/e2e-harness/storage/inventory', async route => { bodies.push(route.request().postDataJSON()); await route.continue() })
  await page.goto(entry)
  await expect.poll(async () => (await record(page))?.snapshot?.items.length).toBe(4)
  const before = (await record(page)).snapshot!
  const browse = await button(page, 'Delete collection').boundingBox()
  await review(page)
  await expect(dialog(page)).toContainText('Synthetic storage')
  await expect(dialog(page)).toContainText('Slots to delete: 5 · Targets to delete: 2 · Explicit wants to delete: 2 · Owned copies retained Unassigned: 4')
  await expect(dialog(page)).toContainText('Want to delete: Synthetic explicit want')
  await expect(dialog(page)).toContainText('Recorded graded copy, metadata retained')
  await expect(dialog(page)).toContainText('unknown printing')
  await expect(dialog(page)).toContainText('New default: Synthetic retained collection')
  expect(bodies).toHaveLength(0); expect((await record(page)).pending).toHaveLength(0)
  const h = new Harness(page, insets, true)
  await h.expectWithinSafeViewport(dialog(page)); await h.expectNoHorizontalOverflow()
  for (const name of ['Confirm collection deletion', 'Cancel deletion', 'Close collection deletion']) {
    await h.expectMinTapTarget(button(page, name), 36); await h.expectHittable(button(page, name))
  }
  console.log('deletion geometry', test.info().project.name, JSON.stringify({ browse, review: await dialog(page).boundingBox() }))
  await button(page, 'Confirm collection deletion').evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click() })
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(bodies).toHaveLength(1); expect(bodies[0].commands).toHaveLength(1)
  expect(bodies[0].commands[0].kind).toBe('deleteCollection')
  expect(bodies[0].commands[0].slots.map(s => s.id)).toEqual(before.binders[0].slots.map(s => s.id))
  expect(bodies[0].commands[0].replacementDefaultCollectionId).toBe(remaining)
  expect((await record(page)).snapshot!.items).toEqual(before.items)
  expect((await record(page)).snapshot!.placements).toHaveLength(0)
  expect((await record(page)).snapshot!.collections.map(c => c.id)).toEqual([remaining])
  await expect(page.getByRole('combobox', { name: 'Collection', exact: true })).toHaveValue(remaining)
  await expect(button(page, 'Undo')).toHaveCount(0)
})
for (const [kind, size] of [['dex', 1025], ['max', 4096]] as const) test(`${size} targets remain one atomic deletion with all preview pages accessible`, async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'hf-storage-fixture', value: `delete-${kind}-${crypto.randomUUID()}`, url: baseURL! }])
  const bodies: { commands: { slots: unknown[] }[] }[] = []
  await page.route('**/app/e2e-harness/storage/inventory', async route => { bodies.push(route.request().postDataJSON()); await route.continue() })
  await page.goto(entry); await review(page)
  await expect(dialog(page)).toContainText(`Slots to delete: ${size} · Targets to delete: ${size}`)
  await expect(dialog(page).getByRole('region', { name: 'Delete saved slot 1', exact: true })).toBeVisible()
  await button(page, 'Next preview page').click()
  await expect(dialog(page).getByRole('region', { name: 'Delete saved slot 41', exact: true })).toBeVisible()
  await confirm(page)
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 20000 }).toBe(1)
  expect(bodies).toHaveLength(1); expect(bodies[0].commands[0].slots).toHaveLength(size)
  expect((await record(page)).snapshot!.items).toHaveLength(4)
})

test('non-default deletion has no replacement choice, shared dismissal never dispatches', async ({ page, context, baseURL, insets }) => {
  await context.addCookies([{ name: 'hf-storage-fixture', value: `delete-secondary-${crypto.randomUUID()}`, url: baseURL! }])
  await page.goto(entry)
  const h = new Harness(page, insets, true)
  for (const action of ['cancel', 'close', 'escape', 'back', 'backdrop', 'swipe', 'dock']) {
    await review(page, false)
    await expect(page.getByRole('combobox', { name: 'Replacement default collection' })).toHaveCount(0)
    if (action === 'cancel') await button(page, 'Cancel deletion').click()
    if (action === 'close') await button(page, 'Close collection deletion').click()
    if (action === 'escape') await page.keyboard.press('Escape')
    if (action === 'back') await page.goBack()
    if (action === 'backdrop') await h.tapBackdrop(dialog(page))
    if (action === 'swipe') await h.swipeDown(dialog(page))
    if (action === 'dock') await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Inventory', exact: true }).click()
    await expect(dialog(page)).toHaveCount(0); await h.expectScrollUnlocked()
  }
  expect((await record(page)).pending).toHaveLength(0)
})

test('IDB abort retries identical original reviewed operation, no sender before commit', async ({ page }) => {
  let body = ''
  await page.route('**/app/e2e-harness/storage/inventory', async route => { body = route.request().postData()!; await route.continue() })
  await page.goto(entry); await review(page)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put; let aborted = false
    IDBObjectStore.prototype.put = function(value, key) {
      const r = key === undefined ? put.call(this, value) : put.call(this, value, key)
      if (value?.pending?.[0]?.intent && !aborted) { aborted = true; sessionStorage.setItem('aborted-deletion', JSON.stringify(value.pending[0].intent)); this.transaction.abort() }
      return r
    }
  })
  await confirm(page); await expect(dialog(page)).toContainText('Could not save this draft on device')
  await expect(button(page, 'Retry same collection deletion')).toBeEnabled()
  expect(body).toBe(''); expect((await record(page)).pending).toHaveLength(0)
  const original = await page.evaluate(() => JSON.parse(sessionStorage.getItem('aborted-deletion')!))
  await button(page, 'Retry same collection deletion').click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(JSON.parse(body)).toEqual(original.request); expect((await record(page)).receipts[0].intent).toEqual(original)
})

test('lost committed reply survives reload with original operation, failed fresh read cannot ACK', async ({ page }) => {
  let failRead = false
  const bodies: string[] = []
  await page.route('**/app/e2e-harness/storage/inventory', async route => {
    bodies.push(route.request().postData()!); const response = await route.fetch()
    if (bodies.length === 1) { failRead = true; await route.abort('failed') } else await route.fulfill({ response })
  })
  await page.route('**/app/e2e-harness/storage/inventory?*', route => failRead ? route.abort('failed') : route.continue())
  await page.goto(entry); await review(page); await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('unavailable')
  const original = (await record(page)).pending[0].intent
  await page.reload(); expect((await record(page)).pending[0].intent).toEqual(original)
  expect((await record(page)).receipts).toHaveLength(0)
  failRead = false
  await button(page, 'Retry pending sync').evaluateAll(buttons => (buttons[0] as HTMLButtonElement | undefined)?.click())
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15000 }).toBe(1)
  expect(new Set(bodies).size).toBe(1)
})

for (const change of ['default', 'wants'] as const) test(`fresh changed ${change} blocks initial confirmation before enqueue`, async ({ page }) => {
  let changed = false, sends = 0
  await page.route('**/app/e2e-harness/storage/inventory?*', async route => {
    const response = await route.fetch(), body = await response.json()
    if (changed && change === 'default') body.defaultCollectionId = remaining
    if (changed && change === 'wants') body.snapshot.binders[0].slots[0].wantedCards[0].card_name = 'Synthetic changed want'
    await route.fulfill({ response, json: body })
  })
  await page.route('**/app/e2e-harness/storage/inventory', route => { sends++; return route.continue() })
  await page.goto(entry); await review(page); changed = true; await confirm(page)
  await expect(dialog(page)).toContainText('This review is blocked')
  expect(sends).toBe(0); expect((await record(page)).pending).toHaveLength(0)
})

test('offline and unknown default evidence refuse confirmation with concrete guidance', async ({ page, context, baseURL }) => {
  await page.goto(entry); await review(page); await context.setOffline(true)
  await expect(button(page, 'Confirm collection deletion')).toBeDisabled()
  expect((await record(page)).pending).toHaveLength(0)
  await context.setOffline(false); await button(page, 'Cancel deletion').click()
  await context.addCookies([{ name: 'hf-storage-fixture', value: `delete-unknown-default-${crypto.randomUUID()}`, url: baseURL! }])
  await page.reload(); await button(page, 'Delete collection').click()
  await expect(dialog(page)).toContainText('default evidence are required')
  await expect(button(page, 'Review collection deletion')).toBeDisabled()
})

for (const change of ['signout', 'account', 'owner'] as const) test(`${change} fences an in-flight deletion and late ACK`, async ({ page }) => {
  let release!: () => void, started!: () => void
  const barrier = new Promise<void>(yes => { release = yes }), sending = new Promise<void>(yes => { started = yes })
  await page.route('**/app/e2e-harness/storage/inventory', async route => { const response = await route.fetch(); started(); await barrier; await route.fulfill({ response }).catch(() => {}) })
  await page.goto(entry); await review(page); await confirm(page); await sending
  const original = (await record(page)).pending[0].intent
  if (change === 'owner') await page.route('**/rest/v1/partnerships*', route => route.fulfill({ json: [{ id: 'synthetic-membership', owner_user_id: remaining, user1_id: E2E_USER.id, user2_id: remaining }] }))
  await page.evaluate(({ change, user }) => { const c = new BroadcastChannel('sb-127-auth-token')
    c.postMessage(change === 'signout' ? { event: 'SIGNED_OUT', session: null } : { event: change === 'account' ? 'SIGNED_IN' : 'TOKEN_REFRESHED', session: { user: change === 'account' ? { ...user, id: '55555555-5555-4555-8555-555555555555' } : user } }); c.close()
  }, { change, user: E2E_USER })
  await expect(dialog(page)).toHaveCount(0); await expect(button(page, 'Delete collection')).not.toBeVisible()
  release(); expect((await record(page)).pending[0].intent).toEqual(original); expect((await record(page)).receipts).toHaveLength(0)
})

test('accepted HTTP reply requires a separate fresh complete read before ACK', async ({ page }) => {
  let sent = false, failRead = true
  await page.route('**/app/e2e-harness/storage/inventory', async route => { const response = await route.fetch(); sent = true; await route.fulfill({ response }) })
  await page.route('**/app/e2e-harness/storage/inventory?*', route => sent && failRead ? route.abort('failed') : route.continue())
  await page.goto(entry); await review(page); await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('unavailable')
  expect((await record(page)).receipts).toHaveLength(0)
  failRead = false; await page.reload()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
})

test('live concurrent revision rejects whole deletion, retains original and offers no automatic replacement', async ({ page }) => {
  await page.route('**/app/e2e-harness/storage/inventory', async route => {
    const body = route.request().postDataJSON(), operationId = 'synthetic-concurrent-deletion'
    const changed = await route.fetch({ url: route.request().url().replace(/inventory$/, 'slots'), headers: { ...route.request().headers(), 'x-storage-operation': operationId }, postData: JSON.stringify({ operationId,
      inventoryRevision: body.inventoryRevision, collectionId: collection, collectionVersion: body.collections[0].version, layoutRevision: body.collections[0].layoutRevision,
      commands: [{ kind: 'create', ids: ['synthetic-partner-slot'], beforeSlotId: null }] }) })
    expect(changed.status()).toBe(200)
    const response = await route.fetch(); expect(response.status()).toBe(409); await route.fulfill({ response })
  })
  await page.goto(entry); await review(page); await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('conflict')
  const retained = (await record(page)).pending[0].intent
  if (retained.kind !== 'inventory') throw new Error('Expected retained inventory deletion')
  expect(retained.request.commands).toHaveLength(1)
  expect(retained.request.commands[0].kind).toBe('deleteCollection')
  expect((await record(page)).receipts).toHaveLength(0)
  expect((await record(page)).snapshot!.items).toHaveLength(4)
})

test('mixed legacy/native owner fails complete-read admission, no deletion or automatic conversion', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'hf-storage-fixture', value: `delete-legacy-${crypto.randomUUID()}`, url: baseURL! }])
  let sends = 0
  await page.route('**/app/e2e-harness/storage/inventory', route => { sends++; return route.continue() })
  await page.goto(entry)
  await expect(page.getByText('Could not refresh storage. Showing only saved copies; pending edits are retained.')).toBeVisible()
  await expect(button(page, 'Delete collection')).toHaveCount(0)
  expect(sends).toBe(0)
})
