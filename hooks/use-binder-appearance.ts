"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { defaultBinderDesign, normalizeBinderDesign, type BinderDesign } from "@/lib/binder-design"
import { readBinderDesign, saveBinderDesign, removeBinderDesign, type SavedBinderDesign } from "@/lib/binder-design-storage"
import { AppearanceConflict, fetchArtwork, fetchBinderAppearance, syncBinderAppearance } from "@/lib/binder-appearance-sync"
import type { BinderSettings } from "@/lib/settings"

interface Options { owner: string | null; settings: BinderSettings; enabled?: boolean; legacyKey?: string }
const eventName = "binderdex-appearance-updated"
export function useBinderAppearance({ owner, settings, enabled = true, legacyKey }: Options) {
  const initial = useMemo(() => defaultBinderDesign(settings), [settings])
  const defaults = useRef(initial)
  useEffect(() => { defaults.current = initial }, [initial])
  const [design, setDesign] = useState(initial)
  const [uploads, setUploads] = useState<Record<string, Blob>>({})
  const [artwork, setArtwork] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(enabled)
  const [loadedOwner, setLoadedOwner] = useState(owner)
  const [revision, setRevision] = useState(0)
  const [hasSavedDesign, setHasSavedDesign] = useState(false)
  const [message, setMessage] = useState("")
  const record = useRef<SavedBinderDesign | null>(null)
  const urls = useRef<Record<string, string>>({})
  const generation = useRef(0)
  const conflict = useRef(false)
  const serial = useRef<Promise<unknown>>(Promise.resolve())
  const key = owner ? `owner:${owner}` : "guest-demo"
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const run = () => navigator.locks ? navigator.locks.request(`binder-appearance:${key}`, operation) : operation()
    const next = serial.current.then(run, run)
    serial.current = next.catch(() => {})
    return next
  }, [key])
  const install = useCallback((next: SavedBinderDesign | null) => {
    record.current = next
    Object.values(urls.current).forEach(URL.revokeObjectURL)
    urls.current = Object.fromEntries(Object.entries(next?.uploads ?? {}).map(([id, blob]) => [id, URL.createObjectURL(blob)]))
    setDesign(next?.design ?? defaults.current)
    setUploads(next?.uploads ?? {})
    setArtwork(urls.current)
    setLoadedOwner(owner)
    setHasSavedDesign(Boolean(next))
    setRevision(next?.revision ?? 0)
  }, [owner])
  const refresh = useCallback(() => {
    const token = generation.current
    return enqueue(async () => {
    if (token !== generation.current || !enabled || !owner || conflict.current) return
    try {
      let next = record.current
      const cached = await readBinderDesign(key).catch(() => undefined)
      if (cached?.pending) next = cached
      else if (next?.pending && cached === null) { next = null; install(null) }
      if (next?.pending) {
        const remote = await syncBinderAppearance(owner, next)
        if (token !== generation.current) return
        next = { ...next, revision: remote.revision, pending: false }
        await saveBinderDesign(key, next.design, next.uploads, next)
        install(next)
        setMessage("Appearance synced.")
        return
      }
      const remote = await fetchBinderAppearance(owner)
      if (token !== generation.current) return
      if (remote.design && (!next || remote.revision !== next.revision)) {
        const blobs = await fetchArtwork(owner, remote.design)
        if (token !== generation.current) return
        next = { design: remote.design, uploads: blobs, revision: remote.revision, pending: false }
        install(next)
        try { await saveBinderDesign(key, next.design, next.uploads, next); setMessage("") }
        catch { setMessage("Appearance loaded. Device storage is unavailable, so it cannot be kept offline.") }
      } else if (!remote.design && next) {
        // Existing device-only appearances are imported only when the account has no saved appearance.
        next = { ...next, revision: 0, pending: true }
        await saveBinderDesign(key, next.design, next.uploads, next)
        record.current = next
        const saved = await syncBinderAppearance(owner, next)
        if (token !== generation.current) return
        next = { ...next, revision: saved.revision, pending: false }
        await saveBinderDesign(key, next.design, next.uploads, next)
        install(next)
        setMessage("Appearance synced.")
      } else if (remote.design && next) setMessage(current => current.startsWith("Saved ") || current === "Appearance synced." ? current : "")
    } catch (error) {
      if (token !== generation.current) return
      conflict.current = error instanceof AppearanceConflict
      setMessage(error instanceof Error ? error.message : "Appearance could not sync. Your device copy is safe.")
    } finally { if (token === generation.current) setLoading(false) }
  })}, [enabled, owner, key, enqueue, install])

  useEffect(() => {
    const token = ++generation.current
    conflict.current = false
    record.current = null
    void enqueue(async () => {
      if (token !== generation.current) return
      install(null)
      setLoading(enabled)
      setMessage("")
      if (!enabled) { setLoading(false); return }
      try {
        const cached = await readBinderDesign(key) ?? (legacyKey ? await readBinderDesign(legacyKey) : null)
        if (token !== generation.current) return
        install(cached)
        if (cached || !owner) setLoading(false)
      } catch { if (token === generation.current) { setLoading(false); setMessage("Device storage is unavailable. Your current draft is still here.") } }
    }).then(() => { if (token === generation.current) void refresh() })
    const online = () => void refresh()
    const visible = () => { if (!document.hidden) void refresh() }
    window.addEventListener("online", online)
    window.addEventListener(eventName, online)
    document.addEventListener("visibilitychange", visible)
    const timer = owner ? window.setInterval(visible, 30_000) : null
    return () => {
      generation.current = token + 1
      window.removeEventListener("online", online)
      window.removeEventListener(eventName, online)
      document.removeEventListener("visibilitychange", visible)
      if (timer) window.clearInterval(timer)
      Object.values(urls.current).forEach(URL.revokeObjectURL)
      urls.current = {}
    }
  }, [enabled, key, owner, legacyKey, enqueue, install, refresh])

  const save = useCallback((nextDesign: BinderDesign, nextUploads: Record<string, Blob>, baseRevision = record.current?.revision ?? 0) => {
    const token = generation.current
    return enqueue(async () => {
    if (token !== generation.current || !enabled) throw new Error("Your account changed. Reopen the binder before saving.")
    let next = { design: normalizeBinderDesign(nextDesign), uploads: nextUploads, revision: baseRevision, pending: Boolean(owner) }
    try {
      const cached = await readBinderDesign(key)
      if (cached?.pending && JSON.stringify(cached.design) !== JSON.stringify(record.current?.design) && JSON.stringify(cached.design) !== JSON.stringify(next.design)) throw new AppearanceConflict()
      await saveBinderDesign(key, next.design, next.uploads, next)
      if (token !== generation.current) throw new Error("Your account changed. Reopen the binder before saving.")
      install(next)
      if (!owner) { setMessage("Saved on this device. Sign in to sync appearances between devices."); return { synced: false, revision: next.revision } }
      if (!navigator.onLine) { setMessage("Saved on this device. Will sync when you’re online."); return { synced: false, revision: next.revision } }
      const remote = await syncBinderAppearance(owner, next)
      if (token !== generation.current) throw new Error("Your account changed. Reopen the binder before saving.")
      next = { ...next, revision: remote.revision, pending: false }
      record.current = next
      setRevision(next.revision)
      // The cloud commit has succeeded even if the device cache update fails.
      try { await saveBinderDesign(key, next.design, next.uploads, next) }
      catch { setMessage("Saved to your account. Device storage could not be updated."); return { synced: true, revision: next.revision } }
      conflict.current = false
      setMessage("Saved to your account. Available on your other devices.")
      window.dispatchEvent(new Event(eventName))
      return { synced: true, revision: next.revision }
    } catch (error) {
      if (token === generation.current) {
        conflict.current = error instanceof AppearanceConflict
        setMessage(error instanceof Error ? error.message : "Could not save. Your draft is still here.")
      }
      throw error
    }
  })}, [enabled, key, owner, enqueue, install])

  const loadLatest = useCallback(() => {
    const token = generation.current
    return enqueue(async () => {
    if (token !== generation.current || !owner || !enabled) return
    const cached = await readBinderDesign(key)
    if (cached?.pending && JSON.stringify(cached.design) !== JSON.stringify(record.current?.design)) throw new Error("Another tab has an unsynced appearance. Sync it before loading the account appearance.")
    const remote = await fetchBinderAppearance(owner)
    const next = remote.design ? { design: remote.design, uploads: await fetchArtwork(owner, remote.design), revision: remote.revision, pending: false } : null
    if (token !== generation.current) return
    if (next) await saveBinderDesign(key, next.design, next.uploads, next)
    else { await removeBinderDesign(key); if (legacyKey) await removeBinderDesign(legacyKey) }
    install(next)
    conflict.current = false
    setMessage("Latest account appearance loaded.")
    return next
  })}, [owner, enabled, key, legacyKey, enqueue, install])
  const available = enabled && loadedOwner === owner
  return { design: available && hasSavedDesign ? design : initial, uploads: available ? uploads : {}, artwork: available ? artwork : {}, loading, revision, hasSavedDesign: available && hasSavedDesign, message, save, refresh, loadLatest }
}
