# Binder value, Global Wanted, partner notifications and marketing

Status: approved by Cal on 2026-11-07. Implementation is split into scoped releases.

## Intent

Make binderdex useful at a glance on a phone: know the current binder's estimated value, find wanted cards across every binder, and tell a collecting partner when a card is acquired at a show. Update the public marketing pages to explain the shipped experience clearly.

## Requested behavior

- A prominent current binder value based on Cardmarket data.
- An explicit whole-binder action to refine that estimate with sold comps and supporting eBay listings.
- Analytics that is readable on mobile.
- Global Wanted, independent of the open binder, including who wants each card.
- VAPID Web Push to the other partner's registered devices when a card is added to the collection or marked Got in Show mode.
- Improve public marketing pages. This does not add a signed-in home dashboard.

## Proposed product choices

These are builder recommendations, not decisions Cal has explicitly made:

- Assign wanted cards per card to You, Partner, or Both. Existing wants have no reliable attribution and remain Unassigned until someone assigns them. Do not infer a person from the collection owner's account.
- Notifications cover newly acquired owned printings in Show mode, including Got from Wanted. Adding a card to the want list alone does not trigger an acquisition notification.
- Notify the other member of the current partnership, on all their enabled devices. Exclude every device belonging to the actor, not just the device they used.
- Keep the current public `/home` entry point and signed-in `/` binder routing. Improve the existing marketing site rather than introducing another landing route.
- Ship value and Analytics first, Global Wanted second, partner push third, and marketing updates alongside the capabilities they describe. Independent changes use separate PRs.

## Binder valuation and Analytics

Show Binder value on the binder overview with a large amount, Cardmarket attribution, priced/total owned-card coverage, and source freshness. The value opens the corresponding Analytics view. The total excludes wanted cards and counts owned copies in different binders separately when viewing all binders.

Use Cardmarket evidence for the exact printing, language and finish. Reuse stored source evidence when it identifies that finish; do not substitute the snapshot's preferred provider or an ambiguous foil quote. If stored data cannot provide an exact Cardmarket price, show that card as unpriced. Preserve actual FX provenance when displaying a GBP conversion. Never treat missing, zero, negative or invalid prices as zero-value cards. Exclude quotes older than the existing 30-day valuation limit and label older usable quotes as stale. Show a partial estimate when coverage is incomplete and Unknown when none are priced.

Refine valuation is an explicit action for the owned cards in the selected scope. Reuse existing comps requests, freshness caching, allowance checks, progress, cancellation and backoff. Do not make paid checks when merely opening a binder or Analytics.

Keep Cardmarket estimate and Sales-based estimate separately labelled. Use the existing sold-price guide's matching and evidence gates; active asking prices remain supporting context. Cards without qualifying sold evidence retain the Cardmarket estimate in the combined refined total, visibly labelled as fallback coverage. A refined total must show how many cards use sold evidence, fallback estimates and no usable price. Never describe a partial or poorly matched result as automatically more accurate. Reopening uses saved checks with their timestamps.

On mobile, stack the value and completion sections instead of squeezing both into narrow columns. Lead with value, coverage and Refine valuation, then collection progress and highest-value/unpriced/wanted card lists. Use readable body text, clear section spacing and sufficient tap targets. Keep historical observations and activity secondary; history remains a per-printing chart, not an invented historical binder valuation.

## Global Wanted

Make Global Wanted a clear navigation destination available regardless of the currently selected binder. Reuse the existing all-binder lookup and wanted search/filter UI. Loading or incomplete offline coverage must be labelled; a partial cache must not look like an empty complete list.

Group the same printing/language/finish in one global result, retaining every binder reference and the union of the people who want it. Show binder names and named people on the result. Do not delete the underlying per-binder wants or change which binder a collection edit targets. Acquiring a card still requires a specific destination binder and only resolves that binder's wanted entry; other wants remain until explicitly updated.

Persist attribution using stable user IDs, with labels resolved for the current viewer. Both means both partnership members at assignment time, not an implicit claim for any future partner. Existing data remains Unassigned. On partner removal, old attribution may be displayed generically but must not expose private profile data or grant access. A new partner is not automatically assigned old wants.

Attribution must survive normalization, offline snapshots, conflict fingerprints, three-way wanted merges, request serialization, server validation and backups. Old queued writes that lack attribution must not silently erase it. Validate assignees against the actor and current authorized partnership on write.

## Push enrollment

Use standard Web Push with a binderdex-specific VAPID key pair and subject. Never reuse another application's keys. The public key is available to the browser; private key and subscription encryption secrets remain server-side. Document configuration names in `.env.example`, with no key values in the repo or plan.

Add an Enable partner notifications action in Settings and a dismissible contextual prompt in installed Show mode. Explain what gets sent before the browser prompt. Permission is requested only after a user tap. iOS requires an installed Home Screen web app; detect unsupported or not-installed states and give clear installation guidance. Denied permission gets recovery instructions, not repeated browser prompts. Installation itself never implies permission.

Store multiple subscriptions per authenticated person, with a device label and last-seen time. Enrollment, listing and deletion operate on that person's subscriptions only, not the shared collection owner. Reconcile the local browser subscription with its signed-in account; account switching cannot leave the previous account's alerts attached to that browser. Provide disable-this-device and remove-registered-device controls. Sign-out revokes the device's binding; offline sign-out unsubscribes locally and reconciles stale remote registration later.

