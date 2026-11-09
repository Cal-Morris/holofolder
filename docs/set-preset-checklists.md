# Copied set and variant checklist drafts

Related: #372, #373. Internal staged UI only. #379 still gates runtime exposure. No inventory is acquired, no collection is saved, and no mutation/audit event is emitted by preparing a draft.

## Supported behavior

`generateSetChecklist` copies the full mirrored `cards` array, not Dex-grouped `slots` or capped search results. Each canonical printing becomes one specific-card target in numeric/alphanumeric collector order, with numeric secrets and alphanumeric subsets included. No category or species filter is applied: Trainers, supporters, items, Energy and repeated Pokémon all remain eligible. Canonical aliases collapse once; conflicting duplicate identities fail. Empty lists stay empty and incomplete lists never acquire placeholders.

Choose a supported language. `getMirroredSetDexSlots` now supplies `languageConfirmed`, true only when the catalog contains a nonempty name for that exact language. A requested language or fallback English/image is insufficient. Old cached payloads without this field are unavailable for generation. All included targets constrain the chosen language.

Base checklist means **any finish**, not Normal. Explicit variant scope supports Normal, Holo, Reverse holo and Jumbo, corresponding only to literal `true` flags `normal`, `holo`, `reverse`, `jumbo`. False, absent and unknown flags are unavailable. Rarity, inferred finish, prices and grading never establish availability. First edition and promo stamps have no corresponding supported canonical finish constraint and are not offered. Flags are shared catalog evidence; language/region-specific release distribution and variant-family completeness are not asserted. Coverage warnings and verified counts remain visible per selected finish.

Promos are loaded from an actual chosen set ID via the same full-list API, then selected individually. There is no invented association between a promo and the main set. Exclusions are explicit canonical card IDs, covering all selected finishes of that card. The exact preview lists included names, collector numbers, language and finish and shows the resulting target count. Its pagination is presentation only. Printed base counts cannot prove total catalog/master-set completeness, particularly with secrets/subsets. The UI always qualifies coverage.

The optional `stagedCreation` property of `SetPopulationView` reuses the existing `BinderCreationPresets` / `onDraft` contract for “Create binder from this set”. Production callers omit it. The creation picker also offers Set / variant checklist. Both hand off the same parsed internal draft. Existing Blank/Dex/species/printing choices and ordinary editable/free slots remain intact. No BinderApp/navigation/layout-editor/bulk or storage executor is changed.

## Copied source and scope

`SetChecklist` is the canonical domain envelope containing:

- `manifest`: the existing `{source, name, entries}` preset. Source ID is `set:<actual set ID>` and source version is the read capture timestamp. Entries are the exact copied canonical targets, language and optional finish constraints.
- `scope`: detached catalog evidence (actual set IDs, collector numbers, names, verified finishes and language availability), chosen language/finishes, explicitly selected promo IDs and exclusions, capture time, printed count and coverage warnings.

Both are recursively frozen. `parseSetChecklist` rebuilds derived targets and coverage and rejects mismatched envelopes. `parseBinderCreationDraft` accepts optional `setChecklist` only when its manifest exactly matches the draft manifest. Later catalog updates never silently change the copied entries. The snapshot view makes no network request and can display retained/deserialized evidence offline. No new persistence layer, offline queue, ACK or background refresh is added. Uncached scope loading and Prepare require a connection. Closing/reopening a real persisted binder is still a runtime acceptance gate; the harness retains draft state only for its current lifetime.

The existing 083 creation parser/executor/SQL remain the backend boundary. Its manifest accepts only `source/name/entries`; **do not send `scope` or the whole UI draft to SQL**. The selected canonical target list fits the existing manifest contract, but detailed scope metadata has no durable execution contract yet. Before enablement the owning backend/rollout work must explicitly preserve and round-trip that evidence through an accepted versioned contract. This PR deliberately does not loosen SQL or bypass that gate. No legacy create-then-slots sequence is introduced.

`SetChecklistScopePreview` can display an existing saved envelope with current binder targets. It labels a changed goal Customised. Progress continues through the existing canonical matcher and primary-placement completion. Normal cannot fill Reverse holo, one copy cannot fill two targets, and missing inventory/catalog evidence is not completion. Free-slot extras do not change the target denominator. Adding a target increases it; removing/retargeting changes the current goal. Reordering leaves requirements unchanged. No original-set missing list is imposed after editing.

## API, security and errors

The UI reuses the existing read-only app catalog endpoint:

- `GET /app/api/tcg-set-slots?query=<name-or-code>` searches sets; `DLR` resolves through the existing alias helper.
- `GET /app/api/tcg-set-slots?setId=<actual-id>&language=<language>` loads the paged full mirrored card list. `cards` is used; `slots` is not a checklist denominator. No provider scraping, sync, image proxy fetch or backfill occurs here.
- Missing selected set/full list produces an unavailable message; non-OK responses disclose read failure and disable draft preparation. Unknown language/variant evidence produces zero or partial eligible targets with exact coverage disclosure. Empty output cannot prepare a set draft. Stale async responses cannot replace a newer language/catalog choice.

Existing supported REST/MCP operations remain `list_sets` / `get_set` and cursor-paged `list_cards` / `get_card` with `catalog:read`. For complete card browsing, page `GET /app/api/v1/cards?set=<actual-id>&language=en&limit=100` until no next cursor. These operations are unchanged. A language-labelled response is not independent proof of translation or regional variant availability. No new public preset creation endpoint/tool is registered and OpenAPI is unchanged: this feature is a private draft callback, not supported durable execution. Draft owner identity does not authorize a server mutation. Future accepted creation must resolve authenticated owner/partner, versions, caps, idempotency, audit and recovery at the existing shared boundary.

## Verification and release boundary

Automated card data is explicitly synthetic. The focused unit and six-phone Playwright evidence is recorded in the PR. UI tests exercise read-only preview/draft handoff, variant counts, unavailable language, promos/exclusions, offline retained scope, edited target progress and existing creation regressions. No remote/partner execution, hosted writes, DB application, fresh-load durable scope persistence or production enablement is proved. #372/#373 stay open for those acceptance gates. Parent owns review and release. [Unpublished release copy](releases/set-preset-checklists-draft.md).

Craft review:

| Before | After | Why |
| --- | --- | --- |
| Dex grouping loses repeated printings and non-Pokémon | Ordered full-card targets with individual language/finish labels | Preview the actual goal |
| Rarity could suggest a finish | Explicit verified counts, disabled unsupported finishes | No invented availability |
| Long set/card names | Wrapping labels, shrinking input rows and bounded exclusions list | Keep the 375 px layout usable |
| Catalog scope could drift | Frozen envelope and separate current-target progress | Preserve user edits |

No new animation or overlay primitive is introduced. Controls use immediate state feedback and the existing shared switcher. All UI evidence is emulated; physical-device keyboard and gesture behavior remains unproved.

Rejected scope changes, including conflicting catalog aliases, show a validation error and keep both the picker selection and previously published checklist unchanged. A promo is displayed as selected only after the derived scope validates.

Parent regression proof: the conflicting-promo case failed on the original source and passes after validating before committing any scope selection. Final affected matrix passes all66 cases without retries;17 focused unit cases, typecheck, focused zero-warning lint and production-mode build pass. No runtime persistence or hosted write is claimed.
