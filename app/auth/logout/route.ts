import { appRedirectUrl } from "@/lib/auth-redirects"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  return NextResponse.redirect(appRedirectUrl("/auth/login", request.url))
}
