# Atomic named storage creation, internal only (083)

Related: #384, #368, #367. Requires #423 / 082. No hosted application or customer availability is claimed. Runtime enablement is blocked by **both #396 native creation recovery and #379 exposure/compatibility acceptance**. Slab creation/gallery UI additionally waits for #390. The internal SQL transaction is executable only through the reviewed service-only gateway; no public route, REST registry, MCP tool or OpenAPI operation is added.

## Delivered boundary

`parseCollectionCreation` in `lib/domain/storage-creation.ts` defines version 1 intent. `projectCollectionCreation` reuses `instantiatePreset` for a detached, ordered, owner-scoped optimistic projection; it is not durable acceptance or a queue ACK. Authentication, current recipient and catalog/entitlement admission remain authoritative on the server.

The existing `executeAppStorageRequest`, `executeRestStorageRequest`, `executeMcpStorageRequest` and shared developer adapter accept internal operation `collection.create`. They preserve the 082 authentication, both `collection:write` and `binders:write` scopes, app owner-mismatch detection, paid developer access, trusted actor/credential/source/op/batch context, finite body/deadline limits, sanitized errors and receipt projection. Owner, actor and attribution fields are forbidden in the command. A draft's owner is never authority.

083 adds bounded private location metadata and omits null location in the existing audit state projection, preserving historical root snapshots byte for byte. Non-null location remains part of the same audit. Capture, flush, recovery/locking/frozen-source functions and their ACLs stay unchanged. 083 adds a denied private executor and extends only `public.storage_execute_v1(text,uuid,jsonb)` dispatch. The gateway still locks/rechecks current membership before owner locks, even for the owner's own account, and retains developer billing checks. The creation executor upgrades that row to a share lock and rechecks the resolved owner before advisory locks, preventing non-key membership changes as well as unlink. Creation takes legacy collection management lock 6102 before owner allowance/inventory lock 4701, matching legacy create's order. It checks the owner revision under lock, locks existing owner binders, and inserts the binder, native collection state, ordered slots, owner revision, existing ledger receipt and existing transactional audit in one transaction. No legacy create-then-slot-update path exists. No conversion, inventory, placement, grade, explicit want, appearance or legacy species row is created.

Existing 052/057 triggers enforce the shared storage-count allowance, hard 20-collection ceiling and custom-grid entitlements. Targets and spacers cost **zero saved entries**, including at an already full saved-card allowance. Owned copies and explicit wants remain separately accounted by existing commands. All collection kinds share the resolved owner's whole collection with a currently linked, entitled partner. Public sharing remains separately opt-in.

## Exact command

All fields below are required, no extra fields are accepted:

```json
{
  "version": 1,
  "operationId": "synthetic-create-example-1",
  "inventoryRevision": 0,
  "collectionId": "00830000-0000-4000-8000-000000000011",
  "name": "Show binder",
  "kind": "binder",
  "defaultPresentation": "binder",
  "location": null,
  "grid": null,
  "manifest": {
    "source": { "id": "selected-species", "version": "1" },
    "name": "Selected species",
    "entries": [
      { "id": "pokemon-925", "target": { "kind": "pokemon", "pokemonId": 925 } },
      { "id": "pokemon-924", "target": { "kind": "pokemon", "pokemonId": 924 } },
      { "id": "pokemon-143", "target": { "kind": "pokemon", "pokemonId": 143 } },
      { "id": "spacer-1", "target": null }
    ]
  },
  "slotIds": ["synthetic/slot-1", "synthetic/slot-2", "synthetic/slot-3", "synthetic/spacer-1"]
}
```

The IDs in this example are synthetic. Species IDs refer to the app's current 1–1,025 catalog range. No fictional card printing is used in documentation. A selected printing target is `{ kind: "card", cardId, language?, finish? }`, using actual stored catalog evidence. SQL reuses the canonical catalog resolver, requires a stored set/collector number, validates requested language against nonempty localized name or image-language evidence, and accepts a finish only with an explicit true variant flag (`reverse_holo` maps to catalog `reverse`). Unknown or ambiguous printings and unsupported variant evidence fail the **whole** creation. It never guesses a card from a name or infers a finish from rarity. Alias/canonical target strings are copied exactly, not silently rewritten.

Names must already equal `normalizeBinderName` and be 1–40 characters; adapters normalize before retaining intent. `kind` and explicit default presentation pairs are exactly `binder`/`binder`, `slab`/`slabs`, `custom`/`list`. Presentation is an initial default, not a physical compatibility claim or permanent collection rule. Optional location is null except for custom storage, where nonempty trimmed text is bounded at 200 characters and remains private under owner/partner RLS. A grid is null (inherit current account layout) or `{ rows, cols }`, each integer 1–8, subject to the existing Premium rule. Grid choice is independent of target count, without persisted visual padding.

