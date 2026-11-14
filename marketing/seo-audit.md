# Holo Folder SEO audit (holofolder.com)

Audit date: 14 November 2026. It was read-only throughout: curl, a local Lighthouse run, web searches and one read-only count query against the card mirror. Nothing was written or submitted anywhere. Each section separates what I **observed** (with the evidence) from what I **infer**.

## Summary

The technical basics on the Framer side are in good shape. Every one of the 124 URLs in the main sitemap resolves, canonicals are self-referencing and correct, host and trailing-slash variants redirect cleanly in one hop, and titles and descriptions are almost all unique. The two big problems are elsewhere.

The first is that the brand barely shows up in search. Neither web search tool I could use returned a single holofolder.com page for `site:holofolder.com`, `holofolder` or `"Holo Folder" pokemon`. Only Exa's neural index had the homepage.

The second is that the most valuable asset for search sits behind a login and cannot be indexed. That asset is a mirror of 402 sets, 41,454 cards, all 1,025 National Dex Pokémon, 449 illustrators and 23,494 price rows. Collectors search constantly for set card lists, master set sizes and card prices, and competitors such as pokecottage, tcgwatchtower, eyevotcg, cardrake and houseofholos rank for those terms with exactly this kind of data. The 21 or so set guides on the blog cover release dates and card counts but contain no card list.

## Status (14 November 2026)

Week 1 fixes, with the evidence for each. Lighthouse numbers are local lab runs (Lighthouse 12.6, mobile, three runs each against the live homepage).

| #   | Finding                                                  | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | Structured data                                          | Fixed. The homepage has Organization (with `sameAs` for Instagram, X and TikTok), WebSite and SoftwareApplication (free £0 and Premium £3.99 a month, no ratings) JSON-LD. All 60 blog posts have BlogPosting with headline, description, `datePublished` from the Published field, and the Organization as author and publisher. All blocks parse (checked with `JSON.parse` on every blog URL in the sitemap). Framer versions 728321077 and 36d0bd140. |
| 4   | Docs sitemap not in robots.txt                           | Not fixed. The Framer agent API cannot edit robots.txt. Cal: add `Sitemap: https://holofolder.com/app/sitemap.xml` in Framer's site settings if it offers a custom robots.txt, and submit both sitemaps in Search Console and Bing.                                                                                                                                                                                                                       |
| 5   | `/app`, `/mcp`, `/.well-known/...` in the Framer sitemap | Not fixed. They come from the Multi Site rewrite rules, and the API has no per-rule sitemap setting. Removing the rules would break the proxy.                                                                                                                                                                                                                                                                                                            |
| 6   | `/pricing` reuses the homepage title                     | Already fixed before this pass (`Pricing · Holo Folder`).                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | Homepage performance                                     | Improved. The hero H1 appear animation is gone and the three homepage collection thumbnails are 640px WebP instead of 900px PNG. Performance went from 62 to 72 to 76 to 91, and LCP from 8.2 to 8.5 s to 2.5 to 4.7 s. Page weight is still 3.4 MB, mostly JavaScript, including Next.js chunks from `/app` that the homepage loads. Framer offers no lazy-load setting for image fills through the API.                                                 |
| 8   | Docs soft 404                                            | Fixed in #886. `/app/docs/does-not-exist` now returns 404 with noindex in production.                                                                                                                                                                                                                                                                                                                                                                     |
| 9   | Blog `og:type=website`                                   | Not fixed. Framer does not expose `og:type`, and adding a second tag through custom code would leave two conflicting values.                                                                                                                                                                                                                                                                                                                              |
| 10  | Docs `og:title`                                          | Fixed in #886: each docs page's `og:title` is its own title. The shared OG image is unchanged.                                                                                                                                                                                                                                                                                                                                                            |
| 11  | Showcase binders                                         | Fixed in the shares PR: `/@showcase/*` is `index, follow` with a canonical, every share has a visually hidden H1 with the binder name, and card images have "name number set" alt text. Other users' shares and all token shares stay `noindex, nofollow`. Showcase URLs are not in the sitemap, because listing them needs a database read at build time; the Framer collections pages link to them.                                                     |
| 14  | `/favicon.ico` 404 on Framer                             | Not fixed. The agent API cannot add static files.                                                                                                                                                                                                                                                                                                                                                                                                         |
| -   | Invalid share links                                      | Fixed in the shares PR: `/app/share/<bad token>` and unknown `/@user/<slug>` return 404. They keep two robots tags (both noindex), which is Next's standard 404 output and the same as every other 404 in the app.                                                                                                                                                                                                                                        |
| 6   | Set checklist pages (section 6)                          | Shipped in the set pages PR: `/app/sets` and 210 English set pages at `/app/sets/<set-slug>` are `index, follow` with canonicals, CollectionPage/ItemList JSON-LD and the full card list, and all 211 URLs are in `https://holofolder.com/app/sitemap.xml`. No master set totals or prices yet. Cal: resubmit that sitemap in Search Console.                                                                                                             |

