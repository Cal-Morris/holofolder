/** Card artwork belongs to its rights holders; source data licenses do not cover images. */
export function CardDataAttribution({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <p className={className} data-testid="card-data-attribution">
      {compact ? "Data: " : "Card data and images from "}
      <a href="https://tcgdex.dev" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        TCGdex
      </a>{" · "}
      <a href="https://github.com/PokemonTCG/pokemon-tcg-data" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        Pokémon TCG
      </a>{" · "}
      <a href="https://tcgcsv.com" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        TCGCSV
      </a>{" "}
      {compact
        ? "(TCGdex data: MIT). Cards © The Pokémon Company / Nintendo / Creatures / GAME FREAK. Unaffiliated."
        : "(TCGdex card data MIT licensed). Pokémon and all card names, text and artwork are © The Pokémon Company, Nintendo, Creatures and GAME FREAK. BinderDex is not produced, endorsed, supported or affiliated with them."}
    </p>
  )
}
