import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';

/** Clicks `target` and reports whether the shared binder-content crossfade ran and if the dock stayed live. */
async function clickAndWatch(target: Locator) {
  return target.evaluate(async (element) => {
    (element as HTMLElement).click();
    const start = performance.now();
    let faded = false;
    let motion: string | undefined;
    while (performance.now() - start < 2500) {
      motion ??= document.documentElement.dataset.binderMotion;
      faded ||= document
        .getAnimations()
        .some((animation) => animation instanceof CSSAnimation && animation.animationName === 'binder-content-in');
      if (faded && motion) break;
      await new Promise(requestAnimationFrame);
    }
    const dock = document.querySelector('nav[aria-label="Main navigation"]') as HTMLElement | null;
    return { faded, motion, dockNamed: dock ? getComputedStyle(dock).viewTransitionName : 'none' };
  });
}

async function settle(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-binder-motion'))).toBe(false);
}

test.describe('dock tab view transitions', () => {
  test('List, Wanted, Sets, Pokémon, Binder and Analytics all crossfade like a page turn', async ({ harness }) => {
    const page = harness.page;
    const dock = harness.dock();
    const listHeading = page.getByRole('heading', { name: 'List', exact: true });
    const perspective = (name: string) =>
      page.getByRole('group', { name: 'Browse perspective' }).getByRole('button', { name, exact: true });
    const steps: Array<{ name: string; target: () => Locator; arrived: () => Promise<void> }> = [
      {
        name: 'List',
        target: () => dock.getByRole('button', { name: 'List', exact: true }),
        arrived: () => expect(listHeading).toBeVisible(),
      },
      {
        name: 'Wanted',
        target: () => dock.getByRole('button', { name: 'Wanted', exact: true }),
        arrived: () => expect(listHeading).toHaveCount(0),
      },
      {
        name: 'Sets',
        target: () => dock.getByRole('button', { name: 'Browse', exact: true }),
        arrived: () => expect(perspective('Sets')).toHaveAttribute('aria-pressed', 'true'),
      },
      {
        name: 'Pokémon',
        target: () => perspective('Pokémon'),
        arrived: () => expect(perspective('Pokémon')).toHaveAttribute('aria-pressed', 'true'),
      },
      {
        name: 'Binder',
        target: () => dock.getByRole('button', { name: 'Binder', exact: true }),
        arrived: () => expect(page.getByRole('spinbutton', { name: 'Binder page number' })).toBeVisible(),
      },
    ];
    for (const step of steps) {
      const result = await clickAndWatch(step.target());
      expect(result, `${step.name} should crossfade`).toMatchObject({ faded: true, motion: 'tab', dockNamed: 'none' });
      await settle(page);
      await step.arrived();
    }

    await page.getByRole('button', { name: 'More', exact: true }).click();
    const analytics = await clickAndWatch(page.getByRole('menuitem', { name: 'Analytics', exact: true }));
    expect(analytics, 'Analytics should crossfade').toMatchObject({ faded: true, motion: 'tab', dockNamed: 'none' });
    await settle(page);
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
    await harness.expectNoHorizontalOverflow();
  });

  test('a newly enabled reduced-motion preference applies to the next tab switch', async ({ harness }) => {
    await harness.page.emulateMedia({ reducedMotion: 'reduce' });
    const result = await clickAndWatch(harness.dock().getByRole('button', { name: 'List', exact: true }));
    expect(result).toMatchObject({ faded: false });
    expect(result.motion).toBeUndefined();
    await expect(harness.page.getByRole('heading', { name: 'List', exact: true })).toBeVisible();
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('tab switches are instant with prefers-reduced-motion', async ({ harness }) => {
      const page = harness.page;
      for (const name of ['List', 'Wanted', 'Browse', 'Binder']) {
        const result = await clickAndWatch(harness.dock().getByRole('button', { name, exact: true }));
        expect(result, `${name} should not animate`).toMatchObject({ faded: false });
        expect(result.motion).toBeUndefined();
      }
      await expect(page.getByRole('spinbutton', { name: 'Binder page number' })).toBeVisible();
    });
  });
});
