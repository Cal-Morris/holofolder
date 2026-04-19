"use client"

import { useEffect, useState } from "react"
import { X, Grid3X3, CloudUpload, Copy, Download, Link2, Loader2, Moon, Sun, Palette, Wifi, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { BinderSettings } from "@/hooks/use-settings"
import { BINDER_COLOR_PRESETS, type BinderColorId } from "@/lib/binder-colors"
import { buildBinderShareUrl } from "@/lib/binder-share"
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
  currentBinderPage: number
  totalBinderPages: number
  currentPageBinderColorId: BinderColorId
  onSetGlobalBinderColor: (binderColorId: BinderColorId) => void
  onSetCurrentPageBinderColor: (binderColorId: BinderColorId) => void
  onSetBinderColorForPageRange: (binderColorId: BinderColorId, endPage: number) => void
  onClearCurrentPageBinderColor: () => void
  isDarkMode: boolean
  onToggleDarkMode: () => void
  isSignedIn: boolean
  cloudCollectedCount: number
  localCollectedCount: number
  isSyncingLocalCollection: boolean
  localCollectionSyncMessage: string | null
  onSyncLocalCollectionToCloud: () => void
  isOnline: boolean
  isInstalledApp: boolean
  canInstallApp: boolean
  pwaStatusMessage: string | null
  onInstallApp: () => void
  isReadOnlyView: boolean
  sharePath: string | null
  isShareEnabled: boolean
  isShareLoading: boolean
  shareMessage: string | null
  onEnableReadOnlyShare: () => void
  onDisableReadOnlyShare: () => void
}

