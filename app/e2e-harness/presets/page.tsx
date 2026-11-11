import { notFound } from 'next/navigation';
import PresetCreationHarness from '@/components/preset-creation-harness';

export default function PresetHarnessPage() {
  if (process.env.HOLOFOLDER_E2E !== '1') notFound();
  return <PresetCreationHarness />;
}
