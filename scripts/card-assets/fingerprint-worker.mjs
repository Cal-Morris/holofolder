// One fingerprint process for `card-assets fingerprints`, run on Node (sharp hangs under Bun 1.4). It decodes each
// image with sharp and fingerprints it with lib/card-picture-fingerprint.ts on onnxruntime-web's WASM build, exactly
// as the scan worker in the browser and the server matcher do, so all three agree. Reads newline-delimited JSON
// `{ n, image }` (base64) on stdin and answers `{ n, vector }` or `{ n, error }` on stdout, one image at a time.
import * as ort from 'onnxruntime-web/wasm';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createCardFingerprinter, PICTURE_MODEL_FILES } from '../../lib/card-picture-fingerprint.ts';

const modelDir = process.argv[2];
const file = (name) => readFile(path.join(modelDir, PICTURE_MODEL_FILES[name]));
const fingerprint = await createCardFingerprinter(ort, {
  runtime: await file('runtime'),
  model: await file('model'),
  modelData: await file('modelData'),
});

for await (const line of createInterface({ input: process.stdin })) {
  const { n, image } = JSON.parse(line);
  try {
    const { data, info } = await sharp(Buffer.from(image, 'base64'))
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const vector = await fingerprint(data, info.width, info.height);
    process.stdout.write(`${JSON.stringify({ n, vector: Array.from(vector) })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ n, error: error instanceof Error ? error.message : String(error) })}\n`);
  }
}
