import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { renderToStaticMarkup } from 'react-dom/server';

async function run() {
  // @ts-expect-error Bun module mocks are confined to this subprocess.
  const { mock } = await import('bun:test');
  const events: unknown[] = [];
  mock.module('server-only', () => ({}));
  mock.module('@next/third-parties/google', () => ({
    GoogleAnalytics: ({ gaId }: { gaId: string }) => <span data-synthetic-ga={gaId} />,
    sendGAEvent: (...args: unknown[]) => events.push(args),
  }));
  const { GoogleAnalyticsProvider, useGoogleAnalytics } = await import('../../components/google-analytics');
  Object.assign(globalThis, { window: {} });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  function Child() {
    useGoogleAnalytics()('price_check_viewed', {});
    return <span>Synthetic child</span>;
  }
  for (const [enabled, gaId, expected] of [
    [true, undefined, false],
    [false, 'G-SYNTHETIC', false],
    [true, 'G-SYNTHETIC', true],
  ] as const) {
    events.length = 0;
    const html = renderToStaticMarkup(
      <GoogleAnalyticsProvider enabled={enabled} gaId={gaId}>
        <Child />
      </GoogleAnalyticsProvider>,
    );
    assert.equal(html.includes('data-synthetic-ga="G-SYNTHETIC"'), expected);
    assert.equal(events.length, expected ? 1 : 0);
  }
  const { billingReturnUrl } = await import('../../lib/server/stripe');
  delete process.env.NEXT_PUBLIC_SITE_URL;
  assert.throws(() => billingReturnUrl(), /NEXT_PUBLIC_SITE_URL/);
  process.env.NEXT_PUBLIC_SITE_URL = 'https://synthetic.test/app?ignored=yes#fragment';
  assert.equal(billingReturnUrl(), 'https://synthetic.test/app?billing=return');
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3287';
  assert.equal(billingReturnUrl(), 'http://localhost:3287/app?billing=return');
  const script = new URL('../../scripts/setup-stripe-billing.ts', import.meta.url).pathname;
  assert.throws(
    () =>
      execFileSync(process.execPath, [script], {
        env: {
          ...process.env,
          STRIPE_SETUP_ACCOUNT_ID: '',
          STRIPE_SETUP_WEBHOOK_URL: '',
          STRIPE_SECRET_KEY: 'synthetic',
        },
        stdio: 'pipe',
      }),
    /STRIPE_SETUP_ACCOUNT_ID/,
  );
  assert.throws(
    () =>
      execFileSync(process.execPath, [script], {
        env: {
          ...process.env,
          STRIPE_SETUP_ACCOUNT_ID: 'acct_synthetic',
          STRIPE_SETUP_WEBHOOK_URL: 'http://synthetic.test/app/api/billing/webhook',
          STRIPE_SECRET_KEY: 'synthetic',
        },
        stdio: 'pipe',
      }),
    /HTTPS/,
  );
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
