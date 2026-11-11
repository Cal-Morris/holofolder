// Binder addresses: /<slug>, /<slug>/list, /<slug>/slabs and /<slug>/binder/<page> (all under /app).
// next.config rewrites them onto `/` with ?binderSlug=&view=&page=, so the app keeps one route.

/** Route names a slug may never take. Mirrors public.binder_slug_reserved in scripts/106_binder_slugs.sql. */
export const RESERVED_BINDER_SLUGS = [
  "api", "app-shell", "auth", "docs", "e2e-harness", "home", "mcp", "oauth", "share", "studio", "u",
  "settings", "admin", "new", "login", "logout", "account", "inventory", "dex", "offline", "help",
] as const

const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const VIEWS = ["binder", "list", "slabs"] as const
type BinderView = (typeof VIEWS)[number]

export const isBinderSlug = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 60 && SLUG.test(value) && !(RESERVED_BINDER_SLUGS as readonly string[]).includes(value)

/** App-relative (no /app) path for one binder view. Page 1 is implied. */
export function binderPath(slug: string, view: BinderView = "binder", page = 1) {
  if (view !== "binder") return `/${slug}/${view}`
  return page > 1 ? `/${slug}/binder/${page}` : `/${slug}`
}

/** Parses an app-relative or /app-prefixed pathname. Null for anything that is not a binder address. */
export function parseBinderPath(pathname: string): { slug: string; view?: BinderView; page?: number } | null {
  const [slug, view, page, ...rest] = pathname.replace(/^\/app(?=\/|$)/, "").split("/").filter(Boolean)
  if (!isBinderSlug(slug) || rest.length) return null
  if (view === undefined) return { slug }
  if (!(VIEWS as readonly string[]).includes(view)) return null
  if (page === undefined) return { slug, view: view as BinderView }
  if (view !== "binder" || !/^[1-9]\d{0,3}$/.test(page)) return null
  return { slug, view, page: Number(page) }
}

type SluggedBinder = { id: string; slug?: string | null }

/** The binder a URL asks for: ?binder=<id> first, else the slug in its path. Resolve it with matchBinder. */
export function requestedBinderKey(location: { pathname: string; search: string }) {
  return new URLSearchParams(location.search).get("binder") || parseBinderPath(location.pathname)?.slug || null
}

/** A binder by id or slug. */
export const matchBinder = <T extends SluggedBinder>(binders: readonly T[], key: string) =>
  binders.find(b => b.id === key) ?? binders.find(b => b.slug === key)

/** URL params with a binder path folded into the old ?binder=&view=&page= form, so one parser handles both. */
export function navigationParams(location: { pathname: string; search: string }, binders: readonly SluggedBinder[]) {
  const params = new URLSearchParams(location.search)
  const parsed = parseBinderPath(location.pathname)
  const id = parsed && binders.find(b => b.slug === parsed.slug)?.id
  if (!id || params.has("binder")) return params
  params.set("binder", id)
  if (parsed.view && !params.has("view")) params.set("view", parsed.view)
  if (parsed.page && !params.has("page")) params.set("page", String(parsed.page))
  return params
}

/**
 * Writes one collection view into `url` (a full /app URL): the slug path when the binder has a slug,
 * else the old query form. Other views (inventory, dex) go back to /app?view=.
 */
export function writeNavigationUrl(url: URL, binders: readonly SluggedBinder[], target:
  { main: "collection"; binderId: string; view: BinderView; page: number } | { main: "inventory" | "dex" }) {
  for (const param of ["binder", "view", "page", "slot", "item"]) url.searchParams.delete(param)
  const slug = target.main === "collection" ? binders.find(b => b.id === target.binderId)?.slug : null
  if (target.main === "collection" && slug) {
    url.pathname = `/app${binderPath(slug, target.view, target.page)}`
    return url
  }
  if (parseBinderPath(url.pathname)) url.pathname = "/app"
  if (target.main !== "collection") url.searchParams.set("view", target.main)
  else {
    url.searchParams.set("binder", target.binderId); url.searchParams.set("view", target.view)
    if (target.view === "binder") url.searchParams.set("page", String(target.page))
  }
  return url
}
