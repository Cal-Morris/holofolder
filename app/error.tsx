"use client"

import { useEffect } from "react"

// Route-level error boundary. Keeps the root layout (theme, fonts, analytics) and offers two ways
// back: retry() re-fetches the failed segment, and /app-shell opens the binder from local data, which
// the service worker serves even when the network is the reason we got here.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          Your collection is saved on this device. Try again, or open your binder offline.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
          {/* A full navigation, so the service worker can answer with the cached shell. */}
          <a href="/app-shell" className="rounded-md border border-border px-4 py-2 text-sm font-medium">
            Open binder
          </a>
        </div>
      </div>
    </main>
  )
}
