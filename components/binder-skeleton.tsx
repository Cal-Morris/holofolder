// Static placeholder for the binder while it starts: header, a page of card pockets and the dock.
// Server-safe (no hooks) so it can be in the prerendered shell of `/` and `/app-shell`.
export function BinderSkeleton() {
  return (
    <main
      className="flex min-h-dvh flex-col bg-background px-3 pt-[var(--top-inset)] pb-[calc(var(--dock-clearance)+0.75rem)]"
      aria-busy="true"
      data-testid="binder-skeleton"
    >
      <span className="sr-only">Opening your binder…</span>
      <div className="mb-4 flex items-center justify-between" aria-hidden="true">
        <div className="h-6 w-32 rounded-md bg-muted" />
        <div className="h-9 w-9 rounded-full bg-muted" />
      </div>
      <div className="mx-auto grid w-full max-w-md flex-1 grid-cols-3 content-start gap-2 rounded-2xl border border-border/50 bg-card/60 p-2" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <div key={index} className="holo-loading aspect-[63/88] rounded-lg" />
        ))}
      </div>
      <div
        className="fixed inset-x-2 bottom-[var(--dock-inset)] mx-auto h-[var(--dock-bar)] max-w-md rounded-2xl bg-muted/80 sm:hidden"
        aria-hidden="true"
      />
    </main>
  )
}
