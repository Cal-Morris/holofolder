"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { binderBackupFilename } from "@/lib/binder-backup"
import { inspectNativeBackup, prepareNativeBackup, readNativeBackup, readNativeBackupFile, type NativeBackupBinding } from "@/lib/native-backup"
import { inspectRawRestore, type NativeRawRestoreBinding } from '@/lib/native-raw-restore'
import type { RawRestoreCommand } from '@/lib/domain/raw-restore'
import type { BinderBackupV2 } from "@/lib/binder-backup-v2"
import { Select } from "@/components/ui/select"

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
  return <div className="fixed inset-0 z-[42] flex items-end justify-center pb-[var(--dock-clearance)] sm:items-center">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/50" onClick={onClose} />
    <div ref={panel} role="dialog" aria-modal="true" aria-label="Collection data backup" className="relative flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-12px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border bg-background shadow-xl sm:rounded-2xl">
      <header data-sheet-grabber {...swipe} className="relative flex shrink-0 items-center justify-between gap-2 p-4">
        <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/30" />
        <h2 className="font-semibold">Back up your collection</h2>
        <button className="flex h-9 w-9 shrink-0 items-center justify-center" aria-label="Close backup" onClick={onClose}><X className="h-5 w-5" /></button>
      </header>
      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 text-sm">
        <p>Download a private file of your collection to keep somewhere safe. It includes your grades and certificate numbers, so keep it to yourself. Nothing is shared or published.</p>
        <label className="block space-y-1">What to include<Select aria-label="Export scope" className="w-full" value={scope} disabled={busy} onChange={e => { generation.current++; setPreview(null); setMessage(""); setScope(e.target.value as typeof scope) }}>
          <option value="all-inventory">Everything: all binders and cards not in a binder</option>
          {collectionId && <option value="collection">Just this binder and the cards in it</option>}
        </Select></label>
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
        {!binding.available && <p role="status">You need to be online, with your latest changes saved, to make or check a backup.</p>}
        <p className="text-xs text-muted-foreground">The file holds your binders, their pockets, your wanted cards and every card you own. It doesn&apos;t hold card pictures, slab label photos, app settings or your account.</p>
        <section className="space-y-2" aria-label="Local import preview">
          <h3 className="font-medium">Check a backup file</h3>
          <p>Choose a backup file to see what&apos;s in it. It&apos;s only read on this device: nothing is uploaded and your collection doesn&apos;t change.</p>
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
            <p>{preview.scope === "all-inventory" ? "A whole collection" : "One binder"}: {preview.collections} {preview.collections === 1 ? "binder" : "binders"}, {preview.copies} cards ({preview.unassigned} not in a binder), {preview.wants} wanted.</p>
            <p>{preview.slots} pockets, {preview.graded} graded {preview.graded === 1 ? "card" : "cards"}.</p>
            {preview.unknownPrintings > 0 && <p>{preview.unknownPrintings} {preview.unknownPrintings === 1 ? "card has" : "cards have"} no known printing. They&apos;re kept exactly as recorded.</p>}
            {(preview.overlappingCopies > 0 || preview.overlappingCollections > 0) && <p>{preview.overlappingCopies} cards and {preview.overlappingCollections} binders in this file are already in your collection.</p>}
            {preview.partnerResolution && <p>Some wanted cards in this file were assigned to a partner.</p>}
            {!preview.grids && <p>This file doesn&apos;t say how many pockets are on a page.</p>}
            <p className="text-muted-foreground">This only shows what&apos;s in the file. Restoring a whole collection from a file isn&apos;t available.</p>
          </div>}
        </section>
        {restore && collectionId && fileText && (preview?.scope === "collection" || rawReview) && <section className="space-y-3" aria-label="Bounded raw collection restore">
          <h3 className="font-medium">Put this binder back how the file has it</h3>
          <p>This rearranges the binder that&apos;s open to match the file: the same pockets, in the file&apos;s order, with what each is for. It adds no cards, grades or settings. Cards left without a pocket stay in your collection.</p>
          {!rawReview && <button className={buttonClass} disabled={busy || !binding.available} onClick={() => void run(async active => {
            const review = await inspectRawRestore(latest.current, fileText!, collectionId, active)
            if (active()) { setRawReview(review); setCopyPage(0); setSlotPage(0); setReleaseConsent([]); setCommand(null) }
          })}>See what would change</button>}
          {rawReview && <div className="space-y-3 break-words [overflow-wrap:anywhere]">
            <p>Check what moves. Cards left without a pocket stay in your collection, and the page size stays the same.</p>
            <p>{rawReview.slots.length.toLocaleString()} pockets, {rawReview.placements.length.toLocaleString()} cards involved, {rawReview.choices.releaseItemIds.length.toLocaleString()} taken out of the binder.</p>
            {rawReview.placements.slice(copyPage * 50, (copyPage + 1) * 50).map(p => <div key={p.itemId} className="space-y-1">
              <p>{p.from && p.to ? 'A card moves to another pocket' : p.to ? 'A card not in a binder goes into a pocket' : 'A card comes out of the binder'}</p>
              {rawReview.choices.releaseItemIds.includes(p.itemId) && <label className="flex min-h-10 items-center gap-2">
                <input type="checkbox" className="h-5 w-5 shrink-0" disabled={busy || !!command} checked={releaseConsent.includes(p.itemId)} onChange={e => setReleaseConsent(values => e.target.checked ? [...values, p.itemId] : values.filter(v => v !== p.itemId))} />
                <span>Take this card out of the binder. It stays in my collection.</span>
              </label>}
            </div>)}
            {rawReview.placements.length > 50 && <nav aria-label="Copy review pages" className="flex flex-wrap items-center gap-2">
              <button className={buttonClass} disabled={copyPage === 0} onClick={() => setCopyPage(p => p - 1)}>Previous copies</button>
              <span>Copy page {copyPage + 1} of {Math.ceil(rawReview.placements.length / 50)}</span>
              <button className={buttonClass} disabled={(copyPage + 1) * 50 >= rawReview.placements.length} onClick={() => setCopyPage(p => p + 1)}>Next copies</button>
            </nav>}
            <details><summary className="min-h-10 cursor-pointer py-2">Technical details</summary>
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
            <p>Next, the file and your choices are checked against your collection on our side. Nothing changes until you confirm.</p>
            {!command && <button className={buttonClass} disabled={busy || !binding.available || releaseConsent.length !== rawReview.choices.releaseItemIds.length} onClick={() => void run(async active => {
              const planned = await restore.plan({ text: fileText!, choices: rawReview.choices, operationId: crypto.randomUUID() }, active)
              if (planned.inventoryRevision !== rawReview.base.inventoryRevision) throw new Error('Your collection changed while this was open. Close this and check the file again.')
              if (active()) setCommand(planned)
            })}>Check this restore</button>}
            {command && <>
              <p>Ready to restore. Other changes are paused until it has been applied and your collection has caught up.</p>
              <button className={buttonClass} disabled={busy || !binding.available} onClick={() => void run(async active => {
                await restore.retain(command, rawReview.base, active)
                if (active()) { setFileText(null); setRawReview(null); setCommand(null); setMessage('Restore started. Other changes are paused until it has been applied.') }
              })}>Restore this binder</button>
            </>}
          </div>}
        </section>}
        {message && <p role="status" className="break-words">{message}</p>}
      </div>
    </div>
  </div>
}
