const MATCH_CANVAS_WIDTH = 120;
const MATCH_CANVAS_HEIGHT = 168;
const REGION_COLS = 5;
const REGION_ROWS = 6;
const MICRO_COLOR_COLS = 10;
const MICRO_COLOR_ROWS = 14;
const EDGE_SIGNATURE_COLS = 5;
const EDGE_SIGNATURE_ROWS = 7;
const COLOR_BLOB_HUE_BINS = 8;
const EDGE_PROFILE_BANDS = 12;
const HASH_WIDTH = 13;
const HASH_HEIGHT = 18;
const AVERAGE_HASH_SIZE = 8;
const PATCH_HASH_WIDTH = 12;
const PATCH_HASH_HEIGHT = 12;
const PATCH_PROFILE_BANDS = 6;
const SOURCE_MAX_DIMENSION = 960;
const CARD_BOUNDS_SEARCH_MAX_DIMENSION = 320;
const CARD_BOUNDS_SMOOTH_RADIUS = 4;
const CARD_BOUNDS_MIN_AREA_RATIO = 0.42;
const CARD_BOUNDS_MAX_CENTER_OFFSET = 0.18;
const CARD_BOUNDS_ASPECT_TOLERANCE = 0.16;
const CARD_BOUNDS_EDGE_STRENGTH_RATIO = 1.08;
const CARD_BOUNDS_INSET_RATIO = 0.015;
const CARD_ASPECT_RATIO = MATCH_CANVAS_WIDTH / MATCH_CANVAS_HEIGHT;
const EPSILON = 1e-6;

const REGION_ROW_WEIGHTS = [1.18, 1.06, 0.96, 0.96, 1.02, 1.18];
const REGION_COL_WEIGHTS = [1.06, 0.98, 0.94, 0.98, 1.06];

const FOCUS_PATCH_SPECS = [
  { key: 'top_band', x: 0.08, y: 0.05, width: 0.84, height: 0.1, weight: 0.62 },
  { key: 'top_left', x: 0.09, y: 0.15, width: 0.34, height: 0.16, weight: 0.52 },
  { key: 'top_right', x: 0.57, y: 0.15, width: 0.25, height: 0.16, weight: 0.46 },
  { key: 'number_left', x: 0.04, y: 0.79, width: 0.2, height: 0.1, weight: 1.72 },
  { key: 'number_strip', x: 0.04, y: 0.8, width: 0.33, height: 0.09, weight: 1.98 },
  { key: 'set_right', x: 0.55, y: 0.78, width: 0.35, height: 0.14, weight: 0.94 },
] as const;

type ResizeMode = 'cover' | 'stretch';

interface CardCropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FocusPatchDescriptor {
  key: string;
  weight: number;
  horizontalHashBits: number[];
  verticalHashBits: number[];
  averageHashBits: number[];
  rowProfile: number[];
  columnProfile: number[];
}

interface BuildCardImageDescriptorOptions {
  requireCardBounds?: boolean;
}

export interface CardImageDescriptor {
  regionFeatures: number[];
  regionWeights: number[];
  horizontalHashBits: number[];
  verticalHashBits: number[];
  averageHashBits: number[];
  rowProfile: number[];
  columnProfile: number[];
  borderProfile: number[];
  microColorSignature: number[];
  edgeOrientationSignature: number[];
  colorBlobSignature: number[];
  focusPatches: FocusPatchDescriptor[];
}

