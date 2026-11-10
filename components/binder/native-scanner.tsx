"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { BookOpen, ScanLine } from "lucide-react"
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
  const close = () => setOpened(null)
  const open = (kind: "page" | "card") => { closeAllOverlays(); setOpened(kind) }
  return <>
    {/* Disabled until storage is current, sync is idle and the saved grid matches. */}
    <button type="button" aria-label="Scan page" title={available ? "Scan page" : "Reconnect and refresh storage to scan"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 disabled:opacity-40" disabled={!available} onClick={() => open("page")}><BookOpen className="h-4 w-4" aria-hidden /></button>
    <button type="button" aria-label="Scan card" title={available ? "Scan card" : "Reconnect and refresh storage to scan"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 disabled:opacity-40" disabled={!available} onClick={() => open("card")}><ScanLine className="h-4 w-4" aria-hidden /></button>
    {opened === "page" && <PageScanner nativeAdmission={admission} onClose={close} />}
    {opened === "card" && <QuickCardScanner nativeAdmission={admission} getOfflineCards={admission.getOfflineCards} isOnline={online} onClose={close}
      onResult={() => { /* Native admission owns review; no legacy species write. */ }} />}
  </>
}
