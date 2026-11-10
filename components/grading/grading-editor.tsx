"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import type { SlotLocalAcceptance } from "@/lib/binder-slot-editing"
import type { GradingRecord, InventoryItem } from "@/lib/domain/inventory"
import type { InventoryItemRef } from "@/lib/domain/inventory-commands"
import { duplicateGradingCopies, emptyGradingRecord, gradingEditCommand, gradingReviewNotes } from "@/lib/grading/draft"
import type { GradingCommitResult, GradingEditCommand } from "@/lib/grading/draft"
import { GRADING_PROVIDERS, parseOfficialGradingUrl } from "@/lib/grading/provider-links"
import ProviderRecordLink from "./provider-record-link"
import styles from "./grading-editor.module.css"

export interface GradingEditorProps {
  item: InventoryItem
  itemRef: InventoryItemRef
  ownerEvidence: readonly InventoryItem[]
  onClose: () => void
  /** Local draft acceptance only, no claim of durable storage. */
  onAcceptDraft?: (command: GradingEditCommand) => void
  /** Resolve persisted only after the authoritative transaction commits, never after enqueue. */
  onCommit?: (command: GradingEditCommand) => Promise<GradingCommitResult>
  /** Close at durable device acceptance, with explicitly pending host status, never remote Saved. */
  onQueue?: (command: GradingEditCommand) => Promise<SlotLocalAcceptance>
}

/** Host must unmount on authenticated scope/evidence changes. Copy/version changes reset the draft. */
export default function GradingEditor(props: GradingEditorProps) {
  return <EditorSession key={`${props.item.ownerUserId}:${props.item.id}:${props.item.version}:${JSON.stringify(props.itemRef)}`} {...props} />
}

