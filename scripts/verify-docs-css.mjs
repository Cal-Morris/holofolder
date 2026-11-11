import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Validate the CSS actually linked by the prerender, including when Next restores a build cache.
const html = await readFile('.next/server/app/docs.html', 'utf8');
const styles = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)]
  .map(([tag]) => tag.match(/href="([^"]+)"/)?.[1])
  .filter(Boolean);
assert.ok(styles.length, 'Docs prerender must link its stylesheets');
const css = (
  await Promise.all(
    styles.map((href) => {
      const file = new URL(href, 'https://holofolder.com').pathname.replace(/^\/app\/_next\//, '');
      assert.ok(file.startsWith('static/'), `Unexpected docs stylesheet: ${href}`);
      return readFile(path.join('.next', file), 'utf8');
    }),
  )
).join('\n');
for (const rule of ['grid-area:sidebar', 'grid-area:header', '--tw-prose-headings']) {
  assert.ok(css.includes(rule), `Docs CSS is missing ${rule}; refusing to ship an unstyled docs layout`);
}
console.log('Docs CSS verified: sidebar, header and typography rules are in the linked bundles');
