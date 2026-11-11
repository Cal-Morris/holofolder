import { Suspense } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import InventoryHarness from '@/components/inventory/inventory-harness';
import { canShowInventoryHarness } from '@/lib/inventory-harness-gate';

async function LocalInventoryHarness() {
  if (
    !canShowInventoryHarness(
      process.env.HOLOFOLDER_E2E,
      Boolean(process.env.VERCEL || process.env.VERCEL_ENV),
      (await headers()).get('host'),
    )
  )
    notFound();
  return <InventoryHarness />;
}
export default function InventoryHarnessPage() {
  if (process.env.HOLOFOLDER_E2E !== '1' || process.env.VERCEL || process.env.VERCEL_ENV) notFound();
  return (
    <Suspense fallback={null}>
      <LocalInventoryHarness />
    </Suspense>
  );
}
