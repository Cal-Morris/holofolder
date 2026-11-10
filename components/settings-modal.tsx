"use client"

import dynamic from "next/dynamic"

import { BinderLayoutSettings } from "@/components/binder-layout-settings"
import { OverlayLink } from "@/components/overlay-link"
import { CollectionImport, type CollectionImportProps } from "@/components/collection-import"
import { BillingSettings } from "@/components/billing-settings"
import { AccountPasskeys } from "@/components/account-passkeys"
import { AccountIdentitySettings } from "@/components/account-identity-settings"
import { PartnerPushSettings } from "@/components/partner-push-settings"
import { useEffect, useRef, useState } from "react"
import { CardDataAttribution } from "@/components/card-data-attribution"
import { PublicNameSettings } from "@/components/public-name-settings"
import { PricingPreferencesSettings } from "@/components/pricing-preferences-settings"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { useShowMode } from "@/hooks/use-show-mode"
import { DealThresholdSettings, ShowTallySettings } from "@/components/deal-settings"
import { X, Grid3X3, CloudUpload, Copy, Download, Link2, Loader2, Moon, Sun, Palette, Wifi, WifiOff, RefreshCw, Smartphone, Ticket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { BinderSettings } from "@/hooks/use-settings"
import { BINDER_COLOR_PRESETS, type BinderColorId } from "@/lib/binder-colors"
import { buildBinderShareUrl } from "@/lib/binder-share"
import type { User } from "@supabase/supabase-js"


const DeveloperSettings = dynamic(() => import("@/components/developer-settings"), { loading: () => <p className="text-sm text-muted-foreground">Loading developer access…</p> })

type SettingsTabId = "binder" | "display" | "share" | "account"

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: "binder", label: "Binder" },
  { id: "display", label: "Display" },
  { id: "share", label: "Share" },
  { id: "account", label: "Account" },
]

interface SettingsModalProps {
  collectionImport?: CollectionImportProps
  binderId?: string | null
  binderName?: string
  onPublicIdentityChange?: () => void
  initialTab?: SettingsTabId
  backupReady: boolean
  onDownloadBackup: () => Promise<string>
  appearance?: { pageColor: string; pageColors: Record<string, string> }
  isOpen: boolean
  onClose: () => void
  user: User | null
  settings: BinderSettings
  onUpdateSettings: (settings: Partial<BinderSettings>) => void | Promise<void>
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
  localPendingSyncCount: number
  isSyncingLocalCollection: boolean
  localCollectionSyncMessage: string | null
  onSyncLocalCollectionToCloud: () => void
  isOnline: boolean
  isInstalledApp: boolean
  canInstallApp: boolean
  pwaStatusMessage: string | null
  onInstallApp: () => void
  isReadOnlyView: boolean
  /** Owner/partner may manage the public link; independent of read-only collection editing. Defaults to !isReadOnlyView. */
  canManageShare?: boolean
  isAccountReadOnly?: boolean
  sharePath: string | null
  shareShowPrices: boolean
  onShareShowPricesChange: (value: boolean) => void
  isShareEnabled: boolean
  isShareLoading: boolean
  shareMessage: string | null
  onEnableReadOnlyShare: () => void
  onDisableReadOnlyShare: () => void
  trackedCardCount: number
  isRefreshingPrices: boolean
  priceRefreshMessage: string | null
  onRefreshPrices: () => void
  motionGlintStatus: "disabled" | "needs-permission" | "requesting" | "active" | "fallback" | "denied" | "unsupported"
  motionGlintMessage: string | null
  onRequestMotionGlint: () => void
}