export interface CardImageMatch {
  similarity: number;
  distance: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function drawImageToCanvas(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number,
  resizeMode: ResizeMode = 'cover',
) {
  context.clearRect(0, 0, targetWidth, targetHeight);

  if (resizeMode === 'stretch') {
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    return;
  }

  const scale = Math.max(targetWidth / imageWidth, targetHeight / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const offsetX = (targetWidth - drawWidth) / 2;
  const offsetY = (targetHeight - drawHeight) / 2;

  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

async function loadImageElement(source: string | Blob) {
  const image = new Image();
  let temporaryUrl: string | null = null;

  if (typeof source === 'string') {
    image.crossOrigin = 'anonymous';
    image.src = source;
  } else {
    temporaryUrl = URL.createObjectURL(source);
    image.src = temporaryUrl;
  }

  await image.decode();

  return {
    image,
    cleanup() {
      if (temporaryUrl) {
        URL.revokeObjectURL(temporaryUrl);
      }
    },
  };
}

function getBandIndex(position: number, length: number, bandCount: number) {
  return Math.min(bandCount - 1, Math.floor((position / Math.max(length, 1)) * bandCount));
}

function getRegionIndex(x: number, y: number, width: number, height: number) {
  const col = Math.min(REGION_COLS - 1, Math.floor((x / Math.max(width, 1)) * REGION_COLS));
  const row = Math.min(REGION_ROWS - 1, Math.floor((y / Math.max(height, 1)) * REGION_ROWS));
  return row * REGION_COLS + col;
}

function createCanvas(width: number, height: number, willReadFrequently = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently });

  if (!context) {
    throw new Error('Could not create an image analysis canvas.');
  }

  return { canvas, context };
}

function scaleCanvas(sourceCanvas: HTMLCanvasElement, maxDimension: number) {
  const scale = Math.min(1, maxDimension / Math.max(sourceCanvas.width, sourceCanvas.height));
  if (scale === 1) {
    return sourceCanvas;
  }

  const { canvas, context } = createCanvas(
    Math.max(1, Math.round(sourceCanvas.width * scale)),
    Math.max(1, Math.round(sourceCanvas.height * scale)),
  );

  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function buildSourceCanvas(source: string | Blob) {
  const { image, cleanup } = await loadImageElement(source);

  try {
    const sourceWidth = image.naturalWidth || MATCH_CANVAS_WIDTH;
    const sourceHeight = image.naturalHeight || MATCH_CANVAS_HEIGHT;
    const scale = Math.min(1, SOURCE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const { canvas, context } = createCanvas(width, height, true);
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    cleanup();
  }
}

function buildDifferenceHash(
  sourceCanvas: HTMLCanvasElement,
  axis: 'horizontal' | 'vertical',
  width: number,
  height: number,
  resizeMode: ResizeMode = 'cover',
) {
  const { context } = createCanvas(width, height, true);

  drawImageToCanvas(context, sourceCanvas, sourceCanvas.width, sourceCanvas.height, width, height, resizeMode);
  const pixels = context.getImageData(0, 0, width, height).data;
  const bits: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const compareX = axis === 'horizontal' ? x + 1 : x;
      const compareY = axis === 'vertical' ? y + 1 : y;

      if (compareX >= width || compareY >= height) {
        continue;
      }

      const leftIndex = (y * width + x) * 4;
      const rightIndex = (compareY * width + compareX) * 4;
      const leftLuma = 0.2126 * pixels[leftIndex] + 0.7152 * pixels[leftIndex + 1] + 0.0722 * pixels[leftIndex + 2];
      const rightLuma = 0.2126 * pixels[rightIndex] + 0.7152 * pixels[rightIndex + 1] + 0.0722 * pixels[rightIndex + 2];

      bits.push(leftLuma > rightLuma ? 1 : 0);
    }
  }

  return bits;
}

function buildAverageHash(sourceCanvas: HTMLCanvasElement, size: number, resizeMode: ResizeMode = 'cover') {
  const { context } = createCanvas(size, size, true);

  drawImageToCanvas(context, sourceCanvas, sourceCanvas.width, sourceCanvas.height, size, size, resizeMode);
  const pixels = context.getImageData(0, 0, size, size).data;
  const lumaValues: number[] = [];
  let lumaSum = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const luma = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
    lumaValues.push(luma);
    lumaSum += luma;
  }

  const average = lumaSum / Math.max(lumaValues.length, 1);
  return lumaValues.map((value) => (value > average ? 1 : 0));
}

function buildLumaGrid(sourceCanvas: HTMLCanvasElement) {
  const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Could not read the image analysis canvas.');
  }

  const { data } = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const luma = new Float32Array(sourceCanvas.width * sourceCanvas.height);

  for (let index = 0; index < luma.length; index += 1) {
    const pixelIndex = index * 4;
    luma[index] =
      0.2126 * (data[pixelIndex] / 255) + 0.7152 * (data[pixelIndex + 1] / 255) + 0.0722 * (data[pixelIndex + 2] / 255);
  }

  return luma;
}

function smoothProfile(profile: Float32Array, radius: number) {
  const smoothed = new Float32Array(profile.length);

  for (let index = 0; index < profile.length; index += 1) {
    let total = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const candidateIndex = index + offset;
      if (candidateIndex < 0 || candidateIndex >= profile.length) {
        continue;
      }
      total += profile[candidateIndex];
      count += 1;
    }
    smoothed[index] = total / Math.max(count, 1);
  }

  return smoothed;
}

function meanProfile(profile: Float32Array) {
  if (profile.length === 0) {
    return 0;
  }

  let total = 0;
  for (let index = 0; index < profile.length; index += 1) {
    total += profile[index];
  }
  return total / profile.length;
}

function findPeakIndex(profile: Float32Array, start: number, end: number) {
  const safeStart = clamp(Math.round(start), 0, profile.length - 1);
  const safeEnd = clamp(Math.round(end), safeStart + 1, profile.length);
  let bestIndex = safeStart;
  let bestValue = Number.NEGATIVE_INFINITY;

  for (let index = safeStart; index < safeEnd; index += 1) {
    if (profile[index] > bestValue) {
      bestValue = profile[index];
      bestIndex = index;
    }
  }

  return { index: bestIndex, value: bestValue };
}

