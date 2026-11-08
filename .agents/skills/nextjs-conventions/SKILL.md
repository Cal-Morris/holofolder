---
name: nextjs-conventions
description: Next.js 16 App Router conventions for Holo Folder, covering cacheComponents/PPR static shells, reading the session in proxy and pages (getClaims rather than getUser), the proxy matcher, next/dynamic for heavy client code, images, error/not-found boundaries, and measuring first-load JS and Lighthouse. Use when adding or changing a page, layout, proxy, route config, next.config or a heavy client dependency.
---

# Next.js conventions

Next 16.4 (App Router, Turbopack) and React 19.3. Read `node_modules/next/dist/docs/` before using an API you haven't used here; it may differ from your training data.

## Rendering: static shell first

- `cacheComponents: true` is on. Pages are ◐ partial prerenders: everything that doesn't read request data goes into a static shell served from the CDN, and only the holes stream.
- **Don't `await` request data (`cookies()`, the session, `headers()`) at the top of a page.** That turns the whole page into a hole, and the shell becomes the root `loading.tsx` spinner. Instead, start the work in the server component and pass the **promise** to a client component, which reads it with `use()` inside a small `<Suspense>`. `app/home/page.tsx` → `components/home-page.tsx` (`SignedInText`) is the reference: the shell now holds the whole marketing page, about 33 kB of HTML.
- Check the shell after a build: `.next/server/app/<route>.html` should contain the real page, not just the spinner.
- The binder (`app/page.tsx`) is the extreme case: the page is not async, the shell is `BinderSkeleton`, and `components/binder-start.tsx` races the server boot promise against this device's saved binder (`lib/binder-start.ts`). The local start is allowed only for the account, owner and binder the server last opened here (the `binderdex_start_v1` marker). Whichever arrives first is kept, so BinderApp does not remount. A later server boot (switching binder, a refresh) always comes from the server. If you add a BinderApp prop that `/` passes, add it to `ServerBinderBoot` and, if it should survive a local start, to the marker.
- Shared catalog data uses `"use cache: remote"` with `cacheTag`/`cacheLife` (`lib/tcg-mirror.ts`); the sync calls `revalidateTag("tcg-mirror", { expire: 0 })`. Never cache per-user data this way.
- Route handlers that read cookies run per request. If one logs a prerender `HANGING_PROMISE_REJECTION`, `await connection()` before reading the request.

## Session: getClaims, not getUser, for reads

- `proxy.ts` and the pages read the user with `supabase.auth.getClaims()` (`lib/supabase/session-user.ts` → `getSessionUser`). Our keys are asymmetric (ES256), so the JWT is checked locally against a cached JWKS with no Auth round trip. Expired sessions are still refreshed.
- `getUser()` costs a network call to Supabase Auth each time. Keep it for write API routes that must reject a session revoked server-side. RLS enforces data access either way.

## Proxy (middleware)

- `proxy.ts` runs before every matched request, so keep the matcher narrow. Static assets, the SW, the manifest, `/app-shell` and the public catalog APIs are excluded.
- The `config.matcher` must be an **inline literal** (it's analysed at build time, so a const reference is ignored). `tests/proxy-matcher.test.ts` pins which paths run it; update the test when you change it.

## Client JavaScript

- Measure first-load JS with `bun run build && bun run analyze:first-load` (gzip kB per route); Turbopack's build output no longer prints it. Put before/after numbers in perf PRs.
- Heavy or below-the-fold client code loads with `next/dynamic`: three.js, recharts, modals and sheets. `AuthModal` on `/home` is `ssr: false`, which keeps supabase-js (about 56 kB gzip) off the landing page (237 → 161 kB).
- An SSR-kept dynamic view needs a `loading` option (its own Suspense boundary); see AGENTS.md.
- `optimizePackageImports` defaults already cover lucide-react and recharts; don't add barrel imports of other big libraries.
- Lazy chunks named inside the `/app-shell` scripts are precached by `sw.js`. Something the offline binder needs must be reachable from there (see `offline-and-caching`).

## Images and fonts

- Use `CardImage` for card previews: its Next Image loader generates responsive `/api/card-image-proxy` URLs (sharp; widths 96/160/240/320/480/600), with a loading placeholder and original-image retry for older offline caches. This keeps resizing outside Vercel Hobby image-optimisation quotas. Prefetch uses the same loader and `sizes`.
- Fonts are `next/font` Inter and JetBrains Mono, used by family name through `--font-inter`/`--font-jetbrains-mono`. `sw.js` precaches the preloaded (`-s.p.`) Latin files for offline, so check offline before changing `preload` or subsets.

## Error and not-found UI

- `app/error.tsx` (inside the layout; Try again uses `retry()`, and Open binder does a full navigation to `/app-shell`, which works offline), `app/global-error.tsx` (its own document, inline styles) and `app/not-found.tsx` (static). Add segment-level `error.tsx` only where a segment can recover by itself.

## Observability and checks

- `<Analytics />` and `<SpeedInsights />` are in the root layout. Use Speed Insights (real mobile users) as well as Lighthouse.
- When performance/browser verification is authorized, audit the actual route: marketing is on `https://holofolder.com`, and the app starts at `/app`. A signed-out `/app` request measures the login page, not an authenticated binder.
- Playwright on a shared box: use `--workers=2`. The WebGL and designer specs flake with more parallel workers.

## Vercel

- Fluid compute on; functions in `iad1`, next to Supabase `us-east-1`. Keep them in the same region; don't add `runtime = "edge"` to routes that talk to the DB.
