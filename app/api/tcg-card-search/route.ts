import { NextRequest, NextResponse } from 'next/server';
import { searchMirroredCards } from '@/lib/tcg-mirror';
import { normalizeCardLanguage } from '@/lib/domain/cards';
import { PUBLIC_JSON_CACHE_HEADERS } from '@/lib/http-cache';

export const instant = false;

/** GET /app/api/tcg-card-search?q=bulbasaur%2044 → { cards: SearchCardResult[] } */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = (searchParams.get('q') ?? '').slice(0, 80);
  const language = searchParams.get('language') === 'any' ? 'any' : normalizeCardLanguage(searchParams.get('language'));

  try {
    // Every match, not a sample: an illustrator like Nishida has ~700 cards. 1000 is PostgREST's row cap per query.
    const result = await searchMirroredCards(query, language, 1000, searchParams.get('includeNonPokemon') === '1');
    return NextResponse.json(result, { headers: PUBLIC_JSON_CACHE_HEADERS });
  } catch (error) {
    console.error('[holofolder] Card search failed:', error);
    return NextResponse.json({ error: 'Card search is unavailable right now.', cards: [] }, { status: 500 });
  }
}
