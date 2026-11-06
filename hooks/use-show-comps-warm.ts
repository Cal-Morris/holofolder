"use client"

// React wrapper around the comps warm engine (lib/check-comps.ts) for buttons and Prepare: start/stop and
// live counters, plus `refused` when the soft confirm gate declined a run (cancelled confirm).
// Unmounting stops the run.
import { useCallback, useEffect, useRef, useState } from "react"
import { warmShowComps, type CheckCompsProgress, type CheckCompsRefusal, type CheckCompsSpendEstimate, type CheckCompsTarget } from "@/lib/check-comps"

export function useShowCompsWarm() {
  const [progress, setProgress] = useState<CheckCompsProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [refused, setRefused] = useState<CheckCompsRefusal | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  const start = useCallback(async (
    input: { wanted: readonly CheckCompsTarget[]; hunt?: readonly CheckCompsTarget[] },
    options: { confirmSpend?: (estimate: CheckCompsSpendEstimate) => boolean | Promise<boolean> } = {},
  ) => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setRefused(null)
    setRunning(true)
    try {
      const outcome = await warmShowComps(input, { signal: abort.signal, confirmSpend: options.confirmSpend, onProgress: next => { if (!abort.signal.aborted) setProgress(next) } })
      if (!outcome.ok && !abort.signal.aborted) setRefused(outcome.refused)
      return outcome
    } finally {
      if (!abort.signal.aborted) setRunning(false)
    }
  }, [])
  const stop = useCallback(() => {
    controller.current?.abort()
    setRunning(false)
  }, [])

  return { start, stop, running, progress, refused }
}
