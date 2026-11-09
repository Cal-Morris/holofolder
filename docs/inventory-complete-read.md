# Internal authenticated complete inventory reads

`lib/server/inventory-read.ts` adds `readOwnerInventorySnapshot(client?, options?)` for the #376 read prerequisite of #363 and later #361/#365/#379 bootstrap. It returns the existing branded `CompleteInventorySnapshot`, never a page advertised as a complete owner view. No route, REST/MCP operation, OpenAPI schema, public-share capability, conversion, mutation, SQL or grant is added. All staged routes remain unconditional private/no-store 503, and the fourteen 074/075 SQL prototypes remain runtime-denied. Legacy collection APIs and startup remain authoritative.

## Authentication and private boundary

With no client argument, the helper creates the standard request cookie/RLS Supabase server client. Trusted server code can supply that same request-scoped client. Never pass an admin client, a browser-provided client, or HTTP input as options. There are no owner/actor arguments: verified first-party claims plus `auth.getUser()` bind the actor, the current partnership binds the owner, and `billing_partner_allowed(owner_id, actor_id)` must explicitly succeed before storage reads. Missing permission/billing schema fails closed. Multiple or malformed memberships fail closed. Actor, owner, partnership and billing are checked again before publication; an unlink, owner switch or permission loss cannot return the earlier shared snapshot.

This is standard app owner/partner access under 073 authenticated SELECT/RLS. It does **not** impose the paid developer entitlement on the app, accept an API key, authorize an MCP OAuth client, or reuse a shape-valid `OperationContext` as proof of authentication. OAuth `client_id` sessions are rejected. Future REST/MCP reads still require the existing current grant/permission, developer entitlement, scope binding and safe projection boundary. Do not call this private reader from the developer dispatcher as a substitute for those checks.

The result contains owner-authorized recorded grading/certificate/holder metadata and opaque private label asset IDs, needed by internal plans. It is not a public/share/developer API response or a certificate-publication policy. No provider lookup/verification, grade conversion, catalog enrichment, signed artwork URL generation, recovery state, command evidence, conversion receipt, frozen legacy source or credential/token projection occurs. Selects enumerate actual required fields; no `select('*')` is used. Unknown printings, repeated Pokémon, Trainers/Energy identities, and recorded grades survive without guessed catalog facts or manufactured copies.

## Actual table reads and mapping

All requests use the existing Supabase PostgREST client, never a handler PostgreSQL connection or denied `slot_page_v1` RPC.

| Source | Projection and completeness | Internal domain mapping |
| --- | --- | --- |
| `inventory_owner_state` | authenticated owner, `owner_user_id,inventory_revision` | one safe-integer owner revision |
| `partnerships` / `billing_partner_allowed` | actual current actor membership and allowed policy result | authenticated scope only, excluded from snapshot |
| `binders` | owner-scoped exact count, unique `id` keyset, `id,owner_user_id,name` | saved collection name, cross-check every storage state |
| `storage_collection_state` | owner-scoped exact count, unique `collection_id` keyset; kind, presentation, version, layout, preset, authority | `StorageCollection.version`, `BinderSnapshot.layoutRevision`, saved preset manifest |
| `inventory_items` | exact count and unique `id` keyset; identity, grading, acquisition time, content version | existing `normalizeInventoryItem` |
| `inventory_placements` | exact count and unique `inventory_item_id` keyset; collection, slot, placement version | existing `normalizePlacement`; no placement means Unassigned |
| `binder_slots` | per-collection exact count, unique increasing `position` keyset, plus owner-wide count fence | existing `normalizeBinderSlot`; ordered slots with target/wants/status/content version and saved preset origin; occupancy comes only from the complete placement stream |

Pages are limited to 500, below PostgREST's 1,000-row cap. Text keysets use PostgreSQL's ordering/collation. Positions use the schema's unique `(collection_id, position)` constraint. Counts come from separate `select(..., {count: 'exact', head: true})` requests; they are internal completeness assertions, **not additions to the 074 SQL or supported public REST/MCP contract**; the private transport below retains them as independent evidence. Independent item, placement, slot-content, collection and layout versions are retained; none is substituted for the owner revision.

