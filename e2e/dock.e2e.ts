import { test, expect, type Harness } from './fixtures';

const bar = (harness: Harness) => harness.dock().locator(':scope > div').first();

test.describe('compact bottom dock', () => {
  test.use({ signedIn: true });

  test('slim bar, safe-area inset applied once, no wasted band', async ({ harness }) => {
    const { height } = harness.viewport;
    const box = (await bar(harness).boundingBox())!;
    expect(box.height, 'dock bar height').toBeLessThanOrEqual(56);
    const gapBelow = height - (box.y + box.height);
    // The inset is applied once (min 8px in a browser tab), not stacked on extra padding.
    expect(Math.abs(gapBelow - Math.max(harness.insets.bottom, 8)), `gap below bar ${gapBelow}`).toBeLessThanOrEqual(1);
    expect(height - box.y, 'total dock footprint').toBeLessThanOrEqual(Math.max(harness.insets.bottom, 8) + 56);
    await harness.expectWithinSafeViewport(bar(harness));
  });

  for (const tab of ['Binder', 'Inventory'] as const) {
    test(`every dock control is a comfortable tap target (${tab})`, async ({ harness }) => {
      await harness.dock().getByRole('button', { name: tab, exact: true }).click();
      await expect(harness.dock().getByRole('button', { name: tab, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const buttons = await harness.dock().getByRole('button').all();
      expect(buttons.length).toBeGreaterThanOrEqual(5);
      for (const button of buttons) {
        await harness.expectMinTapTarget(button, 36);
        if (await button.isEnabled()) await expect(() => harness.expectHittable(button)).toPass({ timeout: 1000 });
      }
      await harness.expectNoHorizontalOverflow();
    });
  }
});

// The National Dex List is the signed-out dock tab; signed-in owners get Inventory in its place.
test.describe('guest dex list', () => {
  test('the last List row scrolls fully into view above the dock', async ({ harness }) => {
    await harness.dock().getByRole('button', { name: 'List', exact: true }).click();
    const scroller = harness.page.getByTestId('view-scroller');
    await expect(scroller).toBeVisible();
    const lastRow = scroller.locator('[role=button]').last();
    // New row measurements can increase the estimated height after the first jump.
    await expect
      .poll(async () => {
        await scroller.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        return lastRow.textContent();
      })
      .toMatch(/#1025/);
    await expect(lastRow).toBeVisible();
    // Virtual row measurements are published on the next animation frame.
    await expect(async () => {
      const rowBox = (await lastRow.boundingBox())!;
      const dockTop = (await bar(harness).boundingBox())!.y;
      expect(rowBox.y + rowBox.height, 'last row must not be hidden by the dock').toBeLessThanOrEqual(dockTop);
      await harness.expectHittable(lastRow);
    }).toPass({ timeout: 7500 });
  });
});