function detectCardBounds(sourceCanvas: HTMLCanvasElement): CardCropBounds | null {
  const detectionCanvas = scaleCanvas(sourceCanvas, CARD_BOUNDS_SEARCH_MAX_DIMENSION);
  const width = detectionCanvas.width;
  const height = detectionCanvas.height;

  if (width < 40 || height < 56) {
    return null;
  }

  const luma = buildLumaGrid(detectionCanvas);
  const verticalProfile = new Float32Array(width);
  const horizontalProfile = new Float32Array(height);
  const yStart = Math.max(1, Math.round(height * 0.08));
  const yEnd = Math.max(yStart + 1, Math.round(height * 0.92));
  const xStart = Math.max(1, Math.round(width * 0.08));
  const xEnd = Math.max(xStart + 1, Math.round(width * 0.92));

  for (let y = yStart; y < yEnd; y += 1) {
    const rowOffset = y * width;
    for (let x = 1; x < width; x += 1) {
      verticalProfile[x] += Math.abs(luma[rowOffset + x] - luma[rowOffset + x - 1]);
    }
  }

  for (let y = 1; y < height; y += 1) {
    const rowOffset = y * width;
    const previousRowOffset = (y - 1) * width;
    for (let x = xStart; x < xEnd; x += 1) {
      horizontalProfile[y] += Math.abs(luma[rowOffset + x] - luma[previousRowOffset + x]);
    }
  }

  const smoothedVertical = smoothProfile(verticalProfile, CARD_BOUNDS_SMOOTH_RADIUS);
  const smoothedHorizontal = smoothProfile(horizontalProfile, CARD_BOUNDS_SMOOTH_RADIUS);
  const leftPeak = findPeakIndex(smoothedVertical, width * 0.02, width * 0.42);
  const rightPeak = findPeakIndex(smoothedVertical, width * 0.58, width * 0.98);
  const topPeak = findPeakIndex(smoothedHorizontal, height * 0.02, height * 0.34);
  const bottomPeak = findPeakIndex(smoothedHorizontal, height * 0.66, height * 0.98);

  if (rightPeak.index <= leftPeak.index + 12 || bottomPeak.index <= topPeak.index + 16) {
    return null;
  }

  const detectedWidth = rightPeak.index - leftPeak.index;
  const detectedHeight = bottomPeak.index - topPeak.index;
  const aspectRatio = detectedWidth / Math.max(detectedHeight, 1);
  const areaRatio = (detectedWidth * detectedHeight) / Math.max(width * height, 1);
  const centerOffsetX = Math.abs((leftPeak.index + rightPeak.index) * 0.5 - width * 0.5) / width;
  const centerOffsetY = Math.abs((topPeak.index + bottomPeak.index) * 0.5 - height * 0.5) / height;
  const meanVertical = meanProfile(smoothedVertical);
  const meanHorizontal = meanProfile(smoothedHorizontal);
  const edgeStrength =
    ((leftPeak.value + rightPeak.value) / Math.max(meanVertical * 2, EPSILON) +
      (topPeak.value + bottomPeak.value) / Math.max(meanHorizontal * 2, EPSILON)) *
    0.5;

  if (
    areaRatio < CARD_BOUNDS_MIN_AREA_RATIO ||
    Math.abs(aspectRatio - CARD_ASPECT_RATIO) > CARD_BOUNDS_ASPECT_TOLERANCE ||
    centerOffsetX > CARD_BOUNDS_MAX_CENTER_OFFSET ||
    centerOffsetY > CARD_BOUNDS_MAX_CENTER_OFFSET ||
    edgeStrength < CARD_BOUNDS_EDGE_STRENGTH_RATIO
  ) {
    return null;
  }

  const insetX = Math.round(detectedWidth * CARD_BOUNDS_INSET_RATIO);
  const insetY = Math.round(detectedHeight * CARD_BOUNDS_INSET_RATIO);
  const scaleX = sourceCanvas.width / width;
  const scaleY = sourceCanvas.height / height;

  return {
    x: clamp(Math.round((leftPeak.index + insetX) * scaleX), 0, sourceCanvas.width - 1),
    y: clamp(Math.round((topPeak.index + insetY) * scaleY), 0, sourceCanvas.height - 1),
    width: clamp(Math.round((detectedWidth - insetX * 2) * scaleX), 1, sourceCanvas.width),
    height: clamp(Math.round((detectedHeight - insetY * 2) * scaleY), 1, sourceCanvas.height),
  };
}

function normalizeCardCanvas(sourceCanvas: HTMLCanvasElement, bounds: CardCropBounds | null) {
  const { canvas, context } = createCanvas(MATCH_CANVAS_WIDTH, MATCH_CANVAS_HEIGHT, true);
  const sourceX = bounds?.x ?? 0;
  const sourceY = bounds?.y ?? 0;
  const sourceWidth = bounds?.width ?? sourceCanvas.width;
  const sourceHeight = bounds?.height ?? sourceCanvas.height;

  context.drawImage(
    sourceCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    MATCH_CANVAS_WIDTH,
    MATCH_CANVAS_HEIGHT,
  );

  return canvas;
}

