// The picture scanner on the device: downloads the DINOv3 model, the onnxruntime-web runtime and the fingerprint
// index for the languages someone collects, keeps them in the `binderdex-offline` IndexedDB store so scanning works
// offline, and runs matches in a Web Worker (lib/card-picture-worker.ts). Nothing loads until the first scan or the
// "Download scanner for offline" switch; until then scanning reads text only.
import { getOfflineStore, type OfflineKeyValueStore } from '@/lib/offline-store/kv';
import { pictureIndexLanguages, type PictureMatch } from '@/lib/card-picture-match';
import type { PictureWorkerRequest, PictureWorkerResponse } from '@/lib/card-picture-worker';

const ASSETS = 'https://assets.holofolder.com/pokemon/tcg';
/** Model weights, their licence and the WASM runtime (overridable for dev, e.g. a local folder served over HTTP). */
export const PICTURE_MODEL_BASE_URL = withSlash(
  process.env.NEXT_PUBLIC_PICTURE_MODEL_BASE_URL || `${ASSETS}/models/dinov3-vits16-q8/`,
);
/** The published fingerprint index (lib/card-assets/fingerprints.ts FINGERPRINT_PREFIX). */
export const PICTURE_INDEX_BASE_URL = withSlash(
  process.env.NEXT_PUBLIC_PICTURE_INDEX_BASE_URL || `${ASSETS}/fingerprints/v1/dinov3-vits16-q8/`,
);
/** Must match the installed onnxruntime-web: its JS and WASM halves only work together (a unit test checks). */
export const ONNX_RUNTIME_VERSION = '1.31.1';
export const PICTURE_MODEL_FILES = {
  model: 'model_quantized.onnx',
  modelData: 'model_quantized.onnx_data',
  runtime: `ort-wasm-simd-threaded-${ONNX_RUNTIME_VERSION}.wasm`,
} as const;
/** Download size of the model and runtime, for the switch's label before anything is fetched. */
export const PICTURE_MODEL_BYTES = 183_889 + 21_762_048 + 14_848_852;

const KEY = 'picture-scanner:';
const FILE_NAMES = ['runtime', 'model', 'modelData'] as const;
const FILE_KEYS = FILE_NAMES.map((name) => `${KEY}${name}`);
const MANIFEST_KEY = `${KEY}manifest`;

function withSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`;
}

interface IndexManifest {
  languages: Record<string, { count: number; vectors: string; ids: string; bytes: number }>;
}
interface StoredIndex {
  vectors: string;
  ids: string[];
  data: ArrayBuffer;
}

function isManifest(value: unknown): value is IndexManifest {
  const languages = (value as IndexManifest | null)?.languages;
  return (
    !!languages &&
    typeof languages === 'object' &&
    Object.values(languages).every((files) => typeof files?.vectors === 'string' && typeof files?.ids === 'string')
  );
}

// Card languages in the collection, set by the binder (lib/card-picture-match.ts maps them to index languages).
let collectedLanguages: string[] = ['en'];
export function setPictureScannerLanguages(languages: Iterable<string>) {
  collectedLanguages = [...new Set(languages)];
}
export function getPictureScannerLanguages() {
  return collectedLanguages;
}

export interface PictureScannerStatus {
  /** Model, runtime and every wanted language's index are on this device. */
  ready: boolean;
  /** Languages whose index is on this device. */
  languages: string[];
  /** Bytes on the device now, or (when nothing is) roughly what a download takes. */
  bytes: number;
}

function store(): OfflineKeyValueStore {
  const offline = getOfflineStore();
  if (!offline) throw new Error('This browser can’t store the picture scanner.');
  return offline;
}

export async function getPictureScannerStatus(): Promise<PictureScannerStatus> {
  const offline = getOfflineStore();
  if (!offline) return { ready: false, languages: [], bytes: PICTURE_MODEL_BYTES };
  const [[manifest, ...files], indexKeys] = await Promise.all([
    offline.getMany<unknown>([MANIFEST_KEY, ...FILE_KEYS]),
    offline.keys(`${KEY}index:`),
  ]);
  const languages = indexKeys.map((key) => key.slice(`${KEY}index:`.length));
  const modelReady = files.every((file) => file instanceof ArrayBuffer);
  const wanted = isManifest(manifest)
    ? pictureIndexLanguages(collectedLanguages, Object.keys(manifest.languages))
    : null;
  const ready = modelReady && !!wanted?.length && wanted.every((language) => languages.includes(language));
  const indexBytes = isManifest(manifest)
    ? (modelReady ? languages : (wanted ?? [])).reduce(
        (sum, language) => sum + (manifest.languages[language]?.bytes ?? 0),
        0,
      )
    : 0;
  return { ready, languages, bytes: (modelReady || !languages.length ? PICTURE_MODEL_BYTES : 0) + indexBytes };
}

async function fetchManifest() {
  const response = await fetch(`${PICTURE_INDEX_BASE_URL}manifest.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`The scanner index isn’t available (${response.status}).`);
  const manifest: unknown = await response.json().catch(() => null);
  if (!isManifest(manifest)) throw new Error('The scanner index isn’t available right now.');
  return manifest;
}

async function fetchBytes(url: string, onBytes: (bytes: number) => void) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        onBytes(chunk.byteLength);
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(counted).arrayBuffer();
}

let download: Promise<void> | null = null;

/**
 * Fetches whatever isn't on the device yet (the model once, then an index per collected language, replaced when a
 * newer one is published). `onProgress` gets bytes so far and the expected total.
 */
