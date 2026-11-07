import type { BinderSettings } from "@/lib/settings"

export function activeBinderEffects(settings: BinderSettings, visibility: { view: string; searchOpen: boolean; quickModeOpen: boolean }): BinderSettings {
  if (visibility.view === "binder" && !visibility.searchOpen && !visibility.quickModeOpen) return settings
  return { ...settings, binderSlotGlareEnabled: false, cardFinishEffectsEnabled: false }
}
