# Copied set and variant checklists

Related: #372, #373. Migration 101 adds durable scope to the existing reviewed creation path. Parent owns hosted application, integration and release; this document describes the submitted implementation, not deployed verification.

## Supported behavior

`generateSetChecklist` copies the full mirrored `cards` array, not Dex-grouped `slots` or capped search results. Each canonical printing becomes one specific-card target in numeric/alphanumeric collector order, with numeric secrets and alphanumeric subsets included. No category or species filter is applied: Trainers, supporters, items, Energy and repeated Pokémon all remain eligible. Canonical aliases collapse once; conflicting duplicate identities fail. Empty lists stay empty and incomplete lists never acquire placeholders.

Choose a supported language. `getMirroredSetDexSlots` now supplies `languageConfirmed`, true only when the catalog contains a nonempty name for that exact language. A requested language or fallback English/image is insufficient. Old cached payloads without this field are unavailable for generation. All included targets constrain the chosen language.

Base checklist means **any finish**, not Normal. Explicit variant scope supports Normal, Holo, Reverse holo and Jumbo, corresponding only to literal `true` flags `normal`, `holo`, `reverse`, `jumbo`. False, absent and unknown flags are unavailable. Rarity, inferred finish, prices and grading never establish availability. First edition and promo stamps have no corresponding supported canonical finish constraint and are not offered. Flags are shared catalog evidence; language/region-specific release distribution and variant-family completeness are not asserted. Coverage warnings and verified counts remain visible per selected finish.

Promos are loaded from an actual chosen set ID via the same full-list API, then selected individually. There is no invented association between a promo and the main set. Exclusions are explicit canonical card IDs, covering all selected finishes of that card. The exact preview lists included names, collector numbers, language and finish and shows the resulting target count. Its pagination is presentation only. Printed base counts cannot prove total catalog/master-set completeness, particularly with secrets/subsets. The UI always qualifies coverage.

The optional `stagedCreation` property of `SetPopulationView` reuses the existing `BinderCreationPresets` / `onDraft` contract for “Create binder from this set”. Production callers omit it. The creation picker also offers Set / variant checklist. Both hand off the same parsed internal draft. Existing Blank/Dex/species/printing choices and ordinary editable/free slots remain intact. No BinderApp/navigation/layout-editor/bulk or storage executor is changed.

## Durable copied scope

Preparing a draft still saves nothing. Confirming **New storage** copies the reviewed evidence into optional `manifest.setScope`. The existing creator, atomic device queue, sender, `collection.create` executor, audit recorder and complete saved reads carry those same bytes. A failed device write retains the original attempt; a lost reply retries the same operation, collection, slots, timestamp and scope. A receipt still requires a separate current complete read before browser acknowledgement. New uncached set loading/creation requires connection. Cached saved scope remains readable without a successful storage read, with edits fenced by existing read authority.

The copied manifest includes set ID/name, capture time, exact language, selected verified finish families, every captured row and its verified evidence, explicit promos, exclusions, official count and coverage warnings. It lives in the existing `storage_collection_state.preset_manifest`, not a new subscription or table. Two creations allocate independent slot/collection IDs. SQL verifies captured cards, identities, language names and literal finish flags against the current mirror, rebuilds initial eligible targets, and rejects stale or fabricated eligibility before any writes. The copied count is checked against the current set record. SQL also rebuilds the disclosure wording and validates canonical promo/exclusion structure. Draft generation uses natural collector order; saved parsing preserves the captured ordered copy while rebuilding its targets and disclosures. Warnings and display ordering are disclosures, never membership enforcement. Existing accepted replay precedes mutable catalog validation.

Once saved, **Saved checklist scope** shows the historical snapshot without catalog fetching, including in cached read-only startup. The manifest describes the initial list; current slots remain editable. Free extras, target edits/removals and appended targets use ordinary commands. Membership is never enforced from the copied manifest, and catalog updates never refill removed targets. Completion uses the current targets and existing canonical matching.

### SQL prerequisites and integration limits

Apply `scripts/101_copied_set_checklist_creation.sql` after the existing 073–099 chain, before enabling these creations. It modifies only creation validation and adds a private denied helper. Migration 100 is independent and belongs to the converted raw restore lane; 101 does not depend on it or redefine a dispatcher. Existing manifests without `setScope` stay unchanged. Before 101, scoped creation fails closed, retains the exact device request and can retry after application. No legacy create-then-edit fallback exists.

Raw restore v2/v3 and arrangement import still have their original SQL manifest allowlists. A scoped manifest is therefore **not a supported restore/import request on 073–099 + 101 alone**. Backup export can retain the field, but this PR does not claim a restore round trip. Parent must coordinate that separate capability explicitly; migration 100 must not silently be treated as supporting this new field. Existing creation recovery captures the entire root manifest; receipts remain conservatively `recoverySupported:false` and recovery preview decides actual eligibility.

