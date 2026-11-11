import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { cache } from 'react';
import type { Metadata } from 'next';
import SharedBinder from '@/components/shared-binder-page';
import { loadPublicBinder } from '@/lib/server/public-binder';
import { loadShareMetadata } from '@/lib/server/share-metadata';

export const instant = false;

// React cache deduplicates page/metadata only within this request. No cross-request payload cache.
const load = cache(async (token: string) => {
  await connection();
  try {
    return await loadPublicBinder({ token });
  } catch {
    notFound();
  }
});
type Props = { params: Promise<{ token: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return loadShareMetadata(await load((await params).token));
}
export default async function SharedBinderPage({ params }: Props) {
  const { token } = await params;
  return <SharedBinder binder={await load(token)} sharePath={`/app/share/${token}`} />;
}
