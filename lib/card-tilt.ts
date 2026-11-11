/** Largest tilt in degrees when the pointer is at a card edge. */
export const MAX_CARD_TILT = 14;

export type CardTilt = {
  /** Degrees around the horizontal axis (positive leans the top edge back). */
  rotateX: number;
  /** Degrees around the vertical axis (positive leans the right edge back). */
  rotateY: number;
  /** Shine position as a percentage of the card, 0–100. */
  shineX: number;
  shineY: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Tilt the card away from the pointer, with the shine following it. */
export function cardTilt(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): CardTilt {
  const x = rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0.5;
  const y = rect.height > 0 ? clamp01((clientY - rect.top) / rect.height) : 0.5;
  return {
    rotateX: (0.5 - y) * 2 * MAX_CARD_TILT,
    rotateY: (x - 0.5) * 2 * MAX_CARD_TILT,
    shineX: x * 100,
    shineY: y * 100,
  };
}