## API, security and errors

The UI reuses the existing read-only app catalog endpoint:

- `GET /app/api/tcg-set-slots?query=<name-or-code>` searches sets; `DLR` resolves through the existing alias helper.
- `GET /app/api/tcg-set-slots?setId=<actual-id>&language=<language>` loads the paged full mirrored card list. `cards` is used; `slots` is not a checklist denominator. No provider scraping, sync, image proxy fetch or backfill occurs here.
- Missing selected set/full list produces an unavailable message; non-OK responses disclose read failure and disable draft preparation. Unknown language/variant evidence produces zero or partial eligible targets with exact coverage disclosure. Empty output cannot prepare a set draft. Stale async responses cannot replace a newer language/catalog choice.

REST `POST /app/api/v1/storage/collections` and MCP `create_storage_collection` accept `manifest.setScope` with the same canonical validation and immutable command limits (2 MiB, 4096 initial slots). Existing current actor/owner/partner, entitlement, revision, idempotency and audit checks remain authoritative. REST `GET /app/api/v1/storage/collections` / MCP `list_storage_collections` now include `presetManifest`, including saved `setScope`, for reopening. Their pages are authenticated projections, not browser planner or acknowledgement authority. Slot operations still expose current targets separately.

Server-side `preview_storage_preset` set/master-set **generation** remains unsupported. It has a separate finite catalog read budget and no full-set generator. This persistence slice reuses the app's full-list reviewed generator; it does not add another preset gallery or unbounded server catalog crawl. Existing `list_sets`/`get_set` and paged `list_cards`/`get_card` remain catalog reads. Clients submitting a reviewed scope must preserve its captured data and canonical manifest, never infer availability from a language-labelled response. Creation independently checks the mirror. Generated OpenAPI documents the actual new create/read fields.

## Verification and release boundary

Automated card data is explicitly synthetic. The PR records focused unit, isolated PostgreSQL, adapter and six-phone evidence. No hosted writes, installed-device proof, production enablement, merge or publication is claimed. #372/#373 remain open for parent acceptance. [Unpublished release copy](releases/set-preset-checklists-draft.md).

Craft review:

| Before | After | Why |
| --- | --- | --- |
| Dex grouping loses repeated printings and non-Pokémon | Ordered full-card targets with individual language/finish labels | Preview the actual goal |
| Rarity could suggest a finish | Explicit verified counts, disabled unsupported finishes | No invented availability |
| Long set/card names | Wrapping labels, shrinking input rows and bounded exclusions list | Keep the 375 px layout usable |
| Catalog scope could drift | Frozen envelope and separate current-target progress | Preserve user edits |

No new animation or overlay primitive is introduced. Controls use immediate state feedback and the existing shared switcher. All UI evidence is emulated; physical-device keyboard and gesture behavior remains unproved.

Rejected scope changes, including conflicting catalog aliases, show a validation error and keep both the picker selection and previously published checklist unchanged. A promo is displayed as selected only after the derived scope validates.

## Submitted local proof for persistence

On requested base `caa7fc5258663c1a17d3a940db1058282526e97c`, pinned Bun 1.3.14 passes 89 focused unit/contract cases across 16 files, full typecheck, production build/docs CSS, and lint at the unchanged 51-warning baseline. Changed-file lint has zero warnings. Ninety distinct affected phone cases pass across all six browser/standalone profiles: 78 existing set/creation regressions plus 12 new scope durability cases. The final parser change was rechecked against those 12 new cases without retries. The browser proof uses synthetic Auth/RPC transport with the real host, queue, sender, IDB and read pipeline. It covers any-finish and verified-variant scopes, promo/exclusion retention, exact lost-reply replay, reload and cached read-only startup. It is not a real service-worker offline reload or physical-device proof.

Two opt-in PostgreSQL 17 tests pass on this worker's isolated Unix socket/port 55601, using the supplied private restore without logging its contents and synthetic task-owned fixtures. They verify repeatable 101 application, denied helper grants, unchanged gateway, rejection of fabricated scope/disclosures, old bare manifests, recorder-failure atomicity, owner/partner creation, exact replay after changed catalog evidence, independent copied lists, free-slot append and target editing, and a committed save reopened on a separate connection. The committed test runs in a disposable clone removed afterwards. Only 101 was applied by this lane; 073–099 were already in the supplied dump. The local restore could not recreate the catalog name trigram index because `extensions.gin_trgm_ops` was unavailable; no catalog-search/index-performance or full Supabase platform proof is claimed. No parent verifier or hosted database was mutated.
