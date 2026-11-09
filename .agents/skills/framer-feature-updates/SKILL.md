---
name: framer-feature-updates
description: Keep Holo Folder Framer feature pages, homepage, navigation, CMS and marketing claims aligned with each verified shipped feature block on main.
---

# Framer feature updates

After each user-facing feature block, update and publish the affected marketing surfaces alongside [release-posts-and-changelog](../release-posts-and-changelog/SKILL.md). [Feature API/docs](../feature-api-docs/SKILL.md) is required per feature before merge. This is ongoing delivery work, not a one-time redesign or an instruction to implement every planned feature now.

## Ground claims in the running product

Inspect the exact merged main diff, current implementation, feature exposure and production proof from [release-and-deploy](../release-and-deploy/SKILL.md). Map changed behavior to homepage/features index, relevant `/features/*` and `/for/*` pages, pricing/FAQ/help, screenshots, SEO and CTAs. Update affected surfaces, not every page indiscriminately. Remove obsolete claims as well as adding new ones. Preserve accurate plan/allowance, partner, privacy, offline and provider limitations.

Current boundaries: Framer serves `https://holofolder.com`; `/app` and `/app/*` proxy to the Vercel app. Read `docs/app-routing.md` and current config before changing links. Marketing paths remain on Framer; app/docs links retain `/app`. Preserve proxy rules, auth returns, PWA scope and existing URLs.

## Inspect and edit in Framer

- Use the connected Framer tools for project `XORHOjHtiVkI2Vplan8k`. Reuse a valid session; otherwise open it. Read README/context, relevant project skills (including `use-holo-folder-context`), workflow and API references before changing state. Follow the project's current capabilities rather than copying API calls from another SDK.
- Inspect the active branch, current target nodes and CMS source bindings. Verified 2026-11-09: existing home, features index, feature/audience pages, Blog CMS `ZAjSbj4xJ`, AI/API/MCP feature page and developer audience page. This is a discovery starting point, not a frozen tree.
- Reuse current layout templates, styles, components/variants and CMS sources. Read relevant resource skills before reuse. For CMS-backed copy edit the source item, keeping bindings; for repeatable list content use Collection Lists. Do not detach shared components or replace CMS content with hardcoded cards to simplify an edit.
- Preserve collaborator edits. Make scoped text/asset/binding updates; add a page or CMS field only when the feature needs it. Preserve established slugs, metadata and component behavior. Framer main and Git main are separate: merging app code does not update the site. If working on a Framer branch, inspect/merge the intended branch into its base/main using the documented branch API before production publishing.
- Check changed pages at mobile widths 375, 390 and 430 plus desktop, including navigation, wrapping, tap targets, CTA destinations, CMS empty states, assets and factual claims. Use Framer's available diagnostics/screenshots or permitted browser verification; record any unverified behavior rather than implying screenshots prove interactions.

## Publish and verify

Cal explicitly requests publishing matching marketing changes after each shipped feature block; do not ask again for routine in-scope publication. A tool permission/capability failure is a concrete blocker, not an invitation to work around it.

1. Before mutation/publish inspect `api.getCapabilities()` and current `api.publishing.status()`. Review all included changes against the intended scope. If unrelated unpublished work cannot be excluded safely, leave the intended work pending and report the specific conflict; do not discard or publish someone else's changes silently.
2. On the intended main branch, resolve blocking diagnostics and call the documented `api.publishing.publish()`. A branch publication is only a branch preview. If staging is enabled, read status again and pass its exact staging version ID to `api.publishing.deployToProduction(versionId)`. Without staging, publishing from main targets production. Re-read current docs before these calls; generic SDK `publish/deploy` examples are not this connector's API.
3. Capture the returned target, version and production URLs. After a failure, read status and affected nodes before retrying: programs can partially apply. Never claim publication from an editor save or a successful preview alone.
4. Verify live changed copy, page/post/changelog URLs, metadata, images and app/API/help links. Keep API reference in the app's generated docs, link to it from Framer. Record app SHA/deployment, Framer version and live URLs on the feature-block issue/project.
5. Mark the block complete only when app/API/docs and matching marketing/release updates are live and verified. Otherwise state exactly which channel is pending. An internal-only block may explicitly record that no customer-facing site change is warranted; never invent a feature claim to satisfy a checkbox.
