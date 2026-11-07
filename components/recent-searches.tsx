"use client"

import type { BinderHistory } from "@/hooks/use-binder-history"

export default function RecentSearches({ history, onSearch }: { history: BinderHistory; onSearch: (query: string) => void }) {
  if (!history.searches.length) return null
  return (
    <section aria-label="Recent searches" className="holo-panel mb-3 min-w-0 rounded-3xl border border-border/60 p-3">
      <div className="flex items-center justify-between gap-2 pt-1">
        <h3 className="text-xs font-semibold text-muted-foreground">Recent searches</h3>
        <button type="button" onClick={() => history.clear("search")} aria-label={history.shared ? "Clear recent searches for this binder" : "Clear recent searches"} className="min-h-9 rounded-full px-3 text-xs font-semibold text-muted-foreground">
          {history.shared ? "Clear for everyone" : "Clear"}
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {history.searches.map(query => <button key={query} type="button" onClick={() => { history.rememberSearch(query); onSearch(query) }} className="min-h-9 holo-tile shrink-0 rounded-full border border-border/70 px-3 text-sm">{query}</button>)}
      </div>
    </section>
  )
}
