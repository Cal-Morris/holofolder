import type { JwtPayload, SupabaseClient, User } from "@supabase/supabase-js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

/**
 * A `User` built from verified access-token claims. Only the token's fields are real
 * (`id`, `email`, `phone`, `role`, `aud`, `app_metadata`, `user_metadata`, `is_anonymous`);
 * the client replaces it with the full user once its own Supabase session loads.
 */
export function userFromClaims(claims: JwtPayload): User {
  return {
    id: claims.sub,
    aud: typeof claims.aud === "string" ? claims.aud : (claims.aud?.[0] ?? "authenticated"),
    role: claims.role,
    email: claims.email,
    phone: claims.phone,
    is_anonymous: claims.is_anonymous,
    app_metadata: claims.app_metadata ?? {},
    user_metadata: claims.user_metadata ?? {},
    created_at: "",
  }
}

/**
 * The signed-in user for server rendering, without a Supabase Auth round trip.
 *
 * `getClaims()` verifies the access token's signature locally against the project's cached JWKS
 * (asymmetric ES256 keys) and refreshes an expired session first. Use it on render paths that only
 * need the user's id. Writes and anything that must see a just-revoked session should still call
 * `getUser()`. Row Level Security applies to every query either way.
 */
export async function getSessionUser(client: AnySupabaseClient): Promise<User | null> {
  const { data, error } = await client.auth.getClaims()
  if (error || !data?.claims?.sub || data.claims.client_id) return null
  return userFromClaims(data.claims)
}

/** Website writes must not accept an OAuth token placed in the session cookie. */
export async function getFirstPartyUser(client: AnySupabaseClient) {
  const { data, error } = await client.auth.getClaims()
  if (error || !data?.claims?.sub || data.claims.client_id) return { data: { user: null }, error: null }
  return client.auth.getUser()
}
