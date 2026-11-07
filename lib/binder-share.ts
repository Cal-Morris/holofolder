export interface BinderShareRecord {
  owner_user_id: string
  token: string
  is_enabled: boolean
}

export function buildBinderSharePath(token: string) {
  return `/app/share/${token}`
}

export function buildBinderShareUrl(origin: string, token: string) {
  return new URL(buildBinderSharePath(token), origin).toString()
}
