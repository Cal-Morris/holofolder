"use client"

import { useState } from "react"
import { X, Grid3X3, CloudUpload, Loader2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { BinderSettings } from "@/hooks/use-settings"
import PasskeySettings from "./passkey-settings"
import type { User } from "@supabase/supabase-js"

const BINDER_SIZES = [
  { rows: 1, cols: 1, label: "1x1" },
  { rows: 2, cols: 2, label: "2x2" },
  { rows: 3, cols: 3, label: "3x3" },
  { rows: 3, cols: 4, label: "3x4" },
  { rows: 4, cols: 3, label: "4x3" },
  { rows: 4, cols: 4, label: "4x4" },
]

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  user: User | null
  settings: BinderSettings
  onUpdateSettings: (settings: Partial<BinderSettings>) => void
  isSignedIn: boolean
  localCollectedCount: number
  isSyncingLocalCollection: boolean
  localCollectionSyncMessage: string | null
  onSyncLocalCollectionToCloud: () => void
}

export default function SettingsModal({
  isOpen,
  onClose,
  user,
  settings,
  onUpdateSettings,
  isSignedIn,
  localCollectedCount,
  isSyncingLocalCollection,
  localCollectionSyncMessage,
  onSyncLocalCollectionToCloud,
}: SettingsModalProps) {
  const [language, setLanguage] = useState<"en" | "ja">("en")

  if (!isOpen) return null

  const handleBinderSizeChange = (rows: number, cols: number) => {
    onUpdateSettings({ binderRows: rows, binderCols: cols })
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <Card 
        className="relative bg-card max-w-md w-full border border-border shadow-2xl max-h-[85vh] overflow-hidden flex flex-col animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Binder Size */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Grid3X3 className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Binder Layout</h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {BINDER_SIZES.map((size) => {
                const isSelected = settings.binderRows === size.rows && settings.binderCols === size.cols
                return (
                  <button
                    key={size.label}
                    onClick={() => handleBinderSizeChange(size.rows, size.cols)}
                    className={`relative px-3 py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                      isSelected
                        ? "bg-primary/10 text-primary border-primary"
                        : "bg-muted/50 border-border/50 hover:border-primary/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="text-lg font-bold">{size.label}</span>
                    <span className="block text-[10px] opacity-70">{size.rows * size.cols} slots</span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Current: {settings.binderRows} x {settings.binderCols} = {settings.binderRows * settings.binderCols} cards per page
            </p>
          </div>

          {/* Language Settings */}
          <div className="space-y-4">
            <h3 className="font-semibold">Card Language</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setLanguage("en")}
                className={`flex-1 px-4 py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                  language === "en"
                    ? "bg-primary/10 text-primary border-primary"
                    : "bg-muted/50 border-border/50 hover:border-primary/50 text-muted-foreground"
                }`}
              >
                English
              </button>
              <button
                onClick={() => setLanguage("ja")}
                className={`flex-1 px-4 py-3 rounded-xl text-sm font-medium border-2 transition-all ${
                  language === "ja"
                    ? "bg-primary/10 text-primary border-primary"
                    : "bg-muted/50 border-border/50 hover:border-primary/50 text-muted-foreground"
                }`}
              >
                Japanese
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sets the language for card images when selecting specific cards
            </p>
          </div>

          {/* Passkey Settings */}
          <div className="pt-4 border-t border-border">
            <PasskeySettings user={user} />
          </div>

          <div className="pt-4 border-t border-border space-y-4">
            <div className="flex items-center gap-2">
              <CloudUpload className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Collection Sync</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Local collected cards on this device: {localCollectedCount}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              disabled={!isSignedIn || isSyncingLocalCollection}
              onClick={onSyncLocalCollectionToCloud}
            >
              {isSyncingLocalCollection ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
              Replace cloud collection with local
            </Button>
            <p className="text-xs text-muted-foreground">
              This removes cloud-only collected entries and keeps the local collected state from this device as the source of truth.
            </p>
            {localCollectionSyncMessage && (
              <p className="text-xs text-primary">
                {localCollectionSyncMessage}
              </p>
            )}
            {!isSignedIn && (
              <p className="text-xs text-muted-foreground">
                Sign in first to push the local collection to Supabase.
              </p>
            )}
          </div>

          {/* About */}
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground text-center">
              BinderDex helps you organize your Pokemon card collection by National Dex number.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
