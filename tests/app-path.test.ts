import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { appPath, appReturnPath } from '../lib/app-path';
import { toCardImageSrc } from '../lib/card-image-url';
import { buildBinderSharePath } from '../lib/binder-share';
import manifest from '../app/manifest';

describe('app URL boundary', () => {
  test('prefixes raw paths once and preserves queries', () => {
    assert.equal(appPath('/'), '/app');
    assert.equal(appPath('/api/collection?binder=x'), '/app/api/collection?binder=x');
    assert.equal(appPath('/app/auth/login'), '/app/auth/login');
    assert.equal(appPath('/apple-icon.png'), '/app/apple-icon.png');
  });

  test('keeps auth return destinations within the app', () => {
    assert.equal(appReturnPath(null), '/app');
    assert.equal(appReturnPath('/auth/login?mode=recovery'), '/app/auth/login?mode=recovery');
    assert.equal(appReturnPath('/app?binder=x'), '/app?binder=x');
    for (const path of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/app/../../home',
      '/app/%2e%2e/home',
    ]) {
      assert.equal(appReturnPath(path), '/app', path);
    }
  });

  test('serves old stored image proxy paths through the app', () => {
    assert.equal(toCardImageSrc('/api/card-image-proxy?url=old'), '/app/api/card-image-proxy?url=old');
    assert.equal(toCardImageSrc('/app/api/card-image-proxy?url=current'), '/app/api/card-image-proxy?url=current');
  });

  test('shared binders and installed app stay inside /app', () => {
    assert.equal(buildBinderSharePath('test-token'), '/app/share/test-token');
    assert.equal(manifest().start_url, '/app');
    assert.equal(manifest().scope, '/app');
    assert.ok(manifest().icons?.every((icon) => icon.src.startsWith('/app/')));
  });
});

test('saved legacy cover artwork remains renderable under the app path', async () => {
  const { defaultBinderDesign, normalizeBinderDesign } = await import('../lib/binder-design');
  const design = defaultBinderDesign();
  design.surfaces.cover.artwork =
    '/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fbase1%2F4%2Fhigh.webp';
  assert.equal(normalizeBinderDesign(design).surfaces.cover.artwork, `/app${design.surfaces.cover.artwork}`);
});
