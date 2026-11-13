/// <reference lib="webworker" />
// The picture scanner's Web Worker: fingerprints a card crop (lib/card-picture-fingerprint.ts, onnxruntime-web on
// WASM) and compares it with the index, off the main thread. Started by lib/card-picture-scanner.ts on the first
// scan with the model, runtime and index it cached on the device, so nothing here touches the network.
import * as ort from 'onnxruntime-web/wasm';
import { createCardFingerprinter } from '@/lib/card-picture-fingerprint';
import { PICTURE_TOP_K, buildPictureIndex, findPictureMatches, type PictureIndex } from '@/lib/card-picture-match';

export type PictureWorkerRequest =
  | {
      type: 'init';
      runtime: ArrayBuffer;
      model: ArrayBuffer;
      modelData: ArrayBuffer;
      indexes: Array<{ language: string; ids: string[]; vectors: ArrayBuffer }>;
    }
  | { type: 'match'; id: number; image: Blob; k?: number }
  | { type: 'embed'; id: number; image: Blob };

export type PictureWorkerResponse =
  | { type: 'ready' }
  | { type: 'error'; id?: number; message: string }
  | {
      type: 'result';
      id: number;
      matches?: ReturnType<typeof findPictureMatches>;
      vector?: Float32Array;
      ms: { embed: number; match: number };
    };

let fingerprint: Awaited<ReturnType<typeof createCardFingerprinter>> | null = null;
let indexes: PictureIndex[] = [];

async function embed(image: Blob) {
  // No colour management: the build reads raw pixel values (sharp), and so must we.
  const bitmap = await createImageBitmap(image, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No 2D canvas in this browser');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  return fingerprint!(data, width, height);
}

self.onmessage = async ({ data }: MessageEvent<PictureWorkerRequest>) => {
  const post = (message: PictureWorkerResponse) => self.postMessage(message);
  try {
    if (data.type === 'init') {
      fingerprint = await createCardFingerprinter(ort, data);
      indexes = data.indexes.map((index) => buildPictureIndex(index.language, index.vectors, index.ids));
      post({ type: 'ready' });
      return;
    }
    if (!fingerprint) throw new Error('The picture scanner is not loaded');
    const started = performance.now();
    const vector = await embed(data.image);
    const embedded = performance.now();
    const matches = data.type === 'match' ? findPictureMatches(vector, indexes, data.k ?? PICTURE_TOP_K) : undefined;
    const ms = { embed: embedded - started, match: performance.now() - embedded };
    post({ type: 'result', id: data.id, ...(matches ? { matches } : { vector }), ms });
  } catch (error) {
    post({
      type: 'error',
      id: 'id' in data ? data.id : undefined,
      message: String((error as Error)?.message ?? error),
    });
  }
};