## Prioritised findings

| #   | Priority | Finding                                                                                                                                                                                        | Effort                             |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | P0       | No public, indexable set, card or Pokémon pages, even though the full mirror exists. Biggest growth lever.                                                                                     | L (2 to 4 weeks for v1)            |
| 2   | P0       | Brand is not findable in the search indexes checked. Needs a Google Search Console and Bing Webmaster check, sitemap submission and some brand mentions.                                       | S (hours) plus ongoing             |
| 3   | P1       | No structured data anywhere except one FAQPage on `/collections`. Missing Organization, WebSite, SoftwareApplication (home and pricing) and BlogPosting (blog).                                | S to M                             |
| 4   | P1       | The docs sitemap `/app/sitemap.xml` is not referenced in `robots.txt` or the main sitemap.                                                                                                     | XS                                 |
| 5   | P1       | The main sitemap lists three URLs that should not be there: `/app` (noindex, redirects to login), `/mcp` (401) and `/.well-known/oauth-protected-resource` (JSON). It also has no `<lastmod>`. | XS to S                            |
| 6   | P1       | `/pricing` reuses the homepage title and description word for word.                                                                                                                            | XS                                 |
| 7   | P1       | Homepage mobile performance: Lighthouse 65, LCP 6.5 s, 3.6 MB page weight.                                                                                                                     | M                                  |
| 8   | P1       | Unknown `/app/docs/*` URLs are soft 404s: HTTP 200 with `index, follow`.                                                                                                                       | S                                  |
| 9   | P2       | 57 of the roughly 61 blog posts have titles without the brand, and all blog posts use `og:type=website`, not `article`.                                                                        | S                                  |
| 10  | P2       | All 95 docs pages and 38 Framer pages share the generic homepage OG image, and docs `og:title` is the homepage title.                                                                          | S                                  |
| 11  | P2       | Public binder shares (`/@showcase/*`) are `noindex, nofollow`, have no H1 and use empty `alt` on all 14 card images.                                                                           | S, if showcase binders should rank |
| 12  | P2       | No brand Instagram or X account is linked anywhere on the site.                                                                                                                                | XS once accounts exist             |
| 13  | P2       | The app viewport blocks zoom (`maximum-scale=1, user-scalable=no`). This is an accessibility issue, not a ranking one.                                                                         | XS, but it is a product decision   |
| 14  | P2       | Smaller items: `/favicon.ico` returns 404 on Framer, Framer pages have no manifest, 17 descriptions run over 160 characters (32 in docs), and one docs page has an empty description.          | XS                                 |

## 1. robots.txt, sitemaps and duplicate hosts

**Observed:**

- `https://holofolder.com/robots.txt` returns 200 and contains `User-agent: * / Allow: / / Sitemap: https://holofolder.com/sitemap.xml`. It has no second `Sitemap:` line.
- `https://app.holofolder.com/robots.txt` returns a Vercel 404. `https://holofolder.com/app/robots.txt` also returns 404, which is expected because it is not the root robots file.
- `https://holofolder.com/sitemap.xml` (Framer) lists 124 URLs: the homepage, 14 under `/features`, 8 under `/for`, 25 under `/collections`, 67 under `/blog` (posts, 5 category pages and `/blog/sets`), 3 changelog pages, `/pricing`, `/privacy` and `/terms`. It also lists `/app`, `/mcp` and `/.well-known/oauth-protected-resource`. It has no `<lastmod>` values. 123 of the 124 URLs return 200 with no redirect. `/mcp` returns 401, and `/app` returns 200 only after redirecting to `/app/auth/login`, which is `noindex, follow`.
- `https://holofolder.com/app/sitemap.xml` (Next.js `app/sitemap.ts`) lists 95 docs URLs, all with absolute `https://holofolder.com/app/docs/...` locations, and all 95 return 200. It is not referenced from robots.txt or from the Framer sitemap.
- Duplicate-host risk is low. On `app.holofolder.com`, the root `/` returns a 404, `/app` redirects to `holofolder.com/app/auth/login`, and `/app/docs` returns 200 with `<link rel="canonical" href="https://holofolder.com/app/docs">` and `index, follow`. Every other app route carries `noindex` from `app/layout.tsx:28` (`robots: { index: false, follow: true }`).
- `www.` and `http://` both 301 to `https://holofolder.com/`. `http://www` takes two hops (http to https, then www to apex), which is harmless. `/blog/` redirects to `/blog`. `/BLOG` returns 404 because paths are case-sensitive, which is fine.

