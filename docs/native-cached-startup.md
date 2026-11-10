# Native cached startup boundary

Related: #363, #386, #379. Internal preparation only; production native admission remains denied. No SQL, conversion, new auth library, supported API exposure or hosted data operation is part of this slice.

## Actual consumers

`components/cached-native-startup.tsx` wraps the local branch of `BinderStart` and `OfflineAppShell`. The normal server bootstrap remains legacy. The static shell receives local-harness eligibility only in a non-Vercel E2E build, then applies the existing loopback `browserHostAdmission` check. No URL, storage flag or saved JSON grants admission. Normal production builds never admit this path.

The checked live host mounts `NativeStartupRecorder` through the live host’s render-surface adapter after the existing device identity is established, without changing `BrowserCollectionSession`. It adds an optional v1 `native` pointer to the existing `binderdex_start_v1` marker: existing device ID and previously checked JWT session ID. It stores no credential, JWT, user object, membership table or lifecycle epoch. A same-account/owner legacy server marker refresh preserves that pointer; account/owner replacement drops it. Old markers without it and unknown versions remain legacy. A failed or absent cached native start never opts the legacy fallback into the live native host; only a successfully opened cached native view can request that checked handoff on reconnect. The recorder does not claim a complete read or create a second queue.

On offline startup the adapter uses the existing Supabase browser client's `getSession`, requiring an unexpired session and matching JWT subject/session ID/expiry, actor, marker and existing device ID. Reading the JWT payload here only binds the saved display to that device session. It is not signature verification or fresh account/membership evidence, and it cannot authorize remote operations. Startup waits at most two seconds if Supabase is trying to refresh on dead Wi-Fi; the auth client continues to own its lifecycle.

## Exact inherited partner policy

`readLocalBinderStart` and `readOfflineShellState` allow an owner-mismatched cached collection only with `readBillingCache(storage, actor, owner)`, requiring the exact account/owner pair and either unenforced billing or current paid access. Billing access is recalculated from saved entitlement expiry. This is a previously established local-display policy, not proof a partnership is still active. Native cached startup applies the same predicate and additionally requires the matching saved native/session/device pointer. It does not treat the latest device owner, another actor's billing bytes or a new URL as partner authority. Offline revocation cannot be discovered without a connection; fresh membership is mandatory at reconnect.

## Canonical data and adapter contract

`readCachedNativeStartup` reads `createSlotOfflineQueue(...).read()` in the existing `binderdex-offline/records` store using the original device/workspace/account/owner key. Both baseline and optimistic projection must exist. Existing `slot-navigation-v1` metadata is parsed strictly against the baseline; every saved binder needs its matching grid. Missing, malformed, stale or partial metadata fails closed for native display, with a notice and legacy fallback. Corrupt queues and storage errors also retain all bytes and show the fallback notice.

The adapter returns only `{ read, pending }`. Its read always has `evidence.kind = cached`, a new nonpersisted navigation epoch, canonical optimistic inventory and validated catalog/grid evidence. Pending structural slot edits may advance a baseline grid's revision without changing its dimensions, as in the existing browser host. No `saveSnapshot`, transport, queue replay, command receive, receipt, ACK, audit or recovery call occurs. Cached Binder/List/Inventory use the existing navigation host and actual BinderApp display. Edit layout is unavailable; intents cannot be accepted from this cached-only surface. The existing legacy data/queue are not interpreted as native data.

`online`, auth changes, cross-tab storage events and token expiry invalidate and unmount the cached surface. Reconnect enters the unchanged live BinderApp host, whose checked claims, current owner/membership and partner-access checks create a fresh scope. All current reads and future sender integration retain their own live-scope, revision, operation identity, receipt and fresh-read fences. The cached epoch is never passed to `BrowserCollectionSession` or a sender. A failed recheck cannot merge or ACK the saved projection. Unlink/relink to the same owner still requires a fresh live epoch; changing auth session makes the old pointer unusable.

## Shell and compatibility

