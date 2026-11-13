'use client';

import { BinderCreationPresets } from '@/components/binder-creation-presets';
import type { BinderCreationDraft } from '@/lib/binder-creation-draft';

import { ActivityButton } from '@/components/collection-activity-context';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { OverlayLink } from '@/components/overlay-link';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Check, Languages, Loader2, Paintbrush, Pencil, Plus, Trash2, X } from 'lucide-react';
import { CARD_LANGUAGES, type CardLanguage } from '@/lib/domain/cards';
import { DEFAULT_BINDER_CARD_LANGUAGES } from '@/lib/card-languages';
import { CARD_LANGUAGE_LABELS } from '@/lib/card-labels';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { BINDER_NAME_MAX_LENGTH, MAX_BINDERS_PER_OWNER, type Binder } from '@/lib/binders/model';
import { POKEMON_CATALOG } from '@/lib/pokemon-catalog';
import { moveBinder } from '@/lib/binders/manage';
import { BinderRequestError, bindersApi, type BinderWithCount } from '@/lib/binders/client';
import { useBillingContext } from '@/hooks/use-billing';
import { canCreateOwnerBinder } from '@/lib/billing';

interface BinderSwitcherSheetProps {
  binders: readonly Binder[];
  activeBinderId: string | null;
  /** False for read-only views (share links): the list switches nothing and nothing can be edited. */
  canManage: boolean;
  isOnline: boolean;
  /** Offline: binders saved on this device, which still open. Others need a connection. */
  offlineBinderIds?: ReadonlySet<string>;
  onSwitch: (binderId: string) => void;
  onBindersChange: (binders: Binder[]) => void;
  onClose: () => void;
  /** Private draft adapter only; production callers deliberately omit it until #379. */
  stagedCreation?: { ownerUserId: string; onDraft: (draft: BinderCreationDraft) => void };
}

type Row = Binder & { slotCount?: number };

const slotLabel = (count: number | undefined) => (count === undefined ? '' : count === 1 ? '1 slot' : `${count} slots`);

/**
 * Switch, create, rename, reorder and delete binders. Partners see and manage the same binders as the owner.
 * Built on the shared overlay primitive; deleting asks first, a binder with cards needs a second explicit
 * confirmation, and the last binder can't be deleted.
 */
