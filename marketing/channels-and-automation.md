# Holo Folder: user acquisition channels and automated social posting

_Research date: 14 November 2026. All of this is read-only web research: nothing was signed up for or posted. Each section separates **Verified** (checked against a primary source or a dated snapshot of one) from **Estimate / unverified** (third-party, single-source or inferred)._

---

## 0. Headline findings

1. **No public Holo Folder social handles turned up.** Searches for "holofolder" and "holo folder" found nothing on Instagram or X. The live holofolder.com HTML has no Instagram, X, TikTok, Threads or Bluesky profile links. The only social link in it is `x.com/pokemon`. The repo has no handle references either. **Action:** add the profile links to the Framer footer, and put the handles in this file once Cal confirms them.
2. **The category is crowded, and new rivals launched recently.** Pokébinder launched on Product Hunt on 29 Sep 2026. Others in the space: House of Holos (free, runs a "Binder Club" Discord), SleeveUp (UK, UK eBay pricing, has a UK creator directory), Binder Builder, PokéFolio, Holotackle, BinderDex (listed Oct 2026) and Collectr, which sponsors creators. Holo Folder's distinct angles are Show mode at card shows, GBP prices with confidence levels, Partner Mode, working offline, and the API plus MCP server. Lead with those rather than "virtual binder", which everyone now claims. Sources: [houseofholos.app](https://houseofholos.app/), [houseofholos.app/community](https://houseofholos.app/community), [sleeveup.app/creators](https://sleeveup.app/creators), [binderbuilder.app](https://binderbuilder.app/), [pokefolio.eu](https://www.pokefolio.eu/en/), [holotackle.com](https://holotackle.com/), [BinderDex listing](https://www.showmysites.com/aneury/binderdex/).
3. **Reddit has to stay human.** r/PokemonTCG bans posts "made with generative ai", bans bot accounts permanently, and allows self-promotion only in its weekly Self Promo Sunday thread.
4. **Simplest automation stack:** Buffer's API is one integration that covers X, Instagram, Threads and Bluesky. Typefully is the better tool for writing X threads, but its Instagram support is contradictory across its own pages. Details in section 6.

---

## 1. Communities

### 1a. Reddit

Reddit now shows weekly visitors rather than subscriber totals. The figures below come from Wayback Machine snapshots of each subreddit's front page. Rules are quoted from archived old.reddit rules pages, because Reddit blocked live fetches.

