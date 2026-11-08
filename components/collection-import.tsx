"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { CARD_LANGUAGES, CARD_FINISHES, type CollectedPokemon } from "@/lib/domain/cards"
import { useBillingContext } from "@/hooks/use-billing"
import { countSavedCards, FREE_CARD_LIMIT, pendingCardDelta } from "@/lib/billing"
import { pendingOperationBinderId, readPendingCollectionOperations } from "@/lib/collection/offline-queue"
import { normalizeCollectionItem } from "@/lib/collection/normalize"
import { appPath } from "@/lib/app-path"
import { readImportLookups } from "@/lib/collection-import-resolve"
import { IMPORT_FIELDS, IMPORT_MAX_BYTES, parseImportFile, mapImportRows, buildImportPlan, buildImportReport, applyImportPlan, type ImportDefaults, type ImportDocument, type ImportMapping, type ImportRow } from "@/lib/collection-import"

export interface CollectionImportProps {
  scopeKey: string
  collection: CollectedPokemon[]
  binderId?: string | null
  binderName?: string
  signedIn: boolean
  ready: boolean
  online: boolean
  onSave: (item: CollectedPokemon, expected: CollectedPokemon | null) => Promise<{ error?: string; queued?: boolean }>
}
const labels: Record<keyof ImportMapping, string> = { cardId: "Holo Folder / TCGdex catalogue ID", tcgplayerId: "TCGplayer product ID", cardName: "Card name", set: "Set name or ID", number: "Collector number", dex: "National Dex number", list: "Owned / wanted", language: "Language code", finish: "Finish code", quantity: "Quantity", condition: "Condition", grade: "Grade", productType: "Product type", status: "Slot status" }

