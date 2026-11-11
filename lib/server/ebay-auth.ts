let appToken: { value: Promise<string>; expiresAt: number } | undefined;

async function loadAppToken() {
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`eBay authentication unavailable (${response.status})`);
  const token: { access_token?: unknown; expires_in?: unknown } = await response.json();
  if (
    typeof token?.access_token !== 'string' ||
    !token.access_token ||
    typeof token.expires_in !== 'number' ||
    !Number.isFinite(token.expires_in) ||
    token.expires_in <= 60
  ) {
    throw new Error('Invalid eBay access token');
  }
  if (appToken) appToken.expiresAt = Date.now() + (token.expires_in - 60) * 1000;
  return token.access_token;
}

export async function getEbayAppToken() {
  if (!appToken || appToken.expiresAt <= Date.now())
    appToken = { value: loadAppToken(), expiresAt: Date.now() + 30_000 };
  return appToken.value;
}
