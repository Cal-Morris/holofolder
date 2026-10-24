import type React from "react"
import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"
import "./globals.css"
import { IOS_VIEWPORT_GAP_SCRIPT } from "@/lib/ios-viewport-gap"

// next/font must be assigned at module scope. The classNames are not applied: the
// generated @font-face rules ("Geist", "Geist Mono") are used via --font-sans/--font-mono in globals.css.
const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })
const THEME_COLOR_LIGHT = "#fafafd"
const THEME_COLOR_DARK = "#171a22"

export const metadata: Metadata = {
  title: "BinderDex",
  description: "Mobile-first Pokemon binder tracking with National Dex positions, collection status, and card matching.",
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
  maximumScale: 1,
  userScalable: false,
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
  return (
    <html lang="en" className="dark bg-background" suppressHydrationWarning>
      <head>
        {/* Measures the iOS 26 installed-app dead band under the page before first paint (lib/ios-viewport-gap.ts). */}
        <script dangerouslySetInnerHTML={{ __html: IOS_VIEWPORT_GAP_SCRIPT }} />
      </head>
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
        <Analytics />
        {/* Real-user Core Web Vitals per route (enabled on the Vercel project). */}
        <SpeedInsights />
      </body>
    </html>
  )
}
