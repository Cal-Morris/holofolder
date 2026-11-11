import test from 'node:test';
import assert from 'node:assert/strict';
import { pickExternalCardImageUrl } from '../lib/tcg-mirror';

test('a reviewed printing image takes precedence over its base card artwork', () => {
  assert.equal(
    pickExternalCardImageUrl({
      catalog: { image: 'https://product-images.tcgplayer.com/685563.jpg' },
      tcgdex: { image: 'https://assets.tcgdex.net/en/me/mep/070/high.webp' },
    }),
    'https://product-images.tcgplayer.com/685563.jpg',
  );
});

test('pickExternalCardImageUrl prefers mirrored PokemonTCG art before TCGplayer product art', () => {
  assert.equal(
    pickExternalCardImageUrl({
      pokemon_tcg: {
        imageLarge: 'https://images.pokemontcg.io/smp/SM184_hires.png',
      },
      tcgdex: {
        variantThirdParty: [{ tcgplayer: 659232 }],
      },
    }),
    'https://images.pokemontcg.io/smp/SM184_hires.png',
  );
});

test('pickExternalCardImageUrl falls back to TCGplayer product art from TCGdex third-party metadata', () => {
  assert.equal(
    pickExternalCardImageUrl({
      tcgdex: {
        variantThirdParty: [{ tcgplayer: 659232 }],
      },
    }),
    'https://product-images.tcgplayer.com/659232.jpg',
  );
});

test('explicit-slot catalog mode includes non-dex rows while legacy search stays Pokémon-only', async () => {
  const { toSearchCardResult, cardSearchSelect } = await import('../lib/tcg-mirror');
  // Synthetic mirror row, not a real card or provider record.
  const trainer = {
    id: 'synthetic-trainer',
    series_id: 'synthetic',
    set_id: 'synthetic',
    local_id: '1',
    name_en: 'Trainer',
    name_json: { en: 'Trainer' },
    tcg_sets: { id: 'synthetic', name_en: 'Synthetic' },
    tcg_card_dex_ids: [],
  };
  assert.equal(toSearchCardResult(trainer, 'en'), null);
  assert.deepEqual(toSearchCardResult(trainer, 'en', true)?.dexIds, []);
  assert.equal(toSearchCardResult(trainer, 'en', true)?.name, 'Trainer');
  assert.equal(toSearchCardResult(trainer, 'ja', true)?.language, undefined);
  assert.equal(toSearchCardResult({ ...trainer, image_languages_json: ['ja'] }, 'ja', true)?.language, 'ja');
  assert.match(cardSearchSelect(), /tcg_card_dex_ids!inner\(/);
  assert.doesNotMatch(cardSearchSelect(true), /tcg_card_dex_ids!inner\(/);
  assert.match(cardSearchSelect(true), /tcg_card_dex_ids\(/);
  assert.deepEqual(
    toSearchCardResult({ ...trainer, tcg_card_dex_ids: [{ dex_id: 25 }, { dex_id: 143 }] }, 'en', true)?.dexIds,
    [25, 143],
  );
});
