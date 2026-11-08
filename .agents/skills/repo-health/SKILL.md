---
name: repo-health
description: Use when Cal asks for a repository sitrep, current health, release status, remaining technical debt, or whether Holo Folder is ready to publish. Not a feature implementation or an instruction to fix every finding.
---

# Repository health

Give a current, evidence-backed snapshot. This workflow is read-only; preserve dirty files and the user's branch. Read [AGENTS.md](../../../AGENTS.md) for the current release policy.

## Capture the source revision

Fetch the remote, record `origin/main` and inspect local branch/status separately. Pin subsequent checks to that SHA so concurrent merges do not mix evidence.

```sh
git fetch origin --prune
health_repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
health_sha=$(git rev-parse origin/main)
git status --short --branch
gh api "repos/$health_repo/commits/$health_sha/status" --jq '{sha,state,statuses:[.statuses[]|{context,state,description}]}'
gh api "repos/$health_repo/commits/$health_sha/check-runs" --jq '[.check_runs[]|{name,status,conclusion}]'
gh pr list --state open --json number,title,headRefName,isDraft,url
gh api "repos/$health_repo/dependabot/alerts?state=open&per_page=100" --paginate --jq '.[]|{number,severity:.security_advisory.severity,package:.dependency.package.name}'
```

If an endpoint fails or access is missing, report that evidence as unavailable. An empty successful alert response means no open alerts; an authorization error does not.

## Fill the gaps proportionately

- Match CI and production deployment evidence to the captured SHA. A preview success is not proof that production deployed it.
- For local tests/lint, record the command and tested revision. Reuse earlier results only with their revision/age stated. When fresh checks are useful, use a clean agent-owned worktree; do not switch the user's dirty checkout or copy production env files into it.
- Read `package.json` for the current warning cap. Report warnings and errors separately. A passing ratchet is not zero debt.
- Use [app-routing.md](../../../docs/app-routing.md) for the public URL. An anonymous HTTP 200 after redirects checks availability, not signed-in, offline or PWA behavior. No full e2e/browser run by default.
- For publication readiness, inspect [open-source-readiness.md](../../../docs/open-source-readiness.md), [asset provenance](../../../docs/asset-provenance.md) and actual settings evidence. A zero-finding scan of `main` does not cover old branches, PR refs, logs or inaccessible objects. Do not start a full history audit for an ordinary status request.

## Return a useful sitrep

Lead with the health verdict. Include current main/deployment status, PR and dependency-alert blockers, validation with its source revision, material maintenance debt, and the remaining publication decisions. Mention an old/dirty local checkout if it affects which code Cal would run locally.

Example: “Main is deployed and checks pass. Unit tests cover yesterday's feature head, so current-main unit validation is still missing. The local checkout has draft edits. Artwork permission remains a publication gate.”

When a fix is requested, make the scoped change and use [release-and-deploy](../release-and-deploy/SKILL.md). A sitrep alone does not authorize merging unrelated PRs, changing visibility or rewriting history.
