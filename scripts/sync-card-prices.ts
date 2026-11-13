import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { getMirrorDatabaseUrl } from '../lib/card-db-sync';
import { loadProjectEnvFiles } from '../lib/load-project-env';
import { normalizeCatalogName, readCatalogMetadata } from '../lib/card-catalog';
import {
  matchPriceProduct,
  normalizePriceCardName,
  normalizePriceHistory,
  priceHistoryFromRows,
  PRICE_HISTORY_DAYS,
  type CardPriceHistoryPoint,
} from '../lib/card-price-history';
import {
  buildCardPriceSnapshotFromPricing,
  loadDisplayFxRates,
  pickTcgplayerProductIdsFromExternalIds,
  snapshotToRow,
} from '../lib/card-pricing';
import { applyPriceStaleness } from '../lib/price-freshness';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    card: { type: 'string' },
    'source-dir': { type: 'string', default: '.cache/card-prices' },
    days: { type: 'string', default: '90' },
    report: { type: 'string' },
  },
});
const days = Number(values.days);
if (!Number.isInteger(days) || days < 1 || days > PRICE_HISTORY_DAYS)
  throw new Error(`--days must be 1–${PRICE_HISTORY_DAYS}`);
const dir = path.resolve(values['source-dir']);
const ARCHIVE_REF = '84eeee7331ded271a31dbd77727b2cfa5cd86deb';
// shortcut: the free archive ends on this date, use a verified newer archive to close later gaps.
const ARCHIVE_LAST_DAY = '2026-09-15';
const headers = { 'User-Agent': 'HoloFolder/0.1 (+https://holofolder.com)' };
const normalizeNumber = (value: string) =>
  value
    .split('/')[0]
    .toLowerCase()
    .replace(/(?<!\d)0+(?=\d)/g, '');
type Product = {
  productId: number;
  groupId: number;
  name: string;
  extendedData: Array<{ name: string; value: string }>;
};
type Card = {
  id: string;
  name_en: string;
  local_id: string;
  set_name: string;
  external_ids_json: unknown;
  source_product_url: string | null;
  history_points: unknown;
};

async function source(file: string, url: string, immutable = false): Promise<Buffer> {
  const dest = path.join(dir, file);
  try {
    if (immutable || Date.now() - (await stat(dest)).mtimeMs < 86_400_000) return await readFile(dest);
  } catch {
    /* Fetch an uncached source. */
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > 10_000_000) throw new Error(`Source exceeds the 10 MB file budget: ${url}`);
  await writeFile(dest, body);
  return body;
}
async function json(file: string, url: string) {
  const data = JSON.parse((await source(file, url)).toString());
  if (data.success !== true || !Array.isArray(data.results)) throw new Error(`Invalid provider response: ${url}`);
  return data.results;
}

