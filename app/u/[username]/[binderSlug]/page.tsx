import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { cache } from 'react';
import type { Metadata } from 'next';
import SharedBinder from '@/components/shared-binder-page';
import { loadPublicBinder } from '@/lib/server/public-binder';
import { loadShareMetadata } from '@/lib/server/share-metadata';

export const instant = false;

const load = cache(async (username: string, binderSlug: string) => {
  await connection();
  try {
    return await loadPublicBinder({ username, binderSlug });
  } catch {
    notFound();
  }
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
