# Card image mirror storage

TCGdex card images (only `assets.tcgdex.net`) are mirrored into object storage and served through `/api/card-image-proxy`. The storage backend is chosen by `CARD_IMAGE_STORE` (see `lib/card-image-store.ts`):

| `CARD_IMAGE_STORE` | Backend | Required env |
| --- | --- | --- |
| `r2` | Cloudflare R2 (S3 API, signed with aws4fetch) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_BASE_URL` (recommended) |
| `blob` | Vercel Blob | `BLOB_READ_WRITE_TOKEN`; `CARD_IMAGE_BLOB=0` still disables it |
| `off` | none, TCGdex live | none |
| unset | legacy: Blob if `BLOB_READ_WRITE_TOKEN` is set and `CARD_IMAGE_BLOB` is not `0`, otherwise off | |

If a backend is selected but its credentials are missing or invalid, the mirror is off and TCGdex is served live. It never falls through to the other backend. If the store refuses requests (401/403, a blocked store) or throttles them (429/503), the proxy skips it for a cooldown period and serves TCGdex directly.

Object keys are deterministic: `cards/<lang>/<setId>/<localId>/<high|low>.<webp|png|jpg>`. Uploads never overwrite (`If-None-Match: *` on R2, `allowOverwrite: false` on Blob) and carry `Cache-Control: public, max-age=31536000, immutable`.

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