A manifest has canonical `source: { id, version }`, nonblank name up to 200 characters and ordered entries with unique opaque IDs. Each entry has exactly `id` and `target`, including explicit null for a spacer. `slotIds` has the same length/order, with unique IDs, each 1–200 characters. Each stored slot copies its target and `{ source, entryId }` provenance and starts with null status, no inventory item, empty wants and version 0. The manifest is a detached JSON snapshot, never a subscription to future preset/catalog changes. Later editing affects only that collection's slots; the original copied provenance is not its goal denominator. Blank is an empty manifest and empty ID array, no implicit slots.

`collectionId` is a caller-retained UUID, `operationId` is 8–100 characters, and `inventoryRevision` is the expected safe nonnegative owner revision (0 when no owner root exists). Creation initializes only that owner's missing root and advances it once. New collection/layout/slot versions are 0. It appends after the current maximum binder order and is default only when the owner has no binders. Other binders, including legacy ones without collection-state rows, are untouched. No current default is demoted and no legacy data is rewritten.

## Atomicity, finite limits and retries

One command admits at most **4,096 slots**, with a **2 MiB UTF-8 JSON body**. It is a separate bounded creation transaction, not the 100-command/256-affected slot-edit protocol or a best-effort chain of chunks. An entire 1,025-target Dex is supported atomically. Entry/slot IDs and copied manifest names/source are individually bounded; the body ceiling may reject a 4,096-entry manifest with very long identities. Receipt limit is 1 MiB; existing immutable audit admission remains 16,384 deltas / 16 MiB. Nothing is truncated. Catalog alias resolution uses the existing resolver, and unusually expensive evidence must still fit the server's 10-second transport deadline and database execution budget. Timeout/lost response means unknown outcome: retain exact intent and replay, then reconcile.

The existing `developer_idempotency` ledger stores `collection_create_v1` forever (`expires_at=infinity`), bound to authenticated actor, owner, body and trusted attribution, including credential/source/op/batch. Exact retries return the original ordered IDs and receipt before checking current revision or reconsulting mutable catalog evidence. Changed-body, changed-credential/source and changed-actor reuse conflict. A different operation cannot upsert existing collection/slot identities, including identities belonging to another owner. The existing immutable owner/operation audit uniqueness also prevents another actor from reusing an accepted owner-scoped creation operation. Replays still require current membership/entitlements. Deleted/recovered entities are not silently recreated by a replay; the receipt is historical acceptance, requiring fresh read reconciliation.

```json
{
  "inventoryRevision": 1,
  "collectionId": "00830000-0000-4000-8000-000000000011",
  "collectionVersion": 0,
  "layoutRevision": 0,
  "changed": true,
  "slotIds": ["synthetic/slot-1", "synthetic/slot-2", "synthetic/slot-3", "synthetic/spacer-1"],
  "recoverySupported": false
}
```

This receipt includes no catalog evidence, private audit material, copied manifest, certificate or arbitrary context. Shared error mapping returns invalid input/constraints 400, membership 403, revision/identity/idempotency or hard ceiling conflicts 409, plan/grid/developer entitlement 402, and missing SQL/recorder/transport/unknown failures 503. Neither SQL details nor private evidence are returned. Recorder failure, constraints and outer statement cancellation roll back binder/state/slots/root/ledger/audit together.

## Recovery gate, observed on real creation events

The unchanged 077–081 planner returns `supported: false` with `collection_creation_inverse` for actual native creation events. First/default creation additionally includes `owner_authority_transition` when it inserts the owner root. The apply path cannot remove binder/state roots (`recovery_unsupported_creation`), so there is **no safe creation undo yet**, even though ordinary target edits and native deletion have separate recovery support. Default identity, later content, retained IDs, dependent shares/config and large layouts need a reviewed creation-specific inverse; destructive cleanup is not a substitute.

083 does not weaken that planner or add a recorder/reset/force bypass. The receipt deliberately says `recoverySupported: false`. Keep all creation app/REST/MCP exposure blocked until #396 proves an inverse over actual generated first/default and nondefault events, later-edit conflicts and maximum bounds. #379's existing unconditional staging routes and absent registry entries remain the hard runtime gate. No environment or request flag enables them. Parent's hosted migration review/application is distinct from enabling product writes.

## Concrete draft, queue and API adapters still required