The v6 worker shell includes the actual startup consumer and its static client dependencies. Only user-independent `/app/app-shell` HTML and public assets are cached. Native inventory, auth responses and private HTML remain excluded. Images and data keep their existing compatibility cache names; queue/metadata keys are unchanged. A missing directly referenced boot asset produces a small static reconnect notice rather than an endless skeleton, without deleting IDB edits. An installed worker without a shell gives the same notice. A truly first-ever offline visit with no worker or shell can only produce the browser's network error; cached JSON cannot manufacture executable client files.

An old worker/shell runs its old legacy startup until it updates; this slice cannot make an old client native-capable. Missing optional lazy screens can still require reconnect, and successful shell preparation is not a guarantee against later browser eviction. Native production admission remains denied while old-client/SW compatibility is unproven.

## API, help and delivery

This is a device-only bootstrap adapter, so it adds no REST/MCP operation or registry/OpenAPI change. Supported inventory/slot routes remain staged, and #376/#379 API parity remains required. Local browsing emits no remote mutation or audit event. Live legacy Activity/Undo APIs remain untouched. Current help is in `content/docs/native-offline-startup.mdx`; release copy is an unpublished draft under `docs/releases/native-cached-startup-draft.md`.

## Proof and remaining gates

Focused unit tests cover cached identity/session/device mismatch, expiry, partner cache restrictions, old markers, corrupt/missing metadata, canonical pending projection, unchanged queue/receipts and storage/refresh failure. The focused browser spec closes the original page, disables the new page's HTTP cache, goes offline and navigates `/app` through the real worker/static shell. Six phone profiles cover browser and emulated standalone safe areas, pending layouts, absent canonical evidence, expired JWT, auth-account changes, evicted boot assets and stale owner reconnect with a rejected old-owner response. Auth/catalog/remote responses are synthetic. Page close/reopen is real; a browser-process kill, physical installed PWA, hosted JWT/RLS or production acceptance is not claimed.

Parent still owns independent review, serialized integration, deployed verification, fresh backup/migrations where needed, representative hosted conversion, old tabs/SWs/queues, real owner/partner unlink/relink, consumer/share/scanner/full backup restore and audit/recovery gates, supported REST/MCP parity, authenticated sender/replay integration and literal #379 admission. No missing gate is waived by local relaunch proof. No marketing publication until the capability is deployed and admitted.

Cached display expires at the earlier of the existing session deadline and JWT exp. Identity is checked again after the awaited IDB read before cached data is published, and the same earliest deadline closes an already open view.

## Baseline timeout diagnosis at d883801

At exact baseline `d88380105c75dd1a05e4a4fc4ecd49c1557deaa7`, the 375×667 standalone pending-layout relaunch test times out **during online setup**, clicking `alpha-empty-0`. The Playwright trace shows `alpha-empty-1` intercepting that click before any pending edit, page close or offline navigation. A separate geometry probe reproduced the failure: the rendered grid container was about 42×48 px while each slot retained its 36 px minimum, causing overlap. This is an online grid hit-target defect, not evidence of a startup/auth/IndexedDB/SW readiness failure. It remains unresolved by this startup-only test change.

The two startup cases needing pending structure now use the existing layout toolbar's **Append free slot** button. Append and insert both go through `prepareLayoutIntent`'s `create` slot command, the actual durable queue and the synthetic 503 sender outage. The existing unit startup regression uses that same append command. No direct IDB seeding, forced click, sleep, timeout increase or assertion removal is involved. The test still closes the original page, disables the new document's HTTP cache, navigates offline through the real worker, requires cached-only read-only display and 13 actual slots, and compares the entire canonical queue before and after. Missing-metadata refusal retains the same pending-record comparison.

This correction changes test setup only, with no runtime/API/help/coverage contract change or customer release announcement. It does not establish that every pending command variant, the online editor's pointer geometry, a physical installed PWA, browser-process termination, hosted access or production native admission has passed. Parent retains those acceptance gates under #363/#379.