export function CollectionImport({ collection, binderId, binderName, signedIn, ready, online, onSave }: CollectionImportProps) {
  const billing = useBillingContext()
  const [document, setDocument] = useState<ImportDocument | null>(null)
  const [filename, setFilename] = useState("")
  const [mapping, setMapping] = useState<ImportMapping>({})
  const [defaults, setDefaults] = useState<ImportDefaults>({ language: "en", finish: "normal", list: "owned" })
  const [resolved, setResolved] = useState<Record<number, { item?: CollectedPokemon; problem?: string }>>({})
  const [selection, setSelection] = useState<Set<number>>()
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState<"resolve" | "save" | null>(null)
  const [message, setMessage] = useState("")
  const [results, setResults] = useState<Array<ImportRow & { outcome: string; reason: string }> | null>(null)
  const [page, setPage] = useState(0)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { controller.current?.abort() }, [])
  const rows = useMemo(() => document ? mapImportRows(document, mapping, defaults).map(row => ({ ...row, ...resolved[row.row] })) : [], [document, mapping, defaults, resolved])
  const pending = readPendingCollectionOperations()
  const blocked = new Set(pending.filter(op => pendingOperationBinderId(op) === (binderId ?? null)).map(op => op.pokemonId))
  const plan = buildImportPlan(rows, collection, selection, blocked)
  const access = billing?.access
  const used = Math.max(countSavedCards(collection), (access?.savedCardCount ?? 0) + pendingCardDelta(pending))
  const limit = access ? (!access.enforced ? null : access.cardLimit) : signedIn ? 0 : FREE_CARD_LIMIT
  const overLimit = limit !== null && used + plan.delta > limit && plan.delta > 0
  const missing = rows.filter(row => !row.problem && !row.item)
  const resetPreview = () => { setResolved({}); setSelection(undefined); setResults(null); setAcknowledged(false); setPage(0); setMessage("") }
  const start = (kind: "resolve" | "save") => { controller.current?.abort(); const next = new AbortController(); controller.current = next; setBusy(kind); return next.signal }
  const chooseFile = async (file: File) => {
    controller.current?.abort()
    resetPreview(); setDocument(null); setFilename(file.name)
    const signal = start("resolve")
    try {
      if (file.size > IMPORT_MAX_BYTES) throw new Error("Maximum file size is 10 MiB.")
      const parsed = parseImportFile(await file.text())
      if (signal.aborted) return
      setDocument(parsed); setMapping(parsed.mapping)
    } catch (error) { if (!signal.aborted) setMessage(error instanceof Error ? error.message : "Could not read this file.") }
    finally { if (controller.current?.signal === signal) setBusy(null) }
  }
  const resolve = async () => {
    const signal = start("resolve")
    try {
      const updates: typeof resolved = {}
      // Repeat identities share one catalogue read, even if the source contains duplicate rows.
      const groups = new Map<string, ImportRow[]>()
      for (const row of missing) {
        try { readImportLookups({ lookups: [JSON.parse(JSON.stringify(row.lookup))] }) }
        catch (error) { updates[row.row] = { problem: error instanceof Error ? error.message : "Invalid mapping." }; continue }
        const key = JSON.stringify(row.lookup)
        const group = groups.get(key) ?? []; group.push(row); groups.set(key, group)
      }
      setResolved(previous => ({ ...previous, ...updates }))
      const entries = [...groups.values()]
      for (let i = 0; i < entries.length; i += 25) {
        if (signal.aborted) return
        const batch = entries.slice(i, i + 25)
        const response = await fetch(appPath("/api/collection-import/resolve"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lookups: batch.map(group => group[0].lookup) }), signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]), cache: "no-store" })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Catalogue resolution failed.")
        if (!Array.isArray(body.results) || body.results.length !== batch.length) throw new Error("Invalid catalogue response.")
        const batchUpdates: typeof resolved = {}
        batch.forEach((group, index) => {
          const result = body.results[index]
          if (!result || (!result.item && typeof result.problem !== "string")) throw new Error("Invalid catalogue result.")
          for (const row of group) batchUpdates[row.row] = result.item ? { item: normalizeCollectionItem(result.item) } : { problem: result.problem }
        })
        if (signal.aborted) return
        setResolved(previous => ({ ...previous, ...batchUpdates }))
        setMessage(`Resolved ${Math.min(i + 25, entries.length)} of ${entries.length} distinct card identities.`)
      }
    } catch (error) { if (!signal.aborted) setMessage(error instanceof Error ? error.message : "Catalogue unavailable. Nothing was imported.") }
    finally { if (controller.current?.signal === signal) setBusy(null) }
  }
  const apply = async () => {
    const signal = start("save")
    try {
      const progress = (result: { rows: Array<ImportRow & { outcome: string; reason: string }>; saved: number; queued: number; failed: number }) => { setResults(result.rows); setMessage(`${result.saved} saved, ${result.queued} queued on this device, ${result.failed} failed (Pokémon slots).`) }
      const result = await applyImportPlan(plan, onSave, signal, progress)
      progress(result)
      if (result.cancelled) setMessage(`Stopped: ${result.saved} saved, ${result.queued} queued, ${result.failed} failed. Remaining rows were not applied.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import stopped. Check the report before retrying.") }
    finally { if (controller.current?.signal === signal) setBusy(null) }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([buildImportReport(results ?? plan.rows)], { type: "text/csv;charset=utf-8" }))
    const link = window.document.createElement("a")
    link.href = url; link.download = "holofolder-import-report.csv"; window.document.body.appendChild(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return <section className="space-y-3 min-w-0 rounded-xl border p-3" aria-label="Import collection">
    <h3 className="font-medium text-sm">Import into {binderName || "this binder"}</h3>
    <p className="text-xs text-muted-foreground">Choose a CSV from any tracker, then map its columns. Holo Folder CSV and version 1 JSON backups work offline. JSON restores collection entries only, not settings or cover artwork. Maximum 10 MiB and 5,000 rows.</p>
    <label className="block text-sm">Collection file<input className="mt-1 block w-full min-w-0 min-h-10 text-sm file:mr-2 file:min-h-10 file:rounded-lg file:border file:px-3" type="file" accept=".csv,.json,text/csv,application/json" disabled={Boolean(busy) || !ready} onChange={event => { const file = event.target.files?.[0]; if (file) void chooseFile(file); event.target.value = "" }} /></label>
    {document && <>
      <p className="text-xs break-all">{filename}, {rows.length} source rows</p>
      {!document.trusted && <fieldset disabled={Boolean(busy)} className="space-y-2 min-w-0"><legend className="text-sm font-medium">Column mapping</legend>
        <p className="text-xs text-muted-foreground">Map an exact catalogue ID, a TCGplayer product ID, or all three: card name, set and collector number. Other tracker IDs need name, set and number. A National Dex number alone cannot identify a printing.</p>
        {IMPORT_FIELDS.filter(field => field !== "dex" && field !== "status").map(field => <label className="block text-xs" key={field}>{labels[field]}<select className="mt-1 w-full min-w-0 min-h-10 rounded-lg border bg-background px-2 text-sm" value={mapping[field] ?? ""} onChange={event => { resetPreview(); setMapping(previous => ({ ...previous, [field]: event.target.value === "" ? undefined : Number(event.target.value) })) }}><option value="">Not mapped</option>{document.headers.map((header, index) => <option key={index} value={index}>{header.slice(0, 60)}: {document.records.slice(0, 3).map(row => row[index] || "(empty)").join(" / ").slice(0, 90)}</option>)}</select></label>)}
        <div className="grid grid-cols-1 gap-2"><label className="text-xs">Default language<select className="block min-h-10 w-full rounded-lg border bg-background px-2 text-sm" value={defaults.language} onChange={event => { resetPreview(); setDefaults(value => ({ ...value, language: event.target.value as ImportDefaults["language"] })) }}>{CARD_LANGUAGES.map(value => <option key={value}>{value}</option>)}</select></label><label className="text-xs">Default finish<select className="block min-h-10 w-full rounded-lg border bg-background px-2 text-sm" value={defaults.finish} onChange={event => { resetPreview(); setDefaults(value => ({ ...value, finish: event.target.value as ImportDefaults["finish"] })) }}>{CARD_FINISHES.map(value => <option key={value}>{value}</option>)}</select></label><label className="text-xs">Default list<select className="block min-h-10 w-full rounded-lg border bg-background px-2 text-sm" value={defaults.list} onChange={event => { resetPreview(); setDefaults(value => ({ ...value, list: event.target.value as ImportDefaults["list"] })) }}><option value="owned">owned</option><option value="wanted">wanted</option></select></label></div>
        <Button variant="outline" className="min-h-10 w-full" disabled={!online || !missing.length} onClick={() => void resolve()}>Resolve catalogue matches</Button>
        {!online && <p className="text-xs">External CSV matching needs a connection.</p>}
      </fieldset>}
      <p className="text-xs">{plan.rows.filter(row => row.selected).length} selected, {plan.rows.filter(row => row.outcome === "duplicate").length} duplicates, {plan.rows.filter(row => row.outcome === "conflict" || row.outcome === "choice").length} conflicts / choices, {plan.rows.filter(row => row.outcome === "unsupported" || row.outcome === "unresolved").length} unsupported / unresolved.</p>
      <p className="text-xs">Saved entries: {used} → {used + plan.delta}{limit !== null ? ` / ${limit}` : " (unlimited)"}. Existing owned selections and unsynced edits are preserved.</p>
      {overLimit && <p role="status" className="text-xs">This selection exceeds your plan. Select fewer rows or upgrade before importing.</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" className="min-h-9" disabled={Boolean(busy)} onClick={() => { setSelection(undefined); setResults(null) }}>Select ready rows</Button><Button variant="outline" size="sm" className="min-h-9" disabled={Boolean(busy)} onClick={() => { setSelection(new Set()); setResults(null) }}>Select none</Button></div>
      <ol className="space-y-2" aria-label="Import preview">{plan.rows.slice(page * 25, page * 25 + 25).map(row => <li key={row.row} className="rounded-lg bg-muted/50 p-2 text-xs break-words"><label className="flex min-h-9 items-start gap-2"><input type="checkbox" className="mt-2 h-5 w-5 shrink-0" disabled={Boolean(busy) || (row.outcome !== "ready" && row.outcome !== "choice")} checked={row.selected} onChange={event => { const selected = new Set(selection ?? plan.rows.filter(r => r.selected).map(r => r.row)); if (event.target.checked) selected.add(row.row); else selected.delete(row.row); setSelection(selected); setResults(null) }} /><span className="min-w-0 py-1">Row {row.row}: {row.lookup.cardName || row.lookup.cardId || row.lookup.tcgplayerId || "Unidentified card"}, {row.lookup.set || "unknown set"}, {row.lookup.number || row.lookup.cardId || "no number"} ({row.lookup.language}, {row.lookup.finish}, {row.lookup.list})<br /><span className="text-muted-foreground">{row.reason}</span></span></label></li>)}</ol>
      {rows.length > 25 && <div className="flex items-center justify-between gap-2 text-xs"><Button variant="outline" size="sm" className="min-h-9" disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</Button><span>{page + 1} / {Math.ceil(rows.length / 25)}</span><Button variant="outline" size="sm" className="min-h-9" disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage(p => p + 1)}>Next</Button></div>}
      <label className="flex min-h-10 items-start gap-2 text-xs"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acknowledged} disabled={Boolean(busy)} onChange={event => setAcknowledged(event.target.checked)} /><span>I checked the mappings and defaults. Prices and unmapped fields are not imported. Extra quantities, condition, grades, sealed products and non-Pokémon cards cannot be stored in this Dex binder. Map those columns so affected rows can be reported.</span></label>
      <Button className="w-full min-h-10" disabled={!ready || Boolean(busy) || !acknowledged || !plan.operations.length || overLimit || (signedIn && !access)} onClick={() => void apply()}>Import selected entries into this binder</Button>
      <Button variant="outline" className="w-full min-h-10" onClick={download}>Download preview / import report</Button>
    </>}
    {busy && <Button variant="outline" className="min-h-10 w-full" onClick={() => { controller.current?.abort(); setMessage("Stopping after the current write. Completed writes remain saved or queued; review the report before retrying.") }}>Cancel {busy === "save" ? "remaining import" : "lookup"}</Button>}
    {message && <p role="status" className="text-xs break-words">{message}</p>}
    {results && <p className="text-xs text-muted-foreground">The report records saved, queued, skipped and unapplied source rows. Queued entries still need server conflict and plan checks. Reimporting the same printings does not duplicate them.</p>}
  </section>
}
