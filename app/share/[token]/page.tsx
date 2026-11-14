import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { Metadata } from 'next';
import SharedBinder from '@/components/shared-binder-page';
import { loadCachedPublicBinder } from '@/lib/server/public-binder';
import { loadShareMetadata } from '@/lib/server/share-metadata';

export const instant = false;

// Cache Components needs one build-time param. An invalid token, so the build never reads the database; every real
// share renders on its first visit and is then served from cache until its owner writes or the share changes.
export function generateStaticParams() {
  return [{ token: '-' }];
}

const load = cache(async (token: string) => {
  const binder = await loadCachedPublicBinder({ token }).catch(() => null);
  if (!binder) notFound();
  return binder;
});
type Props = { params: Promise<{ token: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return loadShareMetadata(await load((await params).token));
}
export default async function SharedBinderPage({ params }: Props) {
  const { token } = await params;
  return <SharedBinder binder={await load(token)} sharePath={`/app/share/${token}`} />;
}
