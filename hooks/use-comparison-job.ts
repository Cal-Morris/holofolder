'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchOfflineResource } from '@/lib/offline-download';
import { pinCardPriceCheck, priceCheckFinish, PRICE_CHECK_SOURCES } from '@/lib/card-price-check-cache';
import { isCardPriceCheck } from '@/lib/card-price-checks';
import { isComparisonJobActive, normalizeComparisonJob, type ComparisonJob } from '@/lib/comparison-jobs';
import type { CheckCompsTarget } from '@/lib/check-comps';

async function request(body: unknown, signal?: AbortSignal) {
  const response = await fetch('/app/api/comparison-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok && !data.needsConfirmation) throw new Error(data.error ?? "Couldn't reach background checks.");
  if (data.job != null) {
    data.job = normalizeComparisonJob(data.job);
    if (!data.job) throw new Error('Invalid background job status.');
  }
  return data;
}
export function useComparisonJob(targets: readonly CheckCompsTarget[], isOnline: boolean, storageKey: string | null) {
  const key = JSON.stringify(targets);
  const cards = useMemo(() => JSON.parse(key) as CheckCompsTarget[], [key]);
  const [job, updateJob] = useState<ComparisonJob | null>(null);
  const setJob = useCallback(
    (next: ComparisonJob | null) => {
      updateJob(next);
      if (storageKey)
        try {
          localStorage.setItem(storageKey, JSON.stringify({ key, job: next }));
        } catch {
          /* Server status remains authoritative. */
        }
    },
    [storageKey, key],
  );
  useEffect(() => {
    const abort = new AbortController();
    void Promise.resolve().then(() => {
      if (!storageKey || abort.signal.aborted) return;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
        const restored = saved?.key === key ? normalizeComparisonJob(saved.job) : null;
        if (restored) updateJob(restored);
      } catch {
        /* A missing/corrupt local status does not affect the server job. */
      }
    });
    return () => abort.abort();
  }, [storageKey, key]);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncedJobId, setSyncedJobId] = useState<string | null>(null);
  const active = useRef(true);
  const actionVersion = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!cards.length || !isOnline) return;
    const abort = new AbortController();
    const version = actionVersion.current;
    void request({ action: 'inspect', cards }, abort.signal)
      .then((data) => {
        if (!abort.signal.aborted && actionVersion.current === version) setJob(data.job);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [cards, isOnline, setJob]);
  useEffect(() => {
    if (!job || !isComparisonJobActive(job) || !isOnline) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = actionVersion.current;
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(poll, 3000);
        return;
      }
      try {
        const response = await fetch(`/app/api/comparison-jobs?id=${job.id}`, {
          cache: 'no-store',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!abort.signal.aborted && actionVersion.current === version) {
          const next = normalizeComparisonJob(data.job);
          if (!next) throw new Error('Invalid job status');
          setJob(next);
          setMessage(null);
        }
      } catch {
        if (!abort.signal.aborted)
          setMessage('Connection interrupted. Checks continue on the server; reconnect to see progress.');
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 3000);
    };
    void poll();
    const visible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      abort.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [job?.id, job?.status, isOnline]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (job?.status !== 'completed' || syncedJobId === job.id || !isOnline) return;
    const abort = new AbortController();
    void (async () => {
      for (let i = 0; i < cards.length; i += 25) {
        const batch = cards.slice(i, i + 25).map((card) => ({ ...card, finish: priceCheckFinish(card.finish) }));
        const response = await fetchOfflineResource(
          `/app/api/card-price-checks?${new URLSearchParams({ cards: JSON.stringify(batch) })}`,
          { signal: abort.signal },
        );
        const data = await response.json();
        if (!Array.isArray(data.checks)) throw new Error('Invalid saved checks');
        for (const target of batch) {
          const saved = data.checks.find(
            (value: { cardId?: unknown; finish?: unknown }) =>
              value?.cardId === target.cardId && value.finish === target.finish,
          );
          if (!saved) throw new Error('Incomplete saved checks');
          for (const source of PRICE_CHECK_SOURCES)
            if (isCardPriceCheck(saved[source]))
              await pinCardPriceCheck(target.cardId, target.finish, source, saved[source]);
        }
      }
      if (!abort.signal.aborted) setSyncedJobId(job.id);
    })().catch(() => {
      if (!abort.signal.aborted)
        setMessage('Checks finished on the server. Prepare for a show can retry saving them on this device.');
    });
    return () => abort.abort();
  }, [job?.id, job?.status, cards, isOnline, syncedJobId]);
  const start = useCallback(
    async (confirmed = false) => {
      if (busy) return;
      actionVersion.current++;
      setBusy(true);
      setEstimate(null);
      setMessage(null);
      try {
        const data = await request({ action: 'start', cards, confirmed });
        if (!active.current) return;
        if (data.needsConfirmation) setEstimate(data.needed);
        else setJob(data.job);
      } catch (error) {
        if (active.current) setMessage(error instanceof Error ? error.message : "Couldn't start background checks.");
      } finally {
        if (active.current) setBusy(false);
      }
    },
    [cards, busy, setJob],
  );
  const stop = async () => {
    if (!job || busy) return;
    actionVersion.current++;
    setBusy(true);
    try {
      const data = await request({ action: 'stop', id: job.id });
      if (active.current) setJob(data.job);
    } catch {
      if (active.current) setMessage("Couldn't stop the job. Reconnect and try again; checks may still be running.");
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return {
    job,
    syncedJobId,
    estimate,
    busy,
    message,
    start,
    stop,
    cancelConfirmation: () => {
      setEstimate(null);
      setMessage('Price check cancelled.');
    },
  };
}
