import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binderShareMetadata, socialMetadata } from '../lib/social-metadata';

test("app previews use the marketing site's image and large Twitter card", () => {
  assert.deepEqual(socialMetadata.openGraph.images, [
    'https://framerusercontent.com/images/PDxYOgxwVCIq4f1r45OONtTkdU.jpg',
  ]);
  assert.deepEqual(socialMetadata.twitter.images, socialMetadata.openGraph.images);
  assert.equal(socialMetadata.twitter.card, 'summary_large_image');
});

test('share previews include the public username and actual binder name', () => {
  const metadata = binderShareMetadata('synthetic-owner', 'National Dex');
  assert.equal(metadata.title, '@synthetic-owner’s National Dex · Holo Folder');
  assert.equal(metadata.openGraph?.title, metadata.title);
  assert.equal(metadata.twitter?.title, metadata.title);
  assert.equal(metadata.openGraph?.description, metadata.description);
  assert.equal(metadata.twitter?.description, metadata.description);
  assert.deepEqual(metadata.openGraph?.images, socialMetadata.openGraph.images);
  assert.deepEqual(metadata.twitter?.images, socialMetadata.twitter.images);
  assert.deepEqual(metadata.robots, { index: false, follow: false });
});

test('legacy shares without a username still show the binder name', () => {
  assert.equal(binderShareMetadata(null, '  Synthetic   binder ').title, 'Synthetic binder · Holo Folder');
  assert.equal(binderShareMetadata(null, null).title, 'Pokémon binder · Holo Folder');
});

test('invalid usernames never become public identity in previews', () => {
  const metadata = binderShareMetadata('private@example.com', 'Synthetic binder');
  assert.equal(metadata.title, 'Synthetic binder · Holo Folder');
  assert.ok(!JSON.stringify(metadata).includes('private@example.com'));
});

test('named binder previews use their own rendered image', () => {
  const url = 'https://holofolder.com/app/u/synthetic-owner/national-dex/preview.jpg';
  const metadata = binderShareMetadata('synthetic-owner', 'National Dex', url);
  const images = [{ url, width: 1200, height: 630, alt: metadata.title }];
  assert.deepEqual(metadata.openGraph?.images, images);
  assert.deepEqual(metadata.twitter?.images, images);
});
