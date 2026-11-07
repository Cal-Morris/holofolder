import Link from "next/link"

// Static (prerendered into the /_not-found shell): no request data, so it's instant and works from
// the CDN. Links lead back to the landing page and the binder.
export default function NotFound() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">That link doesn&apos;t point to anything in Holo Folder.</p>
        <div className="flex gap-3">
          <Link href="/" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Open binder
          </Link>
          <Link href="https://holofolder.com" className="rounded-md border border-border px-4 py-2 text-sm font-medium">
            Home
          </Link>
        </div>
      </div>
    </main>
  )
}
