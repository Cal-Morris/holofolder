"use client"

import { useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { closeAllOverlays } from "@/hooks/use-overlay"
import type { NativePageScanAdmission } from "@/components/native-page-scanner"
import type { StorageMenuAction } from "@/components/collection-navigation/storage-menu"

const NativePageScanner = dynamic(() => import("@/components/native-page-scanner"), { ssr: false })
const QuickCardScanner = dynamic(() => import("@/components/quick-card-scanner"), { ssr: false })

/** Mounted inside the actual BinderApp; queue lifetime belongs to BrowserCollectionSession. Its actions live in the storage menu. */
export default function NativeBinderScanner({ admission, online, available, menu }: {
  admission: NativePageScanAdmission
  online: boolean
  available: boolean
  menu: (actions: StorageMenuAction[]) => ReactNode
}) {
  const [opened, setOpened] = useState<"page" | "card" | null>(null)
  const close = () => setOpened(null)
  const open = (kind: "page" | "card") => { closeAllOverlays(); setOpened(kind) }
  return <>
    {/* Disabled until storage is current, sync is idle and the saved grid matches. */}
    {menu([{ label: "Scan page", disabled: !available, onSelect: () => open("page") }, { label: "Scan card", disabled: !available, onSelect: () => open("card") }])}
    {opened === "page" && <NativePageScanner admission={admission} onClose={close} />}
    {opened === "card" && <QuickCardScanner nativeAdmission={admission} getOfflineCards={admission.getOfflineCards} isOnline={online} onClose={close}
      onResult={() => { /* Native admission owns review; no legacy species write. */ }} />}
  </>
}
