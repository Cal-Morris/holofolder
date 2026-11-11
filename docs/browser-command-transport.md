# First-party browser command transport, still denied in production

Related: #363, #383, #376, #379. No SQL, grants, hosted operation, conversion, admission or supported public API change. Legacy Activity/Undo remains separate and unchanged.

## Actual path

The admitted local BrowserCollectionSession owns one sender above view remounts. Real layout/picker commands enter the existing IndexedDB queue. Its existing head lease calls `sendStorageCommand`, then POST HTTP calls `handleStorageCommand`, then `executeAppStorageRequest` and the existing `storage_execute_v1` bridge. The projected receipt returns through the HTTP adapter. Only then does the queue start `readCurrentCollectionNavigation`, using the authenticated all-stream complete-read handler and existing browser reconstruction. A matching operation reply plus current scope, lease, complete-read start fence and a snapshot revision at least the receipt's committed root revision permit ACK. Ledger JSON never becomes a complete snapshot.

Default transport paths remain `/app/api/binder-slots` and `/app/api/inventory`, which are unconditionally denied. The local host instead selects `/app/e2e-harness/storage/slots` and `/app/e2e-harness/storage/inventory`. That handler requires HOLOFOLDER_E2E=1, a non-Vercel loopback host and a synthetic fixture cookie. It has no connection to configured Supabase and uses in-memory synthetic Auth/PostgREST/ledger responses. It exercises the actual handler, bridge, strict command parser, RPC builder, safe receipt projection, all-stream/count/revision read, client reconstruction and actual browser IndexedDB. It is not SQL execution, hosted authentication/RLS, installed-PWA, physical-phone or deployed-main proof.

The harness fixture supports the tested slot-create flow. It is not an alternate production store, SQL executor or inventory command implementation. The actual inventory transport uses the same bridge; real SQL inventory selection/move/delete and recovery proofs remain the existing owning suites and parent integration gates.

## Private HTTP contract

POST only. Requires JSON, a nonempty same-origin Origin or the existing explicit holofolder.com → app.holofolder.com proxy origin, no cross-site fetch metadata, `X-Binder-Owner`, `X-Binder-Auth-Session` and `X-Storage-Operation`. The operation header must match the original parsed request's operationId. Body is exactly the existing slot/inventory command, never a queue envelope, actor, source, session or arbitrary audit context. The owner header is a comparison fence. The checked Auth user must match checked JWT sub/session and cannot be OAuth. Membership, owner, version, predicates, finite payloads and billing remain enforced through the existing bridge and transaction. The SQL wrapper's recheck remains authoritative under membership/billing races.

Success is `{version: 1, operationId, receipt}` with the existing safe operation receipt. No snapshot, private executor evidence or certificate is returned. Responses are private/no-store, vary Cookie and disable MIME sniffing. Errors use existing redacted developer errors/statuses. The handler intentionally does not enable CORS or expose REST/MCP credentials as app sessions. Strict command limits and the sole existing large-delete exception are retained.

Original queued operation/item/slot/copy/target predicates and provenance remain immutable on device. Only the original command request is uploaded. The trusted bridge derives actor and source app from authentication, batch ID from the original operation ID, client ID null and clientOccurredAt null, as before. Device provenance is not authenticated audit evidence, and this slice does not relabel earlier intent as the actor who originally created it. Replays require the current actor/membership/billing, and preserve immutable SQL ledger/audit receipts.

## Lifetime and errors

The host schedules only the persisted head, using the existing 60-second cross-tab send lease, due time, bounded five automatic attempts and backoff. New enqueues are noticed by the session sender. Hidden/offline sessions start no new sends; foreground/reconnect resumes eligible work. The existing authenticated scope getter rejects changed account, owner, JWT session and lifecycle epoch. Layout-effect teardown aborts the HTTP wait; the queue's epoch/scope/lease checks reject late work. Abort or lost reply means unknown outcome, not rollback. Reload keeps the sending lease until expiry, then repeats the exact ID/body. Explicit Retry preserves identity and never steals a live lease.

Refresh does not replace a pending queue baseline with a remote snapshot that may already include an unknown commit. Only replay ACK owns that transition. Concurrent refresh blocks new local acceptance until it completes, retaining the UI's unaccepted draft on failure. Cached views remain visibly cached.

402 pauses billing; 400/401/403/404/405/413/415/422 block visibly and retain intent. Other failures, malformed/mismatched/reordered success, 5xx and failed/stale/obsolete complete reads remain unavailable with no ACK. Permanent body/media errors no longer consume automatic retry attempts indefinitely.

