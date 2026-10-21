# Card image mirror storage

Card images are mirrored into object storage and served through `/api/card-image-proxy`; clients never load card images from a third-party host directly. Two kinds of image are mirrored:

- **TCGdex** (`assets.tcgdex.net`), the primary source.
- **Fallback sources** for cards TCGdex has no image for (see `lib/card-image-sources.ts`): TCGplayer product images (`product-images.tcgplayer.com`), pokemontcg.io (`images.pokemontcg.io`), Scrydex (`images.scrydex.com`) and Limitless (`limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/…`).

The storage backend is chosen by `CARD_IMAGE_STORE` (see `lib/card-image-store.ts`):

| `CARD_IMAGE_STORE` | Backend | Required env |
| --- | --- | --- |
| `r2` | Cloudflare R2 (S3 API, signed with aws4fetch) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_BASE_URL` (recommended) |
| `blob` | Vercel Blob | `BLOB_READ_WRITE_TOKEN`; `CARD_IMAGE_BLOB=0` still disables it |
| `off` | none, TCGdex live | none |
| unset | legacy: Blob if `BLOB_READ_WRITE_TOKEN` is set and `CARD_IMAGE_BLOB` is not `0`, otherwise off | |

If a backend is selected but its credentials are missing or invalid, the mirror is off and TCGdex is served live. It never falls through to the other backend. If the store refuses requests (401/403, a blocked store) or throttles them (429/503), the proxy skips it for a cooldown period and serves TCGdex directly.

Object keys are deterministic:

- TCGdex: `cards/<lang>/<setId>/<localId>/<high|low>.<webp|png|jpg>`, stored as fetched.
- Fallback sources: `cards/src/<source>/<key>.webp`, derived from the origin URL only (so the proxy needs no database lookup):

  | Source | Origin URL | Key |
  | --- | --- | --- |
  | `tcgplayer` | `https://product-images.tcgplayer.com/<productId>.jpg` | `cards/src/tcgplayer/<productId>.webp` |
  | `pokemontcg` | `https://images.pokemontcg.io/<set>/<file>.png` | `cards/src/pokemontcg/<set>/<file>.webp` |
  | `scrydex` | `https://images.scrydex.com/pokemon/<cardId>/<large\|medium\|small>` | `cards/src/scrydex/<cardId>/<size>.webp` |
  | `limitless` | `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/<SET>/<file>.png` | `cards/src/limitless/<SET>/<file>.webp` |

  Fallback images are converted to WebP (quality 85, at most 734 px wide) before upload (`lib/card-image-transform.ts`), so a 900 KB PNG scan becomes about 60–120 KB.

Uploads never overwrite (`If-None-Match: *` on R2, `allowOverwrite: false` on Blob) and carry `Cache-Control: public, max-age=31536000, immutable`.

## Cloudflare R2 setup

