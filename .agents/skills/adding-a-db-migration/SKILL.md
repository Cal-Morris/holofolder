---
name: adding-a-db-migration
description: Add or change the Holo Folder Supabase schema with a numbered, idempotent SQL migration in scripts/, documented in scripts/MIGRATIONS.md and applied manually. Use for any new table, column, constraint, index or RLS policy.
---

# Adding a DB migration

There is no migration runner. The schema is the numbered files `scripts/NNN_*.sql`, applied by hand in numeric order through the Supabase SQL editor or `psql`. `scripts/MIGRATIONS.md` is the source of truth for the order and what each file does.

## Steps

1. **Pick the next free number.** Check `ls scripts/*.sql` and `scripts/MIGRATIONS.md`. Gaps are fine; never reuse or renumber.
2. **Write `scripts/NNN_short_description.sql` so it's idempotent.** It must be safe to re-run:
   - `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
   - `DROP CONSTRAINT IF EXISTS` before re-adding a CHECK constraint
   - `DROP POLICY IF EXISTS` before `CREATE POLICY`
   - backfills guarded by `WHERE` clauses, so a second run is a no-op
3. **Security.** User-owned tables need `ENABLE ROW LEVEL SECURITY`, plus policies keyed on `(select auth.uid())` (see Performance below). Partner-shared data follows the owner rules in `006`/`007` and `lib/server/collection-owner.ts`.
4. **Keep enums in sync with the code.** Value lists in CHECK constraints must match the TypeScript unions:
   - card languages, finishes and slot statuses: `lib/domain/cards.ts`
   - price providers: `PriceProvider` in `lib/price-intelligence.ts`. `tests/price-provider-sources.test.ts` parses the migrations, so update it if you add a provider.
5. **Update the code.** Put row mapping in one place: `lib/settings.ts` for `user_settings`, `lib/collection/normalize.ts` for collection rows, and `lib/card-pricing.ts` for prices. Normalize unknown values rather than trusting rows.
6. **Make the app tolerate the migration not being applied yet.** Production is migrated by hand after the merge, so new columns should be optional on read, and writes should not break the existing flows.
7. **Document it** with a row in `scripts/MIGRATIONS.md`.
8. **Verify.**
   - Run the SQL twice against a scratch database or Supabase branch if you have one.
   - Run `bun run test`, `bun run typecheck` and `bun run build`.
9. **In the PR description**, add a "Deploy note: run `scripts/NNN_….sql` against Supabase" and say whether the app works before it's applied.

## Performance conventions

These come from profiling production with `pg_stat_statements`, the Supabase performance advisor and `EXPLAIN ANALYZE` (migrations `032`–`035`).

- **RLS: wrap auth calls in a sub-select.** Write `(select auth.uid())`, `(select auth.jwt())` and `(select auth.role())`. A bare `auth.uid()` is re-evaluated for every row. For partner sharing, use an uncorrelated `user_id IN (SELECT owner_user_id FROM public.partnerships p WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid()))`, not a per-row `EXISTS`. Change existing policies with `ALTER POLICY` so access is never briefly missing.
- **No `OR` across different columns in hot lookups or triggers.** `a = x OR jsonb_col @> y` (or `EXISTS (…) OR EXISTS (…)` correlated per row) can force a scan. Use a `UNION` of index-friendly lookups joined on the key, as in `032`'s `record_collection_activity`.
- **Index for the query, then stop.**
  - Add composite indexes that match `WHERE` plus `ORDER BY`, e.g. `(user_id, updated_at)`.
  - Don't add an index whose columns are a leading prefix of an existing unique or composite index.
  - Every foreign key needs a covering index (advisor: `unindexed_foreign_keys`).
  - Check `pg_stat_user_indexes.idx_scan` before keeping an index "just in case"; `034` dropped 12.
- **Live-safe DDL on production.**
  - Use `CREATE`/`DROP INDEX CONCURRENTLY IF [NOT] EXISTS`. It can't run in a transaction, so apply those statements **one at a time**. The Supabase SQL API and editor wrap a multi-statement run in one transaction.
  - `ADD COLUMN … DEFAULT <constant or now()>` doesn't rewrite the table. A volatile default (e.g. `gen_random_uuid()`) does.
  - Set `lock_timeout` (e.g. `'3s'`) before `ALTER TABLE` on a busy table.
  - `VACUUM` also can't run in a transaction.
- **Verify with a plan, safely.** Run `begin; explain (analyze, buffers) <statement>;` and leave the transaction open; it rolls back, so even writes and triggers can be measured without changing data. To check RLS, do it as a user: `begin; select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true); set local role authenticated; …`. Compare owner, partner, stranger and anon visibility before and after policy changes.
- **PostgREST returns at most 1000 rows.** It drops the rest silently. Any read that can exceed that (collections, all-users scans) must page with `fetchAllRows` (`lib/supabase/fetch-all-rows.ts`) and a stable, unique `order()`.
- **Binders.** Storage rows belong to a binder (`collection_id`); never add a per-owner unique on `binder_shares` again.
- **Audit.** A new writer of the collection tables records its own `collection_activity` row with `collection_audit_private.record_v1` (collect each statement's before/after with `RETURNING` and `collection_audit_private.delta`, see 108). Don't add row-level audit triggers.
- **Connections.**
  - App code talks to Postgres through PostgREST (`@supabase/supabase-js`), which pools for us.
  - Only the bulk catalog sync (`lib/card-db-sync.ts`) opens a direct connection, through `POSTGRES_URL_NON_POOLING` (or `DATABASE_URL`). It needs long transactions, which the pooler's transaction mode (port 6543: no session state, no prepared statements) doesn't suit.
  - Don't open `pg` clients in request handlers.
- **Catalog reads are cached, not queried.** Public catalog routes use `"use cache: remote"` with the `tcg-mirror` tag and `PUBLIC_JSON_CACHE_HEADERS` (`lib/http-cache.ts`). Follow that for new read-only catalog endpoints instead of adding DB work per request.

## Don'ts

- Don't edit an already-applied migration to change behaviour. Add a new one (catch-up migrations like `017`, `018` and `020` exist for this reason).
- Don't move or rename `004_create_tcg_mirror_tables.sql`; `lib/card-db-sync.ts` reads it at runtime.
- Don't commit connection strings or service keys.
