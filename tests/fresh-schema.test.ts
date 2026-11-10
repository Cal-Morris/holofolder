import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const databaseUrl = process.env.FRESH_SCHEMA_TEST_DATABASE_URL

test("fresh schema replays documented setup, preserves wish timestamps and handles absent legacy tables", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return
  const url = new URL(databaseUrl)
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "fresh-schema tests require a local database")
  assert.match(url.pathname, /^\/holofolder_fresh_[a-z0-9_]+$/, "use a dedicated holofolder_fresh_* database")
  const localSocket = process.env.FRESH_SCHEMA_TEST_SOCKET
  if (localSocket) assert.ok(["/Users/cal/.local/share/holofolder/onboarding098-local", "/Users/cal/.local/share/holofolder/raw-restore-097-local/s", "/Users/cal/.local/share/holofolder/raw-restore-095-local/s", "/Users/cal/.local/share/holofolder/raw-restore-094-local/s", "/Users/cal/.local/share/holofolder/terminal-093-local/s", "/Users/cal/.local/share/holofolder/recovery-092-local/s", "/Users/cal/.local/share/holofolder/issue365-atomic-import-local/socket", "/Users/cal/.local/share/holofolder/issue396-converted-local/socket", "/Users/cal/.local/share/holofolder/issue396-cascade-local/socket", "/Users/cal/.local/share/holofolder/issue384-creation-local/socket", "/Users/cal/.local/share/holofolder/issue396-creation-recovery-local/socket", "/Users/cal/.local/share/holofolder/issue396-default-recovery-local/socket"].includes(localSocket))
  const db = new Client(localSocket ? { host: localSocket, port: Number(url.port || 5432), user: decodeURIComponent(url.username), database: decodeURIComponent(url.pathname.slice(1)) } : { connectionString: databaseUrl })
  await db.connect()
  try {
    const existing = await db.query("select nspname from pg_namespace where nspname in ('auth','storage') union select schemaname from pg_tables where schemaname='public'")
    assert.equal(existing.rowCount, 0, "database must be empty; this test never clears an existing schema")
    await db.query(readFileSync(new URL("./fixtures/fresh-schema-platform.sql", import.meta.url), "utf8"))
    const scripts = new URL("../scripts/", import.meta.url)
    const settings = readFileSync(new URL("MIGRATIONS.md", scripts), "utf8").match(/```sql\n([\s\S]*?)```/)
    assert.ok(settings, "documented user_settings bootstrap")
    for (const file of readdirSync(scripts).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort()) {
      if (file.startsWith("012")) await db.query(settings[1])
      // psql sends individual statements in autocommit, required by CONCURRENTLY.
      execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", ...(file.startsWith("048") ? ["--single-transaction"] : []), "-f", fileURLToPath(new URL(file, scripts))], {
        env: { ...process.env, PGHOST: localSocket ?? url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) },
        stdio: "pipe",
      })
      if (file.startsWith("009")) {
        await db.query("insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001')")
        await db.query("insert into public.pokemon_collection(user_id,pokemon_id,pokemon_name,card_id,status,collected_at) values ('00000000-0000-4000-8000-000000000001',1,'Synthetic Pokémon','synthetic-card','wishlisted','2020-01-02T03:04:05Z')")
      }
      if (file.startsWith("036")) {
        for (const name of ["passkey_credentials", "tcgdex_cache_jobs"]) {
          assert.equal((await db.query("select to_regclass($1) as name", [`public.${name}`])).rows[0].name, null)
        }
        // The passkey security fix must still work on legacy installations, and be rerunnable.
        await db.query("begin")
        await db.query("create table public.passkey_credentials(user_id uuid); grant select on public.passkey_credentials to anon; alter table public.passkey_credentials enable row level security; create policy \"Service can lookup credentials by id\" on public.passkey_credentials using (true)")
        const securityFix = readFileSync(new URL("036_passkey_credentials_owner_only.sql", scripts), "utf8")
        await db.query(securityFix)
        await db.query(securityFix)
        assert.equal((await db.query("select has_table_privilege('anon','public.passkey_credentials','select') as allowed")).rows[0].allowed, false)
        assert.equal((await db.query("select count(*)::int as n from pg_policies where tablename='passkey_credentials'")).rows[0].n, 0)
        await db.query("rollback")
      }
    }
    const row = (await db.query("select binder_id,wanted_cards from public.pokemon_collection")).rows[0]
    assert.ok(row.binder_id, "existing collection gets its default binder")
    assert.equal(row.wanted_cards[0].card_id, "synthetic-card")
    assert.equal(Date.parse(row.wanted_cards[0].added_at), Date.parse("2020-01-02T03:04:05Z"))
    for (const name of ["pokemon_collection", "user_settings", "binders", "binder_shares", "account_identities", "perpetual_licences"]) {
      assert.equal((await db.query("select relrowsecurity from pg_class where oid=$1::regclass", [`public.${name}`])).rows[0].relrowsecurity, true, name)
    }
    assert.equal((await db.query("select count(*)::int as n from pg_policies where schemaname='public' and tablename='user_settings' and policyname in ('Users can view own settings','Users can insert own settings','Users can update own settings')")).rows[0].n, 3)

  } finally {
    await db.query("rollback")
    await db.end()
  }
})
