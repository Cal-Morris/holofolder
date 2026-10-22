"use client"

// Replaces the root layout when it fails, so it brings its own document and inline styles
// (globals.css isn't loaded here). Kept dependency-free and dark to match the app's default theme.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#171a22",
          color: "#f4f5f8",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <title>BinderDex</title>
        <div>
          <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, opacity: 0.7, margin: "0 0 16px" }}>
            Your collection is saved on this device.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ padding: "8px 16px", borderRadius: 6, border: 0, fontSize: 14, marginRight: 8 }}
          >
            Try again
          </button>
          <a href="/app-shell" style={{ color: "inherit", fontSize: 14 }}>
            Open binder
          </a>
        </div>
      </body>
    </html>
  )
}