409 retains the original ID/request. [Migration 089 and native reconciliation](native-command-reconciliation.md) add a committed terminal outcome in the existing lifetime ledger plus durable scoped fresh-read review. Ordinary `storage_conflict` errors still prove nothing about noncommit and only permit exact retry. Public admission remains disabled.

## Narrow shared changes and remaining gates

Two concrete queue gaps required additive changes: compare fresh reads against the returned commit revision, and classify permanent HTTP body/media/method errors as blocked. The queue/store identity, existing reconciliation, replay and cancellation fences are unchanged. The trusted bridge accepts typed server-only local clients to test the actual HTTP path without hosted reads/writes, and checks the expected JWT session against its authenticated actor. No request can provide these client capabilities.

Supported REST/MCP registry/dispatcher, generated OpenAPI, startup/bootstrap/offline shell and scanner lanes remain untouched. Current user help is `content/docs/bulk-layout.mdx`; unpublished release copy is in `docs/releases/browser-command-transport-draft.md`. No public endpoint is advertised, so no generated API change is warranted.

Before enablement: parent independent review and exact-head CI; independent review and hosted proof of 089 rejection/current-state binding; full native recovery/Undo; #376 public API parity/docs; #379 admission, old clients/SW/queues, startup/offline relaunch, sharing/consumers and representative conversion/count/digest proof after a fresh restore-verified backup; authenticated owner/partner/billing and current-membership races through hosted PostgREST; installed-PWA/physical-device proof; serialized merge and deployed verification. Retained snapshot/receipt growth remains a device-pressure gate. Existing native zero-conversion state and staged public routes remain unchanged. Issues stay open and marketing remains unpublished.

The queue hook also accepts a live host validity predicate during replay. Its final IndexedDB transaction checks that predicate alongside the existing hook epoch, closing the interval between immediate auth/membership invalidation and the next React remount. Cached/refreshed catalog evidence stays in the current host ref for dependent optimistic reprojection. These are additive integration fences, not new identity or storage authorities.

### UI review

| Before                                                | After                                                                       | Why                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| Saved intent had no sender or retry control           | Existing Pending sync status plus a minimum 36 px Retry pending sync button | Device commit and remote ACK stay distinct               |
| Unavailable commands had no current error explanation | Billing/access/conflict explanations retain the original edit               | A failed send must remain visible and recoverable        |
| Host replay scope depended only on the hook remount   | Live host invalidation also fences the final transaction                    | Auth callbacks can invalidate scope before React commits |

No overlay, animation, gesture or public collection layout is introduced. Existing sheet/dock dismissal and navigation regressions stay in the affected host matrix. Stress states include stale/reordered receipts, long conflict explanations, billing/access failures and unknown outcomes at the three phone widths with emulated standalone insets. Installed-PWA/physical-device proof remains separate.

### Final local proof

- 99 focused unit/contract cases passed across 15 files, including the actual HTTP/bridge/read subprocess, canonical Framer proxy-origin regression, queue/receipt revision and complete-read fences, browser transport, navigation and current docs, plus unchanged first-party Activity/legacy Undo and audit-context regression suites.
- `E2E_BASE_URL=http://localhost:3529 bun run test:e2e:matrix e2e/browser-command.e2e.ts e2e/browser-host.e2e.ts --workers=2 --max-failures=1`: 126 passed across all six phone profiles. Real IndexedDB covers committed lost replies, crash/reload with retained send lease, same-ID replay, reordered replies, fresh-but-stale snapshots, signout/account/owner teardown, 409 refusal, offline reconnect and explicit billing/access retry. Existing host navigation/dock/overlay regressions also pass. Retry tap targets are at least 36 px; no horizontal overflow.
- `node scripts/verify-slot-offline-storage.mjs`: all six real Chromium/IDB contexts passed commit/abort, two tabs, offline reload, 503 and legacy preservation.
- Typecheck, production build and full lint passed, with the existing 55 warnings and no changed-file warnings. Supabase was pointed at synthetic local transport; no hosted access or actual SQL was used. No full e2e.
- With HOLOFOLDER_E2E=0 on this lane's separate local port, harness GET/POST returned 503, as did unchanged public inventory GET and slot POST. Only this lane's servers on 3529/3530 were started and stopped.

These checks establish the hidden synthetic integration only. Independent parent review, current-head CI, serialized merge and deployed verification remain pending. No issue is complete and no release copy is published.
