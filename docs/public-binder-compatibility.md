# Existing public binder links and ordered storage (#371)

Implementation boundary, not a rollout or completion record. Issue #371 remains open until the parent verifies its literal runtime/rollout acceptance. No hosted conversion, migration, SQL/grant change, new share mutation, showcase or inventory/slot write enablement is part of this PR.

## Identity and reads

`/app/share/:token` and `/app/u/:username/:binderSlug` both call `loadPublicBinder` with the public identity only. The token must currently be enabled; named permission comes from the existing `resolve_named_binder_share` RPC. Owner/collection IDs are derived on the server, never accepted from a public caller. Historical binderless tokens resolve only the current default binder, without creating one or enumerating other binders. If there is no uniquely resolvable default, access fails closed.

After permission, the loader reads that exact binder's authority. Absent pre-rollout state/schema retains the legacy National Dex adapter; unknown authority or ordinary read errors fail closed. Native `slots` authority reads the actual arranged order and mandatory 1–8 row/column dimensions. It never derives native dimensions or targets from legacy rows, a preset manifest, private source JSON or a remembered viewer preference. Removed targets stay removed. Native Trainers, Energy, repeated species/printings, free occupied slots, empty spacers and unfilled targets retain their positions.

Every slot and placement read is owner-and-collection scoped and paged in batches of 500. Only copy IDs in those placements can be queried, in batches of 100; neither global inventory, Unassigned nor other collections are loaded. Catalog names, artwork and species evidence come from authoritative catalog rows/associations, including exact recorded aliases. Unknown catalog stays unknown. The result is a `PublicBinder`, never branded as a complete owner inventory snapshot. Completion calls the canonical `getBinderCompletion` and `inventoryItemCandidate` matcher over only current slots and their primary copies.

The loader fences actual ordered slots, placements, copy identity/grade/version, binder metadata, collection authority/version/layout, appearance, owner inventory revision and current public permission. It discards conflicts instead of serving a mixed snapshot. Reads have a 15-second abort deadline and request budget. They perform no audit mutations or synthetic history events.

## Public allowlist

Only public binder name/username, geometry, normalized appearance colors/glare/dark mode, current-target counts, and per-pocket public display identity/target/name/canonical raw artwork/occupancy may cross the server/client boundary. Pocket keys are presentation-local indices, not storage/copy/account IDs. Wanted records are not serialized. Private account/member IDs, notes, acquisition dates/costs, pending operations, source/legacy/preset JSON, storage locations and label asset IDs never enter the projection.

Only recorded provider/grade text is supported. Certificate sharing is **off** with no scoped permission. No certificate string, verification link, slab/label photo, security mark or private asset URL is emitted in props, SSR/RSC, metadata or image URLs. Grade/provider text containing its recorded certificate or a URL is omitted. Artwork URLs are constructed from canonical catalog asset coordinates, never from grade/source/legacy URLs. Provider-faithful slabs remain #390.

Price-hidden permissions trigger no price reads and add no price data. An explicit owner opt-in permits only the saved positive market estimate from `card_prices`, never purchase/acquisition cost. Social metadata uses only the authorized public name/username and fixed Holo Folder social artwork. It includes no card, grade, price or private image data.

## Presentation and caches

Both routes use the same public-only view and shared `OrderedSlot` pocket presentation. No session, BinderApp, private dock/navigation, mutation callbacks, queues, private local storage or remembered presentation is initialized. Owner, signed-in visitor and guest receive the same projection. Page colors, dark/light mode and glare remain owner controlled. Larger custom grids scroll inside their region instead of widening the document; pagination never packs gaps or reorders slots.

The existing `connection()` request boundary and request-local React `cache()` remain. No `use cache`, remote snapshot cache, increased TTL or new CDN caching is introduced. `proxy.ts` retains browser `private, no-cache, no-store` plus CDN/Vercel-CDN `no-store` for both public routes, including metadata and RSC requests. `public/sw.js` continues excluding `/share` and `/u` from its navigation shell/cache. An already rendered browser tab is not a live revocation subscription; the next server request rechecks permission, matching existing behavior.

There is no command-driven snapshot cache to invalidate. The parallel backend may continue owning transactional version/revision changes in storage execution. If it adds persistent public payload caching later, it must bind it to current share identity/permission and all relevant revisions and prove revocation at the outer response boundary before enabling it. This PR does not edit storage execution or reserve migrations 085/086.

## Verification and delivery

`tests/public-binder.test.ts` exercises both scoped identities, >1000 pockets/copies, exact matching, removed preset targets, unknown catalog, allowlists, contaminated certificate/URL text, prices and changing permissions/order/copy/metadata. The existing free-sharing subprocess exercises actual route components, shared SSR and metadata alongside the unchanged owner sharing API.

`e2e/public-binder-compat.e2e.ts` drives the actual token/named Next routes using the local-only synthetic PostgREST server in `scripts/verify-public-share-backend.ts`. Run that server on 54471, build/start Next with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54471`, synthetic anon/service-role keys and `HOLOFOLDER_E2E=1` on an owned port, then run the spec with `PUBLIC_SHARE_TEST_BACKEND=1`, `E2E_BASE_URL` and all six phone projects, `--workers=1`. The backend is test-only, never imported by production loaders. No hosted share/user writes or full e2e suite is needed.

## API/docs boundary

This is an internal public-page read adapter under existing free share permissions, not a new supported REST/MCP inventory read or sharing policy. Existing share/identity operations retain their registry schemas, permissions, owner controls and generated OpenAPI. No operation registry or generated OpenAPI change is appropriate. Inventory/slot mutation routes remain unconditionally 503; conversion/exposure stays closed under #379. See the public API coverage inventory and the draft release copy. Parent owns independent review, project status, deployment verification and publication.

### Local implementation evidence

- 77 focused unit/contract/SSR/docs/offline tests passed across 15 files. These include actual route components/metadata and the existing owner sharing API in an isolated synthetic subprocess.
- 24 actual-route Playwright scenarios passed across all six phone projects (375/390/430, browser/standalone with safe-area insets). Both public identities and guest/signed-in visits cover mixed cards, gaps, current-target counts, hidden prices, opt-in prices, revoked links, 3×8 grids, light/dark and 40-character unbroken names plus 500-character recorded provider/grade text. Document overflow remains 0 px; the 8-column pocket grid is 554 px wide inside its scrolling region, with 64 px minimum pockets and 40 px page controls.
- `bun run typecheck`, production build/docs CSS verification and full lint passed. Lint remains at the existing 55 warnings, with zero warnings in changed files. The build retains existing Next partial-prefetch/CSS highlight warnings and the existing eBay prerender diagnostic.
- No full e2e suite, hosted share/user writes, SQL/migration/grant changes, conversion, merge or publication was performed. Production/CDN deployment and literal rollout acceptance remain unverified and parent-owned.

| Before | After | Why |
| --- | --- | --- |
| Public pages booted the private app shell with species-keyed data | Dedicated public allowlist, shared browse-only ordered pockets | No private navigation/session/queue bootstrap or storage IDs in page data |
| Native arrangement had no public read path | Current arranged slots keep gaps and repeats, with actual custom dimensions | Same sequence and current-target matching without inventing an inventory snapshot |
| Wide layouts needed a usable pocket region | Minimum 64 px pockets within internal horizontal scrolling | 0 px document overflow across the six tested phones |
