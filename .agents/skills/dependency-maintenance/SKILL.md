---
name: dependency-maintenance
description: Use when updating or removing Holo Folder dependencies, responding to Dependabot/security advisories, or checking a native-library upgrade. Not a general code refactor or a request to change pricing/provider behavior.
---

# Dependency maintenance

Make the smallest dependency change that resolves the demonstrated issue. Use [AGENTS.md](../../../AGENTS.md) and [release-and-deploy](../release-and-deploy/SKILL.md) for current validation and shipping rules.

## Establish what needs changing

- Read the upstream advisory and release/runtime compatibility notes. Record the affected package, vulnerable range, first fixed version and actual call sites. An advisory is not evidence that this app was exploited.
- Inspect both `package.json` and `bun.lock`. A direct bump can leave a vulnerable framework-transitive copy. Verify the resolved graph and which copy a consumer actually loads, not just the manifest line.
- Before removing a dependency, search static imports, dynamic imports, scripts, tests, configuration, generated entry points and string-built module names. A static-import grep alone cannot establish that a package is unused.
- `bun run knip` (CI runs it) reports unused and unlisted dependencies. A dependency loaded only by name at runtime (for example `@workflow/world-postgres` via `WORKFLOW_TARGET_WORLD`) belongs in `ignoreDependencies` in `knip.jsonc` with a comment saying why; anything else knip flags gets removed, with `bun.lock` updated in the same change.
- Pin baseline failures to their source revision. Reproduce an apparent regression against unchanged main when ownership is unclear. Keep unrelated fixes and upgrades in separate PRs.

## Validate the contract

Use focused checks that exercise the affected behavior, plus the repository's required gates. Do not turn every package bump into a full e2e run.

For a native image-library update:

- Inspect the loaded native versions as well as the JS package. For Sharp, `node -e 'console.log(require("sharp").versions)'` identifies its loaded libvips/decoder versions. Inspect resolution from framework consumers too. Local macOS binaries do not establish which Linux binaries a deployment loaded.
- Exercise the app's resize/format path with synthetic image data, and check output dimensions/format. Keep fixtures synthetic; do not download a card image bundle for an upgrade test.
- If a generated-image test fails, compare encoded bytes, metadata, decoded dimensions/channels and pixels separately. Decide what the test is protecting. For a visual-content contract, compare decoded content; for an explicit byte/hash contract, retain that contract and investigate the changed encoding.
- Regenerate committed assets only when their intended output changed. Do not refresh all icons merely to hide an encoder-metadata difference or weaken the content checks to make the suite green.

For other dependencies, choose the relevant caller/contract tests rather than copying the image checklist. If provider interpretation or price confidence changes, also use [pricing-signal-changes](../pricing-signal-changes/SKILL.md).

## Review and ship

Review the manifest/lockfile delta for unrelated churn, remaining vulnerable copies, runtime requirements and license changes. Update [third-party notices](../../../THIRD_PARTY_NOTICES.md) when attribution or licensing changes; do not relicense upstream code or binaries under the app license.

Report the reason for the version/removal, affected behavior, validation at the current PR head and remaining proof limits. A known baseline failure remains a limitation, not a passing test. A local native check and an HTTP resize response are useful evidence but do not prove provider ingestion, every platform or full browser behavior.

Example: an icon comparison differs in six encoded bytes but has identical dimensions and decoded pixels. Preserve the images, check the encoding contract, and keep strict pixel/dimension assertions if the test protects visual content.

Finish through [release-and-deploy](../release-and-deploy/SKILL.md): prepare locally before the first push, respect exact-head checks and reviews. This skill does not grant permission to upgrade unrelated packages or bypass a failing build.
