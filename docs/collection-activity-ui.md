# Collection Activity UI (#395)

Current delivery: [Activity and card/want-list Undo](../content/docs/collection-history.mdx) replaces the original presentation below. Migration 087 enables checked legacy-row recovery through app, REST and MCP; native/structural recovery remains gated under #396/#379. The remaining notes record the initial read-only release and its evidence.

Related: #395, foundation #394 / #407, recovery #396. This PR is read-only and UI-only apart from an internal session adapter and additive filters on the existing audit read operation. No schema changes, hosted writes, conversion, structural executor grants, recovery command or new export/registry/feed.

## Internal first-party adapter

`GET /app/api/collection-activity` authenticates with `getSessionUser` (verified first-party claims, rejects OAuth clients in cookies), resolves current membership with `resolveCollectionMembership`, and calls `readCollectionAudit` with the session's RLS client rather than the default service client. The authenticated owner is server-resolved; input cannot select another owner/actor identity. `actorId` is only a read filter. The same safe column projection, bigint string IDs, 1–100 limit, filter-bound keysets, retained-ID filters and 503 `audit_unavailable` behavior are reused. Standard owner access follows RLS; partner billing uses `billing_partner_allowed`. Developer REST keys/MCP OAuth grants and paid developer entitlement remain unchanged.

Query fields are the existing registry list schema plus additive `pokemonId` and `cardId`; `id` selects the existing detail read. Invalid/unknown input returns 400, missing first-party session 401, absent detail 404, unavailable audit schema/read 503. Every response, including errors and the private `?scope=1` identity handshake, is `private, no-store` with `Vary: Cookie`. The adapter has no developer credential handling or mutation path. It is intentionally app-only because it uses cookie identity rather than developer credentials; supported data reads remain registered REST/MCP operations.

`pokemonId` searches legacy root Pokémon identity and retained legacy touched rows. `cardId` searches legacy root/touched printing fields and retained inventory identity/slot targets, including deleted states. PostgREST JSON operands are quoted, and neither filter is implemented by filtering a fetched page. No database function/index/migration was added. Entity IDs absent from old events remain unknowable. Current destinations are limited to known live collection records and exact current legacy row IDs; unsupported inventory destinations have no fabricated route.

## Presentation and privacy

Two entry buttons share a small context provider around BinderApp. Existing binder management and legacy card detail use it; no dock destination, renderer408 dependency or structural UI is added. The sheet is lazy-loaded, uses shared overlay/back/swipe/focus primitives, and sits above dock clearance. Filters and progressive detail remain inside one scrollable sheet. Events are immutable; account IDs preserve attribution without inventing actor profiles or rewriting names after account updates. Current verified members display as You or Collection partner; retained account IDs remain available in details without pretending to be historical profile names. Routine filters use people/action choices, with exact recorded identifiers in Advanced filters. Unknown/System stay distinct. No undo/recovery relationship exists in the current safe contract, so the UI creates none.

The display/cache model allowlists fields from safe audit evidence and discards private certificates, label assets, uploaded artwork references and all unrecognized fields. It does not select protected `recovery_state`/`command_evidence`, inspect private grading labels or add any public-share output. Bulk changes initially render ten touched entities, then 25 more per request; history itself stays keyset-paged. Locally pending legacy edits are a separate current-collection count and are never inserted into the committed feed.

## Device cache

Two versioned localStorage keys contain the active verified account/owner/membership scope and at most eight exact query pages with their server sync points. Membership keys include the current partnership and sorted member IDs. A page is readable/writable only while that exact scope is active. Online opening verifies current access before exposing cached history; focus/visibility and a 30-second visible refresh recheck membership. Offline uses only the last verified matching scope and explicitly says membership is last verified online. A remotely revoked membership cannot be learned while offline.

Logout/account/owner changes clear the scope/cache, a cross-tab scope storage event hides the sheet, and effect cancellation aborts old reads before writing or displaying another scope. Cache writes compare the active scope again, so stale responses cannot repopulate another owner's cache. Uncached and cached-empty pages have separate messages. There is no private HTML or service-worker change. Lazy chunks are reachable from the binder/offline shell import graph under the existing warm-up contract.

## Parent delivery handoff

The parent owns independent review, serialized merge/deploy, live verification and Framer publication. Keep #395 open until acceptance/delivery gates are checked; #394/#396 and structural rollout remain open. After deploy verify `/app/docs/collection-history`, `/app/openapi.json` and the Markdown/agent exports reflect the additive filters and the read-only app UI. Inspect first-party owner/linked-partner and revoked membership reads with permitted fixtures, without real collection mutations. Do not claim hosted behavior based on local tests.

### Release draft, unpublished

