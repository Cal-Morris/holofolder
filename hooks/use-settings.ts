"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"

export interface BinderSettings {
  binderRows: number
  binderCols: number
}

const LOCAL_SETTINGS_KEY = "pokemon_binder_settings"
const DEFAULT_SETTINGS: BinderSettings = { binderRows: 4, binderCols: 4 }

interface UseSettingsOptions {
  initialSettings?: BinderSettings
  initialUser?: { id: string } | null
}

export function useSettings(options: UseSettingsOptions = {}) {
  const { initialSettings, initialUser = null } = options
  const [settings, setSettings] = useState<BinderSettings>(initialSettings ?? DEFAULT_SETTINGS)
  const [user, setUser] = useState<{ id: string } | null>(initialUser)

  const supabase = createClient()

  // Prefer localStorage on first paint for users who aren't signed in.
  useEffect(() => {
    if (initialSettings) return

    try {
      const local = localStorage.getItem(LOCAL_SETTINGS_KEY)
      if (local) {
        const parsed = JSON.parse(local)
        setSettings({
          binderRows: parsed.binderRows || parsed.rows || DEFAULT_SETTINGS.binderRows,
          binderCols: parsed.binderCols || parsed.cols || DEFAULT_SETTINGS.binderCols,
        })
      }
    } catch {
      // ignore
    }
  }, [initialSettings])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser ? { id: nextUser.id } : null)
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  const updateSettings = useCallback(async (newSettings: Partial<BinderSettings>) => {
    const updated = { ...settings, ...newSettings }
    setSettings(updated)
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(updated))

    if (user) {
      try {
        const { data: existing } = await supabase
          .from("user_settings")
          .select("id")
          .eq("user_id", user.id)
          .single()

        if (existing) {
          await supabase
            .from("user_settings")
            .update({
              binder_rows: updated.binderRows,
              binder_cols: updated.binderCols,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", user.id)
        } else {
          await supabase.from("user_settings").insert({
            user_id: user.id,
            binder_rows: updated.binderRows,
            binder_cols: updated.binderCols,
          })
        }
      } catch (err) {
        console.error("[binderdex] Error saving settings:", err)
      }
    }
  }, [user, settings, supabase])

  return { settings, updateSettings }
}
