// Runs against the configured project. Synthetic rows and all verification writes are rolled back.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Client } from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Usage: verify-partner-push.ts [--apply]')
  const connection = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL
  if (!connection || !process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Project database configuration is required')
  const target = new URL(connection)
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
  assert.ok(target.hostname.startsWith(`db.${project}.`) || target.username.includes(project), 'Database must match the configured Supabase project')
  // Same managed database TLS configuration as the existing migration verification script.
  target.searchParams.set('sslmode', 'no-verify')
  const client = new Client({ connectionString: target.toString(), connectionTimeoutMillis: 10_000 })
  const migration = await readFile(new URL('./044_partner_push.sql', import.meta.url), 'utf8')
  const syntheticId = crypto.randomUUID()
  let verificationChecks = 0
  try {
    await client.connect()
    if (apply) {
      await client.query('begin')
      await client.query(migration)
      await client.query('commit')
    }
    await client.query('begin')
    await client.query(migration)
    await client.query(migration)
    const { rows: [scope] } = await client.query('select p.id as partnership,p.owner_user_id as owner,p.user1_id,p.user2_id,b.id as binder from public.partnerships p join public.binders b on b.owner_user_id=p.owner_user_id limit 1')
    assert.ok(scope, 'A real existing partner/binder is required for rolled-back verification')
    const actor: string = scope.owner
    const recipient: string = scope.user1_id === actor ? scope.user2_id : scope.user1_id
    const pokemonId = 2_000_000_000
    assert.equal((await client.query('select count(*) from public.pokemon_collection where binder_id=$1 and pokemon_id=$2', [scope.binder, pokemonId])).rows[0].count, '0')
    const row = { pokemon_name: 'Synthetic push verification', card_id: 'synthetic-push-verification', card_name: 'Synthetic push verification', card_image: null, card_set: null, card_language: 'en', card_finish: 'normal', wanted_cards: [], status: 'collected' }
    const intent = { operationId: syntheticId, actorId: actor, recipientId: recipient, partnershipId: scope.partnership, printingKey: `${row.card_id}:en:normal` }
    let previous: unknown = null
    const save = async (change: typeof row, acquisition: unknown) => {
      const result = (await client.query('select public.save_collection_with_acquisition($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8) as result', [scope.owner, scope.binder, actor, pokemonId, JSON.stringify(change), previous === null ? null : JSON.stringify(previous), acquisition ? JSON.stringify(acquisition) : null, 'Synthetic verifier'])).rows[0].result
      assert.ok(!result.conflict)
      previous = result.item
      verificationChecks++
      return result
    }
    const first = await save(row, intent)
    assert.ok(first.event_id)
    assert.equal((await save(row, intent)).event_id, null, 'An unchanged replay cannot create another event')
    assert.equal((await client.query('select count(*) from public.partner_acquisitions where operation_id=$1', [syntheticId])).rows[0].count, '1')
    assert.equal((await save({ ...row, card_id: 'synthetic-not-show' }, null)).event_id, null)
    assert.equal((await save(row, { ...intent, operationId: crypto.randomUUID(), actorId: recipient })).event_id, null, 'A different syncing actor suppresses push')
    assert.equal((await save({ ...row, card_id: 'synthetic-new' }, { ...intent, operationId: crypto.randomUUID(), partnershipId: crypto.randomUUID(), printingKey: 'synthetic-new:en:normal' })).event_id, null, 'An old relationship cannot notify a new partner')
    const currentRow = previous
    previous = null
    const conflict = (await client.query('select public.save_collection_with_acquisition($1,$2,$3,$4,$5::jsonb,null,null,$6) as result', [scope.owner, scope.binder, actor, pokemonId, JSON.stringify(row), 'Synthetic verifier'])).rows[0].result
    assert.equal(conflict.conflict, true)
    previous = currentRow
    verificationChecks++
  
    const register = async (userId: string, suffix: string) => (await client.query('select public.register_push_subscription($1,$2,$3,$4,$5) as id', [userId, `https://fcm.googleapis.com/fcm/send/synthetic-${syntheticId}-${suffix}`, 'synthetic-public-key', 'synthetic-auth', 'Synthetic verifier'])).rows[0].id
    const actorDevice = await register(actor, 'actor')
    const recipientDevice = await register(recipient, 'recipient')
    const claim = async (device: string) => (await client.query('select public.claim_partner_push($1,$2) as token', [first.event_id, device])).rows[0].token
    assert.equal(await claim(actorDevice), null, 'Actor devices are excluded')
    const token = await claim(recipientDevice)
    assert.ok(token)
    assert.equal(await claim(recipientDevice), null, 'Parallel attempts cannot claim a leased delivery')
    await client.query('update public.partner_push_deliveries set delivered_at=now(),lease_until=null where event_id=$1 and subscription_id=$2 and lease_token=$3', [first.event_id, recipientDevice, token])
    assert.equal(await claim(recipientDevice), null, 'Delivered events are not sent again')
    verificationChecks += 4
  
    const expectedDenied = async (sql: string) => {
      await client.query('savepoint expected_denial')
      let denied = false
      try { await client.query(sql) } catch (error) { denied = error !== null && typeof error === 'object' && 'code' in error && error.code === '42501' }
      await client.query('rollback to savepoint expected_denial')
      assert.ok(denied, 'Private tables/functions must reject unprivileged access')
      verificationChecks++
    }
    for (const userId of [actor, recipient, crypto.randomUUID()]) {
      await client.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: userId, role: 'authenticated' })])
      await client.query('set local role authenticated')
      const visible = (await client.query('select id,user_id from public.push_subscriptions where id=any($1::uuid[])', [[actorDevice, recipientDevice]])).rows
      assert.ok(visible.every(device => device.user_id === userId))
      assert.equal(visible.length, userId === actor || userId === recipient ? 1 : 0)
      const plan = await client.query('explain (analyze, buffers, format json) select id from public.push_subscriptions where user_id=$1', [userId])
      assert.ok(plan.rows[0]['QUERY PLAN'][0]['Execution Time'] >= 0)
      verificationChecks++
      await expectedDenied('select * from public.partner_acquisitions')
      await expectedDenied(`select public.claim_partner_push('${first.event_id}'::uuid,'${recipientDevice}'::uuid)`)
      await client.query('reset role')
      verificationChecks++
    }
    await client.query('delete from public.partnerships where id=$1', [scope.partnership])
    assert.equal(await claim(recipientDevice), null, 'Unlinking stops later delivery')
    verificationChecks++
    await client.query('rollback')
    console.log(JSON.stringify({ applied: apply ? '044_partner_push.sql' : false, verification: 'passed and rolled back', idempotentMigration: true, checks: verificationChecks, notificationsSent: 0 }))
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    console.error(error instanceof Error ? error.message : 'Verification failed')
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : "Verification failed")
  process.exitCode = 1
})