Title: See what changed in your collection

“Activity brings your recorded collection changes together. Open it from your binders or a card's details, filter across collections and inspect before/after changes, including entries for removed cards and collections. Each entry shows the recorded actor account, source and server time; older changes with no recorded actor stay Unknown. Recently opened pages are available offline with a last-sync marker. Activity is read-only; recovery is not available.”

Publish only after the app is enabled and production verified. This does not announce structural inventory commands, conversion or recovery.

Parent publisher surfaces: existing Framer release/blog CMS and changelog entry under the established #393 publishing workflow; evergreen features/help surfaces that describe collection collaboration and offline support. Reuse existing entries/components and link to `https://holofolder.com/app/docs/collection-history`, API discovery at `https://holofolder.com/app/docs` and `https://holofolder.com/app/openapi.json`, and the app `https://holofolder.com/app`. The parent must attach the actual Framer CMS item/page URLs and publication version after inspecting the current project; this worker does not guess slugs or publish.

Read-only Framer inventory verified during implementation (no changed nodes): Blog collection `ZAjSbj4xJ` uses the existing `/blog/:ZAjSbj4xJ` detail route, and Changelog page `wEzlu31Lo` is `https://holofolder.com/changelog`. Affected evergreen targets are [collection tracking](https://holofolder.com/features/pokemon-card-collection-tracker) (`jXbVpFkZz`), [Partner Mode](https://holofolder.com/features/partner-mode) (`tIHcDZuhR`) and [offline collecting](https://holofolder.com/features/offline-pokemon-card-tracker) (`yegWLS1BP`); secondary feature/audience summaries are [features](https://holofolder.com/features), [collectors](https://holofolder.com/for/collectors) and [families](https://holofolder.com/for/families). The parent should scope its publication to actual copy affected by this enabled UI. No new blog slug or CMS item has been created by this worker.

## Implementation verification

Focused unit/query/provenance/cache/adapter/generated-doc suites: 17 tests pass across eight files. `bun run typecheck` passes. `bun run lint` passes at the unchanged 55-warning baseline, with no new warnings. The focused production-build mobile command is `E2E_PORT=3395 bun run test:e2e:matrix e2e/collection-activity.e2e.ts --workers=2`: 24 tests pass across all six phone projects. No full e2e suite, hosted test writes, SQL application, conversion or deployment was performed.

The synthetic matrix covers 1,105 events paged through the end, 1,027 touched bulk entities with progressive rendering, duplicate printings, long retained names, Unknown provenance, actor/date/action/card filters submitted by keyboard, deleted evidence, cached/uncached offline states, public-share exclusion, late-response membership isolation, logout cache clearing, X/Escape/back/backdrop/swipe/dock dismissal and restored opener focus. Both light/dark layouts have no horizontal overflow. Standard owner/partner/disallowed-partner auth, OAuth-cookie rejection, foreign-owner input rejection and missing-076 503 are mocked adapter proofs, not a hosted PostgREST/RLS or growth benchmark. The shared reader's request tests traverse 1,105 entries and verify safe columns, retained filters, quoted JSON operands, combined filter groups and cursor binding. The new live filter queries and first-party access remain parent production-verification gates. Offline checks exercise loaded production chunks and device pages; a fresh service-worker installation/cold offline launch is not claimed here.

Measured sheet geometry in CSS px:

| Project            | Sheet top | Sheet bottom | Dock top | Close target |
| ------------------ | --------: | -----------: | -------: | -----------: |
| browser 375×667    |        16 |          605 |      605 |        40×40 |
| standalone 375×667 |        81 |          579 |      579 |        40×40 |
| browser 390×844    |        16 |          782 |      782 |        40×40 |
| standalone 390×844 |        81 |          756 |      756 |        40×40 |
| browser 430×932    |        16 |          870 |      870 |        40×40 |
| standalone 430×932 |        81 |          844 |      844 |        40×40 |

UI craft review:

| Before                                      | After                                                                             | Why                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| No shared committed-history entry           | Activity in binder management and card detail                                     | Discoverable without another dock destination               |
| No history sheet geometry                   | Fixed header and scroll body end exactly at dock top in all six measured projects | Close remains visible above safe areas and dock             |
| Bulk details could render every touched row | Ten initial entities, 25 more per action                                          | Keeps large changes inspectable without flooding the screen |
| No separate committed-history offline state | Exact cached page, last sync and explicit uncached message                        | Avoids presenting one page as complete history              |

No decorative or keyboard-triggered animation was added. Swipe uses the existing shared drag primitive. Synthetic screenshots are `/tmp/holofolder395-activity-<project>.png`; no private production data was captured. Parent independent code review remains outstanding.
