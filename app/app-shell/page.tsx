import type { Metadata } from "next"
import OfflineAppShell from "@/components/offline-app-shell"

// Static, user-independent HTML. The service worker precaches it (with its JS/CSS) and serves it
// as the fallback for navigations that can't reach the network. See public/sw.js.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AppShellPage() {
  return <OfflineAppShell />
}
