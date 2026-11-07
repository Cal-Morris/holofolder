function normalizeName(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null
  const name = value.trim().toLowerCase()
  return name.length >= min && name.length <= max && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name) ? name : null
}

export const normalizeUsername = (value: unknown) => normalizeName(value, 3, 30)
export const normalizeBinderSlug = (value: unknown) => normalizeName(value, 1, 60)

export function suggestBinderSlug(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "")
}

export function buildNamedBinderSharePath(username: string, slug: string): string {
  if (normalizeUsername(username) !== username || normalizeBinderSlug(slug) !== slug) throw new Error("Invalid public binder address")
  return `/@${username}/${slug}`
}

export function isMissingIdentitySchema(error: { code?: string } | null | undefined): boolean {
  return Boolean(error && ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? ""))
}
