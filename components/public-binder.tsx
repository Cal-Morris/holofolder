'use client'

import { useState } from 'react'
import { OrderedSlot } from '@/components/binder/ordered-slot'
import { displaySlotLabel } from '@/lib/binder-display-model'
import { getBinderColorPreset } from '@/lib/binder-colors'
import type { PublicBinder } from '@/lib/public-binder'
import { CardDataAttribution } from '@/components/card-data-attribution'

/** Shared browse-only pockets; no session, private navigation, queues or device preferences. */
export default function PublicBinderView({ binder }: { binder: PublicBinder }) {
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const capacity = binder.rows * binder.cols
  const pages = Math.max(1, Math.ceil(binder.slots.length / capacity))
  const slots = binder.slots.slice(page * capacity, (page + 1) * capacity)
  const active = slots.find(s => s.id === selected)
  const theme = getBinderColorPreset(binder.appearance.pageColors[String(page + 1)] ?? binder.appearance.color)[binder.appearance.dark ? 'dark' : 'light']
  function turn(next: number) { setPage(next); setSelected(null) }
  return <main className={`min-h-dvh ${binder.appearance.dark ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-950'}`}
    style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header className="min-w-0">
        <p className="text-xs uppercase tracking-wider opacity-65">Holo Folder · Read-only binder</p>
        <h1 className="break-words text-2xl font-semibold [overflow-wrap:anywhere]">{binder.name}</h1>
        <p>{binder.completion.completedTargetCount} of {binder.completion.targetCount} current targets filled</p>
      </header>
      <nav aria-label="Binder pages" className="flex items-center justify-between gap-2">
        <button type="button" className="min-h-10 rounded-lg border px-3 disabled:opacity-40" disabled={page === 0} onClick={() => turn(page - 1)}>Previous</button>
        <span className="text-center text-sm tabular-nums">Page {page + 1} of {pages}</span>
        <button type="button" className="min-h-10 rounded-lg border px-3 disabled:opacity-40" disabled={page + 1 >= pages} onClick={() => turn(page + 1)}>Next</button>
      </nav>
      <section aria-label={`Binder page ${page + 1}, ${binder.rows} rows by ${binder.cols} columns`} className="max-w-full overflow-auto overscroll-contain rounded-2xl border p-2" tabIndex={0}
        style={{ background: theme.background, borderColor: theme.border, boxShadow: theme.shadow }}>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${binder.cols}, minmax(64px, 1fr))`, gridTemplateRows: `repeat(${binder.rows}, minmax(90px, 1fr))`, minWidth: binder.cols * 64 + (binder.cols - 1) * 6 }}>
          {Array.from({ length: capacity }, (_, index) => {
            const slot = slots[index]
            return <div key={slot?.id ?? `padding-${index}`} className="relative aspect-[63/88] min-h-[90px]">
              {slot && <OrderedSlot slot={slot} selected={selected === slot.id} onSelect={setSelected} imageSizes="(max-width: 600px) 30vw, 160px" glare={binder.appearance.glare} glareStyle={{}} />}
            </div>
          })}
        </div>
      </section>
      {active && <section aria-label="Selected slot" className="rounded-xl border p-3 [overflow-wrap:anywhere]">
        <h2 className="font-semibold">{displaySlotLabel(active)}</h2>
        {active.recordedProvider && <p>Recorded provider: {active.recordedProvider}</p>}
        {active.item?.grading && <p>Recorded grade: {active.item.grading.grade}</p>}
        {active.marketGBP !== undefined && <p>Saved market estimate: {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(active.marketGBP)}</p>}
      </section>}
      <CardDataAttribution />
    </div>
  </main>
}
