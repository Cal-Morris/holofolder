# Delta Reign catalog supplement

TCGdex `/v2/en/sets/me06` returned 404 on 2026-11-06 and its set index omitted Delta Reign. Search and Quick mode already supported set hits; there was no set to find. PR #203 changed pricing-name normalization only, not set mappings.

## Sources

- [Pokémon's launch announcement](https://pokemon.gamespress.com/en-GB/MEDIA-ALERT-Legendary-Pokemon-Mega-Rayquaza-ex-Descends-into-Battle-in): Mega Evolution—Delta Reign, released 2026-11-06.
- [TCGCSV groups](https://tcgcsv.com/tcgplayer/3/groups): group 24831, `ME06: Delta Reign`, printed code `DLR`, published 2026-11-06.
- [TCGCSV products](https://tcgcsv.com/tcgplayer/3/24831/products): 162 products, 141 numbered cards, collector numbers 001–141 with printed denominator 103. The other 21 products were excluded.
- [TCGCSV access rules](https://tcgcsv.com/docs#usage-guidelines) require an application/version User-Agent. `holofolder/1.0.0` succeeded; generic clients were rejected.

## Scoped import

```sh
bun scripts/sync-delta-reign.ts          # dry run, including source/image checks and target inspection
bun scripts/sync-delta-reign.ts --apply # additive, single-transaction upsert of me06 only
```

The importer validates the group identity, collector numbers, denominators, categories and Pokémon names. It uses the existing catalog sync lock and upsert, retains source records and pricing product IDs, preserves existing card IDs, and refuses to replace a set already supplied by another source. It checks at most 250 approved-origin images at concurrency 4. Missing images remain missing; it imports no prices or guessed variants. It never mirrors images.

On 2026-11-06, the dry run and apply verified 141 cards: 114 Pokémon, 24 Trainers and 3 Energy, with 114 Pokédex links and 141 source links. All 141 TCGplayer image endpoints returned an image response. The target initially had zero me06 cards; the transaction committed 141 distinct card numbers. No migration was required.

After applying, invalidate the existing `tcg-mirror` production cache tag. This was done through Vercel's tag invalidation API; the previously stale `query=delta` result then included Delta Reign.

Production API verification:

- `/api/tcg-set-slots?query=delta`: Delta Reign and Delta Species.
- `/api/tcg-set-slots?query=Delta%20Reign`: Delta Reign.
- `/api/tcg-set-slots?setId=me06`: 141 cards, 87 Pokémon slots.
- `/api/tcg-card-search?q=me06`: 60 results, the existing search limit.
- `/api/tcg-set-slots?recent=1`: Delta Reign first.

The DLR alias requires this code deployment. It resolves to me06 in server card/set search and cached offline search. An empty offline catalog stays empty. Search and Quick use the shared set-ranking helper; Sets uses the same server search and offline index.

## Image follow-up

Cal authorized this set's verified TCGplayer images to use the existing Cloudflare R2 path. No mirror or proxy image requests were made during this import: the existing proxy can lazily upload on a read, so it is not a read-only storage check. The current upstream fallback URLs are in the catalog.

Backfill is paused because local R2 credentials are absent and production credentials are non-readable sensitive Vercel variables. Current bucket size and monthly operation usage could not be verified. Obtain current budget/headroom evidence or scoped R2 listing access before running the existing bounded backfill, for example:

```sh
bun scripts/mirror-card-images.ts --set me06 --lang en --quality high --concurrency 2 --max-class-a 200 --max-gb 0.05
```

This is a proposed 200-operation/50 MB ceiling, not evidence of available account allowance. Inspect usage first, then record planned/existing/uploaded counts and verify a sample `x-card-image-source: r2`. Do not run a broad backfill.

## Read-only set-preset recheck, 2026-11-09

At implementation time, the official launch announcement still identifies Delta Reign and its 2026-11-06 release. `https://api.tcgdex.net/v2/en/sets/me06` now returns 200 with ID `me06`, official count 103 and total 141; this differs from the historical 404 above. The live mirror `https://holofolder.com/app/api/tcg-set-slots?setId=me06&language=en` independently returns `me06`, Delta Reign and 141 full-card rows. IDs are `me06-001` through `me06-141`; the set was not substituted. All 141 mirrored `variants` objects were empty at this read, so this evidence cannot generate a verified finish-specific master checklist. Base any-finish targets remain distinct from a Normal finish claim. The new generator additionally requires exact-language confirmation from the deployed catalog read adapter, absent in older responses. No sync/backfill, image proxy fetch, per-card provider read or hosted data write was performed for this recheck.
