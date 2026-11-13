import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportFile } from '../lib/collection-import';

test('CSV parser preserves quoted commas, escaped quotes, BOM and multiline cells', () => {
  const doc = parseImportFile('\ufeffName,Set,Note\r\n"Bulbasaur, special","Base Set","line 1\nline ""2"""\r\n');
  assert.deepEqual(doc.headers, ['Name', 'Set', 'Note']);
  assert.deepEqual(doc.records, [['Bulbasaur, special', 'Base Set', 'line 1\nline "2"']]);
  assert.throws(() => parseImportFile('Name,Set\n"unclosed,Base'), /quote/i);
  assert.throws(() => parseImportFile('Name,Name\nA,B'), /header/i);
  assert.throws(() => parseImportFile('Name\n' + 'A\n'.repeat(5001)), /5,000/);
});
