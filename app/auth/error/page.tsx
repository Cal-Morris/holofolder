import { Suspense } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';

type SearchParams = Promise<{ error?: string }>;

async function ErrorCode({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  return error ? <p className="text-muted-foreground mt-4 text-center text-xs break-words">Error: {error}</p> : null;
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthShell
      title="That link didn’t work"
      intro="Sign-in links work once and expire after an hour. Request a new one and open the latest email."
    >
      <Button asChild className="h-12 w-full rounded-xl text-base font-semibold">
        <Link href="/auth/login">Back to sign in</Link>
      </Button>
      <Suspense>
        <ErrorCode searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