export default function BinderSwitcherSheet({
  binders: initialBinders,
  activeBinderId,
  canManage,
  isOnline,
  offlineBinderIds,
  onSwitch,
  onBindersChange,
  onClose,
  stagedCreation,
}: BinderSwitcherSheetProps) {
  const billing = useBillingContext();
  const upgrade = () => {
    onClose();
    billing?.upgrade();
  };
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useOverlay(true, onClose, { containerRef: sheetRef });
  const swipe = useSwipeToDismiss(sheetRef, onClose);

  const [rows, setRows] = useState<Row[]>(() => [...initialBinders]);
  const [isManaging, setIsManaging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [languagesId, setLanguagesId] = useState<string | null>(null);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);

  useEffect(() => {
    if (!canManage || !isOnline) return;
    let cancelled = false;
    bindersApi
      .list()
      .then(({ binders }) => {
        if (cancelled) return;
        setRows(binders);
        onBindersChange(binders);
      })
      .catch(() => {
        // The list from the page is still usable; counts just stay hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, isOnline, onBindersChange]);

  const apply = (binders: BinderWithCount[]) => {
    setRows(binders);
    onBindersChange(binders);
  };

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      if (error instanceof BinderRequestError && error.reason === 'binder_limit_reached' && billing) {
        upgrade();
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    void run('create', async () => {
      const result = await bindersApi.create(name);
      apply(result.binders);
      setNewName('');
      if (result.createdBinderId) onSwitch(result.createdBinderId);
    });
  };

  const handleRename = (event: FormEvent, binderId: string) => {
    event.preventDefault();
    void run(`rename:${binderId}`, async () => {
      apply((await bindersApi.rename(binderId, renameDraft)).binders);
      setRenamingId(null);
    });
  };

  const handleToggleLanguage = (binder: Row, language: CardLanguage) => {
    const current = binder.cardLanguages ?? DEFAULT_BINDER_CARD_LANGUAGES;
    const next = current.includes(language) ? current.filter((item) => item !== language) : [...current, language];
    if (next.length === 0) return;
    void run(`languages:${binder.id}`, async () => {
      apply((await bindersApi.setCardLanguages(binder.id, next)).binders);
    });
  };

  const handleMove = (binderId: string, direction: -1 | 1) => {
    const next = moveBinder(rows, binderId, direction);
    setRows(next);
    void run(`move:${binderId}`, async () => {
      apply((await bindersApi.reorder(next.map((binder) => binder.id))).binders);
    });
  };

  const handleDelete = (binder: Row) => {
    void run(`delete:${binder.id}`, async () => {
      try {
        const result = await bindersApi.remove(binder.id, deleteAcknowledged);
        apply(result.binders);
        setConfirmDeleteId(null);
        setDeleteAcknowledged(false);
        if (binder.id === activeBinderId) {
          const fallback = result.binders.find((item) => item.isDefault) ?? result.binders[0];
          if (fallback) onSwitch(fallback.id);
        }
      } catch (error) {
        if (error instanceof BinderRequestError && error.reason === 'needs-confirmation') {
          setRows((current) =>
            current.map((item) => (item.id === binder.id ? { ...item, slotCount: error.slotCount } : item)),
          );
        }
        throw error;
      }
    });
  };

  const managing = canManage && isManaging;
  const atLimit = rows.length >= MAX_BINDERS_PER_OWNER;
  const needsUpgrade = Boolean(billing?.access && !canCreateOwnerBinder(billing.access, rows.length) && !atLimit);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-overlay-backdrop
      role="presentation"
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]"
      onClick={onClose}
    >
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- only stops taps inside the sheet reaching the backdrop's close handler */}
      <div
        ref={sheetRef}
        style={
          stagedCreation
            ? {
                bottom: 'var(--dock-clearance)',
                maxHeight: 'calc(100dvh - var(--top-inset) - var(--dock-clearance) - 0.5rem)',
              }
            : undefined
        }
        role="dialog"
        aria-modal="true"
        aria-label="Binders"
        data-testid="binder-switcher"
        className="holo-panel border-border/65 bg-card/97 dark:border-border/50 absolute inset-x-0 bottom-0 mx-auto flex max-h-[min(36rem,calc(100dvh-var(--top-inset)-0.5rem))] w-full max-w-md flex-col rounded-t-[1.6rem] border-t shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] outline-none sm:bottom-4 sm:rounded-[1.6rem] sm:border"
        onClick={(event) => event.stopPropagation()}
      >
        <div data-sheet-grabber className="shrink-0 px-4 pt-3" {...swipe}>
          <div aria-hidden="true" className="bg-muted-foreground/30 mx-auto mb-3 h-1.5 w-10 rounded-full" />
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Binders</p>
              <p className="text-muted-foreground truncate text-xs">
                {canManage
                  ? 'Each has its own slots. A partner shares them all.'
                  : 'Binders in this shared collection.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    setIsManaging((value) => !value);
                    setConfirmDeleteId(null);
                    setRenamingId(null);
                    setLanguagesId(null);
                  }}
                  aria-pressed={isManaging}
                  disabled={!isOnline}
                  className="text-primary hover:bg-primary/10 h-9 rounded-full px-3 text-xs font-semibold disabled:opacity-40"
                >
                  {isManaging ? 'Done' : 'Edit'}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close binders"
                className="text-muted-foreground hover:bg-muted/70 hover:text-foreground -mr-1 flex h-9 w-9 items-center justify-center rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(var(--dock-clearance)+0.75rem)] sm:pb-4">
          {canManage && (
            <div className="mb-3">
              <ActivityButton onOpen={onClose} />
            </div>
          )}
          {canManage && (
            <OverlayLink
              href="/studio"
              onClose={onClose}
              className="border-border/60 holo-tile hover:bg-muted/70 mb-3 flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2.5"
            >
              <Paintbrush className="text-primary h-5 w-5 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Binder Studio</span>
                <span className="text-muted-foreground block text-xs">Customise your binder’s appearance</span>
              </span>
            </OverlayLink>
          )}
          {!isOnline && canManage && (
            <p className="mb-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
              {offlineBinderIds && offlineBinderIds.size > 0
                ? "You're offline. Binders saved on this device still open; the others need a connection."
                : "You're offline. Reconnect to switch or edit binders."}
            </p>
          )}
          <ul className="flex flex-col gap-1.5" aria-label="Your binders">
            {rows.map((binder, index) => {
              const isActive = binder.id === activeBinderId;
              const isRenaming = managing && renamingId === binder.id;
              const isConfirmingDelete = managing && confirmDeleteId === binder.id;
              const isChoosingLanguages = managing && languagesId === binder.id;
              const binderLanguages = binder.cardLanguages ?? DEFAULT_BINDER_CARD_LANGUAGES;
              const hasSlots = (binder.slotCount ?? 0) > 0;
              const openableOffline = isActive || Boolean(offlineBinderIds?.has(binder.id));
              const switchDisabled = managing || (canManage && !isOnline && !openableOffline);
              return (
                <li
                  key={binder.id}
                  className="border-border/60 bg-background/60 dark:border-border/40 rounded-2xl border"
                >
                  {isRenaming ? (
                    <form
                      className="flex items-center gap-1.5 p-1.5"
                      onSubmit={(event) => handleRename(event, binder.id)}
                    >
                      <input
                        autoFocus
                        value={renameDraft}
                        maxLength={BINDER_NAME_MAX_LENGTH}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        aria-label={`New name for ${binder.name}`}
                        className="border-border/60 bg-background h-10 min-w-0 flex-1 rounded-xl border px-3 text-base md:text-sm"
                      />
                      <button
                        type="submit"
                        aria-label="Save name"
                        disabled={busy !== null || !renameDraft.trim()}
                        className="bg-primary text-primary-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-xl disabled:opacity-40"
                      >
                        {busy === `rename:${binder.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel rename"
                        onClick={() => setRenamingId(null)}
                        className="text-muted-foreground hover:bg-muted/70 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={switchDisabled}
                        onClick={() => (isActive ? onClose() : onSwitch(binder.id))}
                        aria-current={isActive ? 'true' : undefined}
                        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 text-left disabled:cursor-default data-[unavailable=true]:opacity-50"
                        data-unavailable={canManage && !isOnline && !openableOffline ? 'true' : undefined}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}
                        >
                          {isActive && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{binder.name}</span>
                          <span className="text-muted-foreground block text-[11px]">
                            {[
                              binder.isDefault ? 'Default' : null,
                              slotLabel(POKEMON_CATALOG.length),
                              canManage && !isOnline
                                ? openableOffline
                                  ? 'Saved on this device'
                                  : 'Needs a connection'
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ') || '\u00a0'}
                          </span>
                        </span>
                      </button>
                      {managing && (
                        <div className="flex shrink-0 items-center pr-1">
                          <button
                            type="button"
                            aria-label={`Move ${binder.name} up`}
                            disabled={index === 0 || busy !== null}
                            onClick={() => handleMove(binder.id, -1)}
                            className="text-muted-foreground hover:bg-muted/70 flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-30"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${binder.name} down`}
                            disabled={index === rows.length - 1 || busy !== null}
                            onClick={() => handleMove(binder.id, 1)}
                            className="text-muted-foreground hover:bg-muted/70 flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-30"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Rename ${binder.name}`}
                            disabled={busy !== null}
                            onClick={() => {
                              setRenamingId(binder.id);
                              setRenameDraft(binder.name);
                              setConfirmDeleteId(null);
                              setLanguagesId(null);
                            }}
                            className="text-muted-foreground hover:bg-muted/70 flex h-9 w-9 items-center justify-center rounded-full"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Card languages for ${binder.name}`}
                            aria-expanded={isChoosingLanguages}
                            disabled={busy !== null}
                            onClick={() => {
                              setLanguagesId(isChoosingLanguages ? null : binder.id);
                              setRenamingId(null);
                              setConfirmDeleteId(null);
                            }}
                            className="text-muted-foreground hover:bg-muted/70 aria-expanded:text-primary flex h-9 w-9 items-center justify-center rounded-full"
                          >
                            <Languages className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${binder.name}`}
                            disabled={rows.length <= 1 || busy !== null}
                            title={rows.length <= 1 ? "You can't delete your only binder" : undefined}
                            onClick={() => {
                              setConfirmDeleteId(binder.id);
                              setDeleteAcknowledged(false);
                              setRenamingId(null);
                              setLanguagesId(null);
                            }}
                            className="text-destructive hover:bg-destructive/10 flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {isChoosingLanguages && (
                    <div
                      role="group"
                      aria-label={`Card languages for ${binder.name}`}
                      className="border-border/60 bg-muted/30 mx-1.5 mb-1.5 rounded-xl border p-2.5"
                    >
                      <p className="text-xs font-semibold">Card languages</p>
                      <p className="text-muted-foreground mt-0.5 text-[11px]">
                        Which printings this binder’s card lists show. Cards you own or want always show.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {CARD_LANGUAGES.map((language) => {
                          const on = binderLanguages.includes(language);
                          return (
                            <button
                              key={language}
                              type="button"
                              aria-pressed={on}
                              disabled={busy !== null || (on && binderLanguages.length === 1)}
                              onClick={() => handleToggleLanguage(binder, language)}
                              className={`h-9 rounded-full border px-3 text-xs font-semibold transition-colors disabled:opacity-60 ${
                                on
                                  ? 'border-primary/35 bg-primary/12 text-primary'
                                  : 'border-border/50 bg-card text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {CARD_LANGUAGE_LABELS[language]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {isConfirmingDelete && (
                    <div
                      role="group"
                      aria-label={`Confirm deleting ${binder.name}`}
                      className="border-destructive/25 bg-destructive/8 text-destructive mx-1.5 mb-1.5 rounded-xl border p-2.5"
                    >
                      <p className="text-xs font-semibold">Delete “{binder.name}”?</p>
                      <p className="mt-0.5 text-[11px] opacity-85">
                        {hasSlots
                          ? `Its ${slotLabel(binder.slotCount)}, wanted cards and share link are deleted for you and your partner. This can't be undone.`
                          : "It's empty. Its share link stops working."}
                      </p>
                      {hasSlots && (
                        <label className="mt-2 flex min-h-9 items-center gap-2 text-[11px] font-medium">
                          <input
                            type="checkbox"
                            checked={deleteAcknowledged}
                            onChange={(event) => setDeleteAcknowledged(event.target.checked)}
                            className="h-4 w-4 accent-current"
                          />
                          Also delete its {slotLabel(binder.slotCount)}
                        </label>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="border-border/60 bg-background text-foreground h-9 flex-1 rounded-xl border text-xs font-semibold"
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null || (hasSlots && !deleteAcknowledged)}
                          onClick={() => handleDelete(binder)}
                          className="bg-destructive flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold text-white disabled:opacity-40"
                        >
                          {busy === `delete:${binder.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Delete binder
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {message && (
            <p role="alert" className="text-destructive mt-2 text-xs">
              {message}
            </p>
          )}

          {canManage && needsUpgrade && (
            <div className="mt-3 space-y-2">
              <p className="text-muted-foreground text-sm">
                Your free plan includes one binder. Your existing binders stay available.
              </p>
              <button
                type="button"
                onClick={upgrade}
                className="bg-primary text-primary-foreground min-h-11 w-full rounded-xl px-3 text-sm font-semibold"
              >
                Upgrade for more binders
              </button>
            </div>
          )}
          {canManage && !needsUpgrade && stagedCreation && (
            <BinderCreationPresets
              {...stagedCreation}
              isOnline={isOnline}
              disabled={atLimit || busy !== null || billing?.loading}
            />
          )}
          {canManage && !needsUpgrade && !stagedCreation && (
            <form onSubmit={handleCreate} className="mt-3 flex items-center gap-1.5">
              <input
                value={newName}
                maxLength={BINDER_NAME_MAX_LENGTH}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={atLimit ? `Up to ${MAX_BINDERS_PER_OWNER} binders` : 'New binder name'}
                aria-label="New binder name"
                disabled={atLimit || !isOnline}
                className="border-border/60 bg-background h-11 min-w-0 flex-1 rounded-xl border px-3 text-base disabled:opacity-50 md:text-sm"
              />
              <button
                type="submit"
                disabled={atLimit || !isOnline || busy !== null || billing?.loading || !newName.trim()}
                className="bg-primary text-primary-foreground flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold disabled:opacity-40"
              >
                {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create
              </button>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
