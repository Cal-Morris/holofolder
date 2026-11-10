// Static placeholder for the binder while it starts: header, a page of card pockets (a two-page spread
// from 1280 px, like the binder) and the dock. Server-safe (no hooks) so it can be in the prerendered
// shell of `/` and `/app-shell`. Rows and columns follow the binder's layout when it is known.
export function BinderSkeleton({ rows = 3, cols = 3 }: { rows?: number; cols?: number }) {
  const page = (hiddenBelowSpread: boolean) => (
    <div
      className={`${hiddenBelowSpread ? "hidden xl:grid" : "grid"} w-full max-w-md content-start gap-2 rounded-2xl border border-border/50 bg-card/60 p-2 xl:max-w-xl`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: rows * cols }, (_, index) => (
        <div key={index} className="holo-loading aspect-[63/88] rounded-lg" />
      ))}
    </div>
  )
  return (
    <main
      className="flex min-h-dvh flex-col bg-background px-3 pt-[var(--top-inset)] pb-[calc(var(--dock-clearance)+0.75rem)]"
      aria-busy="true"
      data-testid="binder-skeleton"
    >
      <span className="sr-only">Opening your binder…</span>
      <div className="mb-4 flex min-h-11 items-center justify-between" aria-hidden="true">
        <div className="h-6 w-32 rounded-md bg-muted" />
        <div className="h-9 w-9 rounded-full bg-muted" />
      </div>
      <div className="flex flex-1 items-start justify-center gap-3" aria-hidden="true">
        {page(false)}
        {page(true)}
      </div>
      <div
        className="fixed inset-x-2 bottom-[var(--dock-inset)] mx-auto h-[var(--dock-bar)] max-w-md rounded-2xl bg-muted/80 sm:hidden"
        aria-hidden="true"
      />
    </main>
  )
}
