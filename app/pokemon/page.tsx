import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicCataloguePage } from '@/components/public-catalogue-page';
import { PublicListFilter } from '@/components/public-list-filter';
import { getOfficialArtworkUrl } from '@/lib/pokemon-artwork';
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
      <div className="space-y-3">
        <PublicListFilter listId="pokemon-list" label="Find a Pokémon" placeholder="Find a Pokémon by name or number" />
        <nav aria-label="Generations" className="flex flex-wrap gap-1.5">
          {generations.map((gen) => (
            <a
              key={gen.name}
              href={`#gen-${gen.region.toLowerCase()}`}
              className="border-border/60 text-muted-foreground hover:text-foreground inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition-colors"
            >
              {gen.region}
            </a>
          ))}
        </nav>
      </div>
      <div id="pokemon-list" className="space-y-8">
        {generations.map((gen) => (
          <section
            key={gen.name}
            data-filter-group
            className="scroll-mt-4 space-y-3"
            id={`gen-${gen.region.toLowerCase()}`}
            aria-labelledby={`gen-${gen.region.toLowerCase()}-title`}
          >
            <h2 id={`gen-${gen.region.toLowerCase()}-title`} className="text-xl font-semibold">
              {gen.name} <span className="text-muted-foreground font-normal">({gen.region})</span>
            </h2>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {gen.pokemon.map((pokemon) => (
                <li key={pokemon.id} data-filter={`${pokemon.name} ${pokemon.id} ${formatDexNumber(pokemon.id)}`}>
                  <Link
                    href={`/pokemon/${pokemon.slug}`}
                    className="holo-tile hover:border-primary/45 flex h-full flex-col items-center gap-1 rounded-2xl p-2 text-center transition-colors"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- resized by our image proxy */}
                    <img
                      src={getOfficialArtworkUrl(pokemon.id, 160)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={80}
                      height={80}
                      className="size-16 object-contain sm:size-20"
                    />
                    <span className="text-muted-foreground text-xs tabular-nums">{formatDexNumber(pokemon.id)}</span>
                    <span className="w-full truncate text-sm font-medium">{pokemon.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PublicCataloguePage>
  );
}
