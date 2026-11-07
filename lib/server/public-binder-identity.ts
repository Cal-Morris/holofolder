import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUser } from "@/lib/supabase/session-user"
import { appRedirectUrl } from "@/lib/auth-redirects"
import { buildNamedBinderSharePath, isMissingIdentitySchema } from "@/lib/public-binder-identity"

export class IdentityError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export const identityJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } })

export async function identitySession(write = false) {
  const client = await createClient()
  const user = write ? (await client.auth.getUser()).data.user : await getSessionUser(client)
  if (!user) throw new IdentityError("Sign in to manage your public address.", 401)
  return { client, user }
}

export function requireIdentityOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin && origin !== appRedirectUrl(null, request.url).origin)) {
    throw new IdentityError("Request origin is not allowed.", 403)
  }
}

export function identityFailure(error: unknown, field: "Username" | "Binder slug") {
  if (error instanceof IdentityError) return identityJson({ error: error.message }, error.status)
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : ""
  if (isMissingIdentitySchema({ code })) return identityJson({ error: "Named links are not available yet. Your existing share link still works." }, 503)
  if (code === "23505") return identityJson({ error: `${field} is taken or reserved. Choose another.` }, 409)
  if (code === "42501") return identityJson({ error: "Only the binder owner can change its address." }, 403)
  if (code === "22023" || code === "23514") return identityJson({ error: `Invalid ${field.toLowerCase()}.` }, 400)
  console.error("[holofolder] Public identity request failed", error)
  return identityJson({ error: "Could not save or load your public address. Try again." }, 500)
}

export async function readAccountUsername(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from("account_identities").select("username").eq("user_id", userId).maybeSingle()
  if (error) throw error
  return typeof data?.username === "string" ? data.username : null
}

export async function readBinderIdentity(ownerUserId: string, binderId: string | null) {
  const admin = createAdminClient()
  const [username, binder] = await Promise.all([
    readAccountUsername(admin, ownerUserId),
    binderId ? admin.from("binder_public_slugs").select("slug").eq("owner_user_id", ownerUserId).eq("binder_id", binderId).eq("is_active", true).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  if (binder.error) throw binder.error
  return { username, slug: typeof binder.data?.slug === "string" ? binder.data.slug : null }
}

export async function namedSharePath(ownerUserId: string, binderId: string | null) {
  if (!binderId) return null
  try {
    const { username, slug } = await readBinderIdentity(ownerUserId, binderId)
    return username && slug ? buildNamedBinderSharePath(username, slug) : null
  } catch (error) {
    if (isMissingIdentitySchema(error as { code?: string })) return null
    throw error
  }
}
