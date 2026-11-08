# Open-source readiness

The preparation changes listed below are merged. The repository remains private. Publication still needs the asset-rights decisions and final hosted settings listed below.

## Decisions

- Original code: **AGPL-3.0-only**, selected by the maintainer on 2026-11-08. See [LICENSE](../LICENSE).
- Preserve original commits, author/committer identities and signatures. The maintainer explicitly confirmed that their email identities may remain. Rewrite history only if actual sensitive content requires removal, and rehearse that separately first.
- Keep third-party licenses and source attribution separate from the project code license. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and [asset provenance](asset-provenance.md).
- Preparation does not authorize making the repository public or force-pushing rewritten history.

## Audit snapshot, 2026-11-08

The initial remote snapshot had 298 branches, no tags and 321 PR head refs plus one available PR merge ref. A non-shallow mirror contained 813 reachable commits. The local checkout also contained historical worktree/checkpoint refs, which were scanned separately.

Gitleaks 8.30.1 scanned remote and local git history with its default rules, redaction and inline allow comments disabled. A separate object inventory exported and scanned every unique reachable text blob, including merge snapshots: **3,784 unique blobs**, about 97.7 MB of text. Supplemental searches checked credential-bearing URLs, private keys, JWTs, provider token prefixes, project hostnames, personal emails and home-directory paths in file content.

No credentials were identified. All 18 full-blob Gitleaks findings were independently verified as the literal localStorage key `pokemon_collection_pending_ops_v1`. The checked-in configuration permits only that exact value in its two known source paths, while retaining all default rules. This is a bounded scan result, not proof that no secret can exist.

No tracked environment files other than `.env.example`, database dumps, private keys, HAR files or collection exports were found by the path inventory. GitHub reported no Actions artifacts or release assets, and no wiki or Pages site. Commit author/committer metadata contains the maintainer's email identities, which the maintainer has explicitly chosen to preserve along with signatures. Those git scans do not cover hosted conversations/logs or content outside reachable refs. The additional hosted checks and remaining limits are recorded below.

## Repeating the secret scan

