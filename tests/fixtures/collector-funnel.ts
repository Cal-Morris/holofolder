import assert from 'node:assert/strict';

async function run() {
  process.env.VERCEL_ENV = 'production';
  process.env.HOLOFOLDER_FUNNEL_ENABLED = 'true';
  let actor: string | null = 'synthetic-partner',
    unavailable = false;
  const events = new Map<string, Record<string, unknown>>();
  const accounts: Record<string, unknown>[] = [];
  const scheduled: Array<() => Promise<unknown>> = [];
  const admin = {
    rpc(_name: string, values: Record<string, unknown>) {
      return {
        abortSignal: async () => {
          if (!unavailable) accounts.push(values);
          return { error: unavailable ? { code: '42P01' } : null };
        },
      };
    },
    from() {
      return {
        upsert(values: Record<string, unknown>, options: Record<string, unknown>) {
          assert.equal(options.ignoreDuplicates, true);
          return {
            abortSignal: async () => {
              if (!unavailable && !events.has(String(values.owner_id) + values.event_key))
                events.set(String(values.owner_id) + values.event_key, values);
              return { error: unavailable ? { code: '42P01' } : null };
            },
          };
        },
      };
    },
  };
  // @ts-expect-error Bun module mocks run only in this subprocess.
  const { mock } = await import('bun:test');
  mock.module('server-only', () => ({}));
  mock.module('next/server', () => ({ after: (action: () => Promise<unknown>) => scheduled.push(action) }));
  mock.module('../../lib/supabase/admin', () => ({ createAdminClient: () => admin }));
  mock.module('../../lib/server/billing', () => ({ getBillingAccess: async () => ({ savedCardCount: 0 }) }));
  const now = Math.floor(Date.now() / 1000);
  const invoice = (id: string, at: number) => ({
    id,
    status: 'paid',
    currency: 'gbp',
    amount_paid: 399,
    billing_reason: 'subscription_cycle',
    parent: { subscription_details: { subscription: 'sub_synthetic' } },
    status_transitions: { paid_at: at },
    lines: {
      has_more: false,
      data: [
        {
          amount: 399,
          pricing: { price_details: { price: 'price_synthetic' } },
          period: { start: at, end: at + 2592000 },
        },
      ],
    },
  });
  mock.module('../../lib/server/stripe', () => ({
    billingPriceIds: () => ({ month: 'price_synthetic', year: 'price_annual' }),
    billingRecognizedPriceIds: () => ['price_synthetic', 'price_annual'],
    getStripe: () => ({
      subscriptions: {
        async *list() {
          yield {
            id: 'sub_synthetic',
            metadata: { app: 'holofolder' },
            items: { data: [{ price: { id: 'price_synthetic' }, quantity: 1 }] },
          };
        },
      },
      invoices: {
        async *list() {
          yield invoice('in_recent', now - 60);
          yield invoice('in_expired', now - 100 * 86400);
        },
      },
    }),
  }));
  mock.module('../../lib/server/collection-owner', () => ({
    resolveCollectionOwnerUserId: async () => 'synthetic-owner',
  }));
  const identity = await import('../../lib/server/public-binder-identity');
  mock.module('../../lib/server/public-binder-identity', () => ({
    ...identity,
    identitySession: async () => {
      if (!actor) throw new identity.IdentityError('Not signed in', 401);
      return { user: { id: actor } };
    },
  }));
  const { POST } = await import('../../app/api/collector-events/route');
  const service = await import('../../lib/server/collector-funnel');
  const request = (body: unknown, origin = 'https://synthetic.test') =>
    new Request('https://synthetic.test/app/api/collector-events', {
      method: 'POST',
      headers: { origin },
      body: JSON.stringify(body),
    });
  actor = null;
  assert.equal((await POST(request({ event: 'app_open' }))).status, 401);
  actor = 'synthetic-partner';
  assert.equal((await POST(request({ event: 'app_open' }, 'https://elsewhere.test'))).status, 403);
  for (const body of [{ event: 'first_paid' }, { event: 'first_save' }, { event: 'app_open', ownerId: 'forged-owner' }])
    assert.equal((await POST(request(body))).status, 400);
  assert.equal(events.size, 0);
  const response = await POST(
    request({ event: 'app_open', attribution: { source: 'reddit', campaign: 'private@example.test' } }),
  );
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json()).recorded, true);
  const open = [...events.values()][0];
  assert.equal(open.owner_id, 'synthetic-owner');
  assert.equal(open.actor_id, actor);
  assert.equal(accounts[0].as_owner, false);
  assert.equal(accounts[0].acquisition_campaign, null);
  await POST(request({ event: 'app_open' }));
  assert.equal(events.size, 1);
  unavailable = true;
  assert.equal((await (await POST(request({ event: 'upgrade_viewed' }))).json()).recorded, false);
  assert.doesNotThrow(() =>
    service.scheduleCollectorTracking(async () => {
      throw new Error('Synthetic failure');
    }),
  );
  await scheduled[0]();
  unavailable = false;
  const { recordCollectorPayments } = await import('../../lib/server/collector-payments');
  await recordCollectorPayments('synthetic-owner', 'cus_synthetic');
  assert.equal(
    [...events.values()].find((event) => event.name === 'first_paid')?.occurred_at,
    new Date((now - 100 * 86400) * 1000).toISOString(),
  );
  assert.equal(
    [...events.values()].some((event) => String(event.event_key).includes('in_expired')),
    false,
    'expired granular payments are not recreated',
  );
  assert.equal(
    [...events.values()].some((event) => event.event_key === 'invoice:in_recent'),
    true,
  );
  process.env.VERCEL_ENV = 'preview';
  assert.equal(service.collectorFunnelEnabled(), false);
  assert.equal(
    await service.recordCollectorEvent({
      actorId: actor,
      ownerId: 'synthetic-owner',
      name: 'first_paid',
      key: 'first_paid',
      at: new Date().toISOString(),
    }),
    false,
  );
  mock.restore();
}
void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
