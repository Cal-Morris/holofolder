# Developer docs polish implementation plan

> Implement inline in this session, as requested by Cal. Design approved in chat on 2026-11-08.

**Goal:** Match the marketing site's visual quality and make REST exploration and AI setup immediately useful.

**Architecture:** Retain Fumadocs and the operation registry. Compile its native styles through the existing Tailwind pipeline, restore its docs layout/search, and use fumadocs-openapi for generated per-operation reference pages. Keep the public `/docs` and direct `/app/docs` entry points working.

**Design:** Near-black #07070a background, #0e0e13 panels, #f4f3f8 text, #b9a6ff primary accent, restrained pink/cyan/mint foil details. Inter body and headings, JetBrains Mono for code. Left-aligned reading column, sidebar and desktop table of contents. Mobile navigation and code scrolling must remain usable with safe areas.

## Tasks

- [x] Restore styled Fumadocs layout, grouped sidebar, search and table of contents. Files: app/globals.css, app/docs/*, components/docs/provider.tsx, lib/docs-source.ts, app/api/docs-search/route.ts, content/docs/meta.json. Test: focused docs browser checks including heading sizes, navigation, search and overflow.
- [x] Integrate native OpenAPI explorer using public/openapi.json and generated per-operation pages. Files: lib/docs-openapi.ts, components/docs/api-page.tsx, scripts/generate-api-docs.ts, content/docs/reference/*, lib/docs-source.ts. Preserve the operation registry as source of truth. Test: every operation represented, actual /app API base URL, editable authenticated request and response using a mocked backend.
- [x] Rewrite overview/API key onboarding and add prominently linked AI/agent guides for compatible clients, with official setup links and clear OAuth versus key instructions. Files: content/docs/*.mdx and content/docs/agents/*.mdx. Verify instructions against current primary documentation.
- [x] Verify focused unit tests, typecheck, lint, production build and focused docs e2e at all six phone viewports plus desktop. Check code copying, search, native explorer, mobile navigation and safe areas. Review against design/animation principles. Commit once, push, open PR, enforce release gates and verify production.

## Review focus

- Direct-origin links retain /app; marketing links retain /docs, including search results and anchors.
- A long credential, endpoint or response scrolls within its own panel rather than widening the page.
- Native playground stores no credentials persistently and calls the supported same-origin /app/api/v1 URL.
- Search and navigation remain reachable at 375 px and with standalone safe areas.
- Agent instructions distinguish OAuth-capable MCP clients from REST scripts and do not claim unavailable client features.

## Validation and review

- Unit suite: 1,123 passed. Typecheck and production build passed. Lint: 55 existing warnings, zero new warnings.
- Focused docs and developer-access e2e: 42 passed across all six phone projects. Desktop explorer checked at 1440 px.
- Fresh review found duplicate reference navigation and a sticky safe-area regression; both fixed, with a browser regression test.
- Native Fumadocs search and playground controls are retained. API-key input is masked; bearer formatting is handled by the docs adapter and credentials stay in tab session storage.
- Release proceeds through the PR Typecheck/Vercel gates. Live third-party OAuth sign-ins were not exercised; requests used a clearly synthetic mocked key and response.