async function main() {
  await loadProjectEnvFiles();
  await mkdir(dir, { recursive: true });
  const databaseUrl = new URL(getMirrorDatabaseUrl());
  if (['localhost', '127.0.0.1'].includes(databaseUrl.hostname)) databaseUrl.searchParams.delete('sslmode');
  const client = new Client({ connectionString: databaseUrl.toString() });
  await client.connect();
  try {
    const schema = await client.query(
      "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='card_prices' and column_name='history_points') as ready",
    );
    if (values.apply && !schema.rows[0].ready) throw new Error('Apply migration 029 before importing price history');
    const cards = (
      await client.query<Card>(
        `select c.id,c.name_en,c.local_id,s.name_en set_name,c.external_ids_json,
      e.raw_json->'tcgplayer'->>'url' source_product_url, ${schema.rows[0].ready ? 'p.history_points' : "'[]'::jsonb history_points"}
      from public.tcg_cards c join public.tcg_sets s on s.id=c.set_id
      left join public.tcg_card_external_sources e on e.card_id=c.id and e.source='pokemon_tcg'
      left join public.card_prices p on p.card_id=c.id and p.language='en'
      where ($1::text is null or c.id=$1) order by c.id`,
        [values.card ?? null],
      )
    ).rows;
    const updatedResponse = await fetch('https://tcgcsv.com/last-updated.txt', {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!updatedResponse.ok) throw new Error(`TCGCSV build timestamp: HTTP ${updatedResponse.status}`);
    const updated = new Date((await updatedResponse.text()).trim());
    if (!Number.isFinite(updated.getTime()) || updated.getTime() > Date.now())
      throw new Error('Invalid provider build timestamp');
    const groups: Array<{ groupId: number; name: string }> = await json(
      'tcgcsv-groups.json',
      'https://tcgcsv.com/tcgplayer/3/groups',
    );
    const groupNames = new Map(groups.map((g) => [g.groupId, g.name]));
    const products = new Map<string, Product>();
    const identities = new Map<string, Product[]>();
    for (const group of groups) {
      if (!Number.isSafeInteger(group.groupId) || /japan/i.test(group.name)) continue;
      const rows = await json(
        `tcgcsv-${group.groupId}.json`,
        `https://tcgcsv.com/tcgplayer/3/${group.groupId}/products`,
      );
      for (const p of rows) {
        if (!Number.isSafeInteger(p.productId) || typeof p.name !== 'string' || !Array.isArray(p.extendedData))
          continue;
        const number = p.extendedData.find((d: { name: string }) => d.name === 'Number')?.value;
        if (typeof number !== 'string' || !/^[a-z]*\d+[a-z]?(?:\/[a-z]*\d+)?$/i.test(number)) continue;
        if (
          p.extendedData.some(
            (d: { value?: string }) => typeof d.value === 'string' && /printed in Japanese only/i.test(d.value),
          )
        )
          continue;
        const product = { ...p, groupId: group.groupId };
        products.set(String(p.productId), product);
        const key = `${normalizePriceCardName(p.name, number)}:${normalizeNumber(number)}`;
        identities.set(key, [...(identities.get(key) ?? []), product]);
      }
    }
    const matched: Array<{ card: Card; product: Product; history: CardPriceHistoryPoint[] }> = [];
    for (const card of cards) {
      if (!card.name_en || !card.set_name) continue;
      const metadata = readCatalogMetadata(card.external_ids_json);
      const linkedProduct = metadata.productId ?? card.source_product_url?.match(/(?:product\/|[?&]id=)(\d+)/)?.[1];
      const number = metadata.localId ?? card.local_id;
      const collector = normalizeCatalogName(card.set_name) === 'celebrations' ? number.replace(/a$/i, '') : number;
      const candidates =
        metadata.productId || metadata.variantId
          ? linkedProduct && products.has(linkedProduct)
            ? [products.get(linkedProduct)!]
            : []
          : (identities.get(`${normalizePriceCardName(card.name_en, number)}:${normalizeNumber(collector)}`) ?? []);
      const exact = candidates.filter((p) =>
        matchPriceProduct(
          { name: card.name_en, number: metadata.localId ?? card.local_id, setName: card.set_name },
          p,
          groupNames.get(p.groupId) ?? '',
        ),
      );
      const linkedIds = new Set([
        ...pickTcgplayerProductIdsFromExternalIds(card.external_ids_json),
        ...(linkedProduct ? [linkedProduct] : []),
      ]);
      const preferred = exact.filter((p) => linkedIds.has(String(p.productId)));
      const chosen = preferred.length === 1 ? preferred[0] : exact.length === 1 ? exact[0] : null;
      if (!chosen) continue;
      matched.push({ card, product: chosen, history: normalizePriceHistory(card.history_points) });
    }
    console.log(`Matched ${matched.length}/${cards.length} catalog entries to one exact English product`);
    const matchedGroups = [...new Set(matched.map((m) => m.product.groupId))];
    const currentPrices = new Map<number, unknown[]>();
    for (const groupId of matchedGroups)
      currentPrices.set(
        groupId,
        await json(
          `tcgcsv-prices-${groupId}-${updated.toISOString().slice(0, 10)}.json`,
          `https://tcgcsv.com/tcgplayer/3/${groupId}/prices`,
        ),
      );
    const receipts: Array<{ date: string; sha256: string; bytes: number }> = [];
    for (let offset = days - 1; offset >= 0; offset--) {
      const date = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
      if (date > ARCHIVE_LAST_DAY) continue;
      const file = `prices-${date}.tar.gz`;
      const buffer = await source(
        file,
        `https://raw.githubusercontent.com/landonrroy/pokefolio-data/${ARCHIVE_REF}/data/${date.slice(0, 4)}/${file}`,
        true,
      );
      // Only read known English price members, never extract paths supplied by the archive.
      const members = execFileSync('tar', ['-tzf', path.join(dir, file)], { maxBuffer: 2_000_000 })
        .toString()
        .split('\n');
      const wanted = members.filter((member) => new RegExp(`^${date}/3/\\d+/prices$`).test(member));
      if (!wanted.length) throw new Error(`Archive has no English price files: ${date}`);
      const payload = execFileSync('tar', ['-xOzf', path.join(dir, file), ...wanted], {
        maxBuffer: 30_000_000,
      }).toString();
      const priceRows = payload.split(/(?<=\})\s*(?=\{"success")/).flatMap((text) => JSON.parse(text).results ?? []);
      const byProduct = new Map<string, unknown[]>();
      for (const row of priceRows)
        byProduct.set(String(row.productId), [...(byProduct.get(String(row.productId)) ?? []), row]);
      for (const m of matched)
        m.history.push(
          ...priceHistoryFromRows(byProduct.get(String(m.product.productId)), String(m.product.productId), date),
        );
      receipts.push({ date, sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length });
      if (receipts.length % 10 === 0) console.log(`Read ${receipts.length} historical daily snapshots`);
    }
    const fx = await loadDisplayFxRates();
    if (!fx) throw new Error('Current prices require verified ECB rates');
    const rows = matched
      .map((m) => {
        const prices = priceHistoryFromRows(
          currentPrices.get(m.product.groupId),
          String(m.product.productId),
          updated.toISOString().slice(0, 10),
        );
        const tcgplayer = Object.fromEntries(
          prices.map((p) => [
            p.finish === 'reverse_holo' ? 'reverse' : p.finish,
            { productId: p.productId, marketPrice: p.amount, lowPrice: p.lowAmount },
          ]),
        );
        const snapshot = applyPriceStaleness(
          buildCardPriceSnapshotFromPricing(
            m.card.id,
            'en',
            { tcgplayer: { updated: updated.toISOString(), ...tcgplayer } },
            fx,
          ),
          Date.now(),
        );
        return { ...snapshotToRow(snapshot), history_points: normalizePriceHistory([...m.history, ...prices]) };
      })
      .filter((row) => row.gbp_amount != null || row.history_points.length);
    const report = {
      archiveRef: ARCHIVE_REF,
      currentUpdatedAt: updated.toISOString(),
      catalogEntries: cards.length,
      matched: matched.length,
      currentPriced: rows.filter((r) => r.gbp_amount != null).length,
      withHistory: rows.filter((r) => r.history_points.length > 1).length,
      historyPoints: rows.reduce((sum, r) => sum + r.history_points.length, 0),
      receipts,
      applied: false,
    };
    const reportPath = values.report ?? path.join(dir, 'price-import-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, receipts: receipts.length, reportPath }));
    if (!values.apply) return;
    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='60s'");
      const lock = await client.query('select pg_try_advisory_xact_lock(10250419) locked');
      if (!lock.rows[0].locked) throw new Error('Another price import is running');
      const columns = Object.keys(rows[0] ?? {}).filter((c) => c !== 'history_points');
      const quoteFields = columns.filter((c) => !['card_id', 'language'].includes(c));
      const links = matched.map((m) => ({
        card_id: m.card.id,
        source: 'tcgcsv-pricing',
        source_card_id: String(m.product.productId),
        source_set_id: String(m.product.groupId),
      }));
      for (let offset = 0; offset < links.length; offset += 200) {
        await client.query(
          `insert into public.tcg_card_external_sources(card_id,source,source_card_id,source_set_id)
          select card_id,source,source_card_id,source_set_id from jsonb_populate_recordset(null::public.tcg_card_external_sources,$1::jsonb)
          on conflict(card_id,source) do update set source_card_id=excluded.source_card_id,source_set_id=excluded.source_set_id`,
          [JSON.stringify(links.slice(offset, offset + 200))],
        );
      }
      for (let offset = 0; offset < rows.length; offset += 100) {
        // Never overwrite a live quote; history is merged by real date, product and finish.
        await client.query(
          `insert into public.card_prices (${columns.join(',')},history_points)
          select ${columns.map((c) => `r.${c}`).join(',')},r.history_points from jsonb_populate_recordset(null::public.card_prices,$1::jsonb) r
          on conflict(card_id,language) do update set
          ${quoteFields.map((c) => `${c}=case when card_prices.gbp_amount is null and excluded.gbp_amount is not null then excluded.${c} else card_prices.${c} end`).join(',')},
          history_points=(select coalesce(jsonb_agg(point order by point->>'date',point->>'finish'),'[]'::jsonb) from (
            select distinct on (point->>'date',point->>'productId',point->>'finish') point from jsonb_array_elements(card_prices.history_points || excluded.history_points) point
            where point->>'date' >= to_char(now()-interval '89 days','YYYY-MM-DD') order by point->>'date',point->>'productId',point->>'finish'
          ) merged)`,
          [JSON.stringify(rows.slice(offset, offset + 100))],
        );
      }
      await client.query('COMMIT');
      report.applied = true;
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`Applied ${rows.length} price/history records without replacing existing live quotes`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
