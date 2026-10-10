---
name: release-and-deploy
description: Open, verify, merge and deploy binderdex PRs on Vercel's Hobby plan, which limits daily deployments, with one push per PR and merges only on a green Vercel check. Use when shipping any change to production.
---

# Release and deploy

Vercel builds every PR push as a preview, and every merge to `main` as a production deploy (https://binder.cal.gg). The **Vercel** status check on the PR is the only CI. The Hobby plan has a daily deployment limit, so every push, rebase and merge spends budget.

## Steps

1. **Branch** off the latest `origin/main`, with one concern per branch.
2. **Verify locally before the first push:**
   - `bun run test`, `bun run typecheck`, `bun run lint` (no new warnings; cap in `package.json`), `bun run build` and `bun run test:e2e`
   - if the PR includes a migration, the steps in `adding-a-db-migration`
3. **Push once** and open the PR. The description covers what and why, the rules or numbers, how it was verified (with counts), deploy notes (migrations, env vars) and follow-ups.
4. **Wait for the Vercel check.**
   - Green: merge with a merge commit (`gh pr merge <n> --merge`). Merge one PR at a time.
   - "Deployment rate limited": not a code failure. Wait for the reset, then re-trigger once: redeploy the preview from Vercel, or as a last resort push one empty commit.
   - A real build failure: reproduce it with `bun run build` locally, fix it, and push once.
5. **Never bypass checks.** No admin merge, no merging red, no `--no-verify`.
6. **Rebase only when GitHub reports** the PR as out of date or conflicting. Re-run the local checks after rebasing, then push once.
7. **After merging:**
   - Confirm the production deployment for the merge commit succeeded (the commit status on `main`).
   - Smoke-test: `curl -sI https://binder.cal.gg` returns 200, and image changes return `x-card-image-source: r2` from `/api/card-image-proxy?url=…`.
   - Apply any migrations or env vars the PR called out.
8. **Env vars** are set in Vercel (Production and Preview) and documented in `.env.example`. A change needs a redeploy to take effect.

## Don'ts

- Don't push work-in-progress commits to a PR branch.
- Don't add `.github/workflows` without the owner's go-ahead.
- Don't merge stacked PRs before their base, and retarget them to `main` after the base merges.