## Acquisition event and delivery

Capture acquisition intent at the user action, including Show mode context, stable operation ID, actor account, intended partner and partnership identity, destination binder and printing identity. Persist that intent through the offline queue. Do not decide whether an old queued edit was a show purchase using the Show toggle's value when it later syncs. Legacy operations without intent keep working and do not create alerts.

Builder safety choices: a delayed acquisition may notify only the partner from that original relationship, and only while the same partnership remains active. A newly linked partner never receives an earlier relationship's queued alerts. If a queued edit syncs under another signed-in account, preserve the existing collection authorization/sync rules but suppress its notification rather than reassigning the actor. If the original relationship cannot be established, save the authorized collection change without a notification.

At the authenticated server write, validate binder access and compare the committed previous state with the new owned printing. A qualifying transition is missing/wanted to owned, or replacing the owned printing with a different acquired printing. Status-only changes, metadata edits, imports, ordinary non-show edits and repeated saves of the same owned printing do not qualify. The server derives actor, recipient and notification text; clients cannot supply arbitrary recipients or push text.

Commit the collection change and a uniquely identified pending acquisition event atomically. Extend the existing write boundary with the smallest transaction/RPC needed for this guarantee. A unique actor/operation identity makes a replay a no-op for event creation. Preserve existing compare-and-set behavior under concurrent edits. Offline operations compacted away or undone before sync produce no alert; a conflict that keeps a different remote printing must discard the superseded intent. Do not emit twice for Got, owned insertion and the show purchase tally representing the same action.

After commit, dispatch the event using the existing durable workflow capability. Retain the pending event until dispatch has been durably accepted; recover pending events on the next authenticated sync/open without relying only on an untracked background promise. Use bounded retries and track completion per event/subscription. Validate the captured partnership and current device ownership at delivery and re-check on retry so unlinking or disabling a device stops future sends. Client-supplied actor/relationship identities are eligibility hints, never authorization; the server verifies them against its own records.

Send a concise notification such as “[Name] got [Card]” with the destination binder in the body. Tap opens a same-origin binder link and the relevant Pokémon/card where supported. Reuse the existing service worker, adding push and click handlers without disturbing offline caches. Validate payload shape and constrain destinations to safe app paths. If another account is signed in, require normal authorization and do not render a private card preview before that check.

Drop expired subscriptions on push-service 404/410 responses, and retry transient failures without failing the saved collection write. Use event-based notification tags to coalesce replayed deliveries on a device. Web Push is best effort: a successful push-service response does not prove that a person saw it, and transport-level exactly-once delivery is not promised. Avoid recording sensitive endpoints or keys in logs.

## Marketing

Refresh the existing marketing page's content and mobile layout to explain the real collecting workflow: organize named binders, see estimated binder value and its coverage, keep Global Wanted with a partner, check sold evidence when deciding to buy, and use Show mode with offline support.

Use existing visual assets and design language as the starting point. Preserve attribution, working sign-in/collection calls to action, the Binder Studio route, static rendering and deferred auth code. Avoid synthetic prices presented as real valuations. Describe notifications as optional and requiring installation/permission on supported devices. Marketing must not advertise unfinished behavior; ship copy with or after the relevant implementation.

## Validation and shipping

- Unit coverage for Cardmarket selection, exact finishes, currency provenance, stale/missing prices, fallback/refined totals and copy counting.
- Unit and integration coverage for attribution normalization and concurrent/offline wanted edits, grouped Global Wanted and binder-specific acquisition.
- Subscription authorization tests for owner/partner/stranger, multi-device enrollment, account changes and expired subscriptions.
- Event tests for self-exclusion, unlink before delivery, duplicate requests, lost responses, conflict retries, undo before sync, offline reconnect, both acquisition entry points and non-show edits.
- Browser tests for notification opt-in states, granted/denied/unsupported states, service worker payload/click behavior and safe navigation. Mock push transport; do not send surprise test notifications to real devices.
- Verify all UI at 375, 390 and 430 widths in browser and standalone PWA with safe-area insets, including offline and dead-Wi-Fi behavior. Test the worker with a production build.
- Run required unit tests, typecheck, lint, production build and all six e2e projects. Report device Web Push delivery separately from mocked-browser proof; real iPhone/Android verification requires an explicitly enrolled test device.
- Schema changes use the next available numbered idempotent migrations, RLS and documented deployment order. Apply only required migrations to the existing project and verify them as part of shipping, preserving compatibility with the running app.
- Configure independent VAPID credentials before enabling enrollment. A missing configuration leaves collection edits usable and enrollment clearly unavailable.
- Ship small PRs under the existing release procedure and deployment quota rules. Record configuration, migration and physical-device delivery gates explicitly.

## Not included

No signed-in dashboard, general notification inbox, price alerts, promotional pushes, new partnership model, or automatic removal of wants from other binders. Optional brainstorm ideas stay separate from this scope.

## Public protocol references

- Web Push library: https://github.com/web-push-libs/web-push
- Home Screen Web Push and user-initiated permission: https://webkit.org/blog/13878/

Implementation details that do not change these behaviors are left to the builder. Cal approved the proposed product choices above before implementation.
