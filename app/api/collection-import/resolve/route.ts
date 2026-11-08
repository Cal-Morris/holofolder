import { readImportLookups, resolveImportLookup } from "@/lib/collection-import-resolve"
import { findMirroredImportCandidates } from "@/lib/tcg-mirror"
import { identityJson, IdentityError, requireIdentityOrigin } from "@/lib/server/public-binder-identity"

export async function POST(request: Request) {
  try {
    requireIdentityOrigin(request)
    if (Number(request.headers.get("content-length")) > 65_536) return identityJson({ error: "Lookup request is too large." }, 413)
    const text = await request.text()
    if (text.length > 65_536) return identityJson({ error: "Lookup request is too large." }, 413)
    let lookups
    try { lookups = readImportLookups(JSON.parse(text)) } catch (error) { return identityJson({ error: error instanceof Error ? error.message : "Invalid lookup." }, 400) }
    const results = []
    for (let i = 0; i < lookups.length; i += 3) {
      const batch = await Promise.all(lookups.slice(i, i + 3).map(async lookup => resolveImportLookup(lookup, await findMirroredImportCandidates(lookup))))
      results.push(...batch)
    }
    return identityJson({ results })
  } catch (error) {
    if (error instanceof IdentityError) return identityJson({ error: error.message }, error.status)
    return identityJson({ error: "The catalogue is unavailable. Nothing was imported. Try again online." }, 503)
  }
}