**Inferred:** the canonical tags on the app host's docs pages are enough to avoid duplicate content. Adding `Sitemap: https://holofolder.com/app/sitemap.xml` to the Framer robots.txt (Framer supports a custom robots.txt) and submitting both sitemaps in Search Console is the cheapest fix on this list. Removing `/app`, `/mcp` and `/.well-known/...` from the Framer sitemap would end the mixed signal of submitting a noindex page and a 401 page. Those three entries probably come from the Multi Site proxy rules, so they may need a Framer setting rather than a page change.

## 2. Page-level on-page audit

All of the Framer pages I sampled have `lang="en"`, one H1, a self-referencing canonical, `max-image-preview:large`, full OG and Twitter card tags (`summary_large_image`), and an `alt` attribute on every image. None has hreflang, which is correct for an English-only site.

| URL                                            | Title                                                               | Description (chars)                                 | H1                                     | JSON-LD     | Words  | Internal links |
| ---------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------- | ----------- | ------ | -------------- |
| `/`                                            | Holo Folder · Pokémon Card Collection Tracker                       | 172                                                 | Your collection, beautifully kept.     | none        | ~1,060 | 83             |
| `/features`                                    | Pokémon Collection Tools & Features · Holo Folder                   | 94                                                  | Know what you own. Find what you want. | none        | ~520   | 81             |
| `/features/pokemon-card-collection-tracker`    | Pokémon Card Collection Tracker & Want List · Holo Folder           | 152                                                 | Know what's in your binder.            | none        | ~970   | 38             |
| `/features/national-dex-tracker`               | National Dex Pokémon Card Collection Tracker · Holo Folder          | 154                                                 | Build a National Dex binder.           | none        | ~930   | 37             |
| `/features/pokemon-card-scanner`               | Pokémon Card Scanner · Holo Folder                                  | 138                                                 | Point the camera. Find the card.       | none        | ~850   | 36             |
| `/features/pokemon-card-price-comparison`      | Pokémon Card Price Comparison & Price History · Holo Folder         | 195                                                 | Know what the number means.            | none        | ~885   | 37             |
| `/for/master-set-collectors`                   | Pokémon Master Set Tracker · Holo Folder                            | 138                                                 | See every gap in the set.              | none        | ~865   | 17             |
| `/pricing`                                     | **Holo Folder · Pokémon Card Collection Tracker** (same as home)    | same as home                                        | Start free. Collect more.              | none        | ~500   | 66             |
| `/blog`                                        | Pokémon Collecting Guides & Set Archive · Holo Folder               | 77                                                  | The collector's notebook.              | none        | ~670   | 83             |
| `/blog/pokemon-prismatic-evolutions-set-guide` | Prismatic Evolutions release date and product guide                 | 133                                                 | same as title                          | none        | ~655   | 9              |
| `/blog/track-a-pokemon-master-set`             | Track a master set printing by printing                             | 85                                                  | same as title                          | none        | ~430   | 8              |
| `/blog/national-dex-vs-master-set`             | Dex or master set? Choose your goal                                 | 80                                                  | same as title                          | none        | ~670   | 8              |
| `/changelog`                                   | Changelog · Holo Folder                                             | 117                                                 | Changelog                              | none        | ~650   | 77             |
| `/collections/base-set-classics`               | Base Set classics: a themed Pokémon binder collection · Holo Folder | 86                                                  | Base Set classics                      | none        | ~670   | 15             |
| `/collections`                                 | Pokémon Binder Ideas: Themed Binder Pages · Holo Folder             | 185                                                 | (1)                                    | **FAQPage** | n/a    | n/a            |
| `/app` (redirects to `/app/auth/login`)        | Holo Folder                                                         | home description                                    | Start your binder                      | none        | 37     | 2              |
| `/app/docs`                                    | Build with your collection · Holo Folder Developers                 | "The cards you collect. The tools you already use." | Build with your collection             | none        | ~660   | 71             |
| `/app/credits`                                 | Credits & attributions                                              | 85                                                  | Credits & attributions                 | none        | ~230   | 1              |
| `/@showcase/base-set-classics`                 | @showcase's Base Set classics · Holo Folder                         | 89                                                  | **none**                               | none        | 87     | n/a            |

