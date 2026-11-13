import { GoogleAnalyticsProvider } from '@/components/google-analytics';
import { CollectorFunnelProvider } from '@/components/collector-funnel';
import { Toaster } from '@/components/ui/toast';
import type React from 'react';
import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import { IOS_VIEWPORT_GAP_SCRIPT } from '@/lib/ios-viewport-gap';
import { KEYBOARD_INSET_SCRIPT } from '@/lib/keyboard-inset';
import { socialMetadata } from '@/lib/social-metadata';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// Only the API key field and chart tooltips use mono, so don't preload it on every page.
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: false,
});
const THEME_COLOR_DARK = '#07070a';

export const metadata: Metadata = {
  ...socialMetadata,
  metadataBase: new URL('https://holofolder.com'),
  // Framer serves the searchable marketing site; app and account pages stay out of search.
  robots: { index: false, follow: true },
  title: 'Holo Folder',
  applicationName: 'Holo Folder',
  manifest: '/app/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Holo Folder',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/app/holofolder-icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/app/holofolder-favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/app/holofolder-favicon.ico',
    apple: '/app/holofolder-apple-touch-icon.png',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: THEME_COLOR_DARK,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} dark bg-background`}
      suppressHydrationWarning
    >
      <head>
        {/* Measures the iOS 26 installed-app dead band under the page before first paint (lib/ios-viewport-gap.ts). */}
        {/* oxlint-disable-next-line react-doctor/nextjs-no-native-script -- must run inline before first paint; next/script defers it. */}
        <script dangerouslySetInnerHTML={{ __html: IOS_VIEWPORT_GAP_SCRIPT }} />
        {/* Keeps bottom chrome above the on-screen keyboard (lib/keyboard-inset.ts). */}
        {/* oxlint-disable-next-line react-doctor/nextjs-no-native-script -- must run inline before first paint; next/script defers it. */}
        <script dangerouslySetInnerHTML={{ __html: KEYBOARD_INSET_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground font-sans antialiased">
        <GoogleAnalyticsProvider
          enabled={process.env.VERCEL_ENV === 'production'}
          gaId={process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID}
        >
          <CollectorFunnelProvider
            enabled={process.env.VERCEL_ENV === 'production' && process.env.HOLOFOLDER_FUNNEL_ENABLED === 'true'}
          >
            {children}
          </CollectorFunnelProvider>
        </GoogleAnalyticsProvider>
        <Toaster />
        <Analytics scriptSrc="/app/_vercel/insights/script.js" endpoint="/app/_vercel/insights" />
        {/* Real-user Core Web Vitals per route (enabled on the Vercel project). */}
        <SpeedInsights
          scriptSrc="/app/_vercel/speed-insights/script.js"
          endpoint="/app/_vercel/speed-insights/vitals"
        />
      </body>
    </html>
  );
}
