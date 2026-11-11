# Internal authenticated complete inventory reads

`lib/server/inventory-read.ts` exposes `readOwnerInventoryState(client?)` and `readOwnerInventorySnapshot(client?)`. They return the branded `CompleteInventorySnapshot`, the navigation evidence (catalog and grids) and the read scope. `GET /api/inventory` (`lib/server/inventory-read-http.ts`) serves the same result as the private v2 envelope.

## One call, one snapshot (migration 107)

The read is a single PostgREST call to `inventory_read_v2()`. It is `STABLE`, so every query inside it sees the same MVCC snapshot: counts, revisions and rows can't tear, and there are no fences, retries or request budgets in the app.

- `inventory_read_scope_v2()` (SECURITY DEFINER) checks the caller: the `authenticated` role, `sub` matching `auth.uid()`, no OAuth `client_id`, a live `auth.sessions` row for the JWT `session_id`, and a user that isn't deleted or banned. It then resolves the partnership (more than one is unavailable, a malformed one is forbidden), checks `billing_partner_allowed(owner, actor)` and picks the owner. A billing-paused partner reads their own collection; an owner is never paused into a fallback. It also returns the owner's grid settings, which a partner can't read under `user_settings` RLS.
- `inventory_snapshot_v2(owner, 'all')` (SECURITY INVOKER, so RLS still decides what the caller sees) returns the owner revision, collections (binder and storage state joined, each with its ordered slots), items, placements, and the public mirror rows for every card id the snapshot names: exact `tcg_cards` ids first, then catalog canonical or alias ids (indexed in 103), plus their dex links and sets.

The app still normalizes every row with the domain normalizers (`lib/server/inventory-read-core.ts`), builds the catalog evidence in `lib/server/inventory-read-catalog.ts`, and brands the result only after the shared owner-wide item/placement/slot bijection check in `readCompleteInventorySnapshot`. Legacy provenance (`binder_legacy_rows`, `inventory_items.legacy_source`) is never read or returned.

An absent owner state is a complete revision zero only when the same snapshot holds no collections, items or placements; otherwise it's `inventory_not_initialized`. A binder without its native storage row (or the reverse) is also `inventory_not_initialized`.

