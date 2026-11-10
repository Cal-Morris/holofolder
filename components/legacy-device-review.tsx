"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { acceptLegacyQueueReview, LOCAL_COLLECTION_PENDING_OPS_KEY, prepareLegacyQueueReview, readLegacyQueueSources, readPendingCollectionOperations, writePendingCollectionOperations, type PendingCollectionOperationInput, type PendingCollectionOperation } from "@/lib/collection/offline-queue"
import { legacyReviewEntries, type LegacyReviewEntry } from "@/lib/collection/legacy-review"
import { collectionFingerprint } from "@/lib/collection/sync"
import type { CollectedPokemon } from "@/lib/domain/cards"
import { sameCollectionOrigin, type CollectionOrigin } from "@/lib/collection/recipient"

type Destination = { recipient: Extract<CollectionOrigin, { kind: "account" }>; memberIds: string[]; binders: { id: string; name: string }[]; collection?: CollectedPokemon[] }
const key = (entry: LegacyReviewEntry) => JSON.stringify([entry.source.legacyQueueSource.raw, entry.ordinal])
const reviewEntries = (sources: Parameters<typeof legacyReviewEntries>[0], actorId?: string | null) => legacyReviewEntries(sources, readPendingCollectionOperations().filter(op => op.compatibilityPause).map(op => op.binderId ?? null), actorId)
const button = "min-h-9 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"

