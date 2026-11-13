import { NextRequest, NextResponse } from 'next/server';
import { getSimilarMirroredCards } from '@/lib/tcg-mirror';
import { normalizeCardLanguage } from '@/lib/domain/cards';
import { PUBLIC_JSON_CACHE_HEADERS } from '@/lib/http-cache';

export const instant = false;

/**
 * GET /app/api/tcg-similar-cards?cardId=base1-4&language=en → { cardId, language, sameArtwork, similarLook }
 * Public catalogue data (no session). Both lists are empty when the card has no fingerprint yet.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const cardId = searchParams.get('cardId')?.trim() ?? '';
  if (!cardId || cardId.length > 200 || /\s/.test(cardId)) {
    return NextResponse.json({ error: 'cardId is required' }, { status: 400 });
  }
  const language = normalizeCardLanguage(searchParams.get('language'));
  try {
    const similar = await getSimilarMirroredCards(cardId, language);
    return NextResponse.json({ cardId, language, ...similar }, { headers: PUBLIC_JSON_CACHE_HEADERS });
  } catch (error) {
    console.error('[holofolder] Similar cards lookup failed:', error);
    return NextResponse.json({ error: 'Similar cards are unavailable right now.' }, { status: 500 });
  }
}
