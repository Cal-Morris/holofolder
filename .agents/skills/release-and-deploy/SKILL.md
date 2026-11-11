---
name: release-and-deploy
description: Use when opening, verifying, merging or deploying a Holo Folder PR on Vercel's Hobby plan.
---

# Release and deploy

Vercel only builds `main`, as a production deploy (the public app is https://holofolder.com/app; binder.cal.gg is a legacy hostname). PR branches get no preview deployment (`git.deploymentEnabled` in `vercel.json`) to save build minutes. GitHub Actions runs **Typecheck** on every PR: it generates Next route types, checks the full repository with the pinned `tsrs` checker, runs the unit suite, enforces the lint warning ratchet and runs `bun run build`. It is the merge gate. Vercel skips its duplicate type check. The Hobby plan has a daily deployment limit, so every merge spends budget.

Use [task-progress](../task-progress/SKILL.md) to update the issue/project when work starts, a PR enters review, a merge awaits deployment/publication, and all delivery gates pass. Keep incomplete issues open, and verify project/parent state after closing.

## Steps

1. **Branch** off the latest `origin/main`, using separate branches for independent features or fixes wherever possible. Keep PRs and commits small, with one concern each; dependent changes can stay together when needed for a working PR.
2. **Deliver API/docs with every feature** using [feature-api-docs](../feature-api-docs/SKILL.md). Record the user-facing feature block and its affected Framer surfaces; prepare matching release copy during implementation.
3. **Run focused local checks when useful for the change.** Commit, push, and use CI as the default merge gate. A full local test, build or e2e run is not required by default; run the full e2e suite only when Cal explicitly asks.
   - if the PR includes a migration, the steps in `adding-a-db-migration`
4. **Push once** and open the PR. The description covers what and why, the rules or numbers, how it was verified (with counts), deploy notes (migrations, env vars) and follow-ups.
5. **Inspect Typecheck on the current PR head.**
   - Green: merge with a merge commit (`gh pr merge <n> --merge --match-head-commit <sha>`). Merge one PR at a time.
   - A real failure: reproduce it locally (`bun run build`, `bun run test` and so on), fix it, and push once.
   - Need a preview URL anyway? `vercel deploy` by hand; it costs a build.
6. **Keep every other gate.** Failed checks and unmet reviews block merging. Never use `--no-verify`.
7. **Rebase only when GitHub reports** the PR as out of date or conflicting. Repeat any relevant focused checks after rebasing, then push once.
8. **After merging:**
   - For a quota-blocked merge, report **merged, deployment pending**. After the limit resets, deploy the latest `main`, covering all accumulated merges rather than an older PR head, and verify that exact commit's production deployment.
   - Otherwise, confirm the production deployment for the merge commit succeeded (the commit status on `main`).
   - After that deployment succeeds, smoke-test: `curl -sL -o /dev/null -w '%{http_code}' https://holofolder.com/app` returns 200 after the signed-out redirect. For image-store changes, verify the expected `x-card-image-source` from `/app/api/card-image-proxy?url=…` (`r2` for a mirrored TCGdex card); resizing changes also need the requested width/format checked.
   - For public API changes, run the all-operation smoke suite after production is ready, inspect coverage, cleanup and timing, and retain its report. See `docs/api-smoke.md`.
   - Apply any migrations or env vars the PR called out.
9. **Env vars** are set in Vercel (Production and Preview) and documented in `.env.example`. A change needs a redeploy to take effect.

## Finish each user-facing feature block

After the block is deployed and enabled on main, run [release-posts-and-changelog](../release-posts-and-changelog/SKILL.md) and [framer-feature-updates](../framer-feature-updates/SKILL.md). Reuse existing Framer CMS, pages, components and styles, publish the scoped updates, verify their live URLs and attach app SHA/deployment, docs links and Framer publication evidence to the owning issue/project. This is part of delivery, with standing authorization from Cal. Do not announce quota-blocked or hidden work, and do not silently publish unrelated site edits. Internal foundation PRs contribute to their block rather than generating a customer post each.

## Don'ts

- Don't push work-in-progress commits to a PR branch.
- Don't add `.github/workflows` without the owner's go-ahead.
- Don't merge stacked PRs before their base, and retarget them to `main` after the base merges.
