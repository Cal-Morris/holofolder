// Explicit integration check. Local DB: also exercises simultaneous clients. Hosted DB: rollback only.
// Run with HISTORY_TEST_DATABASE_URL; never defaults to the app's production credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { EMPTY_HISTORY_GENERATION as ZERO, type HistorySnapshot } from '../lib/binder-history';

async function main() {
  const connectionString = process.env.HISTORY_TEST_DATABASE_URL;
  if (!connectionString) throw new Error('Set HISTORY_TEST_DATABASE_URL explicitly');
  const target = new URL(connectionString);
  const local = ['localhost', '127.0.0.1'].includes(target.hostname);
  if (!local && process.env.HISTORY_ALLOW_HOSTED_ROLLBACK !== '1')
    throw new Error('Hosted verification requires HISTORY_ALLOW_HOSTED_ROLLBACK=1');
  target.searchParams.delete('sslmode');
  const connect = async () => {
    const client = new pg.Client({
      connectionString: target.toString(),
      ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
      connectionTimeoutMillis: 10000,
    });
    await client.connect();
    return client;
  };
  const client = await connect();
  const owner = crypto.randomUUID(),
    partner = crypto.randomUUID(),
    stranger = crypto.randomUUID();
  const binder = crypto.randomUUID(),
    secondBinder = crypto.randomUUID(),
    strangerBinder = crypto.randomUUID();
  const deviceA = crypto.randomUUID(),
    deviceB = crypto.randomUUID();
  const add = (seq: number, value: string, generation = ZERO) => ({
    id: crypto.randomUUID(),
    seq,
    kind: 'search',
    op: 'add',
    generation,
    value,
  });
  const asUser = async (db: pg.Client, id: string) => {
    await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [
      id,
      JSON.stringify({ sub: id, role: 'authenticated' }),
    ]);
    await db.query('set local role authenticated');
  };
  const sync = async (
    db: pg.Client,
    account: string,
    device: string,
    actions: unknown[],
    targetBinder = binder,
    targetOwner = owner,
  ) => {
    const { rows } = await db.query('select public.sync_binder_history($1,$2,$3,$4,$5::jsonb) as history', [
      targetBinder,
      targetOwner,
      account,
      device,
      JSON.stringify(actions),
    ]);
    return rows[0].history as HistorySnapshot;
  };
  const denied = async (run: () => Promise<unknown>) => {
    await client.query('savepoint denied');
    await assert.rejects(run);
    await client.query('rollback to savepoint denied');
  };
  try {
    await client.query('begin');
    // Idempotence and all fixture writes are rolled back on the hosted target.
    const migration = await readFile(new URL('./043_binder_history.sql', import.meta.url), 'utf8');
    await client.query(migration);
    await client.query(migration);
    await client.query('insert into auth.users(id) values ($1),($2),($3)', [owner, partner, stranger]);
    await client.query(
      "insert into public.binders(id,owner_user_id,name) values ($1,$2,'History fixture'),($3,$2,'Other fixture'),($4,$5,'Stranger fixture')",
      [binder, owner, secondBinder, strangerBinder, stranger],
    );
    await client.query('insert into public.partnerships(user1_id,user2_id,owner_user_id) values ($1,$2,$1)', [
      owner,
      partner,
    ]);
    await asUser(client, owner);
    const first = add(1, '  Abra   151  ');
    assert.deepEqual((await sync(client, owner, deviceA, [first])).searches, ['Abra 151']);
    await asUser(client, partner);
    assert.deepEqual((await sync(client, partner, deviceB, [add(1, 'kadabra 151')])).searches, [
      'kadabra 151',
      'Abra 151',
    ]);
    assert.equal(
      (await client.query('select count(*)::int n from public.binder_history_entries where binder_id=$1', [binder]))
        .rows[0].n,
      2,
    );
    const plan = await client.query(
      "explain (analyze, buffers) select payload from public.binder_history_entries where binder_id=$1 and kind='card' order by viewed_at desc limit 20",
      [binder],
    );
    assert.ok(plan.rows.some((row) => String(row['QUERY PLAN']).includes('Execution Time')));
    // Retry of an older device action must not reorder another device's newer result.
    await asUser(client, owner);
    assert.deepEqual((await sync(client, owner, deviceA, [first])).searches, ['kadabra 151', 'Abra 151']);
    assert.deepEqual((await sync(client, owner, deviceA, [], secondBinder)).searches, []);
    await denied(() => sync(client, owner, deviceA, [], strangerBinder));
    await denied(() => sync(client, partner, deviceA, [])); // stale cache after account switch
    await denied(() => sync(client, owner, deviceA, [], binder, stranger));
    await denied(() =>
      client.query("insert into public.binder_history_entries values ($1,'search','x','\"x\"',now())", [binder]),
    );
    await asUser(client, stranger);
    await denied(() => sync(client, stranger, deviceA, []));
    assert.equal(
      (await client.query('select count(*)::int n from public.binder_history_entries where binder_id=$1', [binder]))
        .rows[0].n,
      0,
    );
    await client.query('set local role anon');
    await denied(() => sync(client, stranger, deviceA, []));
    await asUser(client, owner);
    const clear = { ...add(2, ''), op: 'clear' };
    assert.deepEqual((await sync(client, owner, deviceA, [clear])).searches, []);
    await asUser(client, partner);
    assert.deepEqual((await sync(client, partner, deviceB, [add(2, 'stale offline query')])).searches, []);
    const next = add(3, 'new after clear', clear.id);
    assert.deepEqual((await sync(client, partner, deviceB, [next])).searches, ['new after clear']);
    const many = Array.from({ length: 12 }, (_, index) => add(index + 4, `fixture ${index}`, clear.id));
    const bounded = await sync(client, partner, deviceB, many);
    assert.equal(bounded.searches.length, 8);
    assert.equal(bounded.searches[0], 'fixture 11');
    const card = {
      id: 'synthetic-1',
      name: 'Synthetic Abra',
      number: '#1',
      setName: 'Synthetic',
      dexId: 63,
      pokemonName: 'abra',
      viewedAt: '1900-01-01',
    };
    const cardAction = { id: crypto.randomUUID(), seq: 16, kind: 'card', op: 'add', generation: ZERO, value: card };
    const cards = (await sync(client, partner, deviceB, [cardAction])).cards;
    assert.equal(cards[0].id, card.id);
    assert.ok(Date.parse(cards[0].viewedAt) > Date.now() - 60000);
    await denied(() => sync(client, partner, deviceB, [{ ...cardAction, seq: 17, value: { id: 'bad' } }]));
    await client.query('reset role');
    console.log(
      'PASS: owner/partner/stranger/anon, other binder/account, RLS, direct-write denial, server dates, bounds, idempotence, clear generation and rollback',
    );
    if (!local) {
      await client.query('rollback');
    } else {
      await client.query('commit');
      const a = await connect(),
        b = await connect();
      try {
        await Promise.all([a.query('begin'), b.query('begin')]);
        await Promise.all([asUser(a, owner), asUser(b, partner)]);
        const results = await Promise.all([
          sync(a, owner, deviceA, [add(3, 'concurrent owner', clear.id)]).then(async (result) => {
            await a.query('commit');
            return result;
          }),
          sync(b, partner, deviceB, [add(17, 'concurrent partner', clear.id)]).then(async (result) => {
            await b.query('commit');
            return result;
          }),
        ]);
        assert.ok(
          results.some(
            (result) => result.searches.includes('concurrent owner') && result.searches.includes('concurrent partner'),
          ),
        );
        console.log('PASS: simultaneous independent clients merge entries atomically');
      } finally {
        await a.end();
        await b.end();
      }
      await client.query('delete from public.binders where id=any($1::uuid[])', [
        [binder, secondBinder, strangerBinder],
      ]);
      await client.query('delete from public.partnerships where user1_id=$1', [owner]);
      await client.query('delete from auth.users where id=any($1::uuid[])', [[owner, partner, stranger]]);
    }
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
