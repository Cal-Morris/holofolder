import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppearanceConflict, normalizeRemoteAppearance, syncBinderAppearance } from '../lib/binder-appearance-sync';
import { defaultBinderDesign } from '../lib/binder-design';

const owner = '00000000-0000-4000-8000-0000000000e2';
describe('appearance sync', () => {
  test('rejects another owner and malformed revisions before installing a cache', () => {
    assert.throws(() => normalizeRemoteAppearance({ ownerId: 'other', design: null, revision: 0 }, owner));
    assert.throws(() => normalizeRemoteAppearance({ ownerId: owner, design: null, revision: 2 }, owner));
    assert.throws(() => normalizeRemoteAppearance({ ownerId: owner, design: {}, revision: 0 }, owner));
    assert.throws(() => normalizeRemoteAppearance({ ownerId: owner, design: {}, revision: Infinity }, owner));
    assert.equal(normalizeRemoteAppearance({ ownerId: owner, design: null, revision: 0 }, owner).design, null);
  });
  test('a lost commit acknowledgement is reconciled without another write', async () => {
    const design = defaultBinderDesign();
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ ownerId: owner, design, revision: 2 }, { status: 409 });
    }) as typeof fetch;
    try {
      const result = await syncBinderAppearance(owner, { design, uploads: {}, pending: true, revision: 1 });
      assert.equal(result.revision, 2);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = original;
    }
  });
  test('a different newer appearance is kept rather than overwritten', async () => {
    const design = defaultBinderDesign(),
      newer = { ...design, name: 'Other device' };
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ ownerId: owner, design: newer, revision: 2 }, { status: 409 })) as typeof fetch;
    try {
      await assert.rejects(
        syncBinderAppearance(owner, { design, uploads: {}, pending: true, revision: 1 }),
        AppearanceConflict,
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});

test('artwork sync uploads directly to private R2 without sending session cookies', async () => {
  const design = defaultBinderDesign();
  const id = 'upload:9ade73fb-d75e-4174-86a1-9e4769b85f30';
  design.surfaces.cover.artwork = id;
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/upload'))
      return Response.json({
        signedUploadUrl: 'https://synthetic.r2.cloudflarestorage.com/private/object?signature=synthetic',
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
      });
    if (String(url).startsWith('https://synthetic.r2.')) return new Response(null, { status: 200 });
    return Response.json({ ownerId: owner, design, revision: 1 });
  }) as typeof fetch;
  try {
    await syncBinderAppearance(owner, {
      design,
      uploads: { [id]: new Blob(['synthetic'], { type: 'image/png' }) },
      revision: 0,
      pending: true,
    });
    assert.equal(calls.length, 3);
    assert.equal(calls[1].init?.method, 'PUT');
    assert.equal(calls[1].init?.credentials, 'omit');
    assert.deepEqual(calls[1].init?.headers, { 'Content-Type': 'image/png', 'If-None-Match': '*' });
  } finally {
    globalThis.fetch = original;
  }
});
