import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3210);
// The synthetic PostgREST gets its own port per run, derived from E2E_PORT so parallel runs never share one.
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT) || (PORT < 45_536 ? PORT + 20_000 : PORT - 20_000);
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;
// Never test a server this run didn't start (another worktree's build, another agent's backend) unless asked to.
const reuseExistingServer = process.env.E2E_REUSE === '1';
// Read by e2e/fixtures.ts in the workers, which inherit this process's env.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= `http://127.0.0.1:${BACKEND_PORT}`;
// Use a locally installed Chrome when available (e.g. CHROME_PATH=/usr/bin/google-chrome),
// otherwise Playwright's bundled Chromium (`bunx playwright install chromium`).
const executablePath = process.env.CHROME_PATH || undefined;

const iphone = devices['iPhone 13'];
const viewports = [
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
];
// browser-390x844 runs every test. The other five phone projects run only `@matrix` tests (layout, safe areas,
// overflow, dock, sheets) unless E2E_MATRIX=1 (`bun run test:e2e:matrix`) runs everything everywhere.
const PRIMARY = 'browser-390x844';
const matrixOnly = process.env.E2E_MATRIX === '1' ? {} : { grep: /@matrix/ };

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS) || (process.env.CI ? 2 : 4),
  retries: process.env.CI ? 1 : 0,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL,
    trace: process.env.CI ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    launchOptions: executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] },
  },
  projects: viewports.flatMap((viewport) =>
    [false, true].map((standalone) => {
      const name = `${standalone ? 'standalone' : 'browser'}-${viewport.name}`;
      return {
        name,
        ...(name === PRIMARY ? {} : matrixOnly),
        use: {
          ...iphone,
          browserName: 'chromium' as const,
          viewport: { width: viewport.width, height: viewport.height },
          // Playwright's iPhone profile is WebKit-based; we drive Chromium with the same touch/mobile settings.
          defaultBrowserType: undefined,
        },
        metadata: { standalone },
      };
    }),
  ),
  webServer: [
    // Synthetic PostgREST at the e2e Supabase URL, so the real share routes render server-side (e2e/public-binder-compat.e2e.ts).
    // Answers only its fixture tables under /rest/v1/; every other Supabase path is a 404, as an unreachable backend was before.
    {
      command: 'bun --no-env-file scripts/verify-public-share-backend.ts',
      url: `http://127.0.0.1:${BACKEND_PORT}/rest/v1/binder_shares`,
      reuseExistingServer,
      env: { PUBLIC_SHARE_BACKEND_PORT: String(BACKEND_PORT) },
    },
    ...(process.env.E2E_BASE_URL
      ? []
      : [
          {
            // Fails fast on a taken port, skips the build when `.next-e2e` already matches the source.
            command: 'bun --no-env-file scripts/e2e-server.ts',
            url: `${baseURL}/app/e2e-harness`,
            timeout: 600_000,
            reuseExistingServer,
            env: {
              E2E_PORT: String(PORT),
              HOLOFOLDER_E2E: '1',
              NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
              NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'e2e-anon-key',
              // Synthetic key for the share loader's server reads against the synthetic backend above.
              SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'e2e-service-role-key',
              // Synthetic key, subscriptions are mocked in notification tests.
              NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || `BA${'A'.repeat(85)}`,
            },
          },
        ]),
  ],
});
