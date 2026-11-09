"use client"

import { useLayoutEffect, useRef, useState } from "react"
import type { SlotCommandSink, SlotLocalAcceptance, StagedSlotCommandIntent } from "@/lib/binder-slot-editing"

/** The pending draft is immutable until accepted or this selection is dismissed. */
export function useSlotDraftAcceptance<T extends StagedSlotCommandIntent>(sink: SlotCommandSink, accepted: () => void) {
  const [pending, setPending] = useState<T | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const lock = useRef(false)
  const mounted = useRef(true)
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const handoff = (draft: T) => {
    if (lock.current) return
    lock.current = true
    setPending(draft); setBusy(true); setMessage(null)
    const finish = (receipt: SlotLocalAcceptance | void) => {
      if (receipt && (receipt.status !== "saved-on-device" || receipt.operationId !== draft.intent.request.operationId)) throw new Error("invalid-local-acceptance")
      if (!mounted.current) return
      setPending(null); setBusy(false); lock.current = false
      accepted()
      setMessage(receipt ? receipt.refreshError ?? "Saved on device · Pending sync" : null)
    }
    const failed = () => {
      if (!mounted.current) return
      lock.current = false; setBusy(false)
      setMessage("Could not save this draft on device. Free device storage if needed, then retry the same draft. Nothing is confirmed.")
    }
    try {
      const result = sink(draft)
      if (result) void result.then(finish).catch(failed)
      else finish()
    } catch { failed() }
  }
  return { pending, busy, message, handoff }
}
