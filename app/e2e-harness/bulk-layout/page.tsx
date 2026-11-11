import { notFound } from 'next/navigation';
import BulkLayoutHarness from '@/components/bulk-layout-harness';

export default function BulkLayoutHarnessPage() {
  if (process.env.HOLOFOLDER_E2E !== '1') notFound();
  return <BulkLayoutHarness />;
}
