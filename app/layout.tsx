import type React from "react"
import type { Metadata, Viewport } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"
import "./globals.css"
import { IOS_VIEWPORT_GAP_SCRIPT } from "@/lib/ios-viewport-gap"
import { KEYBOARD_INSET_SCRIPT } from "@/lib/keyboard-inset"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" })
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" })
const THEME_COLOR_LIGHT = "#f7f6fb"
const THEME_COLOR_DARK = "#07070a"

export const metadata: Metadata = {
  metadataBase: new URL("https://holofolder.com"),
  openGraph: {
    title: "Holo Folder",
    siteName: "Holo Folder",
    description: "Your Pokémon card collection, wanted cards and prices, ready for your next show.",
    type: "website",
  },
  title: "Holo Folder",
  description: "Mobile-first Pokemon binder tracking with National Dex positions, collection status, and card matching.",
  applicationName: "Holo Folder",
  manifest: "/app/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Holo Folder",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/app/holo-cards-light-32.png", media: "(prefers-color-scheme: light)" },
      { url: "/app/holo-cards-dark-32.png", media: "(prefers-color-scheme: dark)" },
      { url: "/app/holo-cards-icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/app/holo-cards-favicon.ico",
    apple: "/app/apple-touch-icon-holo-cards.png",
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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark bg-background`} suppressHydrationWarning>
      <head>
        {/* Measures the iOS 26 installed-app dead band under the page before first paint (lib/ios-viewport-gap.ts). */}
        <script dangerouslySetInnerHTML={{ __html: IOS_VIEWPORT_GAP_SCRIPT }} />
        {/* Keeps bottom chrome above the on-screen keyboard (lib/keyboard-inset.ts). */}
        <script dangerouslySetInnerHTML={{ __html: KEYBOARD_INSET_SCRIPT }} />
      </head>
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
        <Analytics scriptSrc="/app/_vercel/insights/script.js" endpoint="/app/_vercel/insights" />
        {/* Real-user Core Web Vitals per route (enabled on the Vercel project). */}
        <SpeedInsights scriptSrc="/app/_vercel/speed-insights/script.js" endpoint="/app/_vercel/speed-insights/vitals" />
      </body>
    </html>
  )
}
