# Native binder grid hit targets (#364/#379)

This is a staged app geometry fix. Native admission, SQL, auth, queue protocols, API operations and BrowserSession are unchanged. #364/#379 stay open; parent owns independent review, merge, rollout and full acceptance. No release publication applies to this hidden preparation.

## Cause and correction

On main `3ac096b`, at 375×667 standalone with 59px/34px safe areas, settled Browse measured a 359×52.44px stage and 42.31×48px fitted 3×3 page. Edit measured a 359×84.44px stage and 65.22×80px page. The grid allocates zero-minimum fractional tracks, while ordered slot buttons retain 36×36px minimums. Buttons therefore extend into adjacent tracks. The final regression fails on the first ordinary Browse click: alpha-empty-4 intercepts alpha-empty-0. The retained Playwright trace records the actual pointer interception. The earlier d883801 startup investigation measured the same 42.31×48px mechanism with alpha-empty-1 interception; #484's toolbar Append setup intentionally avoids this defect rather than fixing it.

The toolbar was outside the scrollport, consuming fixed height above a stage that could shrink to zero. The aspect-ratio fit then used that remaining height without considering minimum pocket width. The fix puts the native toolbar inside the existing content scrollport above the dock and reserves stage height for up to four rows of 36px-wide card-shaped targets plus grid chrome. Taller grids retain their existing internal scroller and 64×90px pockets. Grid content has explicit minimum track dimensions even on small grids, so fitting cannot make neighbouring button bounds overlap. Required controls remain available by scrolling. The shared 3D renderer and stored rows/columns remain unchanged.

## Local proof

Bun 1.3.14, synthetic localhost Supabase configuration, production builds and own port 3429. No hosted access. Reproduction logs and test artifacts are retained at `/Users/cal/dev/plans/native-grid-hit-targets-3ac096b/`.

`e2e/native-grid-hit-targets.e2e.ts` uses the actual native consumer host with synthetic complete inventory HTTP evidence. It uses ordinary semantic pointer clicks, exact stable-ID selection assertions, explicit Browse/Edit mode, bulk selection, and all-pairs geometry checks. 3×3, 4×4 and 8×8 are exercised across all six phone profiles. The final pocket must scroll into the safe viewport above the dock and remain hittable. Document overflow and dock hit targets are checked. No forced clicks, sleeps, timeout changes or startup assertion changes.

At 375×667, fixed 3×3 grids measure 148.27×196px with minimum pockets 40.08×56px in Browse and Edit. Fixed 4×4 grids measure 190.78×253px with minimum pockets 39.19×54.75px. 8×8 content remains 570×778px with 64×90px pockets inside its page scroller. This is emulated Chromium phone geometry, not physical-device or installed-PWA proof.

The feature's underlying slot data operations already have staged REST/MCP contracts. Viewport fitting, hit testing and transient screen selection are app-only geometry, so no registry/schema/generated OpenAPI change is appropriate. Native help and API coverage explain this boundary. No unpublished release copy is needed until the parent enables a coherent user-facing block.

## Checked commands

With the pinned Bun directory first in `PATH`, build and start with `HOLOFOLDER_E2E=1`, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399` and `NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-anon-key`:

```sh
bun run build
bunx next start -p 3429
E2E_BASE_URL=http://localhost:3429 bun run test:e2e:matrix \
  e2e/native-grid-hit-targets.e2e.ts e2e/native-startup.e2e.ts \
  e2e/binder-slot-editing.e2e.ts e2e/custom-binder-layout.e2e.ts \
  e2e/binder-3d-interactions.e2e.ts \
  --grep='native [348]x[348] grid|previously cached native pending layout survives|first insertion shifts whole slots|pointer begun in Browse|premium layouts save per binder|staged 3D slots preserve copy identity' \
  --workers=2
bun test tests/binder-display-model.test.ts tests/binder-slot-editing.test.ts \
  tests/binder-bulk-editing.test.ts tests/binder-camera.test.ts tests/docs-markdown.test.ts
bun run typecheck
bun run lint
```

Results: 48/48 affected e2e cases in 1.1 minutes, 24/24 unit tests, typecheck and production build pass; lint passes with the existing 55 warnings. No full e2e run. Craft/gesture review found no new motion or pointer-handler changes; minimum grid tracks, nested large-grid scrolling, explicit Edit, exact copy/slot selection and dock/safe-area reachability are covered by the focused matrix. Review, hosted CI, merge, deploy, physical phones and full feature acceptance remain parent-owned.
