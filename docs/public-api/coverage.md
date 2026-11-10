# Operation coverage

Current native status: [the #376 dispatcher slice](../native-developer-operations.md) now registers explicitly staged command/creation/native recovery schemas behind fixed 503 denial. Earlier foundation notes below describe their own delivered slices; none claims native admission or developer complete-read/pagination support.

The operation registry in `lib/developer-api/operations.ts` defines the REST schemas, MCP tools and generated reference. Implemented interfaces remain subject to release verification.

| UI data capability | Shared REST/MCP operations | Verification |
| --- | --- | --- |
| Catalog search, card lookup, stored details, canonical aliases, external identifiers | list_cards, get_card | query-bound cursors, strict schemas, nested R2 image regressions |
| Languages, Pokémon/dex, series, sets, set contents, illustrators | list_languages, list_pokemon, get_pokemon, list_series, get_series, list_sets, get_set, get_set_slots, list_illustrators | real >1000-record pagination, finite route/schema tests |
| Binder creation, renaming, ordering, deletion | list_binders, create_binder, update_binder, reorder_binders, delete_binder | hosted transactional retries and order/ownership checks; existing binder tests |
| Owned slots, status, wanted printings, assignments and acquisition intents | list_collection, save_collection_item, delete_collection_item | existing normalization/conflict suites, atomic SQL and stale-delete proof |
| Collection settings and per-binder layouts | get_settings, update_settings | existing settings/layout fixtures and strict input schemas |
| Public account identity | get_identity, update_identity | existing identity rules; service-only transaction-local identity delegation |
| Binder slugs and sharing | get_binder_identity, update_binder_identity, get_sharing, update_sharing | owner-only server guards, existing name reservations/sharing tests |
| Appearance and uploaded artwork | get_appearance, update_appearance, prepare_artwork_upload, get_artwork | revision checks, real private R2 MIME/size/overwrite/signature tests, six phone/PWA configurations |
| Partners and invitations | list_partners, invite_partner, accept_partner_invite, reject_partner_invite, disconnect_partner | real recipient denial, retry, ownership and disconnect SQL proof; UI uses the same transactional actions |
| Saved prices, refreshes and comparison evidence | get_prices, refresh_prices, get_price_checks, refresh_price_checks | existing provider confidence, currency, finish and cooldown suites |
| Background comparison jobs | inspect_comparison_job, start_comparison_job, get_comparison_job, cancel_comparison_job | app-only start denial, seeded inert job read/cancel, existing UI job fixtures and hosted idempotency SQL proof |
| Activity and historical price evidence | get_collection_analytics, get_price_history | existing analytics tests, 1001 synthetic history records paginated exactly once |
| Import identity resolution | resolve_import | existing exact catalog identity resolution and bounded batch schemas |
| Listings and deal evaluation | get_listings, check_deal | existing listing/deal/FX/confidence suites; no invented prices |
| Show purchases and undo | list_show_purchases, add_show_purchase, remove_show_purchase | shared row normalization, existing purchase sync tests, idempotent owner-scoped mutations |

Website-only: billing and checkout, account deletion, credential administration, push-device enrollment. Device-only: camera capture/OCR, wake lock, offline storage/queues. Admin sync/backfill and payment webhooks are not public tools.

Internal foundation: [editable binder contracts](../binder-slot-contracts.md) define stable slots, copied presets and pure layout plans under #360. They have no runtime caller or new REST/MCP operation. [Inventory/placement/grading contracts](../inventory-contracts.md) under #382 add unused owned-copy identity, trusted candidate adaptation, pure assignment/move/unassign plans and shared AuditContext. They add no public operations or OpenAPI schemas; grading UI/provider calls and runtime exposure remain downstream. Authoritative writes (#362/#383), exposed API schemas/docs (#376) and rollout gates (#379) must ship before these capabilities are publicly advertised. Existing collection operations above retain their legacy contract.

API keys are REST-only. MCP requires resource-bound OAuth with explicit grants. Signup trials are excluded. Raw API authentication ignores cookies and query-string secrets. Current membership and paid access are checked on every operation. Images are R2-only, including private binder artwork in a separate bucket.

Internal storage preparation (#361): [schema and legacy transition](../inventory-storage-migration.md) adds private tables and an unused service-only conversion primitive. No REST/MCP registry, generated OpenAPI, public data or runtime exposure changes. #362/#383 own authenticated transactional commands, #363 guest/offline reconciliation and #394 the existing audit recorder integration. Schema application and conversion remain separately gated.

Internal staged slot operations (#362): [atomic structural command contract](../atomic-slot-operations.md), migration 074 prototypes and `/app/api/binder-slots` are disabled. Every slot route verb returns unconditional private/no-store 503 `slot_operations_staged`; even service_role has no EXECUTE on these new SQL prototypes. No UI/data capability or supported REST/MCP/OpenAPI operation is exposed. Existing collection writes map converted-binder SQL guards to structured 409 `binder_converted_requires_slot_commands` without choosing a repeated Pokémon slot. #383 retains ownership/assignment implementation, #376 owns reviewed canonical/alias adaptation plus shared REST/MCP schemas, generated examples/help and permissions before enabling; #363/#394/#396/#379 remain offline/audit/recovery/rollout gates. No customer or Framer release for hidden capability.

Internal staged inventory operations (#383): [ownership command contract](../atomic-inventory-operations.md), migration 075 and `/app/api/inventory` remain disabled. Every route verb returns unconditional private/no-store 503 `inventory_operations_staged`; SQL prototypes are denied even to service_role. The shared strict parser/adapter and pure bounded bulk-move preview add no registry/OpenAPI claim. Existing-copy/free-slot assignment is catalog-independent; catalog creation and constrained targets require persisted evidence. Explicit occupied intent, selected-want-only fulfillment, owner-locked billing and private before/final-after evidence are prepared for #394/#396. No customer feature/marketing publication is claimed; #363/#376/#379 and actual transactional audit/recovery remain required before exposure.

## Private collection history

`list_collection_audit` and `get_collection_audit` share collection:read, current developer entitlement/membership and private/no-store handling across REST/MCP. They return keyset-paginated safe retained deltas, never recovery columns/private certificates/label assets. Missing migration 076 returns audit_unavailable (503). See [transactional audit](../transactional-collection-audit.md). Structural mutation executors remain staged/denied; Activity UI and recovery are #395/#396, offline integration is #363.

Staged slot/inventory offline intent (#363) is device-private preparation only. No REST/MCP operations are registered; current routes remain hard 503. See [the internal persistence/replay boundary](../slot-inventory-offline.md). Supported reads/auth/provenance/status mapping and registry exposure remain #376/#394/#379 gates.

## Activity UI and first-party adapter (#395)

Activity consumes the same `list_collection_audit` / `get_collection_audit` reader through an internal first-party cookie/RLS adapter, `GET /app/api/collection-activity`. It has no API-key requirement, developer paywall, competing registry/feed or export. Standard owner access and current partner policy follow existing session membership and database RLS. Developer REST/MCP permissions and entitlement stay unchanged. The existing list adds `pokemonId` and `cardId` filters over retained legacy/touched evidence; cursors remain filter-bound. UI/cache boundaries and the unpublished parent release draft are in `docs/collection-activity-ui.md`; help is `/app/docs/collection-history`. Recovery and structural runtime commands are not enabled.
### Ordered-slot renderer staging (#364)

The shared binder flat/3D renderer has an internal, read-only snapshot display adapter with stable slot selection and actual inventory references. It is exercised only by the gated e2e harness; production legacy startup/shares/offline queues are unchanged. This adds no supported REST/MCP operation or OpenAPI schema. New inventory/slot routes remain unavailable. See [binder-slot-display.md](../binder-slot-display.md) for adapter invariants, explicit Edit layout requirements, grading exclusions and remaining #363/#376/#379/#394/#396 rollout gates. No customer announcement applies to this hidden foundation.

Internal authenticated complete reads (#376 prerequisite): [owner inventory snapshot adapter](../inventory-complete-read.md) reads permitted 073 tables through the first-party cookie/RLS session, current membership and billing policy. All owner streams and ordered slots are complete before branding; counts/revision fences and bounded whole-attempt retries reject partial/changing state. Private grading/certificates are internal planning state, never a share/developer projection. Missing owner state and legacy/mixed owners are explicit unavailable boundaries. No registry/OpenAPI/MCP/REST operation, developer grant bypass or route enablement is added. #363 still needs post-ledger fresh-state ACK integration; #361/#365/#379 own bootstrap/recipient/rollout.

### Staged recovery SQL (#396)

Migration 077 supplies SQL-owner-only safe preview/versioned idempotent apply over supported 076 slot/inventory evidence, including bounded native-slot collection restoration, and an additive original-event link in newly appended history. It adds no runtime grant or supported HTTP/REST/MCP operation; even service_role cannot call the private executor. Existing safe reader fields, OpenAPI, generated reference/agent docs and read-only Activity behavior remain unchanged. [The exact private contract, errors, unsupported legacy/auxiliary/assets and remaining Activity/Undo/offline/API gates](../safe-collection-recovery.md) ship with the implementation. #376 must expose the real authenticated shared operation/app wrapper and generate docs together when ready. #396 stays open for the linked-event detail/mobile integration carried from accepted #395 and the remaining recovery acceptance. No Framer publication or customer recovery claim applies to this hidden slice.

078 changes only internal whole-collection deletion admission: a sole versioned delete can cover 4,096 slots under separate finite budgets. Ordinary batches and unconditional 503 routes/runtime denials are unchanged. No registry/OpenAPI/MCP operation or customer recovery promise is added. See [bounds, unsupported payloads, recovery and application](../atomic-inventory-operations.md#atomic-whole-collection-deletion-078-internal-only). #383 remains open for oversized evidence/latency and mixed-legacy/auxiliary integration; #376/#379 own exposure.

079 optimizes only private recovery-plan computation behind the same SQL-owner boundary. Actor/owner/source still require trusted server binding before any future adapter; no registry, REST/MCP/OpenAPI, private plan exposure, permission or route changes. See [local recovery performance evidence](../collection-recovery-performance.md). This contributes to #396/#383 without completing or announcing recovery.

080 extends the same denied private recovery SQL to ordinary edits with unchanged conversion provenance, validated frozen source and current dependency fingerprints. [Converted-content recovery](../converted-content-recovery.md) records supported commands, unsupported whole-event cascades/deletion/transitions and remaining API/UI/offline/asset gates. No registry, OpenAPI, REST/MCP grant or route is added.


Internal 081 compatibility: [converted deletion and mapped-slot recovery](../converted-cascade-recovery.md) extends denied SQL-owner-only preview/apply, preserving physical copies and exact frozen sources. 074/075 retain private dependency evidence; unsupported auxiliary events fail whole. No supported REST/MCP registry/OpenAPI, UI/Undo/offline or Framer capability is added. Existing unconditional 503 gates and read-only Activity release remain.
### Explicit destination-slot picker (#366 preparation)

The staged owner-only picker emits existing parsed inventory `assign` and slot `update`/`clear` draft intents to an internal callback only. See [callback, queue and privacy contract](../explicit-slot-picker.md) and [staged help](../../content/docs/slot-selection.mdx). No REST/MCP registry or generated OpenAPI operation is registered while slot/inventory transports remain unavailable. The existing internal public catalog GET accepts opt-in `includeNonPokemon=1` for the slot picker, preserving default legacy Pokémon-only search. Supported developer catalog/list-cards semantics are unchanged. Existing production/legacy/share behavior remains authoritative. Durable authenticated execution, #413 replay-to-fresh-read ACK, bootstrap/rollout and no-destination target-or-append remain open #363/#366/#376/#379 gates. The unpublished enabled-release draft is in `docs/releases/explicit-slot-selection-draft.md`.

### Preset creation preview and goal presentation (#367/#368 preparation)

The optional private creation adapter emits a parsed immutable draft only, with ordered copied manifest targets. Production callers omit it; the legacy creation operation stays unchanged. No new supported REST/MCP operation, OpenAPI output, durable write, queue ACK or audit event is added. [Staged contract and required atomic/version/idempotency integration](../preset-creation-preview.md) records the backend/#376 parity and #379 enablement requirements. The [unpublished release draft](../releases/preset-creation-draft.md) must not be announced as shipped. Current-target progress reuses the canonical matcher on explicit slot/inventory evidence, with no fabricated legacy bootstrap progress.
### Explicit Edit layout (#369 preparation)

[Edit layout's internal callback contract](../explicit-slot-layout-editing.md) generalizes PR418's existing draft sink for parsed slot create/move intents, including null-selection append. Stable anchors and complete saved-layout positions are resolved through canonical pure projections. The synchronous harness measures draft handoff only; the private durable harness now proves real local transaction acceptance with synthetic replay/read streams. Neither proves authenticated execution, authoritative audit success or real partner sync. No public app route, REST/MCP registry, OpenAPI, grant, schema or production bootstrap change is introduced. Undo/removal and production offline/partner/rollout remain explicit #369 gaps; the opt-in #370 bulk extension below is also private. Staged help and unpublished enabled-release copy accompany the slice; no Framer publication applies.

### Trusted storage bridge staging (082)

[Internal authenticated command/recovery execution](../trusted-storage-execution.md) now binds the real service-only RPC, existing app/API-key/OAuth authentication, current membership/paid scopes, trusted attribution, bounded receipts and sanitized errors. This is server preparation only: both public POSTs remain hard 503, no registry/OpenAPI/MCP operation is added, and existing public behavior is preserved. Parent owns hosted grant review/application; #379 owns simultaneous exposure/docs/smoke and #363/#396 own durable readback and Activity/Undo integration. No conversion, provider spending or public recovery claim is enabled.
Internal backup/import preparation (#365): [JSON v2 serialization and immutable preview](../binder-backup-v2.md) reuse #360/#382 models, preserve separate physical copies and keep private owner/auth/queue/share data out of portable files. No registry/dispatcher/OpenAPI operation is added. Only bounded explicit Unassigned-copy additions can produce one parsed canonical inventory request; nothing submits it. Whole restores and arrangement imports fail closed pending a complete atomic executor/inverse, #363 offline replay, #376 API integration, #390 verified asset packaging and #379 enablement. Legacy `resolve_import`, Dex CSV and v1 JSON contracts are unchanged. No public restore or customer announcement is claimed.


### Atomic named storage creation preparation (083)

[Internal command, transaction, staged REST/MCP schemas and adapters](../atomic-storage-creation.md) add named native Binder/Slab/Custom storage creation with exact copied manifests and ordered stable slot IDs through the 082 trusted bridge. No inventory/grade/wants or saved-entry cost is created. Public routes and registry/OpenAPI remain unchanged and hard-gated. 083 alone rejects creation recovery; [084's partial inverse](../native-collection-creation-recovery.md) supports complete untouched nondefault events while first/default events retain explicit conflicts. #396 recovery and #379 exposure/queue/bootstrap/compatibility proof still block enablement, with slab-specific UI additionally gated by #390. The preset form still emits only an immutable draft. [Unpublished release copy](../releases/atomic-storage-creation-draft.md) is not availability.

### Native creation recovery preparation (084)

[Internal contract and private proof](../native-collection-creation-recovery.md) extend denied private recovery through the existing service-only 082 gateway. The complete 083/076 creation event is required; first/default replacement, dependent rows, changed/ABA content and incomplete later history reject atomically. Owner authority, inventory, wants, defaults and immutable originals survive. Existing preview/apply schemas and receipt redaction are unchanged. No supported REST/MCP registry, OpenAPI/generated docs, Activity/Undo, UI/nav or environment enablement is added. #396/#379 remain open; [release copy](../releases/native-creation-recovery-draft.md) is unpublished.

#363 durable-session integration remains internal/device-only: the gated synthetic harness joins the sole IndexedDB queue to async picker/layout local acceptance, with a separate post-replay verified complete-read capability before ACK. It adds no registry operation, public endpoint or transport schema; existing slot/inventory routes stay 503 and no production bootstrap supplies the capability. [Internal callback, errors, scopes and proof limits](../slot-inventory-offline.md#durable-session-ui-integration-this-slice). The backend lane owns authenticated command/recovery binding and #376/#379 still own supported API/rollout gates. No OpenAPI regeneration or customer announcement applies.
### Read-only Inventory browse (#385 preparation)

[Inventory browse's private UI input/callback contract](../inventory-browse.md) consumes supplied validated owner evidence. It adds a reusable per-copy projection/view and an isolated local-only synthetic harness, not a public inventory read or command. No REST/MCP registry, dispatcher, OpenAPI, permission/grant, queue, bootstrap or server execution change occurs. The authenticated whole-owner binding and complete-read transport validation remain a #379 enablement gate; #386 owns navigation/highlight/restoration. No audit/recovery side effects are fabricated. Cached subsets stay explicitly cached-only, and absent cached copies are never reported as absent ownership. [Release copy](../releases/inventory-browse-draft.md) is unpublished until the real capability is deployed and enabled.

### Staged collection navigation (#386)

[Collection navigation](../collection-navigation.md) adds an internal host for device/account/owner-local presentation, Inventory return context, stable-ID location refresh and scoped history/deep links. Navigation preferences are device-only UI, with no REST/MCP/registry/OpenAPI or audit operation. Its complete-read input is an in-memory private contract; runtime branding does not survive JSON. The private browser reconstruction and real navigation adapter now supply fenced grid/catalog data; production BinderApp/dock/queue/lifecycle binding remains a #376/#379/#386 blocker. 086 adds a narrow app-only authenticated grid RPC for partner inheritance, pending parent review/application. No slot/inventory route, conversion or Slabs presentation is enabled, and unpublished release copy makes no shipped claim.
Internal grading editor (#387): [authenticated Inventory binding and provider navigation](../manual-grading.md) use complete private per-copy evidence and the existing full 075 `inventory.edit` command through the canonical durable queue/HTTP sender/fresh-read ACK. Device acceptance is explicitly pending sync, never remote persistence. Cached startup is read-only and production admission stays denied. This app-only session adapter adds no REST/MCP operation or generated schema: developer `patchGrading` remains the private-preserving public-field edit for redacted DTOs, not a certificate/raw-clear adapter. [Help](../../content/docs/manual-grading.mdx) describes that boundary. Official outbound links are private owner/partner UI only; scoped certificate publication stays OFF and unimplemented. #376/#379 retain API admission and rollout ownership.

### Private browser complete-read transport (#376/#379 preparation)

[The first-party handler and browser reconstruction adapter](../inventory-complete-read.md#private-browser-transport-still-behind-379)
transport the authoritative reader's private domain plus independent completeness
fences, bound to current actor/owner/auth session/device lifecycle and a fresh
nonce. They are deliberately unwired behind the unchanged unconditional 503 routes.
This app-only boundary accepts cookie/RLS authentication, not API keys or MCP OAuth,
and contains private grading metadata unsuitable for public/share projection.
No shared registry operation, permission, OpenAPI schema or generated discovery is
added. Supported REST/MCP parity remains tracked here in #376; #379 owns exposure.
Private wire v2 now preserves 083 location and immutable item/slot source metadata,
with real public mirror catalog and fenced per-binder/owner grids. The actual
`readCurrentCollectionNavigation` callback supplies the existing host contract.
086 supplies inherited partner grids through a no-argument, authenticated-only
security-definer projection of actual owner grid fields/existence and minimal
membership/timestamp fences. Table RLS/ACLs and denied helpers stay unchanged.
Before application those grids remain unknown; no default guess occurs. JSON-v2 backup compatibility is documented, but appearance
and asset packaging/full restore are not delivered. No customer availability or
audit/recovery mutation is claimed.
### Private bulk layout preparation (#370)

The opt-in bulk toolbar consumes existing internal parsed slot create/move requests and the real device-commit acceptance sink. One bounded group is one request, not independently accepted chunks. It supplies no new public REST/MCP operation, grant or OpenAPI schema while routes remain gated. Stable selection, stale-copy evidence, host props and remaining Undo/fill/cross-storage/enablement gates are documented in [bulk layout editing](../bulk-slot-layout-editing.md); staged help is `/app/docs/bulk-layout`. #376/#379 own public parity/enablement, #393 owns publication after the feature block is enabled. This is not a claim of authenticated server execution or customer availability.

### Explicit default creation recovery preparation (085)

[Internal v2 contract and proof limits](../explicit-default-creation-recovery.md) add `recovery.preview.v2` / `recovery.apply.v2` only to the existing service-only gateway and strict internal parser. A nominated accessible same-owner native collection with current canonical 075 preconditions receives default atomically with untouched default-creation removal. No implicit selection, cleanup or authority rewind; version-1 requests/plans remain unchanged. No public registry/REST/MCP/OpenAPI, grant, route enablement, Activity/Undo/UI, browser-read transport or Framer change. #396/#384/#379 remain open. The original converted 4,096-copy 10s failures remain recorded alongside [same-state committed transaction controls](../converted-recovery-performance.md); this corrects local benchmark interpretation and does not establish hosted cancellation/load or enabled rollout. [Release copy](../releases/native-creation-recovery-draft.md) stays unpublished.
## Copied set checklist drafts (#372/#373)

The [set preset slice](../set-preset-checklists.md) reuses full mirrored app set reads and existing supported `list_sets`/`get_set` and paged `list_cards`/`get_card` catalog operations. Exact target/scope generation is an internal UI draft callback, not a new REST/MCP mutation. OpenAPI and public creation schemas are unchanged. 083 remains the execution boundary; detailed scope metadata requires an accepted durable contract before #379 enablement. No saved creation, hosted partner execution or persistent offline replay is claimed. [Help](../../content/docs/set-checklist-drafts.mdx).

### Existing ordered public shares (#371)

The existing token/named pages use a scoped, public-only internal read projection after current share permission. This adds no REST/MCP operation, permission or generated OpenAPI schema. Share/identity management remains under its existing free owner controls; inventory/slot mutation routes remain staged 503 and #379 conversion/exposure remains closed. Public pages never expose the complete private inventory read transport. See [public binder compatibility](../public-binder-compatibility.md); rollout and publication acceptance remains with #371.

### Private scanner destination review (#375)

The actual staged BinderApp/BrowserCollectionSession binds PageScanner camera/photo and QuickCardScanner review to the existing durable original-ID queue, HTTP command sender and fresh complete-read ACK. The existing strictly loopback/non-hosted harness is the only admission. Cached-only startup does not gain editing authority. Scanner append now composes existing `execute_inventory_commands`/091 `insertAssign` with existing-slot assignments in one explicitly reviewed batch, including a truly empty binder with a verified saved grid. The existing durable IDB/sender/fresh-read ACK path owns persistence. Raw creation beside graded-only eligible copies remains unsupported. Capture and transient OCR/occupancy review are browser-only, not public native mutations. No REST/MCP registry, permission, OpenAPI/generated contract or route admission changes. All native runtime guards remain closed. [Internal host and atomic append contract](../scan-destinations.md), [staged help](../../content/docs/scan-destinations.mdx) and [unpublished release copy](../releases/scan-destinations-draft.md) record remaining #362/#383/#366/#369/#376/#379/#394/#396/#393 gates.

### Readable Activity and card/want-list Undo (#447)

Migration 087 and the shared recovery facade expose only complete recorded legacy `pokemon_collection` row events. `preview_collection_recovery` and `apply_collection_recovery` have matching REST/MCP registry entries and the first-party Activity adapter. They bind current actor/owner/transport, recheck membership and allowances, preserve exact recorded identities, refuse later same-key edits including ABA, require a reviewed token and explicit confirmation, and replay the same operation once. The original stays immutable and a new entry links through `recovery_of_event_id`; `recoveryOfEventId` filters inverse links. Durable device retries retain the original account/owner/membership and request across unknown outcomes; accepted recovery is followed by a complete collection reread.

The existing native/structural executor and default-creation v2 remain internal. This release does not bypass #396/#379 latency, enablement or complete-read gates, convert a binder, recover deleted collections/configuration/sharing, or replay acquisition notifications. Older incomplete evidence is unsupported. The API, Activity preview and help state those limits. See [current user/API help](../../content/docs/collection-history.mdx); [release draft](../releases/activity-undo-draft.md) stays unpublished until verified production delivery.

## Native developer dispatcher slice (#376), staged

[Current help](../../content/docs/native-storage.mdx) and [internal adapter/proof contract](../native-developer-operations.md) now cover seven registered native slot/inventory command, copied creation and v1/v2 recovery operations. REST and MCP share strict schemas, declared existing permissions, per-operation bounds and the existing trusted storage executor. Every valid authorized request is still denied by fixed `503 native_operations_staged` before execution; generated OpenAPI and agent exports declare staged admission and distinguish future receipts from current responses. Legacy collection and Activity/087 Undo operations remain unchanged. No first-party route, SQL, grant, conversion or runtime admission changes.

Developer complete reads/pagination are **not delivered**: the current whole-owner reader requires first-party cookie/RLS authentication and forbids developer/private-evidence serialization. API keys and MCP grants cannot substitute. The exact incompatible calls and required reviewed developer projection are recorded in the internal contract. No admin bypass, invented session or partial-as-complete projection is added. Preset list/preview, read and consumer/queue/offline/recovery/hosted proof and #379 gates remain open. [Release copy](../releases/native-developer-parity-draft.md) is unpublished.

### Staged native developer reads (#376)

Five shared registry operations (`list_inventory_items`, `get_inventory_item`, `list_storage_collections`, `list_storage_slots`, `get_storage_slot`) have strict inputs/responses and generated REST/MCP/OpenAPI/Markdown/LLM discovery. Fixed `native_operations_staged` denial remains before privileged reads until #379. The trusted key/OAuth adapter rechecks current authority, membership and billing and reuses the whole-owner complete-read query/normalization core; it never passes an admin client to the cookie reader. Its declared projection omits certificates/private assets/immutable sources/planning/audit evidence and member secrets. Independent revision/count/metadata fences and signed credential/scope/filter/read-revision cursors reject partial/racing/stale reads. Pages are not complete snapshots or queue ACKs. [Current help](../../content/docs/native-reads.mdx), [contract/proof limits](../native-developer-read.md) and [unpublished release copy](../releases/native-developer-read-draft.md). Preset discovery/preview and consumer/hosted/admission gates remain open.


### Private-preserving native mutations, partial (#376/#383)

The two existing native command operations accept an additive `privateFields` assertion. `preserve` requires an original `expectedOwnerUserId` fence before execution, then allows only unchanged target/placement/new-copy/explicit ownership-removal intents that never reconstruct hidden grading or wants. Omission and `replace` retain full-replacement compatibility, including authorized explicit clearing. Current help documents each allowed/rejected command, unknown-outcome retry identity and the transactional SQL blocker for grading patches/selected-want fulfilment from redacted DTOs. Registry descriptions/input schemas and generated OpenAPI feed REST, MCP, HTML, Markdown and agent exports together. No operation, permission, public data or admission is added; five developer reads remain incomplete pages/details, never planner/queue-ACK snapshots. See [exact prerequisite and proof limits](../native-developer-operations.md#private-preserving-command-mode-376383).

## Atomic arrangement import (#365), staged

`import_storage_arrangement` at `POST /storage/imports/arrangement` adds the strict shared REST/MCP schema and safe receipt for 088 atomic JSON v2 import into empty/target-only native storage with an already matching copied manifest. Both write scopes, current membership/billing and independent revisions apply. Generated OpenAPI/help declare fixed `503 native_operations_staged`; no production route admits mutation. The internal app confirmation/delivery consumer executes the retained immutable preview through the same bridge, without UI or offline ACK wiring. Existing legacy v1/CSV and Activity/087 remain unchanged. [Exact supported modes, SQL/recovery evidence and remaining gates](../atomic-arrangement-import.md). Parent applied 088 after a fresh restore-verified backup, preserving all 90 table counts and 35 core digests. No hosted import, conversion or enabled API performance proof is claimed.

### Terminal native rejection preparation (089)

[Native command reconciliation](../native-command-reconciliation.md) records whitelisted terminal rejections in the existing lifetime ledger, under current actor/source/owner authority and owner serialization. The internal first-party adapter binds a private 409 rejection envelope to the original ID; only a separate scoped complete read enables explicit cancellation or constrained rebase. Unclassified errors, timeouts and missing ledger reads remain unknown and retain exact retry. Shared internal execution forwards terminal data, but public registry/OpenAPI response schemas still describe accepted receipts only. Public terminal-result/error serialization and transport contract tests remain an explicit #376/#379 admission gate. No public admission, operation registry, permission, supported OpenAPI or generated reference change is included. Parent independent review and guarded089 application are recorded in the contract, preserving90 counts/35 digests and access boundaries. Merge/deployment and public terminal parity/rollout remain separate gates; release text is unpublished.

## Slabs renderer/gallery (#388), staged UI only

The [staged Slabs contract](../slab-rendering.md) and [help](../../content/docs/slabs.mdx) cover provider-specific static rendering and read-only gallery/detail through the existing navigation host/local BinderApp. This is device-local UI presentation over scoped inventory evidence, with no new authoritative data operation, permission or response schema, so REST/MCP registry and generated OpenAPI are unchanged. The renderer receives only safe catalog/grade metadata, never certificate, provider-record link or private label/slab asset fields. Certificate publication stays default OFF; public projections/assets/backups and native read/write parity remain gated by #390/#376/#379. #389 owns exact ACE/custom uploads. Production admission remains denied. Release copy is unpublished; no audit/recovery event, price estimate or provider fetch is introduced.



Transactional extension (090): `execute_inventory_commands` now declares public `patchGrading` and exact selected-want `expectedPublic` intents through the same shared parser, dispatcher, REST/MCP and generated OpenAPI. SQL resolves private data only under existing transaction locks after lifetime original-intent replay lookup; receipts stay sanitized. These forms are accepted in preserve mode. Full replacement compatibility is unchanged. Staging is unconditional, with no new scopes or complete-read/ACK claims. Existing private-asset inverse recovery remains an explicit gate. The independent lane proof was augmented by parent combined 089+090 PostgreSQL proof and guarded hosted090 application, preserving90 counts/35 digests and existing access boundaries. Production code is verified separately from still-denied runtime admission. [Contract and handoff](../native-developer-operations.md#transactional-private-preserving-inventory-intents-090).

## Copied preset discovery/preview (#376), staged

`list_storage_presets` and `preview_storage_preset` share REST/MCP registry, strict responses and fixed native 503 admission. Both require catalog:read + binders:read and current paid key/OAuth owner/partner authority. Public metadata and detached copied manifests do not require a private planning snapshot or first-party cookie. Supported subset: blank, Dex, generations, ordered unique species and bounded exact selected mirrored printings with attested language/verified requested finish. No ownership, wants, mutation/ACK or new retry identities. Set/master-set durable scope remains explicitly unsupported, not silently omitted or claimed complete. See [contract](../preset-developer-preview.md), [help](../../content/docs/preset-previews.mdx) and unpublished release copy. No SQL, catalog sync/provider spending or enablement. Broader #376 mutation/terminal-result/consumer/rollout gates stay open.

### Staged terminal command errors

`execute_slot_commands` and `execute_inventory_commands` declare a strict terminal-ledger error contract: REST 409 / MCP `isError`, with `error.code=storage_command_rejected` and only `rejection.outcome`, original `operationId`, known rejection `code` and `inventoryRevision`. Ordinary conflict errors carry no terminal proof. Accepted receipt schemas remain success-only; MCP advertises them as `outputSchema` and error schemas under `_meta["holofolder.com/errorSchemas"]`. Generated OpenAPI and derived Markdown/LLM reference carry the same contract. See [reconciliation](../native-command-reconciliation.md). Public admission remains fixed 503; synthetic transport tests are not hosted acceptance or an enabled feature. No new UI/offline queue contract or SQL is introduced.

Native analytics/dashboard totals are a staged internal presentation over the existing
fenced complete-read host, not a new admitted API. `get_collection_analytics` remains
legacy history: owner-wide native roots (including retained Unassigned copies), converted/mixed storage return 503 `native_analytics_staged`
before legacy activity is queried; unknown authority fails closed. Saved prices still
use `get_prices`. See [native analytics boundary](../native-analytics-dashboard.md).


### Native Activity recovery UI preparation (#396)

The [staged first-party journey](../native-activity-recovery-ui.md) joins existing safe Activity history, the native recovery v1/v2 bridge and an additive recovery intent in the existing atomic device queue. The new first-party `/app/api/native-recovery` remains unconditional private/no-store 503. Only the established local/nonhosted harness calls the real internal handler with synthetic clients. Existing public recovery schemas/REST/MCP/generated OpenAPI and their fixed admission remain unchanged. No native event can enter legacy 087 row Undo. Unknown outcomes retain exact original IDs/choices/recipient; accepted receipts need a separate scoped complete read before ACK. Safe recovery terminal noncommit proof is still a backend prerequisite for cancellation/replanning. Current help describes the staged boundary and [release copy](../releases/native-activity-recovery-draft.md) is unpublished; #396/#379 stay open. Preserve #466's independent preset operations during integration.


`execute_inventory_commands` adds strict staged `insertAssign` (091), with exact existing before-anchor or append, target/free choice, and null/existing Unassigned/explicit new copy selection. Shared REST/MCP schemas/generated output and durable intent projection ship together; no new operation, permission, admission or complete-read capability is claimed. The scanner consumes this same operation through device-only review; it does not add a remote scanner operation. See [contract and local proof](../atomic-insert-assign.md).


## Recorded-copy bulk fill (#370/#369), private browser composition

[Bulk fill](../bulk-slot-fill.md) binds the existing real browser host, layout
selection, inventory `assign` batch, durable IDB acceptance, HTTP sender, terminal
rejection review and fresh complete-read ACK. Manual copy/destination review and
opt-in compatible Unassigned proposals use the existing domain match contract.
No new data operation, permission/schema/error, generated OpenAPI change or public
admission is introduced. This UI cannot create inventory, overwrite/move assigned
copies or invent a hosted inverse. REST/MCP continue to describe the underlying
staged batch; production and cached-native startup remain denied/read-only.
Synthetic local authority/ledger tests are not hosted SQL or production proof.
See the [private help](../../content/docs/bulk-layout.mdx) and unpublished release
draft. Parent retains #370/#369 final acceptance and rollout ownership.




### Prepared native recovery rejection

Native recovery remains staged and returns `503 native_operations_staged` before execution. The prepared v1/v2 apply contract declares REST `409 storage_recovery_rejected`, or MCP `isError:true`, only for a committed strict `error.rejection` containing `outcome:"rejected"`, the original `operationId`, known `code` and `inventoryRevision`. Codes are `recovery_plan_conflict` and `recovery_dependency_conflict`. Arbitrary 409/SQL errors, missing receipts, cancellation and billing/access errors are not noncommit proof. Exact accepted/rejected replay requires current authority and precedes mutable plan reconstruction.

In the staged app, durable proof permits a separately fresh complete current owner/session read and explicit **Discard noncommitted recovery**. Discard preserves original request/proof with a distinct discarded state, never accepted/synchronized. **Review new recovery** then needs a new preview and explicit confirmation with a new operation ID. Unknown and accepted requests never gain discard/rebase. The existing legacy Undo contract is unchanged; no private inverse, evidence, certificates or assets are exposed. This preparation is not an enabled capability or release announcement.


## Repeatable release smoke coverage

The [operator smoke guide](../api-smoke.md) distinguishes 56 admitted functional checks from 15 fixed native staging denials (five reads, two presets and eight storage POST contracts). Every staged operation has explicit synthetic schema-valid denial input; missing/new fixtures, incorrect HTTP status/error bodies or failed assertions fail coverage. Local real REST/MCP HTTP/SDK tests use synthetic authority dependencies and prove zero executor/data RPCs under the unchanged admission gate. Native `verified` and latency acceptance remain unproven. Parent owns reviewed deployed smoke and exact fixture cleanup; pending or unknown cleanup cannot pass. This internal reporting fix enables no API operation, SQL, native write, Inventory or BrowserSession behavior and closes no #376/#379 rollout gate.


### Native device backup and local file inspection (#365)

The staged native host's Backup dialog composes the canonical v2 serializer with the existing complete private first-party inventory read, then downloads an explicitly private device Blob. It never serializes public/redacted developer pages or cached/partial mirrors as complete. Verified membership is carried only in the private read envelope to map wanted roles; optional strict v2 `layouts` retains exact grid evidence. No new export endpoint, private-export permission, server backup store or periodic job is added. REST/MCP registry and generated OpenAPI are unchanged.

Local file inspection is a browser-only capability because it reads a user-selected device file without sending its bytes anywhere. Strict bounded parsing and frozen counts/conflict inspection are shared pure logic. No executable plan is admitted from guessed allowance, file IDs or redacted data; the underlying `import_storage_arrangement` contract stays staged. Files carrying grids are rejected by arrangement planning until verified grid reconciliation is supported. No writes/audit events are fabricated. Appearance/settings, full owner restore, asset bytes, CSV execution, durable import/terminal-proof/ACK, offline restore and production admission remain tracked by #365/#390/#379. See `docs/binder-backup-v2.md` and native-storage help.

## Durable copied-preset creation consumer (#368/#384), staged

The [native device creation host](../durable-copied-preset-creation.md) composes the existing manifest builders and `create_storage_collection` through the trusted `collection.create` bridge and the existing atomic slot queue. New binder, preview, explicit confirmation, stable IDs/original context, device-pending acceptance and post-reply fresh complete-read ACK are app-specific UI/IDB behavior. No new REST/MCP schema or generated OpenAPI change; existing staged preset discovery/preview and creation operations remain the API composition. First-party `/app/api/storage-collections` and developer admission remain fixed 503. Cached native startup cannot create; no legacy `/api/binders` fallback, fabricated empty owner authority or #379 bootstrap bypass.

Blank/Dex/generation/species/exact selected printing goals create no ownership, grades or wants. Set/master-set is explicitly unavailable because separate checklist scope cannot be losslessly persisted. Binder-only exposure here leaves Slabs/general storage to #390. Unknown creation errors, including bare 409, retain exact intent without cancellation/rebase. The reviewed 093 shared terminal-proof contract now feeds the staged first-party consumer through authoritative error serialization and delivery/family/operation headers. Original immutable intent and original account/owner/auth-session binding remain in the same atomic IDB record. Explicit discard requires a new complete current read plus session/lease/CAS fences and retains intent/proof in `creationDiscards`, never an accepted receipt or automatic rebase. A new creation requires preview/confirmation and fresh operation/collection/slot IDs. Old records without original auth-session evidence stay unresolved. Current [help](../../content/docs/native-storage.mdx) and [unpublished release text](../releases/durable-copied-preset-creation-draft.md) describe the actual staged boundary. Parent owns final review/rollout; all full feature issues stay open.

Creation and arrangement noncommit preparation (093): `create_storage_collection` and `import_storage_arrangement` declare strict typed 409 rejection errors separately from accepted receipts, with permanent original-intent replay. [Consumer contract](../creation-import-terminal-noncommit.md) documents exact scope binding, fresh complete reads, explicit reconciliation and unknown outcomes. Actual REST/MCP synthetic transport and local PostgreSQL proofs are separate evidence; fixed public 503, arrangement-import consumer integration and hosted rollout remain gates. First-party creation discard is device-only, with no new public registry operation or OpenAPI shape; the existing shared REST/MCP 409 contract is unchanged. Related #384/#365/#363/#376/#379 remain open.

## Same-owner raw content restore (#365), staged094

`restore_raw_collection_content` at `POST /storage/restores/raw-content` adds one bounded whole-collection reconciliation path, shared app/REST/MCP gateway, strict current actor/owner/session-or-credential/partner/partnership preconditions and safe accepted/terminal-error schemas. It preserves existing physical/slot/collection IDs, replaces explicit slot content, and only places existing raw copies in that collection or from Unassigned. Explicit releases preserve ownership. Different placement, graded/converted/nonempty-preset/config/grid/slot-order changes, all-inventory/multi-collection/settings/assets/CSV and acquisition remain unsupported. Files never establish provenance. Original accepted/rejected replay precedes mutable reconstruction; unknown/cancel/failed COMMIT cannot prove noncommit. Fixed503 remains, generated OpenAPI/Markdown/MCP/help describe staging. [Exact bounds, consumer retention/read-ACK contract and local proof](../raw-content-restore.md). Parent supplies reviewed/applied094 and owns hosted verification, admission and release; this consumer lane performs no hosted checks and full #365 stays open.

### Native search/card-browser/Show consumer adaptation (#374)

Device-only composition: the actual Search, card browser, Show hunt and price-check consumers accept the existing scoped complete/cached read and host admission/command sink. Distinct item IDs drive ownership badges; explicit collectionId/slotId/wantedIndex and version evidence drive separate wanted destinations. Native actions never use legacy writes. Cached evidence is read-only, unknown printings remain unknown and private grades/certificates stay out of lookup labels. Existing reads and inventory assign operations cover the data contract, so registry/OpenAPI/permissions are unchanged. BrowserSession/BinderApp now forward live scoped reads, admission and the existing durable sink; cached startup supplies saved evidence with denying admission. Exact non-Pokémon lookup does not invent a species or legacy destination. The synthetic component harness remains distinct from the separate real-host IDB/HTTP suite and from hosted acceptance. Public native admission stays fixed 503. See `docs/native-search-show-consumers.md`; internal release copy remains unpublished. No new provider refresh, SQL, queue or hosted acceptance.



### Raw Inventory ownership device actions (#383/#385), staged

[Raw Inventory ownership actions](../inventory-ownership-actions.md) compose the existing staged `execute_inventory_commands` REST/MCP contract: explicit `add` creates a distinct raw Unassigned copy; exact-item `assign`/`move` chooses a compatible stable slot with explicit occupied-copy unassignment or compatible move-only swap; `unassign` retains ownership and goals; `removeOwned` previews ownership and placement consequences. Developer composition uses `privateFields:"preserve"` and `fulfillWant:null`. No new operation, permission, schema or generated OpenAPI is added. Device confirmation uses existing durable admission and HTTP/fresh-read ACK, while current owner/partner/billing gates remain server-owned. Existing Activity preview/apply owns recovery of the exact removed item and any explicit Unassigned alternative. Cached/incomplete reads, pending command/creation/recovery and stale scope block new actions. Native production admission remains fixed 503. Occupied decisions compose existing `occupied` choices with exact both-copy/source/destination refs, no ownership or want change and metadata preservation. Confirmation refreshes complete scope before queue admission; shared exact-operation Activity lookup appears only after fresh complete ACK, with conditional engine recovery. Explicit raw multiselect now composes one bounded request for ordered Move to distinct compatible empty saved slots or Unassign of all selected placed copies. Selection contains only checked physical IDs across pages/filters; whole unsupported selections fail before durable handoff, without chunking. The existing 100-command/256-work/262144-byte caps apply. Occupied bulk decisions, selected graded-copy ownership management and hosted rollout are not completed by this partial slice; #383/#385 stay open. No publication applies to this hidden preparation.


## Deliberate slot-removal review (#369/#370), staged

[Slot removal review](../slot-removal-review.md) composes `execute_inventory_commands` with one existing `removeSlots` command, exact current collection/layout/item/placement refs and ordinary bounded request admission. The app review previews disappearing slots/targets/wants and retained Unassigned ownership. Existing `preview_storage_recovery` / `apply_storage_recovery` and their v2 variants remain the Activity recovery contract; preview creates no audit event. No registry, permission, schema or generated OpenAPI change is needed. The existing device acceptance receipt has no Activity event ID or per-removal recovery-support proof, so this UI gives supported Activity guidance after sync and does not manufacture a linked instant Undo. Exact-event linkage, full feature acceptance and native admission remain parent-owned gates. No hosted write, migration, conversion or enablement applies.

## Durable bounded raw restore UI composition (#365/#363), staged

The native Backup dialog now composes the existing bounded094 `restore_raw_collection_content` contract with explicit local review, separately disclosed private server planning, per-copy release consent and confirmation before durable enqueue. The browser owns device file selection and the same atomic `SlotOfflineRecord` queue; REST/MCP clients retain their own original requests. This app/device composition adds no registry operation or public upload/backup store. Shared canonical command, authoritative bridge, strict accepted/rejected receipts and REST/MCP error schemas remain unchanged. No generated OpenAPI change is needed.

`POST /app/api/raw-content-restore` stays unconditional private/no-store503. Only the existing non-hosted loopback synthetic harness exercises the internal prepare/confirm/deliver handler. Original intent, recipient and IDs survive unknown outcomes; accepted delivery needs a separately fresh complete current read before ACK, dedicated rejection needs explicit fresh-read discard before a new plan/ID. All other storage writes are fenced while pending; cached read-only startup remains. No hosted apply, new admission switch, full owner/graded/converted/settings/assets/CSV restore, acquisition or cross-storage move is delivered. [Consumer boundary and evidence](../raw-content-restore.md). Full #365/#363/#379 remain open under parent ownership.
### Native binder pocket geometry (#364/#379)

The staged native flat grid keeps at least 36px pocket tracks and a minimum stage height. Its toolbar and page share the scrollport above the dock, so short viewports scroll rather than compressing hit targets into neighbouring slots; large grids retain their internal scroller. Pointer hit testing, viewport/safe-area layout and transient Browse/Edit selection are app-only geometry, not a data operation. Existing REST/MCP slot commands and generated OpenAPI are unchanged. This fix enables no native admission and closes no #364/#379 acceptance gate. See [operator evidence](../native-grid-hit-targets.md).

## Tracked-price refresh selection (#374, staged)

The existing refresh workflow now selects legacy/native/mixed authority through an internal admin-only selector. It includes Unassigned physical inventory and explicit native wants, excludes frozen converted rows and empty targets, and deduplicates the existing card/language transport. It fails closed on incomplete reads or authority changes. No operation, schema, permission, grant, OpenAPI output, audit event or native admission changes. `get_prices`, `refresh_prices` and comparison refresh contracts keep their existing gates. See [price coverage](../card-pricing-coverage.md#tracked-refresh-selection) and [price help](../../content/docs/contracts.mdx#images-and-prices). Synthetic query-shape/identity tests cover the selector; hosted/provider/rollout acceptance remains with #374/#379. Release copy is unpublished.

## Exact operation history lookup (#369/#370/#396)

`list_collection_audit` now accepts bounded `operationId` across REST, MCP and the first-party RLS Activity adapter. It filters exact `operation_id` under the already authorized owner, retains filter-bound cursors and the existing safe projection, and adds no private evidence or ACK/planning authority. Zero results do not prove noncommit; multiple results require inspecting/selecting an exact event with `get_collection_audit`. The staged browser command-to-Activity entry point consumes only existing separately fresh complete ACK receipts. Native recovery still requires its own current preview and confirmation; all native production gates remain 503. See [native Activity boundaries](../native-activity-recovery-ui.md#exact-acknowledged-command-linkage-369370396).

Staged #384 Binder/Custom creation UI composes existing `list_storage_presets`,
`preview_storage_preset` and `create_storage_collection`; custom/list/private
location already exist in the shared command schema. Device review and default
presentation mapping add no operation, permission or generated OpenAPI change.
Current native admission remains denied; first/default/mixed legacy and #390
Slab exposure gates remain. See [the consumer boundary](../custom-storage-creation.md).


## Legacy first-party device review

`/app/api/collection` now requires immutable actor/owner/concrete-binder assertions
for first-party POST/PATCH/DELETE. Missing older-client binding returns structured
retention-safe 503, never a generic row conflict or permanent 4xx. Developer
REST/MCP verified server context and atomic modes remain unchanged. The app-only
`GET /app/api/collection/review-destination` reads a fresh explicit destination for
device review; it does not accept or upload browser source data. Local acceptance
uses the existing queue authority/uploader. See [recipient containment](../legacy-recipient-containment.md)
and [device changes help](/app/docs/device-changes). Public native admission,
bootstrap and conversion remain staged at 503. No SQL is included.
