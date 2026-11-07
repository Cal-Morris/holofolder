import { defineConfig, devices } from "@playwright/test"

const PORT = Number(process.env.E2E_PORT || 3210)
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`
// Use a locally installed Chrome when available (e.g. CHROME_PATH=/usr/bin/google-chrome),
// otherwise Playwright's bundled Chromium (`bunx playwright install chromium`).
const executablePath = process.env.CHROME_PATH || undefined

const iphone = devices["iPhone 13"]
const viewports = [
  { name: "375x667", width: 375, height: 667 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
]

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 7_500 },
  reporter: process.env.CI ? "line" : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    serviceWorkers: "block",
    launchOptions: executablePath ? { executablePath, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] },
  },
  projects: viewports.flatMap((viewport) => [
    {
      name: `browser-${viewport.name}`,
      use: {
        ...iphone,
        browserName: "chromium" as const,
        viewport: { width: viewport.width, height: viewport.height },
        // Playwright's iPhone profile is WebKit-based; we drive Chromium with the same touch/mobile settings.
        defaultBrowserType: undefined,
      },
      metadata: { standalone: false },
    },
    {
      name: `standalone-${viewport.name}`,
      use: {
        ...iphone,
        browserName: "chromium" as const,
        viewport: { width: viewport.width, height: viewport.height },
        defaultBrowserType: undefined,
      },
      metadata: { standalone: true },
    },
  ]),
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `bun run build && bunx next start -p ${PORT}`,
        url: `${baseURL}/app/e2e-harness`,
        timeout: 300_000,
        reuseExistingServer: !process.env.CI,
        env: {
          HOLOFOLDER_E2E: "1",
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54399",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "e2e-anon-key",
        },
      },
})
