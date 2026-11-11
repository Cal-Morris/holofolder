import Link from 'next/link';
import type { ReactNode } from 'react';

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-foreground font-medium underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Who Holo Folder's card data and images come from, and the Pokémon copyright notice. Shown in Settings → Credits &
 * attributions and at /credits. Keep it in step with THIRD_PARTY_NOTICES.md and card-assets/pokemon/tcg/sources.csv.
 */
export function Credits() {
  return (
    <div data-testid="credits" className="text-muted-foreground space-y-5 text-sm leading-relaxed">
      <Group title="Card data">
        <ul className="space-y-1.5">
          <li>
            <External href="https://tcgdex.dev">TCGdex</External>: cards, sets, numbers and translations. TCGdex data is
            MIT licensed.
          </li>
          <li>
            <External href="https://github.com/PokemonTCG/pokemon-tcg-data">Pokémon TCG data</External> (pokemontcg.io):
            card details and matches.
          </li>
          <li>
            <External href="https://tcgcsv.com">TCGCSV</External>: TCGplayer product data for promo sets.
          </li>
        </ul>
      </Group>
      <Group title="Card images">
        <ul className="space-y-1.5">
          <li>
            <External href="https://malie.io/static/">malie.io</External>: the official card images from Pokémon TCG
            Live and Pokémon TCG Online.
          </li>
          <li>
            <External href="https://www.pokemon.com/us/pokemon-tcg/pokemon-cards">pokemon.com</External>,{' '}
            <External href="https://tcgdex.dev">TCGdex</External>,{' '}
            <External href="https://pokemontcg.io">pokemontcg.io</External>,{' '}
            <External href="https://scrydex.com">Scrydex</External>,{' '}
            <External href="https://limitlesstcg.com">Limitless TCG</External>,{' '}
            <External href="https://www.tcgplayer.com">TCGplayer</External> and{' '}
            <External href="https://playshop.fr">Playshop</External> for cards the others don&apos;t have.
          </li>
          <li>
            Which source we use for each card follows the{' '}
            <External href="https://nstrelow.github.io/ptcg-image-atlas/">PTCG Image Atlas</External>, a map of where
            Pokémon TCG card images come from (
            <External href="https://github.com/nstrelow/ptcg-image-atlas">source on GitHub</External>).
          </li>
        </ul>
      </Group>
      <Group title="Set symbols">
        <p>
          <External href="https://pokesymbols.com/tcg/sets">PokéSymbols</External>: set symbols for looking up cards,
          including images by <External href="https://www.reddit.com/user/hexcalibur01000/">u/hexcalibur01000</External>{' '}
          and recreations by PokéSymbols. Additional symbols and logos come from TCGdex, pokemontcg.io and Scrydex. All
          are served from Holo Folder&apos;s CDN.
        </p>
      </Group>
      <Group title="Copyright">
        <p>
          Pokémon and all card names, text and artwork are © The Pokémon Company, Nintendo, Creatures and GAME FREAK.
          English cards from 1999 to 2003 are © Wizards of the Coast. Card images are shown to identify the cards you
          collect.
        </p>
        <p>
          Holo Folder is an unofficial fan app. It is not produced, endorsed, supported or affiliated with Nintendo, The
          Pokémon Company, Creatures or GAME FREAK.
        </p>
      </Group>
    </div>
  );
}

/**
 * The one line kept at the bottom of the page: the affiliation notice and a way to the full credits. Opens Settings →
 * Credits when `onOpenCredits` is given, otherwise links to /credits.
 */
export function CreditsNotice({ className = '', onOpenCredits }: { className?: string; onOpenCredits?: () => void }) {
  const label = 'Credits & attributions';
  return (
    <p className={className} data-testid="credits-notice">
      Not affiliated with Nintendo or The Pokémon Company ·{' '}
      {onOpenCredits ? (
        <button type="button" onClick={onOpenCredits} className="underline underline-offset-2">
          {label}
        </button>
      ) : (
        <Link href="/credits" className="underline underline-offset-2">
          {label}
        </Link>
      )}
    </p>
  );
}
