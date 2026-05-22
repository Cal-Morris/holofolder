import { extractCardTextSignals, mergeCardTextSignals, type CardTextSignals } from "@/lib/card-scan-text"

type OcrImageSource = string | Blob | HTMLCanvasElement

interface NativeDetectedText {
  rawValue?: string
}

interface NativeTextDetector {
  detect(image: CanvasImageSource | Blob | ImageData): Promise<NativeDetectedText[]>
}

type NativeTextDetectorConstructor = new () => NativeTextDetector
type TesseractModule = typeof import("tesseract.js")
type TesseractWorker = Awaited<ReturnType<TesseractModule["createWorker"]>>

const OCR_MIN_WIDTH = 520
const OCR_MAX_WIDTH = 820
const OCR_CONTRAST = 1.28
const OCR_BRIGHTNESS_OFFSET = 4
const OCR_BOTTOM_REGION_TOP = 0.68

let textDetectorPromise: Promise<NativeTextDetector | null> | null = null
let tesseractWorkerPromise: Promise<TesseractWorker> | null = null
let tesseractRecognitionQueue: Promise<unknown> = Promise.resolve()

export interface CardOcrRegion {
  key: "full" | "bottom" | "number-left" | "number-right"
  x: number
  y: number
  width: number
  height: number
}

export interface RecognizeCardTextSignalsOptions {
  exhaustive?: boolean
}

interface PreparedOcrImage {
  region: CardOcrRegion
  canvas: HTMLCanvasElement
}

function hasUsefulSignals(signals: CardTextSignals) {
  return signals.collectorNumbers.length > 0 || signals.words.size > 0
}

function createCanvas(width: number, height: number, willReadFrequently = false) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently })

  if (!context) {
    throw new Error("Could not create an OCR canvas.")
  }

  return { canvas, context }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function region(
  key: CardOcrRegion["key"],
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
): CardOcrRegion {
  const safeX = clamp(Math.round(x), 0, Math.max(imageWidth - 1, 0))
  const safeY = clamp(Math.round(y), 0, Math.max(imageHeight - 1, 0))

  return {
    key,
    x: safeX,
    y: safeY,
    width: clamp(Math.round(width), 1, Math.max(imageWidth - safeX, 1)),
    height: clamp(Math.round(height), 1, Math.max(imageHeight - safeY, 1)),
  }
}

export function getCardOcrRegions(imageWidth: number, imageHeight: number): CardOcrRegion[] {
  const width = Math.max(1, Math.round(imageWidth))
  const height = Math.max(1, Math.round(imageHeight))
  const bottomY = Math.round(height * OCR_BOTTOM_REGION_TOP)
  const bottomHeight = height - bottomY

  return [
    region("full", width, height, 0, 0, width, height),
    region("bottom", width, height, width * 0.03, bottomY, width * 0.94, bottomHeight),
    region("number-left", width, height, width * 0.02, height * 0.72, width * 0.48, height * 0.25),
    region("number-right", width, height, width * 0.42, height * 0.72, width * 0.56, height * 0.25),
  ]
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

function enhanceOcrPixels(context: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = context.getImageData(0, 0, width, height)
  const { data } = imageData

  for (let index = 0; index < data.length; index += 4) {
    const luma = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]
    const contrasted = Math.max(0, Math.min(255, (luma - 128) * OCR_CONTRAST + 128 + OCR_BRIGHTNESS_OFFSET))
    data[index] = contrasted
    data[index + 1] = contrasted
    data[index + 2] = contrasted
  }

  context.putImageData(imageData, 0, 0)
}

