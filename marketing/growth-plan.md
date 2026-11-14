# Holo Folder growth plan

Written 14 November 2026, covering the next 90 days (to mid February 2027). It builds on three research reports in this folder: [seo-audit.md](seo-audit.md), [competitors-and-keywords.md](competitors-and-keywords.md) and [channels-and-automation.md](channels-and-automation.md). Work is run week to week by the [growth-loop skill](../.agents/skills/growth-loop/SKILL.md), and progress is recorded in [scoreboard.md](scoreboard.md).

## Where we are

Holo Folder has 20 accounts, and 18 of them signed up in the last seven days. Between them they hold 59 binders, about 3,000 saved cards and 30 share links (Supabase, 14 November 2026). All seven accounts the collector funnel has recorded so far show an unknown source, so we cannot yet say where anyone came from. Search engines barely know the site exists. No Instagram or X profile is linked anywhere on holofolder.com, and the product is web only, so it gets no App Store browse traffic.

The product itself is strong enough to grow. It has 41,454 cards across 402 sets, every National Dex Pokémon and GBP prices, all mirrored in our own database. Two features have no equivalent in any competitor we found: Show mode at card shows, and a partner collection two people edit together. The closest rival, Dex, charges exactly what we charge (£3.99 a month, £34.99 a year), but it lets free users log unlimited cards.

## The goal

The north star is **activated collectors per week**: owners who reach 10 saved entries, which is the activation stage the collector funnel already records. Signups alone flatter us, while activation shows someone actually built a binder.

The 90-day target is 300 accounts and 100 activated collectors by mid February 2027, with at least half of new accounts carrying a known source. These targets are a guess made with almost no history. The first monthly review should reset them from real numbers.

## Strategy in one paragraph

Win the UK collector who keeps a physical binder. We are the only product that shows your actual binder pages, priced in pounds, with a mode built for the card show floor. Search is the engine that compounds. We will turn the card mirror into public set, Pokémon and card pages, because that is exactly what collectors search for and it is what competitors rank with. Social and community work is the spark that gets the first few hundred people in and gives Google brand signals. Card shows and binder creators are the high-trust channel for Show mode. Everything links to something a visitor can use without signing up first, such as a showcase binder, a set checklist or a price check, because guests can already browse.

## Positioning

The headline is "Your real binder, page by page, priced in pounds." The two supporting angles are "Card show mode: know a good deal before you pay" and "One collection for two", for partners and parent-and-child collectors. Offline support and the API and MCP server are real features, but competitors have them too and nobody searches for them, so they belong in feature pages and developer channels, not headlines. Lead with what is unique, not with "virtual binder", which every competitor now claims.

## Decisions Cal needs to make

These are the only things that block parts of the plan. Everything else runs without Cal's input.

