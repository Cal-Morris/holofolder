'use client';

import { useBillingContext } from '@/hooks/use-billing';
import { useEffect, useMemo, useRef } from 'react';
import { Receipt, Square } from 'lucide-react';
import CheckCompsConfirm from '@/components/check-comps-confirm';
import { checkCompsTargets, type CheckCompsTarget } from '@/lib/check-comps';
import type { CollectedPokemon } from '@/lib/domain/cards';
import { useComparisonJob } from '@/hooks/use-comparison-job';
import { isComparisonJobActive } from '@/lib/comparison-jobs';
import { collectionCompsTargets } from '@/lib/collection-comps';

export default function CollectionPriceCheck({
  collection,
  kind,
  isOnline,
  ownerId,
  label,
  scopeLabel = 'this binder',
  onComplete,
}: {
  collection: readonly CollectedPokemon[];
  ownerId: string | null;
  kind: 'wanted' | 'owned';
  isOnline: boolean;
  label?: string;
  scopeLabel?: string;
  onComplete?: () => void;
}) {
  const targets = useMemo(
    () => checkCompsTargets(collectionCompsTargets(collection, kind), 'collection'),
    [collection, kind],
  );
  return (
    <BackgroundPriceCheck
      targets={targets}
      kind={kind}
      ownerId={ownerId}
      isOnline={isOnline}
      label={label}
      scopeLabel={scopeLabel}
      onComplete={onComplete}
    />
  );
}

export function BackgroundPriceCheck({
  targets,
  kind,
  ownerId,
  isOnline,
  label,
  scopeLabel = 'this binder',
  onComplete,
}: {
  targets: readonly CheckCompsTarget[];
  kind: 'wanted' | 'owned';
  ownerId: string | null;
  isOnline: boolean;
  label?: string;
  scopeLabel?: string;
  onComplete?: () => void;
}) {
  const billing = useBillingContext();
  // oxlint-disable-next-line react-doctor/no-event-handler -- misreads the job hook's inputs as a faked handler; the hook owns its effects
  const jobKey = ownerId ? `comparison-job:${ownerId}:${kind}` : null;
  // oxlint-disable-next-line react-doctor/no-event-handler -- misreads the job hook's inputs as a faked handler; the hook owns its effects
  const comparison = useComparisonJob(targets, isOnline, jobKey);
  const { job, syncedJobId, estimate, busy, message, start, stop, cancelConfirmation } = comparison;
  const running = Boolean(job && isComparisonJobActive(job));
  const progress = job?.progress;
  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (job?.status === 'completed' && syncedJobId === job.id && notified.current !== job.id) {
      notified.current = job.id;
      // oxlint-disable-next-line react-doctor/no-prop-callback-in-effect -- fires once when a job finishes syncing, which no handler here sees
      onComplete?.();
    }
  }, [job, syncedJobId, onComplete]);
  const begin = () => {
    if (billing && !billing.premium) {
      billing.upgrade();
      return;
    }
    void start();
  };

  return (
    <div className="shrink-0 space-y-1 px-1 py-1" data-testid="collection-price-check">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {running && estimate === null ? (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={busy || !isOnline}
            aria-label="Stop checking prices"
            className="bg-muted/70 inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold"
          >
            <Square className="h-3.5 w-3.5" aria-hidden />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={begin}
            disabled={!isOnline || !targets.length || running || busy}
            className="bg-muted/70 inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-50"
          >
            <Receipt className="h-4 w-4" aria-hidden />
            {label ?? `Check ${kind} prices`}
          </button>
        )}
        <span className="text-muted-foreground text-sm">
          {targets.length} eligible printing{targets.length === 1 ? '' : 's'} in {scopeLabel}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        eBay asking prices + sold comps. English, non-jumbo cards; duplicates checked once. We’ll notify you when
        finished if notifications are enabled.
      </p>
      <p role="status" className="text-muted-foreground text-xs">
        {message ??
          (!isOnline
            ? running
              ? 'Offline. Checks continue on the server.'
              : 'Connect to check prices.'
            : running
              ? `Checking ${progress?.done ?? 0}/${progress?.total ?? targets.length} in background… You can close the app.`
              : job?.status === 'completed'
                ? 'Finished. Checks saved on the server; Settings → Offline & app downloads them onto this device.'
                : job?.status === 'cancelled'
                  ? 'Stopped. Completed checks are saved.'
                  : job?.status === 'failed'
                    ? 'Check interrupted on the server. Retry to reuse completed checks.'
                    : null)}
        {progress && (
          <>
            {' '}
            {progress.checked} checked, {progress.fresh} already saved, {progress.failed} incomplete.{' '}
            {Object.values(progress.stopped).join(' ')}
          </>
        )}
      </p>
      {running && estimate === null && (
        <progress
          aria-label="Prices checked"
          value={progress?.done ?? 0}
          max={progress?.total || targets.length || 1}
          className="accent-primary h-1 w-full"
        />
      )}
      {estimate !== null && (
        <CheckCompsConfirm
          cardsNeedingSoldcomps={estimate}
          onConfirm={() => void start(true)}
          onCancel={cancelConfirmation}
        />
      )}
    </div>
  );
}