function buildAxisProfile(sourceCanvas: HTMLCanvasElement, axis: 'row' | 'column', bandCount: number) {
  const luma = buildLumaGrid(sourceCanvas);
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const sums = new Float32Array(bandCount * 2);
  const counts = new Float32Array(bandCount);
  let mean = 0;

  for (let index = 0; index < luma.length; index += 1) {
    mean += luma[index];
  }

  mean /= Math.max(luma.length, 1);

  let variance = 0;
  for (let index = 0; index < luma.length; index += 1) {
    const delta = luma[index] - mean;
    variance += delta * delta;
  }
  const std = Math.sqrt(variance / Math.max(luma.length, 1)) || 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const band = axis === 'row' ? getBandIndex(y, height, bandCount) : getBandIndex(x, width, bandCount);
      const current = luma[pixelIndex];
      const right = x + 1 < width ? luma[pixelIndex + 1] : current;
      const down = y + 1 < height ? luma[pixelIndex + width] : current;

      sums[band * 2] += current;
      sums[band * 2 + 1] += Math.abs(current - right) + Math.abs(current - down);
      counts[band] += 1;
    }
  }

  const profile: number[] = [];
  for (let band = 0; band < bandCount; band += 1) {
    const count = counts[band] || 1;
    profile.push(
      clamp(((sums[band * 2] / count - mean) / (std * 3)) * 0.5 + 0.5, 0, 1),
      clamp((sums[band * 2 + 1] / count) * 1.4, 0, 1),
    );
  }

  return profile;
}

function buildMicroColorSignature(sourceCanvas: HTMLCanvasElement) {
  const { context } = createCanvas(MICRO_COLOR_COLS, MICRO_COLOR_ROWS, true);
  drawImageToCanvas(
    context,
    sourceCanvas,
    sourceCanvas.width,
    sourceCanvas.height,
    MICRO_COLOR_COLS,
    MICRO_COLOR_ROWS,
    'stretch',
  );
  const { data } = context.getImageData(0, 0, MICRO_COLOR_COLS, MICRO_COLOR_ROWS);
  const cells: Array<{ luma: number; saturation: number; rg: number; by: number }> = [];
  let lumaSum = 0;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index] / 255;
    const g = data[index + 1] / 255;
    const b = data[index + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const cell = {
      luma,
      saturation: max - min,
      rg: (r - g) * 0.5 + 0.5,
      by: ((r + g) * 0.5 - b) * 0.5 + 0.5,
    };

    cells.push(cell);
    lumaSum += luma;
  }

  const mean = lumaSum / Math.max(cells.length, 1);
  let variance = 0;
  for (const cell of cells) {
    const delta = cell.luma - mean;
    variance += delta * delta;
  }
  const std = Math.sqrt(variance / Math.max(cells.length, 1)) || 1;

  return cells.flatMap((cell) => [
    clamp(((cell.luma - mean) / (std * 3)) * 0.5 + 0.5, 0, 1),
    clamp(cell.saturation, 0, 1),
    clamp(cell.rg, 0, 1),
    clamp(cell.by, 0, 1),
  ]);
}

function getEdgeOrientationBin(dx: number, dy: number) {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX > absY * 1.45) return 0;
  if (absY > absX * 1.45) return 1;
  return dx * dy >= 0 ? 2 : 3;
}

function buildEdgeOrientationSignature(sourceCanvas: HTMLCanvasElement) {
  const luma = buildLumaGrid(sourceCanvas);
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const bins = new Float32Array(EDGE_SIGNATURE_COLS * EDGE_SIGNATURE_ROWS * 4);
  const cellTotals = new Float32Array(EDGE_SIGNATURE_COLS * EDGE_SIGNATURE_ROWS);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const dx = luma[index + 1] - luma[index - 1];
      const dy = luma[index + width] - luma[index - width];
      const magnitude = Math.sqrt(dx * dx + dy * dy);

      if (magnitude < 0.015) continue;

      const col = Math.min(EDGE_SIGNATURE_COLS - 1, Math.floor((x / width) * EDGE_SIGNATURE_COLS));
      const row = Math.min(EDGE_SIGNATURE_ROWS - 1, Math.floor((y / height) * EDGE_SIGNATURE_ROWS));
      const cellIndex = row * EDGE_SIGNATURE_COLS + col;
      const bin = getEdgeOrientationBin(dx, dy);

      bins[cellIndex * 4 + bin] += magnitude;
      cellTotals[cellIndex] += magnitude;
    }
  }

  const signature: number[] = [];
  for (let cellIndex = 0; cellIndex < cellTotals.length; cellIndex += 1) {
    const total = cellTotals[cellIndex] || 1;
    for (let bin = 0; bin < 4; bin += 1) {
      signature.push(clamp(bins[cellIndex * 4 + bin] / total, 0, 1));
    }
  }

  return signature;
}

function getHue(red: number, green: number, blue: number) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  if (delta <= EPSILON) return 0;

  let hue = 0;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return (hue / 6 + (hue < 0 ? 1 : 0)) % 1;
}

