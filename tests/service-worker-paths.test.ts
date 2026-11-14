import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const context = createContext({
    URL,
    self: {
      location: { origin: 'https://holofolder.com' },
      addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    },
  });
  runInContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  return { context, listeners };
}

test('offline shell discovers prefixed build assets and lazy chunks', () => {
  const { context } = worker();
  assert.equal(
    runInContext(
      `getAppShellAssetUrls('<script src="/app/_next/static/chunks/test.js?dpl=abc"></script>')[0]`,
      context,
    ),
    '/app/_next/static/chunks/test.js?dpl=abc',
  );
  assert.equal(
    runInContext(`getReferencedChunkPaths('"static/chunks/lazy.js"', '?dpl=abc')[0]`, context),
    '/app/_next/static/chunks/lazy.js?dpl=abc',
  );
});

test('worker leaves Framer marketing navigations alone even with an older broad registration', () => {
  const { listeners } = worker();
  for (const pathname of ['/', '/pricing', '/application', '/@cal/national']) {
    let intercepted = false;
    listeners.get('fetch')!({
      request: { method: 'GET', mode: 'navigate', url: `https://holofolder.com${pathname}` },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, pathname);
  }
});

test('failed named share navigations never reveal the private offline binder', async () => {
  const { context } = worker();
  context.fetch = async () => {
    throw new Error('synthetic offline network');
  };
  context.caches = { open: async () => ({ match: async () => 'synthetic private binder shell' }) };
  for (const path of ['/app/u/cal/national', '/app/share/token', '/@cal/national']) {
    await assert.rejects(
      runInContext(`handleNavigation({request:{url:${JSON.stringify(`https://holofolder.com${path}`)}}})`, context),
      /synthetic offline network/,
    );
  }
});

test('offline shell downloads lazy screens referenced by its scripts', async () => {
  const { context } = worker();
  const entries = new Map<string, Response>([
    ['/app/_next/static/chunks/main.js', new Response('"static/chunks/lazy-screen.js"')],
  ]);
  context.cache = {
    match: async (url: string) => entries.get(url)?.clone(),
    put: async (url: string, response: Response) => {
      entries.set(url, response);
    },
  };
  context.fetch = async () => new Response('synthetic lazy screen');
  await runInContext('precacheLazyChunks(cache, ["/app/_next/static/chunks/main.js"])', context);
  assert.equal(await entries.get('/app/_next/static/chunks/lazy-screen.js')?.text(), 'synthetic lazy screen');
});

test('developer data never enters the image cache or offline navigation shell', () => {
  const { listeners } = worker();
  for (const path of [
    '/app/api/v1/cards/synthetic.png',
    '/app/api/developer/keys',
    '/app/mcp',
    '/app/oauth/consent',
    '/api/v1/cards/synthetic.png',
  ]) {
    let intercepted = false;
    listeners.get('fetch')!({
      request: { method: 'GET', mode: 'cors', destination: 'image', url: `https://holofolder.com${path}` },
      respondWith: (response: Promise<unknown>) => {
        intercepted = true;
        void response.catch(() => {});
      },
    });
    assert.equal(intercepted, false, path);
  }
});
test('offline consent and docs cannot fall back to a private binder', async () => {
  const { context } = worker();
  context.fetch = async () => {
    throw new Error('synthetic offline');
  };
  context.caches = { open: async () => ({ match: async () => 'private binder' }) };
  for (const path of ['/app/oauth/consent', '/app/docs', '/app/mcp'])
    await assert.rejects(
      runInContext(`handleNavigation({request:{url:${JSON.stringify(`https://holofolder.com${path}`)}}})`, context),
      /synthetic offline/,
    );
});

test('private artwork and signed object URLs never enter shared worker caches', () => {
  const { listeners } = worker();
  for (const url of [
    'https://holofolder.com/app/api/binder-appearance/artwork?id=synthetic',
    'https://account.r2.cloudflarestorage.com/private/owner/object?X-Amz-Signature=synthetic',
  ]) {
    let intercepted = false;
    listeners.get('fetch')!({
      request: { method: 'GET', mode: 'cors', destination: 'image', url },
      respondWith: (response: Promise<unknown>) => {
        intercepted = true;
        void response.catch(() => {});
      },
    });
    assert.equal(intercepted, false, url);
  }
});

test('private complete reads bypass fetch caches and warm-ups, including image-like paths', async () => {
  const { context, listeners } = worker();
  context.fetch = async () => {
    throw new Error('private read must not be warmed');
  };
  context.caches = {
    open: async () => {
      throw new Error('private read must not use caches');
    },
  };
  for (const path of [
    '/app/api/inventory',
    '/api/inventory',
    '/app/api/binder-slots',
    '/app/api/inventory/private.png',
    '/app/api/binder-slots/private.png',
  ]) {
    let intercepted = false;
    listeners.get('fetch')!({
      request: { method: 'GET', mode: 'cors', destination: 'image', url: `https://holofolder.com${path}` },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, path);
    context.url = path;
    await runInContext('warmCacheUrl(url)', context);
  }
});

test('private/no-store complete responses are never cacheable through another cache helper', () => {
  const { context } = worker();
  for (const policy of ['private, no-store', 'no-store', 'private, max-age=60']) {
    context.response = Response.json({ synthetic: true }, { headers: { 'Cache-Control': policy } });
    assert.equal(runInContext('isCacheableResponse(response)', context), false);
  }
  context.response = new Response('synthetic public image', { headers: { 'Cache-Control': 'public, immutable' } });
  assert.equal(runInContext('isCacheableResponse(response)', context), true);
});

test('evicted startup chunks return a static recovery notice without private data or cache deletion', async () => {
  const { context } = worker();
  context.Response = Response;
  context.caches = {
    open: async () => ({
      match: async (key: string) =>
        key === '/app/app-shell'
          ? new Response('<script src="/app/_next/static/chunks/evicted.js"></script>')
          : undefined,
    }),
  };
  const response = (await runInContext('getOfflineAppShell()', context)) as Response;
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Pending edits have not been removed/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('offline, a set lookup saved before the slim v=2 response still answers from its old cached copy', async () => {
  const { context } = worker();
  const old = '/app/api/tcg-set-slots?query=Base+Set&setId=base1';
  context.setTimeout = setTimeout;
  context.clearTimeout = clearTimeout;
  context.fetch = async () => {
    throw new Error('synthetic offline network');
  };
  context.caches = {
    open: async () => ({
      match: async (key: { url?: string } | string) => {
        const url = typeof key === 'string' ? key : key.url;
        return url === `https://holofolder.com${old}` ? 'synthetic saved set' : undefined;
      },
    }),
  };
  const request = { url: `https://holofolder.com${old}&v=2` };
  assert.equal(await runInContext(`networkFirst(${JSON.stringify(request)}, 'data')`, context), 'synthetic saved set');
  assert.equal(
    runInContext(`unversionedSetSlotsRequest({url:'https://holofolder.com/app/api/tcgdex-cache?v=2'})`, context),
    null,
  );
});
