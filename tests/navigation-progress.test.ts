import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isAppNavigation } from '@/lib/navigation-progress';

const current = new URL('https://holofolder.com/app/main/binder/1');
const go = (href: string) => isAppNavigation(new URL(href, current), current);

describe('isAppNavigation', () => {
  test('runs for another app page', () => {
    assert.equal(go('/app/trades/binder/1'), true);
    assert.equal(go('/app'), true);
    assert.equal(go('/app/main/binder/1?view=list'), true);
  });

  test('skips the same page, hash jumps, the marketing site and other origins', () => {
    assert.equal(go('/app/main/binder/1'), false);
    assert.equal(go('/app/main/binder/1#top'), false);
    assert.equal(go('/pricing'), false);
    assert.equal(go('/apples'), false);
    assert.equal(go('https://example.com/app'), false);
  });
});
