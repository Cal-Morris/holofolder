# Documentation

Start with the root [README](../README.md) for setup and [CONTRIBUTING](../CONTRIBUTING.md) for changes. [AGENTS.md](../AGENTS.md) holds coding and release rules; task playbooks are under [`.agents/skills/`](../.agents/skills/).

[Testing](testing.md) covers persistent local e2e servers, synthetic credentials and focused runs.

## How the application works

- [Architecture](architecture.md): ownership boundaries, startup, writes, offline sync and integrations.
- [Public routing](app-routing.md): `/app`, Framer/Vercel proxying, auth, PWA scope and legacy URLs.
- [Multiple binders](multiple-binders.md), [binder history](binder-history.md), [collection import](collection-import.md).
- [Card catalog](card-catalog.md), [card image store](card-image-store.md), [pricing coverage](card-pricing-coverage.md).
- [Billing](billing.md): server-owned entitlements, free allowances, Premium trials and Stripe reconciliation.
- [Google Analytics](google-analytics.md), [collector funnel](collector-funnel.md): separate telemetry systems and their privacy/configuration boundaries.
- [Database migrations](../scripts/MIGRATIONS.md): historical schema, fresh-project prerequisites and execution requirements.

## Publication and attribution

- [Open-source readiness](open-source-readiness.md): audited scope, decisions, history scrub and remaining publication gates.
- [Third-party notices](../THIRD_PARTY_NOTICES.md): sources and licenses for copied code, fonts, icons and artwork.
- [Asset provenance](asset-provenance.md): what is known about stored images and their derivatives.
- [Security](../SECURITY.md): private vulnerability reporting and disclosure handling.

## Historical records

Files in `superpowers/plans/` and `superpowers/specs/`, [the rebrand checklist](holo-folder-rebrand.md), [the modal scroll audit](modal-scroll-audit.md) and [the Delta Reign investigation](delta-reign.md) record earlier decisions or investigations. They may describe old pricing, routing, feature gates or incomplete verification. Use current source and the maintained guides above for present behaviour. Do not treat an old rollout note as a standing production instruction.
