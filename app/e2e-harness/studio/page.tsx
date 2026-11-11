import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import BinderDesigner from '@/components/binder-designer/designer';
import { getDefaultBinderSettings } from '@/lib/settings';
export default async function StudioHarness({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  await connection();
  if (process.env.HOLOFOLDER_E2E !== '1') notFound();
  // Synthetic account and collection, only served by the test harness.
  const { theme } = await searchParams;
  return (
    <BinderDesigner
      owner="00000000-0000-4000-8000-0000000000e2"
      cards={[]}
      placed={0}
      wanted={0}
      settings={{ ...getDefaultBinderSettings(), darkMode: theme !== 'light' }}
    />
  );
}
