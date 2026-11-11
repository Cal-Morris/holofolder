import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { GoogleAnalytics } from '@next/third-parties/google';
import { sendGoogleEvent } from '../lib/google-analytics';

test('Google events stay disabled outside production and queue before the remote script loads', () => {
  const online = Object.getOwnPropertyDescriptor(navigator, 'onLine');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  const previous = globalThis.window;
  const browser: { dataLayer?: unknown[] } = {};
  Object.assign(globalThis, { window: browser });
  try {
    renderToString(createElement(GoogleAnalytics, { gaId: 'G-SYNTHETIC' }));
    sendGoogleEvent(false, 'screen_view', { screen_name: 'wanted', show_mode: false, read_only: false });
    assert.equal('dataLayer' in browser, false);
    sendGoogleEvent(true, 'screen_view', { screen_name: 'wanted', show_mode: false, read_only: false });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    sendGoogleEvent(true, 'search_opened', { surface: 'search' });
    assert.equal(browser.dataLayer?.length, 1);
    assert.deepEqual(Array.from(browser.dataLayer?.[0] as ArrayLike<unknown>), [
      'event',
      'screen_view',
      { screen_name: 'wanted', show_mode: false, read_only: false },
    ]);
  } finally {
    Object.assign(globalThis, { window: previous });
    if (online) Object.defineProperty(navigator, 'onLine', online);
    else Reflect.deleteProperty(navigator, 'onLine');
  }
});
