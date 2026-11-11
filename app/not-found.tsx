import Link from 'next/link';

// Static (prerendered into the /_not-found shell): no request data, so it's instant and works from
// the CDN. Links lead back to the landing page and the binder.
export default function NotFound() {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-muted-foreground text-sm">That link doesn&apos;t point to anything in Holo Folder.</p>
        <div className="flex gap-3">
          <Link href="/" className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium">
            Open binder
          </Link>
          <Link href="https://holofolder.com" className="border-border rounded-md border px-4 py-2 text-sm font-medium">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
