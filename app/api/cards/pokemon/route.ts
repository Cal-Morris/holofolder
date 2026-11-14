import { NextRequest, NextResponse } from 'next/server';
import { getCardsForPokemon } from '@/lib/catalog-queries';
import { normalizeCardLanguage } from '@/lib/domain/cards';
import { PUBLIC_JSON_CACHE_HEADERS } from '@/lib/http-cache';

export const instant = false;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  try {
    const dexId = Number.parseInt(searchParams.get('dexId') || '', 10);
    const language = normalizeCardLanguage(searchParams.get('language'));

    if (!Number.isInteger(dexId) || dexId < 1) {
      return NextResponse.json({ error: 'dexId must be a positive integer' }, { status: 400 });
    }

    const cards = await getCardsForPokemon(dexId, language);

    return NextResponse.json(
      {
        cards,
      },
      { headers: PUBLIC_JSON_CACHE_HEADERS },
    );
  } catch (error) {
    console.error('[holofolder] Failed to load cached TCG cards:', error);
    return NextResponse.json(
      {
        error: 'Failed to load mirrored cards. Run `bun sync-card-db` to seed the local mirror.',
      },
      { status: 500 },
    );
  }
}
