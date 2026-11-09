import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const socket = process.env.PARTNER_GRID_TEST_SOCKET
const config = { host: "/Users/cal/.local/share/holofolder/issue386-partner-grid-local/socket", port: 55587, user: "partner_grid_test" }
const owner = "00860000-0000-4000-8000-000000000001", partner = "00860000-0000-4000-8000-000000000002"
const stranger = "00860000-0000-4000-8000-000000000003", session = "00860000-0000-4000-8000-000000000004"

test("086 private socket: fresh numbered replay, twice applied, narrow authenticated grid and unchanged ACL/RLS/helpers/data", { skip: !socket, timeout: 120000 }, async () => {
  if (!socket) return
  assert.equal(socket, config.host)
  const admin = new Client({ ...config, database: "postgres" })
  await admin.connect()
  const database = `holofolder_fresh_grid_${Date.now()}`
  await admin.query(`CREATE DATABASE ${database}`)
  const db = new Client({ ...config, database })
  await db.connect()
  try {
    await db.query(readFileSync(new URL("./fixtures/fresh-schema-platform.sql", import.meta.url), "utf8"))
    await db.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF; END $$")
    const scripts = new URL("../scripts/", import.meta.url)
    const bootstrap = readFileSync(new URL("MIGRATIONS.md", scripts), "utf8").match(/```sql\n([\s\S]*?)```/)![1]
    const files = readdirSync(scripts).filter(f => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) < 86).sort()
    for (const file of files) {
      if (file.startsWith("012")) await db.query(bootstrap)
      execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", ...(file.startsWith("048") ? ["--single-transaction"] : []), "-f", fileURLToPath(new URL(file, scripts))], {
        env: { ...process.env, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.user, PGDATABASE: database, PGPASSWORD: "" }, stdio: "pipe",
      })
    }
    const functions = async () => (await db.query(`SELECT p.oid::regprocedure::text name,p.proacl::text,p.proowner,md5(pg_get_functiondef(p.oid)) digest
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private')
      AND p.proname<>'inventory_grid_read_v1' ORDER BY 1`)).rows
    const access = async () => (await db.query(`SELECT n.nspname,c.relname,c.relacl::text,c.relowner,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','collection_audit_private') ORDER BY 1,2`)).rows
    const columns = async () => (await db.query(`SELECT n.nspname,c.relname,a.attname,a.attacl::text FROM pg_attribute a
      JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','auth','storage','collection_audit_private') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3`)).rows
    const beforeColumns = await columns()
    const policies = async () => (await db.query("SELECT * FROM pg_policies ORDER BY schemaname,tablename,policyname")).rows
    await db.query("INSERT INTO auth.users(id) VALUES ($1),($2),($3)", [owner, partner, stranger])
    await db.query("INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2)", [session, owner])
    await db.query("INSERT INTO public.user_settings(user_id,binder_rows,binder_cols) VALUES ($1,2,5),($2,8,8)", [owner, partner])
    await db.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES ($1,$2,$1)", [owner, partner])
    const stored = async () => (await db.query("SELECT md5(jsonb_agg(s ORDER BY s.user_id)::text) digest FROM public.user_settings s")).rows
    const beforeSettings = await stored()
    const beforeFunctions = await functions(), beforeAccess = await access(), beforePolicies = await policies()
    const migration = readFileSync(new URL("086_partner_grid_read.sql", scripts), "utf8")
    await db.query(migration); await db.query(migration)
    assert.deepEqual(await functions(), beforeFunctions)
    assert.deepEqual(await access(), beforeAccess)
    assert.deepEqual(await columns(), beforeColumns)
    assert.deepEqual(await policies(), beforePolicies)
    assert.deepEqual(await stored(), beforeSettings)
    for (const role of ["anon", "authenticated", "holo_mcp", "service_role"]) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'public.inventory_grid_read_v1()','EXECUTE') allowed", [role])).rows[0].allowed, role === "authenticated")
      assert.ok((await db.query(`SELECT has_function_privilege($1,p.oid,'EXECUTE') allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='collection_audit_private' OR p.proname IN ('slot_command_v1','slot_page_v1','inventory_command_v1','slot_catalog_card_v1','slot_saved_count_v1','slot_check_target_v1','inventory_object_v1')`, [role])).rows.every(r => !r.allowed))
      assert.equal((await db.query("SELECT has_function_privilege($1,'public.storage_execute_v1(text,uuid,jsonb)','EXECUTE') allowed", [role])).rows[0].allowed, role === "service_role")
    }
    const fn = (await db.query("SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE oid='public.inventory_grid_read_v1()'::regprocedure")).rows[0]
    assert.equal(fn.prosecdef, true); assert.equal(fn.provolatile, "s"); assert.ok(fn.proconfig.includes('search_path=""'))
    const membership = (await db.query("SELECT id,owner_user_id,user1_id,user2_id FROM public.partnerships WHERE owner_user_id=$1", [owner])).rows[0]
    const auth = async (actor: string, claims: object = {}, role = "authenticated") => {
      await db.query("RESET ROLE")
      await db.query("UPDATE auth.sessions SET user_id=$1,oauth_client_id=NULL,not_after=NULL WHERE id=$2", [actor, session])
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)", [actor, role, JSON.stringify({ sub: actor, role, session_id: session, ...claims })])
      await db.query(`SET ROLE ${role}`)
    }
    const read = async () => (await db.query("SELECT public.inventory_grid_read_v1() r")).rows[0].r
    const evidence = async () => {
      await db.query("RESET ROLE")
      return (await db.query(`SELECT
        (SELECT md5(coalesce(jsonb_agg(s ORDER BY s.user_id)::text,'')) FROM public.user_settings s) settings,
        (SELECT count(*)::int FROM public.collection_activity) events,
        (SELECT count(*)::int FROM collection_audit_private.deltas) deltas,
        (SELECT count(*)::int FROM public.developer_idempotency) ledger`)).rows[0]
    }
    const before = await evidence()
    await auth(owner)
    const own = await read()
    assert.deepEqual(Object.keys(own).sort(), ["owner_user_id", "partnership", "settings"])
    assert.deepEqual(Object.keys(own.settings).sort(), ["binder_cols", "binder_rows", "updated_at"])
    assert.equal(own.settings.binder_rows, 2); assert.equal(own.settings.binder_cols, 5)
    assert.deepEqual(own.partnership, membership)
    await auth(partner)
    assert.deepEqual(await read(), own)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.user_settings WHERE user_id=$1", [owner])).rows[0].n, 0, "033 still hides every owner settings column")
    assert.equal((await db.query("SELECT binder_rows FROM public.user_settings")).rows[0].binder_rows, 8)
    await assert.rejects(db.query("SELECT public.inventory_grid_read_v1($1)", [owner]), { code: "42883" })
    await auth(stranger)
    assert.deepEqual(await read(), { owner_user_id: stranger, partnership: null, settings: null })
    await auth(owner, {}, "anon")
    await assert.rejects(read(), { code: "42501" })
    for (const claims of [{ client_id: "synthetic-oauth" }, { session_id: null }, { session_id: "malformed" }, { session_id: stranger }, { sub: stranger }]) {
      await auth(partner, claims)
      await assert.rejects(read(), { code: "42501" })
    }
    for (const mutation of ["DELETE FROM auth.sessions", "UPDATE auth.sessions SET not_after=now()-interval '1 second'", "UPDATE auth.sessions SET oauth_client_id=gen_random_uuid()"]) {
      await auth(partner); await db.query("RESET ROLE"); await db.query(mutation); await db.query("SET ROLE authenticated")
      await assert.rejects(read(), { code: "42501" })
      await db.query("RESET ROLE"); await db.query("INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [session, partner])
    }
    assert.deepEqual(await evidence(), before, "reads emit no events/ledger or settings writes")
    await db.query("DELETE FROM public.perpetual_licences; DELETE FROM public.billing_accounts; UPDATE public.billing_configuration SET enforced=true; UPDATE auth.users SET created_at=now()-interval '30 days'")
    await auth(partner); await assert.rejects(read(), { code: "42501" })
    await db.query("RESET ROLE"); await db.query("UPDATE public.billing_configuration SET enforced=false")
    await db.query("DELETE FROM public.user_settings WHERE user_id=$1", [owner])
    await auth(partner); assert.equal((await read()).settings, null, "definer proves owner row absence")
    await db.query("RESET ROLE"); await db.query("INSERT INTO public.user_settings(user_id,binder_rows,binder_cols) VALUES ($1,3,6)", [owner])
    await auth(partner); assert.equal((await read()).settings.binder_cols, 6)
    // Non-key membership edits are checked by value, not just membership ID.
    await db.query("RESET ROLE"); await db.query("UPDATE public.partnerships SET user1_id=$1 WHERE id=$2", [stranger, membership.id])
    await auth(partner); await assert.rejects(read(), { code: "42501" })
    await db.query("RESET ROLE"); await db.query("UPDATE public.partnerships SET owner_user_id=$1 WHERE id=$2", [stranger, membership.id])
    await auth(partner); assert.equal((await read()).owner_user_id, stranger); assert.equal((await read()).settings, null)
    await db.query("RESET ROLE"); await db.query("SELECT set_config('request.jwt.claim.sub','',false)"); await db.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES ($1,$2,$1)", [partner, owner])
    await auth(partner); await assert.rejects(read(), { code: "55000" })
    await db.query("RESET ROLE"); await db.query("DELETE FROM public.partnerships")
    await auth(partner)
    const unlinked = await read()
    assert.equal(unlinked.owner_user_id, partner); assert.equal(unlinked.partnership, null)
    assert.equal(unlinked.settings.binder_rows, 8); assert.equal(unlinked.settings.binder_cols, 8)
    await db.query("RESET ROLE")
    await db.query("BEGIN")
    await db.query("SET LOCAL ROLE authenticated")
    const plan = await db.query("EXPLAIN (ANALYZE,BUFFERS) SELECT public.inventory_grid_read_v1()")
    assert.ok(plan.rows.length > 0)
    await db.query("ROLLBACK")
    console.log(`086 local proof: ${files.length} prior numbered files replayed; 086 twice; owner/partner/stranger/anon, session revocation, membership/billing, ACL/RLS/definitions and read purity verified`)
  } finally {
    await db.query("RESET ROLE"); await db.end()
    await admin.query(`DROP DATABASE ${database}`); await admin.end()
  }
})