1. Cloudflare dashboard → R2 → **Create bucket**. Name it e.g. `binderdex-card-images`, keep the Standard storage class (the free tier doesn't cover Infrequent Access), and leave the location on Automatic.
2. Give the bucket a public URL by choosing one of these:
   - **Custom domain** (recommended for production; cached by Cloudflare's CDN): bucket → Settings → Custom Domains → Add → `img.cal.gg`. The `cal.gg` zone must be on Cloudflare in the same account.
   - **r2.dev**: bucket → Settings → Public Development URL → Enable. Cloudflare rate-limits this URL and says it is for development only.
3. R2 → **Manage R2 API tokens** → Create API token. Set the permission to **Object Read & Write**, limit it to **the specific bucket** only, and leave the TTL as you prefer. Copy the Access Key ID and Secret Access Key, which are shown once. The Account ID appears on the R2 overview page.
4. Vercel → binderdex → Settings → Environment Variables. Add these for Production (and Preview, if wanted):
   - `CARD_IMAGE_STORE=r2`
   - `R2_ACCOUNT_ID=<32-char account id>`
   - `R2_ACCESS_KEY_ID=<token access key id>` (sensitive)
   - `R2_SECRET_ACCESS_KEY=<token secret>` (sensitive)
   - `R2_BUCKET=binderdex-card-images`
   - `R2_PUBLIC_BASE_URL=https://img.cal.gg` (or the `https://pub-….r2.dev` URL)

   `CARD_IMAGE_BLOB=0` can stay; it only affects Blob. Redeploy production afterwards.
5. Run the backfill (resumable), repeating with the returned cursor until `"done": true`:

   ```sh
   curl -X POST -H "Authorization: Bearer $CARD_DB_SYNC_SECRET" "https://binder.cal.gg/api/admin/mirror-card-images"
   curl -X POST -H "Authorization: Bearer $CARD_DB_SYNC_SECRET" "https://binder.cal.gg/api/admin/mirror-card-images?cursor=<nextCursor>"
   ```

   New sets are copied by `POST /api/admin/sync-card-db` (add `?images=0` to skip this).
6. Verify: `curl -sI "https://binder.cal.gg/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fme%2Fme05%2F001%2Fhigh.webp"` should show `x-card-image-source: r2`. It shows `tcgdex` the first time an image is fetched and while the store is in its cooldown.

R2 free tier (Standard storage, per month): 10 GB-month storage, 1M Class A ops (PutObject, ListObjects), 10M Class B ops (GetObject, HeadObject), no egress fees. The full mirror is about 40k objects and roughly 2 GB, so it fits comfortably. Usage beyond the free tier is billed, not blocked.

## Fallback sources

Which image a card shows is decided when the mirror tables are read (`lib/tcg-mirror.ts`):

1. A reviewed catalog image (`external_ids_json.catalog.image`), set by the catalog tooling when TCGdex has no image or the card is a printing TCGdex doesn't list. Allowed hosts are in `lib/card-catalog.ts`.
2. The TCGdex image, in the requested language or the nearest fallback language (`image_languages_json`), or `external_ids_json.tcgdex.image` for sets missing from the asset manifest.
3. `pickExternalCardImageUrl` in `lib/card-image-sources.ts`: the pokemontcg.io / Scrydex image matched during the sync, then the TCGplayer product image from TCGdex's third-party ids.

`pickMirrorableSourceImage` follows the same order to find the fallback image for each card, and the backfill uses it:

- `POST /api/admin/sync-card-db` copies a synced set's TCGdex images **and** its fallback images.
- `POST /api/admin/mirror-card-images?set=<id>` and `bun run mirror-card-images --set <id>` do the same for existing sets. Fallback images are checked with one `HEAD` each (Class B) and uploaded only when missing. The per-set result reports `sourcePlanned` and `sourceUploaded`.
- The proxy also copies a fallback image the first time anyone views it (`x-card-image-source: upstream`). After that it's served from the store (`x-card-image-source: r2`).

To add a source, add its host and a strict path rule to `lib/card-image-sources.ts`, add the host to `CATALOG_IMAGE_HOSTS` in `lib/card-catalog.ts` if catalog images may use it, and cover the URL shapes in `tests/card-image-sources.test.ts`. Never allow a whole host with arbitrary paths.

## Filling gaps

`bun scripts/fill-card-gaps.ts` (dry run; `--apply` to write) fills what TCGdex lacks from public sources, using the rules in `lib/card-gap-fill.ts`:

- **Images.** A card with no image is matched to a pokemontcg-data card (pokemontcg.io scan, or the Scrydex scan when pokemontcg.io has none) or a TCGplayer product, by collector number and name. Reprint collections such as Classic Collection are matched by name and same-name cards are paired in collector order. The match is stored in `external_ids_json.catalog.image` (`imageSource` records where it came from) and never replaces an image the card already has. Every URL is checked first, and only hosts in `lib/card-image-sources.ts` are used, so each one can be mirrored. Cards whose current fallback image is a dead link (for example pokemontcg.io scans that were removed) are refilled the same way, trying the card's own Scrydex scan first.
- **Aliases.** The same printing under two ids (for example `me55c-106p` and `30th-c-022`) gets `catalog.canonicalId` / `aliasIds`, so only one is listed.
- **Promo sets.** Distributions TCGdex doesn't list (Trick or Trade, Burger King, Countdown Calendar) are imported from TCGplayer product data into the `catalog-supplements` series, with ids `tcgplayer-<productId>`, the printed number as `local_id` and Pokédex links inferred from the card name.

Afterwards run the backfill for the touched sets (`POST /api/admin/mirror-card-images?set=<id>`) and revalidate the mirror cache with a real `POST /api/admin/sync-card-db?set=<id>&images=0`.
