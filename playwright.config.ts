import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3210);
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;
// Use a locally installed Chrome when available (e.g. CHROME_PATH=/usr/bin/google-chrome),
// otherwise Playwright's bundled Chromium (`bunx playwright install chromium`).
const executablePath = process.env.CHROME_PATH || undefined;

const iphone = devices['iPhone 13'];
const viewports = [
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
];

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 7_500 },
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL,
    trace: process.env.CI ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    launchOptions: executablePath ? { executablePath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] },
  },
  projects: viewports.flatMap((viewport) => [
    {
      name: `browser-${viewport.name}`,
      default: viewport.width === 390,
      use: {
        ...iphone,
        browserName: 'chromium' as const,
        viewport: { width: viewport.width, height: viewport.height },
        // Playwright's iPhone profile is WebKit-based; we drive Chromium with the same touch/mobile settings.
        defaultBrowserType: undefined,
      },
      metadata: { standalone: false },
    },
    {
      name: `standalone-${viewport.name}`,
      default: viewport.width === 390,
      use: {
        ...iphone,
        browserName: 'chromium' as const,
        viewport: { width: viewport.width, height: viewport.height },
        defaultBrowserType: undefined,
      },
      metadata: { standalone: true },
    },
  ]),
  webServer: [
    // Synthetic PostgREST at the e2e Supabase URL, so the real share routes render server-side (e2e/public-binder-compat.e2e.ts).
    // Answers only its fixture tables under /rest/v1/; every other Supabase path is a 404, as an unreachable backend was before.
    {
      command: 'bun scripts/verify-public-share-backend.ts',
      url: 'http://127.0.0.1:54399/rest/v1/binder_shares',
      reuseExistingServer: !process.env.CI,
    },
    ...(process.env.E2E_BASE_URL
      ? []
      : [
          {
            command: `bun run build && bunx next start -p ${PORT}`,
            url: `${baseURL}/app/e2e-harness`,
            timeout: 300_000,
            reuseExistingServer: !process.env.CI,
            env: {
              HOLOFOLDER_E2E: '1',
              NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54399',
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
