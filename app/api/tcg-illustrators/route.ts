import { NextRequest, NextResponse } from 'next/server';
import { getCardsByIllustrator, getIllustratorDirectory } from '@/lib/catalog-queries';
import { normalizeCardLanguage } from '@/lib/domain/cards';
import { cleanIllustratorName } from '@/lib/illustrators';
import { PUBLIC_JSON_CACHE_HEADERS } from '@/lib/http-cache';

export const instant = false;

// The directory's counts change with every catalog import, and revalidateTag doesn't purge the CDN, so keep its edge
// copy to an hour instead of the catalog default of a day plus a week of stale.
const ILLUSTRATOR_DIRECTORY_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=3600',
  'CDN-Cache-Control': 'public, s-maxage=3600',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=3600',
};

/**
 * GET /app/api/tcg-illustrators → { illustrators: [{ name, cardCount }] } (the whole directory, for search)
 * GET /app/api/tcg-illustrators?name=Mitsuhiro%20Arita&language=en → { illustrator, cards }
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const hasName = searchParams.has('name');
  const name = cleanIllustratorName(searchParams.get('name'));

  if (hasName && !name) {
    return NextResponse.json({ error: 'name must not be empty' }, { status: 400 });
  }

  try {
    if (name) {
      const language = normalizeCardLanguage(searchParams.get('language'));
      const cards = await getCardsByIllustrator(name, language);
      return NextResponse.json({ illustrator: name, cards }, { headers: PUBLIC_JSON_CACHE_HEADERS });
    }

    const illustrators = await getIllustratorDirectory();
    return NextResponse.json({ illustrators }, { headers: ILLUSTRATOR_DIRECTORY_CACHE_HEADERS });
  } catch (error) {
    console.error('[holofolder] Illustrator lookup failed:', error);
    return NextResponse.json({ error: 'Illustrator data is unavailable right now.' }, { status: 500 });
  }
}
