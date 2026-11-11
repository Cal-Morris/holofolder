# Third-party notices

A license for Holo Folder's original code does not replace third-party licenses or grant rights to assets, brands, hosted services or external data. Original Holo Folder code is licensed under [AGPL-3.0-only](LICENSE), copyright 2026 Callum Morris. Third-party material retains the licenses below. Pokémon artwork and Holo Folder branding are not relicensed under the project code license. See [the readiness checklist](docs/open-source-readiness.md) for unresolved asset permissions.

## Vendored UI skills

The UI craft skills listed in [`.agents/skills/EMIL-SOURCE.md`](.agents/skills/EMIL-SOURCE.md) are copyright 2026 Emil Kowalski and distributed under the MIT license. The complete upstream notice is preserved in [`.agents/skills/EMIL-LICENSE`](.agents/skills/EMIL-LICENSE).

## Card data, images and names

Card data is retrieved from [TCGdex](https://github.com/tcgdex/cards-database), [Pokémon TCG data](https://github.com/PokemonTCG/pokemon-tcg-data), [TCGCSV](https://tcgcsv.com) and other configured providers. TCGdex publishes its database under the [MIT license](https://github.com/tcgdex/cards-database/blob/master/LICENSE). The complete [TCGdex MIT notice](LICENSES/TCGdex-MIT.txt) is retained here. Preserve the applicable upstream notices when redistributing data; do not assume every provider has the same terms.

Pokémon, card names, card text and card artwork belong to their respective rights holders, including The Pokémon Company, Nintendo, Creatures and GAME FREAK. Data or software licenses do not grant a license to card artwork. Holo Folder is unaffiliated with those companies. The app's [card attribution](components/card-data-attribution.tsx) must remain visible.

The tracked `public/binder-presets/magikarp.png` and `public/binder-presets/mew.png` are previews using these printings:

| Preview        | Artwork                                       | Illustrator  | Image source                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `magikarp.png` | Magikarp, Paldea Evolved 203/193 (`sv02-203`) | Shinji Kanda | [TCGdex metadata](https://api.tcgdex.net/v2/en/cards/sv02-203), [card image](https://assets.tcgdex.net/en/sv/sv02/203/high.webp), [official card listing](https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/series/sv02/203/) |
| `mew.png`      | Mew ex, 151 193/165 (`sv03.5-193`)            | aky CG Works | [TCGdex metadata](https://api.tcgdex.net/v2/en/cards/sv03.5-193), [card image](https://assets.tcgdex.net/en/sv/sv03.5/193/high.webp)                                                                                             |

The exact card references and crop frames are in [`lib/binder-design-presets.ts`](lib/binder-design-presets.ts). TCGdex metadata was checked on 2026-11-08. Attribution establishes the source, not redistribution permission. [Pokémon's published guidance](https://support.pokemon.com/hc/en-us/articles/360000634094-Can-I-use-Pok%C3%A9mon-images-or-materials) does not grant general project reuse. Downloading or mirroring images at runtime also remains subject to source terms and rights holders' permissions.

## Branding and other image assets

The sources and export process for the Holo Folder mark are described in [`assets/brand/README.md`](assets/brand/README.md). Historical source documentation describes the single-card mark as original project artwork without Pokémon imagery and the three-card master as a generated concept reference. No external source or image metadata was found for those masters. The provenance record in [docs/asset-provenance.md](docs/asset-provenance.md) distinguishes that evidence from confirmed ownership/permission. Do not treat the code license as permission to use the Holo Folder name or logo.

## Copied UI components

The primitives under `components/ui/` derive from [shadcn/ui](https://github.com/shadcn-ui/ui), copyright 2023 shadcn, under MIT. Preserve the full [shadcn notice](LICENSES/shadcn-MIT.txt) when copying or distributing those components, including modified versions. These third-party portions retain MIT licensing.

## Fonts and icons

[`app/layout.tsx`](app/layout.tsx) loads [Inter](https://github.com/rsms/inter) and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) through Next.js's Google Fonts integration. Both use SIL Open Font License 1.1. Their complete notices are preserved in [Inter-OFL-1.1.txt](LICENSES/Inter-OFL-1.1.txt) and [JetBrainsMono-OFL-1.1.txt](LICENSES/JetBrainsMono-OFL-1.1.txt), sourced from the Google Fonts distribution. Keep the fonts under OFL, including its reserved-name conditions, when redistributing them.

Interface icons come from [`lucide-react`](https://github.com/lucide-icons/lucide), under ISC with MIT notices for Feather-derived icons. The complete [Lucide/Feather notice](LICENSES/lucide-ISC-MIT.txt) is preserved. The original Holo Folder app mark is separate from Lucide.

## Dependencies

Dependencies retain their own licenses and copyright notices. Install them from `bun.lock`; this repository does not vendor `node_modules` or grant replacement licenses for those packages. Preserve their notices when redistributing an application build or container.

The installed macOS dependency snapshot reviewed on 2026-11-08 includes MPL-2.0 packages (`web-push`, `lightningcss`, `axe-core`), LGPL-3.0-or-later libvips binaries used by `sharp`, and CC-BY-4.0 `caniuse-lite` data, alongside MIT, ISC, BSD and Apache packages. This is not a complete notice bundle for a distributable build. Review the actual target platform's dependency tree and include the required upstream notices before distributing binaries or containers.

## External services

Provider access and hosted infrastructure are not included with the source. Self-hosters need their own Supabase, Vercel/Workflow, Stripe, image storage and pricing-provider configuration as applicable. API access, pricing feeds and image redistribution may require separate terms or permission.

## Runtime artwork sources

| Material                 | Source                                                                                                                                                                                       | Local reference                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Featured card images     | TCGdex, individual image and metadata URLs retained for each printing                                                                                                                        | `lib/featured-cards.ts`                                                                                                     |
| Pokémon official artwork | [PokeAPI sprites](https://github.com/PokeAPI/sprites), `sprites/pokemon/other/official-artwork/`                                                                                             | `lib/pokemon-artwork.ts`                                                                                                    |
| Official game renders    | [malie.io](https://malie.io/static/), which publishes the card images from the Pokémon TCG Live and Pokémon TCG Online clients. Thank you to malie for keeping them online.                  | Per-card matches in `card-assets/pokemon/tcg/discovered/malie.csv`, set mapping in `card-assets/pokemon/tcg/malie-sets.csv` |
| Supplemental card scans  | [TCGplayer](https://www.tcgplayer.com), [Pokémon TCG API](https://pokemontcg.io), [Scrydex](https://scrydex.com), [Limitless TCG](https://limitlesstcg.com), [Playshop](https://playshop.fr) | Host allowlist and deterministic source mapping in `lib/card-image-sources.ts`                                              |

Which source each card's image comes from is recorded in [`card-assets/`](card-assets/AGENTS.md). Its source classification (kind of image, size, permission) follows the [PTCG Image Atlas](https://github.com/nstrelow/ptcg-image-atlas) by Luna, whose `data.json` is copied in `card-assets/pokemon/tcg/atlas/` under the MIT licence (`card-assets/pokemon/tcg/atlas/LICENSE`).

These images are not covered by AGPL, the TCGdex database MIT license or the PokeAPI software license. Credit to a hosting provider does not transfer the underlying Pokémon artwork rights. Review provider terms before enabling mirroring or distributing image bundles.

## Historical starter assets

Early commits contain v0 starter icons and the `public/placeholder-*`/`public/placeholder.*` assets. They came with the initial [v0](https://v0.dev) scaffold (`2c07972`), not the Holo Folder mark, and were later replaced or removed. This attribution does not assign an invented MIT/AGPL license to them. See [asset provenance](docs/asset-provenance.md) for the exact paths and remaining source-license limits.
