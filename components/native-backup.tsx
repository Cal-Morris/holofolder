"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { binderBackupFilename } from "@/lib/binder-backup"
import { inspectNativeBackup, prepareNativeBackup, readNativeBackup, readNativeBackupFile, type NativeBackupBinding } from "@/lib/native-backup"
import type { BinderBackupV2 } from "@/lib/binder-backup-v2"

export default function NativeBackup({ binding, collectionId, onClose }: { binding: NativeBackupBinding; collectionId: string | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null), alive = useRef(false), generation = useRef(0), running = useRef(false)
  const latest = useRef(binding), urls = useRef(new Set<string>())
  const [scope, setScope] = useState<BinderBackupV2["scope"]>("all-inventory")
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("")
  const [preview, setPreview] = useState<ReturnType<typeof inspectNativeBackup> | null>(null)
  const contextKey = JSON.stringify([binding.available, binding.revisionKey])
  const [context, setContext] = useState(contextKey)
  if (context !== contextKey) { setContext(contextKey); setPreview(null); setMessage("") }
  useOverlay(true, onClose, { containerRef: panel })
  const swipe = useSwipeToDismiss(panel, onClose, true)
  useLayoutEffect(() => { latest.current = binding })
  useLayoutEffect(() => {
    generation.current++
  }, [binding.available, binding.revisionKey])
  useLayoutEffect(() => {
    alive.current = true
    const ownedUrls = urls.current
    const cancel = () => { alive.current = false; generation.current++ }
    const invalidate = () => { generation.current++; setPreview(null); setMessage("") }
    window.addEventListener("offline", invalidate)
    return () => {
      cancel()
      window.removeEventListener("offline", invalidate)
      ownedUrls.forEach(url => URL.revokeObjectURL(url)); ownedUrls.clear()
    }
  }, [])
  async function run(action: (active: () => boolean) => Promise<void>) {
    if (running.current) return
    running.current = true; setBusy(true); setMessage(""); setPreview(null)
    const request = ++generation.current
    const active = () => alive.current && generation.current === request
    try { await action(active) }
    catch (error) { if (active()) setMessage(error instanceof Error ? error.message : "Could not read collection data.") }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }
  const buttonClass = "min-h-10 rounded-lg border px-3 text-sm disabled:opacity-50"
  return <div className="fixed inset-0 z-40 flex items-end justify-center pb-[var(--dock-clearance)] sm:items-center">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/50" onClick={onClose} />
    <div ref={panel} role="dialog" aria-modal="true" aria-label="Collection data backup" className="relative flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-12px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border bg-background shadow-xl sm:rounded-2xl">
      <header data-sheet-grabber {...swipe} className="flex shrink-0 items-center justify-between gap-2 p-4">
        <h2 className="font-semibold">Collection data backup</h2>
        <button className="flex h-9 w-9 shrink-0 items-center justify-center" aria-label="Close backup" onClick={onClose}><X className="h-5 w-5" /></button>
      </header>
      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 text-sm">
        <p>Download private collection data to this device. Includes recorded grades and certificates. Keep the file private. This creates no public link and does not change certificate sharing.</p>
        <label className="block space-y-1">Export scope<select aria-label="Export scope" className="block min-h-10 w-full rounded-lg border bg-background px-2" value={scope} disabled={busy} onChange={e => { generation.current++; setPreview(null); setMessage(""); setScope(e.target.value as typeof scope) }}>
          <option value="all-inventory">All shared collections and Unassigned copies</option>
          {collectionId && <option value="collection">Current collection and its assigned copies</option>}
        </select></label>
        <button className={buttonClass} disabled={busy || !binding.available} onClick={() => void run(async active => {
          const result = await prepareNativeBackup(latest.current, scope, collectionId ?? undefined, active)
          result.assertCurrent()
          const url = URL.createObjectURL(result.blob); urls.current.add(url)
          const link = document.createElement("a")
          link.href = url; link.download = binderBackupFilename(result.backup.scope === "all-inventory" ? "collection-data" : result.backup.collections[0]?.name ?? null, result.backup.exportedAt)
          try { result.assertCurrent(); document.body.appendChild(link); link.click() }
          finally { link.remove() }
          setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url) }, 60_000)
          if (active()) setMessage("Download started. Collection data only; no account, billing or external asset bytes.")
        })}>{busy ? "Reading…" : "Download collection data"}</button>
        {!binding.available && <p role="status">Reconnect and finish pending edits, creation or recovery before exporting or comparing a preview.</p>}
        <p className="text-xs text-muted-foreground">Fresh reads only. JSON preserves ordered slots, targets, wants, copied manifests, grids and distinct physical copies. Current collection excludes Unassigned and other collections. Appearance/settings and Auth/Billing/database backups are outside this export.</p>
        <p className="text-xs text-muted-foreground">External image references are not image bytes. Private label asset references and cover artwork packaging are unsupported by v2 and fail validation; nothing is fetched or silently stripped.</p>
        <section className="space-y-2" aria-label="Local import preview">
          <h3 className="font-medium">Preview a JSON backup</h3>
          <p>Select a v2 file for a local structural preview. No upload, provider lookup, saved file cache or collection changes. Legacy v1 and CSV remain in the legacy importer.</p>
          <input aria-label="Select backup file" type="file" accept=".json,application/json" className="block min-h-10 w-full min-w-0 text-sm file:min-h-10" disabled={busy || !binding.available} onChange={e => {
            const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""
            if (!file) return
            void run(async active => {
              const text = await readNativeBackupFile(file)
              if (!active()) return
              const { read, assertCurrent } = await readNativeBackup(latest.current, active)
              const value = inspectNativeBackup(text, read)
              assertCurrent(); if (active()) setPreview(value)
            })
          }} />
          {preview && <div role="region" aria-label="Backup preview" className="space-y-2 break-words rounded-lg border p-3">
            <p>{preview.scope === "all-inventory" ? "All-inventory" : "Collection-only"} file: {preview.collections} collections, {preview.copies} distinct copies, {preview.unassigned} Unassigned, {preview.placements} placements.</p>
            <p>{preview.slots} ordered slots, {preview.spacers} spacers, {preview.targets} targets, {preview.wants} wanted choices, {preview.manifests} copied manifests, {preview.grids} grids, {preview.graded} graded copies, {preview.appearance} appearance entries.</p>
            <p>{preview.knownPrintings} known printings, {preview.unknownPrintings} Unknown. Unknown data is preserved, never guessed.</p>
            <p>Conflicts to resolve: {preview.overlappingCopies} overlapping copy IDs, {preview.overlappingCollections} overlapping collection IDs. Matching IDs do not prove ownership or authorize replacement.</p>
            {preview.partnerResolution && <p>Partner wanted assignments need explicit current membership resolution.</p>}
            {!preview.grids && <p>This file has no verified grid data.</p>}
            <p>Inspection only. No restore plan admitted. Same-owner provenance, remapping, copy/move decisions, current allowance, settings and asset packaging require separate restore review. Nothing has been saved or restored.</p>
          </div>}
        </section>
        {message && <p role="status" className="break-words">{message}</p>}
      </div>
    </div>
  </div>
}
