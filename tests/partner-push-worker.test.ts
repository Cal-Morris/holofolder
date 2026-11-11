import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const person = '00000000-0000-4000-8000-000000000001';
const eventId = '00000000-0000-4000-8000-000000000002';
const binder = '00000000-0000-4000-8000-000000000003';
function runtime(
  account: string | null,
  response: { ok: boolean; json?: () => Promise<unknown> },
  clients: Array<{ url: string; navigate: (url: string) => Promise<void>; focus: () => Promise<void> }> = [],
) {
  const handlers = new Map<string, (event: unknown) => void>();
  const notifications: Array<{ title: string; options: Record<string, unknown> }> = [];
  const destinations: string[] = [];
  const requests: string[] = [];
  let reads = 0;
  const transaction = {
    objectStore: () => ({
      get: () => {
        const request: { result: unknown; onsuccess?: () => void } = { result: { userId: account } };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    }),
  };
  runInNewContext(worker, {
    URL,
    AbortSignal,
    console,
    setTimeout,
    clearTimeout,
    indexedDB: {
      open: () => {
        const request: { result: unknown; onsuccess?: () => void } = {
          result: { transaction: () => transaction, close() {} },
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
    fetch: async (url: string) => {
      requests.push(url);
      reads++;
      return response;
    },
    self: {
      location: { origin: 'https://binder.test' },
      addEventListener: (name: string, callback: (event: unknown) => void) => handlers.set(name, callback),
      registration: {
        showNotification: async (title: string, options: Record<string, unknown>) => {
          notifications.push({ title, options });
        },
      },
      clients: {
        matchAll: async () => clients,
        openWindow: async (url: string) => {
          destinations.push(url);
        },
      },
    },
  });
  const dispatch = async (name: string, data: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get(name)?.({
      ...data,
      waitUntil: (work: Promise<unknown>) => {
        pending = work;
      },
    });
    await pending;
  };
  return { notifications, destinations, requests, reads: () => reads, dispatch };
}

test('registration test pushes confirm the bound device and open the app without a private preview', async () => {
  const app = runtime(person, { ok: false });
  await app.dispatch('push', { data: { json: () => ({ kind: 'test', recipientId: person, tag: 'holofolder-test' }) } });
  assert.equal(app.notifications[0].title, 'Notifications are on');
  assert.equal(app.notifications[0].options.icon, '/app/holofolder-icon-192.png');
  assert.equal(app.notifications[0].options.badge, '/app/holofolder-monochrome.svg');
  assert.equal(app.notifications[0].options.body, 'This device is ready for price check and partner updates.');
  assert.equal(app.reads(), 0);
  await app.dispatch('notificationclick', { notification: { close() {}, data: app.notifications[0].options.data } });
  assert.deepEqual(app.destinations, ['/app']);
  const signedOut = runtime(null, { ok: false });
  await signedOut.dispatch('push', { data: { json: () => ({ kind: 'test', recipientId: person }) } });
  assert.equal(signedOut.notifications[0].title, 'Holo Folder update');
});

test('worker fetches an authorized preview, constrains click destinations and rechecks membership', async () => {
  const app = runtime(person, {
    ok: true,
    json: async () => ({
      title: 'Partner got Bulbasaur',
      body: 'Synthetic card fixture',
      url: `/app?binder=${binder}`,
    }),
  });
  await app.dispatch('push', { data: { json: () => ({ recipientId: person, eventId, tag: 'synthetic-event' }) } });
  assert.equal(app.notifications[0].title, 'Partner got Bulbasaur');
  assert.equal(app.notifications[0].options.icon, '/app/holofolder-icon-192.png');
  assert.equal(app.reads(), 1);
  assert.deepEqual(app.requests, [`/app/api/push/events/${eventId}`]);
  await app.dispatch('notificationclick', { notification: { close() {}, data: app.notifications[0].options.data } });
  assert.equal(app.reads(), 2);
  assert.deepEqual(app.destinations, [`/app?binder=${binder}`]);
  const unsafe = runtime(person, { ok: true, json: async () => ({ title: 'Update', url: 'https://evil.test/' }) });
  await unsafe.dispatch('push', { data: { json: () => ({ recipientId: person, eventId }) } });
  assert.equal((unsafe.notifications[0].options.data as { url: string }).url, '/app');
});

test('worker redacts previews after unlink, signout, account change and unavailable authorization', async () => {
  for (const account of [person, null, 'different-account']) {
    const app = runtime(account, { ok: false });
    await app.dispatch('push', {
      data: {
        json: () => ({ recipientId: person, eventId, title: 'Private payload is ignored', body: 'Secret card' }),
      },
    });
    assert.equal(app.notifications[0].title, 'Holo Folder update');
    assert.equal(app.notifications[0].options.body, 'Open the app to see your update.');
    assert.equal(app.reads(), account === person ? 1 : 0);
    await app.dispatch('notificationclick', { notification: { close() {}, data: app.notifications[0].options.data } });
    assert.deepEqual(app.destinations, ['/app']);
  }
});

test('notification clicks reuse an app tab and leave marketing tabs alone', async () => {
  const navigated: string[] = [];
  const client = (url: string) => ({
    url,
    navigate: async (target: string) => {
      navigated.push(`${url} -> ${target}`);
    },
    focus: async () => {},
  });
  const marketing = client('https://binder.test/');
  const appTab = client('https://binder.test/app?binder=old');
  const app = runtime(null, { ok: false }, [marketing, appTab]);
  await app.dispatch('notificationclick', { notification: { close() {}, data: {} } });
  assert.deepEqual(navigated, ['https://binder.test/app?binder=old -> /app']);
  const onlyMarketing = runtime(null, { ok: false }, [marketing]);
  await onlyMarketing.dispatch('notificationclick', { notification: { close() {}, data: {} } });
  assert.deepEqual(onlyMarketing.destinations, ['/app']);
  assert.equal(navigated.length, 1);
});

test('notification destinations reject marketing, auth, shares and external URLs', async () => {
  for (const url of [
    '/',
    '/app/auth/login',
    '/app/share/synthetic',
    '//evil.test/app',
    `/app?binder=invalid`,
    `/?binder=${binder}`,
  ]) {
    const app = runtime(person, { ok: true, json: async () => ({ title: 'Synthetic update', url }) });
    await app.dispatch('push', { data: { json: () => ({ recipientId: person, eventId }) } });
    assert.equal((app.notifications[0].options.data as { url: string }).url, '/app');
  }
});

test('comparison completion pushes verify the initiator preview on receipt and click', async () => {
  const app = runtime(person, {
    ok: true,
    json: async () => ({ title: 'Price checks finished', body: '65 printings checked.', url: '/app' }),
  });
  await app.dispatch('push', {
    data: { json: () => ({ kind: 'comparison', recipientId: person, eventId, tag: `comparison:${eventId}` }) },
  });
  assert.equal(app.notifications[0].title, 'Price checks finished');
  assert.deepEqual(app.requests, [`/app/api/push/comparisons/${eventId}`]);
  await app.dispatch('notificationclick', { notification: { close() {}, data: app.notifications[0].options.data } });
  assert.deepEqual(app.requests, [`/app/api/push/comparisons/${eventId}`, `/app/api/push/comparisons/${eventId}`]);
  assert.deepEqual(app.destinations, ['/app']);
  const otherAccount = runtime('someone-else', { ok: false });
  await otherAccount.dispatch('push', { data: { json: () => ({ kind: 'comparison', recipientId: person, eventId }) } });
  assert.equal(otherAccount.notifications[0].title, 'Holo Folder update');
  assert.equal(otherAccount.reads(), 0);
});
