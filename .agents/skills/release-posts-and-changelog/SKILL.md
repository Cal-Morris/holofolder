---
name: release-posts-and-changelog
description: Publish Holo Folder feature-block release posts and the Framer CMS-backed changelog after merged main is verified deployed and enabled.
---

# Release posts and changelog

Complete this workflow after each user-facing feature block. Group related implementation PRs into a coherent release, not one article per migration. API/docs still ship with every feature under [feature-api-docs](../feature-api-docs/SKILL.md). Coordinate evergreen copy using [framer-feature-updates](../framer-feature-updates/SKILL.md), ideally in the same scoped Framer publication.

Cal's standing instruction authorizes merging ready feature PRs and publishing their matching marketing updates after production verification. It does not authorize announcing planned/hidden features or publishing unrelated collaborator edits.

## Release evidence first

Use [release-and-deploy](../release-and-deploy/SKILL.md). Record included issues/PRs, merged main SHA, successful production deployment and enabled behavior, live API/help URLs, access/rollout limits and demo screenshots. A green preview or merge alone is insufficient. A quota-blocked merge remains **merged, deployment pending**; drafts can be prepared, announcements wait.

## Use the existing Framer CMS

Open/reuse the connected Holo Folder Framer project `XORHOjHtiVkI2Vplan8k`. Use its connected tools, not a replacement CMS, hardcoded article array or obsolete CLI. Read current README/context, relevant workflow/tree/CMS/publishing references and project skills before edits. Read current nodes again to preserve hand edits.

Verified 2026-11-09, rediscover rather than assuming IDs remain unchanged:

- Blog collection `ZAjSbj4xJ`, 49 existing items; `/blog` and detail route `/blog/:ZAjSbj4xJ`.
- Fields: Title, Summary, Category, Published, Article, Slug, Content type, Article artwork, Editorial cover, Listing title and Listing summary. Published is a date field, not proof of actual publication or a Draft/Live switch.
- No `/changelog` page existed at inspection. Issue #393 owns its initial CMS-backed index and visible navigation/footer link. First delivery must implement/verify that surface, not claim it already exists.

1. Inspect existing fields, defaults, items, publication state, listing filters and detail bindings. Reuse the existing release category/content-type convention, adding only the needed value/field if absent. Preserve all unrelated items, field IDs, slugs, relationships, styles and bindings.
2. Find an existing post by feature-block issue/slug before creating another, so retries update the same release. Write a concrete title, summary, release date and rich-text body explaining what changed, how to use it, examples, availability and live API/help/app links. Use actual rich-text blocks rather than Markdown-looking plain strings. Preserve image licensing and use demo/synthetic screenshots without private inventory/certs.
3. Make `/changelog` a newest-first filtered Collection List over the same release items, with empty state and pagination as needed. Link full posts to their existing blog detail URLs, avoiding duplicate canonical articles. Verify draft/future/non-release items are excluded without disturbing ordinary blog/set-guide listings. Keep publication state separate from displayed release date.
4. Verify representative CMS detail and index rendering, dates, title/summary, links, metadata/canonical URLs and phone layouts. Follow the current Framer diagnostics and responsive verification guidance. Do not use a new app runtime to reproduce Framer's CMS.
5. Publish through the sequence in [framer-feature-updates](../framer-feature-updates/SKILL.md#publish-and-verify). Preserve explicit pending status if capabilities, main-branch merge, permissions or deployment prevent publication. No blind retries after partial writes.
6. Verify the live `/changelog` entry, blog detail URL and navigation link. Record the CMS item/slug, Framer version, URLs and included app SHA on the feature-block issue/project. Keep it open or clearly publication-pending until these checks pass.

Internal-only PRs can contribute to their feature block's draft. Do not manufacture customer news for skill/docs maintenance that changes no product capability.
