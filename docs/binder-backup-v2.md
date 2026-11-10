# Binder JSON v2 and import preview, internal preparation

Related: #365. The original serialization/preview slice was based on main `13361bb4354872c8c602974bbf5f4cecb79a2764`. The later [088 atomic arrangement backend](atomic-arrangement-import.md) now supplies bounded real execution, an internal app consumer and a staged REST/MCP contract. Production routes remain denied, no conversion is performed, and legacy Settings backup and Dex CSV/v1 import stay supported. #365 remains open. Historical execution limitations below are narrowed only by the current 088 section.

## Portable format

`createBinderBackupV2` takes a complete authoritative owner-scoped `InventorySnapshot`, an explicit scope and optional per-collection appearance/settings. A partial cached snapshot is rejected even for collection-only export. Completeness is evidence the trusted read adapter must establish by finishing every inventory/slot page; it is not something a file or UI checkbox can attest.

`format` is `holofolder-binder-backup`, `version` is `2`. `exportedAt` is an ISO timestamp. `scope` is `collection` or `all-inventory`. The root contains `inventoryRevision`, `collections`, `binders`, `items`, `placements` and `appearance` arrays. Collection-only includes exactly one collection and its actually referenced physical copies. All-inventory includes all collections and every item, including Unassigned copies without placements. Empty all-inventory is valid.

Collection and item payloads reuse the canonical #382 fields except `ownerUserId`. Binder payloads reuse #360 snapshots except owner fields. Slot array order is physical order; an explicit free empty slot is a spacer. Slots retain targets, status, explicit wanted choices, stable item references, versions and preset provenance. The preset manifest is a detached copy, not a catalog subscription. Item identity, acquired date, raw/graded distinction and recorded grade/provider/scale/designation/subgrades/certificate/holder/label variant round-trip without inference. Two matching printings or certificates never merge physical IDs. Stable IDs are references, not authorization.

Wanted-person account IDs are replaced with `wantedRoles: ["owner", "partner"]` on portable wanted cards. Export requires trusted partner membership when present. Hydration resolves those roles from current trusted membership; a missing partner requires explicit resolution. No owner/account IDs, auth/session, queue, share tokens or credentials are exported. Certificates remain private collection data, so the user must treat the downloaded JSON as private. Internal preview evidence must never be included in downloads or public logs.

Appearance entries contain `collectionId`, canonical settings and design. Normalization that would drop or repair unsupported appearance fields is rejected. This slice rejects every non-null design artwork reference and every grading label asset reference, rather than claiming to package them. #390 owns exact verified asset packaging. Wanted-card image hints allow only HTTPS URLs without credentials/query/fragment/port on `assets.tcgdex.net` or `assets.holofolder.com`; they are never fetched here and their bytes are not backed up. JSON v2 preserves supported arrangement data, not lossless artwork.

Parsing is bounded to 10 MiB, 5,000 physical items, 32 collections, 4,096 explicit slots per collection, 4,096 manifest entries and 100 wanted entries per slot. Canonical normalization validates identities, languages/finishes, grading, versions, manifest references and the slot/placement/item bijection. Unknown/future versions, duplicate IDs, invalid/dangling/multiply assigned references, unsupported fields, oversized files and unverified private asset references fail before a write can be prepared. V1 remains on `parseImportFile`; the legacy production importer deliberately rejects v2 rather than flattening it into Dex rows. The existing download helper accepts a validated v2 snapshot, but no production button supplies one yet.

## Immutable preview and execution boundary

`previewBinderBackupImport` receives complete trusted current owner state, authoritative remaining allowance and authoritative catalog resolution. It never accepts backup owner fields as auth. Its result is detached and recursively frozen. Generated IDs are captured once; persist/replay that exact preview/operation request, never regenerate IDs during a retry. `assertBackupPreviewCurrent` compares the entire normalized trusted snapshot, including inventory/item/placement/slot/collection/layout versions and metadata. Partner changes invalidate the plan even if a buggy producer neglected to increment a revision. This is read-only evidence, not a replacement for server-side transactional version checks, membership and billing enforcement.

Three modes keep ownership decisions explicit:

- **Restore current owner:** requires independently verified original snapshot provenance supplied by the trusted boundary. A portable file alone cannot prove that its stable IDs belong to this owner. Unchanged supported inventory state previews as a no-op; changed state or appearance restoration blocks. Current commands cannot admit the entire item/placement/slot/preset/appearance/settings reconciliation and version-safe inverse atomically. No restore command or manual per-slot split is produced.
- **Arrangement into another collection:** selects an existing trusted destination. New slot IDs are generated; source collection IDs never authorize a destination. Without explicit copy decisions, targets/layout are copied with empty ownership. Explicit `use-existing` identifies one actual current-owner item and previews its move; one copy cannot be chosen twice. Explicit `add-copy` generates another physical identity. Printing/grade equality only checks compatibility. Missing catalog/target evidence is unresolved. The full arrangement remains blocked because current commands cannot compose the complete intent atomically.
- **Additional physical copies:** each imported item needs explicit `add-copy`. It becomes a distinct Unassigned item with a new ID; source placements/layout/wants are not restored by this mode. A bounded, resolved, within-allowance batch yields one `parseInventoryCommand`-validated `add` request with the captured operation ID and current inventory revision. Over-bound batches block as a whole, never split. The preview does not submit even this supported request. The canonical server boundary must authenticate owner/partner, recheck versions/catalog/allowance, enforce idempotency and record audit/recovery in one transaction when integration is enabled.

