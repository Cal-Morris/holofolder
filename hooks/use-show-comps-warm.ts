"use client"

// React wrapper around the comps warm engine (lib/check-comps.ts) for buttons and Prepare: start/stop and
// live counters. Unmounting stops the run.
import { useCallback, useEffect, useRef, useState } from "react"
import { warmShowComps, type CheckCompsProgress, type CheckCompsTarget } from "@/lib/check-comps"

export function useShowCompsWarm() {
  const [progress, setProgress] = useState<CheckCompsProgress | null>(null)
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  const start = useCallback(async (input: { wanted: readonly CheckCompsTarget[]; hunt?: readonly CheckCompsTarget[] }) => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setRunning(true)
    try {
      return await warmShowComps(input, { signal: abort.signal, onProgress: next => { if (!abort.signal.aborted) setProgress(next) } })
    } finally {
      if (!abort.signal.aborted) setRunning(false)
    }
  }, [])
  const stop = useCallback(() => {
    controller.current?.abort()
    setRunning(false)
  }, [])

  return { start, stop, running, progress }
}
