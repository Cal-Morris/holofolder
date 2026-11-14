---
name: growth-loop
description: Run Holo Folder's weekly marketing and user-growth loop from the private growth plan (marketing/private/), covering measurement, SEO work, social drafting and queueing, and preparing human-only community and outreach tasks. Use when asked to drive growth, run the growth or marketing loop, or work on SEO, social posts, launches or the scoreboard.
---

# Growth loop

The detailed plan lives in `marketing/private/growth-plan.md`, with the calendar, research, outreach list and scoreboard beside it. That folder is gitignored and exists only on Cal's machine; if it is missing (for example in a cloud run), stop and say so rather than reconstructing it. Read the plan, [`brand-voice.md`](../../../marketing/brand-voice.md) and the last few rows of `marketing/private/scoreboard.md` before doing anything, because they hold the current priorities, the claims rules and what happened last week. Never copy names, contacts or business numbers from the private folder into commits, PRs or public posts.

## Each run

1. **Measure.** Collect this week's numbers and add one row to `marketing/private/scoreboard.md`.
   - From Supabase (read only): total accounts, accounts created in the last 7 days, share links.
   - From `bun --env-file=.env.local scripts/report-collector-funnel.ts --from=<monday> --to=<next monday>`: activation and source breakdown.
   - From Search Console (if verified): clicks and impressions.
   - From GA, through the analytics MCP: sessions by source.
   - Write "n/a" for anything unavailable and say why. Never estimate a number into the table.
2. **Pick the work.** Take the highest item in the plan's current week of the 90-day sequence that isn't done. Prefer work that compounds (search pages, fixes) over one-off posts. If a channel has produced no activated collectors after four honest weeks, propose cutting it in the notes column rather than continuing silently.
3. **Ship product and SEO changes** the normal way: small PRs off the latest `main`, merged on a green Typecheck under [release-and-deploy](../release-and-deploy/SKILL.md). Public set, Pokémon and card pages follow [nextjs-conventions](../nextjs-conventions/SKILL.md) (`'use cache'`, not `'use cache: remote'`, for page content), override the root `noindex` per route, and get added to `app/sitemap.ts`. Prices appear only at high or medium confidence ([pricing-signal-changes](../pricing-signal-changes/SKILL.md)).
4. **Framer edits** (SEO fixes, footer links, blog and set posts) follow [framer-feature-updates](../framer-feature-updates/SKILL.md) for inspecting, editing and publishing, and [release-posts-and-changelog](../release-posts-and-changelog/SKILL.md) for CMS posts. Preserve collaborator edits and never publish someone else's unpublished work.
5. **Social.**
   - Draft the week's posts from `marketing/private/content-calendar.md` using real data: the mirror, confidence-gated `card_prices`, showcase binders and shipped changes.
   - Make every image with `bun run social-images` ([`marketing/social/`](../../../marketing/social/README.md)): `capture` the showcase screenshots, add the post to `POSTS` with copy taken only from the published blog post, `render`, check `out/contact-sheet.html`, then `upload` to R2 with a short-lived bucket-scoped token. Each platform gets its own size: an Instagram 4:5 carousel (1080×1350), a single X image (1600×900) and TikTok photo slides (1080×1920). Never post a blog's 16:9 artwork as is.
   - Queue the posts in Buffer through its API, using the key from the secret store. Buffer's free plan holds 10 scheduled posts, and API calls share one daily limit, so plan the calls, test one write before a batch and never poll.
   - Buffer facts that matter: `editPost` with `assets` replaces the whole list, and Instagram edits must resend `metadata.instagram` (`type: post`, `shouldShareToFeed: true`). Several image assets on Instagram make a carousel. TikTok accepts image assets as a photo post. Sent posts can't be edited, and deleting one from Buffer does not remove it from the network.
   - Auto-publish only the formats the plan marks safe: changelog posts and set checklist graphics. Everything else goes to the queue as a draft for Cal.
   - Until Buffer is connected, write the drafts into the run summary instead.
6. **Prepare the human-only work.** For the coming week, write out:
   - the Self Promo Sunday post for r/PokemonTCG
   - any Discord or Facebook admin request
   - creator outreach emails
   - Show HN or Product Hunt copy when that week arrives

   Give each one ready to paste, with its UTM link. Do not post or send any of it.

7. **Report.** End with a short summary for Cal covering the numbers, what shipped (with PR and live URLs), what is queued for approval, the human tasks with their drafts, and any blocker.

## Hard rules

- Never post on Reddit, Discord or Facebook groups. Never reply to or DM anyone. Never contact creators, spend money, or change pricing, the free tier or Stripe. These stay with Cal.
- Never invent card data, prices, dates, user counts or testimonials. Check claims against production before publishing them. The full list is in `brand-voice.md`.
- Every link uses approved UTM values from `lib/collector-funnel.ts`.
- Keep secrets (Buffer key, Search Console, GA credentials) out of the repo, PRs and logs. Ask for missing ones through the secret prompt.
- One concern per PR and push once per PR (Hobby plan deploy limit). Marketing docs updates can ride along with a related PR, or batch into one weekly docs PR.
- When the plan and reality disagree (a channel is dead, a date moved, a decision was made), update `marketing/private/growth-plan.md` and the calendar in the same run so the next run starts from the truth.
