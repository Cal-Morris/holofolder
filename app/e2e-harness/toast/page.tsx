import { notFound } from 'next/navigation';
import ToastHarness from '@/components/toast-harness';

export default function ToastHarnessPage() {
  if (process.env.HOLOFOLDER_E2E !== '1') notFound();
  return <ToastHarness />;
}