function buildColorBlobSignature(sourceCanvas: HTMLCanvasElement) {
  const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Could not read the normalized card canvas.');
  }

  const { data } = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const mass = new Float32Array(COLOR_BLOB_HUE_BINS);
  const xMass = new Float32Array(COLOR_BLOB_HUE_BINS);
  const yMass = new Float32Array(COLOR_BLOB_HUE_BINS);
  const centerSpreadMass = new Float32Array(COLOR_BLOB_HUE_BINS);
  let totalMass = 0;

  for (let y = 0; y < sourceCanvas.height; y += 1) {
    for (let x = 0; x < sourceCanvas.width; x += 1) {
      const index = (y * sourceCanvas.width + x) * 4;
      const alpha = data[index + 3] / 255;
      if (alpha <= 0.01) continue;

      const red = data[index] / 255;
      const green = data[index + 1] / 255;
      const blue = data[index + 2] / 255;
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const saturation = max - min;
      if (saturation < 0.08) continue;

      const hue = getHue(red, green, blue);
      const bin = Math.min(COLOR_BLOB_HUE_BINS - 1, Math.floor(hue * COLOR_BLOB_HUE_BINS));
      const pixelMass = saturation * alpha;
      const nx = x / Math.max(sourceCanvas.width - 1, 1);
      const ny = y / Math.max(sourceCanvas.height - 1, 1);
      const centerDistance = Math.sqrt((nx - 0.5) * (nx - 0.5) + (ny - 0.5) * (ny - 0.5)) / Math.SQRT1_2;

      mass[bin] += pixelMass;
      xMass[bin] += nx * pixelMass;
      yMass[bin] += ny * pixelMass;
      centerSpreadMass[bin] += clamp(centerDistance, 0, 1) * pixelMass;
      totalMass += pixelMass;
    }
  }

  const signature: number[] = [];
  for (let bin = 0; bin < COLOR_BLOB_HUE_BINS; bin += 1) {
    const binMass = mass[bin];
    signature.push(
      clamp(binMass / Math.max(totalMass, EPSILON), 0, 1),
      binMass > EPSILON ? clamp(xMass[bin] / binMass, 0, 1) : 0.5,
      binMass > EPSILON ? clamp(yMass[bin] / binMass, 0, 1) : 0.5,
      binMass > EPSILON ? clamp(centerSpreadMass[bin] / binMass, 0, 1) : 0.5,
    );
  }

  return signature;
}

function buildFocusPatchDescriptor(
  sourceCanvas: HTMLCanvasElement,
  spec: (typeof FOCUS_PATCH_SPECS)[number],
): FocusPatchDescriptor {
  const sourceX = Math.round(spec.x * sourceCanvas.width);
  const sourceY = Math.round(spec.y * sourceCanvas.height);
  const sourceWidth = Math.max(1, Math.round(spec.width * sourceCanvas.width));
  const sourceHeight = Math.max(1, Math.round(spec.height * sourceCanvas.height));
  const patchWidth = Math.max(24, Math.round(spec.width * MATCH_CANVAS_WIDTH * 2.4));
  const patchHeight = Math.max(24, Math.round(spec.height * MATCH_CANVAS_HEIGHT * 2.4));
  const { canvas, context } = createCanvas(patchWidth, patchHeight, true);

  context.drawImage(sourceCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, patchWidth, patchHeight);

  return {
    key: spec.key,
    weight: spec.weight,
    horizontalHashBits: buildDifferenceHash(canvas, 'horizontal', PATCH_HASH_WIDTH, PATCH_HASH_HEIGHT, 'stretch'),
    verticalHashBits: buildDifferenceHash(canvas, 'vertical', PATCH_HASH_WIDTH, PATCH_HASH_HEIGHT, 'stretch'),
    averageHashBits: buildAverageHash(canvas, AVERAGE_HASH_SIZE, 'stretch'),
    rowProfile: buildAxisProfile(canvas, 'row', PATCH_PROFILE_BANDS),
    columnProfile: buildAxisProfile(canvas, 'column', PATCH_PROFILE_BANDS),
  };
}

