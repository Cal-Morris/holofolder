import type { Metadata } from 'next';
import { normalizeUsername } from '@/lib/account-identity';
import { normalizeBinderName } from '@/lib/binders/model';

const title = 'Holo Folder · Pokémon Card Collection Tracker';
const description =
  'Track your Pokémon cards, build a wanted list, compare available price evidence and collect together. Take saved binder data offline and share a read-only collection link.';
// Use the same artwork as the Framer marketing site.
const image = 'https://framerusercontent.com/images/PDxYOgxwVCIq4f1r45OONtTkdU.jpg';

export const socialMetadata = {
  title,
  description,
  openGraph: { title, description, siteName: 'Holo Folder', type: 'website', images: [image] },
  twitter: { card: 'summary_large_image', title, description, images: [image] },
} satisfies Metadata;

/** The curated showcase account, whose named binders are linked from the marketing site's collections pages. */
export const SHOWCASE_USERNAME = 'showcase';

/** `previewImage`: the binder's own rendered preview, else the site artwork. `publicUrl` is the named
 * `/@username/slug` address; only the showcase account's named binders are indexed there, never anyone else's or a
 * token share. */
export function binderShareMetadata(
  username: unknown,
  binderName: unknown,
  previewImage?: string,
  publicUrl?: string,
): Metadata {
  const owner = normalizeUsername(username);
  const binder = normalizeBinderName(binderName) ?? 'Pokémon binder';
  const title = `${owner ? `@${owner}’s ` : ''}${binder} · Holo Folder`;
  const description = `View ${owner ? `@${owner}’s ` : ''}${binder} on Holo Folder, a read-only Pokémon card collection.`;
  const images = previewImage ? [{ url: previewImage, width: 1200, height: 630, alt: title }] : [image];
  const indexed = Boolean(publicUrl) && owner === SHOWCASE_USERNAME;
  return {
    title,
    description,
    robots: { index: indexed, follow: indexed },
    ...(indexed ? { alternates: { canonical: publicUrl } } : {}),
    openGraph: { ...socialMetadata.openGraph, title, description, images },
    twitter: { ...socialMetadata.twitter, title, description, images },
  };
}
