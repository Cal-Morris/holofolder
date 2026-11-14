import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImportFile, readImportRows } from '../lib/collection-import';

test('CSV parser preserves quoted commas, escaped quotes, BOM and multiline cells', () => {
  const doc = parseImportFile('\ufeffName,Set,Note\r\n"Bulbasaur, special","Base Set","line 1\nline ""2"""\r\n');
  assert.deepEqual(doc.headers, ['Name', 'Set', 'Note']);
  assert.deepEqual(doc.records, [['Bulbasaur, special', 'Base Set', 'line 1\nline "2"']]);
  assert.throws(() => parseImportFile('Name,Set\n"unclosed,Base'), /quote/i);
  assert.throws(() => parseImportFile('Name,Name\nA,B'), /header/i);
  assert.throws(() => parseImportFile('Name\n' + 'A\n'.repeat(5001)), /5,000/);
});

const fixture = (name: string) =>
  readImportRows(
    parseImportFile(readFileSync(new URL(`./fixtures/imports/synthetic-${name}.csv`, import.meta.url), 'utf8')),
  );

test('Collectr exports are recognised and mapped; watchlist, sealed and unsupported prints stay for review', () => {
  const { source, rows } = fixture('collectr');
  assert.equal(source, 'collectr');
  assert.deepEqual(rows[0].lookup, {
    language: 'en',
    finish: 'reverse_holo',
    list: 'owned',
    cardName: 'Cinccino',
    set: 'Black Bolt',
    number: '076/086',
  });
  assert.deepEqual(rows[0].dropped, ['condition', 'notes']);
  assert.equal(rows[2].grading?.provider.kind, 'known');
  assert.equal(rows[2].grading?.grade, '10');
  assert.equal(rows[3].quantity, 3);
  assert.match(rows[6].problem ?? '', /1st Edition/);
  assert.deepEqual(rows[7].grading?.provider, { kind: 'known', id: 'cgc' });
  assert.match(rows[9].problem ?? '', /Poke Ball/);
  assert.equal(rows[10].lookup?.language, 'ja');
  assert.equal(rows[10].lookup?.cardName, 'Umbreon ex');
  assert.match(rows[11].problem ?? '', /watchlist/i);
  assert.match(rows[13].problem ?? '', /sealed/);
  assert.equal(rows[19].row, 21);
});

test('TCG Collector and PriceCharting exports are recognised and mapped', () => {
  const tcg = fixture('tcgcollector');
  assert.equal(tcg.source, 'tcgcollector');
  assert.equal(tcg.rows[2].lookup?.language, 'de');
  assert.equal(tcg.rows[6].quantity, 2);
  assert.match(tcg.rows[7].problem ?? '', /1st Edition/);
  assert.match(tcg.rows[12].problem ?? '', /Cosmos/);
  assert.equal(tcg.rows[13].lookup?.language, 'ja');
  const pc = fixture('pricecharting');
  assert.equal(pc.source, 'pricecharting');
  assert.deepEqual(pc.rows[0].lookup, {
    language: 'en',
    finish: 'reverse_holo',
    list: 'owned',
    cardName: 'Cinccino',
    set: 'Black Bolt',
    number: '76',
  });
  assert.equal(pc.rows[1].lookup?.finish, 'normal');
  assert.equal(pc.rows[1].lookup?.set, 'Scarlet & Violet 151');
  assert.match(pc.rows[4].problem ?? '', /1st Edition/);
  assert.equal(pc.rows[5].grading?.certificate, '00000000');
  assert.equal(pc.rows[8].lookup?.language, 'ja');
  assert.equal(pc.rows[8].lookup?.set, 'Base Set');
  assert.match(pc.rows[14].problem ?? '', /sealed/);
});

test('generic spreadsheets use the column aliases and refuse unreadable grades and quantities', () => {
  const { source, rows } = readImportRows(
    parseImportFile(
      'Name,Set,Number,Qty,Grade\nPikachu,Base Set,58/102,2,\nPikachu,Base Set,58/102,x,\nMew,Promo,8,1,Mint\n',
    ),
  );
  assert.equal(source, 'generic');
  assert.equal(rows[0].lookup?.number, '58/102');
  assert.equal(rows[0].quantity, 2);
  assert.match(rows[1].problem ?? '', /Quantity/);
  assert.match(rows[2].problem ?? '', /grade/);
});
