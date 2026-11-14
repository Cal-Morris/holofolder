import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { namedPublicBinderParams } from '@/lib/server/public-binder';

// Synthetic ids and names.
describe('namedPublicBinderParams', () => {
  test('lists only active slugs of enabled shares whose owner has a valid username', () => {
    const params = namedPublicBinderParams({
      identities: [
        { user_id: 'u1', username: 'ash' },
        { user_id: 'u2', username: 'Not Valid' },
      ],
      slugs: [
        { owner_user_id: 'u1', binder_id: 'b1', slug: 'national', is_active: true },
        { owner_user_id: 'u1', binder_id: 'b2', slug: 'disabled-share', is_active: true },
        { owner_user_id: 'u1', binder_id: 'b3', slug: 'old-name', is_active: false },
        { owner_user_id: 'u2', binder_id: 'b4', slug: 'bad-owner-name', is_active: true },
        { owner_user_id: 'u3', binder_id: 'b5', slug: 'no-username', is_active: true },
      ],
      shares: [
        { owner_user_id: 'u1', binder_id: 'b1', is_enabled: true },
        { owner_user_id: 'u1', binder_id: 'b2', is_enabled: false },
        { owner_user_id: 'u1', binder_id: 'b3', is_enabled: true },
        { owner_user_id: 'u2', binder_id: 'b4', is_enabled: true },
        { owner_user_id: 'u3', binder_id: 'b5', is_enabled: true },
      ],
    });
    assert.deepEqual(params, [{ username: 'ash', binderSlug: 'national' }]);
  });

  test('a share on another owner with the same binder id does not enable the slug', () => {
    const params = namedPublicBinderParams({
      identities: [{ user_id: 'u1', username: 'ash' }],
      slugs: [{ owner_user_id: 'u1', binder_id: 'b1', slug: 'national', is_active: true }],
      shares: [{ owner_user_id: 'u9', binder_id: 'b1', is_enabled: true }],
    });
    assert.deepEqual(params, []);
  });
});
