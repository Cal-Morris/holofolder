"use client"

import { useRef } from "react"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import type { InventoryBrowseRow, InventoryLocationIntent } from "@/lib/domain/inventory-browse"
import { inventoryGradingLabel } from "@/lib/inventory-query"
import { inventoryLocationLabel } from "@/lib/inventory-location"
import { formatCardFinishLabel, formatCardLanguageLabel } from "@/lib/card-labels"
import { InventoryCopyActions } from "./inventory-ownership"
import type { InventoryOwnershipBinding } from "@/lib/inventory-actions"
import styles from "./inventory.module.css"

export default function InventoryDetail({ row, cached, onClose, onOpenLocation, onEditGrading, ownership }: {
  ownership?: InventoryOwnershipBinding
  onEditGrading?: () => void
  row: InventoryBrowseRow; cached: boolean; onClose: () => void; onOpenLocation?: (intent: InventoryLocationIntent) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  return <div className={styles.overlay}>
    <div data-overlay-backdrop className={styles.backdrop} onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Owned copy details" className={styles.sheet} tabIndex={-1}>
      <header {...swipe} data-sheet-grabber className={styles.sheetHeader}>
        <h2>Owned copy</h2><button type="button" aria-label="Close copy details" onClick={onClose}><X size={20} /></button>
      </header>
      <div className={styles.sheetBody}>
        {row.location.kind === "assigned" && onOpenLocation && <button type="button" className={styles.openLocation}
          onClick={() => { if (row.location.kind === "assigned") onOpenLocation({ ...row.location.intent }) }}>Open location</button>}
        {ownership?.available && !cached && <InventoryCopyActions binding={ownership} itemId={row.itemId} onAccepted={onClose} />}
        {onEditGrading && row.cardId && <button type="button" className={styles.openLocation} onClick={onEditGrading}>Edit grading</button>}
        <h3>{row.name ?? (row.speciesNames.join(", ") || "Unknown card")}</h3>
        <p>{row.setName ?? "Set unknown"} · {row.number ? `#${row.number}` : "Number unknown"}</p>
        <p>{row.language ? formatCardLanguageLabel(row.language) : "Language unknown"} · {row.finish ? formatCardFinishLabel(row.finish) : "Finish unknown"}</p>
        <p>{inventoryGradingLabel(row)}</p>
        <p>{cached ? "Last saved: " : ""}{inventoryLocationLabel(row.location)}</p>
        <p className={styles.identifier}>Copy {row.itemId}</p>
      </div>
    </div>
  </div>
}