async function prepareImagesForOcr(source: OcrImageSource): Promise<PreparedOcrImage[]> {
  let image: CanvasImageSource
  let sourceWidth: number
  let sourceHeight: number
  let cleanup = () => {}

  if (source instanceof HTMLCanvasElement) {
    image = source
    sourceWidth = source.width
    sourceHeight = source.height
  } else {
    const loaded = await loadImageElement(source)
    image = loaded.image
    sourceWidth = loaded.image.naturalWidth || loaded.image.width
    sourceHeight = loaded.image.naturalHeight || loaded.image.height
    cleanup = loaded.cleanup
  }

  try {
    return getCardOcrRegions(sourceWidth, sourceHeight).map((ocrRegion) => {
      const scale = Math.min(
        OCR_MAX_WIDTH / Math.max(ocrRegion.width, 1),
        Math.max(1, OCR_MIN_WIDTH / Math.max(ocrRegion.width, 1)),
      )
      const width = Math.max(1, Math.round(ocrRegion.width * scale))
      const height = Math.max(1, Math.round(ocrRegion.height * scale))
      const { canvas, context } = createCanvas(width, height, true)

      context.fillStyle = "#fff"
      context.fillRect(0, 0, width, height)
      context.drawImage(
        image,
        ocrRegion.x,
        ocrRegion.y,
        ocrRegion.width,
        ocrRegion.height,
        0,
        0,
        width,
        height,
      )
      enhanceOcrPixels(context, width, height)

      return {
        region: ocrRegion,
        canvas,
      }
    })
  } finally {
    cleanup()
  }
}

async function getNativeTextDetector() {
  if (textDetectorPromise) {
    return textDetectorPromise
  }

  textDetectorPromise = Promise.resolve().then(() => {
    if (typeof window === "undefined") return null

    const TextDetector = (globalThis as { TextDetector?: NativeTextDetectorConstructor }).TextDetector
    if (!TextDetector) return null

    try {
      return new TextDetector()
    } catch {
      return null
    }
  })

  return textDetectorPromise
}

async function getTesseractWorker() {
  if (tesseractWorkerPromise) {
    return tesseractWorkerPromise
  }

  tesseractWorkerPromise = import("tesseract.js")
    .then(async (Tesseract) => {
      Tesseract.setLogging(false)
      const worker = await Tesseract.createWorker("eng")
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
        user_defined_dpi: "300",
      })
      return worker
    })
    .catch((error) => {
      tesseractWorkerPromise = null
      throw error
    })

  return tesseractWorkerPromise
}

function recognizeWithQueuedTesseract(ocrCanvas: HTMLCanvasElement) {
  const recognitionPromise = tesseractRecognitionQueue.then(async () => {
    const worker = await getTesseractWorker()
    return worker.recognize(ocrCanvas, {}, { text: true })
  })

  tesseractRecognitionQueue = recognitionPromise.then(
    () => undefined,
    () => undefined,
  )

  return recognitionPromise
}

export async function recognizeCardTextSignalsFromImage(
  source: OcrImageSource,
  options: RecognizeCardTextSignalsOptions = {},
): Promise<CardTextSignals | null> {
  if (typeof window === "undefined") return null

  const ocrImages = await prepareImagesForOcr(source)
  const textDetector = await getNativeTextDetector()
  const nativeSignals: Array<CardTextSignals | null> = []

  if (textDetector) {
    for (const ocrImage of ocrImages) {
      try {
        const detectedText = await textDetector.detect(ocrImage.canvas)
        const signals = extractCardTextSignals(detectedText.map((text) => text.rawValue ?? "").join("\n"))
        if (hasUsefulSignals(signals)) {
          nativeSignals.push(signals)
        }
      } catch {
        // Fall through to Tesseract when native OCR rejects this image.
      }
    }

    const mergedNativeSignals = mergeCardTextSignals(nativeSignals)
    if (!options.exhaustive && mergedNativeSignals?.collectorNumbers.length) return mergedNativeSignals
  }

  const tesseractSignals: Array<CardTextSignals | null> = []
  const tesseractImages = [...ocrImages].sort((left, right) => {
    const order: Record<CardOcrRegion["key"], number> = {
      "number-left": 0,
      "number-right": 1,
      bottom: 2,
      full: 3,
    }

    return order[left.region.key] - order[right.region.key]
  })

  for (const ocrImage of tesseractImages) {
    const result = await recognizeWithQueuedTesseract(ocrImage.canvas)
    const signals = extractCardTextSignals(result.data.text ?? "")
    if (hasUsefulSignals(signals)) {
      tesseractSignals.push(signals)
    }

    const mergedSignals = mergeCardTextSignals([...nativeSignals, ...tesseractSignals])
    if (!options.exhaustive && mergedSignals?.collectorNumbers.length) {
      return mergedSignals
    }
  }

  const signals = mergeCardTextSignals([...nativeSignals, ...tesseractSignals])

  return signals && hasUsefulSignals(signals) ? signals : null
}
