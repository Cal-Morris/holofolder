# Documentation

Start with the root [README](../README.md) for setup and [CONTRIBUTING](../CONTRIBUTING.md) for changes. [AGENTS.md](../AGENTS.md) holds coding and release rules; task playbooks are under [`.agents/skills/`](../.agents/skills/).

[Testing](testing.md) covers persistent local e2e servers, synthetic credentials and focused runs.

For repeatable maintenance, invoke `$repo-health`, `$docs-and-architecture` or `$dependency-maintenance`. Their playbooks live in [`.agents/skills/`](../.agents/skills/) and are registered in [AGENTS.md](../AGENTS.md).

## How the application works

- [Architecture](architecture.md): ownership boundaries, startup, writes, offline sync and integrations.
- [Agent-readable API docs](public-api/agent-docs.md): generated Markdown, `llms.txt`, full-text exports and OpenAPI discovery.
- [Public routing](app-routing.md): `/app`, Framer/Vercel proxying, auth, PWA scope and legacy URLs.
- [Editable binder contracts](binder-slot-contracts.md): internal slot/snapshot, target/matching, copied preset and pure layout contracts, with explicit adapter and rollout boundaries.
- [Multiple binders](multiple-binders.md), [binder history](binder-history.md), [collection import](collection-import.md).
- [Card catalog](card-catalog.md), [card image store](card-image-store.md), [pricing coverage](card-pricing-coverage.md).
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