Word counts are rough: they include nav and footer text. The internal link counts for blog posts include the mega-menu, and I counted only the in-body links.

**Observed details worth acting on:**

- **Structured data:** only `/collections` has any (FAQPage). The homepage has no Organization, WebSite or SoftwareApplication markup, and blog posts have no BlogPosting markup with `datePublished`, even though they print text like "Checked November 12, 2026".
- **Blog titles:** 57 of the posts have titles without "Holo Folder". Several are vague for search, for example "When a price is stale", "Find the right printing and finish" and "A much better card scanner". The set guides are inconsistent too. Most use "<Set>: release, cards and collecting guide", while others are phrased as questions ("How many cards are in Black Bolt?", "When did Shrouded Fable come out?").
- **Blog body links:** each post links in its body to only one or two other posts plus the sets hub. On the Prismatic Evolutions guide, the only in-body links are `./sets`, `./track-a-pokemon-master-set` and `./pokemon-tcg-product-availability-since-2025`, plus external links to TCGdex and Pokémon press.
- **Social cards:** blog posts use `og:type=website`. The 95 docs pages all reuse the homepage `og:image` (`PDxYOgxwVCIq4f1r45OONtTkdU.jpg`) and the homepage `og:title`, even when the page title differs. 38 Framer pages also use that generic image.
- **Docs soft 404:** `https://holofolder.com/app/docs/does-not-exist` returns HTTP 200 with `<meta name="robots" content="index, follow">` and a canonical to `/app/docs`, while the body says "Page not found". The page calls `notFound()` at `app/docs/[[...slug]]/page.tsx:33`, but the response still goes out as 200. My guess is that the status header is sent before `notFound()` runs (streaming), but I did not verify that.
- **Shares:** `/@showcase/*` pages (linked from all 25 collection pages) return `noindex, nofollow` from `lib/social-metadata.ts:28`. They have no H1, and all 14 card images have `alt=""`. They do have a proper 1200x630 preview `og:image`. `/@showcase` on its own redirects twice and ends at a 404 (`/app/u/showcase`). `/app/u/abc` correctly returns 404 with noindex. `/app/share/abc`, an invalid token, returns 200 with three duplicate robots meta tags (`noindex`, `noindex`, `noindex, follow`).
- **llms.txt:** both `/llms.txt` (Framer) and `/app/llms.txt` exist and are well structured. That is good for AI search.

## 3. Index presence and brand findability

**Observed:**

- **WebSearch:** `site:holofolder.com` returned no holofolder.com results (only holokit, holofil and similar). `holofolder` returned no relevant results. `"Holo Folder" pokemon` returned only Pokémon school stationery. `holo folder pokemon binder app` returned competing apps.
- **Exa:** returned the holofolder.com homepage as the top result for a descriptive query. The other results were competitors: pobinder, houseofholos, pkfolio, collectholo, kibinder, master-setter, holobinder, holotackle, foilio and holofile.
- **Bing and DuckDuckGo:** scraping both returned bot-check or anomaly pages, so neither result counts.
- **Generic terms:** for `pokemon binder app collection tracker`, `prismatic evolutions card list checklist master set` and `national dex binder pokemon layout`, Holo Folder did not appear. Pokecottage, tcgwatchtower, beckett, eyevotcg, cardrake, pokellector and scanpokemon held those results.

**Inferred:** the brand is close to invisible in the indexes I could reach. I could not query Google directly, so the next step is to check Search Console (index coverage, the Performance report for "holo folder" queries) and Bing Webmaster Tools. "Holo Folder" is also a weak brand query on its own, because "holo" and "folder" are both generic hobby words and many similar names exist (HoloBinder, Holofile, Holotackle, House of Holos). Organization JSON-LD with `sameAs` links to the social profiles, plus a few mentions on Reddit and Elite Fourum, would help Google connect the name to the site.

## 4. Performance

The PageSpeed Insights API refused every request with `429 Quota exceeded ... Queries per day` (no API key). I ran Lighthouse 12.6 locally instead, mobile form factor, headless Chrome. These are lab numbers only. There is no field data, and INP cannot be measured in a lab, so TBT stands in for it.

