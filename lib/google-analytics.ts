import { sendGAEvent } from "@next/third-parties/google"

export interface GoogleEvents {
  screen_view: { screen_name: "binder" | "list" | "wanted" | "sets" | "pokemon" | "analytics"; show_mode: boolean; read_only: boolean }
  search_opened: { surface: "search" | "quick_mode" | "price_lookup" }
  price_check_viewed: Record<string, never>
}

export function sendGoogleEvent<K extends keyof GoogleEvents>(enabled: boolean, name: K, parameters: GoogleEvents[K]) {
  if (!enabled || typeof window === "undefined" || !navigator.onLine) return
  // Effects can run before Next's inline initialization script.
  const browser = window as Window & { dataLayer?: unknown[] }
  browser.dataLayer ??= []
  sendGAEvent("event", name, parameters)
}
