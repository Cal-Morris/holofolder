import { test, expect } from './fixtures';

test('marketing session check is private and signed-out safe', async ({ request }) => {
  const response = await request.get('/app/api/auth/session');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ signedIn: false });
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['vary']).toContain('Cookie');
});
