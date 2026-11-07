import { test, expect, SUPABASE_URL, SEEDED_COLLECTION } from './fixtures'

// Synthetic collection writes, no requests reach a real account.
test.describe('Show mode undo', () => {
  test.use({ signedIn: true })

  for (const action of ['Bought', 'Add owned']) {
    test(`${action} can be undone after leaving the check, for 30 seconds`, async ({ harness }) => {
      const { page } = harness
      let saved: Record<string, unknown> | null = null
      const deletes: string[] = []
      let rejectUndo = action === 'Bought'
      await page.route('**/app/api/collection**', async route => {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON()
          saved = { pokemon_id: body.pokemonId, pokemon_name: body.pokemonName, card_id: body.cardId, card_name: body.cardName, card_language: body.cardLanguage, card_finish: body.cardFinish, status: body.status, wanted_cards: body.wantedCards }
          return route.fulfill({ json: { item: saved } })
        }
        if (route.request().method() === 'DELETE') {
          const fingerprint = new URL(route.request().url()).searchParams.get('baseFingerprint') ?? ''
          deletes.push(fingerprint)
          if (rejectUndo) {
            rejectUndo = false
            return route.fulfill({ status: 400, json: { error: 'Synthetic rejected undo' } })
          }
          // An undo must compare against the acquired card, not its pre-purchase empty slot.
          if (fingerprint === 'absent') return route.fulfill({ status: 409, json: { item: saved } })
          saved = null
          return route.fulfill({ json: { success: true } })
        }
        return route.fallback()
      })
      await page.getByRole('button', { name: 'Show mode', exact: true }).click()
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      const quick = page.getByRole('dialog', { name: 'Quick mode' })
      await quick.getByRole('searchbox').fill('charizard')
      await quick.getByRole('region', { name: 'Cards' }).getByRole('button', { name: /^Charizard ex, 151 / }).first().click()
      const check = quick.getByTestId('quick-card-check')
      await page.clock.install()
      await check.getByRole('button', { name: action, exact: true }).click()
      await expect(check.getByTestId('quick-card-status')).toHaveText('Owned')
      await page.keyboard.press('Escape')
      await expect(quick).toBeHidden()
      const undo = page.getByTestId('undo-snackbar')
      await page.clock.fastForward(29_000)
      await expect(undo).toBeVisible()
      await harness.expectMinTapTarget(undo.getByRole('button', { name: 'Undo', exact: true }), 36)
      await harness.expectHittable(undo.getByRole('button', { name: 'Undo', exact: true }))
      await undo.getByRole('button', { name: 'Undo', exact: true }).click()
      if (action === 'Bought') {
        await expect(undo).toContainText('Could not undo. Try again.')
        expect(saved).not.toBeNull()
        await undo.getByRole('button', { name: 'Undo', exact: true }).click()
      }
      await expect.poll(() => deletes.length).toBe(action === 'Bought' ? 2 : 1)
      expect(deletes[0]).not.toBe('absent')
      await expect.poll(() => saved).toBeNull()
      await expect(undo).toHaveCount(0)
      await harness.expectNoHorizontalOverflow()
    })
  }

  test('undo refuses to overwrite a newer edit to the same slot', async ({ harness }) => {
    const { page } = harness
    let saved: Record<string, unknown> | null = null
    let deletes = 0
    await page.route('**/app/api/collection**', async route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        saved = { pokemon_id: body.pokemonId, pokemon_name: body.pokemonName, card_id: body.cardId, card_name: body.cardName, card_language: body.cardLanguage, card_finish: body.cardFinish, status: body.status, wanted_cards: body.wantedCards }
        return route.fulfill({ json: { item: saved } })
      }
      if (route.request().method() === 'DELETE') {
        deletes++
        return route.fulfill({ json: { success: true } })
      }
      return route.fallback()
    })
    await page.getByRole('button', { name: 'Show mode', exact: true }).click()
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const quick = page.getByRole('dialog', { name: 'Quick mode' })
    await quick.getByRole('searchbox').fill('charizard')
    await quick.getByRole('region', { name: 'Cards' }).getByRole('button', { name: /^Charizard ex, 151 / }).first().click()
    await quick.getByRole('button', { name: 'Add owned', exact: true }).click()
    await expect(quick.getByTestId('quick-card-status')).toHaveText('Owned')
    saved = Object.assign({}, saved, { wanted_cards: [{ card_id: 'partner-wanted-fixture', card_name: 'Synthetic partner addition', card_language: 'en', card_finish: 'normal' }] })
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: [...SEEDED_COLLECTION, saved] }))
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect.poll(() => page.evaluate(() => localStorage.getItem('pokemon_collection_snapshot_v1'))).toContain('partner-wanted-fixture')
    await page.getByTestId('undo-snackbar').getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByTestId('undo-snackbar')).toContainText('This card changed since the action')
    expect(deletes).toBe(0)
    await expect(quick.getByTestId('quick-card-status')).toHaveText('Owned')
  })

  test('undo expires 30 seconds after the action despite rerenders', async ({ harness }) => {
    const { page } = harness
    await page.getByRole('button', { name: 'Show mode', exact: true }).click()
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const quick = page.getByRole('dialog', { name: 'Quick mode' })
    await quick.getByRole('searchbox').fill('charizard')
    await quick.getByRole('region', { name: 'Cards' }).getByRole('button', { name: /^Charizard ex, 151 / }).first().click()
    await page.clock.install()
    await quick.getByRole('button', { name: 'Add owned', exact: true }).click()
    const undo = page.getByTestId('undo-snackbar')
    await expect(undo).toBeVisible()
    await harness.expectWithinSafeViewport(undo)
    await harness.expectHittable(quick.getByRole('button', { name: 'Bought', exact: true }))
    await harness.expectHittable(undo.getByRole('button', { name: 'Undo', exact: true }))
    if (process.env.E2E_SCREENSHOT_DIR && test.info().project.name === 'standalone-390x844') {
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/show-undo.png` })
    }
    await page.clock.fastForward(29_000)
    await expect(undo).toBeVisible()
    await page.clock.fastForward(1_100)
    await expect(undo).toHaveCount(0)
  })
})