1. **The free tier cap. Decided 14 November 2026:** saved entries are unlimited on the free plan (one binder stays), and price trends and signals, the Analytics tab, Show mode deal checks and tally, and whole-page scanning moved into Premium (PRs #883 and #884, live, Framer pricing updated).
2. **A lifetime price.** Lifetime licences exist but have no public price. Dex charges £99 and Shiny about $99.99. A £79 to £99 lifetime option suits collectors who dislike subscriptions.
3. **One-time account setup** (about 30 minutes, listed in [Setup checklist](#setup-checklist-for-cal)).

## Workstreams

### 1. Search (the compounding engine)

**Fix the basics in week 1.** The fixes are small and listed in [seo-audit.md](seo-audit.md#prioritised-findings): add the docs sitemap to robots.txt, remove `/app`, `/mcp` and `/.well-known/...` from the Framer sitemap, give `/pricing` its own title and description, add Organization, WebSite and SoftwareApplication JSON-LD to the homepage and BlogPosting to posts, fix the docs soft 404, and link the social profiles in the footer. Search Console and Bing Webmaster Tools need verifying and both sitemaps submitting. Then check the index coverage, because we have never actually seen Google's view of the site.

**Public set checklist pages, weeks 2 to 4.** This is the main build. Each set gets a server-rendered page at `/app/sets/<set-slug>` with the full card list, the base, numbered and master set counts, how many nine-pocket pages the set needs, the set shown as binder pages, and a "Start this binder" button. That gives us about 400 pages, aimed at "<set> card list", "<set> master set" and "<set> binder layout" searches, and each one leads straight into the product. Pokémon pages (`/app/pokemon/<dex>-<name>`, 1,025 pages) come next, linking every printing of a species to the National Dex binder. Card pages with GBP prices come last and start with English cards that have a high or medium confidence price, because thin pages with no unique content hurt more than they help. Prices only show when confidence is high or medium, as the repo rules require. The URL scheme and rendering notes are in [seo-audit.md](seo-audit.md#6-content-gaps-and-a-programmatic-seo-plan).

**Content that targets winnable searches.** Big brands and vendor listicles own "pokemon card value" and "best pokemon card app", so we are not competing there. The clusters a small site can win are binder layout and planning, National Dex and living dex binders, UK price long-tail searches and card show tips. Each needs a small number of genuinely useful pages: a free National Dex placeholder printable, a binder layout guide that opens Binder Studio, "first Pokémon card show tips (UK)" linking to Show mode, and one honest "Holo Folder vs Dex, Collectr and Pokellector" comparison. Each new set also gets a binder layout post in its release week, starting with Delta Reign now and preparing Flowing Fists in January.

**Speed up the homepage.** Mobile Lighthouse is 65 with a 6.5 second LCP, because the hero text waits for an entrance animation and the page loads 3.6 MB of oversized thumbnails. Remove the hero animation and resize the collection images in Framer.

### 2. Social (Instagram and X, then Threads and Bluesky)

The publishing layer is Buffer, because it is the only single API we verified that posts to Instagram, X, Threads and Bluesky without our own Meta or X developer apps. The free plan covers three channels and Essentials is about $5 per channel per month. The agent drafts posts from data we already hold and pushes them into Buffer's queue, where they wait for approval until a format has earned full automation.

The cadence is one post a day on X, Threads and Bluesky, three Instagram carousels a week, and one or two short videos a week once Cal films any. The formats come from what does well in the hobby and what our data can produce honestly:

- **Release week set graphics:** the chase cards and a "this set fills N binder pages" visual, made from the mirror.
- **Showcase binder of the week:** a themed binder anyone can open without an account, which links to something usable rather than a sign-up wall.
- **Price movers in pounds:** Rising and Breakout cards, and only at high or medium confidence.
- **Feature and changelog posts:** these already come out of the release-posts skill.
- **Show mode at a real show:** a screen recording Cal films on the show floor. This is the most valuable video we can make and the agent cannot make it.

Fully automated from the start: changelog posts and set checklist graphics, which are built entirely from verified data. Approved by Cal first: price posts until the confidence check is automated, anything that mentions a competitor, and every reply and DM, because auto-replies break X's automation rules and are a reputation risk anyway.

TikTok and YouTube Shorts are where binder flip-throughs and show vlogs live, and we have neither. Buffer can publish to both, so once there is footage it costs one more channel to add them.

### 3. Communities (human-led, agent-prepared)

Reddit has to stay human. r/PokemonTCG (about a million weekly visitors) permanently bans bot accounts, flags posts made with generative AI, and only allows self-promotion in its weekly Self Promo Sunday thread. r/pkmntcgcollections and r/pokemoncardcollectors ban promotion unless the mods agree first. The plan is for Cal to post as a collector, with photos of his real binder and no links, and to use Self Promo Sunday for the app. The agent prepares a draft and a showcase link each Sunday, and Cal posts it. Messaging the mods of r/pokemoncardcollectors before any app mention is a one-off task worth doing early.

The UK has no dedicated subreddit. UK collectors gather in Discords (PokéPost UK, PokemonStockUK, PBST) and Facebook groups, so the approach there is to ask each admin first and offer something useful, like a set checklist or a free National Dex printable. The TCGdex Discord is the natural home for the API and MCP announcement, because our data comes from TCGdex.

### 4. Card shows (the Show mode channel)

Show mode is our sharpest point of difference and card shows are where it matters. The Collectors Showcase at Olympia London on 21 and 22 November is a week away, and the Essex (29 November), Cambridge and London (5 December) shows follow it. The cheap version is a QR flyer that reads "Check card prices on the show floor, even when the hall Wi-Fi dies", with a `utm_source=shop&utm_medium=qr&utm_campaign=card-show` link, which the funnel already accepts. Cal hands them out while filming the Show mode clip. Later, ask organisers whether they will list Holo Folder as a show floor tool. The UK show calendar is in [channels-and-automation.md](channels-and-automation.md#3-timely-hooks-nov-2026-to-mar-2027).

### 5. Creators and referrals

Binder creators are how competitors grow. Collectr sponsors binder tour channels, and small creators charge roughly £50 to £150 per integration. The best fits are small UK creators already doing National Dex binders and card show buying. The named shortlist is in `marketing/private/outreach.md`, which is gitignored.

The offer is free lifetime Premium for the creator, which costs nothing, plus a Stripe promotion code that gives their viewers a free first month while the creator earns 30% recurring for 12 months. Attribution uses the funnel's existing `creator` source and medium, with no new tracking. Paid flat fees come only after a creator shows real views. Outreach messages and any paid deal need Cal's approval. The agent drafts the shortlist and the emails.

### 6. Launches and directories

Spread these out rather than spending them all in one week, and do them after the set pages and the free tier change land, so new visitors find something worth staying for.

- **Official MCP Registry first:** directories such as PulseMCP pull from it automatically. Glama, Smithery, mcp.so and awesome-mcp-servers come next, all clearly marked as remote OAuth and Premium.
- **Free directory listings:** AlternativeTo (add Holo Folder and suggest it as an alternative on the Collectr and Pokellector pages), pwastore.io, SaaSHub, BetaList and Uneed.
- **Show HN:** the angle is an offline-first PWA that works on dead card show Wi-Fi, plus a public API and MCP server over a hobby dataset. The link goes straight to a showcase binder, because HN wants something people can use without signing up. Cal has to post it from his own account.
- **Product Hunt:** this needs a tagline that separates us from Pokébinder, which launched there in September.
- **Google Play via a Trusted Web Activity:** a later option that would get us store presence without a native app. It is out of scope for this quarter.

## Measurement

We already have the tools and just need to use them. Every link we publish carries UTM parameters from the approved list in `lib/collector-funnel.ts`, so the funnel records the source. The weekly report is `scripts/report-collector-funnel.ts`, alongside Search Console clicks and impressions, GA acquisition, and Supabase counts for accounts, activations and share links. The growth loop writes one row a week to [scoreboard.md](scoreboard.md). Any channel that produces no activated collectors after four honest weeks gets cut.

The tracking gaps are that GA needs `gcloud auth application-default login` re-running before the agent can read it, and Search Console is not verified yet.

## 90-day sequence

| Weeks                             | Focus                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 (from 14 Nov)                   | SEO basic fixes in Framer and the app. Search Console and Bing verification. Social links in the footer. Buffer connected. First posts: Delta Reign set graphic and showcase binder. QR flyer for Olympia. MCP Registry listing                                                |
| 2 to 4                            | Set checklist pages shipped and in the sitemap. Delta Reign binder layout post. National Dex printable. First Self Promo Sunday. Free tier decision made and shipped                                                                                                           |
| 5 to 8 (December)                 | Pokémon pages. Card show tips and comparison pages. Creator outreach (first 5). "Set up your new binder" Christmas push. Directory listings                                                                                                                                    |
| 9 to 13 (January to mid February) | Card pages with confident GBP prices. Flowing Fists release week (prereleases 23 to 31 January, launch 5 February, unconfirmed). Show HN and Product Hunt. Europe International Championships at ExCeL London (19 to 21 February). First quarterly review and reset of targets |

The dated calendar is in [content-calendar.md](content-calendar.md).

## Setup checklist for Cal

These are the one-time steps that unlock autonomous running. Each one takes a few minutes.

1. Tell me the Instagram and X handles, or add them to [brand-voice.md](brand-voice.md#accounts).
2. Switch Instagram to a Professional (Creator) account.
3. Create a Buffer account, connect Instagram, X, and optionally Threads and Bluesky, and give me an API key through the secret prompt, never in chat or the repo.
4. Verify holofolder.com in Google Search Console and Bing Webmaster Tools, and give me access to read them.
5. Re-run `gcloud auth application-default login` so I can read GA.
6. Decide on the free tier cap and a lifetime price.

## What the agent does and does not do alone

On its own, under the growth-loop skill, the agent ships SEO fixes and the public set, Pokémon and card pages as normal small PRs, edits and publishes Framer SEO and content pages, drafts and queues social posts, auto-publishes the formats marked safe above, submits directory and registry listings that do not need Cal's identity, and writes the weekly scoreboard.

It never posts on Reddit, Discord or Facebook groups, replies to or DMs anyone, contacts creators, spends money, changes prices or the free tier, or publishes a price claim that has not passed the confidence gate. It prepares all of those for Cal instead.
