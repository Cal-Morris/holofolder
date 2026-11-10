# Synthetic-only legacy queue integration

This coordinated Tasks 2–3 slice of #363/#379 uses PR500's engine at main
`31c26d5be9208a5ee2fa405db636ac5a26f30ee6`. It is **disabled in production**.
Only `/app/e2e-harness?durableQueue=1` supplies `stagedDurableQueue`, using the
existing `canShowInventoryHarness` admission: explicit synthetic E2E build,
loopback host, no Vercel environment. Production bootstrap and offline shell
never supply it. It adds no environment variable or rollout framework.

The admitted hook/review path has one queue writer and one claimed sender.
Initialization reads the exact old LS queue and old `collection` record in the
engine transaction, independently of snapshot fallback or the old migration
marker. The updated path never restores an old mirrored queue, writes operations
to LS, or writes `collection.pendingOperations`. Snapshot-only writes preserve
that field. Malformed historical mirror records stay completely untouched so a
late variant cannot lose its original snapshot or metadata before observation. They cannot overwrite the v2 key.
The production path continues using the old queue until the parent owns a safe
cutover. Removing its existing runtime now would itself change live behavior.

Old LS oldValue/newValue observations, current strings and late mirror variants
are appended as evidence at startup and storage/pageshow/focus/visibility resume.
Old `[]` cannot acknowledge current entries. BroadcastChannel and local events
carry a change signal only. Exact scoped views are reread; no message carries
private data. Unobserved overwritten old bytes remain unrecoverable.

All existing edit methods converge on commitItemChange. In the admitted path it
awaits enqueue before updating UI/snapshot, notifying or invoking the sender.
A failed transaction leaves the prior UI intact and retains a visibly unsaved
in-memory draft for explicit retry in the same lifecycle. This draft cannot send
or serve as queue authority. No memory/LS persistence fallback exists. A failed
view read after a committed enqueue does not undo that commit or manufacture a
second intent; the committed operation remains recoverable.

Immediate and background delivery both call `LegacyQueueRuntime.flush`. Every
send uses exactly the request returned by a committed claim, with captured IDs,
recipient, acquisition and base presence. It rechecks the current session after
claim and before settlement. Cross-tab claims serialize in actual IDB. ACK and
local completion commit before UI/billing/broadcast callbacks. Another binder's
reviewed action uses the same claimed sender with the same actor/owner and a
binder-specific engine facade, never a new uploader or a default recipient.

Guest workspace identity is allocated once in the envelope, reusing an existing
LS hint when available. Never-sent guest drafts can be retained transactionally
as original source evidence for explicit account review. Login never claims
guest entries. Acceptance still checks exact source bytes, epoch/revision,
actor/owner/session and destination base; accepted ordinals and linked actions
commit together. Cancellation pauses only remaining ready batch actions. Frozen
sending/unknown evidence cannot be rewritten. Bound migrated account requests,
nested/divergent sources, unknown acquisitions and mirror-only input remain
paused. A foreign-owner mirror snapshot is retained internally but excluded from
scoped download views, as are nested foreign-account originals.

Known row conflicts are conservatively retained and paused with the rejected
frozen request. This slice deliberately adds no conflict rebase, retry or lost
response reconciliation API. Network/unreadable/unclassified responses become
unknown. Lease expiry cannot authorize another attempt, and reviewed-batch
siblings pause atomically. The corrected PR500 compatibility settlement/review
barrier and complete-entry privacy checks remain active.

Parent review closed two additional races: cancellation is unavailable during
the acceptance transaction, with the accepted batch handle retained even if its
review sheet closes; a sending reviewed item blocks later claims in the same
exact-origin batch until its local settlement commits. Thus an ACK persistence
failure cannot send its next reviewed sibling before lease expiry. The original
request stays frozen; expiry marks it unknown and pauses ready siblings. Browser
transaction and six-phone acceptance tests cover these boundaries. Dismissal
does not cancel an already accepted upload, and cancellation cannot undo a sent request.

## Required parent-owned trusted server adapter

No private context/audit semantics, route rejection, SQL or public API schema
changes are made here. New synthetic claims freeze `X-Holo-Legacy-Queue: 2` in
the transaction; historical unversioned frozen requests remain valid evidence
and are never rewritten or replayed to add that header. The current frozen transport
continues using existing POST/DELETE recipient, operation-ID, acquisition and
base-fingerprint contracts. PATCH reviewed-base CAS remains unchanged.

The parent server-adapter contract is now agreed against merged 096: after existing
first-party authentication, exact recipient and protocol-header validation, only
the service-generated trusted audit context may carry `source:"app"`, numeric
`legacyQueueGeneration:2`, and `purpose:"legacy.queue"`. Existing CAS, actor,
owner/binder membership and audit attribution remain unchanged. A raw browser
body/header never supplies trusted context. The parent owns the disjoint
`audit-context`, first-party route, shared collection kernel and error adapter;
this slice leaves those files untouched.

096's SQL `PT503` / `legacy_collection_write_paused` / `retainOnDevice=true`
failure is mapped by that server lane to HTTP503
`{ code:"collection_queue_upgrade_required", retainOnDevice:true }`. The claimed
sender recognizes only that retention-safe first-party shape as known
nonacceptance, retains the exact frozen request and pauses the entry and ready
review-batch siblings. The existing remote/recipient classifier also retains that
code. It never ACKs, drops, retargets or automatically retries it. Unmapped,
incomplete, unreadable or generic wrapped failures remain unknown. A later
rejection cannot prove a prior lost response was rejected.

The parent reports 096 applied hosted inactive after PR501, with enforcement
still false. No adapter in this slice emits the trusted fields. Missing headers
stay compatible/untagged under the parent adapter while the DB fence is inactive;
no reject-only production fence is installed here. The parent must independently
review/integrate the server adapter, verify authorized REST/MCP, exact private
recovery/lifecycle exceptions and public forwarding/downgrade behavior, then
serialize activation and in-flight drain before production sender admission.
The DB fence remains active during any later rollback; delivery is paused.
Installed-device/hosted receipt proof remains separate. A browser header,
operation ID, lease, matching row, Activity entry or generic app audit value is
not a trusted generation attestation or durable server receipt.

## Verification boundaries

Focused unit suites, `scripts/verify-legacy-queue-storage.mjs` and affected
six-phone host/review tests exercise the real hook and real IDB, transaction
abort/quota, competing connections, stale session/recipient callbacks, explicit
guest/history review, privacy, compatibility, old sources, offline hydration,
unknown successors and cancellation. The existing native storage runner protects
the shared IDB primitive. No full e2e suite, hosted mutation, production admission,
installed-device crash/eviction, power-loss guarantee or server receipt proof is
claimed. Public REST/MCP schemas and current user help continue to describe the
live disabled boundary; this is an internal device persistence integration.
