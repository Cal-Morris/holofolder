/**
 * A card picture's DINOv3 fingerprint, computed exactly as the index build does (`bun run card-assets fingerprints`,
 * Transformers.js on sharp). The same code runs in the browser scan worker and on Node (a future server matcher), on
 * onnxruntime-web's WASM build in both, so the root install never needs onnxruntime-node. Callers decode the image
 * to RGBA themselves (canvas in the browser, sharp on Node) and pass the model and runtime bytes.
 */
import type * as Ort from 'onnxruntime-web/wasm';

export const PICTURE_DIM = 384;
export const PICTURE_INPUT_SIZE = 224;
// From the model's preprocessor_config.json (DINOv3ViTImageProcessor): resize to 224 × 224 bilinear, rescale by
// 1/255, normalise with the ImageNet mean and std. No crop, aspect ratio not kept, alpha dropped (do_convert_rgb).
const IMAGE_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGE_STD = [0.229, 0.224, 0.225] as const;
const RESCALE = 0.00392156862745098; // rescale_factor, 1/255
const SCALE = 4096; // libvips VIPS_INTERPOLATE_SCALE

/**
 * The model input from RGBA pixels, channels first. The resize is a bit-exact copy of what the build gets from
 * sharp's `affine` with the bilinear interpolator (libvips 8.18 resample/affine.c and interpolate.c): the input is
 * padded by one pixel, the matrix inverted as 1/det × d, the input x stepped by adding that inverse along each row,
 * and the 8-bit blend done in 12-bit fixed point. That exactness matters: the int8 model quantises its input with a
 * scale taken from the image, so a one-level rounding difference in a few pixels moves the fingerprint (cosine
 * 0.985 instead of 1). Sampling past the right or bottom edge (only when upscaling) clamps to the last pixel.
 */
export function preprocessCardImage(rgba: ArrayLike<number>, width: number, height: number) {
  const size = PICTURE_INPUT_SIZE;
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  const a = size / width;
  const d = size / height;
  const inverse = 1 / (a * d);
  const stepX = inverse * d;
  const stepY = inverse * a;
  for (let y = 0; y < size; y++) {
    const iy = stepY * y + 1;
    const fy = Math.floor(iy);
    const Y = Math.trunc((iy - fy) * SCALE);
    const y0 = Math.min(fy - 1, height - 1);
    const y1 = Math.min(fy, height - 1);
    let ix = 1;
    for (let x = 0; x < size; x++, ix += stepX) {
      const fx = Math.floor(ix);
      const X = Math.trunc((ix - fx) * SCALE);
      const x0 = Math.min(fx - 1, width - 1);
      const x1 = Math.min(fx, width - 1);
      const c4 = (Y * X) >> 12;
      const c2 = ((SCALE - Y) * X) >> 12;
      const c3 = Y - c4;
      const c1 = SCALE - Y - c2;
      const p1 = (y0 * width + x0) * 4;
      const p2 = (y0 * width + x1) * 4;
      const p3 = (y1 * width + x0) * 4;
      const p4 = (y1 * width + x1) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const value =
          (c1 * rgba[p1 + channel] +
            c2 * rgba[p2 + channel] +
            c3 * rgba[p3 + channel] +
            c4 * rgba[p4 + channel] +
            SCALE / 2) >>
          12;
        // Rescale and normalise as Transformers.js does, rounding to float32 in between.
        out[channel * plane + y * size + x] = (Math.fround(value * RESCALE) - IMAGE_MEAN[channel]) / IMAGE_STD[channel];
      }
    }
  }
  return out;
}

/** The fingerprint from the model's last hidden state: the CLS token (first 384 values), L2-normalised. */
export function fingerprintFromHiddenState(hidden: ArrayLike<number>) {
  const vector = Float32Array.from({ length: PICTURE_DIM }, (_, index) => hidden[index]);
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum) || 1;
  for (let index = 0; index < vector.length; index++) vector[index] /= norm;
  return vector;
}

export interface FingerprintModelFiles {
  /** onnxruntime-web's `ort-wasm-simd-threaded.wasm`, the same version as the installed package. */
  runtime: ArrayBuffer | Uint8Array;
  /** `model_quantized.onnx` and its external weights `model_quantized.onnx_data`. */
  model: ArrayBuffer | Uint8Array;
  modelData: ArrayBuffer | Uint8Array;
}

export const MODEL_DATA_FILE = 'model_quantized.onnx_data';

/** Loads the model; the returned function fingerprints one RGBA image (one at a time). */
export async function createCardFingerprinter(ort: typeof Ort, files: FingerprintModelFiles) {
  // One thread: browsers need cross-origin isolation for WASM threads, which the app doesn't have.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = files.runtime;
  const session = await ort.InferenceSession.create(new Uint8Array(files.model), {
    executionProviders: ['wasm'],
    externalData: [{ path: MODEL_DATA_FILE, data: new Uint8Array(files.modelData) }],
  });
  return async (rgba: ArrayLike<number>, width: number, height: number) => {
    const size = PICTURE_INPUT_SIZE;
    const input = new ort.Tensor('float32', preprocessCardImage(rgba, width, height), [1, 3, size, size]);
    const output = await session.run({ pixel_values: input }, ['last_hidden_state']);
    // [1, tokens, 384]: the CLS token comes first.
    return fingerprintFromHiddenState(output.last_hidden_state.data as Float32Array);
  };
}
