import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from '@supabase/supabase-js';
import { BillingContext, type BillingState } from '../../hooks/use-billing';
import { resolveBillingAccess } from '../../lib/billing';
async function run() {
  // Synthetic relationship and invite, no Supabase requests or browser.
  let linked = true;
  // @ts-expect-error Bun mock types stay isolated from the application.
  const { mock } = await import('bun:test');
  mock.module('../../hooks/use-partner', () => ({
    usePartner: () => ({
      partner: linked ? { id: 'synthetic-partner', email: 'partner@example.test', partneredAt: '2026-01-01' } : null,
      pendingInvites: [],
      receivedInvites: [{ id: 'synthetic-invite', inviterEmail: 'owner@example.test' }],
      sendInvite: async () => ({}),
      acceptInvite: async () => ({}),
      rejectInvite: async () => ({}),
      removePartner: async () => ({}),
      error: null,
      isLoading: false,
    }),
  }));
  const { default: PartnerModal } = await import('../../components/partner-modal');
  const state: BillingState = {
    access: resolveBillingAccess('owner', { enforced: true }),
    hasBillingAccount: false,
    canManage: true,
    loading: false,
    error: null,
    busy: false,
    premium: false,
    refresh: async () => {},
    upgrade: () => {},
    checkout: async () => {},
    portal: async () => {},
  };
  const render = () =>
    renderToStaticMarkup(
      <BillingContext.Provider value={state}>
        <PartnerModal isOpen user={{ id: 'synthetic-owner' } as User} onClose={() => {}} />
      </BillingContext.Provider>,
    );
  assert.match(render(), /Remove Partner/i);
  linked = false;
  const html = render();
  assert.match(html, /owner@example.test/);
  assert.match(html, /Upgrade to invite a partner/);
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
