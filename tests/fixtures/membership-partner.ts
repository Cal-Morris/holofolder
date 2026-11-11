/* eslint-disable react-hooks/rules-of-hooks -- Isolated effect runner exercises hooks without a renderer. */
import assert from 'node:assert/strict';
import type { User } from '@supabase/supabase-js';

async function run() {
  // @ts-expect-error Bun mock types stay in this isolated subprocess.
  const { mock } = await import('bun:test');
  const values: unknown[] = [],
    refs: { current: unknown }[] = [];
  let index = 0,
    refIndex = 0;
  mock.module('react', () => ({
    useState: (initial: unknown) => {
      const n = index++;
      if (!(n in values)) values[n] = initial;
      return [
        values[n],
        (value: unknown) => {
          values[n] = value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const n = refIndex++;
      return (refs[n] ??= { current: initial });
    },
    useCallback: (cb: unknown) => cb,
    useEffect: () => {},
    useLayoutEffect: (cb: () => void) => cb(),
  }));
  let barrier: Promise<void> | null = null;
  const partnership = {
    id: 'synthetic-link',
    user1_id: 'actor',
    user2_id: 'partner',
    owner_user_id: 'actor',
    created_at: 'synthetic-date',
  };
  const query = (table: string) => {
    const result = { data: table === 'partnerships' ? partnership : [], error: null };
    const chain = {
      select: () => chain,
      or: () => chain,
      eq: () => chain,
      limit: () => chain,
      order: () => chain,
      maybeSingle: async () => {
        await barrier;
        return table === 'partnerships' ? result : { data: null, error: null };
      },
      then: (resolve: (value: unknown) => void) => resolve(result),
    };
    return chain;
  };
  mock.module('../../lib/supabase/client', () => ({ createClient: () => ({ from: query }) }));
  mock.module('../../lib/collection-activity', () => ({ clearActivityCache: () => {} }));
  const target = new EventTarget();
  Object.assign(globalThis, { window: Object.assign(target, { localStorage: { setItem() {} } }) });
  const { subscribeMembershipLifecycle } = await import('../../lib/collection/membership-lifecycle');
  const phases: string[] = [];
  const stop = subscribeMembershipLifecycle((phase) => phases.push(phase));
  let finish!: () => void,
    failure = false;
  globalThis.fetch = async () => {
    assert.equal(phases.at(-1), 'pause', 'scope closes before partner request starts');
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return Response.json(failure ? { error: { message: 'Synthetic offline failure' } } : {}, {
      status: failure ? 503 : 200,
    });
  };
  const { usePartner } = await import('../../hooks/use-partner');
  let actor = 'actor';
  const useRender = () => {
    index = 0;
    refIndex = 0;
    return usePartner({ user: { id: actor, email: 'synthetic@example.test' } as User });
  };
  let hook = useRender();
  await hook.refresh();
  hook = useRender();
  assert.ok(hook.partner);
  const accept = hook.acceptInvite('synthetic-invite');
  assert.deepEqual(await hook.acceptInvite('synthetic-invite'), { error: 'A partner change is already in progress.' });
  assert.equal(phases.at(-1), 'pause');
  finish();
  assert.deepEqual(await accept, { success: true });
  hook = useRender();
  let releaseDuring!: () => void;
  barrier = new Promise<void>((resolve) => {
    releaseDuring = resolve;
  });
  const beforeDisconnect = hook.refresh();
  const disconnect = hook.removePartner();
  const duringDisconnect = hook.refresh();
  assert.equal(phases.at(-1), 'pause');
  finish();
  assert.deepEqual(await disconnect, { success: true });
  releaseDuring();
  await Promise.all([beforeDisconnect, duringDisconnect]);
  barrier = null;
  hook = useRender();
  assert.equal(hook.partner, null, 'a refresh during disconnect cannot revive the old partnership');
  assert.equal(hook.isLoading, false, 'invalidated partner loads cannot leave loading stuck');
  failure = true;
  const offline = hook.acceptInvite('synthetic-invite');
  finish();
  assert.deepEqual(await offline, { error: 'Synthetic offline failure' });
  assert.equal(phases.at(-1), 'recheck');
  let release!: () => void;
  barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stale = hook.refresh();
  actor = 'other-account';
  useRender();
  const before = JSON.stringify(values);
  release();
  await stale;
  assert.equal(JSON.stringify(values), before, 'previous account load cannot change the new account state');
  await hook.refresh();
  assert.equal(JSON.stringify(values), before, 'stale callback cannot start a load in the new account');
  stop();
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
