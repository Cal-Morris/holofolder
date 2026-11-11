---
name: adding-a-new-tcg-set
description: Bring a newly released Pokémon TCG set into holofolder by syncing its TCGdex card data into Postgres and backfilling its card images into the R2 mirror. Use when a set is missing from the Sets view, search or card selector.
---

# Adding a new TCG set

Card data comes from TCGdex into the Postgres `tcg_*` mirror tables. Images are mirrored into R2 (or Blob) and served by `/api/card-image-proxy`. Normally this needs no code change.

## Steps

1. **Find the TCGdex set id**, e.g. `me05` or `30th-c`, from the TCGdex API or `https://api.tcgdex.net/v2/en/sets`.
2. **Dry run** (no writes):
   ```sh
   curl -X POST -H "Authorization: Bearer $CARD_DB_SYNC_SECRET" \
     "https://app.holofolder.com/app/api/admin/sync-card-db?set=<id>&dryRun=1"
   ```
   Check the card count and the dex links in the response.
3. **Sync it.** Drop `dryRun`, or omit `?set=` to sync everything missing or incomplete, newest first. Repeat the call until the response has `"done": true`. Each call handles `maxSets` sets (default 4, max 12) and returns `remainingSetIds`.
   - The sync upserts (it never truncates), runs under an advisory lock (`409` if another sync is running), and revalidates the `tcg-mirror` cache tag.
   - It also copies each synced set's English `high` and `low` images into the mirror. Add `?images=0` to skip that.
   - The full rebuild is local: `bun run sync-card-db` (needs `POSTGRES_URL_NON_POOLING` or `DATABASE_URL`; supports `--dry-run`). It truncates and reloads the mirror, so prefer the API route for one set.
4. **Back-fill the images**, if they weren't copied during the sync or other languages or qualities are needed:
   - API, resumable:
     ```sh
     curl -X POST -H "Authorization: Bearer $CARD_DB_SYNC_SECRET" \
       "https://app.holofolder.com/app/api/admin/mirror-card-images?set=<id>"
     ```
     Then call it again with `?cursor=<nextCursor>` until `"done": true`.
   - Local alternative that costs no deploy: `bun run card-assets mirror-tcgdex --set <id>`. Flags: `--lang`, `--quality`, `--concurrency`, `--max-class-a`, `--max-gb`. It retries 429s and 5xx with backoff, and stops before the budgets.
   - Uploads never overwrite (`If-None-Match: *`).
5. **Respect limits.**
   - TCGdex images are mirrored, plus fallback-source images (TCGplayer, pokemontcg.io, Scrydex, Limitless) for cards without a TCGdex image. See `docs/card-image-store.md`.
   - Keep within the R2 free tier: 10 GB-month storage and 1M Class A operations per month. The whole mirror is about 40k objects and 2 GB.
   - TCGdex 404s are permanent; don't retry them in a loop.
6. **Verify.**
   - The set shows in the Sets view and in search.
   - This should return `x-card-image-source: r2` (the first fetch of an un-mirrored image says `tcgdex`):
     ```sh
     curl -sI "https://holofolder.com/app/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fme%2Fme05%2F050%2Fhigh.webp"
     ```

## When code changes are needed

- **A set reports 0 official cards** (all reprints, like `30th-c`): it's hidden from "Latest sets" unless it's listed in `ANNIVERSARY_SET_IDS` / `ALWAYS_LISTED_RECENT_SET_IDS` in `lib/tcg-set-slots.ts`. Also consider `SET_SHORTCUTS` in `components/set-population-view.tsx`.
- **Cards without a `dexId`**: `lib/card-dex-inference.ts` infers species from card names. Add a test in `tests/card-dex-inference.test.ts` for any new naming pattern.
- **A set never reaches `done`** because TCGdex lists fewer cards than its total: see `isSetUpToDateWithListedCards` in `lib/card-db-sync-targets.ts`.
- **Adding a column to `tcg_*`**: follow `adding-a-db-migration`, and remember that `scripts/004_create_tcg_mirror_tables.sql` is read at runtime.

For missing Asian sets or language coverage, use `bun run card-assets import-tcgdex --repo <clean tcgdex/cards-database checkout> --lang all --missing` to dry-run an additive import from both source trees, then repeat with `--apply`. For a specific set, use `--set S8b --lang ja`; this also checks assets omitted from the manifest. Follow with `mirror-tcgdex --lang <languages>` or the hosted image-backfill endpoint. This does not run the destructive full rebuild.

Never hand-insert card rows or invent card data. If TCGdex lacks a card image, an alias or a promo set, fill it from public sources with `bun run card-assets fill-gaps` (rules and source mapping in `lib/card-gap-fill.ts`; extend `GAP_IMAGE_SOURCES`, `GAP_CARD_ALIASES` or `GAP_NEW_SETS` with a test), then run the image backfill for the touched sets so the images are copied into the image store. What no source has stays missing.
