import { CARD_MM, SHEET_COLS, SHEET_ROWS } from '@/lib/print-placeholders';
import styles from './placeholder-print.module.css';

/** Thin cut lines on every cell boundary, outside the 3 × 3 grid. */
export function CropMarks({ origin }: { origin: { left: number; top: number } }) {
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
