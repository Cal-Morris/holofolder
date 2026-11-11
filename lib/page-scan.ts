// Shared by the binder (page photo scan) and the camera scanner.

export const TRADING_CARD_ASPECT_RATIO = 63 / 88;

export type PageScanSummary = {
  detectedOccupied: number;
  newCollected: number;
  alreadyCollected: number;
  matchedCards: number;
  cardMatches: PageScanCardMatchSummary[];
  page: number;
};

export type PageScanCardMatchSummary = {
  slotIndex: number;
  slotLabel: string;
  cardId: string;
  cardName: string;
  setName: string;
  cardImage?: string;
  similarity: number;
  confidence: number;
  margin: number;
  appearanceRatio: number;
};

export function getSlotLabel(row: number, col: number) {
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}