function analyzeNormalizedCardCanvas(canvas: HTMLCanvasElement): CardImageDescriptor {
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Could not read the normalized card canvas.');
  }

  const { data: pixels } = context.getImageData(0, 0, MATCH_CANVAS_WIDTH, MATCH_CANVAS_HEIGHT);
  const regionCount = REGION_COLS * REGION_ROWS;
  const regionLuma = new Float32Array(regionCount);
  const regionSat = new Float32Array(regionCount);
  const regionEdge = new Float32Array(regionCount);
  const regionRg = new Float32Array(regionCount);
  const regionBy = new Float32Array(regionCount);
  const regionCounts = new Float32Array(regionCount);
  const regionContrastAccum = new Float32Array(regionCount);
  const lumaValues = new Float32Array(MATCH_CANVAS_WIDTH * MATCH_CANVAS_HEIGHT);
  const rowProfile = new Float32Array(EDGE_PROFILE_BANDS * 3);
  const columnProfile = new Float32Array(EDGE_PROFILE_BANDS * 3);
  const borderProfile = new Float32Array(16);
  let globalLumaSum = 0;

  for (let y = 0; y < MATCH_CANVAS_HEIGHT; y += 1) {
    for (let x = 0; x < MATCH_CANVAS_WIDTH; x += 1) {
      const pixelIndex = (y * MATCH_CANVAS_WIDTH + x) * 4;
      const r = pixels[pixelIndex] / 255;
      const g = pixels[pixelIndex + 1] / 255;
      const b = pixels[pixelIndex + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const saturation = max - min;
      const rg = (r - g) * 0.5 + 0.5;
      const by = ((r + g) * 0.5 - b) * 0.5 + 0.5;
      const regionIndex = getRegionIndex(x, y, MATCH_CANVAS_WIDTH, MATCH_CANVAS_HEIGHT);
      const rowBand = getBandIndex(y, MATCH_CANVAS_HEIGHT, EDGE_PROFILE_BANDS);
      const colBand = getBandIndex(x, MATCH_CANVAS_WIDTH, EDGE_PROFILE_BANDS);

      regionLuma[regionIndex] += luma;
      regionSat[regionIndex] += saturation;
      regionRg[regionIndex] += rg;
      regionBy[regionIndex] += by;
      regionCounts[regionIndex] += 1;
      rowProfile[rowBand * 3] += luma;
      rowProfile[rowBand * 3 + 1] += saturation;
      rowProfile[rowBand * 3 + 2] += 1;
      columnProfile[colBand * 3] += luma;
      columnProfile[colBand * 3 + 1] += saturation;
      columnProfile[colBand * 3 + 2] += 1;
      lumaValues[y * MATCH_CANVAS_WIDTH + x] = luma;
      globalLumaSum += luma;
    }
  }

  const globalLumaMean = globalLumaSum / Math.max(lumaValues.length, 1);
  let globalVariance = 0;

  for (let index = 0; index < lumaValues.length; index += 1) {
    const delta = lumaValues[index] - globalLumaMean;
    globalVariance += delta * delta;
    const regionIndex = getRegionIndex(
      index % MATCH_CANVAS_WIDTH,
      Math.floor(index / MATCH_CANVAS_WIDTH),
      MATCH_CANVAS_WIDTH,
      MATCH_CANVAS_HEIGHT,
    );
    regionContrastAccum[regionIndex] += delta * delta;
  }

  const globalLumaStd = Math.sqrt(globalVariance / Math.max(lumaValues.length, 1)) || 1;

  for (let y = 0; y < MATCH_CANVAS_HEIGHT; y += 1) {
    for (let x = 0; x < MATCH_CANVAS_WIDTH; x += 1) {
      const pixelFlatIndex = y * MATCH_CANVAS_WIDTH + x;
      const current = lumaValues[pixelFlatIndex];
      const right = x + 1 < MATCH_CANVAS_WIDTH ? lumaValues[pixelFlatIndex + 1] : current;
      const down = y + 1 < MATCH_CANVAS_HEIGHT ? lumaValues[pixelFlatIndex + MATCH_CANVAS_WIDTH] : current;
      const edgeMagnitude = Math.abs(current - right) + Math.abs(current - down);
      const regionIndex = getRegionIndex(x, y, MATCH_CANVAS_WIDTH, MATCH_CANVAS_HEIGHT);
      const rowBand = getBandIndex(y, MATCH_CANVAS_HEIGHT, EDGE_PROFILE_BANDS);
      const colBand = getBandIndex(x, MATCH_CANVAS_WIDTH, EDGE_PROFILE_BANDS);

      regionEdge[regionIndex] += edgeMagnitude;
      rowProfile[rowBand * 3 + 1] += edgeMagnitude * 0.25;
      columnProfile[colBand * 3 + 1] += edgeMagnitude * 0.25;

      if (y < 3) borderProfile[getBandIndex(x, MATCH_CANVAS_WIDTH, 4)] += current;
      if (y >= MATCH_CANVAS_HEIGHT - 3) borderProfile[4 + getBandIndex(x, MATCH_CANVAS_WIDTH, 4)] += current;
      if (x < 3) borderProfile[8 + getBandIndex(y, MATCH_CANVAS_HEIGHT, 4)] += current;
      if (x >= MATCH_CANVAS_WIDTH - 3) borderProfile[12 + getBandIndex(y, MATCH_CANVAS_HEIGHT, 4)] += current;
    }
  }

  const regionFeatures: number[] = [];
  const regionWeights: number[] = [];

  for (let row = 0; row < REGION_ROWS; row += 1) {
    for (let col = 0; col < REGION_COLS; col += 1) {
      const regionIndex = row * REGION_COLS + col;
      const count = regionCounts[regionIndex] || 1;
      const meanLuma = regionLuma[regionIndex] / count;
      const meanSat = regionSat[regionIndex] / count;
      const meanEdge = regionEdge[regionIndex] / count;
      const meanRg = regionRg[regionIndex] / count;
      const meanBy = regionBy[regionIndex] / count;
      const contrast = Math.sqrt(regionContrastAccum[regionIndex] / count) / (globalLumaStd + EPSILON);

      regionFeatures.push(
        clamp(((meanLuma - globalLumaMean) / (globalLumaStd * 3)) * 0.5 + 0.5, 0, 1),
        clamp(meanSat, 0, 1),
        clamp(meanEdge * 2.75, 0, 1),
        clamp(meanRg, 0, 1),
        clamp(meanBy, 0, 1),
        clamp(contrast * 0.55, 0, 1),
      );

      regionWeights.push(REGION_ROW_WEIGHTS[row] * REGION_COL_WEIGHTS[col]);
    }
  }

  const normalizedRowProfile: number[] = [];
  const normalizedColumnProfile: number[] = [];

  for (let band = 0; band < EDGE_PROFILE_BANDS; band += 1) {
    const rowCount = rowProfile[band * 3 + 2] || 1;
    const colCount = columnProfile[band * 3 + 2] || 1;
    normalizedRowProfile.push(
      clamp(((rowProfile[band * 3] / rowCount - globalLumaMean) / (globalLumaStd * 3)) * 0.5 + 0.5, 0, 1),
      clamp((rowProfile[band * 3 + 1] / rowCount) * 1.2, 0, 1),
    );
    normalizedColumnProfile.push(
      clamp(((columnProfile[band * 3] / colCount - globalLumaMean) / (globalLumaStd * 3)) * 0.5 + 0.5, 0, 1),
      clamp((columnProfile[band * 3 + 1] / colCount) * 1.2, 0, 1),
    );
  }

  const normalizedBorderProfile = [...borderProfile].map((value, index) => {
    const divisor = index < 8 ? (MATCH_CANVAS_WIDTH / 4) * 3 : (MATCH_CANVAS_HEIGHT / 4) * 3;
    return clamp(((value / Math.max(divisor, 1) - globalLumaMean) / (globalLumaStd * 3)) * 0.5 + 0.5, 0, 1);
  });

  return {
    regionFeatures,
    regionWeights,
    horizontalHashBits: buildDifferenceHash(canvas, 'horizontal', HASH_WIDTH, HASH_HEIGHT),
    verticalHashBits: buildDifferenceHash(canvas, 'vertical', HASH_WIDTH, HASH_HEIGHT),
    averageHashBits: buildAverageHash(canvas, AVERAGE_HASH_SIZE),
    rowProfile: normalizedRowProfile,
    columnProfile: normalizedColumnProfile,
    borderProfile: normalizedBorderProfile,
    microColorSignature: buildMicroColorSignature(canvas),
    edgeOrientationSignature: buildEdgeOrientationSignature(canvas),
    colorBlobSignature: buildColorBlobSignature(canvas),
    focusPatches: FOCUS_PATCH_SPECS.map((spec) => buildFocusPatchDescriptor(canvas, spec)),
  };
}

