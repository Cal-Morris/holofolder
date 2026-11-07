# Background comparisons and reliable show downloads

**Goal:** Let owned/wanted comparison checks finish with the phone closed, reuse checks for 30 hours, and resume show downloads after transient failures.

**Approved scope:** Cal approved the three-part proposal and confirmed the failing offline flow is Prepare for a show.

**Architecture:** Reuse the installed Workflow SDK and existing provider reservation logic. Store owner-scoped jobs with target snapshots, counters and cancellation state in Supabase; a reconnecting client reads progress without owning execution. Keep local downloads foreground and resumable, with bounded retries, durable writes and honest missing-data counts.

## Tasks

- [x] Add regression tests for 30-hour boundaries, job target normalization/progress, transient downloads, cancellation and durable resume.
- [x] Add migration 050 for 30-hour reservation and server-only comparison jobs. Implement authenticated start/status/stop with spend confirmation and duplicate active-job protection, then durable per-printing workflow steps.
- [x] Replace collection comparison browser execution with reconnecting job UI, preserving provider limits and confirmation.
- [x] Retry binder/set downloads with bounded timeouts/backoff, save each completed item durably, retain retry plans, and distinguish transport failures from unavailable evidence.
- [x] Run focused unit and six-project mobile e2e checks, typecheck/lint/build as needed, then one independent review.
- [ ] Apply and verify the migration, open a scoped PR, merge after release gates and verify production.

## Constraints and review focus

No new dependencies, no full e2e suite, no collection write queue changes. Never automatically repeat paid calls after an uncertain result; use existing server claims. Status/cancellation must require the job owner's account or partner. Closing a view must not stop a server job. Explicit Stop must prevent new provider work. Browser storage errors must never count as successful downloads. Unknown prices/evidence stay unknown. Preserve existing storage identifiers and all unrelated edits.

## Verification

1,021 unit tests passed. Typecheck passed; lint remains at 59 existing warnings. Production build passed through the focused Playwright run. All 48 current comparison/binder-download/offline-search mobile cases passed across six viewports; the separate asking/sold comparison spec passed all 84 cases in the earlier combined run. Independent review findings fixed: saved-status validation, stale inspection races and bounded planning fetches. Migration 050 applied to the hosted Supabase project after two rolled-back applications; verified 29h reuse, 31h refresh, two-minute reservation cooldown, RLS/grants and active-scope index use. Synthetic rows were rolled back.
