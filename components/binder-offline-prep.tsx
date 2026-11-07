"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CollectedPokemon } from "@/lib/domain/cards"
import { binderPrintings, BINDER_IMAGE_CACHE, downloadBinderPrep, inspectBinderPrep, type BinderPrepScope, type BinderPrepStatus } from "@/lib/binder-offline-prep"
import { getOfflineStore } from "@/lib/offline-store/kv"
import { flushCollectionMirror } from "@/lib/offline-store/collection-mirror"
import { loadPriceEvidence, saveCardPricesForOffline } from "@/hooks/use-card-prices"
import { requestPersistentStorage } from "@/lib/service-worker-registration"
import { formatPriceCheckAge } from "@/lib/card-price-check-cache"

export interface BinderOfflineSource { collection: readonly CollectedPokemon[]; scope: BinderPrepScope }

export default function BinderOfflinePrep({ collection, scope, isOnline }: BinderOfflineSource & { isOnline: boolean }) {
  const cards = useMemo(() => binderPrintings(collection), [collection])
  const [status, setStatus] = useState<BinderPrepStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("Checking saved binder…")
  const controller = useRef<AbortController | null>(null)
  const { ownerUserId, binderId, isDefault } = scope
  const stableScope = useMemo(() => ({ ownerUserId, binderId, isDefault }), [ownerUserId, binderId, isDefault])
  const dependencies = async () => {
    const store = getOfflineStore()
    if (!store || !window.caches) throw new Error("Offline storage is unavailable on this device.")
    return { store, shellReady: Boolean(await caches.match("/app/app-shell")), cache: await caches.open(BINDER_IMAGE_CACHE), loadPrices: loadPriceEvidence }
  }
  const inspect = useCallback(async () => {
    await flushCollectionMirror()
    return inspectBinderPrep(cards, stableScope, await dependencies())
  }, [cards, stableScope])
  useEffect(() => {
    let active = true
    void inspect().then(result => { if (active) { setStatus(result); setMessage("Saved data verified on this device.") } }, () => { if (active) setMessage("Couldn't verify offline storage. Try again.") })
    return () => { active = false; controller.current?.abort() }
  }, [inspect])

  const download = async () => {
    if (busy || !isOnline) return
    if (!navigator.serviceWorker?.controller) { setMessage("Offline storage isn't active yet. Reload once, then try again."); return }
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    void requestPersistentStorage()
    try {
      setMessage("Saving card data…")
      await flushCollectionMirror()
      const result = await downloadBinderPrep(cards, stableScope, { ...await dependencies(), signal: abort.signal,
        savePrices: saveCardPricesForOffline,
        onProgress: (phase, done, total) => setMessage(`${phase === "prices" ? "Prices (batches of up to 25)" : phase}: ${done}/${total}`),
      })
      setStatus(result)
      setMessage(result.failedDownloads ? `${result.failedDownloads} downloads failed after retries. Resume keeps completed downloads.` : result.complete ? "Download verified." : "Download finished with missing evidence. Retry reuses saved images and checks for newer saved prices.")
    } catch (error) {
      setMessage(abort.signal.aborted ? "Stopped. Saved data stays on this device. Resume reuses downloaded images." : error instanceof Error ? error.message : "Download failed. Retry to resume.")
      setStatus(await inspect().catch(() => null))
    } finally { setBusy(false) }
  }
  return <section aria-label="Prepare this binder" className="space-y-3 rounded-2xl border border-border p-3">
    <h3 className="font-semibold">Prepare this binder</h3>
    <p className="text-xs text-muted-foreground">All {cards.length} owned and wanted printings in this binder, including images, saved finish prices, price history and saved eBay asking and sold evidence. No paid refresh.</p>
    <div className="flex flex-wrap gap-2">
      {busy ? <button type="button" onClick={() => controller.current?.abort()} className="min-h-10 rounded-xl border px-3 text-sm">Stop</button>
        : <button type="button" disabled={!isOnline || !cards.length} onClick={() => void download()} className="min-h-10 rounded-xl bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50">{status && status.images > 0 ? "Resume / retry download" : "Download binder"}</button>}
      <button type="button" disabled={busy} onClick={() => void inspect().then(setStatus, () => setMessage("Couldn't verify saved data."))} className="min-h-10 rounded-xl border px-3 text-sm">Verify saved data</button>
    </div>
    <p role="status" className="text-xs">{message}</p>
    {!isOnline && <p className="text-xs">Offline. Saved evidence is usable; connect to download missing data.</p>}
    {status && <div className="space-y-1 text-xs" aria-label="Binder download coverage">
      {!status.shell && <p>Offline app shell is missing. Reload online before relying on offline access.</p>}
      <p className="font-semibold">{status.complete ? "All printing evidence saved" : "Partial coverage, not fully ready"}</p>
      <p>Cards {status.cards}/{status.total} · Images {status.images}/{status.total} · Finish prices {status.prices}/{status.total}</p>
      <p>Asking {status.asking}/{status.total} · Sold {status.sold}/{status.total} printings</p>
      <p>{status.askingRecords} asking records · {status.soldRecords} sold records saved</p>
      {status.oldestCheck && <p>Oldest saved check: {formatPriceCheckAge(status.oldestCheck)}. Prices are last known, not live.</p>}
      {status.unsupported > 0 && <p>{status.unsupported} printings do not support comparisons (non-English or jumbo). Their card data and images are still included.</p>}
    </div>}
    <p className="text-xs text-muted-foreground">Download size unknown. Coverage counts printings, with shared files downloaded once. Missing images, exact finish quotes or sold records remain missing. Use the manual Check owned / Check wanted actions online to request fresh comparisons.</p>
    <p className="text-xs text-muted-foreground">Browser storage can be cleared or evicted. Verify here after reopening offline before relying on this device.</p>
  </section>
}