export default function SettingsModal({
  collectionImport,
  binderId,
  binderName,
  onPublicIdentityChange = () => {},
  user,
  initialTab,
  backupReady,
  onDownloadBackup,
  appearance,
  isOpen,
  onClose,
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
  localPendingSyncCount,
  isSyncingLocalCollection,
  localCollectionSyncMessage,
  onSyncLocalCollectionToCloud,
  isOnline,
  isInstalledApp,
  canInstallApp,
  pwaStatusMessage,
  onInstallApp,
  isReadOnlyView,
  isAccountReadOnly = isReadOnlyView,
  canManageShare = !isReadOnlyView,
  sharePath,
  shareShowPrices,
  onShareShowPricesChange,
  isShareEnabled,
  isShareLoading,
  shareMessage,
  onEnableReadOnlyShare,
  onDisableReadOnlyShare,
  trackedCardCount,
  isRefreshingPrices,
  priceRefreshMessage,
  onRefreshPrices,
  motionGlintStatus,
  motionGlintMessage,
  onRequestMotionGlint,
}: SettingsModalProps) {
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [isBackingUp, setIsBackingUp] = useState(false)
  const { isShowModeOn, setShowMode } = useShowMode()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [selectedBinderColorId, setSelectedBinderColorId] = useState<BinderColorId>(currentPageBinderColorId)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [pageRangeInput, setPageRangeInput] = useState(String(currentBinderPage))
  const [activeTab, setActiveTab] = useState<SettingsTabId>("binder")
  const visibleSettingsTabs = SETTINGS_TABS.filter(tab =>
    tab.id === "account" ? !isAccountReadOnly : tab.id === "share" ? !isReadOnlyView || canManageShare : true)
  const effectiveActiveTab: SettingsTabId =
    (activeTab === "share" && isReadOnlyView && !canManageShare) || (activeTab === "account" && isAccountReadOnly) ? "binder" : activeTab

  useEffect(() => {
    if (isOpen) {
      if (initialTab) setActiveTab(initialTab)
      setSelectedBinderColorId(currentPageBinderColorId)
      setPageRangeInput(String(currentBinderPage))
      setCopyMessage(null)
      setBackupMessage(null)
    }
  }, [currentBinderPage, currentPageBinderColorId, isOpen, initialTab])

  useOverlay(isOpen, onClose, { containerRef: dialogRef })
  const swipe = useSwipeToDismiss(dialogRef, onClose, isOpen)

  if (!isOpen) return null

  const handleBinderSizeChange = (rows: number, cols: number) => {
    return onUpdateSettings({ binderRows: rows, binderCols: cols })
  }

  const hasPageColorOverride = appearance ? Boolean(appearance.pageColors[String(currentBinderPage)]) : Boolean(settings.binderPageColors[String(currentBinderPage)])
  const appearanceColorName = (color: string) => BINDER_COLOR_PRESETS.find(preset => preset.swatch[0].toLowerCase() === color.toLowerCase())?.label ?? "a custom colour"
  const fullShareUrl = sharePath && typeof window !== "undefined"
    ? buildBinderShareUrl(window.location.origin, sharePath)
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
  const motionGlintStatusLabel =
    motionGlintStatus === "active"
      ? "Active"
      : motionGlintStatus === "needs-permission"
        ? "Needs permission"
        : motionGlintStatus === "requesting"
          ? "Requesting"
          : motionGlintStatus === "denied"
            ? "Denied"
            : motionGlintStatus === "unsupported"
              ? "Fallback"
              : motionGlintStatus === "disabled"
                ? "Off"
                : "Fallback"
  const canRequestMotionGlint =
    !isReadOnlyView
    && (settings.binderSlotGlareEnabled || settings.cardFinishEffectsEnabled)
    && motionGlintStatus !== "requesting"
    && motionGlintStatus !== "active"
    && motionGlintStatus !== "unsupported"

  return (
    <div data-overlay-backdrop className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="absolute inset-x-3 top-[calc(var(--top-inset)+0.5rem)] bottom-[calc(var(--dock-clearance)+0.75rem)] mx-auto flex w-auto max-w-md flex-col holo-panel overflow-hidden rounded-[1.5rem] border border-border/50 bg-card shadow-2xl backdrop-blur-xl animate-slide-up md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(85vh,48rem)] md:w-full md:-translate-x-1/2 md:-translate-y-1/2"
        onClick={(e) => e.stopPropagation()}
      >
        <div data-sheet-grabber className="flex items-center justify-between border-b border-border/50 px-5 py-4 shrink-0" {...swipe}>
          <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
          <button onClick={onClose} aria-label="Close settings" className="mr-0.5 flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted/70 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="shrink-0 border-b border-border/45 px-3 py-2">
          <div className={`grid gap-1 rounded-2xl border border-border/45 bg-muted/35 p-1 ${visibleSettingsTabs.length === 2 ? "grid-cols-2" : "grid-cols-4"}`}>
            {visibleSettingsTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={effectiveActiveTab === tab.id}
                className={`h-9 rounded-xl text-xs font-semibold transition ${
                  effectiveActiveTab === tab.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/55 hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6 space-y-6"
          style={{
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-y",
          }}
        >
          {/* Binder Size */}
          {effectiveActiveTab === "binder" && (
          <div className="space-y-4">
            {!isReadOnlyView && (
              <OverlayLink href="/studio" onClose={onClose} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold transition-colors hover:bg-muted">
                <span>Binder Studio</span>
                <span className="text-xs font-normal text-muted-foreground">3D studio ↗</span>
              </OverlayLink>
            )}
            <div className="flex items-center gap-2">
              <Grid3X3 className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Binder layout</h3>
            </div>
            <BinderLayoutSettings rows={settings.binderRows} cols={settings.binderCols} readOnly={isReadOnlyView} onChange={handleBinderSizeChange} />
          </div>
          )}

          {effectiveActiveTab === "display" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Ticket className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Card show mode</h3>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-muted/35 px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Show mode</p>
                <p className="text-xs text-muted-foreground">
                  For card shows: Search opens Quick mode, tapping a card checks an asking price, and the screen stays on. Saved on this device.
                </p>
              </div>
              <Switch checked={isShowModeOn} onCheckedChange={setShowMode} aria-label="Show mode" />
            </div>
            <DealThresholdSettings />
            <ShowTallySettings />
            <div className="flex items-center gap-2">
              {isDarkMode ? <Moon className="w-4 h-4 text-primary" /> : <Sun className="w-4 h-4 text-primary" />}
              <h3 className="font-semibold">Appearance</h3>
            </div>
            {!isReadOnlyView && <div className="flex items-center justify-between gap-4 border-b border-border/40 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Show binder value</p>
                <p className="text-xs text-muted-foreground">Show the total above your binder. Analytics is always available.</p>
              </div>
              <Switch checked={settings.showBinderValue !== false} onCheckedChange={value => onUpdateSettings({ showBinderValue: value })} aria-label="Show binder value" />
            </div>}
            <div className="flex items-center justify-between gap-4 border-b border-border/40 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Dark mode</p>
              </div>
              <Switch checked={isDarkMode} onCheckedChange={onToggleDarkMode} aria-label="Toggle dark mode" />
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-border/40 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Binder slot glare</p>
                <p className="text-xs text-muted-foreground">
                  Pocket shine follows device motion when available.
                </p>
              </div>
              <Switch
                checked={settings.binderSlotGlareEnabled}
                onCheckedChange={(checked) => onUpdateSettings({ binderSlotGlareEnabled: checked })}
                aria-label="Toggle binder slot glare"
                disabled={isReadOnlyView}
              />
            </div>
            <div className="rounded-2xl border border-border/50 bg-muted/35 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background/70 text-primary">
                    <Smartphone className="size-4" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">Motion glint</p>
                      <span className="rounded-full border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {motionGlintStatusLabel}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Lets iPhone tilt data drive the shine when Holo Folder is saved to the Home Screen.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onRequestMotionGlint}
                  disabled={!canRequestMotionGlint}
                  className="shrink-0 rounded-full"
                >
                  {motionGlintStatus === "requesting" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Enable
                </Button>
              </div>
              {motionGlintMessage ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {motionGlintMessage}
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-border/40 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Card finish glints</p>
                <p className="text-xs text-muted-foreground">
                  Shows holo, reverse holo, IR, SIR, and secret rare gleams on selected cards.
                </p>
              </div>
              <Switch
                checked={settings.cardFinishEffectsEnabled}
                onCheckedChange={(checked) => onUpdateSettings({ cardFinishEffectsEnabled: checked })}
                aria-label="Toggle card finish glints"
                disabled={isReadOnlyView}
              />
            </div>
            <div className="pt-2">
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">Binder color</p>
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
                      className={`rounded-2xl border p-2 text-left transition-colors ${
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
              <div className="mt-4 border-t border-border/40 pt-4">
                <p className="text-xs font-medium">Apply to page range</p>
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
                    className="h-10 w-20 rounded-xl border border-border/50 bg-background/80 px-3 text-base md:text-sm font-medium tabular-nums"
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
                  Default: {appearance ? appearanceColorName(appearance.pageColor) : BINDER_COLOR_PRESETS.find((preset) => preset.id === settings.binderColorId)?.label ?? "Binder"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Page {currentBinderPage} is currently using {appearance ? appearanceColorName(appearance.pageColors[String(currentBinderPage)] ?? appearance.pageColor) : BINDER_COLOR_PRESETS.find((preset) => preset.id === currentPageBinderColorId)?.label ?? "the default color"}
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
          )}

          {effectiveActiveTab === "display" && (
          <div className="pt-4 border-t border-border space-y-4">
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">App mode</h3>
            </div>
            <div className="rounded-2xl border border-border/50 bg-muted/25 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{isInstalledApp ? "Installed app shell" : "Browser mode"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Install Holo Folder to keep the shell, card images, and recent lookups cached for poor signal at shows.
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
                {canInstallApp ? "Install Holo Folder" : "Use Add to Home Screen"}
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
          )}

          {effectiveActiveTab === "share" && !isReadOnlyView && (
            <div className="pt-4 border-t border-border space-y-4">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-primary" />
                <h3 className="font-semibold">Pricing</h3>
              </div>
              <div className="rounded-2xl border border-border/50 bg-muted/25 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Background price refresh</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Recalculates cached prices for every assigned card. The job runs on Vercel and keeps going if one card has no market price.
                    </p>
                  </div>
                  <span className="rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {trackedCardCount} cards
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full gap-2"
                  disabled={!isSignedIn || trackedCardCount === 0 || isRefreshingPrices}
                  onClick={onRefreshPrices}
                >
                  {isRefreshingPrices ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Refresh prices in background
                </Button>
                {priceRefreshMessage && (
                  <p className="mt-2 text-xs text-primary">{priceRefreshMessage}</p>
                )}
                {!isSignedIn && (
                  <p className="mt-2 text-xs text-muted-foreground">Sign in first to refresh your binder prices.</p>
                )}
              </div>
            </div>
          )}

          {effectiveActiveTab === "share" && canManageShare && isSignedIn && <PublicNameSettings binderId={binderId} binderName={binderName} isOnline={isOnline} onSaved={onPublicIdentityChange} />}

          {effectiveActiveTab === "share" && canManageShare && (
            <div className="pt-4 border-t border-border space-y-4">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-primary" />
                <h3 className="font-semibold">Read-only share link</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Share a public binder link. Prices are hidden unless you enable them. Viewers can browse and filter, but they cannot collect, edit cards, or change your binder.
              </p>
              {isShareEnabled && fullShareUrl ? (
                <div className="space-y-3 rounded-2xl border border-border/50 bg-muted/25 p-3">
                  <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-2 text-xs text-muted-foreground break-all">
                    {fullShareUrl}
                  </div>
                  <label className="flex min-h-11 items-center justify-between gap-3 text-sm" htmlFor="share-show-prices">
                    Show prices on shared binder
                    <Switch id="share-show-prices" className="min-h-9 min-w-9" checked={shareShowPrices} onCheckedChange={onShareShowPricesChange} disabled={isShareLoading || !isOnline} />
                  </label>
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

          {effectiveActiveTab === "account" && !isAccountReadOnly && <BillingSettings signedIn={isSignedIn} onSignIn={() => { onClose(); window.dispatchEvent(new Event("holofolder-sign-in")) }} />}
          {effectiveActiveTab === "account" && !isAccountReadOnly && user && <DeveloperSettings key={`developer-${user.id}`} isOnline={isOnline} />}
          {effectiveActiveTab === "account" && !isAccountReadOnly && user && <AccountPasskeys key={`passkeys-${user.id}`} isOnline={isOnline} />}
          {effectiveActiveTab === "account" && !isAccountReadOnly && user && <AccountIdentitySettings key={user.id} user={user} isOnline={isOnline} onUsernameSaved={onPublicIdentityChange} />}

          {effectiveActiveTab === "account" && !isReadOnlyView && (
            <div className="space-y-2">
              <Button variant="outline" className="w-full min-h-10 justify-start gap-2" disabled={!backupReady || isBackingUp} onClick={async () => {
                setIsBackingUp(true)
                setBackupMessage(null)
                try { setBackupMessage(await onDownloadBackup()) }
                catch (error) { setBackupMessage(error instanceof Error ? error.message : "Could not create the backup. Try again.") }
                finally { setIsBackingUp(false) }
              }}>
                <Download className="h-4 w-4" />
                {isBackingUp ? "Preparing backup…" : "Download backup"}
              </Button>
              <p className="text-xs text-muted-foreground">This binder’s owned cards, wanted cards and settings, including unsynced edits. Saves a JSON file. Collection entries can be imported below.</p>
              {backupMessage && <p role="status" className="text-xs text-muted-foreground">{backupMessage}</p>}
              {isOpen && collectionImport && <CollectionImport key={collectionImport.scopeKey} {...collectionImport} />}
            </div>
          )}

          {effectiveActiveTab === "account" && !isAccountReadOnly && <PartnerPushSettings userId={user?.id ?? null} isInstalledApp={isInstalledApp} />}

          {effectiveActiveTab === "account" && !isAccountReadOnly && (
            <PricingPreferencesSettings settings={settings} onUpdateSettings={onUpdateSettings} />
          )}

          {effectiveActiveTab === "account" && !isReadOnlyView && (
          <div className="pt-4 border-t border-border space-y-4">
            <div className="flex items-center gap-2">
              <CloudUpload className="w-4 h-4 text-primary" />
              <h3 className="font-semibold">Collection sync</h3>
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
                  Browser-local owned cards kept for offline recovery and sync-back.
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-border/40 bg-muted/20 px-3 py-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Owned cards and wanted cards are saved locally as you edit. If a cloud save cannot finish, the change stays queued and retries when you are signed in and online.
              </p>
              {localPendingSyncCount > 0 && (
                <p className="mt-2 text-xs font-medium text-primary">
                  {localPendingSyncCount} local change{localPendingSyncCount === 1 ? "" : "s"} waiting to sync.
                </p>
              )}
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
          {effectiveActiveTab === "account" && (
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground text-center">
              Holo Folder helps you organize your Pokemon card collection by National Dex number.
            </p>
          </div>
          )}

          <CardDataAttribution className="border-t border-border/60 pt-3 text-center text-[11px] leading-snug text-muted-foreground/80" />
        </div>
      </div>
    </div>
  )
}
