# Private binder artwork in R2

Catalog images use the existing card mirror. User uploads use the separate `holofolder-private-artwork` R2 bucket with public access disabled and no custom domain. Supabase continues to authenticate users and resolve their collection owner; artwork bytes are stored and served by R2.

The UI and developer operations authorize the current collection owner before issuing a five-minute signed URL. Uploads use `PUT`, with the MIME type, exact byte length and `If-None-Match: *` bound into the signature. Send the returned headers and the exact file bytes. Browsers set Content-Length themselves. Reusing an upload identifier cannot overwrite an existing object. Files are limited to PNG, JPEG or WebP, 5 MB and 24 megapixels; image bytes are inspected before an appearance can reference the upload. Downloads are signed GETs and are never served through a public bucket domain.

Configure `R2_ARTWORK_BUCKET`, `R2_ARTWORK_ACCESS_KEY_ID` and `R2_ARTWORK_SECRET_ACCESS_KEY`, plus the existing `R2_ACCOUNT_ID`. Artwork credentials have Object Read & Write permission for this bucket only. The app refuses to use the card-image bucket for private artwork and has no Supabase download fallback.

CORS allows GET, HEAD and PUT from `https://holofolder.com` and `https://app.holofolder.com`, with Content-Type and If-None-Match headers. Add an exact preview or local origin when browser-testing real uploads, then remove it afterwards. CORS is not authorization; signed URLs grant temporary access to whoever holds them. Do not log or share them.

## Cutover

Run `bun scripts/migrate-binder-artwork.ts` to inventory existing Supabase artwork, then `bun scripts/migrate-binder-artwork.ts --apply` with private R2 credentials available. The script pages all objects, preserves owner-scoped paths, copies without overwriting, and compares SHA-256 hashes against a fresh R2 download. It retains Supabase originals for rollback and stops at a 100 MB migration budget. Re-run immediately before deploying and after deploying to catch uploads completed by the old app during the switch. Remove the original objects only in a separately verified cleanup after the cutover is stable.

## Verified setup

The private bucket has no custom domains and its r2.dev domain is disabled. Bucket-scoped credentials are configured in Vercel Production and Preview. Real S3 requests verified MIME and exact-length signature rejection, immutable writes, signed reads, unsigned access denial and production-origin browser CORS. The Supabase inventory and copy verification found zero existing artwork objects on 2026-11-08. Synthetic R2 objects used by verification were removed.
