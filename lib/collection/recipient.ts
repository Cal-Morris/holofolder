/** An edit's origin is captured synchronously, before delivery, and never inferred on replay. */
export type CollectionOrigin =
  | { kind: "account"; actorUserId: string; ownerUserId: string; binderId: string }
  | { kind: "guest"; workspaceId: string; localBinderId: string }

export function parseCollectionOrigin(value: unknown): CollectionOrigin | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const has = (key: string) => typeof v[key] === "string" && (v[key] as string).length > 0
  if (v.kind === "account" && has("actorUserId") && has("ownerUserId") && has("binderId"))
    return { kind: "account", actorUserId: v.actorUserId as string, ownerUserId: v.ownerUserId as string, binderId: v.binderId as string }
  if (v.kind === "guest" && has("workspaceId") && has("localBinderId"))
    return { kind: "guest", workspaceId: v.workspaceId as string, localBinderId: v.localBinderId as string }
  return null
}
export function sameCollectionOrigin(a: CollectionOrigin | null | undefined, b: CollectionOrigin | null | undefined) {
  const left = parseCollectionOrigin(a), right = parseCollectionOrigin(b)
  return !!left && !!right && JSON.stringify(left) === JSON.stringify(right)
}
export function guestCollectionOrigin(storage: Storage, binderId: string | null): CollectionOrigin | null {
  try {
  const key = "pokemon_collection_guest_workspace_v1"
  let workspaceId = storage.getItem(key)
  if (!workspaceId) { workspaceId = crypto.randomUUID(); storage.setItem(key, workspaceId) }
  return { kind: "guest", workspaceId, localBinderId: binderId ?? "guest-default" }
  } catch { return null }
}
export const RECIPIENT_RETENTION_CODES = new Set(["collection_queue_upgrade_required", "collection_recipient_required", "collection_recipient_changed", "collection_recipient_inaccessible", "collection_precondition_required"])
