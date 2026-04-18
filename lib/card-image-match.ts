const MATCH_CANVAS_WIDTH = 96
const MATCH_CANVAS_HEIGHT = 134
const MATCH_GRID_COLS = 6
const MATCH_GRID_ROWS = 8
const HASH_COLS = 9
const HASH_ROWS = 8
const EPSILON = 1e-6

export interface CardImageDescriptor {
  gridFeatures: number[]
  hashBits: number[]
}

export interface CardImageMatch {
  similarity: number
  distance: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getCellIndex(x: number, y: number, cols: number, rows: number, width: number, height: number) {
  const col = Math.min(cols - 1, Math.floor((x / Math.max(width, 1)) * cols))
  const row = Math.min(rows - 1, Math.floor((y / Math.max(height, 1)) * rows))
  return row * cols + col
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const scale = Math.max(targetWidth / imageWidth, targetHeight / imageHeight)
  const drawWidth = imageWidth * scale
  const drawHeight = imageHeight * scale
  const offsetX = (targetWidth - drawWidth) / 2
  const offsetY = (targetHeight - drawHeight) / 2

  context.clearRect(0, 0, targetWidth, targetHeight)
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)
}

async function loadImageElement(source: string | Blob) {
  const image = new Image()
  let temporaryUrl: string | null = null

  if (typeof source === "string") {
    image.crossOrigin = "anonymous"
    image.src = source
  } else {
    temporaryUrl = URL.createObjectURL(source)
    image.src = temporaryUrl
  }

  await image.decode()

  return {
    image,
    cleanup() {
      if (temporaryUrl) {
        URL.revokeObjectURL(temporaryUrl)
      }
    },
  }
}

