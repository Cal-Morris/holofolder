import type { ScanCell } from '@/lib/scan-destinations';

/** Explicit loopback BrowserCollectionSession fixture only. Never a recognition/provider claim.
 * Real capture, mapping, review, queue, sender and scoped reads surround this detector seam. */
export async function syntheticPageDetection(file: File, _rows: number, _cols: number): Promise<ScanCell[]> {
  const data = JSON.parse(await file.text()) as { cells: ScanCell[]; deferred?: boolean };
  if (data.deferred)
    await new Promise<void>((resolve) =>
      window.addEventListener('synthetic-host-scan-release', () => resolve(), { once: true }),
    );
  return data.cells;
}