export function LegacyDeviceReview({ actorId, ownerId, binderId }: { actorId: string | null; ownerId: string | null; binderId: string | null }) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [hasOriginalData, setHasOriginalData] = useState(false)
  const [blocked, setBlocked] = useState<PendingCollectionOperation[]>([])
  const [kept, setKept] = useState(false)
  const [entries, setEntries] = useState<LegacyReviewEntry[]>([])
  const [destination, setDestination] = useState<Destination | null>(null)
  const [selectedBinder, setSelectedBinder] = useState("")
  const [choices, setChoices] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const epoch = useRef(0)
  const acceptedEpoch = useRef<string | null>(null)
  const identity = JSON.stringify([actorId, ownerId, binderId])
  const currentIdentity = useRef(identity)
  useLayoutEffect(() => { currentIdentity.current = identity; return () => { currentIdentity.current = "" } }, [identity])
  const [queueAtReview, setQueueAtReview] = useState<string | null>(null)
  const sourcesAtReview = useRef<ReturnType<typeof prepareLegacyQueueReview>>([])
  const close = () => { epoch.current++; setOpen(false); setBusy(false) }
  useOverlay(open, close, { containerRef: panel })
  const swipe = useSwipeToDismiss(panel, close, open)
  useEffect(() => {
    const refresh = () => {
      const sources = readLegacyQueueSources()
      const historical = reviewEntries(sources, actorId).length
      setHasOriginalData(sources.some(source => reviewEntries([{ legacyQueueSource: { ...source.legacyQueueSource, accepted: [] } }], actorId).length > 0))
      const pending = readPendingCollectionOperations()
      setBlocked(pending.filter(op => (!op.origin && !!op.compatibilityPause) || (op.origin?.kind === "account" && op.origin.actorUserId === actorId && !!(op.recipientPause || op.compatibilityPause))))
      setCount(historical + pending.filter(op => op.origin?.kind === "guest" || ((!op.origin && !!op.compatibilityPause) || (op.origin?.kind === "account" && op.origin.actorUserId === actorId && (op.recipientPause || op.compatibilityPause)))).length)
    }
    queueMicrotask(refresh)
    const defer = () => queueMicrotask(refresh)
    window.addEventListener("storage", defer)
    window.addEventListener("holofolder-legacy-queue-changed", defer)
    return () => { window.removeEventListener("storage", defer); window.removeEventListener("holofolder-legacy-queue-changed", defer) }
  }, [actorId])
  useEffect(() => { epoch.current++; queueMicrotask(() => { setOpen(false); setBusy(false); setDestination(null); setChoices({}) }) }, [identity])
  useEffect(() => {
    const invalidate = () => { epoch.current++; setOpen(false); setBusy(false); setChoices({}); setQueueAtReview(null) }
    window.addEventListener("holofolder-legacy-scope-changed", invalidate)
    return () => window.removeEventListener("holofolder-legacy-scope-changed", invalidate)
  }, [])
  async function load(binder = "") {
    const ticket = ++epoch.current
    const startedIdentity = currentIdentity.current
    setBusy(true); setError(null); setChoices({}); setDestination(null)
    try {
      const response = await fetch(`/app/api/collection/review-destination${binder ? `?binderId=${encodeURIComponent(binder)}` : ""}`, { cache: "no-store" })
      const value = await response.json()
      if (ticket !== epoch.current || currentIdentity.current !== startedIdentity) return
      if (!response.ok) throw new Error(value.error ?? "Destination unavailable")
      if (value.recipient?.actorUserId !== actorId || value.recipient?.ownerUserId !== ownerId) throw new Error("Your account or sharing changed. Reload the app before reviewing.")
      setDestination(value)
      sourcesAtReview.current = readLegacyQueueSources()
      setEntries(reviewEntries(sourcesAtReview.current, actorId))
      setQueueAtReview(localStorage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY))
    } catch (e) { if (ticket === epoch.current) setError(e instanceof Error ? e.message : "Could not load destination") }
    finally { if (ticket === epoch.current) setBusy(false) }
  }
  function begin() {
    try {
      const sources = prepareLegacyQueueReview()
      sourcesAtReview.current = sources
      setEntries(reviewEntries(sources, actorId)); setSelectedBinder(""); setChoices({}); setDestination(null); setError(null); setOpen(true)
      if (actorId) void load()
    } catch { setError("Could not retain the original data. Free some device storage before reviewing."); setOpen(true) }
  }
  function download() {
    const sources = [...readLegacyQueueSources()]
    const queue = localStorage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)
    if (queue && blocked.length) sources.push({ legacyQueueSource: { version: 1, raw: queue, digest: "current-queue" } })
    // Individual files contain the exact original string, including whitespace and invalid JSON.
    for (const [index, source] of sources.entries()) {
      const url = URL.createObjectURL(new Blob([source.legacyQueueSource.raw], { type: "application/json" }))
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `holo-folder-original-${index + 1}-${source.legacyQueueSource.digest.replace(":", "-")}.json`; anchor.click(); URL.revokeObjectURL(url)
    }
  }
  const selected = entries.filter(entry => entry.operation && choices[key(entry)])
  async function accept() {
    if (!destination?.collection || !selectedBinder || !queueAtReview || !selected.length) return
    const ticket = ++epoch.current, startedIdentity = currentIdentity.current
    const reviewEpoch = crypto.randomUUID()
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/app/api/collection/review-destination?binderId=${encodeURIComponent(selectedBinder)}`, { cache: "no-store" })
      const fresh = await response.json() as Destination & { error?: string }
      if (ticket !== epoch.current || currentIdentity.current !== startedIdentity) return
      if (!response.ok) throw new Error(fresh.error ?? "Destination unavailable")
      if (JSON.stringify(fresh.recipient) !== JSON.stringify(destination.recipient) || JSON.stringify(fresh.memberIds) !== JSON.stringify(destination.memberIds)
        || selected.some(entry => collectionFingerprint(fresh.collection?.find(row => row.pokemon_id === entry.operation!.pokemonId) ?? null) !== collectionFingerprint(destination.collection!.find(row => row.pokemon_id === entry.operation!.pokemonId) ?? null)))
        throw new Error("The destination changed. Reload destination and review again.")
      const operations: PendingCollectionOperationInput[] = selected.map(entry => {
        const op = entry.operation!
        const base = destination.collection!.find(row => row.pokemon_id === op.pokemonId) ?? null
        return { ...op, base, origin: destination.recipient, binderId: selectedBinder, importOnly: true, recoverySource: { digest: entry.source.legacyQueueSource.digest, ordinal: entry.ordinal, reviewEpoch } }
      })
      const sources = sourcesAtReview.current.map(source => ({ legacyQueueSource: { ...source.legacyQueueSource,
        accepted: [...(source.legacyQueueSource.accepted ?? []), ...selected.filter(entry => entry.source === source).map(entry => entry.ordinal)] } }))
      acceptLegacyQueueReview(queueAtReview, sources, operations)
      acceptedEpoch.current = reviewEpoch
      setError("Reviewed changes queued for this binder. Original data is retained. Cancelling cannot undo a request already sent.")
      setChoices({}); setEntries(reviewEntries(sources, actorId)); setQueueAtReview(null)
    } catch (e) { setChoices({}); setQueueAtReview(null); setError(e instanceof Error ? e.message : "Upload could not start. Original data is retained.") }
    finally { if (ticket === epoch.current) setBusy(false) }
  }
  function cancelUpload() {
    epoch.current++; setBusy(false)
    const operations = readPendingCollectionOperations()
    writePendingCollectionOperations(operations.map(op => op.recoverySource && op.recoverySource.reviewEpoch === acceptedEpoch.current && sameCollectionOrigin(op.origin, destination?.recipient)
      ? { ...op, recipientPause: op.deliveryUnknown ? "delivery_unknown" : "cancelled_review_upload" } : op))
    setChoices({}); setQueueAtReview(null)
    setError("Upload stopped for remaining changes. A request already sent may still complete. Check the destination before making another change.")
  }
  if (!count && !hasOriginalData && !open) return null
  return <>
    <div className="mx-3 my-2 rounded-xl border border-border bg-background p-3 text-sm" role="region" aria-label="Device changes">
      <p>{count ? "Changes saved on this device haven’t been added to your account." : "Original device data is kept here. You can download it again."}</p>
      <div className="mt-2 flex flex-wrap gap-2"><button className={button} onClick={begin}>Review changes</button><button className={button} onClick={() => setKept(true)}>Keep on this device</button></div>
      {kept && <p className="mt-2 text-xs text-muted-foreground">Kept here. Signing in or reconnecting does not upload them.</p>}
    </div>
    {open && <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" data-overlay-backdrop onClick={close} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Review device changes" className="relative flex w-full max-w-xl flex-col rounded-t-2xl border border-border bg-background p-4 sm:rounded-2xl" style={{ height: "calc(100dvh - env(safe-area-inset-top) - var(--dock-clearance) - 16px)", maxHeight: "calc(100dvh - env(safe-area-inset-top) - var(--dock-clearance) - 16px)", marginBottom: "var(--dock-clearance)" }}>
        <div data-sheet-grabber className="flex shrink-0 items-center justify-between gap-2" {...swipe}><h2 className="text-lg font-semibold">Review device changes</h2><button className={button} aria-label="Close device changes" onClick={close}>Close</button></div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain wrap-anywhere py-3 text-sm">
          <p>Choose where these new reviewed changes will go. The original data stays on this device.</p>
          {!actorId && <p className="mt-2">Sign in to choose a destination, then reopen this review. Signing in does not add these changes.</p>}
          {destination && <div className="my-3 space-y-2"><p>Signed-in account: {destination.recipient.actorUserId}<br />Collection owner: {destination.recipient.ownerUserId}</p>
            <p>{destination.memberIds.length > 1 ? `Shared with accounts: ${destination.memberIds.join(", ")}. Everyone with access to this binder can see added changes.` : "Private collection, visible to the account owner."}</p>
            <label className="block">Destination binder<select aria-label="Destination binder" className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background p-2 text-sm" value={selectedBinder} onChange={e => { setSelectedBinder(e.target.value); void load(e.target.value) }}><option value="">Choose an existing binder</option>{destination.binders.map(binder => <option key={binder.id} value={binder.id}>{binder.name}</option>)}</select></label></div>}
          {busy && <p role="status">Checking destination…</p>}
          <div className="my-3 flex flex-wrap gap-2"><button className={button} onClick={() => void load(selectedBinder)} disabled={!actorId || busy}>Reload destination</button><button className={button} onClick={download}>Download original data</button></div>
          {blocked.map(op => <p key={op.id} className="my-3 rounded-lg border border-border p-3">Request {op.id} remains on this device for {op.origin?.kind === "account" ? op.origin.binderId : "its original binder"}. {op.compatibilityPause ? "This converted-binder pause needs a compatible client. This review cannot clear it." : op.recipientPause === "delivery_unknown" ? "Its delivery outcome is unknown. Check that binder and Activity before making another edit. Do not repeat this upload." : "The original destination or review changed. Reload the app and check the original binder before making a new edit."} Download original data to retain the full request and base.</p>)}
          <ul className="space-y-3">{entries.map(entry => {
            const row = destination?.collection?.find(row => row.pokemon_id === entry.operation?.pokemonId)
            const change = entry.operation?.type === "delete" ? "Remove" : row ? "Replace" : "Add"
            return <li key={key(entry)} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{(() => { try { const raw = JSON.parse(entry.source.legacyQueueSource.raw)[entry.ordinal]; return raw?.origin?.kind === "guest" ? "Guest workspace" : raw?.origin?.kind === "account" ? "Saved account request" : "Older changes, original account unknown" } catch { return "Older changes, original account unknown" } })()} · {entry.ordinal < 0 ? "Original source" : `Entry ${entry.ordinal + 1}`}</p>
              <p className="font-medium">{entry.label}</p>
              {entry.unresolved ? <p className="mt-1 text-muted-foreground">Unresolved: {entry.unresolved}</p> : <>
                <p>{change} {entry.operation?.type === "upsert" ? entry.operation.item.card_name ?? entry.operation.item.status : row?.card_name ?? "saved row"}{row?.card_name && change === "Replace" ? `, replacing ${row.card_name}` : ""}</p>
                <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  {[["Destination now", row], ["Reviewed change", entry.operation?.type === "upsert" ? entry.operation.item : null]].map(([title, value]) => {
                    const card = value as CollectedPokemon | null | undefined
                    return <div key={String(title)} className="rounded-md bg-muted p-2"><p className="font-medium">{String(title)}</p>{card ? <>
                      <p>{card.card_name ?? "No owned printing"}{card.card_id ? ` (${card.card_id})` : ""}</p>
                      <p>{[card.card_set, card.card_language, card.card_finish, card.status].filter(Boolean).join(" · ")}</p>
                      <p>Wanted: {card.wanted_cards.map(want => [want.card_name, want.card_id, want.card_set, want.card_language, want.card_finish].filter(Boolean).join(" · ")).join("; ") || "none"}</p>
                    </> : <p>No saved row</p>}</div>
                  })}
                </div>
                <label className="mt-2 flex min-h-9 items-center gap-2"><input type="checkbox" disabled={!destination?.collection || busy} checked={!!choices[key(entry)]} onChange={e => setChoices({ ...choices, [key(entry)]: e.target.checked })} />{change === "Replace" ? "Replace this destination row" : change === "Remove" ? "Remove this destination row" : "Add this reviewed change"}</label>
              </>}
            </li>
          })}</ul>
          {error && <p role="status" className="mt-3">{error}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-border pt-3"><button className={`${button} bg-primary text-primary-foreground`} disabled={busy || !selected.length || !destination?.collection || !queueAtReview} onClick={() => void accept()}>Add {selected.length} reviewed changes to {destination?.binders.find(b => b.id === selectedBinder)?.name ?? "binder"}</button><button className={button} onClick={cancelUpload}>Cancel upload</button><button className={button} onClick={close}>Keep on this device</button></div>
      </div>
    </div>}
  </>
}
