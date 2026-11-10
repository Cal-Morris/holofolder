import type { CSSProperties } from "react"
import { Grid3X3, Heart, Layers3, ListChecks, MoreHorizontal, Search } from "lucide-react"

// The binder while it starts: the app's real frame (header, binder toolbar row, dock) with the page of
// pockets still empty, so opening fills the page in place and nothing moves. The frame's classes mirror
// components/binder/app-header.tsx, the toolbar row in binder-app.tsx and bottom-nav.tsx; the page is fitted
// with the same sums as binderFitSize, in CSS (`.binder-skeleton-*` in globals.css). Server-safe (no hooks)
// so it can be in the prerendered shell of `/` and `/app-shell`. Nothing here is interactive or announced.
const destinations = [["Binder", Grid3X3], ["Inventory", ListChecks], ["Wanted", Heart], ["Browse", Layers3]] as const

export function BinderSkeleton({ rows = 3, cols = 3 }: { rows?: number; cols?: number }) {
  const page = (second: boolean) => (
    <div className={`${second ? "hidden xl:grid" : "grid"} h-full w-full gap-1.5 rounded-2xl border border-border/60 bg-card p-2 sm:p-4`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
      {Array.from({ length: rows * cols }, (_, index) => <div key={index} data-skeleton="pocket" className="rounded-md bg-muted/70" />)}
    </div>
  )
  return (
    <main className="flex h-dvh max-h-dvh w-full flex-col overflow-hidden bg-background" aria-busy="true" data-testid="binder-skeleton">
      <span className="sr-only">Opening your binder…</span>
      <div aria-hidden="true" className="mb-1 shrink-0 border-b border-border/40 pt-[var(--top-inset)]">
        <div className="pl-[var(--left-inset)] pr-[var(--right-inset)] sm:px-4">
          <div className="flex flex-wrap items-center gap-0 py-1 md:gap-2 md:px-3">
            <div className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-1.5 xl:flex-none">
              {/* eslint-disable-next-line @next/next/no-img-element -- the static shell paints before any script */}
              <img src="/app/holofolder-mark.png" alt="" width={20} height={20} className="h-5 w-5 shrink-0" />
              <span className="truncate text-sm font-semibold">Holo Folder</span>
            </div>
            <div className="order-last hidden w-full items-center gap-1 border-t border-border/40 pt-1 md:flex xl:order-none xl:w-auto xl:flex-1 xl:border-0 xl:pt-0">
              {[...destinations, ["Search", Search] as const].map(([label, Icon], index) => (
                <span key={label} className={`flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-medium ${index === 0 ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </span>
              ))}
            </div>
            <div className="flex h-11 shrink-0 items-center px-3"><span className="h-4 w-20 rounded bg-muted" /></div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"><MoreHorizontal className="h-4 w-4" /></div>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="flex shrink-0 items-center gap-1 px-3 pb-1 sm:px-4 md:px-7">
        <span className="h-9 w-32 rounded-full border border-border/60 bg-muted/40" />
        <span className="h-9 w-20 rounded-full border border-border/60 bg-muted/40" />
      </div>
      <div aria-hidden="true" className="min-h-0 flex-1 px-2 pb-[calc(var(--dock-clearance)+1rem)] sm:px-4 md:pb-[2.85rem]">
        <div data-skeleton="stage" className="binder-skeleton-stage flex h-full w-full items-center justify-center">
          <div data-skeleton="spread" className="binder-skeleton-spread motion-safe:animate-pulse" style={{ "--r": rows, "--c": cols } as CSSProperties}>
            {page(false)}
            {page(true)}
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="fixed inset-x-0 bottom-0 border-t border-border/40 bg-background pb-[var(--dock-inset)] pl-[var(--left-inset)] pr-[var(--right-inset)] md:hidden">
        <div className="mx-auto grid h-[calc(var(--dock-bar)-1px)] w-full max-w-xl grid-cols-5 items-center">
          {[["Search", Search] as const, ...destinations].map(([label, Icon]) => (
            <span key={label} className={`flex h-11 flex-col items-center justify-center gap-0.5 ${label === "Binder" ? "text-primary" : "text-muted-foreground"}`}>
              <Icon className="h-4 w-4" /><span className="text-[10px] font-medium">{label}</span>
            </span>
          ))}
        </div>
      </div>
    </main>
  )
}
