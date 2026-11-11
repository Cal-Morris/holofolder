---
name: feature-api-docs
description: Ship Holo Folder feature API parity and current REST, MCP, OpenAPI, Markdown and help documentation with every feature delivery.
---

# Feature API and docs delivery

Run for every feature PR, before merge. API implementation and docs ship with the feature, never as an untracked follow-up. A feature block can contain several additive PRs, but every PR documents the contract it actually delivers. Use [release-and-deploy](../release-and-deploy/SKILL.md) for merge/deployment, and [docs-and-architecture](../docs-and-architecture/SKILL.md) for maintained repository guides.

## Inspect the implemented boundary

Read the exact feature diff, its shared server operation, callers and permission/entitlement checks. Build a short capability list covering reads, mutations, errors, conflict/version behavior, pagination, partner access, offline limits and any audit/recovery effects. Historical plans and issue checkboxes are intent, not evidence of deployed behavior.

Current entry points, verified 2026-11-11; recheck before editing:

- `lib/developer-api/operations.ts`: operation names, methods, paths, strict input schemas, permissions and descriptions.
- `lib/server/operations/` and `developer-dispatch.ts`: shared authoritative operations and dispatch; `app/api/v1/[...path]/route.ts` and `lib/server/mcp/`: REST/MCP adapters.
- `lib/server/developer-access/`: authentication, grants, current membership, limits and entitlement enforcement.
- `content/docs/`: Fumadocs MDX guides. `docs/public-api/coverage.md`: capability inventory and intentionally app/device/admin-only boundaries.
- `scripts/generate-api-docs.ts` generates `public/openapi.json`; `lib/docs-source.ts` derives reference pages from it. `lib/docs-markdown.ts`, `lib/docs-llms.tsx` and `docs/public-api/agent-docs.md` describe agent exports.

## Deliver together

1. Implement supported feature data operations through the existing shared operation/registry boundary. Preserve auth, owner/partner scope, billing, idempotency and audit guarantees across UI, REST and MCP. Document a concrete app-only/device-only/admin-only reason when an operation is intentionally excluded; do not silently omit parity.
2. Update input schemas, descriptions, permissions and actual response/error contracts with the implementation. Never invent response fields to make documentation look complete. Preserve compatibility or document the real migration/deprecation path.
3. Update the matching MDX guide/examples and user/operator help, plus `docs/public-api/coverage.md` when capabilities change. Explain how to use the feature and its current restrictions, including missing migration/provider/offline behavior where relevant. Examples use synthetic data and placeholders, never private cards, keys or certificates.
4. Run `bun scripts/generate-api-docs.ts` after registry changes and commit the generated `public/openapi.json` with them. Do not hand-maintain duplicate endpoint pages, agent exports or an API reference in Framer. Use `/app` in public raw URLs; REST keys and MCP OAuth remain distinct.
5. Run focused checks for touched contracts. Useful suites include `tests/developer-operations.test.ts`, `tests/developer-operation-round-trips.test.ts`, `tests/docs-openapi.test.ts`, `tests/docs-markdown.test.ts` and `tests/docs-routing.test.ts`. Choose relevant permission/conflict tests too. A full e2e suite is not the default.
6. In the feature PR, record operations/docs changed, generated output, verification and any intentional exclusion. After production deploy, verify the affected public `/app/docs`, `/app/openapi.json` and Markdown/LLM discovery links reflect the feature. Test authenticated behavior with a permitted test account without logging credentials.

A mismatch between behavior and its API/docs blocks feature completion. If access or deployment is blocked, record the exact remaining step on the owning issue instead of claiming parity is live. Hand the verified feature block to [release-posts-and-changelog](../release-posts-and-changelog/SKILL.md) and [framer-feature-updates](../framer-feature-updates/SKILL.md).