For each collection, the permitted table reader produces the actual 074 `SlotPage` continuation shape (`inventoryRevision`, `collectionVersion`, `layoutRevision`, `slots`, `nextPosition`). `readAllSlotPages` checks the tokens and all ordered pages before mapping. It does not invoke the denied function or claim its raw private SQL projection is public. An early empty page, changing count, repeated ID/cursor, nonincreasing position, capacity violation or invalid normalized record rejects the read.

The complete placement stream is validated and retained inside the attempt to project occupied slots, then supplied to the shared four-stream validator alongside the actual paged item/collection/binder readers. `readCompleteInventorySnapshot` enforces the owner-scoped item/placement/slot bijection and collection coverage. Its optional internal `beforeBrand` fence runs after normalization and before branding. The server fence rechecks item/placement/slot counts, the complete binder/storage metadata, owner revision and authenticated scope. A partial or mixed-time value never escapes or becomes an acknowledged queue base.

This consistency proof relies on all accepted inventory mutations atomically increasing the monotonic owner revision, and collection/layout/content versions according to 074/075. It is a read fence across separate PostgREST requests, not a long-running database snapshot transaction. Direct out-of-contract privileged writes that do not update these revisions are outside this guarantee. Snapshot freshness is at the successful final fence; later partner edits require the normal next reconciliation.

## Honest states, retry and errors

An absent owner state is `inventory_not_initialized`, not a manufactured empty inventory. An initialized owner with zero inventory or zero collections can return a complete empty state. Every actual binder must have slot-authoritative storage state; missing/legacy state, including mixed legacy/new owners, returns `legacy_inventory_incomplete`. No conversion or legacy-row fallback occurs. Existing legacy app flows remain responsible for those owners. Missing schema, denied table reads, malformed data, inconsistent references and missing count support fail closed.

`InventoryReadError` exposes only a fixed code/status, never raw PostgREST messages or private values:

| Code | Status | Caller action |
| --- | --- | --- |
| `inventory_sign_in_required` | 401 | establish a current first-party session |
| `inventory_read_forbidden` | 403 | restore actual owner/partner policy access; do not retry as another owner |
| `inventory_not_initialized` | 503 | no new-model state; retain legacy authority/pending intent |
| `legacy_inventory_incomplete` | 503 | owner-wide bootstrap/conversion compatibility gate, retain pending intent |
| `inventory_read_conflict` | 409 | entire snapshot changed; reread current owner state |
| `inventory_read_deadline` | 503 | bounded deadline expired; retain intent and retry later |
| `inventory_read_unavailable` | 503 | schema/permission/query/normalization/completeness/budget prerequisite; retain intent |

Default limits: two whole-snapshot attempts, 15 seconds total, 512 request steps. Trusted options allow 1–3 attempts, up to 30 seconds and 4,096 request steps. Conflicts discard every stream and restart the whole attempt, never just one page. The shared deadline/budget includes retries and reauthentication; query requests receive an abort signal. A hanging authentication request also cannot delay the caller beyond the deadline. No lower-level error is forwarded or logged. Exhausted conflicts remain explicit 409; other unavailable/partial cases may return 503 immediately.

## Next integration and remaining gates

#363's future replay adapter must invoke this fresh reader **after** a successfully committed or ledger-replayed command, then associate the fresh complete result with the matching operation ID and current authenticated lease. A retained historical ledger result must never acknowledge current owner state. This PR does not execute/replay commands, send queue ACKs, attach the queue hook, or implement guest recipient acceptance. Tests prove separate invocations reread current state, not an end-to-end command replay.

#361/#365/#379 own mixed legacy/bootstrap and recipient integration. #376 still owns supported REST/MCP reads/writes/presets, authenticated developer grants/projections, strict registry schemas, status mapping, generated docs and smoke coverage before exposure. No operation was registered here, so OpenAPI/agent discovery stays unchanged. Use #360/#382 `getStorageCompletion` for independent completion integration; no new completion formula is introduced. The canonical docs metadata follow-up already tracked on #376 is unchanged.

