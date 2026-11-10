# Trusted storage execution bridge (082, internal only)

Related: #362, #383, #396, shared conventions #376; exposure gate #379.

This slice implements an internal authenticated server path for existing parsed slot/inventory commands and recovery preview/confirmed apply. It does **not** expose an endpoint, registry operation or MCP tool. `POST /app/api/inventory` and `/app/api/binder-slots` still return their unconditional 503 staging responses. No environment bypass exists. Existing public API, generated OpenAPI, help and agent capabilities remain unchanged. There is no customer release or Framer publication for this hidden slice.

## Concrete boundary

`lib/server/operations/storage-execution.ts` provides:

- `executeAppStorageRequest(request, operation)`: first-party verified claims plus fresh Auth user, same-origin write check, current collection membership, mandatory `X-Binder-Owner` comparison, bounded JSON reading and strict intent parser. The owner header only detects a changed recipient; it never establishes identity or ownership.
- `executeRestStorageRequest(request, operation)`: existing API-key authentication, expiry/revocation, scopes, paid developer access and budgets, then the same internal operation.
- `executeMcpStorageRequest(request, operation, input)`: existing OAuth authentication, revocation, scopes, paid access and budgets, then the same operation. OAuth tokens cannot become website sessions or REST API keys.
- `executeDeveloperStorageOperation(context, operation, input)`: the existing shared operation convention, accepting **only server-created** `OperationContext` from REST/MCP authentication. Registry dispatch can reuse this after authenticating. A JSON-shaped context is not authentication. All four operations require `collection:write` and `binders:write`: inventory/recovery can delete/restore collections, and slots can change wanted entries or release placements. Recovery preview deliberately requires the same authority as apply, and consumes the write budget.

The RPC has a server-owned 10-second abort signal, in addition to finite SQL work/evidence budgets and 3-second lock timeouts. Cancellation or a lost response is an unknown outcome, never proof of rollback: preserve the original intent/ID, retry it and reconcile fresh state. SQL function-local timeout settings alone do not establish an outer statement deadline; production PostgREST cancellation/statement-budget behavior remains a #379 verification gate. Local SQL proof establishes its outer statement deadline before invocation.

Each path uses the service-key Supabase client and its existing trusted fetch hook, never a direct PostgreSQL client. `withAuditActor` derives actor/source/credential from authentication. `withAuditOperation` binds the parsed original operation ID, preserving AsyncLocalStorage isolation and overriding no caller headers. The admin fetch deletes any supplied audit header before generating its own. `source`, actor, client ID, owner, timestamps and arbitrary metadata are forbidden in command bodies. Queued actor/source/header/GUC values have no authority here.

`public.storage_execute_v1(operation text, owner_id uuid, request jsonb)` is the sole new service-only SECURITY DEFINER entrypoint. It requires active `service_role`, derives actor/source from the existing trusted server header, locks/rechecks current membership **before** owner advisory locks, checks the currently resolved owner and partner billing, and enforces subscription/lifetime developer access even if app billing enforcement is disabled. Trials do not grant developer access. Ordinary runtime roles cannot invoke it. There are no new grants on any existing prototype or private helper, and no table, RLS or existing function changes.

The service key remains a trusted server capability. A party possessing that key can generate server headers; this is not a sandbox against a compromised service. Permission/credential authentication occurs at the server boundary, membership/billing/constraints are rechecked in SQL. An ordinary authenticated/anonymous/MCP database role cannot use a forged header or caller GUC to become the service role.

## Intent, receipts and replay

Operation names are internal `inventory`, `slots`, `recovery.preview`, `recovery.apply`, chosen by trusted routing/dispatch, never a public arbitrary executor.

Inventory and slots reuse `parseInventoryCommand` / `parseSlotCommand` and the existing version/layout/placement preconditions and SQL transaction ledgers. Ordinary requests remain at 100 commands, 256 affected work and 256 KiB. A sole whole-collection inventory deletion retains 078's 4,096-slot / 8 MiB / 8,192-work exception. Recovery requests are at most 1 MiB, with at most 16,384 unique unassigned-copy choices.

Preview is exactly `{ eventId: string, restoreUnassignedItemIds: string[] }`. Event IDs are positive decimal int64 strings, never JavaScript numbers. Apply additionally requires `operationId` (8–100 characters), `planVersion: 1`, the exact 64-character lowercase hex `planToken`, and `confirmed: true`. No caller-provided inverse or frozen state is accepted. Preview does not mutate history or ledger. Preview/apply retain the original private signatures `(uuid,uuid,bigint,text[])` and `(uuid,uuid,jsonb,jsonb)` internally.

Receipts are projected and validated before returning:

| Operation | Returned fields |
| --- | --- |
| inventory | `inventoryRevision`, `changed`, `selectedItemIds`, `acquiredItemIds` |
| slots | `inventoryRevision`, `collectionVersion`, `layoutRevision`, `changed`, `removedSlotIds` |
| recovery.preview | `planVersion`, `eventId`, `supported`, `unsupported`, `conflicts`, `planToken`, `restoreUnassignedItemIds`, redacted `changes`, `rootRevisionsAdvance` |
| recovery.apply | `recoveredEventId`, new `eventId`, `inventoryRevision`, `collections` with `collectionId`, `version`, `layoutRevision` |

