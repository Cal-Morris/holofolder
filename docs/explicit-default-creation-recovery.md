# Explicit default creation recovery (085, internal only)

Later [full-workload transaction controls](converted-recovery-performance.md) preserve the recorded timeout evidence below and compare unchanged 085 against an identical committed fixture. They change no SQL or exposure gate; parent acceptance and the wider rollout remain pending.

Related: #396, #384, #379. Based on merged #432, main `95f2550ae54486cf4a83eabe18f5fc9bb04a9fd0`. This extends [084 native creation recovery](native-collection-creation-recovery.md) without changing migrations 073–084 or any version-1 function, request, receipt or plan. Parent owns independent review, a fresh restore-verified backup, hosted application and release. No hosted access, grants, route enablement, conversion, merge/watch or Framer publication is part of this slice.

## Eligibility and consequences

A complete genuine 083/076 default `collection.create` event can be reversed only while every original binder/state/initial slot is still untouched and every 084 full-history/FK-absence check passes. First-ever default creation is eligible only if an alternative now exists. The user must explicitly nominate another accessible collection of the same current owner, declare its current version/layout revision and the current owner inventory revision, review the preview's removal **and default reassignment**, then confirm the exact token. No collection is selected or manufactured automatically.

The replacement follows the existing 075 `deleteCollection.replacementDefaultCollectionId` policy and canonical `InventoryCommandRequest.collections` preconditions: it must exist, be different from the removed collection, currently be nondefault, and have native `slots` authority with current version/layout revision. A converted collection with current slot authority is also eligible; its provenance is untouched. Legacy-only alternatives cannot provide these native preconditions and remain unavailable. The removed default must still match its original recorded state. Absent alternatives, self, foreign owner, missing state and revoked access cannot authorize removal.

Apply deletes only the original empty collection and recorded initial slots, retaining owner authority. It assigns the nominated collection as default in the **same transaction**, advances the current owner inventory revision and the replacement's current collection version, and records both removal and default update in one linked 076 `recovery.apply` event. Replacement slots/layout, physical copies, duplicate printings, grades/certificates/labels, acquisition dates, explicit wants and unrelated collections remain intact. Counters never rewind. Failure/cancellation rolls back default assignment, removal, counters, history and receipt together.

Ordinary version-1 deletion recovery can reverse the resulting event, restoring the original IDs/default and the replacement's prior nondefault status if its existing conflict/allowance checks pass. It uses actual recorded deltas, never invented events. Later edits/default decisions or occupied identities can prevent this inverse-of-inverse; there is no force/reset fallback. The original creation's 083 receipt remains historical acceptance and cannot recreate removed entities.

## Strict internal contract

Existing `recovery.preview` / `recovery.apply` remain exactly version 1, including `creation_default_requires_explicit_replacement` for default creation and byte-identical nondefault/ordinary plans. New operation names on the **existing service-only** `storage_execute_v1` gateway are `recovery.preview.v2` and `recovery.apply.v2`. The shared internal parser/receipt adapter supports those names, with the same app/REST/MCP authentication, membership, paid scopes, attribution, cancellation and redaction. These are not registered public REST/MCP operations or enabled routes.

Synthetic preview input:

```json
{
  "eventId": "123",
  "planVersion": 2,
  "restoreUnassignedItemIds": [],
  "replacementDefaultCollectionId": "00850000-0000-4000-8000-000000000002",
  "inventoryRevision": 7,
  "collections": [
    {
      "collectionId": "00850000-0000-4000-8000-000000000002",
      "version": 3,
      "layoutRevision": 1
    }
  ]
}
```

`collections` contains exactly one canonical collection precondition, matching `replacementDefaultCollectionId`; Unassigned choices must be empty. Apply adds exactly `operationId`, `planToken` and `confirmed: true`. Unknown/raw actor/owner/evidence/force fields, omitted fields, mismatched IDs, invalid revisions and mixed versions are rejected. Version 1 never silently accepts new fields. Version-2 preview returns the existing sanitized preview projection with `planVersion: 2`, including both explicit binder changes. Apply returns the existing safe recovery receipt. No private replacement state/history/certificate appears in receipts.

The private token binds the exact nominated identity, declared preconditions, current binder/native state and dependency evidence, relevant later history IDs, actor/owner and the entire original plan. Replacement rename/default/content/version changes after preview stale the token, including metadata ABA. The existing digest includes the entire versioned request and trusted intent; the existing account-lifetime `recovery_v1` ledger is shared across versions. An exact accepted request replays only after current authorization. Reusing its operation ID with another version, replacement or precondition conflicts. A new operation ID with an old token must pass fresh planning and cannot repeat the removal.

Additional reasons:

| Reason                                           | Meaning                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `explicit_replacement_requires_default_creation` | Unsupported event, including nondefault/ordinary events passed to v2 |
| `creation_replacement_unavailable`               | Missing/self/foreign/default/legacy-only replacement                 |
| `creation_replacement_version_changed`           | Declared replacement version/layout is stale                         |
| `creation_replacement_revision_changed`          | Declared owner inventory revision is stale                           |

