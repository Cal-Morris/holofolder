"use client"

import { createContext, useCallback, useContext, type ReactNode } from "react"
import { GoogleAnalytics } from "@next/third-parties/google"
import { sendGoogleEvent, type GoogleEvents } from "@/lib/google-analytics"

const AnalyticsEnabled = createContext(false)

export function GoogleAnalyticsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <AnalyticsEnabled.Provider value={enabled}>
    {enabled && <GoogleAnalytics gaId="G-3Z12777BKD" />}
    {children}
  </AnalyticsEnabled.Provider>
}

export function useGoogleAnalytics() {
  const enabled = useContext(AnalyticsEnabled)
  return useCallback(<K extends keyof GoogleEvents>(name: K, parameters: GoogleEvents[K]) => {
    sendGoogleEvent(enabled, name, parameters)
  }, [enabled])
}
