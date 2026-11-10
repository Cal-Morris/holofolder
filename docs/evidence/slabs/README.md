# #388 local evidence, 2026-11-10

This is staged source/local evidence, not production admission, public sharing, a hosted migration, provider authenticity or physical-device proof. Base: `fc856a5` (`main` when this lane began). All screenshots use synthetic grading/copy records and mocked catalog images. No real certificate, label photo or official provider artwork is committed.

## Checks

CI Bun **1.3.14** was invoked directly at `/Users/cal/.local/share/holofolder/toolchains/bun-1.3.14/bun-darwin-aarch64/bun` for unit tests and scripts. No full-repo e2e suite was run.

- 50 focused unit/contract/docs cases passed across `slab-presentation`, `collection-navigation`, `browser-host-admission`, `card-grading`, `inventory-query`, `native-startup`, `docs-openapi`, `docs-markdown` and `docs-routing`.
- 132 affected six-phone cases passed: `e2e/slabs.e2e.ts`, `e2e/collection-views.e2e.ts`, `e2e/browser-host.e2e.ts`, `--project='*' --workers=2`, with local `E2E_BASE_URL=http://localhost:3298`.
- After adding the explicit failed-image and real cached-shell relaunch cases, the final 42 Slabs cases passed across all six projects: `e2e/slabs.e2e.ts` plus `e2e/native-startup.e2e.ts --grep 'provider gallery|detail dismisses|view switches|cached offline display|actual BinderApp renders|staged Slabs survives|failed catalog image'`. This is 144 distinct affected phone cases across the two runs, with 30 overlapping Slabs cases rechecked after the final fixture/screenshot updates. Zero retries in the passing runs.
- Typecheck passed. Production-mode `HOLOFOLDER_E2E=1` build and docs CSS verification passed with dummy local Supabase values. Local `/app/docs/slabs` and `/app/docs/markdown/slabs` returned 200. REST/MCP/OpenAPI operations were not changed.
- Full lint passed at the unchanged cap of 55 existing warnings; new renderer/helpers/tests and changed host/harness files have zero focused warnings. `git diff --check` passed.

First test iterations caught fixture-only errors: early list sampling, a mock response missing required private/no-store headers, an incorrect expected filtered-copy count and a failed-image assertion against an already-loaded/lazy image. Tests now wait on state, retain strict transport headers, mock the entire browser context (including new pages), and inject failures before navigating. No production contract was relaxed to make tests pass.

## Screenshot comparison and craft review

[375 gallery](synthetic-gallery-375.png) shows every supported provider style, legacy/current CGC, Gold 10 versus Black 10, raw, neutral unknown, custom teal, absent grades, missing artwork and missing catalog image. The full scroll-region capture hides the fixed dock **only during the screenshot** to avoid compositing it over later rows; the real dock remains visible and is checked in the phone tests. [390 standalone detail](synthetic-gold-detail-390-standalone.png) shows the separate readable grade/metadata and enlarged Gold label. [430 standalone long detail](synthetic-long-detail-430-standalone.png) shows full long provider/grade/qualifier text outside the bounded label preview.

Compared with the dated official images in [the reference ledger](../../slab-rendering.md#official-reference-ledger-checked-2026-11-10): PSA has its narrow silhouette/red perimeter and left-description/right-grade hierarchy; CGC current uses the black masthead and right grade compartment, Pristine has the gold label/black grade badge, and the explicit historic blue label puts the grade on the left; Beckett has a dark insert/provider column, right grade and separate subgrade rows. Gold and Black remain explicit recorded variants. Security artwork and identifiers are deliberately absent. These are recognizable static UI representations, not exact label photographs or manufacturing dimensions. Legacy CGC Pristine/Perfect artwork and other unverified generations retain neutral fallback.

| Before | After | Why |
| --- | --- | --- |
| Slabs unavailable in every navigation host | Existing local-only host and actual BinderApp admit Slabs; production remains denied | Real staged journey without premature rollout |
| No provider-specific depiction | Separate PSA, CGC, historic CGC, Beckett and neutral label structures | Color alone does not establish a provider layout |
| No Slabs detail | Shared named dialog with full metadata, enlarged holder and all six dismissal paths | Small gallery labels have a readable detail counterpart |
| No new motion | Static CSS and image layout, no canvas, transitions or entrance animations | Frequently browsed functional data needs no decorative motion |

Animation review: approve, no added animation. Existing shared swipe dismissal is reused. No layout/transform animation or pointer-hover effect was introduced.

| Worst case | Observed result | Treatment |
| --- | --- | --- |
| Long unbroken custom provider and descriptive grade | Full text stays within gallery/detail width | `min-width: 0`, bounded preview lines, `overflow-wrap: anywhere`; full detail text retained |
| Missing grade/subgrades/catalog image | Unknown remains unknown, name/holder/known grade readable | No zero/10/price/certificate invented; image retry failure also tested |
| Raw copy in the same gallery | Raw card with “Raw · Ungraded”, no holder/provider | No automatic grading or new inventory item |
| Unsupported/mismatched historical label | Neutral known-provider metadata with unsupported appearance notice | No current-version substitution |
| Signout/account/session change | Old detail/gallery disappears | Existing host scope remount and exact-session read fence |

## Phone geometry

All 375×667, 390×844 and 430×932 browser/standalone cases passed. Standalone uses the existing 59px top and 34px bottom safe insets. The collection selector stays 44px tall, detail close control is at least 44px, dialogs fit the safe viewport above `--dock-clearance`, and no horizontal overflow occurs. Existing dock safe-viewport/hit checks passed in the 102 navigation/BinderApp regression cases. Geometry is captured in [synthetic-geometry.json](synthetic-geometry.json); screenshot-induced scroll coordinates are diagnostic, not a claim that an offscreen selector must remain sticky.

The 375px two-column gallery has approximately 164.3px-wide holders, versus no Slabs surface before. The 390px gallery has approximately 171.8px-wide holders, and 430px approximately 191.8px. Detail caps the enlarged holder at 320px. Labels reserve about 18% of the inner case, and complete long/text metadata remains available outside the fixed label preview. The tests verify light/dark layout, minimum targets, focus return, X/Escape/back/backdrop/swipe/dock dismissal, search/back/reload/new-page view restore and unchanged copy IDs.

The real worker test closes the old page, disables the new page's HTTP cache, goes offline and opens the cached app shell with the existing canonical IDB snapshot and saved navigation. It restores the same collection/Slabs view and recorded PSA copy with identical canonical queue records. This is emulated browser/standalone evidence, not browser-process termination, physical iPhone or installed-PWA acceptance. No personal HTML/auth/API response is cached by this lane.

## Handoff gates

Issue #388 stays open. Parent owns independent review, fresh backup, hosted 089 work in the other lane, serialized merge, deployment and enabled production verification. #389 exact artwork/uploads and #390 graded backup/API/share/asset-redaction/revocation/acceptance remain required before #379 admission. Release text is unpublished. No hosted app access/write, schema, conversion, provider import, spending, merge, watch or publication was performed here.
