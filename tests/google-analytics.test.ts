import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { GoogleAnalytics } from '@next/third-parties/google';
import { collectionEvents, sendGoogleEvent } from '../lib/google-analytics';
import type { SlotOfflineIntent } from '../lib/collection/slot-optimistic';

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

// Synthetic intents: only the fields collectionEvents reads.
const intent = (value: unknown) => value as SlotOfflineIntent;

describe('collectionEvents', () => {
  test('counts inventory commands per event', () => {
    const events = collectionEvents(
      intent({ kind: 'inventory', request: { commands: [{ kind: 'add' }, { kind: 'add' }, { kind: 'removeOwned' }] } }),
    );
    assert.deepEqual(
      [...events],
      [
        ['card_added', 2],
        ['card_removed', 1],
      ],
    );
  });

  test('splits slot updates into wanted and slot edits', () => {
    const events = collectionEvents(
      intent({
        kind: 'slots',
        request: { commands: [{ kind: 'update', wantedCards: [] }, { kind: 'update' }, { kind: 'clear' }] },
      }),
    );
    assert.deepEqual(
      [...events],
      [
        ['wanted_updated', 1],
        ['slot_updated', 1],
        ['slots_removed', 1],
      ],
    );
  });

  test('creation is one binder_created and raw restore is ignored', () => {
    assert.deepEqual([...collectionEvents(intent({ kind: 'creation', request: {} }))], [['binder_created', 1]]);
    assert.equal(collectionEvents(intent({ kind: 'raw-restore', request: {} })).size, 0);
  });
});
