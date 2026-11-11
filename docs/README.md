# Documentation

Start with the root [README](../README.md) for setup and [CONTRIBUTING](../CONTRIBUTING.md) for changes. [AGENTS.md](../AGENTS.md) holds coding and release rules; task playbooks are under [`.agents/skills/`](../.agents/skills/).

[Testing](testing.md) covers persistent local e2e servers, synthetic credentials and focused runs.

For repeatable maintenance, invoke `$repo-health`, `$docs-and-architecture` or `$dependency-maintenance`. Their playbooks live in [`.agents/skills/`](../.agents/skills/) and are registered in [AGENTS.md](../AGENTS.md).

## How the application works

Every binder is native slot storage, signed-out guests are read-only, and native reads and storage commands are admitted over the app, REST and MCP. Use these guides for current behaviour.

- [Architecture](architecture.md): ownership boundaries, startup, writes, offline sync and integrations.
- [Public routing](app-routing.md): `/app`, Framer/Vercel proxying, binder slug URLs, auth, PWA scope and legacy URLs.
- [Public API capability inventory](public-api/coverage.md) and [agent-readable API docs](public-api/agent-docs.md): REST/MCP coverage, app-only boundaries, generated Markdown, `llms.txt` and OpenAPI discovery. [API smoke checks](api-smoke.md) cover the hosted runner.
- [Native developer operations](native-developer-operations.md) and [native developer reads](native-developer-read.md): command and redacted read contracts.
- [Transactional collection history](transactional-collection-audit.md) and [Collection Activity](collection-activity-ui.md): history rows, projected changes and the Activity view.
- [Multiple binders](multiple-binders.md), [binder history](binder-history.md), [collection import](collection-import.md), [set and variant checklists](set-preset-checklists.md).
- [Card catalog](card-catalog.md), [card image store](card-image-store.md), [pricing coverage](card-pricing-coverage.md).
- [OCR and card scanning](card-scanning.md) and [scan destination review](scan-destinations.md): on-device text recognition, visual matching, binder-page detection and offline limits.
- [Billing](billing.md): server-owned entitlements, free allowances, Premium trials and Stripe reconciliation.
- [Passkeys](passkeys.md), [Google Analytics](google-analytics.md), [collector funnel](collector-funnel.md).
- [Database migrations](../scripts/MIGRATIONS.md): historical schema, fresh-project prerequisites and execution requirements.

## Native storage design and rollout records

These were written while native storage shipped in stages. Many describe gates, fixed `503` admission, harness-only wiring or legacy compatibility that no longer apply: every binder is now native, the legacy `pokemon_collection` client model and legacy row Undo are removed, and native REST/MCP admission is enabled. They remain useful for invariants, SQL contracts and proofs. Check current source before relying on any availability statement.

- Storage and commands: [inventory storage migration](inventory-storage-migration.md), [inventory contracts](inventory-contracts.md), [editable binder contracts](binder-slot-contracts.md), [trusted storage execution](trusted-storage-execution.md), [atomic slot operations](atomic-slot-operations.md), [atomic inventory operations](atomic-inventory-operations.md), [atomic insert plus assign](atomic-insert-assign.md), [atomic storage creation](atomic-storage-creation.md), [atomic arrangement import](atomic-arrangement-import.md), [browser command transport](browser-command-transport.md), [native command reconciliation](native-command-reconciliation.md), [native direct server handoff](native-direct-server-handoff.md), [auth account native cascade](auth-account-native-cascade.md).
- Reads and app hosting: [complete inventory reads](inventory-complete-read.md), [inventory collection projection](inventory-collection-projection.md), [Inventory browse](inventory-browse.md), [collection navigation](collection-navigation.md), [binder browser host](binder-browser-host.md), [ordered-slot display](binder-slot-display.md), [native grid hit targets](native-grid-hit-targets.md), [native cached startup](native-cached-startup.md), [slot and inventory offline intent](slot-inventory-offline.md), [native search and Show consumers](native-search-show-consumers.md), [native analytics dashboard](native-analytics-dashboard.md), [public binder compatibility](public-binder-compatibility.md), [private-preserving inventory proof](private-preserving-inventory-proof.md).
- Editing UI: [explicit-slot picker](explicit-slot-picker.md), [Edit layout](explicit-slot-layout-editing.md), [bulk layout](bulk-slot-layout-editing.md), [bulk fill](bulk-slot-fill.md), [slot removal review](slot-removal-review.md), [inventory ownership actions](inventory-ownership-actions.md), [manual grading](manual-grading.md), [Slabs rendering](slab-rendering.md).
- Creation: [custom storage creation](custom-storage-creation.md), [preset creation preview](preset-creation-preview.md), [preset developer preview](preset-developer-preview.md), [durable copied-preset creation](durable-copied-preset-creation.md), [empty-owner first creation](empty-owner-first-creation.md), [native creation recovery](native-collection-creation-recovery.md), [explicit default creation recovery](explicit-default-creation-recovery.md), [creation/import terminal noncommit](creation-import-terminal-noncommit.md), [binder JSON v2 backup](binder-backup-v2.md).
- Deletion and recovery: [native collection deletion](native-collection-deletion.md), [safe collection recovery](safe-collection-recovery.md), [native Activity recovery UI](native-activity-recovery-ui.md), [collection recovery performance](collection-recovery-performance.md), [converted content recovery](converted-content-recovery.md), [converted cascade recovery](converted-cascade-recovery.md), [converted recovery performance](converted-recovery-performance.md), [raw content restore](raw-content-restore.md) with its [v2](raw-content-restore-v2-proof.md), [v3](raw-content-restore-v3-proof.md) and [v4](raw-content-restore-v4-proof.md) proofs.
- Legacy transition: [legacy queue engine](legacy-queue-engine.md), [legacy queue staged runtime](legacy-queue-staged-runtime.md), [legacy write fence](legacy-write-fence.md).

## Feature delivery

[Task progress](../.agents/skills/task-progress/SKILL.md) keeps issues, acceptance checklists, parent tasks and project status aligned throughout implementation and release.

Every feature includes its API/docs under [feature-api-docs](../.agents/skills/feature-api-docs/SKILL.md). After merging and verifying a user-facing feature block on main, complete [CMS release posts and changelog](../.agents/skills/release-posts-and-changelog/SKILL.md) and [Framer feature-page updates/publication](../.agents/skills/framer-feature-updates/SKILL.md). [Release-and-deploy](../.agents/skills/release-and-deploy/SKILL.md) connects the workflows and records pending channels honestly.

## Publication and attribution

- [Open-source readiness](open-source-readiness.md): audited scope, decisions, history scrub and remaining publication gates.
- [Third-party notices](../THIRD_PARTY_NOTICES.md): sources and licenses for copied code, fonts, icons and artwork.
- [Asset provenance](asset-provenance.md): what is known about stored images and their derivatives.
- [Security](../SECURITY.md): private vulnerability reporting and disclosure handling.

## Historical records

Files in `superpowers/plans/` and `superpowers/specs/`, [the rebrand checklist](holo-folder-rebrand.md), [the modal scroll audit](modal-scroll-audit.md) and [the Delta Reign investigation](delta-reign.md) record earlier decisions or investigations. They may describe old pricing, routing, feature gates or incomplete verification. Use current source and the maintained guides above for present behaviour. Do not treat an old rollout note as a standing production instruction.
