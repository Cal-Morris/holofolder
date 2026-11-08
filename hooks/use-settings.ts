"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { setItemMakingRoom } from "@/lib/storage/make-room"
import { createClient } from "@/lib/supabase/client"
import {
  getDefaultBinderSettings,
  normalizeBinderSettings as normaliseSettings,
  type BinderSettings,
  type StoredBinderSettings,
} from "@/lib/settings"

export type { BinderSettings } from "@/lib/settings"

const LEGACY_LOCAL_SETTINGS_KEY = "pokemon_binder_settings"
const ANON_LOCAL_SETTINGS_KEY = "pokemon_binder_settings:anon"
const DEFAULT_SETTINGS: BinderSettings = getDefaultBinderSettings()

interface UseSettingsOptions {
  binderId?: string | null
  initialSettings?: BinderSettings
  initialUser?: { id: string } | null
  settingsOwnerUserId?: string | null
  readOnly?: boolean
  hasRemoteSettings?: boolean
}

function readStoredValue(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function removeStoredValue(key: string) {
  try { localStorage.removeItem(key) } catch { /* Storage may be blocked. */ }
}

function getLocalSettingsKey(userId?: string | null, binderId?: string | null) {
  const base = userId ? `pokemon_binder_settings:${userId}` : ANON_LOCAL_SETTINGS_KEY
  return binderId ? `${base}:binder:${binderId}` : base
}

function readStoredSettings(userId?: string | null, binderId?: string | null) {
  if (typeof window === "undefined") {
    return null
  }

  const candidateKeys = userId
    ? [getLocalSettingsKey(userId, binderId), LEGACY_LOCAL_SETTINGS_KEY, ANON_LOCAL_SETTINGS_KEY]
    : [ANON_LOCAL_SETTINGS_KEY, LEGACY_LOCAL_SETTINGS_KEY]

  for (const key of candidateKeys) {
    try {
      const raw = readStoredValue(key)
      if (!raw) {
        continue
      }

      const parsed = JSON.parse(raw) as StoredBinderSettings
      return normaliseSettings(parsed, DEFAULT_SETTINGS)
    } catch {
      // Ignore malformed local caches and continue to the next candidate.
    }
  }

  return null
}

function writeStoredSettings(nextSettings: BinderSettings, userId?: string | null, binderId?: string | null) {
  if (typeof window === "undefined") {
    return
  }

  try { setItemMakingRoom(localStorage, getLocalSettingsKey(userId, binderId), JSON.stringify(nextSettings)) }
  catch { /* Online saves can still succeed with device storage blocked. */ }
}

async function fetchRemoteSettings(binderId?: string | null) {
  const response = await fetch(`/app/api/settings${binderId ? `?binderId=${binderId}` : ""}`, {
    cache: "no-store",
    credentials: "same-origin",
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string" && payload.error.length > 0
        ? payload.error
        : "Failed to load settings",
    )
  }

  return normaliseSettings(payload?.settings, DEFAULT_SETTINGS)
}

export function useSettings(options: UseSettingsOptions = {}) {
  const {
    binderId = null,
    initialSettings,
    initialUser = null,
    settingsOwnerUserId = null,
    readOnly = false,
    hasRemoteSettings = false,
  } = options
  const initialResolvedSettings = initialSettings ?? DEFAULT_SETTINGS
  const [settings, setSettingsState] = useState<BinderSettings>(initialResolvedSettings)
  const settingsRef = useRef(initialResolvedSettings)
  const setSettings = useCallback((next: BinderSettings) => {
    settingsRef.current = next
    setSettingsState(next)
  }, [])
  const [user, setUser] = useState<{ id: string } | null>(initialUser)

  const supabase = createClient()

  useEffect(() => {
    if (readOnly) {
      return
    }

    const localSettings = readStoredSettings(settingsOwnerUserId ?? user?.id, binderId)

    const pending = readStoredValue(`${getLocalSettingsKey(settingsOwnerUserId ?? user?.id, binderId)}:pending`)
    if (pending && localSettings) { setSettings(localSettings); return }
    if ((settingsOwnerUserId ?? user?.id) && hasRemoteSettings) {
      setSettings(initialResolvedSettings)
      writeStoredSettings(initialResolvedSettings, settingsOwnerUserId ?? user?.id, binderId)
      return
    }

    if (localSettings) {
      setSettings(normaliseSettings(localSettings, initialResolvedSettings))
      return
    }

    setSettings(initialResolvedSettings)
    writeStoredSettings(initialResolvedSettings, settingsOwnerUserId ?? user?.id, binderId)
  }, [binderId, hasRemoteSettings, initialResolvedSettings, readOnly, setSettings, settingsOwnerUserId, user?.id])

  useEffect(() => {
    if (readOnly) {
      return
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser((currentUser) => currentUser?.id === nextUser?.id ? currentUser : nextUser ? { id: nextUser.id } : null)
    })

    return () => subscription.unsubscribe()
  }, [readOnly, supabase])

  useEffect(() => {
    if (readOnly || !user?.id || hasRemoteSettings) {
      return
    }

    let cancelled = false

    const hydrateRemoteSettings = async () => {
      try {
        const remoteSettings = await fetchRemoteSettings(binderId)
        if (cancelled) {
          return
        }

        if (readStoredValue(`${getLocalSettingsKey(settingsOwnerUserId ?? user.id, binderId)}:pending`)) return
        setSettings(remoteSettings)
        writeStoredSettings(remoteSettings, settingsOwnerUserId ?? user.id, binderId)
      } catch {
        // Keep the local cache if no persisted settings exist yet.
      }
    }

    void hydrateRemoteSettings()

    return () => {
      cancelled = true
    }
  }, [binderId, hasRemoteSettings, readOnly, setSettings, settingsOwnerUserId, user?.id])

  const pendingSaves = useRef<Promise<unknown>>(Promise.resolve())
  const saveRemote = useCallback((updatedSettings: BinderSettings) => {
    const save = async () => {
      const pendingKey = `${getLocalSettingsKey(settingsOwnerUserId ?? user?.id, binderId)}:pending`
      const snapshot = JSON.stringify(updatedSettings)
      if (JSON.stringify(settingsRef.current) !== snapshot) return
      const response = await fetch("/app/api/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ ...updatedSettings, binderId }), signal: AbortSignal.timeout(10000),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && readStoredValue(pendingKey) === snapshot) removeStoredValue(pendingKey)
        throw new Error(payload?.error ?? "Failed to save settings")
      }
      // A newer edit may have been queued while this request was in flight.
      if (readStoredValue(pendingKey) === snapshot) removeStoredValue(pendingKey)
    }
    const next = pendingSaves.current.then(save, save)
    pendingSaves.current = next.catch(() => {})
    return next
  }, [binderId, settingsOwnerUserId, user?.id])

  useEffect(() => {
    if (readOnly || !user) return
    const retry = () => {
      const raw = readStoredValue(`${getLocalSettingsKey(settingsOwnerUserId ?? user.id, binderId)}:pending`)
      if (raw && navigator.onLine) {
        try {
          void saveRemote(normaliseSettings(JSON.parse(raw), initialResolvedSettings)).catch(async () => {
            if (readStoredValue(`${getLocalSettingsKey(settingsOwnerUserId ?? user.id, binderId)}:pending`)) return
            try {
              const remote = await fetchRemoteSettings(binderId)
              setSettings(remote)
              writeStoredSettings(remote, settingsOwnerUserId ?? user.id, binderId)
            } catch { /* Keep the last device copy if the server cannot be reached. */ }
          })
        }
        catch { /* Leave a malformed device entry untouched. */ }
      }
    }
    retry()
    window.addEventListener("online", retry)
    return () => window.removeEventListener("online", retry)
  }, [binderId, initialResolvedSettings, readOnly, saveRemote, setSettings, settingsOwnerUserId, user])

  const updateSettings = useCallback(async (newSettings: Partial<BinderSettings>) => {
    if (readOnly) return
    const previous = settingsRef.current
    const updatedSettings = { ...previous, ...newSettings }
    setSettings(updatedSettings)
    writeStoredSettings(updatedSettings, settingsOwnerUserId ?? user?.id, binderId)
    if (!user) return
    const pendingKey = `${getLocalSettingsKey(settingsOwnerUserId ?? user.id, binderId)}:pending`
    let queued = false
    try { setItemMakingRoom(localStorage, pendingKey, JSON.stringify(updatedSettings)); queued = true } catch { /* Try the cloud when storage is blocked. */ }
    if (!navigator.onLine) {
      if (queued) return
      setSettings(previous)
      if (newSettings.binderRows !== undefined || newSettings.binderCols !== undefined) throw new Error("Device storage is unavailable. Connect to the internet before changing the layout.")
      return
    }
    try { await saveRemote(updatedSettings) }
    catch (error) {
      // Rejected writes roll back; network failures keep the device copy for reconnect.
      if (!readStoredValue(pendingKey) && settingsRef.current === updatedSettings) {
        setSettings(previous)
        writeStoredSettings(previous, settingsOwnerUserId ?? user.id, binderId)
      }
      if (newSettings.binderRows !== undefined || newSettings.binderCols !== undefined) throw error
      console.error("[holofolder] Error saving settings:", error instanceof Error ? error.message : error)
    }
  }, [binderId, readOnly, saveRemote, setSettings, settingsOwnerUserId, user])

  return { settings, updateSettings }
}
