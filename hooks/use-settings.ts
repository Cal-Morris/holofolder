"use client"

import { useState, useEffect, useCallback } from "react"
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
  initialSettings?: BinderSettings
  initialUser?: { id: string } | null
  settingsOwnerUserId?: string | null
  readOnly?: boolean
  hasRemoteSettings?: boolean
}

function getLocalSettingsKey(userId?: string | null) {
  return userId ? `pokemon_binder_settings:${userId}` : ANON_LOCAL_SETTINGS_KEY
}

function readStoredSettings(userId?: string | null) {
  if (typeof window === "undefined") {
    return null
  }

  const candidateKeys = userId
    ? [getLocalSettingsKey(userId), LEGACY_LOCAL_SETTINGS_KEY, ANON_LOCAL_SETTINGS_KEY]
    : [ANON_LOCAL_SETTINGS_KEY, LEGACY_LOCAL_SETTINGS_KEY]

  for (const key of candidateKeys) {
    try {
      const raw = localStorage.getItem(key)
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

function writeStoredSettings(nextSettings: BinderSettings, userId?: string | null) {
  if (typeof window === "undefined") {
    return
  }

  setItemMakingRoom(localStorage, getLocalSettingsKey(userId), JSON.stringify(nextSettings))
}

async function fetchRemoteSettings() {
  const response = await fetch("/app/api/settings", {
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
    initialSettings,
    initialUser = null,
    settingsOwnerUserId = null,
    readOnly = false,
    hasRemoteSettings = false,
  } = options
  const initialResolvedSettings = initialSettings ?? DEFAULT_SETTINGS
  const [settings, setSettings] = useState<BinderSettings>(initialResolvedSettings)
  const [user, setUser] = useState<{ id: string } | null>(initialUser)

  const supabase = createClient()

  useEffect(() => {
    if (readOnly) {
      return
    }

    const localSettings = readStoredSettings(settingsOwnerUserId ?? user?.id)

    if ((settingsOwnerUserId ?? user?.id) && hasRemoteSettings) {
      setSettings(initialResolvedSettings)
      writeStoredSettings(initialResolvedSettings, settingsOwnerUserId ?? user?.id)
      return
    }

    if (localSettings) {
      setSettings(normaliseSettings(localSettings, initialResolvedSettings))
      return
    }

    setSettings(initialResolvedSettings)
    writeStoredSettings(initialResolvedSettings, settingsOwnerUserId ?? user?.id)
  }, [hasRemoteSettings, initialResolvedSettings, readOnly, settingsOwnerUserId, user?.id])

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
        const remoteSettings = await fetchRemoteSettings()
        if (cancelled) {
          return
        }

        setSettings(remoteSettings)
        writeStoredSettings(remoteSettings, settingsOwnerUserId ?? user.id)
      } catch {
        // Keep the local cache if no persisted settings exist yet.
      }
    }

    void hydrateRemoteSettings()

    return () => {
      cancelled = true
    }
  }, [hasRemoteSettings, readOnly, settingsOwnerUserId, user?.id])

  const updateSettings = useCallback(async (newSettings: Partial<BinderSettings>) => {
    if (readOnly) {
      return
    }

    let updatedSettings = settings
    setSettings((current) => {
      updatedSettings = { ...current, ...newSettings }
      return updatedSettings
    })
    writeStoredSettings(updatedSettings, settingsOwnerUserId ?? user?.id)

    if (user) {
      try {
        const response = await fetch("/app/api/settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify(updatedSettings),
        })

        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string" && payload.error.length > 0
              ? payload.error
              : "Failed to save settings",
          )
        }
      } catch (error) {
        console.error(
          "[holofolder] Error saving settings:",
          error instanceof Error ? error.message : error,
        )
      }
    }
  }, [readOnly, settings, settingsOwnerUserId, user])

  return { settings, updateSettings }
}
