import { readAuditHeader } from "@/lib/supabase/audit-header"
import { createClient } from "@supabase/supabase-js"

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  }

  return createClient(url, serviceRoleKey, {
    global: { fetch: (input, init) => {
      const headers = new Headers(init?.headers)
      headers.delete("x-holo-audit-context")
      const context = readAuditHeader()
      if (context) headers.set("x-holo-audit-context", context)
      return fetch(input, { ...init, headers })
    } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
