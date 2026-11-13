import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { Metadata } from 'next';
import SharedBinder from '@/components/shared-binder-page';
import { loadNamedPublicBinder } from '@/lib/server/public-binder';
import { loadShareMetadata } from '@/lib/server/share-metadata';

export const instant = false;

// Cache Components needs one build-time param. An invalid username, so the build never reads the database; every
// real share renders on its first visit and is then served from cache until its owner writes.
export function generateStaticParams() {
  return [{ username: '-', binderSlug: '-' }];
}

const load = cache(async (username: string, binderSlug: string) => {
  const binder = await loadNamedPublicBinder(username, binderSlug);
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
  );
}
export default async function NamedBinderPage({ params }: Props) {
  const { username, binderSlug } = await params;
  return <SharedBinder binder={await load(username, binderSlug)} sharePath={`/@${username}/${binderSlug}`} />;
}