export function downloadPictureScanner(onProgress?: (loaded: number, total: number) => void) {
  download ??= (async () => {
    const offline = store();
    const manifest = await fetchManifest();
    const languages = pictureIndexLanguages(collectedLanguages, Object.keys(manifest.languages));
    const [have, stored] = await Promise.all([
      offline.getMany<unknown>(FILE_KEYS),
      offline.getMany<StoredIndex>(languages.map((language) => `${KEY}index:${language}`)),
    ]);
    const files = FILE_NAMES.filter((_, index) => !(have[index] instanceof ArrayBuffer));
    const indexes = languages.filter(
      (language, index) => stored[index]?.vectors !== manifest.languages[language].vectors,
    );
    const total =
      (files.length ? PICTURE_MODEL_BYTES : 0) +
      indexes.reduce((sum, language) => sum + manifest.languages[language].bytes, 0);
    let loaded = 0;
    const onBytes = (bytes: number) => onProgress?.((loaded += bytes), Math.max(total, loaded));
    onProgress?.(0, total);
    const saveFile = async (name: (typeof FILE_NAMES)[number]) =>
      offline.set(`${KEY}${name}`, await fetchBytes(`${PICTURE_MODEL_BASE_URL}${PICTURE_MODEL_FILES[name]}`, onBytes));
    const saveIndex = async (language: string) => {
      const files = manifest.languages[language];
      const [data, ids] = await Promise.all([
        fetchBytes(`${PICTURE_INDEX_BASE_URL}${files.vectors}`, onBytes),
        fetchBytes(`${PICTURE_INDEX_BASE_URL}${files.ids}`, onBytes),
      ]);
      const parsed: unknown = JSON.parse(new TextDecoder().decode(ids));
      if (!Array.isArray(parsed) || data.byteLength !== parsed.length * 384)
        throw new Error('The scanner index download is incomplete.');
      await offline.set(`${KEY}index:${language}`, { vectors: files.vectors, ids: parsed, data } satisfies StoredIndex);
    };
    await Promise.all([...files.map(saveFile), ...indexes.map(saveIndex)]);
    await offline.set(MANIFEST_KEY, manifest);
    if (indexes.length || files.length) stopWorker();
  })().finally(() => {
    download = null;
  });
  return download;
}

/** Starts a download in the background when it's sensible (online, no data saver), for the first scan online. */
export function warmPictureScanner() {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (!navigator.onLine || saveData || download) return;
  void getPictureScannerStatus()
    .then((status) => (status.ready ? undefined : downloadPictureScanner()))
    .catch((error) => console.info('[holofolder] Picture scanner not downloaded:', error));
}

export async function removePictureScanner() {
  stopWorker();
  const offline = store();
  const keys = await offline.keys(KEY);
  await Promise.all(keys.map((key) => offline.delete(key)));
}

let worker: Worker | null = null;
let ready: Promise<boolean> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;
const pending = new Map<number, (response: PictureWorkerResponse) => void>();

function stopWorker() {
  worker?.terminate();
  worker = null;
  ready = null;
}

/** Loads the cached model and index into the worker; false when the scanner isn't downloaded. */
function startWorker() {
  ready ??= (async () => {
    const offline = getOfflineStore();
    if (!offline || typeof Worker === 'undefined') return false;
    const indexKeys = await offline.keys(`${KEY}index:`);
    const [[runtime, model, modelData], indexes] = await Promise.all([
      offline.getMany<ArrayBuffer>(FILE_KEYS),
      offline.getMany<StoredIndex>(indexKeys),
    ]);
    if (![runtime, model, modelData].every((file) => file instanceof ArrayBuffer) || !indexes.length) return false;
    const languages = indexKeys.map((key) => key.slice(`${KEY}index:`.length));
    worker = new Worker(new URL('./card-picture-worker.ts', import.meta.url), { type: 'module' });
    const loaded = new Promise<boolean>((resolve, reject) => {
      worker!.onmessage = ({ data }: MessageEvent<PictureWorkerResponse>) => {
        if (data.type === 'ready') resolve(true);
        else if (data.type === 'error' && data.id === undefined) reject(new Error(data.message));
        else if ('id' in data && data.id !== undefined) pending.get(data.id)?.(data);
      };
      worker!.onerror = (event) => reject(new Error(event.message || 'The picture scanner failed to start.'));
    });
    const request: PictureWorkerRequest = {
      type: 'init',
      runtime: runtime!,
      model: model!,
      modelData: modelData!,
      indexes: indexes.map((index, at) => ({ language: languages[at], ids: index!.ids, vectors: index!.data })),
    };
    worker.postMessage(request, [runtime!, model!, modelData!, ...indexes.map((index) => index!.data)]);
    return loaded;
  })().catch((error) => {
    console.info('[holofolder] Picture scanner unavailable:', error);
    stopWorker();
    return false;
  });
  return ready;
}

export interface PictureScan {
  matches: PictureMatch[];
  ms: { embed: number; match: number };
}

/** The closest cards to a crop (data URL or image), or null when the picture scanner isn't on this device. */
export async function matchCardPicture(image: string | Blob): Promise<PictureScan | null> {
  if (!(await startWorker()) || !worker) return null;
  const blob = typeof image === 'string' ? await (await fetch(image)).blob() : image;
  // One crop at a time: the WASM session runs one inference at a time anyway.
  const run = queue.then(
    () =>
      new Promise<PictureScan>((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, (data) => {
          pending.delete(id);
          if (data.type === 'result') resolve({ matches: data.matches ?? [], ms: data.ms });
          else reject(new Error(data.type === 'error' ? data.message : 'Unexpected scanner reply'));
        });
        worker!.postMessage({ type: 'match', id, image: blob } satisfies PictureWorkerRequest);
      }),
  );
  queue = run.catch(() => undefined);
  return run.catch((error) => {
    console.info('[holofolder] Picture match failed:', error);
    return null;
  });
}