The #422 `BinderCreationDraft` is immutable UI intent, **not** this command. Before #379, its owning adapter must:

1. Authenticate and compare the draft's recipient with current membership as a mismatch check. Never forward `draft.ownerUserId` into the body or use it as authentication.
2. Normalize the name, copy the existing detached manifest, choose storage kind/default and optional custom location/grid, and obtain a fresh complete owner revision. Do not run legacy `ensureDefaultBinder` as a creation prerequisite.
3. Generate collection UUID and exactly one stable ID per manifest entry **once**, then parse and retain the complete canonical command with the original operation ID across retries. Never regenerate IDs on delivery.
4. Use the existing trusted server operation and canonical original-recipient durable queue rules. Receipt alone is not a fresh-read ACK; #363 must reconcile full state before acknowledging. Uncached/new server-owned creation requires connection; offline preview is not a save.
5. Complete bootstrap/read/render/export compatibility for native first/default collections alongside legacy binders, manage/delete routes that retain owned items, exact slot continuation reads and current-target progress. Other lanes own these consumers; this PR changes none.

Future supported REST/MCP schemas should reuse `CollectionCreationCommand` and the exact receipt above, not expose the SQL RPC or accept context/owner fields. A proposed operation is `storage.collections.create` with `collection:write` + `binders:write`, owner resolved server-side, and the same strict body for MCP arguments and JSON POST. Proposed raw REST path: `POST /app/api/v1/storage/collections`; it is **not registered or working**. MCP name must be generated through #376's registry convention when enabled. Example transport use after enablement: send the exact JSON command above with the actual REST API key or OAuth MCP context and retain its operation/IDs; app sessions and the two developer credentials remain distinct. Generate OpenAPI/help/agent exports and smoke every transport only when the gated operation is supported. No endpoint/example is added to the live public reference now.

## Local evidence and parent handoff

Actual SQL proof uses a new private socket-only cluster on port **55584**, user `creation_test`, directory `/Users/cal/.local/share/holofolder/issue384-creation-local`. Never reuse the old deletion cluster on 55583. Restore archive SHA256 `c95b2126c4127c06f76e8852655804c3b4dbe82dcf94d063945f80bccf216af8`; exact prerequisite 081 SHA256 `e98362e49a9862107a6e5dad1dd616a15b614f4bcb49422387edc6a9f996db13`, 082 SHA256 `e3812e75eb5abeae178d673c44613c3bdc5e7c8eb55aa32d968e7dc2eba52ff6`. Archive remains unchanged. ACLs are restored, ownership is local. Private archive/count/digest/role evidence is never committed.

`STORAGE_CREATION_TEST_SOCKET=<exact socket> bun test tests/storage-creation-sql.test.ts` applies 083 twice and runs rolled-back synthetic archive-database fixtures. It checks all existing ACLs/RLS and all existing function bodies except the two intentional gateway/state-projection extensions, and generates a real event using 076’s old projection to prove that its inverse still previews/applies under 083. An optional `STORAGE_CREATION_RACE_DATABASE=holofolder_fresh_creation` runs real two-session races **only** in a disposable fresh-schema synthetic database, which the operator drops afterwards. It proves accepted partner writes block unlink through transaction end, unlink-first writes recheck before owner locks, and overlapping exact deliveries create one result/event/ledger. Full numbered fresh-schema replay uses the existing verifier and the same explicitly allowlisted socket. Neither synthetic role proof nor local timings prove hosted PostgREST cancellation, live browser behavior or end-to-end latency.

Parent owns fresh restore-verified hosted backup, independent SQL review and application of 083 after 081/082, ACL/data verification and release ordering. This worker does not apply hosted SQL, modify 082, merge, watch, convert, publish or run full e2e. #384/#368 remain open for their other literal acceptance and integration gates. [Unpublished release copy](releases/atomic-storage-creation-draft.md) is preparation only.

Submitted local evidence: 1,355 unit-suite entries pass, full typecheck/lint/production build pass, full lint retains 55 existing warnings and focused lint has none. The separate two-test actual SQL proof and complete numbered fresh-schema replay pass. SQL includes first/default and first-native-with-legacy-default creation, 1,025 targets and a 4,096-slot manifest larger than 1 MiB with long provenance/identities, paid/free caps/grids, real creation recovery rejection, historical-event recovery, mid-insert cancellation, recorder failure, role/attribution denial and real membership/replay races. All 90 source table counts and 35 core digests match after twice-applied 083 and rolled-back archive fixtures. The synthetic race database is disposable; no archive-data fixture is committed. These results are local proof, not hosted application or frontend completion.
