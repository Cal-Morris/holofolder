/**
 * bun scripts/card-picture-parity.ts [--count 16] [--index <url or dir>] [--no-browser]
 *
 * Checks that lib/card-picture-fingerprint.ts gives the same fingerprints everywhere it runs: on Node (as a server
 * matcher would) and in Chromium (as the scan worker does), against the published index rows for a spread of cards.
 * Both runs get the same pixels (decoded once with sharp), so any gap is the model run, not image decoding.
 * Downloads the model from Hugging Face into .cache/card-picture-model on first use; reads card images over the
 * public asset URL. Read-only: writes nothing but that cache.
 *
 * Expect 1.00000 between Node and Chromium. Against the index, 1.00000 needs an index built with this module; the
 * first published index was built with onnxruntime-node, whose int8 kernels differ slightly (about 0.97-0.999).
 */
import * as ort from 'onnxruntime-web/wasm';
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createCardFingerprinter, type FingerprintModelFiles } from '../lib/card-picture-fingerprint';
import { cosine, FINGERPRINT_PREFIX } from '../lib/card-assets/fingerprints';

const arg = (name: string) => process.argv[process.argv.indexOf(`--${name}`) + 1];
const count = Number(process.argv.includes('--count') ? arg('count') : 16);
const indexBase = process.argv.includes('--index')
  ? arg('index').replace(/\/?$/, '/')
  : `https://assets.holofolder.com/${FINGERPRINT_PREFIX}/`;
const HF = 'https://huggingface.co/onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX/resolve/main/onnx/';
const cache = path.resolve('.cache/card-picture-model');

async function read(location: string) {
  if (!/^https?:/.test(location)) return new Uint8Array(await readFile(location));
  const response = await fetch(location);
  if (!response.ok) throw new Error(`${location}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function modelFiles(): Promise<FingerprintModelFiles> {
  await mkdir(cache, { recursive: true });
  const file = async (name: string) => {
    const local = path.join(cache, name);
    if (!existsSync(local)) await writeFile(local, await read(`${HF}${name}`));
    return new Uint8Array(await readFile(local));
  };
  return {
    runtime: new Uint8Array(await readFile(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'))),
    model: await file('model_quantized.onnx'),
    modelData: await file('model_quantized.onnx_data'),
  };
}

async function main() {
  const manifest = JSON.parse(new TextDecoder().decode(await read(`${indexBase}manifest.json`)));
  const samples: Array<{ id: string; language: string; key: string; row: Int8Array }> = [];
  for (const [language, files] of Object.entries<{ vectors: string; ids: string; sources: string }>(
    manifest.languages,
  )) {
    const ids: string[] = JSON.parse(new TextDecoder().decode(await read(`${indexBase}${files.ids}`)));
    const sources: [string, string][] = JSON.parse(
      new TextDecoder().decode(await read(`${indexBase}${files.sources}`)),
    );
    const vectors = await read(`${indexBase}${files.vectors}`);
    const take = Math.max(1, Math.round(count / Object.keys(manifest.languages).length));
    for (let k = 0; k < take; k++) {
      const i = Math.floor(((k + 0.5) * ids.length) / take);
      samples.push({
        id: ids[i],
        language,
        key: sources[i][0],
        row: new Int8Array(vectors.slice(i * 384, i * 384 + 384)),
      });
    }
  }

  const files = await modelFiles();
  const fingerprint = await createCardFingerprinter(ort, files);
  const pixels = await Promise.all(
    samples.map(async (sample) => {
      const image = await read(`https://assets.holofolder.com/${sample.key}`);
      const { data, info } = await sharp(image).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data: Array.from(data), width: info.width, height: info.height };
    }),
  );
  const node: Float32Array[] = [];
  for (const image of pixels) node.push(await fingerprint(image.data, image.width, image.height));

  let browserVectors: number[][] | null = null;
  if (!process.argv.includes('--no-browser')) {
    const { chromium } = await import('@playwright/test');
    // The same module plus onnxruntime-web's bundled WASM build, as the scan worker ships it.
    const entry = path.join(cache, 'browser-entry.ts');
    await writeFile(
      entry,
      `import * as ort from 'onnxruntime-web/wasm';\nimport { createCardFingerprinter } from '${path.resolve('lib/card-picture-fingerprint.ts')}';\nexport const create = (files) => createCardFingerprinter(ort, files);\n`,
    );
    // Run with Bun (the repo's runtime); its bundler isn't in the TypeScript types here.
    const { Bun } = globalThis as unknown as {
      Bun: { build(options: object): Promise<{ outputs: Array<{ text(): Promise<string> }> }> };
    };
    const bundle = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'esm' });
    const code = await bundle.outputs[0].text();
    const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      browserVectors = await page.evaluate(
        async ({ code, runtime, model, modelData, pixels }) => {
          const decode = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
          const loaded = await import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
          const run = await loaded.create({
            runtime: decode(runtime),
            model: decode(model),
            modelData: decode(modelData),
          });
          const out: number[][] = [];
          for (const image of pixels) out.push(Array.from(await run(image.data, image.width, image.height)));
          return out;
        },
        {
          code,
          runtime: encode(files.runtime as Uint8Array),
          model: encode(files.model as Uint8Array),
          modelData: encode(files.modelData as Uint8Array),
          pixels,
        },
      );
    } finally {
      await browser.close();
    }
  }

  let worst = { browser: 1, index: 1 };
  samples.forEach((sample, i) => {
    const vsIndex = cosine(node[i], sample.row);
    const vsBrowser = browserVectors ? cosine(node[i], browserVectors[i]) : null;
    worst = { browser: Math.min(worst.browser, vsBrowser ?? 1), index: Math.min(worst.index, vsIndex) };
    console.log(
      `${sample.language} ${sample.id}`.padEnd(28),
      `node vs chromium ${vsBrowser?.toFixed(5) ?? 'skipped'}`,
      ` node vs index row ${vsIndex.toFixed(5)}`,
    );
  });
  console.log(
    JSON.stringify({ samples: samples.length, worstNodeVsChromium: worst.browser, worstNodeVsIndex: worst.index }),
  );
  if (worst.browser < 0.999) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
