import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER } from './fixtures'
import type { Page } from '@playwright/test'
import type { SlotOfflineRecord } from '../lib/collection/slot-offline-queue'

const collection = '22222222-2222-4222-8222-222222222222'
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`
const scope = { accountId: E2E_USER.id, ownerId: E2E_USER.id, membershipKey: JSON.stringify([null, E2E_USER.id]), memberIds: [E2E_USER.id] }
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
async function record(page: Page): Promise<SlotOfflineRecord | undefined> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open('binderdex-offline'); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction('records').objectStore('records').getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close()
    return rows.find(r => !!r && typeof r === 'object' && 'pending' in r) as SlotOfflineRecord | undefined
  })
}
async function remove(page: Page) {
  await page.goto(entry)
  await expect(button(page, 'Find acknowledged change')).toHaveCount(0)
  await button(page, 'Edit layout').click()
  await button(page, 'Select several pockets').click()
  for (const id of [1, 2]) await button(page, `Select slot ${id}`).click()
  await button(page, 'Remove selected slots').click()
  await button(page, 'Confirm slot removal').click()
}
// All history and recovery-engine data is synthetic. Real browser host, queue, HTTP and complete-read fences.
function event(operationId: string, id = '101') {
  return { id, operation_id: operationId, recorded_at: '2026-11-10T12:00:00Z', format_version: 1, actor_kind: 'user', actor_user_id: E2E_USER.id, source: 'app', action: 'inventory.removeSlots',
    affected_entities: { collectionIds: [collection], slotIds: ['synthetic-slot-0'] },
    changes: [{ table: 'binder_slots', id: 'synthetic-slot-0', before: { target: { kind: 'pokemon', pokemonId: 143 } }, after: null }] }
}
async function history(page: Page, mode: string) {
  await page.route('**/app/api/collection-activity**', async route => {
    const query = new URL(route.request().url()).searchParams
    if (query.has('scope')) return route.fulfill({ json: { scope } })
    if (mode === 'unavailable') return route.fulfill({ status: 503, json: { error: 'History temporarily unavailable' } })
    if (mode === 'revoked') return route.fulfill({ status: 403, json: { error: 'Current access revoked' } })
    const operationId = (await record(page))!.receipts[0].operationId
    if (!query.has('id')) { expect(query.get('operationId')).toBe(operationId); expect(query.has('collectionId')).toBe(false) }
    const rows = mode === 'paginated' ? [event(operationId, query.has('cursor') || query.has('id') ? '103' : '101')] : mode === 'deletion' ? [{ ...event(operationId), action: 'inventory.deleteCollection', changes: [{ table: 'binders', id: collection, before: { name: 'Synthetic storage', is_default: true }, after: null }] }] : mode === 'missing' ? [] : mode === 'multiple' ? [event(operationId), event(operationId, '103')] : [event(mode === 'mismatch' || mode === 'detail-mismatch' && query.has('id') ? 'other-operation' : operationId, mode === 'unsupported' ? '102' : '101')]
    await route.fulfill({ json: { scope, data: query.has('id') ? rows.filter(e => e.id === query.get('id')) : rows, nextCursor: mode === 'paginated' && !query.has('cursor') && !query.has('id') ? 'synthetic-operation-page' : null, syncedAt: '2026-11-10T12:01:00Z' } })
  })
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: 'hf-storage-fixture', value: crypto.randomUUID(), url: baseURL! }])
})
test('fresh command ACK finds exact operation then inspects supported recovery without changing original receipt', async ({ page, insets }) => {
  await history(page, 'single'); await remove(page)
  await expect(button(page, 'Find acknowledged change')).toBeVisible()
  const original = (await record(page))!.receipts[0]
  await button(page, 'Find acknowledged change').click()
  const dialog = page.getByRole('dialog', { name: 'Collection Activity', exact: true })
  await expect(dialog).toContainText('One event matches')
  await expect(button(page, 'Review recovery')).toHaveCount(0)
  await button(page, 'Open exact entry 101').click()
  await button(page, 'Review recovery').click()
  await expect(dialog.getByRole('region', { name: 'Review recovery', exact: true })).toBeVisible()
  const h = new Harness(page, insets)
  await h.expectMinTapTarget(button(page, 'Confirm recovery'))
  await h.expectWithinSafeViewport(dialog)
  await h.expectNoHorizontalOverflow()
  await button(page, 'Confirm recovery').click()
  await expect(dialog).toContainText('Recovery verified against current storage')
  expect((await record(page))!.receipts[0]).toEqual(original)
  const recovered = (await record(page))!.recovery![0]
  expect(recovered.intent.request.eventId).toBe('101')
  expect(recovered.receipt!.recoveredEventId).toBe('101')
})
for (const mode of ['missing', 'multiple', 'mismatch', 'detail-mismatch', 'unavailable', 'unsupported', 'revoked']) test(`${mode} operation history never guesses recovery`, async ({ page }) => {
  await history(page, mode); await remove(page)
  await button(page, 'Find acknowledged change').click()
  const dialog = page.getByRole('dialog', { name: 'Collection Activity', exact: true })
  if (mode === 'revoked') { await expect(dialog).toHaveCount(0); return }
  if (mode === 'multiple') {
    await expect(dialog).toContainText('Multiple events match')
    await expect(button(page, 'Review recovery')).toHaveCount(0)
    await button(page, 'Open exact entry 103').click()
    await button(page, 'Review recovery').click()
    await expect(dialog).toContainText('slot_version_changed')
  } else if (mode === 'detail-mismatch') {
    await button(page, 'Open exact entry 101').click()
    await expect(dialog).toContainText('Exact operation history could not be verified')
    await expect(button(page, 'Review recovery')).toHaveCount(0)
  } else if (mode === 'unavailable') {
    await expect(dialog).toContainText('History temporarily unavailable')
    await expect(button(page, 'Review recovery')).toHaveCount(0)
  } else if (mode === 'unsupported') {
    await button(page, 'Open exact entry 102').click(); await button(page, 'Review recovery').click()
    await expect(dialog).toContainText('private_assets_unverifiable')
  } else {
    await expect(dialog).toContainText(mode === 'mismatch' ? 'Exact operation history could not be verified' : 'Exact operation history is unavailable')
    await expect(button(page, 'Review recovery')).toHaveCount(0)
  }
  await expect(button(page, 'Confirm recovery')).toHaveCount(0)
  expect((await record(page))!.recovery ?? []).toHaveLength(0)
})
test('accepted reply without fresh complete ACK has no operation history handoff', async ({ page }) => {
  let sent = false
  await page.route('**/app/e2e-harness/storage/inventory', async route => { const response = await route.fetch(); sent = true; await route.fulfill({ response }) })
  await page.route('**/app/e2e-harness/storage/inventory?*', route => sent ? route.abort('failed') : route.continue())
  await remove(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('unavailable')
  await expect(button(page, 'Find acknowledged change')).toHaveCount(0)
  expect((await record(page))!.receipts).toHaveLength(0)
})
test('offline reopening cannot use cached operation matches as recovery authority', async ({ page, context }) => {
  await history(page, 'single'); await remove(page)
  await button(page, 'Find acknowledged change').click()
  await expect(button(page, 'Open exact entry 101')).toBeVisible()
  await button(page, 'Close Activity').click(); await context.setOffline(true)
  await button(page, 'Find acknowledged change').click()
  await expect(page.getByRole('dialog', { name: 'Collection Activity', exact: true })).toContainText('Exact operation history is unavailable')
  await expect(button(page, 'Open exact entry 101')).toHaveCount(0)
  await expect(button(page, 'Review recovery')).toHaveCount(0)
})
test('maximum command operation ID wraps and new controls stay above the dock', async ({ page, insets }) => {
  await history(page, 'single')
  await page.goto(entry)
  await button(page, 'Edit layout').click(); await button(page, 'Select several pockets').click()
  await button(page, 'Select slot 1').click()
  await page.evaluate(() => {
    const original = crypto.randomUUID.bind(crypto)
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: original })
      return 'synthetic-' + 'x'.repeat(90)
    } })
  })
  await button(page, 'Remove selected slots').click(); await button(page, 'Confirm slot removal').click()
  await expect(button(page, 'Find acknowledged change')).toBeVisible()
  expect((await record(page))!.receipts[0].operationId).toHaveLength(100)
  const h = new Harness(page, insets)
  await button(page, 'Find acknowledged change').scrollIntoViewIfNeeded()
  await h.expectMinTapTarget(button(page, 'Find acknowledged change'))
  await h.expectWithinSafeViewport(button(page, 'Find acknowledged change'))
  await h.expectNoHorizontalOverflow()
  await button(page, 'Find acknowledged change').click()
  await expect(button(page, 'Open exact entry 101')).toBeVisible()
  await h.expectMinTapTarget(button(page, 'Open exact entry 101'))
  await h.expectWithinSafeViewport(page.getByRole('dialog', { name: 'Collection Activity', exact: true }))
  await h.expectNoHorizontalOverflow()
})
test('acknowledged collection deletion finds its original operation after navigation changes', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'hf-storage-fixture', value: `delete-${crypto.randomUUID()}`, url: baseURL! }])
  await history(page, 'deletion'); await page.goto(entry)
  await button(page, 'Delete collection').click()
  await page.getByRole('combobox', { name: 'Replacement default collection', exact: true }).selectOption('33333333-3333-4333-8333-333333333333')
  await button(page, 'Review collection deletion').click()
  await page.getByRole('dialog', { name: 'Delete collection', exact: true }).getByRole('checkbox').check()
  await button(page, 'Confirm collection deletion').click()
  await expect(button(page, 'Find acknowledged change')).toBeVisible()
  const receipt = (await record(page))!.receipts[0]
  expect(receipt.outcome).toBe('acknowledged')
  if (receipt.intent.kind !== 'inventory') throw new Error('Expected original inventory deletion intent')
  expect(receipt.intent.request.commands[0].kind).toBe('deleteCollection')
  expect((await record(page))!.snapshot!.collections.some(c => c.id === collection)).toBe(false)
  await button(page, 'Find acknowledged change').click()
  await expect(button(page, 'Review recovery')).toHaveCount(0)
  await button(page, 'Open exact entry 101').click()
  await expect(button(page, 'Review recovery')).toBeVisible()
  expect((await record(page))!.receipts[0]).toEqual(receipt)
})

test('the final page of a multiple-event operation never claims a unique match', async ({ page }) => {
  await history(page, 'paginated'); await remove(page)
  await button(page, 'Find acknowledged change').click()
  const dialog = page.getByRole('dialog', { name: 'Collection Activity', exact: true })
  await expect(dialog).toContainText('Multiple events match')
  await dialog.getByRole('button', { name: 'Older page', exact: true }).click()
  await expect(button(page, 'Open exact entry 103')).toBeVisible()
  await expect(dialog).toContainText('Multiple events match')
  await expect(dialog).not.toContainText('One event matches')
  await expect(button(page, 'Review recovery')).toHaveCount(0)
})