export async function buildCardImageDescriptor(
  source: string | Blob,
  options: BuildCardImageDescriptorOptions = {},
): Promise<CardImageDescriptor> {
  const sourceCanvas = await buildSourceCanvas(source);
  const bounds = detectCardBounds(sourceCanvas);

  if (!bounds && options.requireCardBounds) {
    throw new Error('Could not detect the card border in that frame.');
  }

  const normalizedCanvas = normalizeCardCanvas(sourceCanvas, bounds);

  return analyzeNormalizedCardCanvas(normalizedCanvas);
}

function compareFloatArrays(left: number[], right: number[], weight = 1) {
  const count = Math.min(left.length, right.length);
  if (count === 0) return 1;

  let distance = 0;
  for (let index = 0; index < count; index += 1) {
    distance += Math.abs(left[index] - right[index]) * weight;
  }
  return distance / count;
}

function compareHashBits(left: number[], right: number[]) {
  const count = Math.min(left.length, right.length);
  if (count === 0) return 1;

  let distance = 0;
  for (let index = 0; index < count; index += 1) {
    if (left[index] !== right[index]) {
      distance += 1;
    }
  }
  return distance / count;
}

function compareFocusPatch(
  queryPatch: FocusPatchDescriptor | undefined,
  candidatePatch: FocusPatchDescriptor | undefined,
) {
  if (!queryPatch || !candidatePatch) {
    return 1;
  }

  return (
    compareHashBits(queryPatch.horizontalHashBits, candidatePatch.horizontalHashBits) * 0.24 +
    compareHashBits(queryPatch.verticalHashBits, candidatePatch.verticalHashBits) * 0.24 +
    compareHashBits(queryPatch.averageHashBits, candidatePatch.averageHashBits) * 0.16 +
    compareFloatArrays(queryPatch.rowProfile, candidatePatch.rowProfile) * 0.18 +
    compareFloatArrays(queryPatch.columnProfile, candidatePatch.columnProfile) * 0.18
  );
}

function getFocusPatchByKey(patches: FocusPatchDescriptor[], key: string) {
  return patches.find((patch) => patch.key === key);
}

function combineDistances(entries: Array<{ distance: number; weight: number }>) {
  if (entries.length === 0) {
    return 1;
  }

  let distance = 0;
  let weightSum = 0;

  for (const entry of entries) {
    distance += entry.distance * entry.weight;
    weightSum += entry.weight;
  }

  return distance / Math.max(weightSum, EPSILON);
}

