import { createPublicKey, verify } from "node:crypto"

interface EbayPublicKey { key: string; digest: string }
const publicKeys = new Map<string, { value: Promise<EbayPublicKey>; expiresAt: number; loaded?: boolean }>()
let appToken: { value: Promise<string>; expiresAt: number } | undefined

async function loadAppToken() {
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error("eBay authentication unavailable")
  const token: { access_token?: unknown; expires_in?: unknown } = await response.json()
  if (typeof token?.access_token !== "string" || !token.access_token
    || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 60) {
    throw new Error("Invalid eBay access token")
  }
  if (appToken) appToken.expiresAt = Date.now() + (token.expires_in - 60) * 1000
  return token.access_token
}

async function loadPublicKey(keyId: string): Promise<EbayPublicKey> {
  // Share pending refreshes; briefly cache failures so unsigned requests cannot mint tokens repeatedly.
  if (!appToken || appToken.expiresAt <= Date.now()) appToken = { value: loadAppToken(), expiresAt: Date.now() + 30_000 }
  const token = await appToken.value
  const response = await fetch(`https://api.ebay.com/commerce/notification/v1/public_key/${encodeURIComponent(keyId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error("eBay public key unavailable")
  const key: { key?: unknown; algorithm?: unknown; digest?: unknown } = await response.json()
  if (key?.algorithm !== "ECDSA" || typeof key.key !== "string" || (key.digest !== "SHA256" && key.digest !== "SHA1")) {
    throw new Error("Invalid eBay public key")
  }
  const pem = key.key.replace(/-----BEGIN PUBLIC KEY-----\s*/, "-----BEGIN PUBLIC KEY-----\n").replace(/\s*-----END PUBLIC KEY-----/, "\n-----END PUBLIC KEY-----")
  if (createPublicKey(pem).asymmetricKeyType !== "ec") throw new Error("Invalid eBay key type")
  return { key: pem, digest: key.digest }
}

export async function verifyEbayNotification(payload: unknown, signatureHeader: string): Promise<boolean> {
  let signature: { alg?: unknown; kid?: unknown; signature?: unknown; digest?: unknown }
  try {
    if (!signatureHeader || signatureHeader.length > 4096) return false
    signature = JSON.parse(Buffer.from(signatureHeader, "base64").toString("utf8"))
    if (signature?.alg !== "ecdsa" || typeof signature.kid !== "string" || !signature.kid || signature.kid.length > 256
      || typeof signature.signature !== "string" || !signature.signature || typeof signature.digest !== "string") return false
  } catch {
    return false
  }

  const keyId = signature.kid as string
  const now = Date.now()
  for (const [id, cached] of publicKeys) if (cached.expiresAt <= now) publicKeys.delete(id)
  let cached = publicKeys.get(keyId)
  if (!cached) {
    if (publicKeys.size >= 16) {
      const oldest = [...publicKeys].find(([, entry]) => !entry.loaded)?.[0] ?? publicKeys.keys().next().value
      if (oldest) publicKeys.delete(oldest)
    }
    cached = { value: loadPublicKey(keyId), expiresAt: now + 60_000 }
    publicKeys.set(keyId, cached)
    const entry = cached
    void entry.value.then(() => { entry.loaded = true; entry.expiresAt = Date.now() + 60 * 60 * 1000 }, () => {})
  }
  const publicKey = await cached.value

  if ((signature.digest as string).toUpperCase() !== publicKey.digest) return false
  try {
    // eBay's notification SDK verifies the parsed, re-serialized JSON payload.
    return verify(publicKey.digest.toLowerCase(), Buffer.from(JSON.stringify(payload)), publicKey.key, Buffer.from(signature.signature as string, "base64"))
  } catch {
    return false
  }
}
