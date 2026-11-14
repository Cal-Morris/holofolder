import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { Metadata } from 'next';
import SharedBinder from '@/components/shared-binder-page';
import { listNamedPublicBinderParams, loadNamedPublicBinder } from '@/lib/server/public-binder';
import { loadShareMetadata } from '@/lib/server/share-metadata';

export const instant = false;

// Every enabled named share is prerendered at build, so even the first visit after a deploy is served from the CDN;
// an owner's write still expires it (publicBinderTag). Shares enabled later render on their first visit. If the
// build can't list them, the invalid placeholder keeps Cache Components' one required param without a database read.
export async function generateStaticParams() {
  // Only list shares that load now: a page that fails while prerendering fails the whole build, so a share that
  // can't be read here renders on its first visit instead. Loading them also warms the cache for the render.
  const shares = await listNamedPublicBinderParams();
  const ready = await Promise.all(
    shares.map(async (share) =>
      (await loadNamedPublicBinder(share.username, share.binderSlug).catch(() => null)) ? share : null,
    ),
  );
  const params = ready.filter((share) => share !== null);
  return params.length ? params : [{ username: '-', binderSlug: '-' }];
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
