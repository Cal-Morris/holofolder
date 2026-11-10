"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { binderBackupFilename } from "@/lib/binder-backup"
import { inspectNativeBackup, prepareNativeBackup, readNativeBackup, readNativeBackupFile, type NativeBackupBinding } from "@/lib/native-backup"
import { inspectRawRestore, type NativeRawRestoreBinding } from '@/lib/native-raw-restore'
import type { RawRestoreCommand } from '@/lib/domain/raw-restore'
import type { BinderBackupV2 } from "@/lib/binder-backup-v2"

export default function NativeBackup({ binding, restore, collectionId, onClose }: { binding: NativeBackupBinding; restore?: NativeRawRestoreBinding; collectionId: string | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null), alive = useRef(false), generation = useRef(0), running = useRef(false)
  const latest = useRef(binding), urls = useRef(new Set<string>())
  const [scope, setScope] = useState<BinderBackupV2["scope"]>("all-inventory")
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("")
  const [preview, setPreview] = useState<ReturnType<typeof inspectNativeBackup> | null>(null)
  const [fileText, setFileText] = useState<string | null>(null)
  const [rawReview, setRawReview] = useState<Awaited<ReturnType<typeof inspectRawRestore>> | null>(null)
  const [copyPage, setCopyPage] = useState(0), [slotPage, setSlotPage] = useState(0)
  const [releaseConsent, setReleaseConsent] = useState<string[]>([])
  const [command, setCommand] = useState<RawRestoreCommand | null>(null)
  const contextKey = JSON.stringify([binding.available, binding.revisionKey])
  const [context, setContext] = useState(contextKey)
  if (context !== contextKey) { setContext(contextKey); setPreview(null); setRawReview(null); setCommand(null); setReleaseConsent([]); setFileText(null); setMessage("") }
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
    const invalidate = () => { generation.current++; setPreview(null); setRawReview(null); setCommand(null); setFileText(null); setMessage("") }
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
            setFileText(null); setRawReview(null); setCommand(null); setReleaseConsent([])
            void run(async active => {
              const text = await readNativeBackupFile(file)
              if (!active()) return
              const { read, assertCurrent } = await readNativeBackup(latest.current, active)
              const value = inspectNativeBackup(text, read)
              assertCurrent(); if (active()) { setFileText(text); setPreview(value) }
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
        {restore && collectionId && fileText && (preview?.scope === "collection" || rawReview) && <section className="space-y-3" aria-label="Bounded raw collection restore">
          <h3 className="font-medium">Restore raw collection content</h3>
          <p>One current raw collection only, with the same slots, configuration and grid. Copied manifest and each slot origin stay unchanged. Up to 1,025 slots, within the reviewed content budget. No new copies, grades, converted data, settings or assets. Matching file IDs do not prove provenance.</p>
          {!rawReview && <button className={buttonClass} disabled={busy || !binding.available} onClick={() => void run(async active => {
            const review = await inspectRawRestore(latest.current, fileText!, collectionId, active)
            if (active()) { setRawReview(review); setCopyPage(0); setSlotPage(0); setReleaseConsent([]); setCommand(null) }
          })}>Review raw collection locally</button>}
          {rawReview && <div className="space-y-3 break-words [overflow-wrap:anywhere]">
            <p>Current collection: {collectionId}. The grid stays unchanged. Review each stable slot’s before and after position below. Released copies remain owned in Unassigned.</p>
            <p>{rawReview.slots.length.toLocaleString()} slots, {rawReview.placements.length.toLocaleString()} involved copies, {rawReview.choices.releaseItemIds.length.toLocaleString()} explicit releases to Unassigned.</p>
            {rawReview.placements.slice(copyPage * 50, (copyPage + 1) * 50).map(p => <div key={p.itemId} className="space-y-1">
              <p>Copy {p.itemId}: {p.from ?? 'Unassigned'} → {p.to ?? 'Unassigned'}</p>
              {rawReview.choices.releaseItemIds.includes(p.itemId) && <label className="flex min-h-10 items-center gap-2">
                <input type="checkbox" className="h-5 w-5 shrink-0" disabled={busy || !!command} checked={releaseConsent.includes(p.itemId)} onChange={e => setReleaseConsent(values => e.target.checked ? [...values, p.itemId] : values.filter(v => v !== p.itemId))} />
                <span>Release copy {p.itemId} to Unassigned, keep ownership</span>
              </label>}
            </div>)}
            {rawReview.placements.length > 50 && <nav aria-label="Copy review pages" className="flex flex-wrap items-center gap-2">
              <button className={buttonClass} disabled={copyPage === 0} onClick={() => setCopyPage(p => p - 1)}>Previous copies</button>
              <span>Copy page {copyPage + 1} of {Math.ceil(rawReview.placements.length / 50)}</span>
              <button className={buttonClass} disabled={(copyPage + 1) * 50 >= rawReview.placements.length} onClick={() => setCopyPage(p => p + 1)}>Next copies</button>
            </nav>}
            <details><summary className="min-h-10 cursor-pointer py-2">Exact targets, status and wanted choices</summary>
              {rawReview.slots.slice(slotPage * 50, (slotPage + 1) * 50).map((slot, n) => <div key={slot.before.id} className="my-2 rounded-lg border p-2">
                <p>Slot {slotPage * 50 + n + 1}: {slot.before.id}, position {rawReview.slotOrder.before.indexOf(slot.before.id) + 1} → {rawReview.slotOrder.after.indexOf(slot.before.id) + 1}</p>
                <p>Before target: {JSON.stringify(slot.before.target)}, status: {slot.before.status ?? 'empty'}, wants: {JSON.stringify(slot.before.wantedCards)}</p>
                <p>After target: {JSON.stringify(slot.after.target)}, status: {slot.after.status ?? 'empty'}, wants: {JSON.stringify(slot.after.wantedCards)}</p>
              </div>)}
              {rawReview.slots.length > 50 && <nav aria-label="Slot review pages" className="flex flex-wrap items-center gap-2">
                <button className={buttonClass} disabled={slotPage === 0} onClick={() => setSlotPage(p => p - 1)}>Previous slots</button>
                <span>Slot page {slotPage + 1} of {Math.ceil(rawReview.slots.length / 50)}</span>
                <button className={buttonClass} disabled={(slotPage + 1) * 50 >= rawReview.slots.length} onClick={() => setSlotPage(p => p + 1)}>Next slots</button>
              </nav>}
            </details>
            <p>Private server review is a separate action. It sends this file and your explicit choices to the authenticated planner. No file cache, server backup store or provider lookup is created. Review makes no collection changes.</p>
            {!command && <button className={buttonClass} disabled={busy || !binding.available || releaseConsent.length !== rawReview.choices.releaseItemIds.length} onClick={() => void run(async active => {
              const planned = await restore.plan({ text: fileText!, choices: rawReview.choices, operationId: crypto.randomUUID() }, active)
              if (planned.inventoryRevision !== rawReview.base.inventoryRevision) throw new Error('Current storage changed. Close and review the file again.')
              if (active()) setCommand(planned)
            })}>Send private file for restore review</button>}
            {command && <>
              <p>Reviewed operation {command.operationId}. Confirm saves the original bounded command on this device before delivery. While unresolved, all storage editing is paused. A receipt alone does not finish sync.</p>
              <button className={buttonClass} disabled={busy || !binding.available} onClick={() => void run(async active => {
                await restore.retain(command, rawReview.base, active)
                if (active()) { setFileText(null); setRawReview(null); setCommand(null); setMessage('Restore saved on device. Editing stays paused until a matching reply and fresh complete read reconcile it.') }
              })}>Confirm and save raw restore</button>
            </>}
          </div>}
        </section>}
        {message && <p role="status" className="break-words">{message}</p>}
      </div>
    </div>
  </div>
}