| Page                                           | Perf | A11y | SEO | LCP                          | TBT    | CLS   | Weight     | Top issues                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ---- | ---- | --- | ---------------------------- | ------ | ----- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                            | 65   | 95   | 92  | **6.5 s** (the hero H1 text) | 380 ms | 0.002 | **3.6 MB** | ~585 KB unused JS, ~416 KB oversized images (900x900 PNG collection thumbnails), ~450 KB offscreen images, Framer CDN JS blocking the main thread for 519 ms plus GTM 75 ms, Time to Interactive 16 s, 3 links with non-descriptive text (collection "Read more" style links) |
| `/app/auth/login`                              | 80   | 94   | 66  | 4.4 s                        | 20 ms  | 0     | 611 KB     | 123 KB unused JS. The SEO score is low because of the intended `noindex` and the zoom-blocking viewport                                                                                                                                                                       |
| `/blog/pokemon-prismatic-evolutions-set-guide` | 98   | 95   | 100 | 2.3 s                        | 30 ms  | 0     | 679 KB     | ~57 KB image delivery, 179 KB unused JS                                                                                                                                                                                                                                       |

**Inferred:** blog pages are fine. The homepage LCP is late because the hero text is a Framer appear animation that has to wait for JS, together with a heavy image payload below the fold. Removing the entrance animation on the hero H1 and lazy-loading or resizing the collection thumbnails are the two Framer-side changes I would expect to help most.

## 5. Social handles

**Observed:** I crawled all 122 HTML pages in the Framer sitemap plus the sampled app pages. There are **no links to a Holo Folder Instagram, X, TikTok, YouTube, Threads, Bluesky, Discord or Facebook account** anywhere on the site. The footer offers only `mailto:contact@holofolder.com`. The only social links on the site point to third parties:

- An image attribution to an individual's X post on one collection page.
- A credit to an individual's Reddit profile on `/app/credits`.

If brand accounts exist, they should go in the footer and in Organization `sameAs`.

## 6. Content gaps and a programmatic SEO plan

**Observed coverage:**

