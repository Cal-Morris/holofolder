import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const migration = readFileSync(new URL('../scripts/099_auth_account_native_cascade.sql', import.meta.url), 'utf8')
const socket = '/Users/cal/.local/share/holofolder/auth-delete-099-local/s'
const enabled = process.env.AUTH_DELETE_TEST_SOCKET
const database = process.env.AUTH_DELETE_TEST_DATABASE ?? 'preserve099'
const functions = ['check_slot_placement_v1']

test('099 changes only the deferred placement trigger execution mode', () => {
  const statements = migration.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean)
  assert.deepEqual(statements, ['BEGIN', "SET LOCAL lock_timeout = '3s'", ...functions.map(f => `ALTER FUNCTION public.${f}() SECURITY DEFINER`), 'COMMIT'])
})

test('restricted Auth role proves archive cascades and reports the fresh converted-source blocker', { skip: !enabled }, async () => {
  if (!enabled) return
  assert.equal(enabled, socket)
  assert.ok(['preserve099', 'holofolder_fresh_099'].includes(database))
  const config = { host: socket, port: 55699, user: 'postgres', database }
  const db = new Client(config)
  await db.connect()
  const withConverted = database === 'preserve099'
  const owner = randomUUID(), other = randomUUID(), binder = randomUUID(), converted = randomUUID(), otherBinder = randomUUID()
  const slot = `synthetic-099/${owner}`, item = `synthetic-099-copy/${owner}`
  const flush = () => db.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED')
  const denied = async (run: () => Promise<unknown>, code: string, context?: RegExp) => {
    await db.query('SAVEPOINT rejected')
    await assert.rejects(run(), (e: unknown) => {
      const error = e as { code: string; where?: string; message: string }
      assert.equal(error.code, code)
      if (context) assert.match(`${error.where ?? ''} ${error.message}`, context)
      return true
    })
    await db.query('ROLLBACK TO SAVEPOINT rejected')
  }
  const catalog = async () => (await db.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE relnamespace IN ('public'::regnamespace,'auth'::regnamespace,'collection_audit_private'::regnamespace)) classes,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p) policies,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t) triggers,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a WHERE attrelid IN (SELECT oid FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'auth'::regnamespace,'collection_audit_private'::regnamespace))) attributes,
    (SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_namespace n WHERE nspname NOT LIKE 'pg_temp%' AND nspname NOT LIKE 'pg_toast_temp%') schemas,
    (SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d) defaults,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_roles r) roles`)).rows[0]
  const definitions = async () => (await db.query(`SELECT p.oid::regprocedure::text name, p.prosrc, p.prosecdef, p.proacl::text, pg_get_userbyid(p.proowner) owner, p.proconfig,
    pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','auth','collection_audit_private') AND p.prokind IN ('f','p','w') ORDER BY p.oid`)).rows
  const tables = ['binders', 'storage_collection_state', 'binder_slots', 'inventory_items', 'inventory_placements', 'binder_legacy_rows', 'inventory_owner_state', 'collection_activity', 'perpetual_licences']
  const owned = async (id: string) => {
    const rows: Record<string, unknown> = {}
    for (const table of tables) rows[table] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') r FROM public.${table} t WHERE owner_user_id=$1`, [id])).rows[0].r
    rows.legacy = (await db.query("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') r FROM public.pokemon_collection t WHERE user_id=$1", [id])).rows[0].r
    rows.ledger = (await db.query("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY request_key),'[]') r FROM public.developer_idempotency t WHERE actor_id=$1", [id])).rows[0].r
    return rows
  }
  const auth = new Client(config)
  await auth.connect()
  try {
    assert.equal((await db.query("SELECT current_setting('server_version_num')::int / 10000 major")).rows[0].major, 17, 'PG18 fixes deferred trigger role propagation and cannot reproduce this PG17 defect')
    await auth.query('SET SESSION AUTHORIZATION supabase_auth_admin')
    assert.deepEqual((await auth.query('SELECT current_user,session_user,rolinherit,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0],
      { current_user: 'supabase_auth_admin', session_user: 'supabase_auth_admin', rolinherit: false, rolbypassrls: false })
    assert.deepEqual((await auth.query("SELECT has_table_privilege(current_user,'auth.users','SELECT') s,has_table_privilege(current_user,'auth.users','DELETE') d")).rows[0], { s: true, d: true })
    for (const table of tables.slice(0, 5).concat(['inventory_owner_state', 'collection_activity'])) {
      assert.deepEqual((await db.query("SELECT has_table_privilege('supabase_auth_admin',$1,'SELECT') s,has_table_privilege('supabase_auth_admin',$1,'DELETE') d", [`public.${table}`])).rows[0], { s: false, d: false })
    }
    assert.equal((await db.query("SELECT pg_get_userbyid(relowner) owner FROM pg_class WHERE oid='auth.users'::regclass")).rows[0].owner, 'supabase_auth_admin')
    await db.query('BEGIN')
    await db.query("INSERT INTO auth.users(id,email,created_at) VALUES($1,$2,'2020-01-01'),($3,$4,'2020-01-01')", [owner, `synthetic-099-${owner}@example.invalid`, other, `synthetic-099-${other}@example.invalid`])
    // Licences avoid changing the installation's billing configuration while seeding multiple binders.
    await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual'),($2,'manual')", [owner, other])
    await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1),($2)', [owner, other])
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic native 099',true),($3,$2,'Synthetic converted 099',false),($4,$5,'Synthetic unrelated 099',true)", [binder, owner, converted, otherBinder, other])
    await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots'),($3,$4,'slots')", [binder, owner, otherBinder, other])
    for (const [o,b,s,i] of [[owner,binder,slot,item],[other,otherBinder,`synthetic-099/${other}`,`synthetic-099-copy/${other}`]]) {
      await db.query("INSERT INTO public.inventory_items(id,owner_user_id,identity) VALUES($1,$2,'{\"kind\":\"pokemon\",\"pokemonId\":1}')", [i,o])
      await db.query("INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,status) VALUES($1,$2,$3,0,'collected')", [s,b,o])
      await db.query('INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id) VALUES($1,$2,$3,$4)', [i,o,b,s])
    }
    if (withConverted) {
      await db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic converted 099','collected')", [owner,converted])
      await flush()
      await db.query("SELECT public.convert_legacy_binder_v1($1,$2,public.legacy_binder_evidence_v1($1)->>'rowsDigest')", [converted,owner])
    }
    await db.query("INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result) VALUES($1,'synthetic099','synthetic-099-receipt',repeat('0',64),'{}')", [owner])
    await db.query('COMMIT')
    const fixture = await owned(owner), unrelated = await owned(other)
    for (const key of Object.keys(fixture).filter(k => withConverted || !['legacy', 'binder_legacy_rows'].includes(k))) assert.ok((fixture[key] as unknown[]).length > 0, `fixture has ${key}`)

    // Negative control uses the original invoker mode, then rolls back the failed deletion.
    await db.query('BEGIN')
    for (const f of functions) await db.query(`ALTER FUNCTION public.${f}() SECURITY INVOKER`)
    await db.query('COMMIT')
    await auth.query('BEGIN')
    await auth.query('DELETE FROM auth.users WHERE id=$1', [owner])
    await assert.rejects(auth.query('SET CONSTRAINTS ALL IMMEDIATE'), (e: unknown) => {
      const error = e as { code: string; where: string; message: string }
      assert.equal(error.code, '42501'); assert.match(error.where, /check_slot_placement_v1/)
      console.log(`099 baseline: DELETE succeeds; deferred check_slot_placement_v1 fails 42501: ${error.message}`)
      return true
    })
    await auth.query('ROLLBACK')
    assert.deepEqual(await owned(owner), fixture)
    assert.equal((await db.query("SELECT prosecdef FROM pg_proc WHERE oid='public.guard_storage_authority_v1()'::regprocedure")).rows[0].prosecdef, false)
    const before = await definitions(), security = await catalog()
    for (const f of [...functions, 'guard_storage_authority_v1']) {
      const p = before.find(p => p.name === `${f}()`)
      assert.ok(p); assert.equal(p.owner, 'postgres'); assert.deepEqual(p.proconfig, ['search_path=""'])
    }
    for (let n = 0; n < 2; n++) {
      await db.query(migration)
      const after = await definitions()
      assert.deepEqual(after.map(p => p.name), before.map(p => p.name))
      const changed = after.filter((p,i) => p.definition !== before[i].definition).map(p => p.name)
      assert.deepEqual(changed.sort(), functions.map(f => `${f}()`).sort())
      for (const [i,p] of after.entries()) {
        const expected = { ...before[i] }
        if (changed.includes(p.name)) { expected.prosecdef = true; expected.definition = p.definition }
        assert.deepEqual(p, expected, p.name)
      }
      assert.deepEqual(await catalog(), security)
      assert.deepEqual(await owned(owner), fixture)
      assert.deepEqual(await owned(other), unrelated)
    }
    console.log('099 twice: only placement security mode changed; owners, bodies, EXEC ACLs, RLS, policies, triggers, grants unchanged')
    for (const role of ['anon','authenticated','holo_mcp','service_role']) {
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_proc WHERE pronamespace='collection_audit_private'::regnamespace AND has_function_privilege($1,oid,'EXECUTE')", [role])).rows[0].n, 0)
    }
    assert.equal((await db.query('SELECT enforced FROM collection_audit_private.legacy_write_fence')).rows[0].enforced, false)
    await db.query('BEGIN')
    await db.query('SET LOCAL ROLE service_role')
    await denied(() => db.query('SELECT public.check_slot_placement_v1()'), '0A000')
    await db.query('RESET ROLE')
    for (const role of ['anon', 'authenticated', 'holo_mcp']) {
      await db.query(`SET LOCAL ROLE ${role}`)
      await denied(() => db.query('SELECT public.check_slot_placement_v1()'), '42501')
      await db.query('RESET ROLE')
    }
    await denied(() => db.query('DELETE FROM public.storage_collection_state WHERE collection_id=$1', [binder]), '55000')
    await denied(() => db.query("UPDATE public.storage_collection_state SET authority='legacy' WHERE collection_id=$1", [binder]), '55000')
    await denied(async () => { await db.query('DELETE FROM public.inventory_placements WHERE inventory_item_id=$1', [item]); await flush() }, '23514')
    await denied(() => db.query('UPDATE public.inventory_placements SET owner_user_id=$1 WHERE inventory_item_id=$2', [other,item]), '23503')
    await denied(() => db.query('DELETE FROM public.collection_activity WHERE owner_user_id=$1', [owner]), '42501', /audit_immutable/)
    await denied(() => db.query("UPDATE public.collection_activity SET action='tampered' WHERE owner_user_id=$1", [owner]), '42501', /audit_immutable/)
    // Real nested FK cascade while auth.users still exists must not bypass audit immutability.
    await db.query('CREATE TABLE public.synthetic_099_parent(id uuid PRIMARY KEY)')
    await db.query('INSERT INTO public.synthetic_099_parent VALUES ($1)', [owner])
    await db.query('ALTER TABLE public.collection_activity ADD CONSTRAINT synthetic_099_parent_fk FOREIGN KEY(owner_user_id) REFERENCES public.synthetic_099_parent(id) ON DELETE CASCADE NOT VALID')
    await denied(() => db.query('DELETE FROM public.synthetic_099_parent WHERE id=$1', [owner]), '42501', /audit_immutable/)
    await db.query('ROLLBACK')
    assert.deepEqual(await owned(owner), fixture)
    console.log('099 guards: consistency, authority, cross-owner FKs and audit immutability including nested non-account cascade reject')

    await db.query('BEGIN')
    await db.query('UPDATE public.billing_configuration SET enforced=true,free_binder_limit=1 WHERE id')
    await db.query('DELETE FROM public.perpetual_licences WHERE owner_user_id=$1', [other])
    await denied(() => db.query("INSERT INTO public.binders(owner_user_id,name) VALUES($1,'Synthetic rejected over-limit binder')", [other]), 'P0001', /binder_limit_reached/)
    await db.query('ROLLBACK')
    assert.deepEqual(await owned(other), unrelated)
    console.log('099 billing: free binder limit still rejects under enforced configuration, all configuration changes rolled back')

    // No role reset before either constraint flush or commit.
    await auth.query('BEGIN')
    assert.equal((await auth.query('DELETE FROM auth.users WHERE id=$1 RETURNING id', [owner])).rowCount, 1)
    await auth.query('SET CONSTRAINTS ALL IMMEDIATE')
    await auth.query('COMMIT')
    for (const [key, rows] of Object.entries(await owned(owner))) assert.deepEqual(rows, [], `${key} cascaded`)
    assert.equal((await db.query('SELECT count(*)::int n FROM auth.users WHERE id=$1', [owner])).rows[0].n, 0)
    assert.deepEqual(await owned(other), unrelated)
    assert.equal((await db.query('SELECT count(*)::int n FROM collection_audit_private.pending')).rows[0].n, 0)
    assert.equal((await db.query('SELECT count(*)::int n FROM collection_audit_private.deltas')).rows[0].n, 0)
    if (!withConverted) {
      // Fresh FK creation order exposes an existing converted-source guard blocker.
      // This is an explicit release gate, not evidence of successful converted deletion.
      await db.query('BEGIN')
      const freshConverted = randomUUID()
      await db.query("INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic fresh converted 099')", [freshConverted,other])
      await db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic fresh converted 099','collected')", [other,freshConverted])
      await flush()
      await db.query("SELECT public.convert_legacy_binder_v1($1,$2,public.legacy_binder_evidence_v1($1)->>'rowsDigest')", [freshConverted,other])
      await db.query('COMMIT')
      await auth.query('BEGIN')
      await assert.rejects(auth.query('DELETE FROM auth.users WHERE id=$1', [other]), (e: unknown) => {
        const error = e as { code: string; message: string; where: string }
        assert.equal(error.code, '55000')
        assert.match(error.message, /binder_converted_requires_slot_commands/)
        assert.match(error.where, /guard_legacy_binder_write_v1/)
        return true
      })
      await auth.query('ROLLBACK')
      assert.equal((await db.query('SELECT count(*)::int n FROM auth.users WHERE id=$1', [other])).rows[0].n, 1)
      console.log('099 LIMIT: fresh converted Auth deletion remains blocked by pre-existing guard_legacy_binder_write_v1, SQLSTATE 55000; account retained')
      // Local fixture cleanup only, not an account-deletion proof.
      await db.query('DELETE FROM public.binders WHERE id=$1', [freshConverted])
    }
    await auth.query('BEGIN')
    await auth.query('DELETE FROM auth.users WHERE id=$1', [other])
    await auth.query('COMMIT')
    console.log(`099 Auth session: ${withConverted ? 'native + converted source' : 'native only'} + copies + slots + placements + history + actor ledger deletion commits; unrelated owner unchanged`)
  } finally {
    await auth.query('ROLLBACK'); await auth.end()
    await db.query('ROLLBACK'); await db.end()
  }
})
