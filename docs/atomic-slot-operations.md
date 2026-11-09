# Staged atomic slot operations (#362)

This is an internal preparation slice against migration 073. **The legacy app remains authoritative; no real binder is converted.** The new `/app/api/binder-slots` GET/POST/PATCH/DELETE handlers always return **503**, `code: slot_operations_staged`, `Cache-Control: private, no-store`. They do not parse a body, authenticate against client metadata, read private data or call SQL. There is no environment variable or request flag to enable them.

Migration **074** defines SQL-owner-only structural command and page prototypes. EXECUTE is revoked from PUBLIC, anon, authenticated, holo_mcp **and service_role**. An ordinary admin Supabase client cannot invoke them. Tests run as the owner of a private restored database. No hosted application is authorized by this PR. Applying the file does not convert a binder, grant a mutation surface, create inventory or change prices, trial length, partner entitlements, binder allowances or premium grid dimensions.

## Shared boundary and delivery gates

`lib/server/operations/binder-slots.ts` contains the strict transport schema, limits, staging response, internal page adapter and converted-legacy error mapping. `app/api/binder-slots/route.ts` is a thin disabled adapter. SQL implements atomic structural execution; no TypeScript read/modify/write loop commits individual rows. No UI calls the route. Supported REST/MCP registry/OpenAPI remain unchanged because this capability is disabled everywhere, including reads. [API coverage](public-api/coverage.md) records this exclusion.

Before a reviewed follow-up removes either gate:

- #383 prepares inventory CRUD, existing-copy assignment, selected-want fulfillment, copy choice/replacement and atomic cross-storage movement in [the separate gated inventory boundary](atomic-inventory-operations.md). The 074 slot command itself never creates/deletes an owned copy or assigns one. A whole-slot **layout move** retains its target, item/placement, wants and versions; it is distinct from moving a copy between slots.
- #394 must extend the existing recorder and persist trusted actor/source, compact before/after recovery state and operation identity **inside the same SQL transaction**. A recorder failure must abort the mutation. The returned `context` is an integration envelope, **not an audit event**. No competing history table/recorder exists here.
- #396 must provide version-safe recovery, #363 durable offline/reconciliation including original source/occurrence intent, #376 the shared REST/MCP registry, catalog contract parity, schemas, permissions, generated OpenAPI/examples/help and smoke coverage, and #379 conversion/rollout evidence.
- The runtime adapter must authenticate the actor with existing first-party or developer auth, resolve current membership/owner, establish source/client from server auth, enforce existing developer grants/paid access and spending restrictions, then bind those values to SQL. Client actor/owner/source/catalog evidence are never accepted as authoritative. SQL rechecks current partnership and billing. Add a statement deadline at the DB/request boundary; the function's lock timeout is 3 seconds, and its statement-timeout setting is not a substitute for starting a deadline before invocation.
- Reconcile dependent legacy reads, shares, binder deletion, imports, guest first-use, pricing/totals and offline queues. Existing service-role writes to raw tables remain privileged; they must not bypass future commands/recording. No current user or background job is converted by this change.

This hidden foundation has no customer/Framer announcement. Its eventual user-facing block must ship matching API/help and publication evidence with #376/#379.

## Command contract

`parseSlotCommand` rejects unknown properties at every transport level and returns a detached request. Synthetic example:

```json
{
  "collectionId": "03620000-0000-4000-8000-000000000011",
  "operationId": "synthetic-insert-001",
  "inventoryRevision": 0,
  "collectionVersion": 0,
  "layoutRevision": 0,
  "commands": [{ "kind": "create", "ids": ["synthetic-pocket"], "beforeSlotId": null }]
}
```

`slot_command_v1(actor uuid, owner_id uuid, request jsonb, trusted_source jsonb)` consumes this body. `trusted_source` has exactly `source` (app/rest/mcp/import/system/migration) and `clientId` (string/null), bound by a future authenticated adapter. This user command always derives its actor from the separate trusted UUID. Original offline occurrence/source integration remains #363/#394, rather than allowing request metadata to impersonate an actor.

A slot precondition has exactly `id`, `version`, `inventoryItemId`, `itemVersion`, `placementVersion`. Empty slots require all three item fields to be null; occupied slots require the actual item ID and both current versions. All commands compare the owner's inventory revision and collection content/layout revisions. Single-touch batch semantics reject repeated slot IDs, including create-then-edit inside one batch; callers submit final intent or separate revisioned operations. Every selected slot must belong to the one named collection/owner.

