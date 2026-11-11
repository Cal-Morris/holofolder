import assert from 'node:assert/strict';

async function run() {
  const person = '00000000-0000-4000-8000-000000000001';
  const device = '00000000-0000-4000-8000-000000000002';
  let signedIn = true,
    exists = true,
    rejected = false,
    sent = 0;
  const filters: Record<string, string> = {};
  // Synthetic subscription only; no request reaches a push service.
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    p256dh: 'synthetic-public-key',
    auth: 'synthetic-auth',
  };
  // @ts-expect-error Bun types are deliberately absent from the application.
  const { mock } = await import('bun:test');
  mock.module('../../lib/supabase/server', () => ({
    createClient: async () => ({
      auth: {
        getClaims: async () => ({ data: signedIn ? { claims: { sub: person } } : null, error: null }),
        getUser: async () => ({ data: { user: signedIn ? { id: person } : null } }),
      },
    }),
  }));
  mock.module('../../lib/supabase/admin', () => ({
    createAdminClient: () => ({
      from: (table: string) => {
        assert.equal(table, 'push_subscriptions');
        const query = {
          select: () => query,
          eq: (key: string, value: string) => {
            filters[key] = value;
            return query;
          },
          maybeSingle: async () => ({ data: exists ? subscription : null, error: null }),
        };
        return query;
      },
    }),
  }));
  mock.module('web-push', () => ({
    sendNotification: async (
      target: unknown,
      raw: string,
      options: { vapidDetails: { subject: string }; TTL: number },
    ) => {
      sent++;
      assert.deepEqual(target, {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      });
      assert.deepEqual(JSON.parse(raw), { kind: 'test', recipientId: person, tag: 'holofolder-test' });
      assert.equal(options.vapidDetails.subject, 'https://holofolder.com');
      assert.equal(options.TTL, 60);
      if (rejected) throw { statusCode: 403 };
    },
  }));
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'synthetic-key';
  process.env.VAPID_PRIVATE_KEY = 'synthetic-private';
  process.env.VAPID_SUBJECT = 'https://holofolder.com';
  const { POST } = await import('../../app/api/push/test/route');
  const request = (body: unknown = { id: device }) =>
    new Request('https://holofolder.com/app/api/push/test', { method: 'POST', body: JSON.stringify(body) });
  signedIn = false;
  assert.equal((await POST(request())).status, 401);
  assert.equal(sent, 0);
  signedIn = true;
  assert.equal((await POST(request({ id: 'invalid' }))).status, 400);
  exists = false;
  assert.equal((await POST(request())).status, 404);
  assert.deepEqual(filters, { id: device, user_id: person });
  assert.equal(sent, 0);
  exists = true;
  const accepted = await POST(request({ id: device, endpoint: 'https://evil.test', recipientId: 'other-person' }));
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await accepted.json(), { sent: true });
  assert.equal(sent, 1);
  rejected = true;
  const failure = await POST(request());
  assert.equal(failure.status, 502);
  assert.match((await failure.json()).error, /could not be sent/i);
  delete process.env.VAPID_SUBJECT;
  assert.equal((await POST(request())).status, 503);
  assert.equal(sent, 2);
}
void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
