"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"

export interface BinderSettings {
  binderRows: number
  binderCols: number
}

const LOCAL_SETTINGS_KEY = "pokemon_binder_settings"
const DEFAULT_SETTINGS: BinderSettings = { binderRows: 4, binderCols: 4 }

export function useSettings() {
  const [settings, setSettings] = useState<BinderSettings>(DEFAULT_SETTINGS)
  const [user, setUser] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    const loadUserAndSettings = async () => {
      setIsLoading(true)

      // Load from localStorage first for instant display
      try {
        const local = localStorage.getItem(LOCAL_SETTINGS_KEY)
        if (local) {
          const parsed = JSON.parse(local)
          setSettings({
            binderRows: parsed.binderRows || parsed.rows || 4,
            binderCols: parsed.binderCols || parsed.cols || 4,
          })
        }
      } catch {}

      // Check for user
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      setUser(currentUser)

      if (currentUser) {
        try {
          const { data } = await supabase
            .from("user_settings")
            .select("*")
            .eq("user_id", currentUser.id)
            .single()

          if (data) {
            const newSettings = {
              binderRows: data.binder_rows || 4,
              binderCols: data.binder_cols || 4,
            }
            setSettings(newSettings)
            localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(newSettings))
          }
        } catch {}
      }

      setIsLoading(false)
    }

    loadUserAndSettings()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
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
        console.error("Error saving settings:", err)
      }
    }
  }, [user, settings, supabase])

  return { settings, isLoading, updateSettings }
}
