import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// WebKit mobile emulation has no wheel API; use native desktop wheel input at phone widths.
export default defineConfig({
  ...base,
  testMatch: /show-hunt-rendering\.e2e\.ts$/,
  projects: base.projects!.flatMap((project) =>
    project.metadata?.standalone
      ? []
      : [
          {
            ...project,
            name: `webkit-${project.name}`,
            use: { ...project.use, browserName: 'webkit', isMobile: false, hasTouch: false, launchOptions: {} },
          },
        ],
  ),
});
