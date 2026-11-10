"use client"

import { legacyReviewProjections, type DurableReview, type LegacyQueueRuntime } from "@/lib/collection/legacy-queue-runtime"
import type { LegacyQueueSource } from "@/lib/collection/legacy-source"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { acceptLegacyQueueReview, LOCAL_COLLECTION_PENDING_OPS_KEY, prepareLegacyQueueReview, readLegacyQueueSources, readPendingCollectionOperationRaw, readPendingCollectionOperations, writePendingCollectionOperations, type PendingCollectionOperationInput, type PendingCollectionOperation } from "@/lib/collection/offline-queue"
import { decodeQueueArray, mayDownloadLegacyOriginal, sourceDigest } from "@/lib/collection/legacy-source"
import { legacyReviewEntries, type LegacyReviewEntry } from "@/lib/collection/legacy-review"
import { collectionFingerprint } from "@/lib/collection/sync"
import type { CollectedPokemon } from "@/lib/domain/cards"
import { sameCollectionOrigin, type CollectionOrigin } from "@/lib/collection/recipient"

type Destination = { recipient: Extract<CollectionOrigin, { kind: "account" }>; memberIds: string[]; binders: { id: string; name: string }[]; collection?: CollectedPokemon[] }
const key = (entry: LegacyReviewEntry) => JSON.stringify(["sourceId" in entry.source ? entry.source.sourceId : entry.source.legacyQueueSource.raw, entry.ordinal])
const button = "min-h-9 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"

