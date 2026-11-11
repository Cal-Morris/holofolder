# Trusted native developer reads (#376, current after #507)

The five native read operations execute through the authenticated registry/dispatcher and REST/MCP adapters. There is no fixed admission denial or production override. See [the direct server handoff](native-direct-server-handoff.md). This is server admission; app host, onboarding, offline and hosted acceptance are separate proof.

## Trusted boundary and reused core

`inventory-read-core.ts` is an extraction of the existing complete-read query/normalization/fence logic, not another inventory store or read implementation. `inventory-read.ts` remains its cookie/RLS adapter: actual first-party claims/session, getUser match, partnership/billing and grid RPC checks are preserved. It never accepts developer authority, body owner or an admin client. Existing read/navigation tests continue to exercise that contract.

The server-only `developer-access/native-read.ts` constructs authority from an actual verified `OperationContext`. Before owner data it rechecks the current key row's actor, expiry, revocation and permissions, or the verified OAuth identity's session/client/grant through the existing `verify_developer_oauth_session` RPC. OAuth principals now retain only verified session/client/expiry identity, no token or secret. This preserves the current auth-session/client-deletion/grant-version checks; no fabricated cookie/getClaims/getUser adapter is involved. Current actor existence/ban, exact partnership/owner/members, partner billing allowance and paid developer entitlement through the existing bounded `resolve_developer_access` lookup are checked again at final fences. The initial transport authenticator still owns signature/secret/origin verification, read budget and current entitlement. Trusted direct dispatch is not an HTTP context deserializer.

The shared core pages every actual item, placement, collection, binder, slot and immutable-source stream in 500-row keyset pages, with exact counts and shared canonical normalizers/complete-bijection validation. Catalog evidence retains its existing paged core. It repeats independent inventory, collection content, layout, metadata/grid, source and membership fences. Developer settings use a narrow explicit privileged owner projection after current scope, rather than calling the cookie-only grid RPC. All raw planning evidence stays inside the core and is never a developer transport value. Developer reads allow one attempt, 15 seconds and 512 checked requests; the shared core also caps accumulated source-page JSON at 32 MiB. Errors or changes publish no result. The existing cookie path retains its two-attempt conflict behavior and the same finite source budget.

The extraction retains real slot positions and binder default/order/update metadata as internal evidence. Neither is reconstructed from an array index or a fabricated revision. The first-party wire projection is unchanged.

## Declared projection and privacy

`native-developer-read.ts` builds an explicit allowlist and validates it against strict response schemas before returning anything. It does not spread private domain items/slots/binders into output.

- Copies: stable physical `inventoryItemId` (the read DTO field is `id`), item version, recorded card/Pokémon identity, acquired timestamp, primary placement IDs/version or null.
- Collections: stable ID, name, kind, default presentation, private location when recorded, default/order/update metadata, count, collection/layout revisions and known effective grid.
- Slots: stable ID, collection ID, actual position, target/status/current wanted printings, item reference and current item/placement/collection/layout versions.
- Grading allowed under both read permissions: recorded provider, grade, scale, designation, holder, subgrades and label variant. No provider verification or certificate entitlement is inferred.
- Omitted: certificate values/lookup links, private assets/IDs/URLs, immutable source JSON, protected audit deltas and recovery/planning evidence, credential/member secrets, copied preset manifests, want image URLs and member attribution. Public share projection and redaction are untouched and remain separately tested.

Redacted grade/want read models are not lossless replacement-command inputs. Use the existing private-preserving command contract for supported grading/want edits and exact fulfilment. Never expose private fields or send guessed nulls. Basic assignment can still use the returned current references with `fulfillWant: null`; this read slice does not change command semantics.

Both `collection:read` and `binders:read` are mandatory, with current owner/partner access and Premium/lifetime entitlement, identically for REST keys and OAuth grants. Location/recorded grade are deliberately authenticated private-read fields; this is not a public share projection or a certificate/private-asset API.

## Pagination and read semantics

