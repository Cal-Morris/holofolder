# Native Activity recovery preparation (#396)

This slice stages the existing native recovery engine behind the native browser session. **It is not enabled in production.** `/app/api/native-recovery` always returns private/no-store `503 native_operations_staged`; slot/inventory and developer admission remain closed. The existing local-only, nonhosted inventory harness alone injects synthetic clients into the real authenticated bridge. There are no migrations, grants, conversions, admission switches or hosted commands.

Legacy Activity/087 Undo remains unchanged in legacy collection views. The native host never sends a native event through `collection_recovery_v1`. Its explicitly recognized events are `slots.create/move/clear/remove/update/bulk`, `inventory.add/edit/patchGrading/removeOwned/unassign/assign/move/removeSlots/deleteCollection/bulk`, `collection.create` and linked `recovery.apply`, with format-1 native entity changes. Recognition only offers review; the private engine decides support, conflicts, allowances and current authorization. Unknown events have an explicit unavailable explanation.

## Review and original intent

Activity uses the existing scoped safe history read, what/who/when presentation, pagination, original-entry links and shared dismissible sheet. Opening a native preview requires a newly authorized complete first-party owner read and an online session. Only sanitized descriptive changes and named conflict reasons return from the existing recovery registry/bridge. Neither raw `recovery_state`, command evidence, inverse SQL, certificates nor private artwork enters the new preview/history projection. No developer read is treated as complete private first-party evidence.

Removed ownership offers an explicit per-copy **Restore as Unassigned** choice using `restoreUnassignedItemIds`; it never manufactures another copy or chooses acquisition/placement. Default creation requires an explicit nominated native replacement. Its v2 preview includes exactly the current inventory revision and nominated collection version/layout precondition. No replacement is preselected. SQL revalidates every choice; conflicts never expose a usable confirmation token. `private_assets_unverifiable` remains unavailable under the existing engine and #390, with no asset bypass. Cancel is available only before confirmation.

The authoritative native request parser is shared by the server bridge and browser persistence. Preview/application versions remain separate, strict and byte-compatible with existing requests. Existing public recovery REST/MCP registry schemas and generated OpenAPI are unchanged, including unconditional staged admission. Preset discovery/preview changes from #466 are independent and must be preserved during integration.

## One durable queue

Confirmed recovery extends the **existing** atomic `slot-intent:v1` IndexedDB record with an optional `recovery` list. Old records remain readable. There is no separate database/store, localStorage request shadow, optimistic restore or alternate recovery ledger. The original account, owner and device recipient are the record's scope; the immutable request retains event ID, operation ID, reviewed token, version, Unassigned choices, exact replacement preconditions and original device/time context. Server actor/source/membership still come only from authentication, never that device context.

Confirmation awaits the IDB commit before UI acknowledgment or apply. Outstanding slot/inventory work blocks new recovery; unresolved recovery blocks new slot/inventory work. A lease fences concurrent tabs and late replies. Every error, unclassified 409, timeout, expiry, billing/access refusal and lost reply retains the original exact request. This lane has **no** cancellation, replanning, replacement ID or rebase: 089 terminal noncommit proof currently covers only slots/inventory. A request that cannot be resolved may remain retained indefinitely; a reviewed backend recovery terminal contract is still required for safe discard/replanning.

An accepted receipt is saved before attempting verification. It is historical acceptance, never a current snapshot. ACK requires a separate all-stream complete read started after the matching reply, current actor/owner/JWT-session/membership epoch, the retained lease and an inventory revision at least as new as both the receipt and saved base. Reload can resume a failed verification from its saved receipt without applying again. An unknown result requires explicit **Retry exact recovery**, not a status guess. Successful verification installs current state, including newer unrelated edits, and preserves the original immutable intent/receipt locally. Scope teardown ignores late work and leaves the original account/device queue untouched; another account cannot replay it.

## Proof and remaining gates

