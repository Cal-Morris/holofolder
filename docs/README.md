# Documentation

Start with the root [README](../README.md) for setup and [CONTRIBUTING](../CONTRIBUTING.md) for changes. [AGENTS.md](../AGENTS.md) holds coding and release rules; task playbooks are under [`.agents/skills/`](../.agents/skills/).

[Testing](testing.md) covers persistent local e2e servers, synthetic credentials and focused runs.

For repeatable maintenance, invoke `$repo-health`, `$docs-and-architecture` or `$dependency-maintenance`. Their playbooks live in [`.agents/skills/`](../.agents/skills/) and are registered in [AGENTS.md](../AGENTS.md).

## How the application works

- [Atomic arrangement import](atomic-arrangement-import.md): bounded JSON v2 execution, explicit copies/moves, native recovery and remaining restore/admission gates (088).

- [Architecture](architecture.md): ownership boundaries, startup, writes, offline sync and integrations.
- [Staged native developer reads](native-developer-read.md): verified key/OAuth authority, redacted copy/storage/slot projections and revision-bound pages, with fixed rollout denial.
- [Agent-readable API docs](public-api/agent-docs.md): generated Markdown, `llms.txt`, full-text exports and OpenAPI discovery.
- [Public routing](app-routing.md): `/app`, Framer/Vercel proxying, auth, PWA scope and legacy URLs.
- [Staged atomic slot operations](atomic-slot-operations.md): disabled structural commands, revisioned pages, billing/legacy compatibility and audit/offline/API/recovery gates.
- [Staged atomic inventory operations](atomic-inventory-operations.md): exclusive full-collection deletion bounds, Unassigned retention, audit/recovery proof and unsupported payload/latency gates (#383).
- [Converted ordinary-edit recovery](converted-content-recovery.md): unchanged conversion provenance, frozen-source dependencies, local proof and explicit remaining recovery gates (080).
- [Staged safe collection recovery](safe-collection-recovery.md): private reviewed inverse/apply, linked immutable history, local proof and remaining Activity/API/legacy rollout gates (#396).
- [Native cached startup preparation](native-cached-startup.md): local-only canonical queue/metadata relaunch, inherited device-session and partner-cache policy, cached-only rendering and reconnect fences. Production admission remains denied.
- [Staged collection navigation](collection-navigation.md): scoped local view state, deep links/history, stable location refresh and explicit authenticated transport/rollout blockers.
- [Staged native analytics and dashboard](native-analytics-dashboard.md): copy totals, current targets, saved reliable raw value, cached-only display and the legacy API authority boundary.
- [Read-only Inventory browse preparation](inventory-browse.md): complete/cached evidence, per-copy queries/current locations, local-only synthetic harness and authenticated binding/navigation gates.
- [Explicit-slot picker preparation](explicit-slot-picker.md): private parsed-intent callback, synthetic UI proof, cached non-dex search and remaining authenticated/queue/rollout gates (#366).
- [Editable binder contracts](binder-slot-contracts.md): internal slot/snapshot, target/matching, copied preset and pure layout contracts, with explicit adapter and rollout boundaries.
- [Collection Activity](collection-activity-ui.md): first-party session adapter, read-only history, private device cache and parent release handoff.
- [Multiple binders](multiple-binders.md), [binder history](binder-history.md), [collection import](collection-import.md).
- [Card catalog](card-catalog.md), [card image store](card-image-store.md), [pricing coverage](card-pricing-coverage.md).
- [OCR and card scanning](card-scanning.md): on-device text recognition, visual matching, binder-page detection and offline limits.
- [Billing](billing.md): server-owned entitlements, free allowances, Premium trials and Stripe reconciliation.
- [Google Analytics](google-analytics.md), [collector funnel](collector-funnel.md): separate telemetry systems and their privacy/configuration boundaries.
- [Database migrations](../scripts/MIGRATIONS.md): historical schema, fresh-project prerequisites and execution requirements.

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

- [Staged slot/inventory offline intent](slot-inventory-offline.md): private durable queue, complete reads, reconciliation and rollout boundaries (#363).

- [Staged scanner destination acceptance](scan-destinations.md): opt-in card/page scanner wiring, captured stable IDs, durable confirmed batches and unresolved append/host/runtime gates (#375).

- [Staged Slabs renderer/gallery](slab-rendering.md): explicit provider/version layouts, safe DTOs, navigation and the remaining #389/#390/#379 gates.
