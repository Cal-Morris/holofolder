import type React from "react"
import type { Metadata, Viewport } from "next"
import { cookies } from "next/headers"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { createClient } from "@/lib/supabase/server"
import "./globals.css"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })
const THEME_COLOR_LIGHT = "#fafafd"
const THEME_COLOR_DARK = "#171a22"

export const metadata: Metadata = {
  title: "BinderDex",
  description: "Mobile-first Pokemon binder tracking with National Dex positions, collection status, and card matching.",
  generator: "v0.app",
  applicationName: "BinderDex",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BinderDex",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon-light-32x32.png", media: "(prefers-color-scheme: light)" },
      { url: "/icon-dark-32x32.png", media: "(prefers-color-scheme: dark)" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const cookieStore = await cookies()
  const theme = cookieStore.get("binderdex_theme")?.value
  let isDark = theme ? theme !== "light" : true

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const partnershipResult = await supabase
      .from("partnerships")
      .select("owner_user_id")
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
      .limit(1)
      .maybeSingle()

    const settingsOwnerUserId = partnershipResult.data?.owner_user_id ?? user.id
    const { data: settingsRow } = await supabase
      .from("user_settings")
      .select("dark_mode")
      .eq("user_id", settingsOwnerUserId)
      .maybeSingle()

    if (typeof settingsRow?.dark_mode === "boolean") {
      isDark = settingsRow.dark_mode
    }
  } else if (!theme) {
    isDark = true
  }

  return (
    <html lang="en" className={`${isDark ? "dark" : ""} bg-background`} suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