| Code                         | Status | Meaning                                                                                       |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `inventory_sign_in_required` | 401    | no current first-party session (including anonymous callers, who aren't granted the function) |
| `inventory_read_forbidden`   | 403    | membership or billing access refused                                                          |
| `inventory_not_initialized`  | 503    | stored rows without a native owner root, or a half-initialized collection                     |
| `inventory_read_unavailable` | 503    | anything else, including malformed rows; raw database messages never cross this boundary      |

Developer native reads (`lib/server/operations/native-developer-read.ts`) call `developer_inventory_read_v1(...)` instead: one service-role call that rechecks the API key (or the live OAuth session and grant), the user, partnership and billing, and reads only the part the operation needs (collections, one collection's slots, items, or one item) from the same function.

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

The strict version-2 private envelope contains:

- `requestId`: the current browser invocation's unpredictable nonce.
- `scope`: the server-resolved `actorUserId`, `ownerUserId` and verified
  `authSessionId`, plus the echoed device lifecycle `sessionId`.
- `evidence`: the fenced owner revision; independent HEAD counts for items,
  placements, storage states, binders and total slots; per-storage independent
  slot count, collection version and layout revision.
- `snapshot`: the canonical private inventory domain projection, including
  recorded grading/certificate/holder/opaque asset IDs, preset provenance, 083
  location, immutable item `legacySource` and slot legacy-row ID/source JSON.
- `navigation`: bounded public mirror catalog DTOs and grids fenced with the
  private snapshot. This is private transport, not a share/export schema.

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

### Canonical metadata and navigation adapter

`readCurrentCollectionNavigation(liveScope)` in
`lib/collection/inventory-navigation-read.ts` directly implements the existing
host's `readCurrent` callback, e.g. `readCurrent={() =>
readCurrentCollectionNavigation(liveScope)}`. Initial loads may use
`fetchCurrentCollectionNavigationRead` to handle its explicit complete/conflict/
unavailable result. Both invoke the actual browser complete reader, retain its
pre-fetch sequence and nonce/session checks, and recheck scope before returning.
The throwing callback preserves failure status/code in `CollectionNavigationReadError`;
the host's existing failed-refresh handling remains authoritative. Neither adapter
accepts arbitrary JSON, a retained command reply, localStorage or a cached subset
as complete evidence. No host/BinderApp/dock integration is enabled by this slice.

Grid evidence comes from the current binder's `binder_rows`/`binder_cols`, inheriting
each unset dimension from the resolved owner's `user_settings`, then the existing
`settingsFromRow` defaults (currently 4×4) when that row is known absent. The reader
uses `withBinderLayout`, not a cached UI grid. It includes binder override values,
settings values and their update timestamps in before/after metadata fences, after
catalog work too. A changed setting/layout/revision retries the entire read under
the existing attempts/deadline/request budget, then returns conflict. Missing or
invalid dimensions omit that layout, so location pages remain unknown.

### Narrow partner grid boundary (086)

`public.inventory_grid_read_v1()` is a no-argument, STABLE security-definer RPC,
explicitly executable only by `authenticated`. It derives actor from `auth.uid()`
and verifies the active authenticated role, matching first-party JWT subject, live
`auth.sessions` row, expiry and non-OAuth session. It resolves zero or one current
partnership and checks the existing `billing_partner_allowed` app policy. Ambiguous
or malformed membership, revoked/expired/unlinked former-owner access, MCP OAuth,
API keys and unsupported roles cannot authorize another owner's grid. An unlinked
actor can only read their newly resolved own grid, which conflicts with the old
owner scope in the reader. No caller-supplied owner or actor is accepted.

The exact internal JSON result is `{owner_user_id, partnership, settings}`.
`partnership` is null or `{id, owner_user_id, user1_id, user2_id}` for membership
comparison; `settings` is null **only when the resolved owner row is absent**, or
`{binder_rows, binder_cols, updated_at}` from that actual row. No other settings,
credentials, account metadata or private helpers are exposed. Existing table RLS,
table/column ACLs and prototype/executor privileges are unchanged. This read
performs no mutation, lock-based execution, ledger write or audit event.

The existing metadata reader invokes this RPC through its cookie/RLS client. It
compares resolved owner and every membership field with the initial scope, validates
the result shape, and fences current grid values/existence/timestamp before and
after catalog work under the same read deadline, request budget and whole-snapshot
retry limit. Invalid dimensions stay unknown; partial/malformed RPC envelopes fail
closed. Each binder override still wins independently. Proven row absence permits
only `settingsFromRow`'s canonical current defaults (4×4), never guessed 3×3 or the
partner's own preferences. The actual JSON/browser/navigation adapter now resolves
stable-ID pages for inherited partner grids without any host or route enablement.

If 086 is not installed (`PGRST202`, or `42883` naming this exact missing RPC), the reader retains 439's safe table-read
behavior: owners can prove absence, partners cannot; fully explicit binder grids
remain usable. Auth/permission/query failures never trigger that compatibility path.
The RPC comparison evidence stays server-side; private wire v2, nonce/JWT/device
lifecycle and pre-network read-start identity are unchanged. Public slot/inventory
routes remain unconditional 503 until #379. This app-only RPC is not a supported
REST/MCP registry operation; those credentials still require #376's dedicated grants
and projections. No OpenAPI regeneration is needed.

086 is reserved for this lane; 085 belongs to default recovery. Parent owns fresh
backup, exact-head review, serialized **085 then 086** hosted application, release
and production verification. No hosted access/application or publication was done
in this implementation lane. The private socket proof uses port 55587 in a new
local cluster, replays all available earlier numbered migrations and applies 086
twice, checks owner/partner/stranger/anon and membership/session/billing changes,
compares existing definitions/ACLs/RLS/data, and verifies denied private executors.
The synthetic-auth browser proof covers inherited pages, per-binder overrides,
concurrent grid/membership rejection and 435 cached/inflight/offline/SW regressions.
085 was not yet published into this dependency base, so combined 085→086 replay
remains the parent's serialized integration proof. No full e2e or hosted proof.

Catalog evidence reads only public `tcg_cards`, `tcg_sets` and `tcg_card_dex_ids`
through the same RLS client, using actual item/target/wanted printing IDs and
canonical/alias metadata. No inner Pokémon join excludes Trainers/Energy.
Confirmed translations establish language; species names come only from mirror
dex links and known local species. Missing/incomplete/ambiguous catalog entries
remain unknown. Public mirror reads have no owner predicates and no shared private
cache: this implementation does not introduce catalog caching. A future public
cache must contain only public mirror DTOs, never owner snapshots or layouts.
ID batches are 100; keyset/range pages are at most 500, including dex associations.
Alias misses use bounded ambiguity probes and the same total request/deadline
budget; excessive unknown IDs may honestly report unavailable rather than bypass
that budget. No upstream lookup, sync or backfill runs.

Private metadata preserves canonical kind/default presentation, copied manifests,
entry/source identities and complete immutable `inventory_items.legacy_source` and
`binder_legacy_rows.source_row` JSON. Legacy rows are independently counted/paged,
validated against slots, and compared again before publication. Item provenance is
fenced with item/owner revisions. Source normalization preserves unknown JSON keys,
duplicates and nulls with a 10,000-value/30-depth per-source budget; unsupported
values reject rather than strip. `location` follows 083: null or trimmed 1–200
characters on custom storage only. On old canonical snapshots, omitted location or
source means unknown, distinct from a newly read explicit null.

The private wire version is now **2**; v1 responses fail closed rather than
pretending to contain navigation/083 evidence. This is not a supported REST/MCP
version change. JSON-v2 backups accept these optional canonical fields and retain
them without a format-number change; old files still parse, older strict readers
reject files carrying the new fields. See [backup compatibility](binder-backup-v2.md).
The read still does not package appearance/settings exports or private asset bytes
and is not itself a full portable backup. No restore executor is added.

Private location/source fields never enter Inventory's safe rows or existing
`publicCollectionItems`/named/token share projections. The public share serializers
are unchanged; the complete private snapshot must never be spread into them.

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

Navigation-extension verification adds `tests/inventory-navigation-read.test.ts`:
current partner scope with owner-only settings RLS emulation, per-dimension grids,
settings changes during reads, unknown grids, source/location/preset JSON-v2
round trips and public redaction, non-Pokémon/catalog gaps, >1,000 IDs and dex links,
source interruption/fences, old wire rejection and real handler→JSON→navigation.
The same Chromium script now also calls the actual host adapter for owner/partner
stable-ID page resolution and private metadata, retaining its cached/in-flight
ACK, nonce/session and offline/SW regressions. No UI files changed, so no six-phone
UI matrix or full e2e was run for this extension. Hosted authentication/RLS and
production/installed-PWA behavior remain unverified.

Local extension checks: 1,435 unit entries across 270 files passed; after the final
adapter guard/source lookup edits, 140 affected tests across 11 files passed.
Full typecheck and production build passed, full lint retained the existing
55-warning cap, and focused lint reported zero warnings. The Chromium script
passed all four ACK/session/offline scenarios plus actual owner/partner navigation
and the real service-worker privacy proof. This is local synthetic read evidence,
not hosted RLS/load or production enablement proof.

Parent catalog regression: fallback alias/canonical probes page every matching row using stable ID keysets within the existing budget, before language-specific resolution. A later matching printing cannot be hidden by a two-row probe; missing/rejected later pages fail instead of publishing partial catalog evidence. Both 501-row alias/canonical regressions failed on the original source and pass after the fix. Parent verification:54 focused tests, actual Chromium/IDB/SW proof, typecheck, lint at55 existing warnings and production build. No hosted authentication or enabled runtime proof.

Partner-grid 086 checks: 74 focused tests across eight files passed, including the
opted-in private SQL proof with 82 prior numbered files replayed and 086 applied
twice. Full unit run: 1,449 passing entries across 272 files (socket-only tests
require their opt-in environment; the 086 database proof was run separately).
Typecheck, production build/docs CSS, full lint at the unchanged 55-warning cap
and focused zero-warning lint passed. Real Chromium with synthetic authentication
proved owner inheritance plus per-binder overrides, catalog-time grid/non-key
membership conflicts and the unchanged 435 cached/inflight/session/offline/SW
regressions. No UI matrix, full e2e, hosted access/application or production claim.

The [first-party browser command transport](browser-command-transport.md) now invokes this actual private read handler from the loopback/server-gated HTTP harness after a matching command receipt. The browser starts its own all-stream reconstruction after that reply and the queue checks its start fence, scope/lease and returned commit-revision lower bound before ACK. A cached IDB snapshot or synthetic ledger receipt remains insufficient. Production read routes and admission remain denied; this local synthetic proof does not establish hosted auth/RLS, conversion or installed-PWA relaunch.