077 remains the recovery authority. #383's 078 follow-up adds exclusive full-Dex/4,096-slot forward admission with bounded evidence, leaving ordinary batches unchanged. Oversized retained payloads, latency, mixed legacy default replacement and auxiliary recovery remain unresolved. #394/#396/#379 audit/recovery/compatibility and enabled rollout gates remain required. Activity is already delivered separately; this adds no activity/marketing/Framer work. Parent owns exact-head review, serialized merge and production verification.

## Verification boundary

`tests/inventory-server-read.test.ts` uses the installed real Supabase client with a synthetic fetch-backed PostgREST transport and session stubs. It exercises emitted HEAD/count/select/filter/order/keyset/limit request shapes and actual domain mapping, >1,025 items/slots and collections, all supported grading providers/custom metadata, unknown printings, empty/spacer collections, partial/duplicate/inconsistent streams, independent revision/metadata changes, current partner/unlink/billing/stranger scope, forged owner options, denied schema/queries and request/deadline budgets. `tests/slot-snapshot.test.ts` covers cursor cycles and 074 token conflicts. This is local query-shape/completeness proof, not hosted permission/load/performance or enabled-production proof. Those server-reader tests claim no hosted read/write, migration, conversion, dump or enabled UI proof. The browser transport proof below is separate.

## Private browser transport, still behind #379

`handleInventoryCompleteRead(request, client?)` in `lib/server/inventory-read-http.ts`
implements the reusable first-party GET handler. **No production route invokes it**:
`/app/api/inventory` and `/app/api/binder-slots` still return unconditional 503 for
all staged methods. There is no environment, body or role bypass. Direct handler
tests and the synthetic local browser proof exercise the handler without opening
those routes. No command execution, BinderApp/dock/navigation integration, grant,
conversion, migration or hosted access is part of this slice.

The handler calls `readOwnerInventoryState`, the same authoritative cookie/RLS
reader underlying `readOwnerInventorySnapshot`. Its no-client path creates the
standard request-scoped server client; the optional client is trusted server/test
injection only, never HTTP input or an admin client. The reader now also requires
and fences the verified JWT `session_id`. Actor, owner, partnership, billing and
that authenticated session are rechecked before publication, including a same-user
session replacement. Existing deadline, retry, request budget, incomplete-legacy,
uninitialized-owner and conflict behavior remain in force.

The strict version-1 envelope contains:

- `requestId`: the current browser invocation's unpredictable nonce.
- `scope`: the server-resolved `actorUserId`, `ownerUserId` and verified
  `authSessionId`, plus the echoed device lifecycle `sessionId`.
- `evidence`: the fenced owner revision; independent HEAD counts for items,
  placements, storage states, binders and total slots; per-storage independent
  slot count, collection version and layout revision.
- `snapshot`: the canonical private inventory domain projection, including
  recorded grading/certificate/holder/opaque asset IDs and preset provenance.

GET accepts exactly one `requestId` and `sessionId`, with no owner/actor parameters.
Both request fields correlate the reply; neither authenticates anything. Responses,
including failures, use `Cache-Control: private, no-store`, `Vary: Cookie` and
`nosniff`. Raw database details are never returned. Safe public/share projections
remain separate. The app entitlement is current owner/partner access, not paid
developer access. API keys and OAuth MCP sessions cannot invoke this boundary.

`fetchCurrentInventorySnapshot(currentScope)` is the actual browser adapter. Its
fixed same-origin `/app/api/inventory` fetch uses same-origin credentials,
`cache: "no-store"`, redirects rejected, and a 30-second client deadline. The auth
host must supply a live scope getter from its authenticated lifecycle, including
the verified auth session ID. Rotate the in-memory lifecycle ID on signout,
account/owner/membership changes and unlink/relink, including a return to the same
IDs. No lifecycle identifier or complete capability is restored from localStorage,
IDB, history, a command receipt or a caller-supplied owner selection.

