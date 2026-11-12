import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardLanguagesFromNames,
  cardMatchesLanguages,
  normalizeBinderCardLanguages,
  parseLanguageSearch,
} from '@/lib/card-languages';

describe('card languages', () => {
  test('reads printing languages from TCGdex name keys', () => {
    assert.deepEqual(cardLanguagesFromNames({ fr: 'Rapasdepic', en: 'Fearow', pt: 'Fearow', 'es-mx': 'x' }), [
      'en',
      'fr',
      'pt-br',
    ]);
    assert.deepEqual(cardLanguagesFromNames({ ja: 'オニドリル', th: 'x', 'zh-tw': 'x' }), ['ja']);
    assert.deepEqual(cardLanguagesFromNames({ en: '' }), []);
    assert.deepEqual(cardLanguagesFromNames(null), []);
  });

  test('normalizes a saved binder choice', () => {
    assert.deepEqual(normalizeBinderCardLanguages(['ja', 'en', 'ja', 'xx']), ['en', 'ja']);
    assert.equal(normalizeBinderCardLanguages([]), null);
    assert.equal(normalizeBinderCardLanguages(['xx']), null);
    assert.equal(normalizeBinderCardLanguages(null), null);
  });

  test('pulls language words out of a search', () => {
    assert.deepEqual(parseLanguageSearch('jpn 151'), { text: '151', languages: ['ja'] });
    assert.deepEqual(parseLanguageSearch('  ENG  Base Set '), { text: 'Base Set', languages: ['en'] });
    assert.deepEqual(parseLanguageSearch('crystal'), { text: 'crystal', languages: [] });
  });

  test('matches printings by language, keeping unknown ones', () => {
    assert.equal(cardMatchesLanguages({ languages: ['en', 'fr'] }, ['en']), true);
    assert.equal(cardMatchesLanguages({ languages: ['ja'] }, ['en']), false);
    assert.equal(cardMatchesLanguages({}, ['en']), true);
  });
});
