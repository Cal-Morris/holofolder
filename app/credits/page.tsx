import type { Metadata } from 'next';
import Link from 'next/link';
import { Credits } from '@/components/credits';

export const metadata: Metadata = {
  title: 'Credits & attributions',
  description: "Where Holo Folder's card data and images come from, and the Pokémon copyright notice.",
};

// Static: no request data, so it prerenders and works from the CDN.
export default function CreditsPage() {
  return (
    <main className="bg-background safe-area-bottom min-h-screen px-5 py-10">
      <div className="mx-auto max-w-xl space-y-6">
        <header className="space-y-2">
          <Link href="/" className="text-muted-foreground text-sm underline-offset-2 hover:underline">
            Holo Folder
          </Link>
          <h1 className="text-2xl font-semibold">Credits &amp; attributions</h1>
        </header>
        <Credits />
      </div>
    </main>
  );
}
