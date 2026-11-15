import { readFileSync } from 'node:fs';
import { test, expect, mockBackends, emulateStandalone, Harness } from './fixtures';
import { fulfillWantedInventory, wantedEntry } from './native-wanted-layout-fixture';
import type { Page } from '@playwright/test';

// Print wanted cards over the synthetic native want list (see native-wanted-layout-fixture.ts). No hosted data.
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  await page.route('**/app/e2e-harness/storage/inventory?*', (route) => fulfillWantedInventory(route));
  await page.route('**/app/e2e-harness/storage/inventory', (route) => route.abort('failed'));
  // Headless print is a no-op; record the call so the printout stays mounted for measuring.
  await page.addInitScript(() => {
    (window as unknown as { printCalls: number }).printCalls = 0;
    window.print = () => {
      (window as unknown as { printCalls: number }).printCalls += 1;
    };
  });
});

const openSheet = async (page: Page) => {
  await page.goto(wantedEntry);
  await page.getByRole('button', { name: 'Wanted', exact: true }).filter({ visible: true }).click();
  await page
    .getByRole('region', { name: 'Wanted cards', exact: true })
    .getByRole('button', { name: 'Print', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Print wanted cards' });
};

test(
  'options sheet fits the phone: no overflow, 36px targets, actions above the home indicator',
  { tag: '@matrix' },
  async ({ page, insets }) => {
    const sheet = await openSheet(page);
    await expect(sheet).toBeVisible();
    const h = new Harness(page, insets, true);
    await h.expectNoHorizontalOverflow();
    const close = sheet.getByRole('button', { name: 'Close print wanted cards' });
    const print = sheet.getByRole('button', { name: /^Print \d+ placeholders?/ });
    for (const control of [
      close,
      print,
      sheet.getByRole('button', { name: /^Want list as shown/ }),
      sheet.getByRole('button', { name: /^Ink saver/ }),
      sheet.getByRole('button', { name: 'US Letter' }),
    ]) {
      await h.expectMinTapTarget(control);
    }
    for (const control of [close, print]) {
      await h.expectWithinSafeViewport(control);
      await h.expectHittable(control);
    }
    // The sheet's content never runs wider than the sheet.
    const box = (await sheet.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await close.click();
    await expect(sheet).toBeHidden();
  },
);

const MM = 96 / 25.4;
const PT_PER_MM = 72 / 25.4;

async function printAndMeasure(page: Page, paper: 'A4' | 'US Letter', style: 'Card image' | 'Ink saver') {
  const sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /^Synthetic wanted binder/ }).click();
  await sheet.getByRole('combobox', { name: 'From binder page' }).selectOption('1');
  await sheet.getByRole('combobox', { name: 'To binder page' }).selectOption('2');
  await sheet.getByRole('button', { name: new RegExp(`^${style}`) }).click();
  await sheet.getByRole('button', { name: paper, exact: true }).click();
  await sheet.getByRole('button', { name: /^Print \d+ placeholders?/ }).click();
  await expect(page.locator('[data-placeholder-print][data-ready]')).toBeAttached();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printCalls: number }).printCalls)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  // Only the printout prints: the app and the sheet are hidden.
  await expect(sheet).toBeHidden();
  const boxes = await page
    .locator('[data-placeholder]')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.width, r.height]));
  const calibration = await page.locator('[data-calibration]').evaluate((el) => el.getBoundingClientRect().height);
  // Nothing prints a broken image: every image has loaded, and failed ones became outlines.
  const broken = await page
    .locator('[data-placeholder-print] img')
    .evaluateAll((imgs) => imgs.filter((img) => !(img as HTMLImageElement).naturalWidth).length);
  return { boxes, calibration, broken, sheets: await page.locator('[data-placeholder-print] section').count() };
}

function pdfPages(pdf: Buffer) {
  const text = pdf.toString('latin1');
  const pages = text.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
  const box = text.match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/);
  return { pages, width: Number(box?.[1]) / PT_PER_MM, height: Number(box?.[2]) / PT_PER_MM };
}

for (const [paper, style, size] of [
  ['A4', 'Card image', { width: 210, height: 297 }],
  ['US Letter', 'Ink saver', { width: 215.9, height: 279.4 }],
] as const)
  test(`${paper} ${style}: every placeholder prints at 63 × 88 mm with a 50 mm calibration line`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'browser-390x844', 'print geometry runs once, on the default browser project');
    // One card's image is missing (as offline without a saved copy): it prints as an outline, never a broken image.
    await page.route('**/synthetic/synthetic-long/**', (route) => route.abort('internetdisconnected'));
    const { boxes, calibration, broken, sheets } = await printAndMeasure(page, paper, style);
    expect(boxes.length).toBeGreaterThan(0);
    for (const [width, height] of boxes) {
      expect(Math.abs(width / MM - 63), `width ${width / MM} mm`).toBeLessThanOrEqual(0.2);
      expect(Math.abs(height / MM - 88), `height ${height / MM} mm`).toBeLessThanOrEqual(0.2);
    }
    expect(Math.abs(calibration / MM - 50)).toBeLessThanOrEqual(0.2);
    expect(broken).toBe(0);
    if (style === 'Card image') {
      await expect(page.locator('[data-placeholder] img').first()).toBeAttached();
      await expect(
        page.locator('[data-placeholder]', { hasText: 'extraordinarily long' }).locator('[data-ink-saver]').first(),
      ).toBeAttached();
    } else await expect(page.locator('[data-placeholder] img')).toHaveCount(0);
    await expect(page.locator('[data-placeholder]').first()).toContainText('PLACEHOLDER');

    const path = info.outputPath(`print-wanted-${paper === 'A4' ? 'a4' : 'letter'}.pdf`);
    await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
    const pdf = pdfPages(readFileSync(path));
    expect(pdf.pages).toBe(sheets);
    expect(Math.abs(pdf.width - size.width), `page width ${pdf.width} mm`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(pdf.height - size.height), `page height ${pdf.height} mm`).toBeLessThanOrEqual(0.5);
    console.log(
      `${paper}: ${boxes.length} placeholders on ${sheets} pages; card ${(boxes[0][0] / MM).toFixed(2)} × ${(boxes[0][1] / MM).toFixed(2)} mm; calibration ${(calibration / MM).toFixed(2)} mm; PDF page ${pdf.width.toFixed(2)} × ${pdf.height.toFixed(2)} mm; ${path}`,
    );
  });