export function LegacyDeviceReview({ actorId, ownerId, binderId, durableQueue, durableEnabled = false }: { actorId: string | null; ownerId: string | null; binderId: string | null; durableQueue?: LegacyQueueRuntime | null; durableEnabled?: boolean }) {
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
  const [accepting, setAccepting] = useState(false)
  const acceptanceLock = useRef<symbol | null>(null)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const epoch = useRef(0)
  const acceptedEpoch = useRef<string | null>(null)
  const identity = JSON.stringify([actorId, ownerId, binderId])
  const currentIdentity = useRef(identity)
  useLayoutEffect(() => { epoch.current++; currentIdentity.current = identity; return () => { currentIdentity.current = "" } }, [identity])
  const [queueAtReview, setQueueAtReview] = useState<string | null>(null)
  const sourcesAtReview = useRef<LegacyQueueSource[]>([])
  const durableReview = useRef<DurableReview | null>(null)
  const acceptedReview = useRef<DurableReview | null>(null)
  const durableSources = useCallback(() => legacyReviewProjections(durableQueue?.view()?.sources ?? []), [durableQueue])
  const pendingOperations = useCallback(() => durableEnabled ? durableQueue?.view()?.entries.filter(entry => entry.state !== "completed").map(entry => ({ ...entry.operation,
    ...(entry.state === "unknown" ? { recipientPause: "delivery_unknown" } : entry.state === "paused" ? { recipientPause: entry.reason ?? "paused" } : {}),
    ...(entry.settlement?.kind === "known-rejection" && entry.settlement.category === "compatibility" ? { compatibilityPause: { code: "binder_converted_requires_slot_commands" as const, rawRecord: JSON.stringify(entry) } } : {}),
  })) ?? [] : readPendingCollectionOperations(), [durableEnabled, durableQueue])
  const reviewEntries = useCallback((sources: LegacyQueueSource[], actor?: string | null, targetBinder?: string) => {
    const entries = sources.flatMap(source => "mirrorEvidence" in source && source.mirrorEvidence
      ? [{ source, ordinal: -1, label: "Structured mirror evidence", unresolved: "Delivery is unverified. This retained mirror cannot authorize an upload." }]
      : legacyReviewEntries([source], pendingOperations().filter(op => op.compatibilityPause).map(op => op.binderId ?? null), actor))
    const targetPaused = durableEnabled && targetBinder && durableReview.current?.entries.some(entry => entry.operation.compatibilityPause || entry.settlement?.kind === "known-rejection" && entry.settlement.category === "compatibility")
    return targetPaused ? entries.map(entry => ({ ...entry, unresolved: "Converted binder pause. This review cannot clear it." })) : entries
  }, [pendingOperations, durableEnabled])

  const close = () => { epoch.current++; setOpen(false); setBusy(false) }
  useOverlay(open, close, { containerRef: panel })
  const swipe = useSwipeToDismiss(panel, close, open)
  useEffect(() => {
    const refresh = () => {
      const sources = durableEnabled ? durableSources() : readLegacyQueueSources()
      const historical = reviewEntries(sources, actorId).length
      setHasOriginalData(sources.some(source => durableEnabled ? (decodeQueueArray(source.legacyQueueSource.raw)?.length ?? 1) > 0 : reviewEntries([{ legacyQueueSource: { ...source.legacyQueueSource, accepted: [] } }], actorId).length > 0))
      const pending = pendingOperations()
      setBlocked(pending.filter(op => (!op.origin && !!op.compatibilityPause) || (op.origin?.kind === "account" && op.origin.actorUserId === actorId && !!(op.recipientPause || op.compatibilityPause))))
      setCount(historical + pending.filter(op => op.origin?.kind === "guest" || ((!op.origin && !!op.compatibilityPause) || (op.origin?.kind === "account" && op.origin.actorUserId === actorId && (op.recipientPause || op.compatibilityPause)))).length)
    }
    queueMicrotask(refresh)
    const defer = () => queueMicrotask(refresh)
    window.addEventListener("holofolder-legacy-view-changed", defer)
    window.addEventListener("storage", defer)
    window.addEventListener("holofolder-legacy-queue-changed", defer)
    return () => { window.removeEventListener("holofolder-legacy-view-changed", defer); window.removeEventListener("storage", defer); window.removeEventListener("holofolder-legacy-queue-changed", defer) }
  }, [actorId, durableEnabled, durableQueue, durableSources, pendingOperations, reviewEntries])
  useEffect(() => { epoch.current++; queueMicrotask(() => { setOpen(false); setBusy(false); setDestination(null); setChoices({}) }) }, [identity])
  useEffect(() => {
    const invalidate = () => { epoch.current++; setBlocked([]); setEntries([]); setCount(0); setHasOriginalData(false); setOpen(false); setBusy(false); setChoices({}); setQueueAtReview(null) }
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
      if (durableEnabled) {
        if (!durableQueue) throw new Error("Device storage is still loading.")
        durableReview.current = binder ? await durableQueue.prepareReview(value.recipient) : null
        if (ticket !== epoch.current || currentIdentity.current !== startedIdentity) return
        sourcesAtReview.current = durableReview.current?.projections ?? durableSources()
        setQueueAtReview(durableReview.current ? "durable" : null)
      } else {
        sourcesAtReview.current = readLegacyQueueSources()
        setQueueAtReview(localStorage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY))
      }
      setEntries(reviewEntries(sourcesAtReview.current, actorId, binder))
    } catch (e) { if (ticket === epoch.current) setError(e instanceof Error ? e.message : "Could not load destination") }
    finally { if (ticket === epoch.current) setBusy(false) }
  }
  async function begin() {
    const startedIdentity = currentIdentity.current, ticket = ++epoch.current
    try {
      if (durableEnabled) {
        if (!durableQueue) throw new Error("Device storage is still loading.")
        await durableQueue.queue.retainGuestReview()
        await durableQueue.refresh()
      }
      if (startedIdentity !== currentIdentity.current || ticket !== epoch.current) return
      const sources = durableEnabled ? durableSources() : prepareLegacyQueueReview()
      sourcesAtReview.current = sources
      setEntries(reviewEntries(sources, actorId)); setSelectedBinder(""); setChoices({}); setDestination(null); setError(null); setOpen(true)
      if (actorId) void load()
    } catch { if (ticket === epoch.current && startedIdentity === currentIdentity.current) { setError("Could not retain the original data. Free some device storage before reviewing."); setOpen(true) } }
  }
  function download() {
    const originals = durableEnabled
      ? [...(durableQueue?.view()?.sources.flatMap(source => source.raw !== null ? [source.raw] : source.kind === "collection-mirror" ? [JSON.stringify(source.retainedValue)] : []) ?? []), ...(durableQueue?.view()?.entries.filter(entry => entry.state !== "completed").map(entry => JSON.stringify(entry)) ?? [])]
      : [...readLegacyQueueSources().map(source => source.legacyQueueSource.raw), ...blocked.flatMap(operation => { const raw = readPendingCollectionOperationRaw(operation.id); return raw ? [raw] : [] })]
    const sources = [...new Set(originals)].filter(raw => mayDownloadLegacyOriginal(raw, actorId))
    if (originals.some(raw => !mayDownloadLegacyOriginal(raw, actorId)))
      setError("Some original data could not be verified for this account and cannot be downloaded here. It remains on this device.")
    // LS exports retain exact strings; mirror and request exports contain structured evidence.
    for (const [index, raw] of sources.entries()) {
      const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }))
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `holo-folder-original-${index + 1}-${sourceDigest(raw).replace(":", "-")}.json`; anchor.click(); URL.revokeObjectURL(url)
    }
  }
  const selected = entries.filter(entry => entry.operation && choices[key(entry)])
  async function accept() {
    if (acceptanceLock.current || !destination?.collection || !selectedBinder || !queueAtReview || !selected.length) return
    const ticket = ++epoch.current, startedIdentity = currentIdentity.current
    const acceptanceToken = Symbol()
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
        return { ...op, base, origin: destination.recipient, binderId: selectedBinder, ...(op.type === "upsert" ? { importOnly: true as const } : {}), recoverySource: { digest: entry.source.legacyQueueSource.digest, ordinal: entry.ordinal, reviewEpoch } }
      })
      const sources = sourcesAtReview.current.map(source => ({ ...source, legacyQueueSource: { ...source.legacyQueueSource,
        accepted: [...(source.legacyQueueSource.accepted ?? []), ...selected.filter(entry => entry.source === source).map(entry => entry.ordinal)] } }))
      if (durableEnabled) {
        const review = durableReview.current
        if (!durableQueue || !review) throw new Error("Reload destination and review again.")
        acceptanceLock.current = acceptanceToken; setAccepting(true)
        await durableQueue.acceptReview(review, selected.map((entry, index) => {
          const projection = review.projections.find(source => source.legacyQueueSource.raw === entry.source.legacyQueueSource.raw)
          if (!projection) throw new Error("Original source changed.")
          const { recoverySource: _source, ...input } = operations[index]
          return { sourceId: projection.sourceId, ordinal: entry.ordinal, input }
        }))
        if (currentIdentity.current === startedIdentity) acceptedReview.current = review
        if (ticket !== epoch.current || currentIdentity.current !== startedIdentity) return
        window.dispatchEvent(new Event("holofolder-legacy-reviewed"))
      } else acceptLegacyQueueReview(queueAtReview, sources, operations)
      acceptedEpoch.current = reviewEpoch
      setError("Reviewed changes queued for this binder. Original data is retained. Cancelling cannot undo a request already sent.")
      setChoices({}); setEntries(reviewEntries(sources, actorId)); setQueueAtReview(null)
    } catch (e) { if (ticket === epoch.current && startedIdentity === currentIdentity.current) { setChoices({}); setQueueAtReview(null); setError(e instanceof Error ? e.message : "Upload could not start. Original data is retained.") } }
    finally {
      if (acceptanceLock.current === acceptanceToken) { acceptanceLock.current = null; setAccepting(false) }
      if (ticket === epoch.current) setBusy(false)
    }
  }
  async function cancelUpload() {
    if (acceptanceLock.current) return
    epoch.current++; setBusy(false)
    if (durableEnabled) {
      try { if (acceptedReview.current && durableQueue) await durableQueue.cancelReview(acceptedReview.current) }
      catch { setError("Could not save cancellation. Original requests remain retained; check the destination."); return }
    } else {
    const operations = readPendingCollectionOperations()
    writePendingCollectionOperations(operations.map(op => op.recoverySource && op.recoverySource.reviewEpoch === acceptedEpoch.current && sameCollectionOrigin(op.origin, destination?.recipient)
      ? { ...op, recipientPause: op.deliveryUnknown ? "delivery_unknown" : "cancelled_review_upload" } : op))
    }
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
        {accepting && <p role="status">Saving reviewed changes on this device. Cancellation becomes available when saving finishes.</p>}
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-border pt-3"><button className={`${button} bg-primary text-primary-foreground`} disabled={busy || accepting || !selected.length || !destination?.collection || !queueAtReview} onClick={() => void accept()}>Add {selected.length} reviewed changes to {destination?.binders.find(b => b.id === selectedBinder)?.name ?? "binder"}</button><button className={button} disabled={accepting} onClick={cancelUpload}>Cancel upload</button><button className={button} onClick={close}>Keep on this device</button></div>
      </div>
    </div>}
  </>
}
