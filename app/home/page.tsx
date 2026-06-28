import { redirect } from "next/navigation"
import HomePage from "@/components/home-page"
import { createClient } from "@/lib/supabase/server"

export const instant = false

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect("/")
  }

  return <HomePage />
}
