'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CALIBRATION_MM,
  CARD_MM,
  PAPER,
  SHEET_COLS,
  SHEET_ROWS,
  gridOrigin,
  positionLabel,
  type PaperSize,
  type PlaceholderStyle,
  type PrintSheet,
  type PrintWant,
} from '@/lib/print-placeholders';
import styles from './placeholder-print.module.css';

/** How long to wait for card images before printing the rest as ink saver placeholders (dead Wi-Fi, offline). */
const IMAGE_WAIT_MS = 8000;
const mm = (value: number) => `${value}mm`;

export interface PlaceholderPrintJob {
  sheets: PrintSheet[];
  paper: PaperSize;
  style: PlaceholderStyle;
  showPosition: boolean;
}

/**
 * The printout, portalled into <body> and hidden on screen. It waits until every card image has loaded or failed
 * (failed or missing images print the ink saver layout, never a broken image), then opens the print dialog once.
 */
export default function PlaceholderPrint({ job, onDone }: { job: PlaceholderPrintJob; onDone: () => void }) {
  const withImages = job.style === 'image' ? job.sheets.flat().filter((w): w is PrintWant => !!w && !!w.images[0]) : [];
  const [settled, setSettled] = useState(() => new Set<string>());
  const [timedOut, setTimedOut] = useState(false);
  const printed = useRef(false);
  const done = useEffectEvent(() => onDone());
  const ready = timedOut || withImages.every((want) => settled.has(want.key));

  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), IMAGE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!ready || printed.current) return;
    printed.current = true;
    window.addEventListener('afterprint', done, { once: true });
    // Let the last image swap paint before the dialog snapshots the page.
    const frame = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('afterprint', done);
    };
  }, [ready]);

  const settle = (key: string) => setSettled((current) => (current.has(key) ? current : new Set(current).add(key)));
  const paper = PAPER[job.paper];
  const origin = gridOrigin(job.paper);

  return createPortal(
    <div className={styles.root} data-placeholder-print data-ready={ready ? '' : undefined}>
      <style>{`@page { size: ${paper.css}; margin: 0; }`}</style>
      {job.sheets.map((sheet, index) => (
        <section
          key={sheet.find(Boolean)?.key}
          className={styles.sheet}
          style={{ width: mm(paper.width), height: mm(paper.height - 1) }}
          aria-label={`Printed page ${index + 1}`}
        >
          {cropMarks(origin)}
          {index === 0 && (
            <>
              <div
                className={styles.calibration}
                data-calibration
                style={{ left: mm(origin.left - 3), top: mm(origin.top + 18) }}
              />
              <p
                className={styles.calibrationLabel}
                style={{ left: mm(origin.left - 6.5), top: mm(origin.top + 18 + CALIBRATION_MM) }}
              >
                {CALIBRATION_MM} mm · print at 100% (Actual size)
              </p>
            </>
          )}
          <div className={styles.grid} style={{ left: mm(origin.left), top: mm(origin.top) }}>
            {sheet.map((want, cell) =>
              want ? (
                <Placeholder
                  key={want.key}
                  want={want}
                  style={job.style}
                  showPosition={job.showPosition}
                  giveUp={timedOut}
                  onSettled={settle}
                />
              ) : (
                <div key={`blank-${cell}`} aria-hidden />
              ),
            )}
          </div>
        </section>
      ))}
    </div>,
    document.body,
  );
}

function cropMarks(origin: { left: number; top: number }) {
  const marks = [];
  const width = SHEET_COLS * CARD_MM.width;
  const height = SHEET_ROWS * CARD_MM.height;
  for (let col = 0; col <= SHEET_COLS; col++) {
    const x = origin.left + col * CARD_MM.width - 0.1;
    marks.push({ left: x, top: origin.top - 4.5, width: 0.2, height: 3 });
    marks.push({ left: x, top: origin.top + height + 1.5, width: 0.2, height: 3 });
  }
  for (let row = 0; row <= SHEET_ROWS; row++) {
    const y = origin.top + row * CARD_MM.height - 0.1;
    marks.push({ left: origin.left - 4.5, top: y, width: 3, height: 0.2 });
    marks.push({ left: origin.left + width + 1.5, top: y, width: 3, height: 0.2 });
  }
  return marks.map((m) => (
    <span
      key={`${m.left}:${m.top}`}
      aria-hidden
      className={styles.mark}
      style={{ left: `${m.left}mm`, top: `${m.top}mm`, width: `${m.width}mm`, height: `${m.height}mm` }}
    />
  ));
}

function Placeholder({
  want,
  style,
  showPosition,
  giveUp,
  onSettled,
}: {
  want: PrintWant;
  style: PlaceholderStyle;
  showPosition: boolean;
  giveUp: boolean;
  onSettled: (key: string) => void;
}) {
  // Try the full image, then the small rendition (often the one saved for offline), then print the outline.
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = style === 'image' && !(giveUp && !loaded) ? want.images[attempt] : undefined;
  const position = showPosition ? positionLabel(want) : null;
  const meta = [want.set, want.number ? `#${want.number}` : null].filter(Boolean).join(' · ');

  return (
    <article className={styles.card} data-placeholder aria-label={`Placeholder for ${want.name}`}>
      <div className={styles.label}>PLACEHOLDER</div>
      {src ? (
        <div className={styles.art}>
          {/* oxlint-disable-next-line nextjs/no-img-element -- a print-only image, loaded at full size from our mirror */}
          <img
            src={src}
            alt=""
            onLoad={() => {
              setLoaded(true);
              onSettled(want.key);
            }}
            onError={() => {
              if (attempt + 1 >= want.images.length) onSettled(want.key);
              setAttempt((n) => n + 1);
            }}
          />
        </div>
      ) : (
        <div className={styles.outline} data-ink-saver>
          <p className={styles.outlineName}>{want.name}</p>
          {meta && <p>{meta}</p>}
          {want.rarity && <p className={styles.outlineMuted}>{want.rarity}</p>}
          {want.finish && <p className={styles.outlineMuted}>{want.finish}</p>}
          {want.illustrator && <p className={styles.outlineMuted}>Illus. {want.illustrator}</p>}
        </div>
      )}
      <footer className={styles.footer}>
        <p className={styles.footerName}>{want.name}</p>
        {meta && <p className={styles.footerLine}>{meta}</p>}
        {position && (
          <p className={`${styles.footerLine} ${styles.footerPosition}`}>
            {want.binderName} · {position}
          </p>
        )}
      </footer>
    </article>
  );
}