export async function buildCardImageDescriptor(source: string | Blob): Promise<CardImageDescriptor> {
  const canvas = document.createElement("canvas")
  canvas.width = MATCH_CANVAS_WIDTH
  canvas.height = MATCH_CANVAS_HEIGHT
  const context = canvas.getContext("2d", { willReadFrequently: true })

  if (!context) {
    throw new Error("Could not create an image analysis canvas.")
  }

  const { image, cleanup } = await loadImageElement(source)

  try {
    drawImageCover(
      context,
      image,
      image.naturalWidth || MATCH_CANVAS_WIDTH,
      image.naturalHeight || MATCH_CANVAS_HEIGHT,
      MATCH_CANVAS_WIDTH,
      MATCH_CANVAS_HEIGHT,
    )
  } finally {
    cleanup()
  }

  const imageData = context.getImageData(0, 0, MATCH_CANVAS_WIDTH, MATCH_CANVAS_HEIGHT)
  const pixels = imageData.data
  const lumaValues = new Float32Array(MATCH_CANVAS_WIDTH * MATCH_CANVAS_HEIGHT)
  const lumaSums = new Float32Array(MATCH_GRID_COLS * MATCH_GRID_ROWS)
  const redSums = new Float32Array(MATCH_GRID_COLS * MATCH_GRID_ROWS)
  const greenSums = new Float32Array(MATCH_GRID_COLS * MATCH_GRID_ROWS)
  const blueSums = new Float32Array(MATCH_GRID_COLS * MATCH_GRID_ROWS)
  const saturationSums = new Float32Array(MATCH_GRID_COLS * MATCH_GRID_ROWS)
  const edgeSums = new Float32Array(MATCH_GRID_COLS * MATCH_GRID_ROWS)
  const cellCounts = new Float32Array(MATCH_GRID_COLS * MATCH_GRID_ROWS)
  let globalLumaSum = 0

  for (let y = 0; y < MATCH_CANVAS_HEIGHT; y += 1) {
    for (let x = 0; x < MATCH_CANVAS_WIDTH; x += 1) {
      const pixelIndex = (y * MATCH_CANVAS_WIDTH + x) * 4
      const r = pixels[pixelIndex] / 255
      const g = pixels[pixelIndex + 1] / 255
      const b = pixels[pixelIndex + 2] / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const saturation = max - min
      const cellIndex = getCellIndex(x, y, MATCH_GRID_COLS, MATCH_GRID_ROWS, MATCH_CANVAS_WIDTH, MATCH_CANVAS_HEIGHT)

      lumaValues[y * MATCH_CANVAS_WIDTH + x] = luma
      lumaSums[cellIndex] += luma
      redSums[cellIndex] += r
      greenSums[cellIndex] += g
      blueSums[cellIndex] += b
      saturationSums[cellIndex] += saturation
      cellCounts[cellIndex] += 1
      globalLumaSum += luma
    }
  }

  const globalLumaMean = globalLumaSum / lumaValues.length
  let globalVariance = 0

  for (let index = 0; index < lumaValues.length; index += 1) {
    const delta = lumaValues[index] - globalLumaMean
    globalVariance += delta * delta
  }

  const globalLumaStd = Math.sqrt(globalVariance / lumaValues.length) || 1

  for (let y = 0; y < MATCH_CANVAS_HEIGHT; y += 1) {
    for (let x = 0; x < MATCH_CANVAS_WIDTH; x += 1) {
      const index = y * MATCH_CANVAS_WIDTH + x
      const current = lumaValues[index]
      const right = x + 1 < MATCH_CANVAS_WIDTH ? lumaValues[index + 1] : current
      const down = y + 1 < MATCH_CANVAS_HEIGHT ? lumaValues[index + MATCH_CANVAS_WIDTH] : current
      const edgeMagnitude = Math.abs(current - right) + Math.abs(current - down)
      const cellIndex = getCellIndex(x, y, MATCH_GRID_COLS, MATCH_GRID_ROWS, MATCH_CANVAS_WIDTH, MATCH_CANVAS_HEIGHT)
      edgeSums[cellIndex] += edgeMagnitude
    }
  }

  const gridFeatures: number[] = []

  for (let index = 0; index < cellCounts.length; index += 1) {
    const count = cellCounts[index] || 1
    const meanR = redSums[index] / count
    const meanG = greenSums[index] / count
    const meanB = blueSums[index] / count
    const meanLuma = lumaSums[index] / count
    const meanSaturation = saturationSums[index] / count
    const meanEdge = edgeSums[index] / count
    const rgbSum = meanR + meanG + meanB + EPSILON
    const normalizedLuma = clamp((meanLuma - globalLumaMean) / (globalLumaStd * 3) * 0.5 + 0.5, 0, 1)

    gridFeatures.push(
      normalizedLuma,
      meanR / rgbSum,
      meanG / rgbSum,
      meanB / rgbSum,
      meanSaturation,
      clamp(meanEdge * 2.5, 0, 1),
    )
  }

  const hashCanvas = document.createElement("canvas")
  hashCanvas.width = HASH_COLS
  hashCanvas.height = HASH_ROWS
  const hashContext = hashCanvas.getContext("2d", { willReadFrequently: true })

  if (!hashContext) {
    throw new Error("Could not create a perceptual hash canvas.")
  }

  drawImageCover(
    hashContext,
    canvas,
    MATCH_CANVAS_WIDTH,
    MATCH_CANVAS_HEIGHT,
    HASH_COLS,
    HASH_ROWS,
  )

  const hashPixels = hashContext.getImageData(0, 0, HASH_COLS, HASH_ROWS).data
  const hashBits: number[] = []

  for (let y = 0; y < HASH_ROWS; y += 1) {
    for (let x = 0; x < HASH_COLS - 1; x += 1) {
      const leftIndex = (y * HASH_COLS + x) * 4
      const rightIndex = (y * HASH_COLS + x + 1) * 4
      const leftLuma =
        0.2126 * hashPixels[leftIndex] + 0.7152 * hashPixels[leftIndex + 1] + 0.0722 * hashPixels[leftIndex + 2]
      const rightLuma =
        0.2126 * hashPixels[rightIndex] + 0.7152 * hashPixels[rightIndex + 1] + 0.0722 * hashPixels[rightIndex + 2]
      hashBits.push(leftLuma > rightLuma ? 1 : 0)
    }
  }

  return { gridFeatures, hashBits }
}

export function compareCardImageDescriptors(
  query: CardImageDescriptor,
  candidate: CardImageDescriptor,
): CardImageMatch {
  const featureCount = Math.min(query.gridFeatures.length, candidate.gridFeatures.length)
  let featureDistance = 0

  for (let index = 0; index < featureCount; index += 6) {
    featureDistance += Math.abs(query.gridFeatures[index] - candidate.gridFeatures[index]) * 0.18
    featureDistance += Math.abs(query.gridFeatures[index + 1] - candidate.gridFeatures[index + 1]) * 0.16
    featureDistance += Math.abs(query.gridFeatures[index + 2] - candidate.gridFeatures[index + 2]) * 0.16
    featureDistance += Math.abs(query.gridFeatures[index + 3] - candidate.gridFeatures[index + 3]) * 0.16
    featureDistance += Math.abs(query.gridFeatures[index + 4] - candidate.gridFeatures[index + 4]) * 0.14
    featureDistance += Math.abs(query.gridFeatures[index + 5] - candidate.gridFeatures[index + 5]) * 0.2
  }

  featureDistance /= featureCount / 6 || 1

  const hashCount = Math.min(query.hashBits.length, candidate.hashBits.length)
  let hashDistance = 0

  for (let index = 0; index < hashCount; index += 1) {
    if (query.hashBits[index] !== candidate.hashBits[index]) {
      hashDistance += 1
    }
  }

  hashDistance = hashCount > 0 ? hashDistance / hashCount : 1

  const distance = featureDistance * 0.78 + hashDistance * 0.22
  return {
    distance,
    similarity: clamp(1 - distance, 0, 1),
  }
}
