import type { Page } from '@playwright/test';
import { expect } from './fixtures';

const cdpSessions = new WeakMap<Page, Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>>();

export async function setNetwork(page: Page, offline: boolean) {
  await page.context().setOffline(offline);
  // CDP keeps navigator.onLine right in emulated standalone mode too (the session must stay attached).
  let session = cdpSessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    cdpSessions.set(page, session);
  }
  await session.send('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(!offline);
}
