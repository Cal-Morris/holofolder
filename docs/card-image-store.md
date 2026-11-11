# Card image mirror storage

Card images are mirrored into object storage and served through `/api/card-image-proxy`; clients never load card images from a third-party host directly. Two kinds of image are mirrored:

- **TCGdex** (`assets.tcgdex.net`), the primary source.
- **Fallback sources** for cards TCGdex has no image for (see `lib/card-image-sources.ts`): TCGplayer product images (`product-images.tcgplayer.com`), pokemontcg.io (`images.pokemontcg.io`), Scrydex (`images.scrydex.com`), Limitless (`limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/…`) and playshop.fr single-card scans (`cdn.shopify.com`, store path only).

Which source each card's image comes from, and why, is recorded in [`card-assets/`](../card-assets/AGENTS.md) (`bun run card-assets plan|verify`).

The storage backend is chosen by `CARD_IMAGE_STORE` (see `lib/card-image-store.ts`):

| `CARD_IMAGE_STORE` | Backend                                       | Required env                                                                                                     |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `r2`               | Cloudflare R2 (S3 API, signed with aws4fetch) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_BASE_URL` (recommended) |
| `blob`             | Vercel Blob                                   | `BLOB_READ_WRITE_TOKEN`; `CARD_IMAGE_BLOB=0` still disables it                                                   |
| `off`              | none, TCGdex live                             | none                                                                                                             |
| unset or unknown   | none, source images served live               | none                                                                                                             |

If a backend is selected but its credentials are missing or invalid, the mirror is off and TCGdex is served live. It never falls through to the other backend. If the store refuses requests (401/403, a blocked store) or throttles them (429/503), the proxy skips it for a cooldown period and serves TCGdex directly.

Production and Preview use `CARD_IMAGE_STORE=r2` with the same R2 bucket and credentials. Development uses `CARD_IMAGE_STORE=off` unless configured explicitly. Deterministic object keys let previews reuse existing mirrored images. An inherited `BLOB_READ_WRITE_TOKEN` never enables Blob on its own. Environment changes only affect new deployments; older preview URLs retain their original configuration.

Every object lives under a brand/game root, `pokemon/tcg/` (`CARD_ASSET_ROOT` in `lib/tcgdex-card-image.ts`), so other games can share the bucket later. The bucket is `holofolder-assets`. Until 2026-11 images lived in `binderdex-card-images` without the root (`cards/...`); `bun run card-assets migrate-bucket` copied them, a Cloudflare URL-rewrite rule on `assets.holofolder.com` maps old `/cards/*` URLs to `/pokemon/tcg/cards/*`, and the app, service worker and developer API accept old-layout URLs and keys and answer with the current ones. `card_image_inventory` accepts both key shapes (migration 113).

Object keys are deterministic:

- TCGdex: `pokemon/tcg/cards/<lang>/<setId>/<localId>/<high|low>.<webp|png|jpg>`, stored as fetched.
- Fallback sources: `pokemon/tcg/cards/src/<source>/<key>.webp`, derived from the origin URL only (so the proxy needs no database lookup):

  | Source       | Origin URL                                                                                               | Key                                                             |
  | ------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
  | `tcgplayer`  | `https://product-images.tcgplayer.com/<productId>.jpg`                                                   | `pokemon/tcg/cards/src/tcgplayer/<productId>.webp`              |
  | `pokemontcg` | `https://images.pokemontcg.io/<set>/<file>.png`                                                          | `pokemon/tcg/cards/src/pokemontcg/<set>/<file>.webp`            |
  | `scrydex`    | `https://images.scrydex.com/pokemon/<cardId>/<large\|medium\|small>`                                     | `pokemon/tcg/cards/src/scrydex/<cardId>/<size>.webp`            |
  | `limitless`  | `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/<SET>/<file>.png`                             | `pokemon/tcg/cards/src/limitless/<SET>/<file>.webp`             |
  | `playshop`   | `https://cdn.shopify.com/s/files/1/1015/7057/6719/files/<handle>.<png\|jpg>`                             | `pokemon/tcg/cards/src/playshop/<handle>.webp`                  |
  | `pokemoncom` | `https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web/<SET>/<SET>_EN_<number>.png` | `pokemon/tcg/cards/src/pokemoncom/<SET>/<SET>_EN_<number>.webp` |

  `cdn.shopify.com` serves every Shopify store, so only the playshop.fr store path counts as a card image (`isCardImageSourceUrl`); the proxy refuses any other path on that host. playshop.fr scans are used only for the French McDonald's collections (2013, 2018, 2019), which no card database has scans for; their stored copies are trimmed of any white margin around the card.

  Fallback images are converted to WebP (quality 85, at most 734 px wide) before upload (`lib/card-image-transform.ts`), so a 900 KB PNG scan becomes about 60–120 KB.

Uploads never overwrite (`If-None-Match: *` on R2, `allowOverwrite: false` on Blob) and carry `Cache-Control: public, max-age=31536000, immutable`.

## Cloudflare R2 setup

1. Cloudflare dashboard → R2 → **Create bucket**. Name it `holofolder-assets`, keep the Standard storage class (the free tier doesn't cover Infrequent Access), and leave the location on Automatic.
2. Give the bucket a public URL by choosing one of these:
   - **Custom domain** (recommended for production; cached by Cloudflare's CDN): bucket → Settings → Custom Domains → Add → `assets.holofolder.com`. The `holofolder.com` zone must be on Cloudflare in the same account. Production also has **Always Use HTTPS** on for the zone, and a cache rule (`assets.holofolder.com`, path starts with `/cards/`) that caches eligible responses, respects the object's `cache-control` and caches 404s at the edge for 60 s only, so a newly mirrored image isn't hidden behind Cloudflare's default 4-hour 404 cache.
   - **r2.dev**: bucket → Settings → Public Development URL → Enable. Cloudflare rate-limits this URL and says it is for development only. It is disabled on the production bucket; keep it off so all reads go through the cached custom domain.
3. R2 → **Manage R2 API tokens** → Create API token. Set the permission to **Object Read & Write**, limit it to **the specific bucket** only, and leave the TTL as you prefer. Copy the Access Key ID and Secret Access Key, which are shown once. The Account ID appears on the R2 overview page.
4. Vercel → the existing project (`binderdex` until renamed) → Settings → Environment Variables. Add these for Production (and Preview, if wanted):
   - `CARD_IMAGE_STORE=r2`
   - `R2_ACCOUNT_ID=<32-char account id>`
   - `R2_ACCESS_KEY_ID=<token access key id>` (sensitive)
   - `R2_SECRET_ACCESS_KEY=<token secret>` (sensitive)
   - `R2_BUCKET=holofolder-assets`
   - `R2_PUBLIC_BASE_URL=https://assets.holofolder.com` (the public card-image bucket custom domain)

   `CARD_IMAGE_BLOB=0` can stay; it only affects Blob. Redeploy production afterwards.

5. Run the backfill (resumable), repeating with the returned cursor until `"done": true`:

   ```sh
   curl -X POST -H "Authorization: Bearer $CARD_DB_SYNC_SECRET" "https://app.holofolder.com/app/api/admin/mirror-card-images"
   curl -X POST -H "Authorization: Bearer $CARD_DB_SYNC_SECRET" "https://app.holofolder.com/app/api/admin/mirror-card-images?cursor=<nextCursor>"
   ```

   New sets are copied by `POST /api/admin/sync-card-db` (add `?images=0` to skip this).

6. Verify: `curl -sI "https://holofolder.com/app/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fme%2Fme05%2F001%2Fhigh.webp"` should show `x-card-image-source: r2`. It shows `tcgdex` the first time an image is fetched and while the store is in its cooldown.

R2 free tier (Standard storage, per month): 10 GB-month storage, 1M Class A ops (PutObject, ListObjects), 10M Class B ops (GetObject, HeadObject), no egress fees. The full mirror is about 40k objects and roughly 2 GB, so it fits comfortably. Usage beyond the free tier is billed, not blocked.

## Fallback sources

Which image a card shows is decided by `pickCardImageUrl` in `lib/card-image-sources.ts`, which every surface uses (search, sets and card detail through `lib/tcg-mirror.ts`, binder slots through `lib/server/inventory-read-catalog.ts`, and the developer API):

1. The image published from the [`card-assets`](../card-assets/AGENTS.md) ledger for the requested language (`external_ids_json.assets.<language>.image`).
2. A reviewed catalog image (`external_ids_json.catalog.image`), set by the catalog tooling when TCGdex has no image or the card is a printing TCGdex doesn't list. Allowed hosts are in `lib/card-catalog.ts`.
3. The TCGdex image in the requested language.
4. For English, the official pokemon.com image. It is only 245 × 342, so it comes after TCGdex's 600 × 825 English print but before a foreign print.
5. The TCGdex image in the nearest fallback language (`image_languages_json`), or `external_ids_json.tcgdex.image` for sets missing from the asset manifest.
6. `pickExternalCardImageUrl`: the pokemontcg.io / Scrydex image matched during the sync, then the TCGplayer product image from TCGdex's third-party ids.

`pickMirrorableSourceImage` follows the same order to find the fallback image for each card, and the backfill uses it:

- `POST /api/admin/sync-card-db` copies a synced set's TCGdex images **and** its fallback images.
- `POST /api/admin/mirror-card-images?set=<id>` and `bun run card-assets mirror-tcgdex --set <id>` do the same for existing sets. Fallback images are checked with one `HEAD` each (Class B) and uploaded only when missing. The per-set result reports `sourcePlanned` and `sourceUploaded`.
- The proxy also copies a fallback image the first time anyone views it (`x-card-image-source: upstream`). After that it's served from the store (`x-card-image-source: r2`).

To add a source, add its host and a strict path rule to `lib/card-image-sources.ts`, add the host to `CATALOG_IMAGE_HOSTS` in `lib/card-catalog.ts` if catalog images may use it, and cover the URL shapes in `tests/card-image-sources.test.ts`. Never allow a whole host with arbitrary paths.

## Filling gaps

`bun run card-assets fill-gaps` (dry run; `--apply` to write) fills what TCGdex lacks from public sources, using the rules in `lib/card-gap-fill.ts`:

- **Images.** A card with no image is matched to a pokemontcg-data card (pokemontcg.io scan, or the Scrydex scan when pokemontcg.io has none) or a TCGplayer product, by collector number and name. Reprint collections such as Classic Collection are matched by name and same-name cards are paired in collector order. The match is stored in `external_ids_json.catalog.image` (`imageSource` records where it came from) and never replaces an image the card already has. Every URL is checked first, and only hosts in `lib/card-image-sources.ts` are used, so each one can be mirrored. Cards whose current fallback image is a dead link (for example pokemontcg.io scans that were removed) are refilled the same way, trying the card's own Scrydex scan first. Sets can also name a Scrydex expansion code (`{ scrydex: "tk10b" }`) or a Limitless set code (`{ limitless: "HSP" }`); those hosts publish no card list, so the card's own collector number addresses the image and they suit only sets numbered like the source (trainer kits, black star promos, McDonald's collections). A set can also name `{ playshop: "<setId>" }`: the script finds playshop.fr products whose handle is `pokemon-<setId>-<number>-…` through the store's product sitemaps, keeps only single-image products (one scanned card) and matches them by number and name like any other source. The script plans, checks every chosen image and replans without the dead ones, so the next source is tried. Scrydex answers unknown ids with HTTP 200 and a stock "image not found" picture; the script recognises it by its ETag and treats it as missing.
- **Aliases.** The same printing under two ids (for example `me55c-106p` and `30th-c-022`) gets `catalog.canonicalId` / `aliasIds`, so only one is listed.
- **Promo sets.** Distributions TCGdex doesn't list (Trick or Trade, Burger King, Countdown Calendar) are imported from TCGplayer product data into the `catalog-supplements` series, with ids `tcgplayer-<productId>`, the printed number as `local_id` and Pokédex links inferred from the card name.

Afterwards run the backfill for the touched sets (`POST /api/admin/mirror-card-images?set=<id>`) and revalidate the mirror cache with a real `POST /api/admin/sync-card-db?set=<id>&images=0`.

## Developer API image availability

REST and MCP return stable public `https://assets.holofolder.com/pokemon/tcg/cards/...` URLs. They read `card_image_inventory` in batches, including nested provider image fields, and never make HEAD or LIST requests to R2 while building JSON. Unknown objects return a null image. Private binder artwork uses its separate bucket and signed URLs.

Apply migrations 068–070 before deploying the API optimization. Seed migration 068 with `bun run card-assets inventory` using the public card bucket's R2 credentials and Supabase service role. This lists only `cards/`, with a 150-request budget, and records confirmed keys without downloading or uploading images. A failed listing never prunes inventory. Mirror uploads and backfills maintain the inventory; rerun the sync after manual object deletions. API reads fail closed if the inventory is unavailable.

The main app uses the same public asset domain, with stored low/high image variants and CORS enabled for GET/HEAD. The image proxy remains the miss/legacy-cache fallback and continues to resize Pokémon artwork. The service worker caches public asset requests and can serve an existing proxy or saved-for-show image when offline, without renaming or deleting those caches.

Vercel functions run in `iad1`, next to the existing Supabase database in US East. `vercel.json` records the region so new deployments preserve it.

## Official pokemon.com scans

`bun run card-assets mirror-pokemoncom [--set a,b] [--dry-run]` copies pokemon.com's official scan of every card it has into R2 and records it as `external_ids_json.pokemoncom.image`, which the read path prefers over the other fallback sources when TCGdex has no image. URLs are built from our own set and card ids (`lib/pokemoncom-card-images.ts`), so only the asset CDN is fetched. The script is idempotent; rerun it after syncing a new set. Sets pokemon.com doesn't have (Base to e-Card, most promos, trainer kits) are skipped after five probes.
