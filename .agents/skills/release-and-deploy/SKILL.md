---
name: release-and-deploy
description: Use when opening, verifying, merging or deploying a Holo Folder PR on Vercel's Hobby plan.
---

# Release and deploy

Vercel builds every PR push as a preview, and every merge to `main` as a production deploy (the public app is https://holofolder.com/app; binder.cal.gg is a legacy hostname). GitHub Actions runs **Typecheck** in parallel: it generates Next route types, checks the full repository with the pinned `tsrs` checker, runs the unit suite and enforces the lint warning ratchet. Vercel skips its duplicate type check. Both checks must pass before merging; the current GitHub plan cannot enforce required checks on this private repo, so agents enforce this release policy. The Hobby plan has a daily deployment limit, so every push, rebase and merge spends budget.

## Steps

1. **Branch** off the latest `origin/main`, using separate branches for independent features or fixes wherever possible. Keep PRs and commits small, with one concern each; dependent changes can stay together when needed for a working PR.
2. **Run focused local checks when useful for the change.** Commit, push, and use CI as the default merge gate. A full local test, build or e2e run is not required by default; run the full e2e suite only when Cal explicitly asks.
   - if the PR includes a migration, the steps in `adding-a-db-migration`
3. **Push once** and open the PR. The description covers what and why, the rules or numbers, how it was verified (with counts), deploy notes (migrations, env vars) and follow-ups.
4. **Inspect Typecheck and Vercel on the current PR head.**
   - Both green: merge with a merge commit (`gh pr merge <n> --merge`). Merge one PR at a time.
   - "Deployment rate limited" or an exhausted account build/deployment quota: confirm the check details explicitly identify a quota failure. `bun run test`, `bun run typecheck`, `bun run lint` and `bun run build` must pass on the current PR head (no full e2e required), and every other required check and review must pass. Record the quota evidence and local validation in the PR, then merge without waiting for the reset or pushing retry commits. Pin the merge to the verified head with `--match-head-commit <sha>`.
   - A real build failure: reproduce it with `bun run build` locally, fix it, and push once.
5. **Keep every other gate.** Real build failures, failed local checks and unmet checks or reviews still block merging. Use `--admin` only if needed to bypass the verified quota-only Vercel check after every other requirement passes. Never use `--no-verify`.
6. **Rebase only when GitHub reports** the PR as out of date or conflicting. Repeat any relevant focused checks after rebasing, then push once.
7. **After merging:**
   - For a quota-blocked merge, report **merged, deployment pending**. After the limit resets, deploy the latest `main`, covering all accumulated merges rather than an older PR head, and verify that exact commit's production deployment.
   - Otherwise, confirm the production deployment for the merge commit succeeded (the commit status on `main`).
   - After that deployment succeeds, smoke-test: `curl -sL -o /dev/null -w '%{http_code}' https://holofolder.com/app` returns 200 after the signed-out redirect. For image-store changes, verify the expected `x-card-image-source` from `/app/api/card-image-proxy?url=…` (`r2` for a mirrored TCGdex card); resizing changes also need the requested width/format checked.
   - For public API changes, run the all-operation smoke suite after production is ready, inspect coverage, cleanup and timing, and retain its report. See `docs/api-smoke.md`.
   - Apply any migrations or env vars the PR called out.
8. **Env vars** are set in Vercel (Production and Preview) and documented in `.env.example`. A change needs a redeploy to take effect.

## Don'ts

- Don't push work-in-progress commits to a PR branch.
- Don't add `.github/workflows` without the owner's go-ahead.
- Don't merge stacked PRs before their base, and retarget them to `main` after the base merges.
