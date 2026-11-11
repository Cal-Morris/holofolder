# Additive catalog import, 11 November 2026

Source: [TCGdex cards-database, commit 5fbf524](https://github.com/tcgdex/cards-database/tree/5fbf524a3650cbf33926382388133c5a14965840), both `data/` and `data-asia/`. Imported records retain the commit and source file in `raw_json`. Existing IDs, aliases, reviewed artwork and language evidence are retained. No collection, binder, physical-copy or ownership writes were made.

## Hosted catalog

- Before: 22,103 card records, no Japanese names.
- After: 39,987 card records across 383 sets, including 12,976 records with Japanese names.
- 17,884 new card records. 20,240 records across 223 sets received source data, including additions to existing language/image coverage.
- Thirteen source locales are represented: de, en, es, es-mx, fr, id, it, ja, ko, pt, th, zh-cn, zh-tw. This does not expand the app's existing language picker.
- The four Japanese Neo releases reuse upstream set IDs `neo1` through `neo4` for different international releases. They are reported and skipped instead of merging printings or fabricating IDs.

## Reference printing and image proof

[Pokémon's official record](https://www.pokemon-card.com/card-search/details.php/card/41016) confirms ユキノオー, VMAX Climax S8b 185/184. [TCGdex's Japanese record](https://api.tcgdex.net/v2/ja/cards/S8b-185) supplies the exact upstream ID `S8b-185`, Character Rare, illustrator Mitsuhiro Arita and dex ID 460. The Japanese TCGdex artwork was visually compared with the supplied screenshot.

[The live set endpoint](https://app.holofolder.com/app/api/tcg-set-slots?setId=S8b&language=ja) returns all 285 cards, including `S8b-185` with `language: ja` and `languageConfirmed: true`.

R2 bucket `holofolder-assets` contains `pokemon/tcg/cards/ja/S8b/185/high.webp` and `low.webp`. Both objects retain the Japanese origin URL, origin ETag and SHA-256 metadata. The high image SHA-256 is `6d169cb9ee0bc43716a6c80a06cc9907a31c298c7bf398cdcde6dcbcb99e08c1`. The public image proxy returns HTTP 200 and `x-card-image-source: r2`.

The VMAX Climax backfill uploaded 548 objects: 540 TCGdex image sizes and eight fallback images. Two planned low images, S8b-053 and S8b-236, return upstream 404. All 285 catalog records were imported; image coverage is not complete.

## Remaining image storage gate

Cloudflare reports about 8.14 GB of account-wide R2 payload storage. A catalog/inventory comparison after import finds 176,040 missing TCGdex size/language objects. HEAD samples across languages estimate a further 9.56 GB, not an exact byte total. Completing that backfill would exceed the repository's 10 GB free-tier boundary. It has not been started pending an explicit override of that limit. No new image source or license exception was needed for the reference card.

No merge, deployment or marketing publication was performed. The catalog writes and VMAX Climax image backfill used existing hosted infrastructure; the new import tooling remains a source change in this PR.