| Subreddit               | Size (verified snapshot)                                                                                                                                                                                                                                                                                                                         | Self-promotion rule (verified quote)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | How to show up                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r/PokemonTCG            | 1,079,620 weekly visitors, 21,396 weekly contributions ([snapshot 7 Nov 2026](http://web.archive.org/web/20261107022714/https://www.reddit.com/r/PokemonTCG/)). Aggregators put members at about 1.24M to 1.4M ([Hive Index](https://thehiveindex.com/communities/r-pokemontcg/), [Notifier](https://notifier.so/similar-subreddits/PokemonTCG)) | Rule 10: "Self promotion is only allowed in the weekly Self Promo Sunday thread. All other promotion will get you moderated up to being banned without warning." Rule 5 bans referral links and market research. Rule 6: "Posts may be flagged as spam if their content is already posted or made with generative ai. Bot accounts get permabanned as spam." Rule 3 bans pricing posts outside the weekly thread ([rules, Jul 2026](http://web.archive.org/web/20260716112535/https://old.reddit.com/r/PokemonTCG/about/rules)) | Post in Self Promo Sunday only. Otherwise Cal posts as a collector: photos of his real binder, no links. Price questions belong in the weekly thread, so Show mode can come up there naturally |
| r/pokemoncardcollectors | 154,078 weekly visitors, 3,373 contributions ([snapshot 23 Oct 2026](http://web.archive.org/web/20261023025141/https://www.reddit.com/r/pokemoncardcollectors/))                                                                                                                                                                                 | Rule 3: "Sharing links to socials is not allowed... The subreddit is also not for advertising your app or website without checking with the mod team first." ([rules](http://web.archive.org/web/20260716112553/https://old.reddit.com/r/pokemoncardcollectors/about/rules))                                                                                                                                                                                                                                                    | Message the mods before any app mention. Image-led show-and-tell does well                                                                                                                     |
| r/pkmntcgcollections    | 106,365 weekly visitors, 1,284 contributions ([snapshot 23 Oct 2026](http://web.archive.org/web/20261023025131/https://www.reddit.com/r/pkmntcgcollections/))                                                                                                                                                                                    | Rule 3: "No Self-Promotion of any kind... unless otherwise permitted in specific circumstances such as a sticky'd post." Rule 6 requires that it is your own collection. Rule 8 bans astroturfing ([rules, Aug 2026](http://web.archive.org/web/20260801222539/https://old.reddit.com/r/pkmntcgcollections/about/rules/))                                                                                                                                                                                                       | Only real collection photos from Cal. Mention the app only if someone asks in comments, or in a stickied thread                                                                                |
| r/PKMNTCGDeals          | 44,967 weekly visitors, 383 contributions ([snapshot 28 Sep 2026](http://web.archive.org/web/20260928123827/https://www.reddit.com/r/PKMNTCGDeals/))                                                                                                                                                                                             | Not verified. A third-party summary found no written promo rule, and top posts link a Discord and use "#ad" ([Thread Otter](https://www.threadotter.com/subreddit-rules/pkmntcgdeals))                                                                                                                                                                                                                                                                                                                                          | Poor fit. It is a drop-alert sub, US-centric                                                                                                                                                   |
| r/PokeInvesting         | Not found                                                                                                                                                                                                                                                                                                                                        | Not verified. A third-party summary found no explicit rule ([Thread Otter](https://www.threadotter.com/subreddit-rules/pokeinvesting))                                                                                                                                                                                                                                                                                                                                                                                          | Possible fit for the price confidence angle. Read the sidebar before posting                                                                                                                   |
| UK-specific subreddit   | **None found.** UK collectors gather mainly on Discord and Facebook ([Packratt UK guide](https://packratt.co.uk/guides/uk-tcg-community-2026))                                                                                                                                                                                                   | n/a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Use the UK Discords and Facebook groups below                                                                                                                                                  |

**Estimate:** r/pokemon allows original-content posters "one self-promotional link or mention" in the post body, not the title ([summary](https://reddit.sudovanilla.org/r/pokemon/wiki/bannedsubmissions)). It is worth re-checking for Binder Studio showcases.

### 1b. Discord

| Server                                                    | Members (from listing pages, unverified)                                                                                                                                                                                                                                                               | Fit                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| r/PokemonTCG Discord                                      | 41,512 ([listing](https://discord.com/servers/rpokemontcg-613439869607477269))                                                                                                                                                                                                                         | General. Self-promo channels are likely; check the channel list on joining                     |
| Physical TCG server 613439869607477269                    | 45,408 ([listing](https://discord.com/servers/613439869607477269))                                                                                                                                                                                                                                     | Same ID as above, so it may be the same server                                                 |
| PKMNTCGDeals Discord                                      | "over 100k" (self-reported in the subreddit sidebar)                                                                                                                                                                                                                                                   | Drop alerts. Low fit                                                                           |
| UK: PokéPost UK, PokemonStockUK, PBST (UK buy/sell/trade) | Not stated ([PokéPost](https://discord.com/servers/pokepost-buy-sell-trade-ask-pokemon-tcg-discord-1125910867582652526), [PokemonStockUK](https://discord.com/servers/pokemonstockuk-1403310541174341813), [PBST](https://discord.com/servers/pbst-pokemon-tcg-buy-sell-trade-uk-1105475761948860496)) | **Best UK fit.** Collectors and traders who go to UK shows. Show mode and GBP prices land here |
| TCGdex Discord                                            | Not stated ([listing](https://discord.com/servers/tcgdex-857231041261076491))                                                                                                                                                                                                                          | Holo Folder uses TCGdex data, so this is a natural developer audience for the API and MCP      |
| House of Holos "Binder Club"                              | n/a                                                                                                                                                                                                                                                                                                    | Competitor-run. Avoid                                                                          |

### 1c. Facebook groups (UK)

Verified as existing: Pokemon Hub (UK), Pokemon Cards (UK), Pokemon TCG Exchange UK, and Pokémon Cards & Merchandise ([pokecardvalues.co.uk list](https://pokecardvalues.co.uk/facebook_groups/)). Member counts and promo rules are not public. Facebook groups skew towards older and returning collectors ([Packratt](https://packratt.co.uk/guides/uk-tcg-community-2026)), which matches Holo Folder's "Returning collectors" page. The right approach is to ask each admin before posting, and offer something useful like a free set-checklist or binder template.

### 1d. Forums

- **Elite Fourum** (serious and vintage collectors). Rule 2.1 says no sales or trade threads without staff approval. The full rules page is at [elitefourum.com rules](https://www.elitefourum.com/t/the-rules-read-here-first/14022), but its text about advertising wasn't retrievable. Treat it as no promotion without asking staff.
- **PokeBeach**: no rules found. It is primarily a news site, so the realistic approach is a news tip when a feature is genuinely newsworthy.
- **PokéCommunity / Smogon**: both ban advertising your own site outside relevant sections ([PokéCommunity](https://www.pokecommunity.com/threads/welcome-to-video-games-rules-info.387626/), [Smogon](https://www.smogon.com/rules)). Low fit.

### 1e. UK card show circuit (listings)

[PokePrices UK card shows](https://www.pokeprices.io/card-shows/uk) and [CardPulse UK](https://www.cardpulse.club/card-shows/united-kingdom) aggregate UK shows. Show mode is the most differentiated feature, so being physically present at shows is the strongest channel. Concrete options: hand out a QR flyer for "check prices offline on the show floor", or ask organisers whether they would list Holo Folder as a show-floor tool.

---

## 2. Content formats (Instagram, X, TikTok, Reels, Shorts)

**Verified observations from creator content:**

- **Binder tours and collection reveals** are a staple long-form format on YouTube ([LuckyJ, UK](https://www.youtube.com/watch?v=at1D7s-eROg), [BabyyPokenator](https://www.youtube.com/watch?v=W8ng68X0PAg), [The Poke Wall binder themes](https://www.youtube.com/watch?v=Eqyv07ypCAQ)).
- **Themed binder pages** do well: colour pages, artist binders, one-Pokémon master sets. TikTok tags like `#bindertour` and `#pokemonbinder`, and artist binders such as "michibinder", appear repeatedly ([TikTok sample](https://www.tiktok.com/@gradeon37/video/7463310586667928875)).
- **Pokédex binder progress filmed at card shows** is a direct match for Holo Folder: [Joel's Gaming Adventures at Exeter Card Show](https://www.youtube.com/watch?v=R4oRSw3YQuk), working on a full 1025-pocket Pokédex binder.
- **Vintage binder rebuilds** with almost daily TikToks: [The Binder Rebuild, UK](https://urlebird.com/user/thebinderrebuild/), about 18 videos a month, around 3K average views.
- **Pulls and pack openings** remain the core short-form format ([Virlo analysis](https://virlo.ai/blog/how-pokemon-cards-became-the-internet-s-favorite-flex)).

**Formats mapped to what Holo Folder can generate from its own data.** These suit agent drafting.

| Format                                                       | Platform                   | Agent-generatable?                                                                           | Notes                                                     |
| ------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Set checklist graphic (new set's chase cards and SIR list)   | IG carousel, X image       | Yes, from the TCGdex mirror                                                                  | Strongest timely hook on release weeks                    |
| "Complete the page" progress (empty pockets filling in)      | IG carousel, Reels, TikTok | Partly. Needs Cal's real binder data via the API                                             | Showcase binders are public already                       |
| Price movers (Rising and Breakout)                           | X, Threads, Bluesky        | Yes, but **only high or medium confidence**, per AGENTS.md "Never invent card or price data" | GBP-denominated, so it is UK-distinctive                  |
| Showcase binder of the week (Pikachu party, evolution lines) | IG carousel, X             | Yes                                                                                          | Links to a no-account binder, so there is no sign-up wall |
| Show mode screen recording at a real show                    | Reels, TikTok, Shorts      | No, Cal films it                                                                             | Highest-value video asset                                 |
| Binder flip-through (physical)                               | Reels, TikTok, Shorts      | No                                                                                           | Human-filmed                                              |
| Changelog and feature posts                                  | X, Bluesky, Threads        | Yes                                                                                          | Already produced by the release-posts skill               |

**Cadence (estimate, no hard source found):** the creators sampled post daily on TikTok, and weekly-plus-daily on IG for active binder creators like [Ben's Binders](https://cardgames.social/creators/frostfallphoenix): "New videos every week, daily card content across Instagram & TikTok". A sustainable solo target would be X, Threads and Bluesky once a day (agent-drafted), IG three times a week (carousels), and one or two Reels or TikToks a week (human-filmed).

**Gap:** Holo Folder has **no TikTok or YouTube Shorts presence**. Those are where binder flip and show-floor video lives. Neither suits full automation, because both need filmed footage. Buffer and Postiz can both publish to TikTok and YouTube once the footage exists.

---

## 3. Timely hooks, Nov 2026 to Mar 2027

| Date                   | Event                                                                      | Status                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6 Nov 2026             | Delta Reign (English, Mega Rayquaza ex) released                           | Verified by two sources ([PokéCottage](https://pokecottage.com/pokemon-set-release-calendar), [Samurai Sword Tokyo](https://samuraiswordtokyo.com/blogs/news/pokemon-tcg-english-release-calendar-q4-2026)) |
| 10 Nov 2026            | McDonald's x Pokémon (2 cards per toy)                                     | Single source ([PokéCottage](https://pokecottage.com/pokemon-set-release-calendar))                                                                                                                         |
| 21 to 22 Nov 2026      | Collectors Showcase, Olympia London                                        | [PokePrices](https://www.pokeprices.io/card-shows/uk)                                                                                                                                                       |
| 27 Nov 2026            | Aura Seeker (Japan), the basis of Flowing Fists. Also Black Friday         | Japanese date reported ([PokéCottage](https://pokecottage.com/pokemon-set-release-calendar))                                                                                                                |
| 28 Nov / 29 Nov 2026   | Watton Trading Card Show / Essex Card Show #6, Chelmsford                  | [PokePrices](https://www.pokeprices.io/card-shows/uk)                                                                                                                                                       |
| 4 Dec 2026             | Binder Collection and ex Tins (English)                                    | Single source, title only ([Samurai Sword Tokyo](https://samuraiswordtokyo.com/blogs/news/pokemon-tcg-english-release-calendar-q4-2026)). **A "Binder Collection" product is an obvious hook if confirmed** |
| 5 Dec 2026             | Cambridge Card Show #12. London Card Show (The Card Show UK)               | [PokePrices](https://www.pokeprices.io/card-shows/uk)                                                                                                                                                       |
| 25 to 26 Dec 2026      | Christmas / Boxing Day: "set up your new binder"                           | Calendar                                                                                                                                                                                                    |
| 23 to 31 Jan 2027      | Flowing Fists prereleases                                                  | Reported, not on pokemon.com ([Bill's Archive](https://billsarchive.com/flowing-fists.html), [Wargamer](https://www.wargamer.com/pokemon-trading-card-game/flowing-fists))                                  |
| 27 Jan 2027            | Valentine's Box (20 mini packs)                                            | Reported, unconfirmed by TPCi ([PokéCottage](https://pokecottage.com/pokemon-set-release-calendar))                                                                                                         |
| 30 to 31 Jan 2027      | Birmingham Regional Championships                                          | [Serebii](https://serebii.net/playpokemon/2027/tcg.shtml)                                                                                                                                                   |
| 5 Feb 2027             | **Flowing Fists** (English, Mega Lucario Z ex)                             | Widely reported, not yet official on pokemon.com                                                                                                                                                            |
| 19 to 21 Feb 2027      | **Europe International Championships, ExCeL London**                       | Verified ([Serebii](https://serebii.net/playpokemon/2027/tcg.shtml), [Dittobase](https://www.dittobase.com/championships/events/london-2027))                                                               |
| 19 Feb 2027            | MEGA x MEGA Parade (Japan)                                                 | [PokéCottage](https://pokecottage.com/pokemon-set-release-calendar)                                                                                                                                         |
| 27 Feb 2027 (Saturday) | Pokémon Day, with the usual Presents announcements                         | Calendar. Presents content for 2027 not yet announced                                                                                                                                                       |
| March 2027             | No English set date found                                                  | Gap                                                                                                                                                                                                         |
| 16 to 18 Apr 2027      | London Card Show XL, ExCeL (outside the window, but promote it from March) | [PokePrices](https://www.pokeprices.io/card-shows/uk), [CardPulse](https://www.cardpulse.club/card-shows/london-card-show-xl-apr-2027)                                                                      |

---

## 4. Launch platforms

| Platform                                                                         | Angle                                                                                                                       | Verified rules / facts                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hacker News, Show HN**                                                         | An offline-first PWA, with Show mode working on dead hall Wi-Fi, plus a public REST API and MCP server over a hobby dataset | "Show HN is for something you've made that other people can play with", and should be usable "ideally without barriers such as signups". Not for "landing pages", and feature releases are "generally [not] substantive enough" ([showhn.html](https://news.ycombinator.com/showhn.html)). **Fit:** the no-account showcase binders and guest browsing satisfy the no-signup bar. Link straight to a showcase binder, not the marketing page |
| **Product Hunt**                                                                 | Consumer launch                                                                                                             | Official launch guide at [producthunt.com/launch](https://www.producthunt.com/launch). A direct competitor, Pokébinder, launched 29 Sep 2026, so differentiate in the tagline                                                                                                                                                                                                                                                                |
| **Official MCP Registry**                                                        | Submit first, because the downstream directories ingest from it                                                             | PulseMCP has paused submissions and says to "publish it to the Official MCP Registry... we will pick it up automatically" ([PulseMCP submit, 3 Sep 2026](https://www.pulsemcp.com/submit))                                                                                                                                                                                                                                                   |
| **Glama, Smithery, mcp.so, MCP Market, Docker MCP catalog, awesome-mcp-servers** | MCP discovery                                                                                                               | Glama listing is free (boost $49/mo). Directory counts conflict between sources ([Apideck](https://www.apideck.com/blog/mcp-server-directories), [Claude Market](https://www.claudemarket.ai/blog/best-mcp-directories-to-list-your-mcp-server)). Holo Folder's MCP is remote OAuth and needs Premium, so state that clearly in every listing                                                                                                |
| **PWA directories**                                                              | Installable offline app                                                                                                     | pwastore.io is open for submissions. PWA List was discontinued in May 2025 ([search summary](https://alternativeto.net/software/pwa-list/about)). appsco.pe and findpwa are unverified. Microsoft Store and Google Play (via Trusted Web Activity) are realistic store routes. Apple is not, without a native wrapper                                                                                                                        |
| **AlternativeTo**                                                                | "Alternative to Collectr / Pokellector"                                                                                     | AlternativeTo has a `pokemon-tcg` tag with SleeveUp, CardIndex, RareBit and others listed ([tag](https://alternativeto.net/browse/all/?tag=pokemon-tcg)). Add Holo Folder and suggest it as an alternative on the Collectr and SleeveUp pages                                                                                                                                                                                                |
| **Indie Hackers, BetaList, Uneed, Peerlist, Microlaunch, SaaSHub**               | Solo-dev story                                                                                                              | Not individually verified this session. Standard free listings                                                                                                                                                                                                                                                                                                                                                                               |

---

## 5. Creator outreach

**Named creators (verified to exist; follower figures are as reported):**

| Creator                          | Where                                | Why they fit                                                                                                                                                          | Notes                                                                                          |
| -------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Joel's Gaming Adventures         | UK, YouTube                          | Pokédex binder series filmed at Exeter Card Show ([video](https://www.youtube.com/watch?v=R4oRSw3YQuk))                                                               | **Top fit**: National Dex binder plus card show buying, which is exactly Show mode             |
| The Binder Rebuild (Tom)         | UK, TikTok                           | Vintage binder rebuild, about 3K average views, around 18 posts a month, already has a grading partner code ([Urlebird](https://urlebird.com/user/thebinderrebuild/)) | Open to partner codes                                                                          |
| LuckyJ                           | UK, YouTube                          | Collection and binder tours. Nominated for creator of the year at the UK & Ireland Card Awards ([video](https://www.youtube.com/watch?v=at1D7s-eROg))                 |                                                                                                |
| Manewhell                        | UK (Essex), IG 4.2K, YouTube, TikTok | Binder showcases. VaultX affiliate ([link.me](https://link.me/manewhell))                                                                                             | Already runs affiliate codes                                                                   |
| SleeveUp's UK creator list       | UK                                   | Directory of UK binder creators ([sleeveup.app/creators](https://sleeveup.app/creators))                                                                              | Run by a competitor. Use it to find people, but these creators may already be tied to SleeveUp |
| BabyyPokenator                   | YouTube                              | Themed binder pages. **Sponsored by Collectr** ([video](https://www.youtube.com/watch?v=W8ng68X0PAg))                                                                 | Shows that competitors pay for binder-tour integrations                                        |
| The Poke Wall                    | US, YouTube                          | Binder organisation themes. Openly asks binder companies to send products ([video](https://www.youtube.com/watch?v=Eqyv07ypCAQ))                                      |                                                                                                |
| Ben's Binders (FrostfallPhoenix) | AU, 4.9K YouTube subs                | Master set binder builds ([profile](https://cardgames.social/creators/frostfallphoenix))                                                                              |                                                                                                |

**Costs (estimates; no UK Pokémon-specific rate cards exist):**

- Channels under 10K subscribers: about $50 to $500 per sponsored video. Channels at 10K to 100K: about $200 to $3,000 ([Influencer Marketing Hub](https://influencermarketinghub.com/youtube-influencer-rates), [OutlierKit](https://outlierkit.com/resources/youtube-sponsorship-rates/)).
- TikTok at 10K to 100K followers: about $200 to $800 per video ([IMH micro rates](https://influencermarketinghub.com/micro-influencer-rates/)).
- One modelled Pokémon example: ZapdosTCG, about 137K subs but only around 5K average views, estimated at $55 to $137 per video ([SponsorRadar](https://sponsorradar.com/channels/zapdostcg)). Views matter more than subscriber counts.

**Lightweight referral and affiliate model (recommendation):**

- Give each creator a Stripe promotion code. The viewer gets their first month of Premium free, or a discount on the £34.99 year. The creator gets **30% recurring for 12 months**.
- Track it with the existing campaign/source attribution in `docs/collector-funnel.md` ("approved campaign/source labels"), using one label per creator.
- Pair this with a free lifetime Premium licence for the creator. That costs nothing, and lifetime licences already exist.
- Pay a flat fee (about £50 to £150) only for a dedicated integration from creators with proven views, for example filming Show mode at a card show.
- Skip affiliate platforms until there are more than 10 active creators.

---

## 6. Automation feasibility

### 6a. X API v2

**Verified** from the [official pricing page](https://docs.x.com/x-api/getting-started/pricing):

- Pay-per-use only, with credits bought upfront and "No contracts, subscriptions, or minimum spend".
- Create post: **$0.015**. Create post with URL: **$0.200**. Create post (summoned): $0.010.
- No media upload price is listed. The nearest item is "Media Metadata" at $0.005.
- You can set a spend limit per billing cycle. Reads are capped at 3M posts a month.

**Estimate (third-party):** the free tier closed to new sign-ups on 6 Feb 2026, and legacy Basic subscribers were auto-migrated to pay-per-use from 1 Jun 2026 ([OpenTweet](https://opentweet.io/answers/is-the-x-api-free-in-2026), [Bundle.social](https://bundle.social/blog/x-api-pricing-2026-costs-limits)).

**What it means:** posting directly costs pennies (one post a day without links is about $0.45/month), but **every post containing a link costs $0.20**. A scheduler like Typefully or Buffer publishes through its own X app, so these per-post charges probably don't apply to you. That is an inference, not verified.

### 6b. Instagram Graph API (content publishing)

**Verified** from [Meta's content publishing doc](https://developers.facebook.com/docs/instagram-platform/content-publishing):

- Publishing targets **Instagram professional accounts** (Business or Creator).
- There are two login paths. Instagram Login uses `instagram_business_basic` and `instagram_business_content_publish`. Facebook Login uses `instagram_basic`, `instagram_content_publish` and `pages_read_engagement`.
- **The Instagram Login path does not need a linked Facebook Page.** Postiz documents a "standalone" flow "without having to use a Facebook Business", which requires a professional account ([Postiz docs](https://docs.postiz.com/providers/instagram)).
- Rate limit: "100 API-published posts within a 24-hour moving period". The carousel section of the same doc says 50, so plan for 50. Check live usage with `GET /<IG_ID>/content_publishing_limit` ([reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit)).
- Media "must be hosted on a publicly accessible server". **JPEG is the only image format supported.** The R2 assets are webp, so images need converting or rendering to JPEG.
- Carousels hold up to 20 items. Reels use `media_type=REELS` with `video_url`. Stories use `media_type=STORIES`.
- Containers expire after 24 hours, with a cap of 400 containers per 24 hours ([media reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)).
- 2026 additions: Trial Reels, and an Audio API for Reels (1 Jun 2026) ([changelog](https://developers.facebook.com/docs/instagram-platform/changelog)).

**App review (inferred):** the doc lists Standard versus Advanced Access. For an app that only posts to your own account, Standard Access with the account added as an Instagram Tester role is enough. Postiz documents this tester step. Advanced Access, with App Review and business verification, is only needed for apps that other people use.

### 6c. Typefully

- **Verified:** API v2 and an MCP server (`https://mcp.typefully.com/mcp`) let agents draft, schedule and publish ([API docs](https://typefully.com/docs/api.md), [AI agents page](https://typefully.com/ai-agents.md)). The docs warn you to follow X automation rules or risk a ban.
- **Verified pricing:** the Free plan includes "Agents, API, MCP", **10 posts a month** and 1 social set. Creator allows 1,000 posts a month, and Business 1,500 ([pricing](https://typefully.com/pricing)). The Creator price wasn't readable on the page; third parties say $99/year, billed annually only ([OpenTweet](https://opentweet.io/blog/typefully-pricing-2026)), which is an estimate.
- **Platforms (verified):** the pricing page and the AI agents page both list X, LinkedIn, Threads, Bluesky and Mastodon (pricing also lists Substack). **Instagram is in neither.** Typefully's `llms.txt` does list Instagram ([llms.txt](https://typefully.com/llms.txt)), so the vendor contradicts itself.
- **Conclusion:** treat Typefully as **not supporting Instagram** until it is tested on a real account. A local `typefully` skill is already installed in this environment.

### 6d. Buffer, Later, Postiz

- **Buffer (verified, [pricing](https://buffer.com/pricing)):**
  - Free: 3 channels, 10 scheduled posts per channel (the queue refills), API access with 1,000 requests per channel per month.
  - Essentials: $5 per channel per month ($60/year), unlimited scheduling, 3,000 API requests per channel per month.
  - Channels include **Instagram, X, Threads, Bluesky**, TikTok and YouTube.
  - The API is GraphQL, with agent connectors for Claude and others ([developers.buffer.com](https://developers.buffer.com/)).
  - Instagram auto-publishing only works on professional accounts. Personal profiles fall back to a phone notification ([Buffer help](https://support.buffer.com/article/554-using-instagram-with-buffer)). Collab posts are not supported.
- **Postiz (verified):**
  - Open source under AGPL-3.0, about 41.6k GitHub stars. Self-hosting is free.
  - Providers include Instagram, X, Threads, Bluesky, TikTok and YouTube. It has a public API, webhooks and an MCP server ([GitHub](https://github.com/gitroomhq/postiz-app)).
  - Hosted plans start at $29/month for 5 channels ([pricing](https://postiz.com/pricing)).
  - Self-hosting means **creating your own Meta, X and TikTok developer apps**, and approval "can take weeks". On X you also pay the API per-post costs from 6a. Supports IG feed posts, carousels, Reels and Stories, but not story link stickers ([docs](https://docs.postiz.com/providers/instagram)).
- **Later:** not researched in depth this session.

### 6e. Threads and Bluesky APIs

- **Threads (verified):** 250 API-published posts per profile in a rolling 24 hours. A carousel counts as one post. Usage is visible at `GET /{id}/threads_publishing_limit`, which needs the `threads_basic` and `threads_content_publish` permissions ([Meta Threads overview](https://developers.facebook.com/docs/threads/overview)). It is free.
- **Bluesky (verified from docs.bsky.app via search):** the per-account write budget is 5,000 points an hour and 35,000 a day, and creating a post costs 3 points ([rate limits](https://docs.bsky.app/docs/advanced-guides/rate-limits)). It is free with an app password. Session-creation limits (30 per 5 minutes) come from third parties only.

### 6f. Recommended stack

**Recommendation: one Buffer account as the publishing layer, with an agent drafting into it and Cal approving.**

| Option                             | Covers                                                             | Monthly cost                                                                                | Integration effort                                                        | Verdict                                                       |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **A. Buffer (recommended)**        | X, Instagram, Threads, Bluesky (+ TikTok and YouTube later)        | Free for 3 channels. About $20 for 4 channels on Essentials, about $16.70 on annual billing | One API key, OAuth per channel inside Buffer, no Meta or X developer apps | Simplest, and the only single API verified to cover Instagram |
| B. Typefully + direct IG Graph API | X, Threads, Bluesky via Typefully. Instagram via your own Meta app | About $8 (Creator, annual) + $0                                                             | Two integrations plus a Meta app, long-lived tokens and JPEG hosting      | Better thread editor, more moving parts                       |
| C. Postiz self-hosted              | Everything                                                         | Hosting + X API ($0.20 per link post)                                                       | Own developer apps on every platform, weeks of approvals                  | Most control, most work                                       |

**Suggested flow:**

1. A scheduled agent writes drafts from the TCGdex mirror (set checklists), confidence-gated price data, showcase binders and the changelog.
2. It renders images as JPEG to a public R2 URL.
3. It creates Buffer posts as **drafts or queue items** (the free plan's 10-item queue per channel is a natural approval buffer).
4. Cal reviews in Buffer's UI and publishes or schedules.
5. Once trusted, low-risk formats like changelog posts and set checklist graphics can go fully automatic.

**What Cal must do once:**

1. Switch the Instagram account to Professional (Creator or Business). Linking a Facebook Page is not required for Buffer or the Instagram Login path. Buffer may ask for it for some features; check during setup.
2. Create a Buffer account and connect X, Instagram, Threads and Bluesky by OAuth in Buffer's UI.
3. Generate a Buffer API key and store it as a secret, never in the repo.
4. Confirm the handles, then add them to the Framer site footer and to this file.
5. Write a one-page voice and claims guide: no invented prices, confidence-gated signals only, "not affiliated with The Pokémon Company" where needed, and card image credit rules per AGENTS.md.

**What should stay human-approved:**

- **Replies and DMs on every platform.** Both are reputation risks, and auto-replies on X break its automation rules ([Typefully's warning](https://typefully.com/docs/api.md)).
- **All of Reddit.** r/PokemonTCG bans AI-generated posts and bot accounts outright. The other subs need mod contact first.
- Discord and Facebook groups, which need admin permission.
- Creator outreach and any paid deal.
- Giveaways, which have legal rules and need mod approval on Reddit.
- Any post making a price claim about a specific card, until the confidence-gate check is automated and tested.

---

## 7. Gaps / not verified

- The actual Holo Folder IG and X handles. Ask Cal.
- Live subreddit rule pages: rules quoted are from Jul and Aug 2026 snapshots. r/PokeInvesting and r/PKMNTCGDeals rules are unverified.
- Flowing Fists, the Valentine's Box and the 4 Dec Binder Collection are not yet confirmed on pokemon.com. No English set date is known for March 2027.
- Whether Typefully supports Instagram. Its own pages disagree.
- X media upload pricing isn't listed on the official page.
- Discord member counts are self-reported. The PokeBeach Discord wasn't found.
- Later's API and appsco.pe / findpwa submissions weren't checked.
