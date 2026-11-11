// Uses synthetic push rows in the configured project; verification writes are always rolled back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

async function main() {
  const apply = process.argv.includes('--apply');
  assert.ok(process.argv.slice(2).every((arg) => arg === '--apply'));
  const connection = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
  assert.ok(connection && process.env.NEXT_PUBLIC_SUPABASE_URL, 'Project database configuration is required');
  const target = new URL(connection);
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  assert.ok(
    target.hostname.startsWith(`db.${project}.`) || target.username.includes(project),
    'Database must match the configured Supabase project',
  );
  target.searchParams.set('sslmode', 'no-verify');
  const db = new Client({ connectionString: target.toString(), connectionTimeoutMillis: 10_000 });
  const migration = await readFile(new URL('./058_partner_push_show_mode.sql', import.meta.url), 'utf8');
  try {
    await db.connect();
    const {
      rows: [schema],
    } = await db.query(
      "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='push_subscriptions' and column_name='show_mode_until') as applied",
    );
    console.log('Show mode migration already applied:', schema.applied);
    await db.query('begin');
    await db.query(migration);
    await db.query(migration);
    const {
      rows: [scope],
    } = await db.query(
      'select p.id,p.owner_user_id,p.user1_id,p.user2_id,b.id as binder from public.partnerships p join public.binders b on b.owner_user_id=p.owner_user_id limit 1',
    );
    assert.ok(scope, 'An existing partnership and binder are required');
    const actor = scope.user1_id,
      recipient = scope.user2_id;
    const id = crypto.randomUUID();
    await db.query(
      "insert into public.partner_acquisitions(id,operation_id,actor_id,recipient_id,owner_user_id,partnership_id,binder_id,pokemon_id,card_id,card_name,actor_name) values($1,$1,$2,$3,$4,$5,$6,1,'synthetic','Synthetic verifier','Synthetic verifier')",
      [id, actor, recipient, scope.owner_user_id, scope.id, scope.binder],
    );
    const {
      rows: [device],
    } = await db.query(
      "insert into public.push_subscriptions(user_id,endpoint,p256dh,auth,label) values($1,$2,'synthetic','synthetic','Synthetic verifier') returning id",
      [recipient, `https://fcm.googleapis.com/synthetic-${id}`],
    );
    const claim = async () =>
      (await db.query('select public.claim_partner_push($1,$2) as token', [id, device.id])).rows[0].token;
    assert.equal(await claim(), null, 'Existing and new devices default to off');
    await db.query("update public.push_subscriptions set show_mode_until=now()-interval '1 second' where id=$1", [
      device.id,
    ]);
    assert.equal(await claim(), null, 'Expired Show mode cannot claim delivery');
    await db.query("update public.push_subscriptions set show_mode_until=now()+interval '4 hours' where id=$1", [
      device.id,
    ]);
    assert.ok(await claim(), 'An active recipient device can claim delivery');
    await db.query('delete from public.partner_push_deliveries where event_id=$1', [id]);
    await db.query('update public.push_subscriptions set show_mode_until=null where id=$1', [device.id]);
    assert.equal(await claim(), null, 'Leaving Show mode blocks pending delivery');
    await db.query(
      "update public.push_subscriptions set show_mode_until=now()+interval '4 hours',user_id=$2 where id=$1",
      [device.id, actor],
    );
    assert.equal(await claim(), null, 'Actor devices remain excluded');
    await db.query('rollback');
    console.log(
      'Migration twice; off, expired, active, exited and actor-device claims verified; synthetic writes rolled back',
    );
    if (apply && !schema.applied) {
      await db.query('begin');
      await db.query(migration);
      await db.query('commit');
      const {
        rows: [result],
      } = await db.query(
        'select count(*)::int as count from public.push_subscriptions where show_mode_until is not null',
      );
      assert.equal(result.count, 0, 'Existing devices default to off');
      console.log('Applied migration 058; existing devices verified off');
    }
  } finally {
    await db.query('rollback').catch(() => undefined);
    await db.end();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Verification failed');
  process.exitCode = 1;
});
