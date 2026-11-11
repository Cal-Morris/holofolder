import { createServer } from 'node:http';
import { syntheticPublicDatabase } from '../tests/fixtures/public-binder';

// Local-only synthetic PostgREST for e2e/public-binder-compat.e2e.ts: the REAL token/named routes and SSR.
// Stateless: each scenario is its own owner, token (`synthetic-<name>`) and named slug (`synthetic-owner/<name>`),
// so specs run in parallel. Only `/rest/v1/` reads of the fixture's tables are answered; everything else is 404.
const port = Number(process.env.PUBLIC_SHARE_BACKEND_PORT ?? 54399);
const want = (cardId: string) => ({
  card_id: cardId,
  card_name: 'PRIVATE-stored-name',
  added_at: '2026-01-01T00:00:00.000Z',
  wanted_by: ['00000000-0000-4000-8000-000000000001'],
  notes: 'PRIVATE-notes',
});
function scenario(name: string) {
  const fixture = syntheticPublicDatabase({ scenario: name, disabled: name === 'revoked', prices: name === 'priced' });
  const { tables } = fixture;
  if (name === 'priced') {
    // One-row pages; stored wants with private sentinels on an owned pocket and an unfilled page-3 target.
    Object.assign(tables.binders[0], { binder_rows: 1, binder_cols: 3 });
    tables.binder_slots[0].wanted_cards = [want('synthetic-energy')];
    tables.binder_slots[6].wanted_cards = [want('synthetic-trainer'), want('synthetic-energy')];
  }
  if (name === 'stress') {
    Object.assign(tables.binders[0], { binder_rows: 3, binder_cols: 8, name: 'S'.repeat(40) });
    tables.user_settings[0].dark_mode = false;
    tables.inventory_items[0].grading = {
      grade: 'G'.repeat(500),
      provider: { kind: 'custom', name: 'P'.repeat(500) },
      certificate: 'PRIVATE-certificate',
      label: { assetIds: ['PRIVATE-asset'] },
    };
  }
  return fixture;
}
const scenarios = new Map(['token', 'priced', 'stress', 'revoked'].map((name) => [name, scenario(name)]));
const slugs: Record<string, string> = { mixed: 'token', priced: 'priced', stress: 'stress', revoked: 'revoked' };

async function handle(request: Request) {
  const url = new URL(request.url);
  const name = url.pathname.match(/^\/rest\/v1\/(?:rpc\/)?([a-z_]+)$/)?.[1];
  if (!name || !(name in scenarios.get('token')!.tables))
    return Response.json({ message: 'Not found' }, { status: 404 });
  let candidates = [...scenarios.values()];
  if (name === 'resolve_named_binder_share') {
    const input = await request.json();
    const match =
      input.requested_username === 'synthetic-owner' ? scenarios.get(slugs[input.requested_slug]) : undefined;
    candidates = match ? [match] : [];
  }
  for (const fixture of candidates) {
    let query = fixture.client.from(name).select(url.searchParams.get('select') ?? '*');
    for (const [key, value] of url.searchParams) {
      if (value.startsWith('eq.')) {
        const raw = value.slice(3);
        query = query.eq(key, raw === 'true' ? true : raw === 'false' ? false : raw);
      } else if (value.startsWith('in.'))
        query = query.in(
          key,
          value
            .slice(3)
            .replace(/^\(|\)$/g, '')
            .split(',')
            .map((v) => v.replace(/^"|"$/g, '')),
        );
      else if (value.startsWith('cs.')) query = query.contains(key, JSON.parse(value.slice(3)));
    }
    const order = url.searchParams.get('order')?.split('.')[0];
    if (order) query = query.order(order);
    const offset = Number(url.searchParams.get('offset') ?? 0),
      limit = Number(url.searchParams.get('limit') ?? 1000);
    const { data } = await query.range(offset, offset + limit - 1);
    // Owner-scoped rows exist in one scenario only; catalog rows are the same in every scenario.
    if (Array.isArray(data) && data.length)
      return Response.json(data, { headers: { 'Content-Range': `0-${data.length - 1}/*` } });
  }
  // maybeSingle uses a JSON array and the client enforces zero/one under current supabase-js.
  return Response.json([], { headers: { 'Content-Range': '*/0' } });
}
createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end('Synthetic backend failure');
  }
}).listen(port, '127.0.0.1');
console.log(`Synthetic public-share backend: http://127.0.0.1:${port}`);
