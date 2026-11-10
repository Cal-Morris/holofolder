"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { closeAllOverlays } from "@/hooks/use-overlay"
import type { NativePageScanAdmission } from "@/components/native-page-scanner"

const PageScanner = dynamic(() => import("@/components/page-scanner"), { ssr: false })
const QuickCardScanner = dynamic(() => import("@/components/quick-card-scanner"), { ssr: false })

/** Mounted inside the actual BinderApp; queue lifetime belongs to BrowserCollectionSession. */
export default function NativeBinderScanner({ admission, online, available }: {
  admission: NativePageScanAdmission
  online: boolean
  available: boolean
}) {
  const [opened, setOpened] = useState<"page" | "card" | null>(null)
  const hasSlots = admission.view.pageSlotIds.length > 0
  const close = () => setOpened(null)
  const open = (kind: "page" | "card") => { closeAllOverlays(); setOpened(kind) }
  return <>
    <div className="shrink-0 space-y-1 px-4 py-2">
      <div className="flex flex-wrap gap-2">
        <button className="min-h-9 rounded-lg border px-3 text-sm" disabled={!available || !hasSlots} onClick={() => open("page")}>Scan page</button>
        <button className="min-h-9 rounded-lg border px-3 text-sm" disabled={!available || !hasSlots} onClick={() => open("card")}>Scan card</button>
      </div>
      {!hasSlots ? <p role="status" className="text-xs text-muted-foreground">Add free slots in Edit layout before scanning. Append and assign from a scan is unavailable.</p>
        : !available && <p role="status" className="text-xs text-muted-foreground">Reconnect and refresh complete storage before scanning. Pending edits must finish syncing and the saved grid must match.</p>}
    </div>
    {opened === "page" && <PageScanner nativeAdmission={admission} onClose={close} />}
    {opened === "card" && <QuickCardScanner nativeAdmission={admission} getOfflineCards={admission.getOfflineCards} isOnline={online} onClose={close}
      onResult={() => { /* Native admission owns review; no legacy species write. */ }} />}
  </>
}
