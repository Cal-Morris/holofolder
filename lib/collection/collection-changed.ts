/** The revision a collection_changed ping carries (migration 127), or null when it carries none and the caller must re-read. */
export function pingRevision(payload: unknown): number | null {
  const revision = (payload as { revision?: unknown } | null)?.revision;
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

/** Folds a burst of pings into one: the highest revision, or null as soon as any ping lacked one. */
export function mergePingRevision(previous: number | null | undefined, next: number | null): number | null {
  if (previous === undefined) return next;
  if (previous === null || next === null) return null;
  return Math.max(previous, next);
}

/**
 * True when this device already holds the pinged revision: its complete read, or an edit the server acknowledged
 * (which settles from a read of its own), is at or past it. A ping without a revision is never covered.
 */
export function pingCovered(
  revision: number | null,
  readRevision: number | null,
  acknowledgedRevisions: readonly number[],
): boolean {
  if (revision === null) return false;
  return (readRevision !== null && readRevision >= revision) || acknowledgedRevisions.some((ack) => ack >= revision);
}
