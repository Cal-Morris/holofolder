---
name: docs-and-architecture
description: Use when updating Holo Folder's README or developer guides, checking documentation drift, or explaining current internals with architecture diagrams. Not a request to implement a proposed feature or redesign runtime state.
---

# Docs and architecture

Describe the implemented contract, with source anchors. Start from [the documentation index](../../../docs/README.md), [architecture](../../../docs/architecture.md) and [AGENTS.md](../../../AGENTS.md); inspect the relevant code rather than trusting a historical plan.

## Find the right source

| Question | Inspect |
|---|---|
| Public paths and entry URLs | `next.config.mjs`, `proxy.ts`, `lib/app-path.ts`, `docs/app-routing.md` |
| First paint and saved startup | `app/page.tsx`, `components/binder-start.tsx`, `lib/binder-start.ts` |
| Actor, collection owner and binder | `lib/server/collection-owner.ts`, `lib/server/binders.ts`, the API handler |
| Edit queue, conflicts and retries | `hooks/use-slot-offline-queue.ts`, `lib/collection/{slot-offline-queue,storage-command-browser,inventory-read-browser}.ts` |
| Offline shell versus data/image caches | `public/sw.js`, `components/offline-app-shell.tsx`, `lib/offline-store/` |
| Setup and synthetic test configuration | `.env.example`, `package.json`, `playwright.config.ts`, `docs/testing.md`, `scripts/MIGRATIONS.md` |
| Provider or billing boundary | `lib/card-pricing.ts`, `lib/server/billing*.ts`, relevant workflow and guide |

## Make the explanation maintainable

- Separate current behavior from proposals and historical rollout records. A plan is not evidence that an endpoint, auth scheme or feature exists. Keep unimplemented work visibly proposed.
- Keep the README's quick start short. Put extended test/operator commands in focused guides, and link them from `docs/README.md`. Update the relevant guide and index together.
- Check raw browser/fetch/admin URLs against the configured basePath. Next Link/router destinations and public raw URLs follow different rules; use the routing guide rather than globally replacing path strings.
- Distinguish actor, owner and binder. Show direct browser RLS reads separately from service-role API writes, and public catalog caching separately from personal state. Show offline recovery and unsuccessful writes where they change the user's outcome.
- Classify suspicious examples before changing them. Decode a known test placeholder and inspect its callers/mocks; its appearance is not proof of a leaked credential. Keep synthetic configuration visibly labelled and separate from real deployment setup.
- For copied code or assets, update [third-party notices](../../../THIRD_PARTY_NOTICES.md) and [provenance](../../../docs/asset-provenance.md). A source link establishes origin, not permission to redistribute.

## Diagrams and verification

Use editable Mermaid in Markdown for repository diagrams. Choose the view that answers the question: a component/data-flow graph for boundaries, a sequence for startup, or a recovery flow for sync. Keep labels conceptual and point readers to the implementing files. If a visual is requested in chat, also show it through the available visualization tools; a source file or screenshot path alone does not display it.

Validate diagram syntax, local links, referenced symbols and representative command paths. Match validation to the change: prose does not need a full local build/e2e run; a new setup claim needs actual setup evidence. Label mocked platform scaffolding, HTTP availability and full provider/browser integration as different evidence.

Example: an offline diagram shows the static app-shell fallback and scoped on-device data, not a cached personal HTML response. A proposed MCP service belongs in a proposal section until implementing routes exist.

A docs-only request changes documentation; report discovered runtime defects separately. Ship requested edits using [release-and-deploy](../release-and-deploy/SKILL.md), retaining any narrower user scope.
