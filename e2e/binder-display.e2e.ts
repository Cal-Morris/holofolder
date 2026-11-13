import { test, expect } from './fixtures';

test('header keeps its width across dock views on wide screens', async ({ harness }) => {
  const { page } = harness;
  await page.setViewportSize({ width: 1600, height: 1000 });
  const header = page.locator('nav').first().locator(':scope > div').first();
  const binder = await header.boundingBox();
  for (const name of ['List', 'Wanted', 'Browse', 'Binder']) {
    await page
      .locator('nav')
      .first()
      .getByRole('button', { name, exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const box = await header.boundingBox();
    expect(box!.width).toBe(binder!.width);
    expect(box!.x).toBe(binder!.x);
  }
});

test.describe('staged stable-slot display', () => {
  test.use({ signedIn: true });

  test('mixed targets open distinct copy details without browse mutations', async ({ harness }) => {
    const { page } = harness;
    await page.goto('/app/e2e-harness?signedIn=1&slots=mixed&rows=2&cols=4');
    const slots = page.locator('button[data-slot-id]');
    await expect(slots).toHaveCount(7);
    await expect(slots.nth(0)).toHaveAccessibleName('Snorlax A, Owned');
    await expect(slots.nth(1)).toHaveAccessibleName('Snorlax B, Owned');
    await expect(slots.nth(2)).toHaveAccessibleName('Trainer, Owned');
    await expect(slots.nth(3)).toHaveAccessibleName('Energy, Owned');
    await expect(slots.nth(4)).toHaveAccessibleName('snorlax, Unfilled target');
    await expect(slots.nth(5)).toHaveAccessibleName('Trainer, Unfilled target');
    await expect(slots.nth(6)).toHaveAccessibleName('Free slot, Empty spacer');
    const before = await slots.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-slot-id')));
    const writes: string[] = [];
    page.on('request', (r) => {
      if (
        r.url().includes('/api/') &&
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method()) &&
        !r.url().includes('card-prices')
      )
        writes.push(r.url());
    });
    for (const index of [0, 1, 2, 3, 4, 5, 6]) {
      await slots.nth(index).click();
      const detail = page.getByRole('dialog', { name: /details$/ });
      await expect(detail).toHaveAttribute('data-slot-id', before[index]!);
      await expect(slots.nth(index)).toHaveAttribute('aria-pressed', 'true');
      if (index === 1) {
        await expect(detail).not.toContainText('item-b');
        await expect(detail).toContainText('PSA');
        await expect(detail.getByText('9', { exact: true })).toBeVisible();
        await expect(detail.getByText('Holder', { exact: true })).toHaveCount(0);
      }
      if (index >= 4) await expect(detail).toContainText(index === 6 ? 'Empty slot' : 'Unfilled target');
      await harness.expectWithinSafeViewport(detail);
      await harness.expectMinTapTarget(harness.closeControl(detail));
      const db = (await detail.boundingBox())!,
        dock = (await harness.dock().boundingBox())!;
      expect(db.y + db.height).toBeLessThanOrEqual(dock.y);
      await harness.closeControl(detail).click();
    }
    // A held/cancelled browse touch and a drag cannot rearrange anything.
    await slots.nth(0).dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 100, clientY: 200 }] });
    await page.waitForTimeout(450);
    await slots
      .nth(0)
      .dispatchEvent('touchcancel', { touches: [], changedTouches: [{ identifier: 1, clientX: 100, clientY: 200 }] });
    await slots.nth(0).dispatchEvent('dragstart');
    await slots.nth(1).dispatchEvent('drop');
    await expect(slots.nth(0)).toHaveAttribute('draggable', 'false');
    expect(await slots.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-slot-id')))).toEqual(before);
    expect(writes).toEqual([]);
    await expect(page.getByRole('button', { name: /edit layout|move slot|delete slot/i })).toHaveCount(0);
    await harness.expectNoHorizontalOverflow();
    await harness.expectWithinSafeViewport(page.locator("[data-binder-page='1']"));
  });

  test('slot detail dismisses safely and dock switching clears selection', async ({ harness }) => {
    const { page } = harness;
    await page.goto('/app/e2e-harness?slots=mixed&rows=2&cols=4');
    const slot = page.getByRole('button', { name: 'Snorlax B, Owned', exact: true });
    const detail = page.getByRole('dialog', { name: /Snorlax B.*details/ });
    await slot.click();
    await expect(detail).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await slot.click();
    await expect(detail).toBeVisible();
    await page.goBack();
    await expect(detail).toHaveCount(0);
    expect(page.url()).toContain('e2e-harness');
    await slot.click();
    await harness.tapBackdrop(detail);
    await expect(detail).toHaveCount(0);
    await slot.click();
    await harness.swipeDown(detail);
    await expect(detail).toHaveCount(0);
    await slot.click();
    await harness.dock().getByRole('button', { name: 'List', exact: true }).click();
    await expect(detail).toHaveCount(0);
    await harness.expectScrollUnlocked();
  });

  test('sparse pages and zero slots stay honest at custom dimensions', async ({ harness }) => {
    const { page } = harness;
    await page.goto('/app/e2e-harness?slots=mixed&rows=1&cols=1&page=7');
    const input = page.getByRole('spinbutton', { name: 'Binder page number' });
    // Navigate via the existing page control; the explicit spacer is the final real slot.
    await input.fill('7');
    await input.press('Enter');
    await expect(page.getByRole('button', { name: 'Free slot, Empty spacer', exact: true })).toBeVisible();
    await expect(page.locator('button[data-slot-id]')).toHaveCount(1);
    await page.goto('/app/e2e-harness?slots=mixed&rows=8&cols=8');
    await expect(page.locator('button[data-slot-id]')).toHaveCount(7);
    await harness.expectNoHorizontalOverflow();
    await page.goto('/app/e2e-harness?slots=empty');
    await expect(page.getByRole('status').filter({ hasText: 'No slots in this binder' })).toBeVisible();
    await expect(page.locator('button[data-slot-id]')).toHaveCount(0);
    await harness.expectNoHorizontalOverflow();
  });
});
