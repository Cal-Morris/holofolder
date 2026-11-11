import {
  buildExternalIds,
  normalizeVariants,
  type TCGCard,
  type MirrorCardRow,
  type MirrorSetRow,
} from './card-db-sync';
import { pickLocalizedText, buildTcgdexAssetImageUrl } from './tcgdex-shared';

/** Preserve upstream printing IDs and localized evidence from either TCGdex source tree. */
export function buildSourceCardRows(
  source: TCGCard,
  localId: string,
  language: string,
  commit: string,
  hasImage: boolean,
  sourcePath?: string,
) {
  const set = source.set;
  const serie = set?.serie;
  const validId = (id: string) => /^[A-Za-z0-9!?%][A-Za-z0-9._!+?%-]{0,63}$/.test(id) && !id.includes('..');
  if (!set?.id || !serie?.id || !validId(set.id) || !validId(serie.id) || !validId(localId))
    throw new Error(`Invalid source identity: ${serie?.id}/${set?.id}/${localId}`);
  if (typeof source.name !== 'object' || !source.name[language] || !set.name[language] || !serie.name[language])
    throw new Error('Missing source language evidence');
  const id = `${set.id}-${localId}`;
  const provenance = {
    source: 'https://github.com/tcgdex/cards-database',
    sourceCommit: commit,
    sourcePath: sourcePath ?? `data-asia/${serie.id}/${set.id}/${localId}.ts`,
    language,
  };
  const release = typeof set.releaseDate === 'object' ? set.releaseDate[language] : set.releaseDate;
  const numericLocalId = Number.parseInt(localId.match(/\d+/)?.[0] ?? '', 10);
  const card: MirrorCardRow = {
    id,
    series_id: serie.id,
    set_id: set.id,
    local_id: localId,
    local_id_sort: Number.isFinite(numericLocalId) ? numericLocalId : null,
    name_json: source.name,
    name_en: pickLocalizedText(source.name),
    category: source.category ?? null,
    rarity: source.rarity ?? null,
    hp: source.hp !== undefined && Number.isFinite(Number(source.hp)) ? Number(source.hp) : null,
    illustrator: source.illustrator ?? null,
    types_json: source.types ?? [],
    image_languages_json: hasImage ? [language] : [],
    variants_json: normalizeVariants(source.variants),
    external_ids_json: buildExternalIds({
      ...source,
      image: hasImage ? buildTcgdexAssetImageUrl(language, serie.id, set.id, localId) : undefined,
    }),
    raw_json: { ...source, ...provenance },
  };
  const setRow: MirrorSetRow = {
    id: set.id,
    series_id: serie.id,
    name_json: set.name,
    name_en: pickLocalizedText(set.name),
    official_card_count: set.cardCount?.official ?? null,
    release_date: release && /^\d{4}-\d{2}-\d{2}$/.test(release) ? release : null,
    raw_json: {
      ...set,
      ...provenance,
      sourcePath: sourcePath ? sourcePath.replace(/\/[^/]+\.ts$/, '.ts') : `data-asia/${serie.id}/${set.id}.ts`,
    },
  };
  const dexLinks: Array<{ card_id: string; dex_id: number }> = [];
  for (const dex_id of source.dexId ?? [])
    if (Number.isSafeInteger(dex_id) && dex_id > 0) dexLinks.push({ card_id: id, dex_id });
  return {
    card,
    set: setRow,
    series: {
      id: serie.id,
      name_json: serie.name,
      name_en: pickLocalizedText(serie.name),
      raw_json: { ...serie, ...provenance },
    },
    dexLinks,
  };
}

/** Some historical Japanese and international releases reuse the same upstream ID. */
export function hasSourceSetConflict(
  existing: Pick<MirrorSetRow, 'series_id' | 'official_card_count' | 'release_date' | 'name_json'>,
  incoming: MirrorSetRow,
) {
  return (
    existing.series_id !== incoming.series_id ||
    (existing.official_card_count !== null &&
      incoming.official_card_count !== null &&
      existing.official_card_count !== incoming.official_card_count) ||
    (existing.release_date !== null &&
      incoming.release_date !== null &&
      existing.release_date !== incoming.release_date) ||
    Object.keys(incoming.name_json).some(
      (l) => existing.name_json[l] && existing.name_json[l] !== incoming.name_json[l],
    )
  );
}
