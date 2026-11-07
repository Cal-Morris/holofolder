import { test, expect, SEEDED_COLLECTION, SUPABASE_URL } from './fixtures'

// Synthetic collection members, wanted printings and per-binder rows.
const me = '00000000-0000-4000-8000-0000000000e2'
const partner = '00000000-0000-4000-8000-0000000000a1'
const main = 'e2e00000-0000-4000-8000-000000000001'
const trades = 'e2e00000-0000-4000-8000-000000000002'
const wanted = { card_id: 'synthetic-wanted', card_name: 'Synthetic wanted Bulbasaur', card_language: 'en', card_finish: 'normal', added_at: '2026-11-07T00:00:00Z' }

test.describe('Global Wanted people', () => {
 test.use({ signedIn: true })
 test('groups wanted printings, shows people and saves assignment to the chosen binder', async ({ harness }, testInfo) => {
  const { page } = harness
  const writes: Array<{ binderId: string; wantedCards: Array<{ wanted_by?: string[] }> }> = []
  const rows = [
   ...SEEDED_COLLECTION.map((row, i) => ({ ...row, binder_id: main, wanted_cards: i === 0 ? [{ ...wanted, wanted_by: [me] }] : [] })),
   { ...SEEDED_COLLECTION[0], id: 'synthetic-other-row', binder_id: trades, wanted_cards: [{ ...wanted, wanted_by: [partner] }] },
  ]
  await page.route(`${SUPABASE_URL}/rest/v1/partnerships**`, route => route.fulfill({ json: [{ id: 'synthetic-partnership', owner_user_id: me, user1_id: me, user2_id: partner, created_at: '2026-11-01' }] }))
  await page.route(`${SUPABASE_URL}/rest/v1/partner_invites**`, route => route.fulfill({ json: [{ invitee_email: 'alex@example.invalid', status: 'accepted' }] }))
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => {
   const binder = new URL(route.request().url()).searchParams.get('binder_id') ?? `eq.${main}`
   return route.fulfill({ json: rows.filter(row => binder.startsWith('neq.') ? row.binder_id !== binder.slice(4) : row.binder_id === binder.slice(3)) })
  })
  await page.route('**/api/collection', route => {
   const body = route.request().postDataJSON()
   writes.push(body)
   rows[0].wanted_cards = body.wantedCards
   return route.fulfill({ json: { item: { ...rows[0], wanted_cards: body.wantedCards } } })
  })
  await page.goto('/e2e-harness?signedIn=1&binders=1')
  await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Global Wanted', exact: true })).toBeVisible()
  const list = page.getByRole('list', { name: 'Wanted cards', exact: true })
  const row = list.getByRole('listitem').filter({ hasText: wanted.card_name })
  await expect(row).toContainText('alex@example.invalid')
  await expect(row).toContainText('You')
  await expect(row).toContainText('My binder, Trades')
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await harness.expectNoHorizontalOverflow()
  await page.screenshot({ path: testInfo.outputPath('global-wanted.png') })
  await row.getByRole('button', { name: `More actions for ${wanted.card_name}` }).click()
  const sheet = page.getByRole('dialog', { name: `Actions for ${wanted.card_name}`, exact: true })
  const people = sheet.getByRole('group', { name: 'Wanted by', exact: true })
  await expect(people.getByRole('button', { name: 'Both', exact: true })).toBeVisible()
  await people.getByRole('button', { name: 'Both', exact: true }).click()
  await expect.poll(() => writes.at(-1)?.wantedCards[0].wanted_by?.length).toBe(2)
  expect(writes.at(-1)?.binderId).toBe(main)
  await expect(people.getByRole('button', { name: 'Both', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await people.getByRole('button', { name: 'Unassigned', exact: true }).click()
  await expect.poll(() => writes.at(-1)?.wantedCards[0].wanted_by).toEqual([])
  await expect(sheet.getByRole('button', { name: 'Open Trades', exact: true })).toBeVisible()
  const close = sheet.getByRole('button', { name: 'Close wanted card actions' })
  await harness.expectMinTapTarget(close)
  await harness.expectWithinSafeViewport(close)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await harness.expectScrollUnlocked()
  await page.context().setOffline(true)
  await row.getByRole('button', { name: `More actions for ${wanted.card_name}` }).click()
  await people.getByRole('button', { name: 'You', exact: true }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pokemon_collection_pending_ops_v1') ?? '[]').some((op: { binderId?: string; item?: { wanted_cards?: Array<{ wanted_by?: string[] }> } }) => op.binderId === 'e2e00000-0000-4000-8000-000000000001' && op.item?.wanted_cards?.some(card => card.wanted_by?.includes('00000000-0000-4000-8000-0000000000e2'))))).toBe(true)
  await close.click()
  await page.context().setOffline(false)
  await expect.poll(() => writes.at(-1)?.wantedCards[0].wanted_by).toEqual([me])
  await row.getByRole('button', { name: `More actions for ${wanted.card_name}` }).click()
  await sheet.getByRole('button', { name: 'Open Trades', exact: true }).click()
  await expect(page).toHaveURL(/binder=e2e00000-0000-4000-8000-000000000002.*view=wanted/)
  await expect(page.getByRole('heading', { name: 'Wanted in this binder', exact: true })).toBeVisible()
 })
})

async function savedBinderCache(page: import('@playwright/test').Page) {
 return page.evaluate(() => new Promise<{ savedAt: string; collections: Record<string, unknown> }>((resolve, reject) => {
  const open = indexedDB.open('binderdex-offline', 1)
  open.onerror = () => reject(open.error)
  open.onsuccess = () => {
   const db = open.result
   const request = db.transaction('records', 'readonly').objectStore('records').get('binders:all-collections')
   request.onsuccess = () => { db.close(); resolve(request.result) }
   request.onerror = () => { db.close(); reject(request.error) }
  }
 }))
}

test.describe('incomplete Global Wanted cache', () => {
 test.use({ signedIn: true })
 test('never turns an unread binder into a known empty binder', async ({ harness }) => {
  const { page } = harness
  await page.goto('/e2e-harness?signedIn=1&binders=3')
  await page.evaluate(async ({ me, main, trades }) => {
   await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('binderdex-offline', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
     const db = open.result
     const transaction = db.transaction('records', 'readwrite')
     transaction.objectStore('records').put({ ownerUserId: me, savedAt: 'synthetic-partial-cache', collections: { [main]: [], [trades]: [] } }, 'binders:all-collections')
     transaction.oncomplete = () => { db.close(); resolve() }
     transaction.onerror = () => { db.close(); reject(transaction.error) }
    }
   })
  }, { me, main, trades })
  // Keep the local test server reachable while making app state explicitly offline.
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }))
  await page.reload()
  await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '2 of 3 binders loaded' })).toBeVisible()
  await expect.poll(async () => (await savedBinderCache(page)).savedAt).not.toBe('synthetic-partial-cache')
  expect(Object.keys((await savedBinderCache(page)).collections)).toEqual([main, trades])
  await page.reload()
  await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '2 of 3 binders loaded' })).toBeVisible()
 })
})
