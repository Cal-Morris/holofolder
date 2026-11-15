'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { createPortal } from 'react-dom';
import { CALIBRATION_MM, PAPER, PER_SHEET, gridOrigin, type PaperSize } from '@/lib/print-placeholders';
import { pageArtImageStyle, type PageArtSlice, type PageArtSource } from '@/lib/page-art';
import styles from './placeholder-print.module.css';
import { CropMarks } from './print-crop-marks';

/** Pictures that haven't loaded by then print as blank slices rather than hold the print dialog (dead Wi-Fi). */
const IMAGE_WAIT_MS = 8000;
const mm = (value: number) => `${value}mm`;

export interface PageArtPrintJob {
  slices: PageArtSlice[];
  paper: PaperSize;
}

function waitForImage(src: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = image.onerror = () => resolve();
    image.src = src;
  });
}

/**
 * Page art at true size, nine 63 × 88 mm pocket slices to a sheet on the same grid, crop marks and calibration line
 * as the placeholders. Waits for the pictures (or a timeout), opens the print dialog once, then calls onDone.
 */
export default function PageArtPrint({
  job,
  imageFor,
  onDone,
}: {
  job: PageArtPrintJob;
  imageFor: (source: PageArtSource) => string | null | undefined;
  onDone: () => void;
}) {
  const [ready, setReady] = useState(false);
  const done = useEffectEvent(() => onDone());
  const sources = [...new Set(job.slices.flatMap((slice) => imageFor(slice.art.source) ?? []))];
  const sourceKey = sources.join('\n');
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => setReady(true), IMAGE_WAIT_MS);
    void Promise.all(sourceKey.split('\n').filter(Boolean).map(waitForImage)).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sourceKey]);
  useEffect(() => {
    if (!ready) return;
    window.addEventListener('afterprint', done, { once: true });
    // Let the pictures paint before the dialog snapshots the page.
    const frame = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', done);
    };
  }, [ready]);

  const paper = PAPER[job.paper];
  const origin = gridOrigin(job.paper);
  const sheets = Array.from({ length: Math.ceil(job.slices.length / PER_SHEET) }, (_, i) =>
    job.slices.slice(i * PER_SHEET, (i + 1) * PER_SHEET),
  );
  return createPortal(
    <div className={styles.root} data-page-art-print data-ready={ready ? '' : undefined}>
      <style>{`@page { size: ${paper.css}; margin: 0; }`}</style>
      {sheets.map((sheet, index) => (
        <section
          key={`${sheet[0]!.art.id}:${sheet[0]!.page}:${sheet[0]!.row}:${sheet[0]!.col}`}
          className={styles.sheet}
          style={{ width: mm(paper.width), height: mm(paper.height - 1) }}
          aria-label={`Printed page ${index + 1}`}
        >
          <CropMarks origin={origin} />
          {index === 0 && (
            <>
              <div className={styles.calibration} style={{ left: mm(origin.left - 3), top: mm(origin.top + 18) }} />
              <p
                className={styles.calibrationLabel}
                style={{ left: mm(origin.left - 6.5), top: mm(origin.top + 18 + CALIBRATION_MM) }}
              >
                {CALIBRATION_MM} mm · print at 100% (Actual size)
              </p>
            </>
          )}
          <div className={styles.grid} style={{ left: mm(origin.left), top: mm(origin.top) }}>
            {sheet.map((slice) => {
              const src = imageFor(slice.art.source);
              return (
                <div
                  key={`${slice.art.id}:${slice.page}:${slice.row}:${slice.col}`}
                  className={styles.slice}
                  data-page-art-slice
                >
                  <div
                    className={styles.slicePicture}
                    style={{
                      left: mm(-slice.left),
                      top: mm(-slice.top),
                      width: mm(slice.width),
                      height: mm(slice.height),
                    }}
                  >
                    {/* oxlint-disable-next-line nextjs/no-img-element -- a print-only picture at full size, cropped to one pocket */}
                    {src && <img src={src} alt="" style={pageArtImageStyle(slice.art.frame)} />}
                  </div>
                  <span className={styles.sliceLabel}>
                    PAGE ART · P{slice.page} {String.fromCharCode(65 + slice.row)}
                    {slice.col + 1}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>,
    document.body,
  );
}
