import { test, expect } from './fixtures'

// Run only with scripts/verify-public-share-backend.ts and a build using that synthetic origin.
const backend = process.env.PUBLIC_SHARE_BACKEND_URL ?? 'http://127.0.0.1:54471'
test.skip(process.env.PUBLIC_SHARE_TEST_BACKEND !== '1', 'Requires the explicitly configured local synthetic PostgREST backend')
test.describe.configure({ mode: 'serial' })
for (const signedIn of [false, true]) {
  test.describe(signedIn ? 'signed in' : 'guest', () => {
    test.use({ signedIn })
    for (const path of ['/app/share/synthetic-token', '/app/u/synthetic-owner/mixed']) {
      test(`real public SSR keeps mixed order, privacy, price policy and revocation: ${path}`, async ({ page, harness, request }) => {
        await request.get(`${backend}/_synthetic/reset`)
        const response = await page.goto(path)
        expect(response?.status()).toBe(200)
        expect(response?.headers()['cache-control']).toContain('no-store')
        expect(response?.headers()['cdn-cache-control']).toBe('no-store')
        const html = await response!.text()
        for (const sentinel of ['PRIVATE', 'certificate', 'assetIds', 'wanted_by', 'purchase_cost', 'inventoryItemId']) expect(html).not.toContain(sentinel)
        await expect(page.getByRole('heading', { name: 'Synthetic mixed binder' })).toBeVisible()
        await expect(page.getByText('2 of 3 current targets filled')).toBeVisible()
        const pockets = page.locator('[data-slot-id]')
        await expect(pockets).toHaveCount(6)
        expect(await pockets.evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')))).toEqual([
          'Synthetic Snorlax, Owned', 'Synthetic Snorlax, Owned', 'Synthetic Trainer, Owned', 'Synthetic Energy, Owned', 'Free slot, Empty spacer', 'Free slot, Empty spacer',
        ])
        await harness.expectNoHorizontalOverflow()
        await harness.expectWithinSafeViewport(page.getByRole('heading', { name: 'Synthetic mixed binder' }))
        await harness.expectMinTapTarget(page.getByRole('button', { name: 'Next', exact: true }), 36)
        await page.getByRole('button', { name: 'Next', exact: true }).click()
        await expect(page.getByRole('button', { name: 'snorlax, Unfilled target' })).toBeVisible()
        await expect(page.getByText('2 of 3 current targets filled')).toBeVisible()
        const calls = await (await request.get(`${backend}/_synthetic/calls`)).json()
        expect(calls.filter((c: { table: string }) => c.table === 'card_prices')).toHaveLength(0)
        await request.get(`${backend}/_synthetic/reset?rows=3&cols=8&prices=1&light=1&stress=1`)
        await page.reload()
        await expect(page.getByRole('region', { name: 'Binder page 1, 3 rows by 8 columns' })).toBeVisible()
        await harness.expectNoHorizontalOverflow()
        await page.getByRole('button', { name: 'Synthetic Snorlax, Owned' }).first().click()
        await expect(page.getByRole('region', { name: 'Selected slot' })).toContainText('£12.34')
        await expect(page.getByRole('region', { name: 'Selected slot' })).toContainText('Recorded provider:')
        await harness.expectNoHorizontalOverflow()
        await request.get(`${backend}/_synthetic/reset?revoked=1`)
        const revoked = await page.reload()
        // Streamed Next notFound can retain HTTP 200 after the public PPR shell was sent.
        expect([200, 404]).toContain(revoked?.status())
        expect(revoked?.headers()['cache-control']).toContain('no-store')
        await expect(page.getByRole('heading', { name: /Page not found/i })).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Synthetic mixed binder' })).toHaveCount(0)
      })
    }
  })
}
