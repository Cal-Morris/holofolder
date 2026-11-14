import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicCataloguePage } from '@/components/public-catalogue-page';
import { formatDexNumber } from '@/lib/pokemon-catalog';
import { pokemonByGeneration } from '@/lib/pokemon-pages';
import { socialMetadata } from '@/lib/social-metadata';

const title = 'Pokémon cards by Pokémon: every species in the National Dex';
const description =
  'All 1,025 Pokémon in National Dex order, by generation. Open a Pokémon to see every English card of it, set by set, newest first.';
const url = 'https://holofolder.com/app/pokemon';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: { ...socialMetadata.openGraph, title, description, url },
  twitter: { ...socialMetadata.twitter, title, description },
};

export default function PokemonIndexPage() {
  const generations = pokemonByGeneration();
  return (
    <PublicCataloguePage>
      <header className="max-w-3xl space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Pokémon cards by Pokémon</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </header>
      {generations.map((gen) => (
        <section key={gen.name} className="space-y-3" aria-labelledby={`gen-${gen.region.toLowerCase()}`}>
          <h2 id={`gen-${gen.region.toLowerCase()}`} className="text-xl font-semibold">
            {gen.name} <span className="text-muted-foreground font-normal">({gen.region})</span>
          </h2>
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {gen.pokemon.map((pokemon) => (
              <li key={pokemon.id}>
                <Link
                  href={`/pokemon/${pokemon.slug}`}
                  className="holo-tile hover:border-primary/45 flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 transition-colors"
                >
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {formatDexNumber(pokemon.id)}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium">{pokemon.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PublicCataloguePage>
  );
}
