'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import {
  activityChanges,
  activityActor,
  activityCacheKey,
  activityTime,
  parseActivityPage,
  readActivityCache,
  sameActivityScope,
  writeActivityCache,
  type ActivityEvent,
  type ActivityScope,
} from '@/lib/collection-activity';
import { activitySummary, activityReceipt, activityDay } from '@/lib/activity-presentation';
import { NativeActivityRecovery, type NativeRecoveryBinding } from '@/components/native-activity-recovery';
import { isNativeRecoveryEvent } from '@/lib/collection/native-recovery-intent';
import type { ActivityInitialFilter } from '@/components/collection-activity-context';
import type { Binder } from '@/lib/binders/model';
import type { CollectedPokemon } from '@/lib/domain/cards';
import { Select } from '@/components/ui/select';

interface Props {
  nativeRecovery?: NativeRecoveryBinding;
  onSelectEvent?: (id: string) => void;
  scope: ActivityScope | null;
  initialFilter: ActivityInitialFilter;
  binderId: string | null;
  binders: readonly Binder[];
  collection: readonly CollectedPokemon[];
  pendingCount: number;
  isOnline: boolean;
  onClose: () => void;
  onInvalidScope: () => void;
  onVerify: () => void;
  onOpenPokemon: (id: number) => void;
}
const control = 'min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-sm';

