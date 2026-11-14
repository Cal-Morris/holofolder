import { Suspense } from 'react';
import type { Metadata } from 'next';
import OAuthConsent, { ConsentLoading } from '@/components/oauth-consent';
export const metadata: Metadata = {
  title: 'Authorize MCP access · Holo Folder',
  robots: { index: false, follow: false },
};
export default function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  return (
    <Suspense fallback={<ConsentLoading />}>
      <OAuthConsent searchParams={searchParams} />
    </Suspense>
  );
}
