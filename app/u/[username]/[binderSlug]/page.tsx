import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { Metadata } from 'next';
import SharedBinder from '@/components/shared-binder-page';
import { loadCachedPublicBinder } from '@/lib/server/public-binder';
import { loadShareMetadata } from '@/lib/server/share-metadata';

// Wait for the complete page (the binder read is cached), so a missing share's notFound() sets a real 404 status
// instead of streaming a 200 fallback shell first.
export const ensureStatic = 'navigation';

// Cache Components needs one build-time param. An invalid username, so the build never reads the database; every
// real share renders on its first visit, binder included in the HTML, and is then served from cache until its
// owner writes.
export function generateStaticParams() {
  return [{ username: '-', binderSlug: '-' }];
}

const load = cache(async (username: string, binderSlug: string) => {
  const binder = await loadCachedPublicBinder({ username, binderSlug });
  if (!binder) notFound();
  return binder;
});
type Props = { params: Promise<{ username: string; binderSlug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, binderSlug } = await params;
  return loadShareMetadata(
    await load(username, binderSlug),
    username,
    `https://holofolder.com/app/u/${encodeURIComponent(username)}/${encodeURIComponent(binderSlug)}/preview.jpg`,
    `https://holofolder.com/@${encodeURIComponent(username)}/${encodeURIComponent(binderSlug)}`,
  );
}
export default async function NamedBinderPage({ params }: Props) {
  const { username, binderSlug } = await params;
  return <SharedBinder binder={await load(username, binderSlug)} sharePath={`/@${username}/${binderSlug}`} />;
}
