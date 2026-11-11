import assert from 'node:assert/strict';

async function run() {
  // Synthetic device only. The revoke request fails offline after local cleanup.
  const order: string[] = [];
  let binding: { userId: string } | undefined = { userId: 'synthetic-owner' };
  // @ts-expect-error Bun types are deliberately absent from the application.
  const { mock } = await import('bun:test');
  mock.module('../../lib/offline-store/kv', () => ({
    getOfflineStore: () => ({
      get: async () => binding,
      delete: async (key: string) => {
        assert.equal(key, 'push:account');
        order.push('clear');
        binding = undefined;
      },
    }),
  }));
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        getRegistration: async (scope: string) => {
          assert.equal(scope, '/app');
          return {
            getNotifications: async () => [{ close: () => order.push('close') }],
            pushManager: {
              getSubscription: async () => ({
                endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
                unsubscribe: async () => {
                  order.push('unsubscribe');
                  return true;
                },
              }),
            },
          };
        },
      },
    },
  });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    assert.equal(url, '/app/api/push/subscriptions');
    assert.equal(init.method, 'DELETE');
    assert.equal(binding, undefined);
    order.push('revoke');
    throw new TypeError('Synthetic offline request');
  }) as typeof fetch;
  const { reconcilePushAccount } = await import('../../lib/push-device-client');
  await reconcilePushAccount('synthetic-owner');
  assert.deepEqual(order, [], 'Opening the same account keeps its device');
  await reconcilePushAccount(null);
  assert.deepEqual(order, ['clear', 'close', 'unsubscribe', 'revoke']);
  assert.equal(binding, undefined);
}
void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
