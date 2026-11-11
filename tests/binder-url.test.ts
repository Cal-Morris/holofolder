import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { binderHref } from '@/lib/binders/client';
import {
  binderPath,
  matchBinder,
  navigationParams,
  parseBinderPath,
  requestedBinderKey,
  writeNavigationUrl,
} from '@/lib/binders/url';
import { getSignedOutRedirectPath } from '@/lib/auth-redirects';

const binders = [
  { id: 'b1', slug: 'national' },
  { id: 'b2', slug: 'national-1' },
  { id: 'b3', slug: null },
];
const at = (href: string) => new URL(href, 'https://holofolder.com');

describe('binder addresses', () => {
  test('parse and build /<slug>/binder/<page>', () => {
    assert.equal(binderPath('national'), '/national');
    assert.equal(binderPath('national', 'binder', 3), '/national/binder/3');
    assert.equal(binderPath('national', 'list', 3), '/national/list');
    assert.deepEqual(parseBinderPath('/app/national/binder/3'), { slug: 'national', view: 'binder', page: 3 });
    assert.deepEqual(parseBinderPath('/national/list'), { slug: 'national', view: 'list' });
    for (const path of [
      '/app',
      '/app/studio',
      '/app/auth/login',
      '/app/national/list/2',
      '/app/national/binder/0',
      '/app/national/oops',
      '/app/llms.txt',
    ]) {
      assert.equal(parseBinderPath(path), null, path);
    }
  });

  test('slug paths fold into the old query form, which still wins', () => {
    assert.equal(navigationParams(at('/app/national-1/binder/4'), binders).toString(), 'binder=b2&view=binder&page=4');
    assert.equal(navigationParams(at('/app/national?binder=b3'), binders).toString(), 'binder=b3');
    assert.equal(navigationParams(at('/app/unknown/binder/2'), binders).toString(), '');
    assert.equal(requestedBinderKey(at('/app/national/binder/2')), 'national');
    assert.equal(requestedBinderKey(at('/app/national?binder=b2')), 'b2');
    assert.equal(matchBinder(binders, 'national-1')?.id, 'b2');
    assert.equal(matchBinder(binders, 'b3')?.id, 'b3');
  });

  test('writes the slug path when the binder has one, else ?binder=', () => {
    const write = (from: string, target: Parameters<typeof writeNavigationUrl>[2]) => {
      const url = writeNavigationUrl(at(from), binders, target);
      return url.pathname + url.search;
    };
    assert.equal(
      write('/app?binder=b1&view=binder&page=2&x=1', { main: 'collection', binderId: 'b1', view: 'binder', page: 5 }),
      '/app/national/binder/5?x=1',
    );
    assert.equal(
      write('/app/national/binder/5', { main: 'collection', binderId: 'b1', view: 'list', page: 5 }),
      '/app/national/list',
    );
    assert.equal(
      write('/app/national/binder/5', { main: 'collection', binderId: 'b3', view: 'binder', page: 2 }),
      '/app?binder=b3&view=binder&page=2',
    );
    assert.equal(write('/app/national/binder/5', { main: 'inventory' }), '/app?view=inventory');
  });

  test('switcher links use the slug and keep other parameters', () => {
    assert.equal(binderHref('b2', 'https://holofolder.com/app/national/binder/3?x=1', 'national-1'), '/national-1?x=1');
    assert.equal(binderHref('b2', 'https://holofolder.com/app?binder=b1&page=2', 'national-1'), '/national-1');
    assert.equal(binderHref('b3', 'https://holofolder.com/app/national/binder/3'), '/?binder=b3');
    assert.equal(
      binderHref('b2', 'http://localhost/e2e-harness?signedIn=1', 'national-1'),
      '/e2e-harness?signedIn=1&binder=b2',
    );
  });

  test('signed-out visitors to a binder address go to sign in', () => {
    assert.equal(getSignedOutRedirectPath('/national/binder/2', false), '/auth/login');
    assert.equal(getSignedOutRedirectPath('/share/abc', false), null);
    assert.equal(getSignedOutRedirectPath('/national', true), null);
  });
});