| Kind | Fields beyond `kind` | Semantics |
| --- | --- | --- |
| `create` | `ids: string[]`, `beforeSlotId: string or null` | Insert blank free pockets before a stable anchor, null appends. No implicit targets/items/wants, version 0. |
| `update` | `slot: precondition`, optional `target`, optional `wantedCards` | Change constraint and/or explicit wants. At least one field required; omission preserves it. Does not change ownership/status/grading. |
| `clear` | `slots: precondition[]` | Remove occupied placements, preserving slot ID, position, target, wants and inventory items as Unassigned. Already empty is a no-op. |
| `remove` | `slots: precondition[]` | Remove only selected slots and their wants/goals. Placement cascade unassigns copies, never deletes items. |
| `move` | `slots: precondition[]`, `beforeSlotId` | Move whole slots in their saved relative order. Anchor must be outside selection. No-op order keeps revisions. |

A batch is one request/transaction and one operation ID. Structural work increments layout revision once. Any effective edit increments collection version and owner revision once. Changed targets/wants/cleared contents increment that slot's version; reordering does not pretend its contents changed. Safe-integer constraints reject overflow atomically. Newly created IDs cannot collide globally, including other owners' slots. Batch failure, stale preconditions, allowance failure, result overflow or constraint failure roll everything back, including the replay row. No acquisition/push/collector-save notification is invoked for these structural/target/want-only operations.

Results contain `inventoryRevision`, `collectionVersion`, `layoutRevision`, affected surviving `slots` in position order, `removedSlotIds`, `changed`, `acquisition: false` and the server-derived `context` integration envelope. Context includes affected item IDs for unassignment, slot/collection IDs and batch grouping. Untouched contents are never replaced from a client snapshot. No-op results have no revision changes. Structural moves can change positions of other slots; consumers invalidate their full ordered snapshot on a layout revision change.

## Catalog and ownership boundary

Targets use the accepted `SlotTarget` shape. Pokémon IDs must be in the current 1–1025 National Dex. Card targets require persisted `tcg_cards` identity evidence, resolving exact IDs first and then reviewed canonical/alias metadata. Ambiguous alias evidence fails closed. Occupied Pokémon targets verify the actual item's species identity or persisted `tcg_card_dex_ids`; occupied card targets verify reviewed catalog identity and optional recorded language/finish. Missing evidence fails closed. Existing unknown/deleted printings may remain in or be changed to a **free target** without catalog lookup. Clear/remove also need no catalog availability.

The SQL adapter mirrors `catalogCardIds` and the accepted target matcher using persisted evidence; #376/#383 must verify parity with their exposed catalog/printing adapters before enabling. Language/finish are explicit constraints, not a claim that a printing is available in that variant. No provider/network request or inferred card identity is introduced. Actual existing-copy assignment into a free slot uses the already-tested #382 plan and remains #383, including its catalog-independent free-slot exception.

## Bounds, pagination and conflicts

Limits: 100 commands, 256 total explicitly touched/inserted slots per request, 4,096 slots per binder, 256 KiB serialized request, 100 wants on an edited slot, 1 MiB serialized result. The capacity is deliberately above a 1,025-goal Dex; empty goals cost zero. Existing legacy wants are not truncated on reads/clear/remove. If an inherited payload exceeds the result bound, reduce page/batch size; fail without data loss. Creation is checked against current capacity plus all insertions before deletes, so a near-capacity replacement may need a separate removal. Whole-slot layout normalization touches at most 4,096 positions under the existing unique deferred position constraint.

`slot_page_v1(actor, owner, collection, page_size, after_position, expected_inventory, expected_collection, expected_layout)` returns a private keyset page ordered by unique `(position,id)`. Maximum 500 slots, fetches no other collection/owner. First page omits position/revisions; continuation requires **all three** returned revisions and last position. Each call uses one stable statement snapshot. An owner/collection/layout change between pages gives a revision conflict; discard every accumulated page and restart with bounded retries. No silent PostgREST 1,000-row truncation. `nextPosition` is null only at the end. The internal TypeScript adapter validates page bounds/continuation tokens; it is not exposed as an HTTP read.

| SQL error/message | Intended supported adapter status |
| --- | --- |
| `42501`, `slot_access_denied` | 403/404 without unrelated-owner state |
| `55000`, `slot_storage_unavailable` | 503, no legacy write fallback |
| `40001`, revision/slot/item/placement conflict | 409 with relevant current state/revisions; reread before retry |
| `40001`, `idempotency_conflict` | 409, use original intent or a new operation ID |
| `22023`, invalid command/target/catalog/anchor/capacity/result | 400, reduce/correct the request |
| `card_limit_reached` | existing 402 billing contract |
| lock/deadline/serialization failure | bounded whole-operation retry with same operation ID; reread after unknown outcome |

The actual public slot route currently returns only its unconditional 503; this table specifies the internal contract for #376's future adapter. Revision conflicts include current revisions; slot conflicts include the scoped row in SQL detail, while item/placement conflicts require a fresh owner-scoped page. The future adapter must sanitize SQL details, never forward raw DB errors or log private contents.

