"use server"

import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

// Store challenge with 5 minute expiry
export async function storeChallenge(key: string, challenge: string) {
  await redis.set(`webauthn:challenge:${key}`, challenge, { ex: 300 })
}

// Get and delete challenge (one-time use)
export async function getChallenge(key: string): Promise<string | null> {
  const challenge = await redis.get<string>(`webauthn:challenge:${key}`)
  if (challenge) {
    await redis.del(`webauthn:challenge:${key}`)
  }
  return challenge
}

// Convert standard base64 to base64url
function toBase64URL(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Convert base64url to standard base64
function fromBase64URL(base64url: string): string {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  return base64
}

// Generate a random challenge
export async function generateChallenge(): Promise<string> {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return toBase64URL(Buffer.from(array).toString("base64"))
}

// Base64URL encode/decode helpers
export async function base64URLEncode(buffer: ArrayBuffer): Promise<string> {
  return toBase64URL(Buffer.from(buffer).toString("base64"))
}

export async function base64URLDecode(str: string): Promise<Uint8Array> {
  return new Uint8Array(Buffer.from(fromBase64URL(str), "base64"))
}
