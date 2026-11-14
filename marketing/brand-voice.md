# Brand voice and claims rules

These rules apply to every public word the growth loop drafts or publishes: social posts, blog posts, Framer pages, directory listings and outreach drafts.

## Accounts

| Platform         | Handle           | Status                                                                             |
| ---------------- | ---------------- | ---------------------------------------------------------------------------------- |
| Instagram        | not recorded yet | Exists, needs switching to a Professional account and linking in the Framer footer |
| X                | not recorded yet | Exists, needs linking in the Framer footer                                         |
| Threads, Bluesky | none             | Add through Buffer once Instagram is connected                                     |
| TikTok, YouTube  | none             | Add once there is filmed footage                                                   |

## Voice

We write like a collector talking to another collector, not like a startup. Use plain British English, pounds and UK dates. Be warm and specific, with real set names, card names and page counts, and no hype words like "revolutionary", "game-changing" or "ultimate". Write in connected sentences rather than clipped one-liners, and don't use em-dashes. Emoji are fine on social in moderation, and never in place of words.

## Claims we never make

- **No invented card or price data.** Every price comes from our own `card_prices` data, is shown in GBP, and appears only when confidence is high or medium. Rising and Breakout posts follow the same gate. If a price is unknown, we say it is unknown or leave it out.
- **No unconfirmed dates stated as fact.** Unannounced or fan-sourced set dates are labelled as reported, or left out.
- **No features we have not shipped.** Before claiming a feature, check that it is live on production, as the framer-feature-updates skill requires. Planned work is never announced.
- **No disparaging competitors.** Comparison pages state facts with sources and a date.
- **No made-up social proof.** No invented user counts, testimonials or reviews.

## Images and attribution

Card images are © The Pokémon Company, Nintendo, Creatures and GAME FREAK. They are not covered by TCGdex's licence. Use them the same way the app does, with the one-line notice where space allows, and keep "Holo Folder is not affiliated with The Pokémon Company" in bios and on directory listings. Prefer screenshots of our own UI and showcase binders over bare card scans. Never post a screenshot showing a real user's private collection, certificates or account details. Use showcase or synthetic demo data instead.

## Links

Every link carries UTM values from the approved list in `lib/collector-funnel.ts`, for example `https://holofolder.com/app?utm_source=instagram&utm_medium=social&utm_campaign=social`. Unapproved values are silently recorded as unknown, so add a new value to both `lib/collector-funnel.ts` and the migration list before using it. Link to something people can use without an account (a showcase binder, a set page, a price check) in preference to the sign-up screen.

## Platform rules we respect

Reddit, Discord and Facebook groups are human only. r/PokemonTCG bans bot accounts and AI-generated posts. Replies and DMs are always human. X automation rules forbid automated replies and duplicate posting, so every scheduled post must be distinct.
