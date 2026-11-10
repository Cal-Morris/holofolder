# Card catalog supplements

TCGdex remains the primary catalog. The supplementary importer unions its records with a pinned historical Pokémon TCG dataset and current TCGCSV product metadata. It does not run during card selection, so provider outages do not slow down or empty the selector.

```bash
bun run sync-card-supplements --source-dir /path/to/source-cache --report /path/to/report.json
```

This is a dry run. It caches public source data for 24 hours, checks candidate product images, and writes a reconciliation report. TCGCSV requests use a custom User-Agent and at most six concurrent requests. The legacy dataset is pinned to `39a26a144c8b6ef6c2fb17b2c29d0bb7121e3a11`; its API is scheduled to close on March 1, 2027, so this importer uses the published files instead.

Review the proposed rows and unresolved matches before applying:

```bash
bun run sync-card-supplements --source-dir /path/to/source-cache --report /path/to/report.json \
  --apply --backup-dir /private/path/to/verified-backup
```

Apply requires a backup less than 24 hours old, with a `public-schema.dump` custom-format pg_dump archive and `manifest.json` containing `createdAt`, `databaseIdentity`, and the dump's `sha256`. `databaseIdentity` is the SHA-256 of the connection host, port, user and database path, excluding its password. Keep backups outside Git, with a private directory and files. Back up the public schema, including binder collections, settings, partnerships, share links and appearances. Verify the archive with `pg_restore --list`. Restore into a separate database first; never overwrite newer user edits with a wholesale restore.

The importer takes the normal catalog-sync advisory lock, rejects a plan if the catalog changed during planning, and briefly takes SHARE locks on the user-data tables while applying. It checks user-table row hashes before and after, retains every existing catalog ID, and commits only if both checks pass. A lock timeout or source error aborts the operation. It writes the verification result beside the backup. Normal application edits resume after the transaction commits.

Catalog additions use the existing `tcg_cards` JSON metadata, so no user-data schema migration is needed:

- `external_ids_json.catalog.canonicalId` identifies a duplicate provider alias. The original row and ID remain available for saved binders. Reviewed `catalog.aliasIds` are carried through card APIs, so combined set selections collapse provider aliases while owned/wanted state still recognizes saved IDs. Distinct stamped printings stay separate; duplicate wanted additions also match language and finish.
- A separate stamped printing gets a stable ID such as `mep-070~685563`. `catalog.localId` retains the printed number `070`; the name includes the stamp for selection and saved-card display.
- `catalog.tcgdexCardId`, `variantId` and `productId` bind pricing to that exact printing. An unavailable stamp-specific price stays unknown. English product IDs never supply a price for another language.
- `catalog.image` is an explicitly checked image URL, taking precedence over base-card artwork. Only TCGdex images are copied into the R2 mirror; product images use the existing same-origin proxy.

The importer only adds unambiguous species/set/number identities. It keeps genuine reprints and stamps distinct, rather than collapsing cards just because artwork looks similar. Parent/gallery aliases are reconciled by set, number and name. A sole stamped variant remains the existing base card. Japanese promo collector suffixes are excluded from English product imports, and uncertain cases stay in the report.

Both full and incremental TCGdex syncs now upsert records and retain supplemental metadata, source links and saved IDs. Refresh existing promo metadata explicitly when needed, because count-based `missing` mode cannot detect changed variants or artwork:

```text
POST /api/admin/sync-card-db?set=mep,30th,mee&maxSets=3&images=0
Authorization: Bearer <configured sync secret>
```

The admin route invalidates the mirror cache after a sync. A CLI supplement import must also be followed by cache invalidation or a fresh deployment before verifying the public selector. Verify both the live API and the selector, including offline reopen, rather than treating database rows as proof of a complete rollout.

For an isolated database preservation test, use a disposable local PostgreSQL database:

```bash
CATALOG_TEST_DATABASE_URL=postgresql://localhost/disposable_catalog bun test tests/card-catalog-database.test.ts
```

The integration test refuses non-local hosts and rolls back its fixtures.

## Global application identity (#509)

`tcg_cards.id`, `tcg_sets.id` and `tcg_series.id` are globally unique opaque application IDs, not provider-local keys that another game can reuse. Canonical IDs and reviewed aliases share this global application namespace. All existing real IDs and rows remain unchanged. Catalog REST/MCP card/set/series projections declare `game:"pokemon"`; nested card set summaries do too. Only Pokémon is implemented and no game selector is offered.

External evidence is scoped by `(game, source, provider-local ID)`. Equal local values from TCGplayer and Cardmarket do not identify the same printing; neither is an application alias. Future ingestion must allocate collision-free application IDs for every card/set/series, namespace provider-local evidence by game/source, and reject collisions or ambiguous/cross-identity aliases before writing the existing global primary keys. Adding game to every inventory/slot identity would not solve PK collisions. There is no new storage model or speculative provider framework here.

Matching accepts only the catalog's explicit ID/canonical/alias evidence, never name, species number or provider-local product ID as a printing ID. The inventory adapter rejects a resolver returning an unrelated printing. A Pokémon species target still requires actual dex membership; generic card/free targets accept Trainers/Energy without dex links. Public import resolution remains a legacy Pokémon-row import helper, not generic physical-copy ingestion.