## Billing, replay and legacy compatibility

`slot_saved_count_v1` counts legacy rows only in unconverted binders with existing `billing_card_weight`, plus every inventory item once (assigned or Unassigned), plus slot explicit wants. Existing `wishlisted` without choices retains its one entry; existing `considering` retains its entry in addition to wants. Empty/spacer/target-only slots cost zero. Frozen converted legacy rows do not double-count. The billing read RPC and legacy growth trigger use this aggregate; with all binders legacy their result is unchanged. No allowance is charged for clear or layout movement; removal can reduce wants but retains owned-copy cost.

Command growth and legacy growth use the same owner advisory lock (4701). SQL reuses `billing_enforced`, `billing_has_paid` and `billing_partner_allowed`, preserving paid/perpetual/168-hour trial policy and over-limit non-growth edits. Existing binder creation and premium dimensions remain their original operations/triggers. #383 must take the same owner lock when adding inventory, and complete direct-write/ownership enforcement before rollout.

Replay uses the existing private `developer_idempotency` ledger with operation `binder_slots_v1`, actor + operation ID key, SQL-derived digest covering owner, full request and trusted source. It checks current access **before** returning a prior result, and checks replay **before** rejecting old revisions. Same key/different intent conflicts. Rows use infinite expiry so existing daily cleanup cannot forget an applied structural operation and repeat it. This deliberately retains bounded affected results; #394/#396 must assess retention/storage and integrate audit references before enabling traffic. It is not an audit feed.

Migration 073 remains the authority guard on legacy Pokémon-keyed writes. Shared `saveCollectionItem`, status and delete now translate `binder_converted_requires_slot_commands` into structured **409**, including REST/MCP calls through their existing dispatcher, without guessing a repeated-species destination. A scoped authority read precedes each legacy write, including no-row deletes/status updates that cannot fire a row trigger. The atomic save wrapper preserves the DB error as a private cause so this mapping survives. Other errors retain existing behavior; missing schema/state alone allows legacy operation; other authority-read failures return 503, and no second writable authority is added. Conversion racing an old write is handled by 073's binder lock/trigger. Legacy readers are still legacy readers, so this error handling alone is **not** rollout readiness.

## Parent-owned application and rollback

Parent reviews exact PR head and 074, refreshes the backup/restore proof if live/schema state changed, then applies only 074 after 073 as its explicit transaction. This worker applied it twice **only** to its private socket-only restored cluster at `issue362-local`, port 55462. It did not connect to or change hosted state, convert real binders, alter archives/pointers or touch `issue361-local`.

Both code and schema deployment orders are compatible: routes stay 503 without schema, all existing legacy code works before/after 074, and the new aggregate is equivalent while no binder is converted. No rows are backfilled. Before exposure, leave unused definitions in place or revert code if needed; do not reset slot authority, delete inventory or restore frozen legacy rows over new edits. Real conversion/recovery is separately reviewed under #379/#394/#396 with a fresh backup.

Local proof commands:

```sh
bun test tests/binder-slot-operations.test.ts
SLOT_COMMAND_TEST_SOCKET=/Users/cal/.local/share/holofolder/issue362-local/socket bun test tests/binder-slot-commands-sql.test.ts
```

The opt-in SQL test refuses any other socket, user/port are fixed, and synthetic fixture changes roll back or clean up only their own IDs. It never creates/stops a server or runs hosted SQL. Full runtime/API/offline, actor recorder and recovery acceptance remain open on #362 and their owning issues.

Prepared-head evidence: 1,213 unit-suite entries pass; nine focused cases pass including the two opt-in SQL cases. Full typecheck, production build and lint pass; lint retains 55 existing warnings and changed-file lint has zero. SQL proof includes direct RLS reads/write denial, free/subscription/trial/perpetual access, post-unlink replay denial and a real unlink lock race, canonical aliases, stale independent predicates, rollback/capacity bounds, 1,025-row keyset paging and two-session mixed-storage allowance races in both directions. The 500-row synthetic EXPLAIN ANALYZE ran inside the fixture transaction in 0.280 ms on this local restore, not production. After fixture cleanup all original 82 table counts and 29 core digests still match the fresh pre-073 archive. No full e2e, hosted apply or production/runtime proof is claimed.


[080 ordinary converted-content recovery](converted-content-recovery.md) permits safe inverses of actual 074/075 commands only while conversion provenance and frozen source remain unchanged. It keeps 076 recording, source guards, current conflicts/permissions/allowances and denied runtime boundaries; converted deletion, mapped source cascades, conversion undo and auxiliary/private-asset recovery remain required separate gates.
