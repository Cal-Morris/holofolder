import { buildNamedBinderSharePath } from "@/lib/public-binder-identity"
import { normalizeCollectionItems } from "@/lib/collection/normalize"
import type { CollectedPokemon } from "@/lib/domain/cards"

/** Public bootstrap only contains card fields, never DB extras or partner identities. */
export function publicCollectionItems(rows: Partial<CollectedPokemon>[]) {
  return normalizeCollectionItems(rows).map(item => ({
    ...item,
    wanted_cards: (item.wanted_cards ?? []).map(({ wanted_by: _wantedBy, ...card }) => card),
  }))
}

export interface BinderShareRecord {
  owner_user_id: string
  binder_id?: string | null
  token: string
  is_enabled: boolean
}

export function buildBinderSharePath(token: string) {
  return `/app/share/${token}`
}

export function buildBinderShareUrl(origin: string, tokenOrPath: string) {
  const named = /^\/@([^/]+)\/([^/]+)$/.exec(tokenOrPath)
  if (named) {
    const path = buildNamedBinderSharePath(named[1], named[2])
    const hostname = new URL(origin).hostname
    return ["holofolder.com", "app.holofolder.com", "binder.cal.gg"].includes(hostname)
      ? new URL(path, "https://holofolder.com").toString()
      : new URL(`/app/u/${named[1]}/${named[2]}`, origin).toString()
  }
  const token = tokenOrPath.replace(/^\/(?:app\/)?share\//, "")
  if (!/^[a-zA-Z0-9_-]+$/.test(token)) throw new Error("Invalid share link")
  return new URL(buildBinderSharePath(token), origin).toString()
}
