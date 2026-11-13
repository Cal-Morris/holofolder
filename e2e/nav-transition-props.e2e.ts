import { test, expect } from './fixtures';
import type { Locator } from '@playwright/test';

/**
 * Every visible button inside `scope` that animates, with its computed transition-property.
 * Buttons without a transition report `all 0s` (the CSS initial value), so they are skipped.
 */
async function transitions(scope: Locator) {
  return scope.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('button'))
      .filter((button) => button.offsetParent)
      .map((button) => {
        const style = getComputedStyle(button);
        const animates = style.transitionDuration.split(',').some((duration) => Number.parseFloat(duration) > 0);
        return {
          label: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
          property: style.transitionProperty,
          animates,
        };
      })
      .filter((button) => button.animates),
  );
}

test.describe('nav chrome transitions', () => {
  test.use({ signedIn: true });

  test('dock tabs only transition the properties that change', async ({ harness }) => {
    const tabs = await transitions(harness.dock());
    expect(tabs.length).toBeGreaterThanOrEqual(5);
    for (const { label, property } of tabs) {
      expect(property, label).not.toMatch(/\ball\b/);
    }
    const list = harness.dock().getByRole('button', { name: 'List', exact: true });
    const property = await list.evaluate((button) => getComputedStyle(button).transitionProperty);
    expect(property).toContain('background-color');
    expect(property).not.toMatch(/scale|transform|filter|backdrop/);
  });

  test('controls sheet buttons only transition colours', async ({ harness }) => {
    await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();
    await harness.page.getByTestId('app-header').getByRole('button', { name: 'View' }).click();
    const filters = harness.page.getByRole('group', { name: 'Slot filters' });
    await expect(filters).toBeVisible();
    const sheet = filters.locator("xpath=ancestor::*[.//button[contains(., 'Scan page')]][1]");
    const buttons = await transitions(sheet);
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const { label, property } of buttons) {
      expect(property, label).not.toMatch(/\ball\b/);
    }
  });

  test('binder mode chips do not transition `all`', async ({ harness }) => {
    await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();
    await harness.page.getByTestId('app-header').getByRole('button', { name: 'View' }).click();
    for (const group of ['Binder display']) {
      const chips = harness.page.getByRole('group', { name: group }).filter({ visible: true }).getByRole('button');
      await expect(chips.first()).toBeVisible();
      const styles = await chips.evaluateAll((buttons) =>
        buttons.map((button) => {
          const style = getComputedStyle(button);
          return { property: style.transitionProperty, duration: style.transitionDuration };
        }),
      );
      expect(styles.length).toBeGreaterThanOrEqual(2);
      for (const { property, duration } of styles) {
        expect(property, group).not.toMatch(/\ball\b/);
        expect(
          duration.split(',').every((value) => Number.parseFloat(value) === 0),
          group,
        ).toBe(true);
      }
    }
  });
});
