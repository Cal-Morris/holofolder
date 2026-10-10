---
name: adding-a-db-migration
description: Add or change the binderdex Supabase schema with a numbered, idempotent SQL migration in scripts/, documented in scripts/MIGRATIONS.md and applied manually. Use for any new table, column, constraint, index or RLS policy.
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
3. **Security.** User-owned tables need `ENABLE ROW LEVEL SECURITY`, plus policies keyed on `auth.uid()`. Partner-shared data follows the owner rules in `006`/`007` and `lib/server/collection-owner.ts`.
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

## Don'ts

- Don't edit an already-applied migration to change behaviour. Add a new one (catch-up migrations like `017`, `018` and `020` exist for this reason).
- Don't move or rename `004_create_tcg_mirror_tables.sql`; `lib/card-db-sync.ts` reads it at runtime.
- Don't commit connection strings or service keys.
