import { DEVELOPER_OPERATIONS } from './operations';

export interface ApiPerformanceSample {
  operation: string;
  phase: 'first' | 'repeat';
  status: number;
  clientMs: number;
  serverMs: number | null;
  authMs: number | null;
  operationMs: number | null;
  bytes: number;
  scenario?: string;
  expectedStatus?: number;
  assertionsPassed?: boolean;
}
export const PROVIDER_PERFORMANCE_OPERATIONS = new Set([
  'refresh_prices',
  'refresh_price_checks',
  'get_listings',
  'start_comparison_job',
  // Runs the picture model (about 200 ms of CPU), so the 30 ms target doesn't apply either.
  'identify_card',
]);
export function readServerTiming(header: string | null, name: string): number | null {
  const match = header
    ?.split(',')
    .map((part) => part.trim())
    .find((part) => part.split(';')[0] === name)
    ?.match(/(?:^|;)\s*dur=([\d.]+)(?:;|$)/);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function summarizeApiPerformance(samples: readonly ApiPerformanceSample[]) {
  return DEVELOPER_OPERATIONS.map((operation) => {
    const measured = samples.filter((sample) => sample.operation === operation.name);
    const primary = measured.filter(
      (sample) =>
        (sample.scenario ?? 'default') === 'default' &&
        ((sample.status >= 200 && sample.status < 300) ||
          (operation.name === 'start_comparison_job' &&
            sample.status === 403 &&
            sample.expectedStatus === 403 &&
            sample.assertionsPassed === true)) &&
        sample.assertionsPassed !== false,
    );
    const repeat = primary.filter((sample) => sample.phase === 'repeat');
    const selected = repeat.length ? repeat : primary;
    const serverMedianMs = median(selected.flatMap((sample) => (sample.serverMs === null ? [] : [sample.serverMs])));
    return {
      operation: operation.name,
      method: operation.method,
      path: operation.path,
      write: operation.write,
      provider: PROVIDER_PERFORMANCE_OPERATIONS.has(operation.name),
      samples: measured.length,
      repeats: repeat.length,
      verified:
        primary.length > 0 &&
        measured.every(
          (sample) =>
            (sample.expectedStatus
              ? sample.status === sample.expectedStatus
              : sample.status >= 200 && sample.status < 300) &&
            (Number(sample.expectedStatus ?? 200) >= 400 || sample.serverMs !== null) &&
            sample.assertionsPassed !== false,
        ),
      firstMs: measured[0]?.clientMs ?? null,
      medianMs: median(selected.map((sample) => sample.clientMs)),
      serverMedianMs,
      authMedianMs: median(selected.flatMap((sample) => (sample.authMs === null ? [] : [sample.authMs]))),
      operationMedianMs: median(
        selected.flatMap((sample) => (sample.operationMs === null ? [] : [sample.operationMs])),
      ),
      maxMs: measured.length ? Math.max(...measured.map((sample) => sample.clientMs)) : null,
      targetMs: PROVIDER_PERFORMANCE_OPERATIONS.has(operation.name) ? null : 30,
      targetMet:
        PROVIDER_PERFORMANCE_OPERATIONS.has(operation.name) || serverMedianMs === null ? null : serverMedianMs <= 30,
    };
  });
}

/** Coverage is distinct from successful execution and its latency targets. */
export function summarizeApiSmokeCoverage(samples: readonly ApiPerformanceSample[]) {
  return summarizeApiPerformance(samples).map((row) => {
    const staged = DEVELOPER_OPERATIONS.find((op) => op.name === row.operation)!.admission === 'staged';
    const measured = samples.filter((sample) => sample.operation === row.operation);
    const stagedDenialVerified =
      staged &&
      measured.length > 0 &&
      measured.every(
        (sample) =>
          sample.scenario === 'native-staged' &&
          sample.status === 503 &&
          sample.expectedStatus === 503 &&
          sample.assertionsPassed === true,
      );
    const successVerified = !staged && row.verified && measured.every((sample) => sample.assertionsPassed === true);
    return {
      operation: row.operation,
      successVerified,
      stagedDenialVerified,
      coverage: successVerified
        ? ('successVerified' as const)
        : stagedDenialVerified
          ? ('stagedDenialVerified' as const)
          : ('uncovered' as const),
    };
  });
}

export function apiSmokeExitCode(
  samples: readonly ApiPerformanceSample[],
  failures: readonly string[],
  cleanup: { users: boolean; artwork: readonly string[] },
  strictPerformance = false,
): 0 | 1 | 2 {
  if (
    failures.length ||
    summarizeApiSmokeCoverage(samples).some((row) => row.coverage === 'uncovered') ||
    !cleanup.users
  )
    return 1;
  if (strictPerformance && summarizeApiPerformance(samples).some((row) => row.targetMet === false)) return 1;
  return cleanup.artwork.length ? 2 : 0;
}