export function compareCardImageDescriptors(
  query: CardImageDescriptor,
  candidate: CardImageDescriptor,
): CardImageMatch {
  const regionCount = Math.min(query.regionWeights.length, candidate.regionWeights.length);
  let regionDistance = 0;
  let regionWeightSum = 0;

  for (let regionIndex = 0; regionIndex < regionCount; regionIndex += 1) {
    const featureStart = regionIndex * 6;
    const weight = (query.regionWeights[regionIndex] + candidate.regionWeights[regionIndex]) * 0.5;

    regionDistance +=
      Math.abs(query.regionFeatures[featureStart] - candidate.regionFeatures[featureStart]) * 0.16 * weight;
    regionDistance +=
      Math.abs(query.regionFeatures[featureStart + 1] - candidate.regionFeatures[featureStart + 1]) * 0.13 * weight;
    regionDistance +=
      Math.abs(query.regionFeatures[featureStart + 2] - candidate.regionFeatures[featureStart + 2]) * 0.24 * weight;
    regionDistance +=
      Math.abs(query.regionFeatures[featureStart + 3] - candidate.regionFeatures[featureStart + 3]) * 0.15 * weight;
    regionDistance +=
      Math.abs(query.regionFeatures[featureStart + 4] - candidate.regionFeatures[featureStart + 4]) * 0.15 * weight;
    regionDistance +=
      Math.abs(query.regionFeatures[featureStart + 5] - candidate.regionFeatures[featureStart + 5]) * 0.17 * weight;
    regionWeightSum += weight;
  }

  regionDistance /= Math.max(regionWeightSum, EPSILON);

  const rowProfileDistance = compareFloatArrays(query.rowProfile, candidate.rowProfile);
  const columnProfileDistance = compareFloatArrays(query.columnProfile, candidate.columnProfile);
  const borderProfileDistance = compareFloatArrays(query.borderProfile, candidate.borderProfile);
  const horizontalHashDistance = compareHashBits(query.horizontalHashBits, candidate.horizontalHashBits);
  const verticalHashDistance = compareHashBits(query.verticalHashBits, candidate.verticalHashBits);
  const averageHashDistance = compareHashBits(query.averageHashBits, candidate.averageHashBits);
  const microColorDistance = compareFloatArrays(query.microColorSignature, candidate.microColorSignature);
  const edgeOrientationDistance = compareFloatArrays(
    query.edgeOrientationSignature,
    candidate.edgeOrientationSignature,
  );
  const colorBlobDistance = compareFloatArrays(query.colorBlobSignature, candidate.colorBlobSignature);
  const numberLeftDistance = compareFocusPatch(
    getFocusPatchByKey(query.focusPatches, 'number_left'),
    getFocusPatchByKey(candidate.focusPatches, 'number_left'),
  );
  const numberStripDistance = compareFocusPatch(
    getFocusPatchByKey(query.focusPatches, 'number_strip'),
    getFocusPatchByKey(candidate.focusPatches, 'number_strip'),
  );
  const setRightDistance = compareFocusPatch(
    getFocusPatchByKey(query.focusPatches, 'set_right'),
    getFocusPatchByKey(candidate.focusPatches, 'set_right'),
  );
  const topDistance = combineDistances([
    {
      distance: compareFocusPatch(
        getFocusPatchByKey(query.focusPatches, 'top_band'),
        getFocusPatchByKey(candidate.focusPatches, 'top_band'),
      ),
      weight: 0.42,
    },
    {
      distance: compareFocusPatch(
        getFocusPatchByKey(query.focusPatches, 'top_left'),
        getFocusPatchByKey(candidate.focusPatches, 'top_left'),
      ),
      weight: 0.33,
    },
    {
      distance: compareFocusPatch(
        getFocusPatchByKey(query.focusPatches, 'top_right'),
        getFocusPatchByKey(candidate.focusPatches, 'top_right'),
      ),
      weight: 0.25,
    },
  ]);

  const numberDistance = combineDistances([
    { distance: numberStripDistance, weight: 0.68 },
    { distance: numberLeftDistance, weight: 0.24 },
    { distance: setRightDistance, weight: 0.08 },
  ]);

  const structuralDistance = combineDistances([
    { distance: regionDistance, weight: 0.5 },
    { distance: rowProfileDistance, weight: 0.1 },
    { distance: columnProfileDistance, weight: 0.08 },
    { distance: borderProfileDistance, weight: 0.07 },
    { distance: horizontalHashDistance, weight: 0.1 },
    { distance: verticalHashDistance, weight: 0.07 },
    { distance: averageHashDistance, weight: 0.08 },
  ]);
  const fineDetailDistance = combineDistances([
    { distance: microColorDistance, weight: 0.54 },
    { distance: edgeOrientationDistance, weight: 0.46 },
  ]);

  const distance =
    numberDistance * 0.42 +
    setRightDistance * 0.08 +
    topDistance * 0.08 +
    structuralDistance * 0.14 +
    fineDetailDistance * 0.22 +
    colorBlobDistance * 0.08 +
    Math.max(0, numberDistance - 0.34) * 0.22;

  return {
    distance,
    similarity: clamp(1 - distance, 0, 1),
  };
}
