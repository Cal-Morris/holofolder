import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testMatch: /modal-scroll\.e2e\.ts$/,
  projects: [
    // Run every test of this file on each project, not only @matrix ones.
    ...config.projects!.map(({ grep: _grep, ...project }) => project),
    ...[
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ].map((viewport) => ({
      name: `webkit-${viewport.width}x${viewport.height}`,
      // WebKit wheel/layout coverage; native touch injection below uses Chromium's CDP.
      use: { browserName: 'webkit' as const, viewport },
    })),
    ...[
      { width: 1440, height: 900 },
      { width: 800, height: 500 },
    ].map((viewport) => ({
      name: `desktop-${viewport.width}x${viewport.height}`,
      use: { browserName: 'chromium' as const, viewport },
    })),
  ],
});