Install [Gitleaks](https://github.com/gitleaks/gitleaks), then run `bun run scan:secrets` after committing locally. The command scans locally fetched refs. It does not fetch omitted refs or inspect uncommitted files. Reports and exported blobs belong in a private directory outside the repository; do not commit them.

Before publication, create a fresh private mirror and fetch PR refs as well as branches/tags:

```sh
git clone --mirror https://github.com/Cal-Morris/binderdex.git /private/path/repository.git
git -C /private/path/repository.git fetch origin \
  '+refs/pull/*/head:refs/pull/*/head' \
  '+refs/pull/*/merge:refs/pull/*/merge'
gitleaks git /private/path/repository.git --log-opts=--all --redact \
  --ignore-gitleaks-allow --config /path/to/checkout/.gitleaks.toml
```

Also scan an export of the current committed tree and every reachable blob. Git diff scanning alone is insufficient for a merge snapshot audit. Keep a ref/object inventory and the exact source commit alongside the private results.

## History preservation

No credential-driven rewrite is currently warranted. Preserve the original commit identities, signatures and graph. The live remote has not been rewritten.

If actual sensitive content is later found, rotate exposed credentials first and preserve a private backup. Rehearse the narrow removal in a separate mirror. Review all affected branches, tags and PR refs, and obtain explicit approval before force-pushing. A rewrite changes descendant SHAs and invalidates affected signatures, so it cannot preserve the current signed history.

Do not use an unreviewed `git push --mirror`: it can delete unrelated refs and GitHub does not allow clients to overwrite PR refs. [GitHub's removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) covers PR caches, forks, support limitations and cleanup of other clones. A branch rewrite alone does not remove old PR conversations, patches, Actions logs or copies elsewhere.

## Publication gates

- [x] Choose and add the project code license.
- [x] Add contributor instructions and private security-reporting guidance.
- [x] Preserve vendored skill notices and add copied UI, icon, font and card-data notices.
- [x] Trace bundled card previews to exact printings and illustrators.
- [ ] Resolve permissions or replace/exclude bundled Pokémon art and historical starter assets. Project branding provenance is documented, but original creation records remain incomplete.
- [x] Repair and verify the documented migration sequence on isolated PostgreSQL with synthetic Supabase auth/storage scaffolding; publish an architecture guide and documentation index. A complete Supabase Auth/Storage smoke test remains outstanding.
- [x] Require explicit GA and Stripe setup configuration, use the configured billing return origin, and retain the hosted GA property through Vercel configuration.
- [x] Confirm that original identities, signatures and history should remain. No credentials requiring a history rewrite were identified.
- [x] Scan the exported hosted issue/PR descriptions and comments, and all available GitHub Actions log archives. See scope and limits below.
- [x] Verify read-only Actions tokens and enable/verify Vercel fork protection. No forks, release assets, Actions artifacts, wiki or Pages site were present in the inspected snapshot.
- [ ] Isolate preview credentials before approving untrusted fork builds. The current integrations include server credentials with shared Production/Preview/Development targets; deployment approval runs submitted code with its configured environment.
- [ ] At publication, confirm collaborator access and enable available secret scanning, push protection, private vulnerability reporting and fork workflow approval. The private-repository APIs do not expose all of these settings today.
- [ ] Validate the final source revision, refresh the history scan and obtain explicit approval to make the repository public.

The code license does not publish production user data, credential files, provider subscriptions or the Framer marketing site. Keep `package.json` private to prevent accidental package publication; that flag does not prevent open-source licensing.

## Preparation changes

| Change | Pull request |
|---|---|
| AGPL, full third-party notices, source attribution, contributor/security docs and architecture guide | [#328](https://github.com/Cal-Morris/binderdex/pull/328) |
| Signed-in and anonymous shared-viewer test coverage | [#330](https://github.com/Cal-Morris/binderdex/pull/330) |
| Fresh database bootstrap/replay fixes and a local-only regression verifier | [#331](https://github.com/Cal-Morris/binderdex/pull/331) |
| Patched Sharp native dependencies, with decoded-pixel icon verification | [#334](https://github.com/Cal-Morris/binderdex/pull/334) |
| Unused Select primitive, direct dependency and lockfile cleanup | [#335](https://github.com/Cal-Morris/binderdex/pull/335) |
| Explicit analytics/billing configuration and updated integration docs | [#336](https://github.com/Cal-Morris/binderdex/pull/336) |

The architecture pass traced startup, ownership/authorization, collection conflict/retry paths, public catalog/images and billing configuration. It found setup failures, hosted-only assumptions and one unused module/dependency. It did not justify a broad rewrite of the large stateful components. The remaining 59 lint warnings are unchanged; this is not a claim of a line-by-line security audit of every module.

## Final audit refresh and limits

The 18:23 UTC history/object refresh covered **837 reachable remote commits** plus additional local refs, **3,888 unique blobs** and about **99.3 MB of text**. All 18 full-blob findings were again confirmed as the same non-secret localStorage key. No credential requiring rotation or history removal was identified. This snapshot precedes the final preparation merges; rerun the scan immediately before publication, especially while other feature branches continue to change.

The hosted export included 329 issue/PR records, 335 conversation comments, no inline review comments and no review bodies. Gitleaks scanned those exports plus 101 downloaded workflow log archives, about 7.28 MB total, with no findings. Another 17 log archives were unavailable; an inspected failure returned HTTP 410. No Git LFS configuration/pointers or submodule configuration appeared in the path/text inventory. Unreachable server-side objects, deleted conversations, inaccessible logs, other people's caches and runtime provider databases are outside this evidence.

The Sharp update loads 0.35.5 with libvips 8.18.7 and librsvg 2.63.2. Native PNG-to-WebP conversion, focused image/icon tests and a production build passed. GitHub reported no remaining open Dependabot alerts after the merge. Application image files were not regenerated; the changed encoder's PNG bytes decoded to the same pixels.

No full e2e suite, browser/PWA run, live payment, provider ingestion check or production user-data migration was performed for preparation. SQL checks used an isolated local database, not the hosted Supabase project. Existing signed commits and the working checkout's unrelated plan edits were preserved.