| Search intent                                            | Holo Folder page?                                                                                                                                 | Who ranks (from the searches above)                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| "<set> card list" / "<set> checklist"                    | No. Set guides cover only 2024 onwards (`/blog/sets`) and have no card list.                                                                      | pokecottage, beckett, eyevotcg, tcgwatchtower, cardrake, pokellector |
| "<set> master set" / "how many cards in <set>"           | Partly. Some guides give counts (Prismatic Evolutions: 131 base and 180 numbered) but leave out the master set total (447 by competitors' count). | pokecottage, tcgwatchtower                                           |
| "<card> price"                                           | No.                                                                                                                                               | pricecharting, TCGplayer, pokemonpricetracker                        |
| "pokemon binder app" / "pokemon card collection tracker" | Yes: `/features/pokemon-card-collection-tracker`                                                                                                  | App Store listings and the competitors listed in section 3           |
| "national dex binder" / "pokemon binder layout"          | Yes: `/features/national-dex-tracker` and `/blog/national-dex-vs-master-set`                                                                      | pokecottage, finalboss, elitefourum, etsy                            |
| "master set tracker"                                     | Yes: `/for/master-set-collectors`                                                                                                                 | cardrake, PokeCollectr                                               |
| "pokemon binder ideas"                                   | Yes: `/collections`, the strongest page for this, with FAQPage markup                                                                             | etsy, pokecottage                                                    |

**Data available (observed with a read-only count on the mirror):** 402 sets, 41,454 cards, 1,025 distinct Dex numbers, 449 illustrators and 23,494 `card_prices` rows.

**Recommendation:** generate public, server-rendered pages from the mirror in the Next.js app, under the existing `/app` proxy. Framer CMS is the wrong tool at this scale (tens of thousands of items, and the data changes daily). A new proxy path would mean another Multi Site rule. `/app` is already proxied and already inherits the canonical domain through `metadataBase`, so it is the lowest-effort home.

Proposed URLs:

| Page type     | URL                                                                                                  | Count                                            | Content                                                                                                                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sets index    | `/app/sets`                                                                                          | 1                                                | All sets grouped by series and era, with release dates and counts. This route currently redirects to login, so it would need a public variant or a new path.                                                                                                                                 |
| Set checklist | `/app/sets/{set-slug}` (e.g. `/app/sets/prismatic-evolutions`)                                       | ~400                                             | Full card list (number, name, rarity, illustrator, variants), base, numbered and master-set counts, nine-pocket pages needed, a printable checklist, and an "Add this set to a binder" call to action. Title pattern: "Prismatic Evolutions card list and master set checklist (180 cards)". |
| Card          | `/app/cards/{set-slug}/{number}-{name-slug}` (e.g. `/app/cards/prismatic-evolutions/161-umbreon-ex`) | ~41k, start with English and high-interest cards | Image, data, variants, other printings, and a GBP price shown **only when confidence is high or medium**. When the price is unknown, the page should say so, in line with the repo's "never invent prices" rule.                                                                             |
| Pokémon       | `/app/pokemon/{dex}-{name}` (e.g. `/app/pokemon/197-umbreon`)                                        | 1,025                                            | Every card of that species, plus a link to the National Dex binder.                                                                                                                                                                                                                          |
| Illustrator   | `/app/illustrators/{slug}`                                                                           | ~450                                             | Links to the existing illustrator-collection blog post.                                                                                                                                                                                                                                      |

Implementation notes:

- Override the root `noindex` with per-route `robots: { index: true }`, the same way `app/docs/layout.tsx` already does.
- Add these routes to `app/sitemap.ts`, as a sitemap index if the URL count passes 50,000.
- Add Dataset or ItemList JSON-LD on set pages, and Product JSON-LD without an `offers` price unless confidence is gated.
- Use static or `'use cache'` rendering. Per the repo memory note, `use cache: remote` content does not reach prerendered HTML, so these pages need `'use cache'`.
- Link each blog set guide to its checklist page and back.
- Images: keep the copyright notice visible, use descriptive `alt` text ("Umbreon ex 161/131 Prismatic Evolutions"), and remember that card artwork is not covered by TCGdex's licence.
- To avoid thin-page penalties, put only cards that have unique, useful content in the sitemap first, for example English cards that have prices.

Cheap wins before that build:

- Add a master set total and a link to the in-app set checklist to each existing set guide.
- Make the showcase binders indexable by giving the `@showcase` account an index exception, an H1 and card `alt` text.
- Add BlogPosting and SoftwareApplication JSON-LD.

## 7. Broken links and mixed signals

**Observed:**

- `/mcp` is in the sitemap and returns 401.
- `/app` is in the sitemap, then redirects to a noindex login page.
- `/.well-known/oauth-protected-resource` is in the sitemap and returns JSON.
- `/app/docs/*` unknown slugs return 200 with `index, follow` (soft 404).
- `/@showcase` goes through two redirects and ends at a 404.
- `/app/share/<bad token>` returns 200 with three robots meta tags.
- `/favicon.ico` returns 404 on Framer (pages declare icons on framerusercontent, so browsers and Google cope). `/app/favicon.ico` returns 200.
- Framer pages declare no manifest, while `/app/manifest.webmanifest` returns 200.
- `/credits` returns 404. The live page is `/app/credits` (noindex), so check that nothing links to `/credits`.
- The only duplicate title is home vs `/pricing`. The homepage description is also reused on `/pricing` and on the app shell.
- I found no redirect chains longer than two hops, and no 404s among the sitemap URLs.

## Method and limits

- curl, a Python meta extractor over the full Framer sitemap, all 95 docs pages and about 20 sampled pages, and Lighthouse 12.6 run locally.
- Search engines were WebSearch, Exa, and failed scrapes of Bing and DuckDuckGo. None of these is Google, so index findings need confirming in Search Console.
- PSI field (CrUX) data was not available because of the API quota.

Sources: [pokecottage Prismatic Evolutions master set](https://pokecottage.com/prismatic-evolutions-master-set-guide), [Beckett PRE checklist](https://www.beckett.com/news/pokemon-tcg-prismatic-evolutions-checklist-full-pre-card-list/), [tcgwatchtower PRE master set](https://tcgwatchtower.com/pokemon/sets/scarlet-violet/prismatic-evolutions/master-set), [eyevotcg checklist](https://eyevotcg.com/sets/prismatic-evolutions/checklist), [cardrake sv8pt5](https://www.cardrake.com/expansions/sv8pt5), [pokellector](https://www.pokellector.com/Prismatic-Evolutions-Expansion/?list_display=list), [House of Holos](https://houseofholos.app/), [pkfolio](https://pkfolio.com/), [KiBinder](https://www.kibinder.com/games/pokemon), [finalboss Pokédex binder](https://finalboss.io/pokemon-tcg-how-to-build-a-1025-card), [pokecottage master set guides](https://pokecottage.com/pokemon-master-set-guides), [Pokex](https://apps.apple.com/us/app/-/id6758207365), [TCG Stacked](https://www.tcgstacked.com/pokemon/collection-tracker)