The synthetic HTTP fixture is deliberately not a SQL inverse implementation. It exercises the actual handler, authentication/owner/session binding, strict parser, redaction, browser UI, IDB and complete-read ACK contract. Local engine correctness remains the existing 077–090 SQL lane's evidence. No new SQL execution, hosted native command, physical phone/PWA acceptance, public admission or release publication is claimed here.

Keep #396 and #379 open. Remaining acceptance includes independently reviewed hosted/authenticated read/apply/cancellation and load behavior, safe terminal recovery outcomes, complete public transport parity, rollout admission and deployed/physical-PWA verification. Existing maximum-workload performance and private-asset limitations are unchanged. Parent owns independent review, serialized merge and deployment verification. [Release copy](releases/native-activity-recovery-draft.md) is unpublished.

## UI review

| Before | After | Why |
| --- | --- | --- |
| Native history had no safe recovery entry point | Explicit review inside the existing Activity sheet | Reuses scope, dismissal and dock safe areas |
| Existing native queue only retained optimistic slot/inventory intents | Optional retained recovery intent in the same atomic record | No invented optimistic inverse or parallel store |
| Unknown native apply result had no browser journey | Exact retry and separate current-state verification | Preserves original intent without guessing noncommit |

No new animation or gesture primitive is added. Existing sheet motion/dismissals are reused. Long names/IDs/reasons wrap, primary controls have 40px minimum height, and all preview changes remain inspectable before confirmation.

## Local verification for this PR

CI Bun 1.3.14: 69 focused unit/contract tests pass across 11 files, including canonical request separation, malformed preview/receipt rejection, unchanged legacy Undo, native HTTP origin/session/owner fencing, durable exact retry, expired/changed-scope retention, receipt-before-read persistence, concurrent leases, older/unbranded read refusal and a later current revision after historical acceptance. Full typecheck, lint and the production build pass. Lint retains 55 existing warnings, with none added. Regenerating OpenAPI produces no diff because registered public contracts are unchanged.

60 focused Chromium phone cases pass on the final production build: 54 native cases and six existing legacy lost-reply Undo regressions, at 375×667, 390×844 and 430×932 in browser and emulated standalone mode with safe-area insets. They cover event selection, private assets, stale conflicts/unknown 409, exact request identity through IDB reload, offline retention, accepted-receipt verification after a failed read, signout teardown, explicit Unassigned/default choices, safe target/confirmation geometry, dock clearance, all sheet dismissals and linked-original detail query keys. Standalone is harness emulation, not a physical installed PWA or Safari acceptance run. The native engine is synthetic; no SQL inverse or hosted behavior is inferred from these phone results. Full-repo e2e was not run.

## Parent integration and retry correction

The parent preserved the newer scanner/analytics bindings and API sections when merging current main. Independent original-head source review passed eight focused queue/browser/HTTP tests and found no blocker. A new real IndexedDB-abort regression then demonstrated that the original UI regenerated operation ID and client time after a failed first commit. The parent now retains the confirmed draft through that retry and displays the locally retained request immediately after successful persistence, without a redundant postcommit read. Independent inspection approved this narrow correction.

The initial combined six-phone run passed 179 cases and had one scanner lost-reply/reload timeout at 390px standalone; no assertion or runtime retry guard was relaxed. Final-candidate verification is recorded in the PR. These synthetic host proofs do not establish hosted recovery, hardware/installed-PWA behavior or production admission.

Final combined candidate: 1,548 unit passes with 37 explicit SQL-gated skips before the thin UI retry correction; the eight affected queue/browser/HTTP cases, full typecheck and lint pass after it. The rebuilt production candidate passed all 186 recovery/scanner/analytics phone cases across all six profiles, including the new real IDB-abort regression. The earlier scanner timeout did not reproduce in five additional serial standalone-390 repeats. This is evidence of final passes, not an established fix for intermittent scanner timing; no assertion or retry threshold changed. Production build/docs CSS passed as part of this final matrix.