The internal `proposed` property is an imported fragment, not a new complete owner inventory or an ACK. It must not replace caches. No local save, Undo, acquisition event or durable queue is fabricated. Interrupted parsing/preview has no writes. Replay safety of an eventual submission remains the canonical transaction's responsibility; these pure tests do not claim hosted execution proof.

## Card-list CSV

`buildInventoryCsv` emits one row per physical item and explicit want, including non-Dex Trainer/Energy cards and repeated identical printings. It uses existing spreadsheet formula protection. CSV does not carry owner IDs, certificates or a transferable grading record. Graded rows explicitly direct users to JSON v2.

`previewInventoryCsv` reuses the existing bounded CSV parser and lookup validator. Quantity N expands to N distinct frozen IDs, within 5,000 total rows/copies and the authoritative saved-entry allowance. Exact canonical identity/language/finish evidence is required. Missing or ambiguous matches and per-copy grading/condition need resolution. Compatible target IDs are shown, never selected arbitrarily; assigning copies or appending slots requires an explicit later plan. Its result is always non-executable, so unresolved CSV cannot accidentally use the legacy species-deduplicating path. The existing production Dex importer is unchanged.

CSV loses order, targets, spacers, placements, copied presets, appearance and grading metadata. JSON v2 is the arrangement format. Targets/layout alone add zero saved work; explicit owned copies and wants enter the allowance preview. The server remains authoritative for final counts.

## API/help and release gates

No supported REST/MCP operation or OpenAPI schema changed. `resolve_import` and legacy collection operations keep their current contracts. Internal pure modules cannot safely claim a public restore API while the atomic executor is missing. #376 owns reviewed API/registry/permission/schema/help integration together with the executor; #379 owns runtime enablement. Public help continues to describe the working v1/Dex feature, with an explicit v2 restriction.

Remaining delivery gates: whole-intent atomic restore/arrangement execution and safe same-owner inverse; trusted complete paginated snapshot/provenance adapter; canonical audit/recovery and partner-version conflict proof; #363 durable offline replay integration; #376 REST/MCP parity; #390 verified private artwork/label asset packaging; and #379 reviewed runtime/UI enablement. Before connecting v2 to UI, verify actual preview/download/reparse across all six phone profiles. This PR adds no UI and makes no mobile/download-browser or hosted import claim.

### Unpublished copy for the enabled release

Draft only, do not publish or send to Framer while hidden:

“Back up your collection layout and review imports before making changes. JSON backups preserve ordered targets, spacers, wanted choices and separate physical copies, including your recorded grading details. Choose a collection backup or all inventory, including Unassigned cards. CSV is available for card-list interchange; use JSON to keep the arrangement.”

Only publish after the missing execution/offline/API/UI gates pass. Artwork and label packaging must describe the verified #390 behavior at that time; do not promise lossless images from this slice.


## Optional private metadata compatibility

The authenticated read extension adds optional `collections[].location`,
`items[].legacySource` and `binders[].slots[].legacySource` (legacy row ID plus
complete original source JSON) to canonical normalization. The existing portable
v2 serializer/parser/hydrator carries these fields unchanged. Location is bounded
by 083 and private to owner/partner; omission in an old file means unknown, not
recorded absence. Explicit null stays null. Copied preset manifests and origin IDs
remain detached and unchanged. Source JSON preserves original unknown fields,
duplicated wants and timestamps; per-source bounds are 10,000 values and 30 levels.
Invalid source values reject the snapshot instead of being silently stripped.

This additive v2 change accepts old files. Older strict v2 readers reject new files
that contain these fields; there is no promise of forward compatibility and no
lossy downgrade. These are **private files**, not public shares. Opaque legacy
source JSON can retain original account IDs/person assignments and other private
historical fields. Top-level owner removal and current want-role conversion do not
rewrite those original bytes or authorize their use on another account. Existing
restore modes remain blocked where no atomic executor exists; source evidence is
never an execution instruction, current catalog assertion or authorization.

The private reader's inventory brand is still not a complete portable-backup
capability: live appearance/settings, asset packaging and any supported restore
API remain their owning delivery gates. No public serializer was expanded, no
whole-restore executor or production export button was added.

## Current execution slice (088)

The [atomic arrangement import contract](atomic-arrangement-import.md) supersedes the earlier whole-arrangement execution blocker only for empty/target-only native destinations with an already matching copied manifest, every physical-copy decision and no appearance/assets. Its immutable preview now emits one real command through the shared bridge. Additional-copy previews also have an internal authenticated consumer. Changed same-owner restores and all other listed gates remain blocked; production admission remains denied.
