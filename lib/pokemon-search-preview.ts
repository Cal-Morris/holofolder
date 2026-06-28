export interface PokemonSearchPreviewInput {
  pokemonArtwork?: string | null
  cardImage?: string | null
  status?: string | null
}

export interface PokemonSearchPreview {
  previewImage: string | null
  previewFitClass: string
  previewToneClass: string
  cardPreviewImage: string | null
  cardPreviewToneClass: string
}

function getUsableImageSource(value?: string | null) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null
  return trimmed
}

export function buildPokemonSearchPreview(input: PokemonSearchPreviewInput): PokemonSearchPreview {
  const pokemonArtwork = getUsableImageSource(input.pokemonArtwork)
  const cardImage = getUsableImageSource(input.cardImage)
  const isWishlisted = input.status === "wishlisted"
  const toneClass = isWishlisted ? "grayscale saturate-[0.8] brightness-[0.92]" : ""

  return {
    previewImage: pokemonArtwork || cardImage,
    previewFitClass: "object-contain",
    previewToneClass: toneClass,
    cardPreviewImage: pokemonArtwork && cardImage ? cardImage : null,
    cardPreviewToneClass: toneClass,
  }
}
