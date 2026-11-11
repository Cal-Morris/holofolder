import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOfflineResource } from '@/lib/offline-download';

test('show downloads retry truncated response bodies and transient failures, but stop at three attempts', async () => {
  let calls = 0;
  const options = {
    retryDelay: async () => {},
    fetcher: (async () => {
      calls++;
      if (calls === 1)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError('Synthetic lost connection'));
            },
          }),
        );
      if (calls === 2) return new Response(null, { status: 503 });
      return new Response('synthetic complete body');
    }) as typeof fetch,
  };
  assert.equal(await (await fetchOfflineResource('/synthetic', options)).text(), 'synthetic complete body');
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(
    fetchOfflineResource('/synthetic', {
      ...options,
      fetcher: (async () => {
        calls++;
        return new Response(null, { status: 503 });
      }) as typeof fetch,
    }),
  );
  assert.equal(calls, 3);
});
test('auth failures and explicit cancellation never retry', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(null, { status: 401 });
  }) as typeof fetch;
  await assert.rejects(fetchOfflineResource('/synthetic', { fetcher, retryDelay: async () => {} }));
  assert.equal(calls, 1);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(fetchOfflineResource('/synthetic', { fetcher, signal: abort.signal }));
  assert.equal(calls, 1);
});
