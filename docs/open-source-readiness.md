# Open-source readiness

Preparation is in progress. The repository remains private. Do not change visibility until the publication gates below are resolved.

## Decisions

- Original code: **AGPL-3.0-only**, selected by the maintainer on 2026-11-08. See [LICENSE](../LICENSE).
- Preserve original commits, author/committer identities and signatures. The maintainer explicitly confirmed that their email identities may remain. Rewrite history only if actual sensitive content requires removal, and rehearse that separately first.
- Keep third-party licenses and source attribution separate from the project code license. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and [asset provenance](asset-provenance.md).
- Preparation does not authorize making the repository public or force-pushing rewritten history.

## Audit snapshot, 2026-11-08

The initial remote snapshot had 298 branches, no tags and 321 PR head refs plus one available PR merge ref. A non-shallow mirror contained 813 reachable commits. The local checkout also contained historical worktree/checkpoint refs, which were scanned separately.

Gitleaks 8.30.1 scanned remote and local git history with its default rules, redaction and inline allow comments disabled. A separate object inventory exported and scanned every unique reachable text blob, including merge snapshots: **3,784 unique blobs**, about 97.7 MB of text. Supplemental searches checked credential-bearing URLs, private keys, JWTs, provider token prefixes, project hostnames, personal emails and home-directory paths in file content.

No credentials were identified. All 18 full-blob Gitleaks findings were independently verified as the literal localStorage key `pokemon_collection_pending_ops_v1`. The checked-in configuration permits only that exact value in its two known source paths, while retaining all default rules. This is a bounded scan result, not proof that no secret can exist.

No tracked environment files other than `.env.example`, database dumps, private keys, HAR files or collection exports were found by the path inventory. GitHub reported no Actions artifacts or release assets, and no wiki or Pages site. Commit author/committer metadata contains the maintainer's email identities, which the maintainer has explicitly chosen to preserve along with signatures. PR/issue bodies, review comments, Actions logs, Git LFS content and third-party forks/caches were not comprehensively inspected by the git scan.

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

No credential-driven rewrite is currently warranted. An email-only scrub was rehearsed locally and then abandoned after the maintainer confirmed the original identities and signatures should remain. The live remote was never rewritten. Do not apply the sanitized rehearsal mirror.

If actual sensitive content is later found, rotate exposed credentials first and preserve a private backup. Rehearse the narrow removal in a separate mirror. Review all affected branches, tags and PR refs, and obtain explicit approval before force-pushing. A rewrite changes descendant SHAs and invalidates affected signatures, so it cannot preserve the current signed history.

Do not use an unreviewed `git push --mirror`: it can delete unrelated refs and GitHub does not allow clients to overwrite PR refs. [GitHub's removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) covers PR caches, forks, support limitations and cleanup of other clones. A branch rewrite alone does not remove old PR conversations, patches, Actions logs or copies elsewhere.

## Publication gates

- [x] Choose and add the project code license.
- [x] Add contributor instructions and private security-reporting guidance.
- [x] Preserve vendored skill notices and add copied UI, icon, font and card-data notices.
- [x] Trace bundled card previews to exact printings and illustrators.
- [ ] Resolve permissions or replace/exclude bundled Pokémon art and historical starter assets. Project branding provenance is documented, but original creation records remain incomplete.
- [ ] Verify fresh-project database setup and align setup/architecture docs with current code.
- [ ] Remove or explicitly configure hosted-only integration assumptions for forks, including analytics, Stripe setup and billing return URLs.
- [x] Confirm that original identities, signatures and history should remain. No credentials requiring a history rewrite were identified.
- [ ] Inspect PR/issue conversations, review comments, Actions logs, LFS objects and any other hosted attachments for private material.
- [ ] Review collaborator access, fork state, Actions permissions and Vercel preview access for untrusted public contributions. Enable available secret scanning, push protection and private vulnerability reporting.
- [ ] Validate the final source revision, refresh the history scan and obtain explicit approval to make the repository public.

The code license does not publish production user data, credential files, provider subscriptions or the Framer marketing site. Keep `package.json` private to prevent accidental package publication; that flag does not prevent open-source licensing.
