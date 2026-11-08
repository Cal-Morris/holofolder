# Holo Folder rebrand

Historical cutover record. Use [app-routing.md](app-routing.md) for current URLs; raw app/API URLs now include `/app`, including any future eBay endpoint registration. Do not execute the pre-basePath examples below as current setup instructions.

The product is **Holo Folder**, at **https://holofolder.com**. Source, package name, logs, provider user agents, export filenames, public copy, metadata and installed-app branding use the new name. `HOLOFOLDER_E2E=1` enables the test harness; `HOLOFOLDER_TCG_REPO_DIR` configures the local catalog checkout (the previous variable remains accepted).

## Shipping on the existing domain

Ship the branding on **https://binder.cal.gg** now. The domain move is a separate operational step, not a merge gate. Existing auth URL configuration and the production fallback stay on the current origin. eBay verification defaults to its currently registered `https://binder.cal.gg/api/ebay/account-deletion` endpoint. No environment change is needed to ship the rebrand.

## Later domain cutover

This PR does not rename the GitHub repository, local checkout, Vercel project or existing R2 bucket. Cal manages those separately. Complete these steps before releasing the domain change:

1. Attach `holofolder.com` to the existing Vercel project and configure DNS and TLS. The project name can stay as it is.
2. Set production `NEXT_PUBLIC_SITE_URL=https://holofolder.com`. Keep preview/local redirect URLs appropriate for their environments.
3. Update Supabase Auth's Site URL and redirect allowlist for `https://holofolder.com/auth/callback`. Keep the old callback available while existing email links are in flight. Update any branded Auth email templates and provider consent labels to Holo Folder. Check magic-link sign-in and password recovery on the new domain.
4. Set `EBAY_ACCOUNT_DELETION_ENDPOINT=https://holofolder.com/api/ebay/account-deletion` and update eBay's registered account-deletion endpoint to that exact URL, keeping its verification token. The endpoint URL participates in the challenge hash, so the registration and deployed configuration must match.
5. Deploy, verify the production commit, then check `/home`, sign-in, recovery, a binder share, `/manifest.webmanifest`, app installation and `/api/card-image-proxy` on the new domain. Arrange the old domain redirect after the transition; preserve paths and queries for share links and auth callbacks.

## Existing data and installs

Browser storage is isolated by origin. A new domain cannot access the old domain's localStorage, IndexedDB, cached images, cookies or installed PWA. Before switching, sync any queued edits on the old origin, including show purchases and history. Export a binder backup for extra protection. Users sign in again and install the new domain's PWA; synced account data remains in the same Supabase project. Keep the old origin usable until queued edits have synced; an immediate blanket redirect would prevent this.

On the same origin, this is a branding update with no storage migration. Existing `binderdex` localStorage keys, IndexedDB names, cookie names, cache names, history locks and events, worker messages and the save-for-show header deliberately retain their exact bytes. This preserves offline edits, custom artwork, purchases, history, settings and cached cards, and keeps older tabs compatible with the installed worker. Matching test fixtures and technical docs retain those identifiers too. They are compatibility contracts, not visible product branding.

Existing R2 bucket examples and Vercel hostname test fixtures retain their infrastructure names. No schema or database migration is required. Newly exported JSON backups use `holofolder-binder-backup` with version 1 and `holofolder-` filenames; the payload shape is unchanged. CSV downloads also use `holofolder-` filenames.
