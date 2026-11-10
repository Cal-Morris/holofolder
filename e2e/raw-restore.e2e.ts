import { readFile } from 'node:fs/promises'
import { test, expect, mockBackends, emulateStandalone, Harness } from './fixtures'
import type { Page } from '@playwright/test'
import { parseBinderBackupV2 } from '../lib/binder-backup-v2'
const collection = '22222222-2222-4222-8222-222222222222'
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Collection data backup', exact: true })
async function record(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('binderdex-offline'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const rows = await new Promise<unknown[]>((resolve, reject) => { const r = db.transaction('records').objectStore('records').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    db.close()
    return rows.find((r): r is { pending: { intent: { kind: string; request: { operationId: string } }; rawRestoreProof?: { receipt: unknown; rejection: unknown }; base: unknown }[]; receipts: unknown[]; snapshot: { items: { id: string }[]; placements: { inventoryItemId: string }[] } } => !!r && typeof r === 'object' && 'pending' in r && 'scope' in r) ?? null
  })
}
async function inspect(page: Page) {
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  const d = dialog(page)
  await d.getByRole('combobox', { name: 'Export scope' }).selectOption('collection')
  const downloaded = page.waitForEvent('download')
  await d.getByRole('button', { name: 'Download collection data', exact: true }).click()
  const backup = parseBinderBackupV2(await readFile((await (await downloaded).path())!, 'utf8'))
  const b = structuredClone(backup)
  b.binders[0].slots[0].inventoryItemId = 'synthetic-restore-copy-1'
  b.binders[0].slots[1].inventoryItemId = null; b.binders[0].slots[1].status = null
  b.placements = [{ ...b.placements[1], slotId: 'synthetic-slot-0' }]
  b.items = b.items.filter(i => i.id === 'synthetic-restore-copy-1')
  const before = await record(page), posts: string[] = []
  const listener = (request: import('@playwright/test').Request) => { if (request.method() !== 'GET') posts.push(request.url()) }
  page.on('request', listener)
  await d.getByLabel('Select backup file').setInputFiles({ name: 'synthetic-restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(b)) })
  await expect(d.getByRole('region', { name: 'Backup preview' })).toBeVisible()
  expect(posts).toEqual([]); expect(await record(page)).toEqual(before)
  await d.getByRole('button', { name: 'Review raw collection locally' }).click()
  await expect(d.getByText('Private server review is a separate action.', { exact: false })).toBeVisible()
  expect(posts).toEqual([]); expect(await record(page)).toEqual(before)
  page.off('request', listener)
  return d
}
async function review(page: Page) {
  const d = await inspect(page)
  const send = d.getByRole('button', { name: 'Send private file for restore review' })
  await expect(send).toBeDisabled()
  await d.getByRole('checkbox', { name: 'Release copy synthetic-restore-copy-0 to Unassigned, keep ownership' }).check()
  await send.click()
  await expect(d.getByRole('button', { name: 'Confirm and save raw restore' })).toBeEnabled()
  return d
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: 'hf-storage-fixture', value: `restore-${crypto.randomUUID()}`, url: baseURL! }])
})
test('actual Backup reviews explicit releases locally, plans privately, commits via durable IDB then fresh read ACK', async ({ page, insets }) => {
  await page.goto(entry); const d = await review(page), h = new Harness(page, insets, true)
  const confirm = d.getByRole('button', { name: 'Confirm and save raw restore' })
  await confirm.scrollIntoViewIfNeeded(); await h.expectMinTapTarget(confirm); await h.expectHittable(confirm); await h.expectWithinSafeViewport(confirm)
  const panel = (await d.boundingBox())!, dock = (await h.dock().boundingBox())!
  expect(panel.y + panel.height).toBeLessThanOrEqual(dock.y)
  let durableAtDelivery = false
  await page.route('**/app/e2e-harness/storage/raw-restore', async route => {
    if (!route.request().postDataJSON().action) {
      const saved = await record(page)
      durableAtDelivery = saved?.pending[0].intent.kind === 'raw-restore' && saved.pending[0].base === null
    }
    await route.continue()
  })
  await confirm.click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(durableAtDelivery).toBe(true)
  const saved = (await record(page))!
  expect(saved.pending).toHaveLength(0); expect(saved.snapshot.items).toHaveLength(2); expect(saved.snapshot.placements).toHaveLength(1)
  expect(saved.snapshot.placements[0].inventoryItemId).toBe('synthetic-restore-copy-1')
  await h.expectNoHorizontalOverflow()
  const denial = await page.request.post('/app/api/raw-content-restore', { data: { action: 'plan' } })
  expect(denial.status()).toBe(503); expect(denial.headers()['cache-control']).toBe('private, no-store')
})
test('lost committed reply survives reload as exact intent, fences sinks, retries same ID and ACKs fresh current state', async ({ page }) => {
  await page.goto(entry); const d = await review(page)
  const bodies: string[] = []
  let dropReply = true
  await page.route('**/app/e2e-harness/storage/raw-restore', async route => {
    if (route.request().postDataJSON().action) return route.continue()
    bodies.push(route.request().postData()!)
    const response = await route.fetch()
    if (dropReply) await route.abort('failed')
    else await route.fulfill({ response })
  })
  await d.getByRole('button', { name: 'Confirm and save raw restore' }).click()
  await expect.poll(() => bodies.length).toBeGreaterThan(0)
  const pending = (await record(page))!.pending[0].intent
  await d.getByRole('button', { name: 'Close backup' }).click()
  await expect(page.getByRole('button', { name: 'New binder', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Edit layout', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Remove selected slots?$/ })).toHaveCount(0)
  await page.reload()
  await expect.poll(async () => (await record(page))?.pending[0]?.intent).toEqual(pending)
  await expect(page.getByRole('button', { name: /^Remove selected slots?$/ })).toHaveCount(0)
  dropReply = false
  await expect.poll(async () => (await record(page))?.pending.length).toBe(0)
  expect(bodies.length).toBeGreaterThan(1); expect(new Set(bodies).size).toBe(1)
})
test('dedicated authenticated rejection needs explicit discard and another current read, keeps original proof', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'hf-storage-fixture', value: `restore-rejection-${crypto.randomUUID()}`, url: baseURL! }])
  await page.goto(entry); const d = await review(page)
  await d.getByRole('button', { name: 'Confirm and save raw restore' }).click()
  await expect.poll(async () => !!(await record(page))?.pending[0]?.rawRestoreProof?.rejection).toBe(true)
  await d.getByRole('button', { name: 'Close backup' }).click()
  const discard = page.getByRole('button', { name: 'Discard rejected raw restore' })
  await expect(discard).toBeVisible(); await discard.click()
  await expect.poll(async () => (await record(page))?.pending.length).toBe(0)
  expect((await record(page))!.receipts).toHaveLength(1)
  expect((await record(page))!.snapshot.placements).toHaveLength(2)
})
test('actual IDB transaction failure prevents delivery and retains no half-restored state', async ({ page }) => {
  await page.goto(entry); const d = await review(page), before = await record(page)
  const deliveries: string[] = []
  page.on('request', request => { if (request.url().endsWith('/storage/raw-restore') && !request.postDataJSON().action) deliveries.push(request.url()) })
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, key) {
      if (typeof key === 'string' && key.startsWith('slot-intent:') && value.pending?.some((p: { intent: { kind: string } }) => p.intent.kind === 'raw-restore')) {
        throw new DOMException('Synthetic IDB quota failure', 'QuotaExceededError')
      }
      return put.call(this, value, key)
    }
  })
  await d.getByRole('button', { name: 'Confirm and save raw restore' }).click()
  await expect(d.getByRole('status')).toContainText('Synthetic IDB quota failure')
  expect(deliveries).toEqual([]); expect(await record(page)).toEqual(before)
})
test('a competing current edit invalidates confirmation before enqueue, no refreshed-ID or plan retry', async ({ page }) => {
  await page.goto(entry); const d = await review(page)
  const plans: string[] = []
  page.on('request', request => { if (request.url().endsWith('/storage/raw-restore')) plans.push(request.postData()!) })
  const edit = await page.request.post('/app/e2e-harness/storage/slots', { headers: { Origin: new URL(page.url()).origin,
    'X-Binder-Owner': '00000000-0000-4000-8000-0000000000e2', 'X-Binder-Auth-Session': 'synthetic-e2e-auth-session', 'X-Storage-Operation': 'synthetic-competing-edit' },
    data: { operationId: 'synthetic-competing-edit', collectionId: collection, inventoryRevision: 7, collectionVersion: 3, layoutRevision: 4,
      commands: [{ kind: 'create', ids: ['synthetic-competing-slot'], beforeSlotId: null }] } })
  expect(edit.status()).toBe(200)
  await d.getByRole('button', { name: 'Confirm and save raw restore' }).click()
  await expect(d.getByRole('button', { name: 'Confirm and save raw restore' })).toHaveCount(0)
  expect((await record(page))?.pending.length).toBe(0); expect(plans).toEqual([])
})