No executor context, private grading certificate, label assets, command evidence, legacy source or frozen recovery rows leave this boundary. Preview uses the existing SQL redactor and rejects private keys if an incompatible deployment leaks them. Revisions must be safe nonnegative integers, ID lists and nested preview data are bounded, the global result ceiling is 16 MiB. Normal command SQL keeps its tighter existing evidence/result admission limits before projection.

Retry intent uses original operation ID as batch ID, a null client timestamp, and authenticated credential/source. HTTP request IDs do not enter the digest. Retries under the same actor/credential/transport preserve ledger identity; changing the body or attribution for a used operation ID conflicts, including cross-transport retries. Replays still require current authentication, scopes, membership and billing. A lost response must retry the exact original request rather than minting a new operation. Receipts are **not** authoritative full snapshots or durable queue ACKs: #363 must reconcile a fresh complete owner/binder read before acknowledging the original queue entry.

SQL errors are allowlisted into shared `DeveloperAccessError`: stale/idempotency/uniqueness conflicts 409, membership/owner denial 403, developer entitlement/current saved-card allowance 402, invalid constraints 400, unsupported recovery 409, missing migration/transport/unknown faults 503. Messages/details/hints/SQL are never echoed. Use existing `developerErrorResponse` and private/no-store handling at eventual HTTP adapters; neither private SQL DETAIL nor exception objects are response bodies.

## Preserved SQL and policy

082 calls installed 074/075 and private 077–081 executors unchanged. All three fresh recovery reads, membership-before-4701 ordering, 079 bounded lookups, fixed 080 timezone handling, exact 081 frozen-row context, immutable audit and transactional ledger remain installed. It does not enable conversion, recreate old tokens/queues, change billing allowance rules, loosen audit, or alter raw-copy creation beside graded-only eligible copies. That selection gap remains #366/#383.

## Verification and handoff

Local proof uses only the new private socket `/Users/cal/.local/share/holofolder/issue396-bridge-local/socket`, port 55582, no TCP listener. Restore input: pre-081 archive SHA256 `c95b2126c4127c06f76e8852655804c3b4dbe82dcf94d063945f80bccf216af8`; exact installed 081 SHA256 `e98362e49a9862107a6e5dad1dd616a15b614f4bcb49422387edc6a9f996db13`. Original archive ACLs are restored, local object ownership is isolated. All 90 original counts and 35 core digests match before/after 081 and twice-applied 082. Dumps, roles, auth and private certificates stay outside Git.

Run `STORAGE_BRIDGE_TEST_SOCKET=<exact socket above> bun test tests/storage-execution-sql.test.ts` to opt into actual SQL role, command, replay, recovery and denial proof. Fixtures are synthetic and roll back. The test also checks existing function definitions/ACLs unchanged by twice-applied 082, all private helpers and fourteen prototypes still denied to all four runtime roles, and only the new wrapper executable by service_role. Server tests use the real Supabase fetch hook with synthetic auth/HTTP responses in an isolated subprocess. These are separate proof tiers: no live PostgREST deployment, hosted grants, real conversion, production latency or UI/offline flow is claimed.

Parent reviews 082, refreshes the restore-verified hosted backup, applies only approved migration(s), then verifies hosted ACLs and behavior. This branch does not access/write hosted SQL, merge, watch, deploy or publish. Missing 082 fails closed to `storage_unavailable`; existing public paths remain unchanged.

Before #379 exposure: wire app routes to the named authenticated adapter; add strict registry schemas/permission metadata for the same shared developer operation; align transport body limits (including the sole delete exception); generate and verify REST/OpenAPI/MCP/help/agent docs and smoke coverage together. Complete #363 original-recipient durable reconciliation, bootstrap/renderer/layout/preset gates and #396 Activity/short-Undo/mobile conflict integration. Public registry entries must not advertise this internal RPC as an available capability. Issues stay open until their literal delivery acceptance passes.


## Additive creation dispatch (083)

[Atomic named storage creation](atomic-storage-creation.md) adds internal `collection.create` parsing, receipt projection and a denied private executor through the same service-only gateway. The 082 file is unchanged. Its one dispatch branch/allowlist is extended by 083; existing authentication, membership-before-owner-locks, paid developer access and all other executors/ACLs are preserved. Creation has a separate 2 MiB/4,096-slot bound. Actual native creation recovery remains unsupported and explicitly blocks runtime enablement, in addition to #379. No public registry or endpoint is added.

## First-party browser HTTP integration

The [browser command transport](browser-command-transport.md) calls this existing bridge through an internal handler and a loopback/server-gated synthetic harness. Public production routes remain denied. The bridge checks the expected JWT session against its authenticated actor; typed local test clients are server capabilities and cannot come from HTTP. Generic storage_conflict remains insufficient for safe known-rejection reconciliation; no SQL/result contract change is included. Native work never dispatches through legacy Activity/recovery.