Every original 084 conflict remains except its explicit-replacement placeholder for the supported version-2 default case. Original later edits/ABA, incomplete evidence, missing slots, current/later dependents, changed authority and missing full history still refuse the whole event. Conflicted previews have no usable token. Apply reports the existing sanitized 409 conflict, not private dependency details.

## Locks and proof

The v2 executor is derived from the installed 084/081 executor, replacing only request validation and the three planning calls. Membership `FOR SHARE` precedes management 6102, then inventory 4701. All owner binders are locked, including the nominated replacement, followed by existing native dependency/frozen-source locks. Initial discovery, post-lock reviewed preview and final private plan remain fresh reads. Current replacement version/state/history and original safety checks are repeated after waits. 076 recorder/redaction/immutable guards, all existing denials, gateway ACLs and the unchanged 10-second transport/SQL deadline remain.

Only the new private socket cluster `/Users/cal/.local/share/holofolder/issue396-default-recovery-local/socket`, port **55586**, user `default_recovery_test`, is used. Original archive `c95b2126c4127c06f76e8852655804c3b4dbe82dcf94d063945f80bccf216af8` and all archived backups are retained. Local restoration preserves original ACLs with local ownership. Private logs and original count/digest comparisons stay outside the repository.

```sh
DEFAULT_RECOVERY_TEST_SOCKET=/Users/cal/.local/share/holofolder/issue396-default-recovery-local/socket \
DEFAULT_RECOVERY_RACE_DATABASE=holofolder_fresh_default_recovery \
  bun test tests/default-creation-recovery-sql.test.ts
```

The race database is disposable synthetic data only, created by full numbered fresh-schema replay using `tests/fresh-schema.test.ts`. Archive fixtures roll back. Local SQL correctness/timing does not establish hosted PostgREST cancellation, production history/load/memory performance, supported auth transport or mobile proof. **The inherited converted 4,096-copy maximum timed out at the unchanged 10-second deadline before and after 084. It remains an unresolved performance/rollout gap; passing focused nonmaximum converted regressions do not make that workload pass.** The full converted regression also reproduces the 10-second timeout after 085. An isolated maximum-only probe completed with a roughly 8.8-second apply, which does not resolve the full-workload failure or establish reliable deadline headroom. No full e2e or UI/browser-read changes are included.

Parent must apply **only 085 after installed 084**, after independent exact-head review and a NEW fresh restore-verified hosted backup. Recheck source/hash, original counts/digests, owners/ACL/RLS, protected recorder/guard definitions and runtime denials before/after application. Existing app/version-1 requests work before 085; v2 calls before installation fail unavailable, with no fallback. Keep public routes gated and receipts/history intact. #396/#384 remain open for supported API/docs/Activity/Undo/offline/rollout work. [Unpublished release copy](releases/native-creation-recovery-draft.md) is preparation, not a customer announcement.

Submitted local evidence:

- Five substantive SQL cases pass, including migration twice, strict gateway version separation, first-ever default/no alternative/self/foreign/legacy-only conflicts, preserved duplicate physical copies/grade/certificate/label/acquisition/wants, safe inverse-of-inverse, replay/new-receipt/changed-intent refusal, recorder/cancellation rollback and actual two-session races. Legacy reorder/delete, native creation, concurrent replay, dependent insertion, default edits and membership changes wait on the expected locks; replacement ABA committed while apply waits invalidates its token; unlink-first has no accepted owner lock.
- Final default maximum: 4,096 long-metadata initial slots, a creation request over 1 MiB and 512 later events, about 0.66s preview / 3.36s apply under the unchanged 10-second SQL deadline. Ordinary/nondefault 084 regressions also pass, including native maximum about 1.13s / 5.45s. These are disposable local measurements, not hosted guarantees.
- Focused native and converted nonmaximum regressions pass. The full converted workload **fails** at 10 seconds after 085, as it did before/after 084; its isolated maximum-only probe at about 8.8s apply is not a passing full-regression or production claim. No deadline was raised. Adapted private regression copies change only socket/module setup and explicitly documented workload selection; repository originals are untouched. SQL suites were finally run serially because simultaneous suites contend on their shared billing fixture row.
- Full numbered fresh-schema replay passes. All 90 original counts, 35 core digests and archive hash match after rollback. Existing function bodies remain byte-identical except the intended service-gateway dispatch; existing owners/ACLs, table access/RLS and every private runtime denial are preserved. This includes exact recorder/redaction/immutable/authority guard definitions and version-1 planning/execution bodies.
- 1,412 unit-suite entries, full typecheck, lint and production build pass. Lint retains the same 55 existing warnings; touched-code lint is clean. No phone/full e2e, hosted access/application, exposure or publication. Parent owns the remaining review/backup/application/release and broader rollout gates.

085 SQL SHA256: `64064206bb6d26dead94629d76a9c6790663a3492e467fd02042429ec55b5bab`. Verify the reviewed source and hash again before parent application. Private logs remain in the worker's local cluster directory. The disposable race database is dropped and only this worker's cluster is stopped after proof; archived backups remain intact.
