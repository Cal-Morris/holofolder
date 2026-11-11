import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_FINISHES,
  CARD_LANGUAGES,
  SLOT_STATUSES,
  isSlotStatus,
  normalizeCardFinish,
  normalizeCardLanguage,
} from '../lib/domain/cards';

test('normalizeCardLanguage round-trips every supported language', () => {
  for (const language of CARD_LANGUAGES) {
    assert.equal(normalizeCardLanguage(language), language);
  }
});

test('normalizeCardLanguage trims, lowercases and falls back to English', () => {
  assert.equal(normalizeCardLanguage('  PT-BR '), 'pt-br');
  assert.equal(normalizeCardLanguage('JA'), 'ja');
  assert.equal(normalizeCardLanguage('zh'), 'en');
  assert.equal(normalizeCardLanguage(''), 'en');
  assert.equal(normalizeCardLanguage(null), 'en');
  assert.equal(normalizeCardLanguage(undefined), 'en');
  assert.equal(normalizeCardLanguage(42), 'en');
});

test('normalizeCardFinish round-trips every finish, including jumbo', () => {
  assert.equal(CARD_FINISHES.length, 14);
  for (const finish of CARD_FINISHES) {
    assert.equal(normalizeCardFinish(finish), finish);
  }
  assert.equal(normalizeCardFinish('jumbo'), 'jumbo');
});

test('normalizeCardFinish falls back to normal for unknown values', () => {
  assert.equal(normalizeCardFinish('HOLO'), 'normal');
  assert.equal(normalizeCardFinish('gold'), 'normal');
  assert.equal(normalizeCardFinish(null), 'normal');
  assert.equal(normalizeCardFinish({}), 'normal');
});

test('isSlotStatus accepts only known statuses', () => {
  for (const status of SLOT_STATUSES) {
    assert.equal(isSlotStatus(status), true);
  }
  assert.equal(isSlotStatus('owned'), false);
  assert.equal(isSlotStatus(undefined), false);
});
