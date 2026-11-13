import { test, expect, type Harness } from './fixtures';

// A real installed iPhone app (393x852, 59px status bar). With black-translucent the page is drawn
// behind the clock, so: the top-most control needs clear room below the status bar, and nothing that
// scrolls may ever show through behind the clock. Checked with the binder as loaded, with Show mode on,
// and after scrolling everything that scrolls.
test.use({ signedIn: true, viewport: { width: 393, height: 852 } });

const CLEARANCE = 8;

/** Every point of the status-bar band (plus the clearance) shows only the solid cover or empty chrome. */
async function expectClearTopBand(harness: Harness, state: string) {
  const intruders = await harness.page.evaluate((band) => {
    const cover = document.querySelector<HTMLElement>('[data-testid="status-bar-cover"]');
    if (!cover) return ['no status-bar cover'];
    const background = getComputedStyle(cover).backgroundColor;
    const found = new Set<string>();
    if (/rgba\(.*,\s*0(\.\d+)?\)$/.test(background) || background === 'transparent')
      found.add(`cover is see-through (${background})`);
    if (cover.getBoundingClientRect().height < band - 0.5)
      found.add(`cover is only ${cover.getBoundingClientRect().height}px tall`);
    // The cover ignores taps; let it take part in hit-testing just for this measurement.
    const previous = cover.style.pointerEvents;
    cover.style.pointerEvents = 'auto';
    const allowed = new Set<Element>([cover, document.documentElement, document.body]);
    const main = document.querySelector('main');
    if (main) allowed.add(main);
    const header = document.querySelector('[data-testid="app-header"]');
    if (header) allowed.add(header);
    for (let y = 0; y < band; y += 2) {
      for (let x = 2; x < window.innerWidth; x += 12) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !allowed.has(hit)) {
          const label = hit.getAttribute('aria-label') ?? hit.textContent?.trim().slice(0, 30) ?? '';
          found.add(`${hit.tagName.toLowerCase()} "${label}" at ${x},${y}`);
        }
      }
    }
    cover.style.pointerEvents = previous;
    return [...found].slice(0, 8);
  }, harness.insets.top + CLEARANCE);
  expect(intruders, `${state}: something shows within ${CLEARANCE}px of the status bar`).toEqual([]);
}

/** The first thing in the header (the Show mode strip or the header bar) sits well below the clock. */
async function expectHeaderRoom(harness: Harness, state: string) {
  const first = harness.page.getByTestId('app-header').locator(':scope > div > *').first();
  const box = (await first.boundingBox())!;
  expect(box.y, `${state}: top-most element has room below the status bar`).toBeGreaterThanOrEqual(
    harness.insets.top + 12 - 0.5,
  );
}

async function scrollEverything(harness: Harness) {
  await harness.page.evaluate(() => {
    window.scrollTo(0, 600);
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      const style = getComputedStyle(element);
      if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 4)
        element.scrollTop = 400;
    }
  });
  await harness.page.waitForTimeout(250);
}

test(
  'nothing sits in or just below the status bar: loaded, in Show mode, and scrolled',
  { tag: '@matrix' },
  async ({ harness }, testInfo) => {
    test.skip(
      !testInfo.project.metadata?.standalone || !testInfo.project.name.includes('390'),
      'one installed-app run at 393x852',
    );
    const { page } = harness;
    await expect(harness.slot(1)).toBeVisible();
    await expectClearTopBand(harness, 'loaded');
    await expectHeaderRoom(harness, 'loaded');

    await scrollEverything(harness);
    await expectClearTopBand(harness, 'binder scrolled');

    await harness.listTab().click();
    await scrollEverything(harness);
    await expectClearTopBand(harness, 'list scrolled');
    await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();

    await page.getByRole('button', { name: 'Show mode', exact: true }).click();
    const strip = page.getByRole('region', { name: 'Show mode' });
    await expect(strip).toBeVisible();
    expect((await strip.boundingBox())!.height, 'Show mode strip is one slim row').toBeLessThanOrEqual(52);
    await expectClearTopBand(harness, 'show mode');
    await expectHeaderRoom(harness, 'show mode');
    await scrollEverything(harness);
    await expectClearTopBand(harness, 'show mode scrolled');
    await expectHeaderRoom(harness, 'show mode scrolled');
  },
);