export default function SettingsModal({
  isOpen,
  onClose,
  user,
  settings,
  onUpdateSettings,
  currentBinderPage,
  totalBinderPages,
  currentPageBinderColorId,
  onSetGlobalBinderColor,
  onSetCurrentPageBinderColor,
  onSetBinderColorForPageRange,
  onClearCurrentPageBinderColor,
  isDarkMode,
  onToggleDarkMode,
  isSignedIn,
  cloudCollectedCount,
  localCollectedCount,
  isSyncingLocalCollection,
  localCollectionSyncMessage,
  onSyncLocalCollectionToCloud,
  isOnline,
  isInstalledApp,
  canInstallApp,
  pwaStatusMessage,
  onInstallApp,
  isReadOnlyView,
  sharePath,
  isShareEnabled,
  isShareLoading,
  shareMessage,
  onEnableReadOnlyShare,
  onDisableReadOnlyShare,
}: SettingsModalProps) {
  const [language, setLanguage] = useState<"en" | "ja">("en")
  const [selectedBinderColorId, setSelectedBinderColorId] = useState<BinderColorId>(currentPageBinderColorId)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [pageRangeInput, setPageRangeInput] = useState(String(currentBinderPage))

  useEffect(() => {
    if (isOpen) {
      setSelectedBinderColorId(currentPageBinderColorId)
      setPageRangeInput(String(currentBinderPage))
      setCopyMessage(null)
    }
  }, [currentBinderPage, currentPageBinderColorId, isOpen])

  if (!isOpen) return null

  const handleBinderSizeChange = (rows: number, cols: number) => {
    onUpdateSettings({ binderRows: rows, binderCols: cols })
  }

  const hasPageColorOverride = Boolean(settings.binderPageColors[String(currentBinderPage)])
  const fullShareUrl = sharePath && typeof window !== "undefined"
    ? buildBinderShareUrl(window.location.origin, sharePath.replace(/^\/share\//, ""))
    : sharePath

  const handleCopyShareLink = async () => {
    if (!fullShareUrl) return

    try {
      await navigator.clipboard.writeText(fullShareUrl)
      setCopyMessage("Share link copied.")
    } catch {
      setCopyMessage("Could not copy the share link.")
    }
  }
  const parsedPageRangeEnd = Number.parseInt(pageRangeInput, 10)
  const safePageRangeEnd = Number.isInteger(parsedPageRangeEnd)
    ? Math.min(Math.max(parsedPageRangeEnd, 1), totalBinderPages)
    : currentBinderPage

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+1rem)] bottom-[calc(env(safe-area-inset-bottom)+1rem)] mx-auto flex w-auto max-w-md flex-col overflow-hidden rounded-[2.25rem] border border-border/50 bg-card/95 shadow-2xl backdrop-blur-xl animate-slide-up sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(85vh,48rem)] sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-4 shrink-0">
          <h2 className="text-lg font-bold">Settings</h2>
          <button onClick={onClose} className="mr-0.5 rounded-full p-2 hover:bg-muted/70 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 sm:px-6 sm:py-6 space-y-6 overflow-y-auto flex-1">
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
                    disabled={isReadOnlyView}
                    className={`relative px-3 py-3 rounded-2xl text-sm font-medium border-2 transition-all ${
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
            {isReadOnlyView && (
              <p className="text-xs text-muted-foreground text-center">
                Shared binders keep the owner&apos;s saved layout.
              </p>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {isDarkMode ? <Moon className="w-4 h-4 text-primary" /> : <Sun className="w-4 h-4 text-primary" />}
              <h3 className="font-semibold">Appearance</h3>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-muted/35 px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Dark mode</p>
                <p className="text-xs text-muted-foreground">
                  BinderDex defaults to dark. Turn this off for the light theme.
                </p>
              </div>
              <Switch checked={isDarkMode} onCheckedChange={onToggleDarkMode} aria-label="Toggle dark mode" />
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-muted/35 px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Binder slot glare</p>
                <p className="text-xs text-muted-foreground">
                  Adds a pocket glare across the binder. Uses device motion when available, otherwise falls back to a static sheen.
                </p>
              </div>
              <Switch
                checked={settings.binderSlotGlareEnabled}
                onCheckedChange={(checked) => onUpdateSettings({ binderSlotGlareEnabled: checked })}
                aria-label="Toggle binder slot glare"
                disabled={isReadOnlyView}
              />
            </div>
            <div className="rounded-2xl border border-border/50 bg-muted/25 p-4">
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">Binder color</p>
                  <p className="text-xs text-muted-foreground">
                    Pick a default binder tone, or override only the current page.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {BINDER_COLOR_PRESETS.map((preset) => {
                  const isSelected = selectedBinderColorId === preset.id
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setSelectedBinderColorId(preset.id)}
                      disabled={isReadOnlyView}
                      className={`rounded-2xl border p-2 text-left transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 shadow-sm"
                          : "border-border/50 bg-background/45 hover:border-primary/40"
                      }`}
                    >
                      <div
                        className="h-10 rounded-xl"
                        style={{ background: `linear-gradient(135deg, ${preset.swatch[0]} 0%, ${preset.swatch[1]} 100%)` }}
                      />
                      <p className="mt-2 text-xs font-medium">{preset.label}</p>
                    </button>
                  )
                })}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button type="button" variant="outline" className="w-full" onClick={() => onSetGlobalBinderColor(selectedBinderColorId)} disabled={isReadOnlyView}>
                  Use for all pages
                </Button>
                <Button type="button" className="w-full" onClick={() => onSetCurrentPageBinderColor(selectedBinderColorId)} disabled={isReadOnlyView}>
                  Use for page {currentBinderPage}
                </Button>
              </div>
              <div className="mt-2 rounded-2xl border border-border/40 bg-background/45 p-3">
                <p className="text-xs font-medium">Apply to page range</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Set this color for pages 1 through a chosen end page.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="rounded-xl border border-border/40 bg-muted/35 px-3 py-2 text-sm font-medium text-muted-foreground">
                    1-
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={totalBinderPages}
                    inputMode="numeric"
                    value={pageRangeInput}
                    disabled={isReadOnlyView}
                    onChange={(event) => setPageRangeInput(event.target.value)}
                    onBlur={() => setPageRangeInput(String(safePageRangeEnd))}
                    className="h-10 w-20 rounded-xl border border-border/50 bg-background/80 px-3 text-sm font-medium tabular-nums"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={isReadOnlyView}
                    onClick={() => {
                      onSetBinderColorForPageRange(selectedBinderColorId, safePageRangeEnd)
                      setPageRangeInput(String(safePageRangeEnd))
                    }}
                  >
                    Use for pages 1-{safePageRangeEnd}
                  </Button>
                </div>
              </div>
              <div className="mt-3 rounded-2xl border border-border/40 bg-background/45 px-3 py-2.5">
                <p className="text-xs font-medium">
                  Default: {BINDER_COLOR_PRESETS.find((preset) => preset.id === settings.binderColorId)?.label ?? "Binder"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Page {currentBinderPage} is currently using {BINDER_COLOR_PRESETS.find((preset) => preset.id === currentPageBinderColorId)?.label ?? "the default color"}
                  {hasPageColorOverride ? " via a page override." : " from the global default."}
                </p>
                {hasPageColorOverride && (
                  <Button type="button" variant="ghost" className="mt-2 h-8 px-0 text-xs text-muted-foreground hover:text-foreground" onClick={onClearCurrentPageBinderColor} disabled={isReadOnlyView}>
                    Clear page {currentBinderPage} override
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border space-y-4">
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">App Mode</h3>
            </div>
            <div className="rounded-2xl border border-border/50 bg-muted/25 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{isInstalledApp ? "Installed app shell" : "Browser mode"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Install BinderDex to keep the shell, card images, and recent lookups cached for poor signal at shows.
                  </p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  isOnline
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-500"
                }`}>
                  {isOnline ? "Online" : "Offline"}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-border/40 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                {isOnline ? <Wifi className="h-3.5 w-3.5 text-emerald-500" /> : <WifiOff className="h-3.5 w-3.5 text-amber-500" />}
                <span>{isOnline ? "Live requests available." : "Using cached app data and assets where available."}</span>
              </div>
            </div>
            {!isInstalledApp && (
              <Button
                type="button"
                variant={canInstallApp ? "default" : "outline"}
                className="w-full gap-2"
                disabled={!canInstallApp}
                onClick={onInstallApp}
              >
                <Download className="w-4 h-4" />
                {canInstallApp ? "Install BinderDex" : "Use Add to Home Screen"}
              </Button>
            )}
            {!canInstallApp && !isInstalledApp && (
              <p className="text-xs text-muted-foreground">
                If your browser does not show an install prompt, use its share menu and choose Add to Home Screen.
              </p>
            )}
            {pwaStatusMessage && (
              <p className="text-xs text-primary">{pwaStatusMessage}</p>
            )}
          </div>

          {!isReadOnlyView && (
            <div className="pt-4 border-t border-border space-y-4">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-primary" />
                <h3 className="font-semibold">Read-Only Share Link</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Share a public binder link with prices enabled by default. Viewers can browse and filter, but they cannot collect, edit cards, or change your binder.
              </p>
              {isShareEnabled && fullShareUrl ? (
                <div className="space-y-3 rounded-2xl border border-border/50 bg-muted/25 p-3">
                  <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-2 text-xs text-muted-foreground break-all">
                    {fullShareUrl}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1 gap-2" onClick={handleCopyShareLink} disabled={isShareLoading}>
                      <Copy className="w-4 h-4" />
                      Copy link
                    </Button>
                    <Button type="button" variant="destructive" className="flex-1" onClick={onDisableReadOnlyShare} disabled={isShareLoading}>
                      Disable link
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" className="w-full gap-2" onClick={onEnableReadOnlyShare} disabled={!isSignedIn || isShareLoading}>
                  {isShareLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  Generate read-only share link
                </Button>
              )}
              {(copyMessage || shareMessage) && (
                <p className="text-xs text-primary">{copyMessage || shareMessage}</p>
              )}
              {!isSignedIn && (
                <p className="text-xs text-muted-foreground">
                  Sign in first to manage your public share link.
                </p>
              )}
            </div>
          )}

          {/* Language Settings */}
          <div className="space-y-4">
            <h3 className="font-semibold">Card Language</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setLanguage("en")}
                className={`flex-1 px-4 py-3 rounded-2xl text-sm font-medium border-2 transition-all ${
                  language === "en"
                    ? "bg-primary/10 text-primary border-primary"
                    : "bg-muted/50 border-border/50 hover:border-primary/50 text-muted-foreground"
                }`}
              >
                English
              </button>
              <button
                onClick={() => setLanguage("ja")}
                className={`flex-1 px-4 py-3 rounded-2xl text-sm font-medium border-2 transition-all ${
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
          {!isReadOnlyView && (
            <div className="pt-4 border-t border-border">
              <PasskeySettings user={user} />
            </div>
          )}

          {!isReadOnlyView && (
          <div className="pt-4 border-t border-border space-y-4">
            <div className="flex items-center gap-2">
              <CloudUpload className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Collection Sync</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-border/50 bg-muted/25 px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Cloud Binder
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums">{cloudCollectedCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Canonical collected total in your signed-in binder.
                </p>
              </div>
              <div className="rounded-2xl border border-border/50 bg-muted/25 px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Offline Cache
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums">{localCollectedCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Browser-local collected entries kept for offline recovery and manual sync-back.
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-border/40 bg-muted/20 px-3 py-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                These numbers do not need to match. The cloud binder is your live source of truth. The offline cache only matters if you collected cards on this device while offline and want to push that local state back up.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              disabled={!isSignedIn || isSyncingLocalCollection}
              onClick={onSyncLocalCollectionToCloud}
            >
              {isSyncingLocalCollection ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
              Replace cloud binder with offline cache
            </Button>
            <p className="text-xs text-muted-foreground">
              This overwrites the cloud binder total of {cloudCollectedCount} with the offline cache total of {localCollectedCount}. Cloud-only collected entries will be removed.
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
          )}

          {/* About */}
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground text-center">
              BinderDex helps you organize your Pokemon card collection by National Dex number.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
