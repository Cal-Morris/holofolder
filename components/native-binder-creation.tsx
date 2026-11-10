"use client"

import { useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { useBilling } from "@/hooks/use-billing"
import { canCreateOwnerBinder } from "@/lib/billing"
import { MAX_BINDERS_PER_OWNER } from "@/lib/binders/model"
import { BinderCreationPresets } from "@/components/binder-creation-presets"
import type { BinderCreationDraft } from "@/lib/binder-creation-draft"
import type { SlotLocalAcceptance } from "@/lib/binder-slot-editing"

export interface NativeBinderCreationBinding {
  actorUserId: string
  ownerUserId: string
  count: number
  available: boolean
  create: (draft: BinderCreationDraft) => Promise<SlotLocalAcceptance>
}
export default function NativeBinderCreation({ binding, onClose }: { binding: NativeBinderCreationBinding; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement | null>(null)
  useOverlay(true, onClose, { containerRef: sheet })
  const swipe = useSwipeToDismiss(sheet, onClose)
  const billing = useBilling(binding.actorUserId, binding.ownerUserId, () => {})
  const [draft, setDraft] = useState<BinderCreationDraft | null>(null)
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [message, setMessage] = useState("")
  const [attempted, setAttempted] = useState(false)
  const capped = binding.count >= MAX_BINDERS_PER_OWNER || Boolean(billing?.access && !canCreateOwnerBinder(billing.access, binding.count))
  const disabled = !binding.available || capped || billing?.loading || busy || saved
  return createPortal(<div data-overlay-backdrop className="fixed inset-0 z-[42] bg-black/45" onClick={onClose}>
    <div ref={sheet} role="dialog" aria-modal="true" aria-label="New storage" onClick={e => e.stopPropagation()}
      className="absolute inset-x-0 mx-auto flex w-full max-w-md flex-col rounded-t-3xl border border-border bg-card shadow-xl"
      style={{ bottom: "var(--dock-clearance)", maxHeight: "calc(100dvh - var(--top-inset) - var(--dock-clearance) - 0.5rem)" }}>
      <header data-sheet-grabber className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3" {...swipe}>
        <h2 className="text-base font-semibold">New storage</h2>
        <button type="button" aria-label="Close new storage" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
        {capped && <p role="status" className="mt-3 text-sm">Your collection allowance is full. Existing collections stay available.</p>}
        {!binding.available && !saved && !busy && <p role="status" className="mt-3 text-sm">Reconnect and finish pending edits or recovery before creating storage.</p>}
        {draft && <section aria-label="Confirm storage creation" className="mt-3 space-y-3">
          <p className="break-words text-sm font-semibold">Create “{draft.name}”?</p>
          <p className="text-sm">{draft.kind === "custom" ? "Custom storage · Starts in List" : "Binder · Starts in Binder"}. You can change the view later.</p>
          {draft.location && <p className="whitespace-pre-wrap break-words text-sm">Private location: {draft.location}</p>}
          <p className="text-sm">{draft.manifest.entries.length} copied targets in the previewed order. No owned copies, wants or grades will be added.</p>
          <button type="button" disabled={disabled} className="min-h-11 w-full rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-40" onClick={async () => {
            if (disabled) return
            setAttempted(true); setBusy(true); setMessage("")
            try {
              await binding.create(draft)
              setSaved(true); setMessage("Saved on this device · Creation pending sync. This collection opens only after current storage confirms it.")
            } catch { setMessage("Could not confirm device storage. Retry this same creation; your choices are kept.") }
            finally { setBusy(false) }
          }}>{saved ? "Creation pending" : busy ? "Saving on device…" : attempted ? "Retry saving creation" : "Confirm create storage"}</button>
          {!attempted && <button type="button" onClick={() => setDraft(null)} className="min-h-10 w-full rounded-xl border border-border text-sm">Back to preview</button>}
        </section>}
        <div hidden={!!draft}><BinderCreationPresets ownerUserId={binding.ownerUserId} onDraft={setDraft} isOnline={binding.available} disabled={disabled} nativeCreation /></div>
        {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      </div>
    </div>
  </div>, document.body)
}
