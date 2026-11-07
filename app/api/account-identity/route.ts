import { isMissingIdentitySchema, normalizeUsername } from "@/lib/public-binder-identity"
import { IdentityError, identityFailure, identityJson, identitySession, readAccountUsername, requireIdentityOrigin } from "@/lib/server/public-binder-identity"

export async function GET() {
  try {
    const { client, user } = await identitySession()
    try {
      return identityJson({ username: await readAccountUsername(client, user.id), available: true })
    } catch (error) {
      if (isMissingIdentitySchema(error as { code?: string })) return identityJson({ username: null, available: false })
      throw error
    }
  } catch (error) { return identityFailure(error, "Username") }
}

export async function PATCH(request: Request) {
  try {
    requireIdentityOrigin(request)
    const { client } = await identitySession(true)
    const body = await request.json().catch(() => null)
    const username = normalizeUsername(body?.username)
    if (!username) throw new IdentityError("Use 3–30 letters, numbers or hyphens, starting and ending with a letter or number.", 400)
    const { data, error } = await client.rpc("set_account_username", { requested_username: username })
    if (error) throw error
    return identityJson({ username: data, available: true })
  } catch (error) { return identityFailure(error, "Username") }
}