export default function CollectionActivitySheet(props: Props) {
  const { scope, initialFilter, binderId, binders, pendingCount, isOnline, onClose } = props;
  const panel = useRef<HTMLDivElement | null>(null);
  useOverlay(true, onClose, { containerRef: panel });
  const swipe = useSwipeToDismiss(panel, onClose);
  const [filters, setFilters] = useState(() =>
    new URLSearchParams({
      limit: '50',
      ...(binderId ? { collectionId: binderId } : {}),
      ...(initialFilter.pokemonId ? { pokemonId: String(initialFilter.pokemonId) } : {}),
      ...(initialFilter.inventoryItemId ? { inventoryItemId: initialFilter.inventoryItemId } : {}),
    }).toString(),
  );
  const [showFilters, setShowFilters] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const updated = () => setRevision((v) => v + 1);
    window.addEventListener('holofolder-activity-updated', updated);
    return () => window.removeEventListener('holofolder-activity-updated', updated);
  }, []);
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams({ limit: '50' });
    for (const [key, value] of data)
      if (typeof value === 'string' && value.trim()) {
        params.set(
          key === 'collectionIdText'
            ? 'collectionId'
            : key === 'actorIdText'
              ? 'actorId'
              : key === 'actionText'
                ? 'action'
                : key,
          ['since', 'until'].includes(key)
            ? new Date(`${value}${key === 'since' ? 'T00:00:00.000Z' : 'T23:59:59.999Z'}`).toISOString()
            : value.trim(),
        );
      }
    setFilters(params.toString());
    setShowFilters(false);
  };
  const selected = new URLSearchParams(filters);
  return createPortal(
    <div className="fixed inset-0 z-40">
      <div data-overlay-backdrop className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Collection Activity"
        className="border-border bg-card text-foreground absolute inset-x-0 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-0.5rem)] w-full max-w-lg flex-col rounded-t-3xl border shadow-xl sm:rounded-3xl"
      >
        <header data-sheet-grabber className="shrink-0 px-4 pt-3 pb-2" {...swipe}>
          <div aria-hidden className="bg-muted-foreground/30 mx-auto mb-2 h-1 w-10 rounded-full" />
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Activity</h2>
            <button
              type="button"
              aria-label="Close Activity"
              className="hover:bg-muted flex h-10 w-10 items-center justify-center rounded-full"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 text-sm [overflow-wrap:anywhere]">
          {pendingCount > 0 && (
            <p role="status" className="bg-muted/60 mb-3 rounded-xl p-3 text-xs">
              {pendingCount} {pendingCount === 1 ? 'change waiting' : 'changes waiting'} to sync. Undo will be available
              once they’re saved.
            </p>
          )}
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              className="border-border min-h-10 rounded-lg border px-3"
              aria-expanded={showFilters}
              onClick={() => setShowFilters((v) => !v)}
            >
              Filters
            </button>
            <button
              type="button"
              className="border-border min-h-10 rounded-lg border px-3"
              disabled={!isOnline}
              onClick={() => {
                if (scope) setRevision((v) => v + 1);
                else props.onVerify();
              }}
            >
              Refresh
            </button>
          </div>
          <p className="text-muted-foreground mb-2 text-xs">
            {selected.has('collectionId')
              ? (binders.find((b) => b.id === selected.get('collectionId'))?.name ?? 'Previous collection')
              : selected.has('id')
                ? 'Selected change'
                : selected.has('recoveryOfEventId')
                  ? 'Undo history'
                  : 'All collections'}
            {selected.has('pokemonId') ? ` · Pokémon #${selected.get('pokemonId')}` : ''}
            {selected.has('inventoryItemId') ? ' · Selected copy' : ''}
          </p>
          {showFilters && (
            <form onSubmit={apply} className="border-border mb-3 grid grid-cols-2 gap-2 rounded-xl border p-3">
              <label className="col-span-2 text-xs">
                Collection
                <Select name="collectionId" defaultValue={selected.get('collectionId') ?? ''} className="w-full">
                  <option value="">All collections</option>
                  {binders.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="col-span-2 text-xs">
                Person
                <Select name="actorId" defaultValue={selected.get('actorId') ?? ''} className="w-full">
                  <option value="">Everyone</option>
                  {scope && <option value={scope.accountId}>You</option>}
                  {scope?.memberIds
                    ?.filter((id) => id !== scope.accountId)
                    .map((id) => (
                      <option key={id} value={id}>
                        Collection partner
                      </option>
                    ))}
                </Select>
              </label>
              <label className="text-xs">
                From (UTC)
                <input
                  type="date"
                  name="since"
                  defaultValue={selected.get('since')?.slice(0, 10)}
                  className={control}
                />
              </label>
              <label className="text-xs">
                Through (UTC)
                <input
                  type="date"
                  name="until"
                  defaultValue={selected.get('until')?.slice(0, 10)}
                  className={control}
                />
              </label>
              <label className="col-span-2 text-xs">
                Action
                <Select name="action" defaultValue={selected.get('action') ?? ''} className="w-full">
                  <option value="">All changes</option>
                  <option value="collection_item">Cards and wanted lists</option>
                  <option value="collection_change">Collections and settings</option>
                  <option value="legacy">Older recorded changes</option>
                </Select>
              </label>
              <button
                type="submit"
                className="bg-primary text-primary-foreground col-span-2 min-h-10 rounded-lg px-3 font-medium"
              >
                Apply filters
              </button>
            </form>
          )}
          {scope ? (
            <ActivityResults
              key={`${JSON.stringify(scope)}:${filters}:${revision}`}
              {...props}
              scope={scope}
              query={filters}
              onSelectEvent={(id) => setFilters(new URLSearchParams({ id }).toString())}
            />
          ) : (
            <p role="status" className="py-4">
              {isOnline ? 'Loading activity…' : 'Connect to load activity.'}
            </p>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ActivityResults(props: Props & { scope: ActivityScope; query: string }) {
  const { query } = props;
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<Array<string | null>>([]);
  const params = new URLSearchParams(query);
  if (cursor) params.set('cursor', cursor);
  const pageQuery = params.toString();
  return (
    <div>
      <ActivityPageView
        key={pageQuery}
        {...props}
        pageQuery={pageQuery}
        onNext={(next) => {
          setPrevious((v) => [...v, cursor]);
          setCursor(next);
        }}
      />
      {previous.length > 0 && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="border-border min-h-10 rounded-lg border px-3"
            onClick={() => {
              setCursor(previous.at(-1) ?? null);
              setPrevious((v) => v.slice(0, -1));
            }}
          >
            Newer page
          </button>
        </div>
      )}
      {/* Each page owns its older cursor; no client-side filtering or offset pagination. */}
    </div>
  );
}

function ActivityPageView({
  scope,
  pageQuery,
  isOnline,
  onInvalidScope,
  onNext,
  ...props
}: Props & { scope: ActivityScope; pageQuery: string; onNext: (cursor: string) => void }) {
  const key = activityCacheKey(scope, pageQuery);
  const [saved, setSaved] = useState(() => readActivityCache(localStorage, scope, key));
  const [loading, setLoading] = useState(isOnline);
  const [cached, setCached] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 8000);
    void fetch(`/app/api/collection-activity?${pageQuery}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: abort.signal,
    })
      .then(async (response) => {
        const value = await response.json();
        if (cancelled) return;
        if (response.status === 401 || response.status === 403) {
          onInvalidScope();
          return;
        }
        if (!response.ok)
          throw new Error(
            typeof value.error === 'string' ? value.error : 'History is unavailable. Reconnect and refresh.',
          );
        if (!sameActivityScope(scope, value.scope)) {
          onInvalidScope();
          return;
        }
        const page = parseActivityPage(value);
        if (!page || typeof value.syncedAt !== 'string') throw new Error('History could not be read.');
        setSaved({ page, syncedAt: value.syncedAt });
        setCached(false);
        writeActivityCache(localStorage, scope, key, page, value.syncedAt);
      })
      .catch((error) => {
        if (!cancelled)
          setError(
            error instanceof Error && error.name !== 'AbortError'
              ? error.message
              : 'History request timed out. Refresh to try again.',
          );
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      abort.abort();
      window.clearTimeout(timeout);
    };
  }, [scope, pageQuery, isOnline, key, onInvalidScope]);
  return (
    <>
      {loading && (
        <p role="status" className="py-2 text-xs">
          Loading activity…
        </p>
      )}
      {error && (
        <p role="alert" className="bg-destructive/10 my-2 rounded-lg p-3 text-sm">
          {error}
        </p>
      )}
      {saved && (cached || !isOnline) && (
        <p className="text-muted-foreground mb-3 text-xs">
          Saved activity · Last updated {activityTime(saved.syncedAt)}. Reconnect for the latest changes and Undo.
        </p>
      )}
      {!saved && !loading && (
        <p className="py-4">{!isOnline ? 'Connect to load this activity.' : 'Couldn’t load activity. Try Refresh.'}</p>
      )}
      {saved?.page.data.length === 0 && (
        <p className="py-4">
          {cached || !isOnline
            ? 'No saved activity on this page. Reconnect to check for more.'
            : 'No activity matches these filters.'}
        </p>
      )}
      <ol className="space-y-2" aria-label="Committed activity">
        {saved?.page.data.map((event, index) => {
          const day = activityDay(event.recorded_at);
          return (
            <ActivityEntry
              key={event.id}
              event={event}
              undone={saved.page.data.some((other) => other.recovery_of_event_id === event.id)}
              day={index === 0 || day !== activityDay(saved.page.data[index - 1].recorded_at) ? day : undefined}
              {...props}
              scope={scope}
              isOnline={isOnline}
              onInvalidScope={onInvalidScope}
            />
          );
        })}
      </ol>
      {saved?.page.nextCursor && (
        <button
          type="button"
          className="border-border mt-3 min-h-10 rounded-lg border px-3"
          onClick={() => onNext(saved.page.nextCursor!)}
        >
          Older page
        </button>
      )}
    </>
  );
}

function ActivityEntry({
  event,
  day,
  binders,
  isOnline,
  pendingCount,
  scope,
  nativeRecovery,
  onSelectEvent,
}: Props & { event: ActivityEvent; day?: string; undone: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [count, setCount] = useState(10);
  const summary = activitySummary(event, binders);
  const receipt = activityReceipt(event);
  const changes = nativeRecovery ? activityChanges(event).map((c) => ({ ...c, subtitle: '' })) : receipt.changes;
  const hasDetails = nativeRecovery ? changes.length > 0 : receipt.hasDetails;
  const person = activityActor(event, scope?.accountId, scope?.memberIds);
  return (
    <li>
      {day && <h3 className="text-muted-foreground pt-3 pb-2 text-xs font-medium">{day}</h3>}
      <article className="border-border/70 bg-background/50 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-xl border p-3">
        <div className="min-w-0 wrap-anywhere">
          <p className="text-sm leading-snug font-medium">{summary.title}</p>
          {summary.subtitle && <p className="text-muted-foreground mt-1 text-xs">{summary.subtitle}</p>}
          <p className="text-muted-foreground mt-1 text-xs">
            {person.startsWith('Account ') ? 'Previous member' : person} ·{' '}
            <time dateTime={event.recorded_at}>
              {new Date(event.recorded_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </time>
          </p>
        </div>
        {nativeRecovery && isNativeRecoveryEvent(event) && (
          <NativeActivityRecovery event={event} binding={nativeRecovery} disabled={!isOnline || pendingCount > 0} />
        )}
        {nativeRecovery && !isNativeRecoveryEvent(event) && (
          <p className="text-muted-foreground col-span-2 mt-2 text-xs">This change can’t be undone from here.</p>
        )}
        {event.recovery_of_event_id && (
          <p className="text-muted-foreground col-span-2 mt-2 text-xs">
            <button
              type="button"
              className="min-h-10 underline"
              onClick={() => onSelectEvent?.(event.recovery_of_event_id!)}
            >
              View original
            </button>
          </p>
        )}
        {hasDetails && (
          <div className="col-span-2 min-w-0">
            <button
              type="button"
              aria-expanded={expanded}
              className="text-muted-foreground hover:bg-muted mt-1 min-h-10 rounded-lg px-3 text-xs"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Hide changes' : summary.count > 1 ? `View ${summary.count} changes` : 'View changes'}
            </button>
            {expanded && (
              <div className="border-border/60 mt-2 space-y-3 border-t pt-3 text-xs wrap-anywhere">
                {changes.slice(0, count).map((change, index) => (
                  <section key={index} className="bg-muted/40 rounded-lg p-3">
                    {summary.count > 1 && <h4 className="font-medium">{change.title}</h4>}
                    {change.subtitle && summary.count > 1 && (
                      <p className="text-muted-foreground mt-1">{change.subtitle}</p>
                    )}
                    {change.fields.length > 0 && (
                      <dl className="space-y-2">
                        {change.fields.map((field) => (
                          <div key={field.label}>
                            <dt className="text-muted-foreground">{field.label}</dt>
                            <dd className="mt-0.5">
                              {field.before}{' '}
                              <span className="text-muted-foreground px-1" aria-label="changed to">
                                →
                              </span>{' '}
                              {field.after}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </section>
                ))}
                {changes.length > count && (
                  <button
                    type="button"
                    className="border-border min-h-10 rounded-lg border px-3"
                    onClick={() => setCount((c) => c + 25)}
                  >
                    Show more changes ({changes.length - count} remaining)
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </article>
    </li>
  );
}
