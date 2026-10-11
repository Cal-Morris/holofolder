/** Credits TCGdex for card data/images and states that card content belongs to its rights holders. */
export function CardDataAttribution({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <p className={className} data-testid="card-data-attribution">
      {compact ? "Data: " : "Card data and images from "}
      <a href="https://tcgdex.dev" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        TCGdex
      </a>{" "}
      {compact
        ? "(MIT). Cards © The Pokémon Company / Nintendo / Creatures / GAME FREAK. Unaffiliated."
        : "(card data MIT licensed). Pokémon and all card names, text and artwork are © The Pokémon Company, Nintendo, Creatures and GAME FREAK. BinderDex is not produced, endorsed, supported or affiliated with them."}
    </p>
  )
}
