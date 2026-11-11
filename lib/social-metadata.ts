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

/** `previewImage`: the binder's own rendered preview, else the site artwork. */
export function binderShareMetadata(username: unknown, binderName: unknown, previewImage?: string): Metadata {
  const owner = normalizeUsername(username);
  const binder = normalizeBinderName(binderName) ?? 'Pokémon binder';
  const title = `${owner ? `@${owner}’s ` : ''}${binder} · Holo Folder`;
  const description = `View ${owner ? `@${owner}’s ` : ''}${binder} on Holo Folder, a read-only Pokémon card collection.`;
  const images = previewImage ? [{ url: previewImage, width: 1200, height: 630, alt: title }] : [image];
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { ...socialMetadata.openGraph, title, description, images },
    twitter: { ...socialMetadata.twitter, title, description, images },
  };
}
