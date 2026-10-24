import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const sql = readFileSync(new URL("../scripts/041_show_purchases.sql", import.meta.url), "utf8").replace(/--.*$/gm, "")
const PARTNER_CHECK = /owner_user_id = \(select auth\.uid\(\)\)\s+OR owner_user_id IN \(\s+SELECT p\.owner_user_id FROM public\.partnerships p\s+WHERE p\.user1_id = \(select auth\.uid\(\)\) OR p\.user2_id = \(select auth\.uid\(\)\)\s+\)/

test("show purchases: one row per device purchase, owner or partner only, never updated", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.show_purchases/)
  assert.match(sql, /UNIQUE \(owner_user_id, client_id\)/)
  assert.match(sql, /ALTER TABLE public\.show_purchases ENABLE ROW LEVEL SECURITY;/)
  assert.match(sql, /REVOKE ALL ON public\.show_purchases FROM anon, authenticated;/)
  assert.match(sql, /GRANT SELECT, INSERT, DELETE ON public\.show_purchases TO authenticated;/)
  for (const command of ["SELECT", "INSERT", "DELETE"]) {
    const policy = sql.match(new RegExp(`CREATE POLICY "[^"]+" ON public\\.show_purchases FOR ${command} TO authenticated[\\s\\S]*?;`))
    assert.ok(policy, `${command} policy`)
    assert.match(policy[0], PARTNER_CHECK, `${command} uses the binders' owner-or-partner check`)
  }
  assert.doesNotMatch(sql, /FOR UPDATE|FOR ALL|USING\s*\(\s*true\s*\)|TO anon/i)
  // Everything is re-runnable.
  for (const statement of sql.match(/CREATE (TABLE|INDEX|POLICY)[^;]*/g) ?? []) {
    if (statement.startsWith("CREATE POLICY")) continue
    assert.match(statement, /IF NOT EXISTS/, statement.slice(0, 60))
  }
  assert.equal((sql.match(/DROP POLICY IF EXISTS/g) ?? []).length, 3)
})
