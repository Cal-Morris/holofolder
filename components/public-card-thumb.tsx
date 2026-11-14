// Card thumbnail for the public set and Pokémon pages: our stored small rendition, or a blank card-shaped tile.
export function PublicCardThumb({ thumb, alt, className }: { thumb?: string; alt: string; className: string }) {
  return thumb ? (
    // eslint-disable-next-line @next/next/no-img-element -- our CDN serves the stored card image directly
    <img
      src={thumb}
      alt={alt}
      loading="lazy"
      decoding="async"
      width={245}
      height={342}
      className={`bg-muted aspect-[245/342] h-auto shrink-0 rounded-sm ${className}`}
    />
  ) : (
    <span role="img" aria-label={alt} className={`bg-muted aspect-[245/342] shrink-0 rounded-sm ${className}`} />
  );
}
