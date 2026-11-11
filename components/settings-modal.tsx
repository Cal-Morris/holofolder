'use client';
import { toast } from '@/components/ui/toast';

import dynamic from 'next/dynamic';

import { BinderLayoutSettings } from '@/components/binder-layout-settings';
import { OverlayLink } from '@/components/overlay-link';
import { BillingSettings } from '@/components/billing-settings';
import { AccountPasskeys } from '@/components/account-passkeys';
import { AccountIdentitySettings } from '@/components/account-identity-settings';
import { PartnerPushSettings } from '@/components/partner-push-settings';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Credits } from '@/components/credits';
import { PublicNameSettings } from '@/components/public-name-settings';
import { PricingPreferencesSettings } from '@/components/pricing-preferences-settings';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { useShowMode } from '@/hooks/use-show-mode';
import { useSlotLabels } from '@/hooks/use-slot-labels';
import { useBillingContext } from '@/hooks/use-billing';
import { DealThresholdSettings, ShowTallySettings } from '@/components/deal-settings';
import {
  X,
  Grid3X3,
  Copy,
  Download,
  Link2,
  Loader2,
  Palette,
  Wifi,
  WifiOff,
  RefreshCw,
  Smartphone,
  Ticket,
  UserRound,
  CreditCard,
  KeyRound,
  Tag,
  Bell,
  Archive,
  Code2,
  ChevronRight,
  ChevronLeft,
  LogIn,
  Info,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { BinderSettings } from '@/hooks/use-settings';
import { BINDER_COLOR_PRESETS, type BinderColorId } from '@/lib/binder-colors';
import { buildBinderShareUrl } from '@/lib/binder-share';
import type { User } from '@supabase/supabase-js';

const OfflineSetPicker = dynamic(
  () => import('@/components/show-offline-prep').then((module) => module.OfflineSetPicker),
  { loading: () => <p className="text-muted-foreground text-xs">Loading offline tools…</p> },
);
const DeveloperSettings = dynamic(() => import('@/components/developer-settings'), {
  loading: () => <p className="text-muted-foreground text-sm">Loading developer access…</p>,
});

export type SettingsPageId =
  | 'profile'
  | 'plan'
  | 'security'
  | 'layout'
  | 'appearance'
  | 'sharing'
  | 'prices'
  | 'show'
  | 'notifications'
  | 'offline'
  | 'backup'
  | 'developer'
  | 'credits';

interface SettingsRow {
  id: SettingsPageId;
  title: string;
  icon: LucideIcon;
  summary?: string;
  visible: boolean;
}

interface SettingsModalProps {
  binderId?: string | null;
  binderName?: string;
  onPublicIdentityChange?: () => void;
  /** Opens straight to a page instead of the list, e.g. Notifications after a push prompt. */
  initialPage?: SettingsPageId;
  backupReady: boolean;
  onDownloadBackup: () => Promise<string>;
  appearance?: { pageColor: string; pageColors: Record<string, string> };
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  settings: BinderSettings;
  onUpdateSettings: (settings: Partial<BinderSettings>) => void | Promise<void>;
  currentBinderPage: number;
  totalBinderPages: number;
  currentPageBinderColorId: BinderColorId;
  onSetGlobalBinderColor: (binderColorId: BinderColorId) => void;
  onSetCurrentPageBinderColor: (binderColorId: BinderColorId) => void;
  onSetBinderColorForPageRange: (binderColorId: BinderColorId, endPage: number) => void;
  onClearCurrentPageBinderColor: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  isSignedIn: boolean;
  isOnline: boolean;
  isInstalledApp: boolean;
  canInstallApp: boolean;
  pwaStatusMessage: string | null;
  onInstallApp: () => void;
  isReadOnlyView: boolean;
  /** Owner/partner may manage the public link; independent of read-only collection editing. Defaults to !isReadOnlyView. */
  canManageShare?: boolean;
  isAccountReadOnly?: boolean;
  sharePath: string | null;
  shareShowPrices: boolean;
  onShareShowPricesChange: (value: boolean) => void;
  isShareEnabled: boolean;
  isShareLoading: boolean;
  onEnableReadOnlyShare: () => void;
  onDisableReadOnlyShare: () => void;
  trackedCardCount: number;
  isRefreshingPrices: boolean;
  priceRefreshMessage: string | null;
  onRefreshPrices: () => void;
  motionGlintStatus: 'disabled' | 'needs-permission' | 'requesting' | 'active' | 'fallback' | 'denied' | 'unsupported';
  motionGlintMessage: string | null;
  onRequestMotionGlint: () => void;
}

/** Root and page panes slide and fade (panes are transparent, so they'd show through each other mid-slide); `visibility` flips after the slide out so hidden panes leave focus and the a11y tree. */
const PANE =
  'absolute inset-0 overflow-y-auto overscroll-contain transition-[translate,opacity,visibility] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none';
const PANE_STYLE = { WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' } as const;

function SettingsGroup({ label, quiet = false, children }: { label: string; quiet?: boolean; children: ReactNode }) {
  return (
    <section aria-label={label} className="space-y-1.5">
      <h3 className="text-muted-foreground px-1 text-[11px] font-semibold tracking-[0.12em] uppercase">{label}</h3>
      <div
        className={`divide-border/40 divide-y overflow-hidden rounded-2xl border ${quiet ? 'border-border/35 bg-transparent' : 'border-border/50 bg-muted/25'}`}
      >
        {children}
      </div>
    </section>
  );
}

export default function SettingsModal({
  binderId,
  binderName,
  onPublicIdentityChange = () => {},
  user,
  initialPage,
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
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const { isShowModeOn, setShowMode } = useShowMode();
  const [slotLabelsOn, setSlotLabels] = useSlotLabels();
  const billing = useBillingContext();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const focusAfterNavigation = useRef(false);
  const [selectedBinderColorId, setSelectedBinderColorId] = useState<BinderColorId>(currentPageBinderColorId);
  const [pageRangeInput, setPageRangeInput] = useState(String(currentBinderPage));
  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState<SettingsPageId | null>(isOpen ? (initialPage ?? null) : null);
  // The last opened page stays rendered while the pane slides back out.
  const [shownPage, setShownPage] = useState<SettingsPageId | null>(page);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setPage(initialPage ?? null);
      setShownPage(initialPage ?? null);
    }
  }

  useEffect(() => {
    if (isOpen) {
      setSelectedBinderColorId(currentPageBinderColorId);
      setPageRangeInput(String(currentBinderPage));
      setBackupMessage(null);
    }
  }, [currentBinderPage, currentPageBinderColorId, isOpen]);

  useOverlay(isOpen, onClose, { containerRef: dialogRef });
  const swipe = useSwipeToDismiss(dialogRef, onClose, isOpen);

  const signedInAccount = Boolean(user) && !isAccountReadOnly;
  const access = billing?.access;
  const planSummary =
    access?.source === 'perpetual'
      ? 'Lifetime'
      : access?.source === 'trial'
        ? 'Trial'
        : access?.tier === 'paid'
          ? 'Premium'
          : access
            ? 'Free'
            : undefined;
  const groups: Array<{ label: string; quiet?: boolean; rows: SettingsRow[] }> = [
    {
      label: 'Account',
      rows: [
        {
          id: 'profile',
          title: 'Profile',
          icon: UserRound,
          summary: user?.email ?? undefined,
          visible: signedInAccount,
        },
        {
          id: 'plan',
          title: 'Plan & billing',
          icon: CreditCard,
          summary: planSummary,
          visible: signedInAccount && Boolean(billing),
        },
        { id: 'security', title: 'Sign-in & security', icon: KeyRound, visible: signedInAccount },
      ],
    },
    {
      label: 'This binder',
      rows: [
        {
          id: 'layout',
          title: 'Layout',
          icon: Grid3X3,
          summary: `${settings.binderRows}×${settings.binderCols}`,
          visible: true,
        },
        { id: 'appearance', title: 'Appearance', icon: Palette, summary: isDarkMode ? 'Dark' : 'Light', visible: true },
        {
          id: 'sharing',
          title: 'Sharing',
          icon: Link2,
          summary: isShareEnabled ? 'Link on' : 'Off',
          visible: canManageShare,
        },
      ],
    },
    {
      label: 'Collecting',
      rows: [
        {
          id: 'prices',
          title: 'Prices',
          icon: Tag,
          summary: settings.preferredCurrency ?? undefined,
          visible: !isAccountReadOnly || !isReadOnlyView,
        },
        { id: 'show', title: 'Show mode', icon: Ticket, summary: isShowModeOn ? 'On' : 'Off', visible: true },
        { id: 'notifications', title: 'Notifications', icon: Bell, visible: signedInAccount },
      ],
    },
    {
      label: 'Data & offline',
      rows: [
        {
          id: 'offline',
          title: 'Offline & app',
          icon: isOnline ? Wifi : WifiOff,
          summary: isInstalledApp ? 'Installed' : 'Browser',
          visible: true,
        },
        { id: 'backup', title: 'Backup', icon: Archive, visible: !isReadOnlyView && !isAccountReadOnly },
      ],
    },
    {
      label: 'Advanced',
      quiet: true,
      rows: [{ id: 'developer', title: 'Developer', icon: Code2, visible: signedInAccount }],
    },
    {
      label: 'About',
      quiet: true,
      rows: [{ id: 'credits', title: 'Credits & attributions', icon: Info, visible: true }],
    },
  ];
  const rows = groups.flatMap((group) => group.rows);
  const isVisible = (id: SettingsPageId | null) => id !== null && rows.some((row) => row.id === id && row.visible);
  const activePage = isVisible(page) ? page : null;
  const renderedPage = isVisible(shownPage) ? shownPage : null;
  const pageTitle = rows.find((row) => row.id === (activePage ?? renderedPage))?.title;

  useEffect(() => {
    if (!focusAfterNavigation.current) return;
    focusAfterNavigation.current = false;
    if (activePage) backRef.current?.focus({ preventScroll: true });
    else if (shownPage)
      dialogRef.current
        ?.querySelector<HTMLElement>(`[data-settings-row="${shownPage}"]`)
        ?.focus({ preventScroll: true });
  }, [activePage, shownPage]);

  if (!isOpen) return null;

  const openPage = (id: SettingsPageId) => {
    focusAfterNavigation.current = true;
    if (pageScrollRef.current) pageScrollRef.current.scrollTop = 0;
    setShownPage(id);
    setPage(id);
  };
  const goBack = () => {
    focusAfterNavigation.current = true;
    setPage(null);
  };

  const handleBinderSizeChange = (rows: number, cols: number) => {
    return onUpdateSettings({ binderRows: rows, binderCols: cols });
  };

  const hasPageColorOverride = appearance
    ? Boolean(appearance.pageColors[String(currentBinderPage)])
    : Boolean(settings.binderPageColors[String(currentBinderPage)]);
  const appearanceColorName = (color: string) =>
    BINDER_COLOR_PRESETS.find((preset) => preset.swatch[0].toLowerCase() === color.toLowerCase())?.label ??
    'a custom colour';
  const fullShareUrl =
    sharePath && typeof window !== 'undefined' ? buildBinderShareUrl(window.location.origin, sharePath) : sharePath;

  const handleCopyShareLink = async () => {
    if (!fullShareUrl) return;

    try {
      await navigator.clipboard.writeText(fullShareUrl);
      toast('Share link copied');
    } catch {
      toast('Could not copy the share link', 'error');
    }
  };
  const parsedPageRangeEnd = Number.parseInt(pageRangeInput, 10);
  const safePageRangeEnd = Number.isInteger(parsedPageRangeEnd)
    ? Math.min(Math.max(parsedPageRangeEnd, 1), totalBinderPages)
    : currentBinderPage;
  const motionGlintStatusLabel =
    motionGlintStatus === 'active'
      ? 'Active'
      : motionGlintStatus === 'needs-permission'
        ? 'Needs permission'
        : motionGlintStatus === 'requesting'
          ? 'Requesting'
          : motionGlintStatus === 'denied'
            ? 'Denied'
            : motionGlintStatus === 'unsupported'
              ? 'Fallback'
              : motionGlintStatus === 'disabled'
                ? 'Off'
                : 'Fallback';
  const canRequestMotionGlint =
    !isReadOnlyView &&
    (settings.binderSlotGlareEnabled || settings.cardFinishEffectsEnabled) &&
    motionGlintStatus !== 'requesting' &&
    motionGlintStatus !== 'active' &&
    motionGlintStatus !== 'unsupported';

  const renderPage = (id: SettingsPageId) => {
    switch (id) {
      case 'profile':
        return (
          user && (
            <AccountIdentitySettings
              key={user.id}
              user={user}
              isOnline={isOnline}
              onUsernameSaved={onPublicIdentityChange}
            />
          )
        );
      case 'plan':
        return (
          <BillingSettings
            signedIn={isSignedIn}
            onSignIn={() => {
              onClose();
              window.dispatchEvent(new Event('holofolder-sign-in'));
            }}
          />
        );
      case 'security':
        return user && <AccountPasskeys key={`passkeys-${user.id}`} isOnline={isOnline} />;
      case 'layout':
        return (
          <div className="space-y-4">
            {!isReadOnlyView && (
              <OverlayLink
                href="/studio"
                onClose={onClose}
                className="border-border bg-background hover:bg-muted flex min-h-12 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors"
              >
                <span>Binder Studio</span>
                <span className="text-muted-foreground text-xs font-normal">3D studio ↗</span>
              </OverlayLink>
            )}
            <BinderLayoutSettings
              rows={settings.binderRows}
              cols={settings.binderCols}
              readOnly={isReadOnlyView}
              onChange={handleBinderSizeChange}
            />
          </div>
        );
      case 'appearance':
        return (
          <div className="space-y-4">
            {!isReadOnlyView && (
              <div className="border-border/40 flex items-center justify-between gap-4 border-b py-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Show binder value</p>
                  <p className="text-muted-foreground text-xs">
                    Show the total above your binder. Analytics is always available.
                  </p>
                </div>
                <Switch
                  checked={settings.showBinderValue !== false}
                  onCheckedChange={(value) => onUpdateSettings({ showBinderValue: value })}
                  aria-label="Show binder value"
                />
              </div>
            )}
            <div className="border-border/40 flex items-center justify-between gap-4 border-b py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Dark mode</p>
              </div>
              <Switch checked={isDarkMode} onCheckedChange={onToggleDarkMode} aria-label="Toggle dark mode" />
            </div>
            <div className="border-border/40 flex items-center justify-between gap-4 border-b py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Binder slot glare</p>
                <p className="text-muted-foreground text-xs">Pocket shine follows device motion when available.</p>
              </div>
              <Switch
                checked={settings.binderSlotGlareEnabled}
                onCheckedChange={(checked) => onUpdateSettings({ binderSlotGlareEnabled: checked })}
                aria-label="Toggle binder slot glare"
                disabled={isAccountReadOnly}
              />
            </div>
            {!isReadOnlyView && (
              <div className="border-border/40 flex items-center justify-between gap-4 border-b py-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Slot positions</p>
                  <p className="text-muted-foreground text-xs">
                    Show A1, B4 and so on in each pocket. This device only.
                  </p>
                </div>
                <Switch checked={slotLabelsOn} onCheckedChange={setSlotLabels} aria-label="Show slot positions" />
              </div>
            )}
            <div className="border-border/50 bg-muted/35 rounded-2xl border px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="bg-background/70 text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
                    <Smartphone className="size-4" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">Motion glint</p>
                      <span className="border-border/50 bg-background/70 text-muted-foreground rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] uppercase">
                        {motionGlintStatusLabel}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs">
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
                  {motionGlintStatus === 'requesting' ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Enable
                </Button>
              </div>
              {motionGlintMessage ? <p className="text-muted-foreground mt-3 text-xs">{motionGlintMessage}</p> : null}
            </div>
            <div className="border-border/40 flex items-center justify-between gap-4 border-b py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Card finish glints</p>
                <p className="text-muted-foreground text-xs">
                  Shows holo, reverse holo, IR, SIR, and secret rare gleams on selected cards.
                </p>
              </div>
              <Switch
                checked={settings.cardFinishEffectsEnabled}
                onCheckedChange={(checked) => onUpdateSettings({ cardFinishEffectsEnabled: checked })}
                aria-label="Toggle card finish glints"
                disabled={isAccountReadOnly}
              />
            </div>
            <div className="pt-2">
              <div className="flex items-center gap-2">
                <Palette className="text-primary h-4 w-4" />
                <div>
                  <p className="text-sm font-medium">Binder color</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {BINDER_COLOR_PRESETS.map((preset) => {
                  const isSelected = selectedBinderColorId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setSelectedBinderColorId(preset.id)}
                      disabled={isAccountReadOnly}
                      className={`rounded-2xl border p-2 text-left transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/10 shadow-sm'
                          : 'border-border/50 bg-background/45 hover:border-primary/40'
                      }`}
                    >
                      <div
                        className="h-10 rounded-xl"
                        style={{
                          background: `linear-gradient(135deg, ${preset.swatch[0]} 0%, ${preset.swatch[1]} 100%)`,
                        }}
                      />
                      <p className="mt-2 text-xs font-medium">{preset.label}</p>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => onSetGlobalBinderColor(selectedBinderColorId)}
                  disabled={isAccountReadOnly}
                >
                  Use for all pages
                </Button>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => onSetCurrentPageBinderColor(selectedBinderColorId)}
                  disabled={isAccountReadOnly}
                >
                  Use for page {currentBinderPage}
                </Button>
              </div>
              <div className="border-border/40 mt-4 border-t pt-4">
                <p className="text-xs font-medium">Apply to page range</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="border-border/40 bg-muted/35 text-muted-foreground rounded-xl border px-3 py-2 text-sm font-medium">
                    1-
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={totalBinderPages}
                    inputMode="numeric"
                    value={pageRangeInput}
                    disabled={isAccountReadOnly}
                    onChange={(event) => setPageRangeInput(event.target.value)}
                    onBlur={() => setPageRangeInput(String(safePageRangeEnd))}
                    className="border-border/50 bg-background/80 h-10 w-20 rounded-xl border px-3 text-base font-medium tabular-nums md:text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={isAccountReadOnly}
                    onClick={() => {
                      onSetBinderColorForPageRange(selectedBinderColorId, safePageRangeEnd);
                      setPageRangeInput(String(safePageRangeEnd));
                    }}
                  >
                    Use for pages 1-{safePageRangeEnd}
                  </Button>
                </div>
              </div>
              <div className="border-border/40 bg-background/45 mt-3 rounded-2xl border px-3 py-2.5">
                <p className="text-xs font-medium">
                  Default:{' '}
                  {appearance
                    ? appearanceColorName(appearance.pageColor)
                    : (BINDER_COLOR_PRESETS.find((preset) => preset.id === settings.binderColorId)?.label ?? 'Binder')}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Page {currentBinderPage} is currently using{' '}
                  {appearance
                    ? appearanceColorName(appearance.pageColors[String(currentBinderPage)] ?? appearance.pageColor)
                    : (BINDER_COLOR_PRESETS.find((preset) => preset.id === currentPageBinderColorId)?.label ??
                      'the default color')}
                  {hasPageColorOverride ? ' via a page override.' : ' from the global default.'}
                </p>
                {hasPageColorOverride && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground mt-2 h-8 px-0 text-xs"
                    onClick={onClearCurrentPageBinderColor}
                    disabled={isAccountReadOnly}
                  >
                    Clear page {currentBinderPage} override
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      case 'sharing':
        return (
          <div className="space-y-6">
            {isSignedIn && (
              <PublicNameSettings
                binderId={binderId}
                binderName={binderName}
                isOnline={isOnline}
                onSaved={onPublicIdentityChange}
              />
            )}
            <div className="space-y-4">
              <h3 className="font-semibold">Read-only share link</h3>
              <p className="text-muted-foreground text-xs">
                Share a public binder link. Prices are hidden unless you enable them. Viewers can browse and filter, but
                they cannot collect, edit cards, or change your binder.
              </p>
              {isShareEnabled && fullShareUrl ? (
                <div className="border-border/50 bg-muted/25 space-y-3 rounded-2xl border p-3">
                  <div className="border-border/50 bg-background/70 text-muted-foreground rounded-xl border px-3 py-2 text-xs break-all">
                    {fullShareUrl}
                  </div>
                  <label
                    className="flex min-h-11 items-center justify-between gap-3 text-sm"
                    htmlFor="share-show-prices"
                  >
                    Show prices on shared binder
                    <Switch
                      id="share-show-prices"
                      className="min-h-9 min-w-9"
                      checked={shareShowPrices}
                      onCheckedChange={onShareShowPricesChange}
                      disabled={isShareLoading || !isOnline}
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 gap-2"
                      onClick={handleCopyShareLink}
                      disabled={isShareLoading}
                    >
                      <Copy className="h-4 w-4" />
                      Copy link
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      className="flex-1"
                      onClick={onDisableReadOnlyShare}
                      disabled={isShareLoading}
                    >
                      Disable link
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  className="w-full gap-2"
                  onClick={onEnableReadOnlyShare}
                  disabled={!isSignedIn || isShareLoading}
                >
                  {isShareLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  Generate read-only share link
                </Button>
              )}
              {!isSignedIn && (
                <p className="text-muted-foreground text-xs">Sign in first to manage your public share link.</p>
              )}
            </div>
          </div>
        );
      case 'prices':
        return (
          <div className="space-y-6">
            {!isAccountReadOnly && (
              <PricingPreferencesSettings settings={settings} onUpdateSettings={onUpdateSettings} />
            )}
            {!isReadOnlyView && (
              <div className="border-border/50 bg-muted/25 rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Background price refresh</p>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                      Recalculates cached prices for every assigned card. The job runs on Vercel and keeps going if one
                      card has no market price.
                    </p>
                  </div>
                  <span className="border-border/50 bg-background/60 text-muted-foreground rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] uppercase">
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
                  {isRefreshingPrices ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Refresh prices in background
                </Button>
                {priceRefreshMessage && <p className="text-primary mt-2 text-xs">{priceRefreshMessage}</p>}
                {!isSignedIn && (
                  <p className="text-muted-foreground mt-2 text-xs">Sign in first to refresh your binder prices.</p>
                )}
              </div>
            )}
          </div>
        );
      case 'show':
        return (
          <div className="space-y-4">
            <div className="border-border/50 bg-muted/35 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Show mode</p>
                <p className="text-muted-foreground text-xs">
                  For card shows: Search opens Quick mode, tapping a card checks an asking price, and the screen stays
                  on. Saved on this device.
                </p>
              </div>
              <Switch checked={isShowModeOn} onCheckedChange={setShowMode} aria-label="Show mode" />
            </div>
            <DealThresholdSettings />
            <ShowTallySettings />
          </div>
        );
      case 'notifications':
        return <PartnerPushSettings userId={user?.id ?? null} isInstalledApp={isInstalledApp} />;
      case 'offline':
        return (
          <div className="space-y-4">
            <div className="border-border/50 bg-muted/25 rounded-2xl border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{isInstalledApp ? 'Installed app shell' : 'Browser mode'}</p>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    Install Holo Folder to keep the shell, card images, and recent lookups cached for poor signal at
                    shows.
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] uppercase ${
                    isOnline
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                  }`}
                >
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
              <div className="border-border/40 bg-background/50 text-muted-foreground mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs">
                {isOnline ? (
                  <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-amber-500" />
                )}
                <span>
                  {isOnline ? 'Live requests available.' : 'Using cached app data and assets where available.'}
                </span>
              </div>
            </div>
            {!isInstalledApp && (
              <Button
                type="button"
                variant={canInstallApp ? 'default' : 'outline'}
                className="w-full gap-2"
                disabled={!canInstallApp}
                onClick={onInstallApp}
              >
                <Download className="h-4 w-4" />
                {canInstallApp ? 'Install Holo Folder' : 'Use Add to Home Screen'}
              </Button>
            )}
            {!canInstallApp && !isInstalledApp && (
              <p className="text-muted-foreground text-xs">
                If your browser does not show an install prompt, use its share menu and choose Add to Home Screen.
              </p>
            )}
            {pwaStatusMessage && <p className="text-primary text-xs">{pwaStatusMessage}</p>}
            <section
              aria-label="Offline sets"
              className="border-border/50 bg-muted/25 space-y-3 rounded-2xl border p-3"
            >
              <div>
                <p className="text-sm font-medium">Offline sets</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  Save whole sets (checklists, card thumbnails and last-known prices) to browse them with no signal.
                </p>
              </div>
              <OfflineSetPicker isOnline={isOnline} />
            </section>
          </div>
        );
      case 'backup':
        return (
          <div className="space-y-2">
            <Button
              variant="outline"
              className="min-h-10 w-full justify-start gap-2"
              disabled={!backupReady || isBackingUp}
              onClick={async () => {
                setIsBackingUp(true);
                setBackupMessage(null);
                try {
                  setBackupMessage(await onDownloadBackup());
                } catch (error) {
                  setBackupMessage(error instanceof Error ? error.message : 'Could not create the backup. Try again.');
                } finally {
                  setIsBackingUp(false);
                }
              }}
            >
              <Download className="h-4 w-4" />
              {isBackingUp ? 'Preparing backup…' : 'Download backup'}
            </Button>
            <p className="text-muted-foreground text-xs">
              This binder’s owned cards, wanted cards and settings, including unsynced edits. Saves a JSON file.
            </p>
            {backupMessage && (
              <p role="status" className="text-muted-foreground text-xs">
                {backupMessage}
              </p>
            )}
          </div>
        );
      case 'developer':
        return user && <DeveloperSettings key={`developer-${user.id}`} isOnline={isOnline} />;
      case 'credits':
        return <Credits />;
    }
  };

  return (
    <div data-overlay-backdrop className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="holo-panel border-border/50 bg-card animate-slide-up absolute inset-x-3 top-[calc(var(--top-inset)+0.5rem)] bottom-[calc(var(--dock-clearance)+0.75rem)] mx-auto flex w-auto max-w-md flex-col overflow-hidden rounded-[1.5rem] border shadow-2xl backdrop-blur-xl md:inset-auto md:top-1/2 md:left-1/2 md:h-[min(85vh,48rem)] md:w-full md:-translate-x-1/2 md:-translate-y-1/2"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          data-sheet-grabber
          className="border-border/50 relative flex shrink-0 items-center justify-between gap-2 border-b px-3 py-3"
          {...swipe}
        >
          <span
            aria-hidden="true"
            className="bg-muted-foreground/30 pointer-events-none absolute top-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full md:hidden"
          />
          {activePage ? (
            <div className="flex min-w-0 items-center gap-1">
              <button
                ref={backRef}
                type="button"
                onClick={goBack}
                aria-label="Back to Settings"
                className="hover:bg-muted/70 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h2 className="truncate text-lg font-semibold tracking-tight">{pageTitle}</h2>
            </div>
          ) : (
            <h2 className="px-2 text-lg font-semibold tracking-tight">Settings</h2>
          )}
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="hover:bg-muted/70 mr-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative flex-1 overflow-hidden">
          <div
            className={`${PANE} space-y-5 px-4 py-4 ${activePage ? 'invisible -translate-x-1/4 opacity-0' : 'visible translate-x-0 opacity-100'}`}
            style={PANE_STYLE}
          >
            {!user && !isAccountReadOnly && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new Event('holofolder-sign-in'));
                }}
                className="border-primary/30 bg-primary/10 hover:bg-primary/15 flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors"
              >
                <span className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-xl">
                  <LogIn className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Sign in</span>
                  <span className="text-muted-foreground block text-xs">
                    Sync across devices, share binders and unlock Premium.
                  </span>
                </span>
                <ChevronRight className="text-muted-foreground size-4 shrink-0" />
              </button>
            )}
            {groups.map((group) => {
              const visibleRows = group.rows.filter((row) => row.visible);
              if (visibleRows.length === 0) return null;
              return (
                <SettingsGroup key={group.label} label={group.label} quiet={group.quiet}>
                  {visibleRows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      data-settings-row={row.id}
                      aria-label={row.summary ? `${row.title}, ${row.summary}` : row.title}
                      onClick={() => openPage(row.id)}
                      className={`hover:bg-muted/50 flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors ${group.quiet ? 'text-muted-foreground' : ''}`}
                    >
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${group.quiet ? 'bg-muted/60' : 'bg-primary/10 text-primary'}`}
                      >
                        <row.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span>
                      {row.summary && (
                        <span className="text-muted-foreground max-w-[45%] min-w-0 truncate text-sm">
                          {row.summary}
                        </span>
                      )}
                      <ChevronRight className="text-muted-foreground/70 size-4 shrink-0" />
                    </button>
                  ))}
                </SettingsGroup>
              );
            })}
            <div className="space-y-3 pt-1">
              <p className="text-muted-foreground text-center text-xs">
                Holo Folder helps you organize your Pokemon card collection by National Dex number.
              </p>
            </div>
          </div>

          <div
            ref={pageScrollRef}
            className={`${PANE} px-5 py-5 sm:px-6 ${activePage ? 'visible translate-x-0 opacity-100' : 'invisible translate-x-full opacity-0'}`}
            style={PANE_STYLE}
          >
            {renderedPage && <div key={renderedPage}>{renderPage(renderedPage)}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
