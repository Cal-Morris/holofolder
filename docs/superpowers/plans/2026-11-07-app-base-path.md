# App base path migration

Approved: Framer serves holofolder.com; /app and /app/* rewrite to app.holofolder.com with the same paths. The existing Next.js app moves as a unit. Other feature threads remain paused; their worktrees and indexes are untouched.

1. Pin URL behavior with regression tests: auth callbacks and safe return destinations, shared links, old stored image URLs, PWA scope and worker navigation boundaries.
2. Set Next basePath /app. Prefix browser fetches, raw navigation, public assets, cron paths and share URLs; leave Next Link/router paths relative to the app. Keep storage keys and queued data stable. Use the public production origin for auth redirects through Framer without trusting arbitrary forwarded hosts.
3. Scope worker registration, manifest, offline shell and cached chunks to /app. Preserve image caches and make cached/stored root image URLs usable under the new path. Check previous root worker compatibility before cutover.
4. Update Playwright harness navigation/mocks to exercise the built /app app. Run unit tests, typecheck, lint, build, repeated offline coverage and full six-project e2e on an owned port with two workers.
5. Verify Vercel origin/domain and configuration, commit/push once, open a scoped PR and link it. Merge only on passing checks/reviews or the verified quota exception. Verify production commit and public /app proxy; report any external cutover gate concretely. Give paused threads the final URL contracts before resuming work.

No database migration, unrelated feature work, or Framer marketing edits.

## Progress

- Baseline: 910 unit tests passed on origin/main 1f670a4.
- Implemented and reviewed the full URL boundary. Corrected raw Global Wanted navigation, saved legacy cover artwork and ensured external provider URLs stay unchanged.
- Explicit root proxy matcher covers slashless /app; regression verified against the built server.
- Legacy host uses same-host temporary redirects, retaining special worker and eBay rewrites. Worker retains legacy binder root offline entry and retires only the public old root registration.
- Local checks: 923 unit tests, typecheck, lint with the existing 65 warnings and production build pass. Full six-project e2e was explicitly waived by Cal after starting; stopped the owned run. Earlier targeted smoke: nine binder/offline cases passed; the signed-out root matcher failure was fixed and verified against the built server with a 307 into /app/auth/login. Later full-run cases completed before interruption are recorded in /tmp/holo-app-e2e.log.
- Vercel app.holofolder.com domain verified; previous main deployment is READY. Production NEXT_PUBLIC_SITE_URL updated to https://holofolder.com/app for the upcoming build.
- Framer public /app already reaches Vercel, currently 404 until this migration deploys.