The adapter checks its current scope after HTTP, after JSON and before/after
branding. It validates the exact envelope version, nonce, scope, canonical domain
shape/bijection, every independent count, and collection/layout versions. It
rejects cacheable, redirected, wrong-session, wrong-owner, partial or malformed
responses. Shape validation is not authentication: only this invocation's
cookie-authenticated same-origin response supplies the evidence. The exported
wire parser alone never creates a complete brand.

### Read-start sequencing and offline behavior

The shared complete reader now accepts a promised fenced revision. It reserves its
process-local read-start sequence synchronously **before** the browser fetch and
before waiting for HTTP/JSON, then consumes the server's independent evidence.
JSON is never cast to `CompleteInventorySnapshot`; the existing complete-stream
validator reconstructs it. Downloaded array lengths are compared with server
counts, never used as their own assertions. A successful command response's queue
fence therefore rejects both a cached complete object and a read already in flight,
even when its JSON arrives later with sufficiently new revisions. Every invocation
uses a new nonce, so replaying an older authenticated HTTP body also fails.

Results are `{status: "complete", scope, snapshot}` or honest
`{status: "conflict" | "unavailable", code}`. The existing public 503 reports
`inventory_operations_staged`; it cannot manufacture empty ownership. Network,
permission, conversion or session failure does not mutate the queue. The eventual
queue adapter must pass only a successful result's snapshot to its current-session
read callback, after the matching successful command reply, retaining all pending
intent on other results. That production execution/binding is still #363/#379.

The service worker explicitly bypasses both private path families, including
image-like subpaths and warm-up messages. All cache helpers reject `private` or
`no-store` responses. Cached safe subsets remain subsets and cannot reconstruct
completeness; offline failure retains saved ownership and queued intent.

### Canonical metadata limits

The wire contract deliberately transports the current reader's existing domain
projection without inventing metadata. Migration 083's private custom-storage
`location` is **not read or represented** by this domain snapshot. Binder grid
settings, catalog association evidence, full export/source metadata and asset
bytes are also absent. Omission means unsupported, never `null`, a guessed grid,
a portable backup or proof of no recorded location. The complete brand proves the
inventory/placement/ordered-slot domain only. It is insufficient by itself for
navigation page/grid evidence or a lossless 083 export. #376/#379 must resolve those
read/projection gaps before binding those capabilities; #365 retains export scope.

This is app-only internal transport preparation. Supported REST/MCP registry
operations, authorization/projections, generated OpenAPI, Markdown/LLM discovery
and external smoke gates remain #376; none is registered or newly advertised here.
#379 remains the exposure/conversion authority. [Unpublished release copy](releases/inventory-complete-read-draft.md)
belongs to that eventual feature block. Issues stay open and parent owns review,
merge and release.

### Local proof

`tests/inventory-read-transport.test.ts` directly exercises the real handler,
authenticated actor/partner resolution and server reader through synthetic
Supabase auth/PostgREST. It crosses JSON serialization and tests >1,000 records,
interrupted pages, legacy/uninitialized/denied state, independent counts/versions,
malformed owner/session/nonce/version replies, HTTP/JSON session teardown,
cache/replay rejection and read-start sequencing. Existing server/pagination/queue
regressions remain independent checks.

`bun scripts/verify-inventory-read-browser.ts` bundles the actual browser adapter
and sole queue, then runs real Chromium fetch/JSON/IndexedDB against that real
handler with synthetic authentication/tables. It proves cached and pre-command
in-flight reads retain intent, a genuinely fresh read ACKs, lifecycle swaps reject,
and offline failure/reopen retains saved ownership and the queue. It is synthetic
transport/storage proof, not real hosted authentication/RLS, installed-PWA,
physical-device or enabled production UI proof. It also serves the actual worker
on an isolated loopback origin: private fetches bypass a deliberately seeded
stale cache, private warm-ups perform no fetch, and offline reads fail rather
than returning that cached subset. This is controlled SW privacy proof, not
installed-PWA navigation. No full e2e is run.