`list_inventory_items`, `get_inventory_item`, `list_storage_collections`, `list_storage_slots` and `get_storage_slot` are registered, dispatched and returned through both actual transports. Strict schemas reject body owner authority, unknown fields and unbounded inputs. List responses have at most 100 rows, default 50. Collection metadata pages allow the 2 MiB creation budget plus 16 KiB of response framing so a single accepted copied manifest remains readable with `limit=1`. Other native reads retain their 1 MiB serialized bound. Large detail/slot wants can return 413 rather than silently truncating. Sources beyond 1000 are paged before any result is accepted. A stable mixed legacy/native owner fails with `legacy_inventory_incomplete`; no native-to-legacy fallback is introduced.

The existing limit validator is reused. Native cursors need stronger cross-request revision/authority binding than legacy catalog cursors, so they use a versioned HMAC with the existing service-role server secret, without persistence or new env configuration. Cursor payload binds the last stable ordering key, a hash of credential/actor/owner/member/permissions/OAuth identity/operation/filter/limit, and a SHA-256 read revision over actual independent evidence plus the declared projection. Copy/collection order is deterministic codepoint ID order; slots use persisted position then ID. Modified/malformed/foreign use is 400, current-state mismatch is 409, and an unknown continuation key is rejected. Reauthentication and every fence still run, so a cursor cannot confer authority.

Every detail/page response has `projection: developer-native-v1`, `completeSnapshot: false`, real `inventoryRevision` and opaque `readRevision`. It never exposes/brands the private `CompleteInventorySnapshot`, even when `nextCursor` is null, and never supplies a queue acceptance or fresh-read ACK. Whole-owner validation internally is a completeness prerequisite for honest copy/location semantics, not permission to pass this page into the planner. No cached snapshot/cursor store is added.

## Proof and remaining gates

`tests/native-developer-read.test.ts` runs the actual dispatcher, REST handler and MCP HTTP SDK transport against synthetic dependencies. Synthetic PostgREST/auth responses intercept all traffic and forbid hosted access. The key authorization RPC is exercised; real OAuth issuer verification is replaced with a synthetic verified principal while the actual current-session/grant RPC remains exercised. Tests cover read-only permissions, revocation/permission loss, owner/partner unlink/change, billing loss, independent read races/errors, >1000 paging, malformed/foreign/stale cursors, strict input/output privacy and transport parity. Shared core tests separately retain complete-brand, finite deadline/request/count/source/catalog coverage and public redaction regressions. These are local adapter/contract proofs, not hosted RLS, SQL atomicity, real issuer or enabled rollout proof.

Matching help, generated OpenAPI and derived HTML/Markdown/LLM exports accompany the operations. The affected six-phone docs matrix verifies their presentation and discovery; it does not claim physical installed-PWA or enabled native workflows. Release copy stays unpublished.

Parent owns issue completion, independent exact-head review, integration and deployed verification. Copied preset discovery/preview is admitted through its own read-only contract. App host/bootstrap/onboarding, sender/replay/fresh-read ACK, offline relaunch, recovery acceptance and hosted timeout/load/conversion/old-client acceptance require their own proof. No marketing publication or hosted write belongs to this contract update.

The cumulative source-byte budget includes catalog direct/alias/canonical, dex-link and set response pages before their metadata is used, even when those rows are absent from the final developer projection. Oversized source pages fail the entire read; no partial DTO page is returned.

## Catalog and species identity

Card IDs are global opaque printing IDs; provider-local IDs are evidence scoped by game and source. Catalog card/set/series projections declare `game:"pokemon"`, the only supported game today. There is no game selector. Copies and card/free targets remain generic, including Trainers and Energy without dex links. `{kind:"pokemon",pokemonId}` continues to mean species, never a printing.

Public species-row CRUD has been retired without aliases. Use the native copy, collection and stable-slot reads above. `get_pokemon_set_slots` at `/pokemon/sets/{id}/slots` groups set printings by National Dex species; its rows are not stable storage slots. Every binder is native, so the legacy-only `get_legacy_pokemon_analytics` and `resolve_import` operations have been removed without aliases. Activity's physical-copy filter is `inventoryItemId`; existing versioned command `itemId` fields remain unchanged.

## Copied initial manifest reads

`list_storage_collections` includes `presetManifest` (nullable), including optional migration-101 `setScope`. The shared strict schema preserves captured set/language/finish/promo/exclusion evidence independently of editable current slots. It adds no private inventory source, certificate or asset fields. Developer pages remain non-planner projections with the existing response byte budget and current credential/owner/partner checks. See [set persistence and prerequisites](set-preset-checklists.md).
