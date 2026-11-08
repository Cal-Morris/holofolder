# Testing

Use synthetic data and your own local server port. Never point the e2e harness at production services or use real payment/provider credentials. Normal `bun run test:e2e` configures a local harness server automatically; `E2E_BASE_URL` uses a server you start yourself.

## Persistent local e2e server

For repeated test runs, use a persistent local server running a production build on your own port. Set these synthetic test values in **both terminals**, overriding any real values in `.env.local`:

```sh
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399
export NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-anon-key
# Fake e2e placeholder only, not a usable production VAPID key.
export NEXT_PUBLIC_VAPID_PUBLIC_KEY=c3ludGhldGljLWUyZS12YXBpZC1wdWJsaWMta2V5
# First terminal
HOLOFOLDER_E2E=1 bun run build
HOLOFOLDER_E2E=1 bun run start -p 3279
# Second terminal
E2E_BASE_URL=http://localhost:3279 bun run test:e2e:smoke --workers=2
```

This avoids rebuilding between test edits or reruns. After changing app code, stop the server, rebuild and restart it. Run a relevant spec against the same server with `E2E_BASE_URL=http://localhost:3279 bun run test:e2e e2e/card-browser.e2e.ts --workers=2`. Without `E2E_BASE_URL`, the normal command handles the build and server automatically.

Local runs capture a screenshot on failure without recording every passing test. To debug a failure with a trace, rerun its spec with `--trace=retain-on-failure`; when Playwright runs with `CI=1`, it records traces on the first retry. Keep `.next/cache` between builds: Next.js already uses Turbopack and its filesystem build cache by default.

## About the VAPID placeholder

The value above decodes to `synthetic-e2e-vapid-public-key`. It is deliberately synthetic, is not a usable production Web Push key and has no associated private key in this repository. It enables the mocked notification flow in the e2e harness. `playwright.config.ts` also supplies a synthetic default when it starts the test server itself.

For a real deployment, configure your own VAPID key pair as described in [`.env.example`](../.env.example): `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is sent to browsers, while `VAPID_PRIVATE_KEY` must stay server-only. Never replace the test placeholder in this guide with your private key or a production secret.