function EditorSession({ item, itemRef, ownerEvidence, onClose, onAcceptDraft, onCommit, onQueue }: GradingEditorProps) {
  const [record, setRecord] = useState<GradingRecord>(() => structuredClone(item.grading ?? emptyGradingRecord()))
  const [graded, setGraded] = useState(item.grading !== null)
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const submission = useRef<GradingEditCommand | null>(null)
  const [locked, setLocked] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const value = graded ? record : null
  const duplicates = duplicateGradingCopies(item, value, ownerEvidence)
  const textField = (label: string, key: "grade" | "scale" | "designation" | "certificate" | "holder") => <label className={styles.field}>{label}
    <input disabled={busy || locked} value={record[key] ?? ""} maxLength={500} autoCapitalize="none" autoCorrect="off"
      onChange={e => setRecord({ ...record, [key]: e.target.value === "" ? null : e.target.value })} /></label>
  const submit = async () => {
    if (pending.current) return
    setError("")
    try {
      const command = submission.current ?? gradingEditCommand(item, itemRef, value)
      if (onQueue) {
        submission.current = command; setLocked(true)
        pending.current = true; setBusy(true)
        const result = await onQueue(command)
        if (!mounted.current) return
        if (result.status !== "saved-on-device") throw new Error("Device acceptance was not confirmed. Retry the same edit.")
      } else if (onCommit) {
        pending.current = true; setBusy(true)
        const result = await onCommit(command)
        if (!mounted.current) return
        if (result.kind !== "persisted") { setError(result.kind === "rejected" ? result.message : "The edit was not confirmed persisted"); return }
      } else if (onAcceptDraft) onAcceptDraft(command)
      else throw new Error("No grading draft adapter is available")
      onClose()
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Could not accept grading") }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  return <div className={styles.overlay}>
    <div data-overlay-backdrop className={styles.backdrop} onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Edit copy grading" tabIndex={-1} className={styles.sheet}>
      <header {...swipe} data-sheet-grabber className={styles.header}><h2>Edit grading</h2>
        <button type="button" aria-label="Close grading editor" onClick={onClose}><X size={20} /></button></header>
      <div className={styles.actions}>
        <button type="button" disabled={busy || (!onQueue && !onCommit && !onAcceptDraft)} onClick={() => void submit()}>{busy ? "Saving…" : onQueue ? locked ? "Retry saving on device" : "Save on device" : onCommit ? "Save grading" : "Use grading draft"}</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
      <div className={styles.body}>
        <p>Copy {item.id}</p>
        <p className={styles.notice}>User-recorded details. Certificate and private labels are not published. Blank fields mean unknown.</p>
        <label className={styles.field}>Grading status<select disabled={busy || locked} value={graded ? "graded" : "raw"} onChange={e => setGraded(e.target.value === "graded")}>
          <option value="raw">Raw</option><option value="graded" disabled={item.identity.kind !== "card"}>Graded</option>
        </select></label>
        {!graded && <p>Raw removes grading from this copy only when accepted. Ownership and acquisition stay the same.</p>}
        {graded && <>
          <label className={styles.field}>Provider<select disabled={busy || locked} value={record.provider.kind === "known" ? record.provider.id : "custom"} onChange={e => {
            const id = e.target.value
            setRecord({ ...record, provider: id === "custom" ? { kind: "custom", name: "" } : { kind: "known", id: id as Extract<GradingRecord["provider"], { kind: "known" }>["id"] } })
          }}>{Object.entries(GRADING_PROVIDERS).map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}<option value="custom">Custom</option></select></label>
          {record.provider.kind === "custom" && <label className={styles.field}>Custom provider name<input disabled={busy || locked} value={record.provider.name} maxLength={500}
            onChange={e => setRecord({ ...record, provider: { kind: "custom", name: e.target.value } })} /></label>}
          <p className={styles.notice}>Changing provider keeps entered text. Review the grade, scale and label for that provider.</p>
          {textField("Recorded grade", "grade")}{textField("Scale / version", "scale")}{textField("Designation / qualifier", "designation")}
          {textField("Certificate number", "certificate")}{textField("Holder / version", "holder")}
          <label className={styles.field}>Label variant / custom style<input disabled={busy || locked} value={record.label.variant ?? ""} maxLength={500}
            onChange={e => setRecord({ ...record, label: { ...record.label, variant: e.target.value === "" ? null : e.target.value } })} /></label>
          <p className={styles.notice}>Record the actual label, including legacy versions. No artwork or Black Label / Pristine designation is inferred. Existing private asset references are retained.</p>
          {record.subgrades.map((subgrade, index) => <fieldset key={index}><legend>Subgrade {index + 1}</legend>
            {(["name", "grade"] as const).map(key => <label key={key} className={styles.field}>{key === "name" ? "Subgrade name" : "Subgrade value"}<input disabled={busy || locked} maxLength={500} value={subgrade[key]}
              onChange={e => setRecord({ ...record, subgrades: record.subgrades.map((s, i) => i === index ? { ...s, [key]: e.target.value } : s) })} /></label>)}
            <button type="button" disabled={busy || locked} onClick={() => setRecord({ ...record, subgrades: record.subgrades.filter((_, i) => i !== index) })}>Remove subgrade {index + 1}</button>
          </fieldset>)}
          <button type="button" disabled={busy || locked || record.subgrades.length >= 20} onClick={() => setRecord({ ...record, subgrades: [...record.subgrades, { name: "", grade: "" }] })}>Add subgrade</button>
          <label className={styles.field}>Official record URL<input disabled={busy || locked} type="url" value={url} onChange={e => setUrl(e.target.value)} /></label>
          <button type="button" disabled={busy || locked} onClick={() => {
            const parsed = parseOfficialGradingUrl(url)
            if (!parsed || record.provider.kind !== "known" || parsed.provider.kind !== "known" || parsed.provider.id !== record.provider.id) {
              setError("Use a supported official URL for the selected provider. Other providers use lookup and copy."); return
            }
            setRecord({ ...record, certificate: parsed.certificate }); setUrl(""); setError("")
          }}>Use certificate from URL</button>
          <p className={styles.notice}>Only verified PSA record paths are supported. URL parameters are discarded locally; nothing is fetched.</p>
          <ProviderRecordLink key={`${record.provider.kind}:${record.certificate}`} record={record} />
        </>}
        {gradingReviewNotes(value).map(note => <p key={note} className={styles.notice}>{note}</p>)}
        {duplicates.length > 0 && <p role="status">Possible duplicate provider and certificate in the current owner’s supplied inventory evidence. Copies stay separate. This is not a global authenticity check.</p>}
        {onQueue && <p role="status">Saved on device means pending sync, not saved remotely. Closing will not undo an accepted edit.</p>}
        {locked && !busy && <p role="status">Retry keeps the exact submitted draft. Close to discard an unaccepted draft.</p>}
        {busy && !onQueue && <p role="status">Waiting for persisted confirmation. Closing will not undo a submitted save.</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  </div>
}
