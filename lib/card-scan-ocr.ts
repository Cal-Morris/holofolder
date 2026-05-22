import { extractCardTextSignals, type CardTextSignals } from "@/lib/card-scan-text"

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

let textDetectorPromise: Promise<NativeTextDetector | null> | null = null
let tesseractWorkerPromise: Promise<TesseractWorker> | null = null
let tesseractRecognitionQueue: Promise<unknown> = Promise.resolve()

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

async function prepareImageForOcr(source: OcrImageSource) {
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
    const scale = Math.min(
      OCR_MAX_WIDTH / Math.max(sourceWidth, 1),
      Math.max(1, OCR_MIN_WIDTH / Math.max(sourceWidth, 1)),
    )
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const { canvas, context } = createCanvas(width, height, true)

    context.fillStyle = "#fff"
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    enhanceOcrPixels(context, width, height)

    return canvas
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

export async function recognizeCardTextSignalsFromImage(source: OcrImageSource): Promise<CardTextSignals | null> {
  if (typeof window === "undefined") return null

  const ocrCanvas = await prepareImageForOcr(source)
  const textDetector = await getNativeTextDetector()

  if (textDetector) {
    try {
      const detectedText = await textDetector.detect(ocrCanvas)
      const signals = extractCardTextSignals(detectedText.map((text) => text.rawValue ?? "").join("\n"))
      if (hasUsefulSignals(signals)) return signals
    } catch {
      // Fall through to Tesseract when native OCR rejects this image.
    }
  }

  const result = await recognizeWithQueuedTesseract(ocrCanvas)
  const signals = extractCardTextSignals(result.data.text ?? "")

  return hasUsefulSignals(signals) ? signals : null
}
