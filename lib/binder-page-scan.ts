import type { Scanner as ScanicScanner } from "scanic"

export interface BinderPageScanSlotMetrics {
  meanLuminance: number
  luminanceStdDev: number
  chromaMean: number
  chromaStdDev: number
  darkPixelRatio: number
  neutralPixelRatio: number
  whitePixelRatio: number
  blackNeutralPixelRatio: number
  edgeRatio: number
  strongEdgeRatio: number
  chromaEdgeRatio: number
  saturationMean: number
  vividColorRatio: number
  highlightRatio: number
  centerLuminanceStdDev: number
  centerStrongEdgeRatio: number
  centerVividColorRatio: number
  centerHighlightRatio: number
  activeQuadrantRatio: number
}

export interface BinderPageScanSlotResult {
  index: number
  row: number
  col: number
  x: number
  y: number
  width: number
  height: number
  occupied: boolean
  score: number
  confidence: number
  metrics: BinderPageScanSlotMetrics
  cardImageDataUrl?: string
}

export interface BinderPageScanResult {
  width: number
  height: number
  grid: BinderPageGridRegion
  slots: BinderPageScanSlotResult[]
  previewDataUrl: string
}

export interface BinderPageGridRegion {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export interface BinderPageScanOptions {
  useGuidedGrid?: boolean
}

interface BinderPageRect {
  cx: number
  cy: number
  width: number
  height: number
  angle: number
}

interface GridDetectionMaps {
  verticalIntegral: Float32Array
  horizontalIntegral: Float32Array
  edgeIntegral: Float32Array
}

interface SlotFeatureMaps {
  sampleWidth: number
  sampleHeight: number
  luminanceIntegral: Float32Array
  luminanceSquaredIntegral: Float32Array
  chromaIntegral: Float32Array
  chromaSquaredIntegral: Float32Array
  saturationIntegral: Float32Array
  darkIntegral: Float32Array
  neutralIntegral: Float32Array
  whiteIntegral: Float32Array
  blackNeutralIntegral: Float32Array
  vividIntegral: Float32Array
  highlightIntegral: Float32Array
  edgeCountIntegral: Float32Array
  strongEdgeCountIntegral: Float32Array
  chromaEdgeCountIntegral: Float32Array
}

interface BinderPageScanRegionMetrics {
  meanLuminance: number
  luminanceStdDev: number
  chromaMean: number
  chromaStdDev: number
  darkPixelRatio: number
  neutralPixelRatio: number
  whitePixelRatio: number
  blackNeutralPixelRatio: number
  edgeRatio: number
  strongEdgeRatio: number
  chromaEdgeRatio: number
  saturationMean: number
  vividColorRatio: number
  highlightRatio: number
}

interface CanvasImage {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

const MAX_IMAGE_DIMENSION = 1200
const MAX_GRID_DIMENSION = 720
const SCANIC_MAX_PROCESSING_DIMENSION = 960
const SCANIC_MIN_DOCUMENT_AREA_RATIO = 0.18
const SCANIC_MIN_PAGE_AREA_RATIO = 0.2
const GUIDED_GRID_FILL_RATIO = 0.88
const SLOT_ASPECT_RATIO = 2.5 / 3.5
const TOTAL_GAP_SHARE_X = 0.05
const TOTAL_GAP_SHARE_Y = 0.05
const SLOT_SAMPLE_INSET = 0.18
const SAMPLE_STEP = 2
const DARK_PIXEL_LUMINANCE_THRESHOLD = 188
const BLACK_NEUTRAL_LUMINANCE_THRESHOLD = 72
const EDGE_DELTA_THRESHOLD = 42
const STRONG_EDGE_DELTA_THRESHOLD = 72
const CHROMA_EDGE_DELTA_THRESHOLD = 34
const NEUTRAL_PIXEL_SATURATION_THRESHOLD = 24
const VIVID_PIXEL_SATURATION_THRESHOLD = 92
const HIGHLIGHT_LUMINANCE_THRESHOLD = 228
const HIGHLIGHT_SATURATION_THRESHOLD = 24
const WHITE_PIXEL_LUMINANCE_THRESHOLD = 236
const MIN_GRID_COVERAGE = 0.52
const MAX_GRID_COVERAGE = 0.98
const MIN_GRID_CONFIDENCE = 4.2
const PAGE_EDGE_SAMPLE_STEP = 3
const PAGE_EDGE_THRESHOLD_FLOOR = 52
const PAGE_EDGE_SEARCH_PADDING = 0.32
const SLOT_CARD_CROP_INSET = 0.04
const SLOT_CARD_CROP_WIDTH = 240
const SLOT_CARD_CROP_HEIGHT = 336

let scanicScannerPromise: Promise<ScanicScanner> | null = null

export async function scanBinderPageImage(
  file: File,
  rows: number,
  cols: number,
  options: BinderPageScanOptions = {},
): Promise<BinderPageScanResult> {
  const image = await loadImage(file)
  const analysisImage = drawScaledImage(image, MAX_IMAGE_DIMENSION)
  const analysisContext = analysisImage.canvas.getContext("2d", { willReadFrequently: true })

  if (!analysisContext) {
    throw new Error("Could not read the uploaded image.")
  }

  if (options.useGuidedGrid) {
    return scanGuidedBinderPage(analysisImage, rows, cols)
  }

  const analysisData = analysisContext.getImageData(0, 0, analysisImage.width, analysisImage.height)
  const candidates = await buildNormalizedPageCandidates(analysisImage, analysisData, rows, cols)

  for (const candidate of candidates) {
    const result = scanNormalizedBinderPage(candidate, rows, cols)

    if (result) {
      return result
    }
  }

  throw new Error("Could not find a binder-sized grid in that photo. Try centering one page, filling more of the frame, and avoiding a two-page spread.")
}

function scanGuidedBinderPage(image: CanvasImage, rows: number, cols: number): BinderPageScanResult {
  const rectifiedContext = image.canvas.getContext("2d", { willReadFrequently: true })

  if (!rectifiedContext) {
    throw new Error("Could not read the guided scan image.")
  }

  const guidedImageData = rectifiedContext.getImageData(0, 0, image.width, image.height)
  const grid =
    detectGuidedGridRegion(guidedImageData, image.width, image.height, rows, cols) ??
    estimateGuidedGridRegion(image.width, image.height, rows, cols)

  return classifySlotsForGrid(image, rows, cols, grid)
}

async function buildNormalizedPageCandidates(
  analysisImage: CanvasImage,
  analysisData: ImageData,
  rows: number,
  cols: number,
) {
  const candidates: CanvasImage[] = []
  const seen = new Set<HTMLCanvasElement>()

  const addCandidate = (candidate: CanvasImage | null) => {
    if (!candidate || seen.has(candidate.canvas)) {
      return
    }

    seen.add(candidate.canvas)
    candidates.push(candidate)
  }

  addCandidate(await rectifyPageWithScanic(analysisImage.canvas))

  const roughGrid = detectRoughGridRegion(analysisImage.canvas, rows, cols)

  if (roughGrid) {
    const pageRect = detectBinderPageRect(analysisData, analysisImage.width, analysisImage.height, roughGrid)
    addCandidate(pageRect ? rectifyPageCanvas(analysisImage.canvas, pageRect) : null)
  }

  addCandidate(analysisImage)

  return candidates
}

function scanNormalizedBinderPage(image: CanvasImage, rows: number, cols: number): BinderPageScanResult | null {
  const rectifiedContext = image.canvas.getContext("2d", { willReadFrequently: true })

  if (!rectifiedContext) {
    return null
  }

  const rectifiedData = rectifiedContext.getImageData(0, 0, image.width, image.height)
  const slotFeatureMaps = buildSlotFeatureMaps(rectifiedData, image.width, image.height)
  const gridImage = scaleCanvasImage(image.canvas, MAX_GRID_DIMENSION)
  const gridContext = gridImage.canvas.getContext("2d", { willReadFrequently: true })

  if (!gridContext) {
    return null
  }

  const gridImageData = gridContext.getImageData(0, 0, gridImage.width, gridImage.height)
  const detectedGrid = detectBinderGridRegion(gridImageData, gridImage.width, gridImage.height, rows, cols)

  if (!detectedGrid) {
    return null
  }

  const grid = scaleGridRegion(
    detectedGrid,
    image.width / gridImage.width,
    image.height / gridImage.height,
  )

  return classifySlotsForGrid(image, rows, cols, grid)
}

function classifySlotsForGrid(
  image: CanvasImage,
  rows: number,
  cols: number,
  grid: BinderPageGridRegion,
): BinderPageScanResult {
  const rectifiedContext = image.canvas.getContext("2d", { willReadFrequently: true })

  if (!rectifiedContext) {
    throw new Error("Could not read the guided scan image.")
  }

  const rectifiedData = rectifiedContext.getImageData(0, 0, image.width, image.height)
  const slotFeatureMaps = buildSlotFeatureMaps(rectifiedData, image.width, image.height)
  const maps = buildGridDetectionMaps(rectifiedData, image.width, image.height)
  const verticalBounds = detectSlotBoundsFromGrid(maps, image.width, grid, cols, "vertical")
  const horizontalBounds = detectSlotBoundsFromGrid(maps, image.width, grid, rows, "horizontal")
  const refinedGrid = {
    x: verticalBounds[0]?.start ?? grid.x,
    y: horizontalBounds[0]?.start ?? grid.y,
    width:
      (verticalBounds[verticalBounds.length - 1]?.end ?? (grid.x + grid.width)) -
      (verticalBounds[0]?.start ?? grid.x),
    height:
      (horizontalBounds[horizontalBounds.length - 1]?.end ?? (grid.y + grid.height)) -
      (horizontalBounds[0]?.start ?? grid.y),
    confidence: grid.confidence,
  }

  const slots: BinderPageScanSlotResult[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const vertical = verticalBounds[col]
      const horizontal = horizontalBounds[row]
      const slotX = vertical?.start ?? grid.x
      const slotY = horizontal?.start ?? grid.y
      const slotWidth = vertical?.width ?? Math.round(grid.width / cols)
      const slotHeight = horizontal?.width ?? Math.round(grid.height / rows)

      const sampleX = Math.max(0, Math.round(slotX + slotWidth * SLOT_SAMPLE_INSET))
      const sampleY = Math.max(0, Math.round(slotY + slotHeight * SLOT_SAMPLE_INSET))
      const sampleWidth = Math.max(4, Math.round(slotWidth * (1 - SLOT_SAMPLE_INSET * 2)))
      const sampleHeight = Math.max(4, Math.round(slotHeight * (1 - SLOT_SAMPLE_INSET * 2)))

      const metrics = readSlotMetrics(slotFeatureMaps, sampleX, sampleY, sampleWidth, sampleHeight)
      const score = scoreSlot(metrics)
      const glareLikeRejected = shouldRejectAsGlareLike(metrics, score)
      const occupied = !glareLikeRejected && isOccupied(metrics, score)
      const confidence = scoreSlotConfidence(metrics, score)
      const cardImageDataUrl = occupied
        ? cropSlotCardImageDataUrl(image.canvas, slotX, slotY, slotWidth, slotHeight)
        : undefined

      slots.push({
        index: row * cols + col,
        row,
        col,
        x: slotX,
        y: slotY,
        width: slotWidth,
        height: slotHeight,
        occupied,
        score,
        confidence,
        metrics,
        cardImageDataUrl,
      })
    }
  }

  refineOccupiedSlots(slots)
  slots.forEach((slot) => {
    if (!slot.occupied) {
      slot.cardImageDataUrl = undefined
    }
  })

  return {
    width: image.width,
    height: image.height,
    grid: refinedGrid,
    slots,
    previewDataUrl: image.canvas.toDataURL("image/jpeg", 0.82),
  }
}

function cropSlotCardImageDataUrl(
  sourceCanvas: HTMLCanvasElement,
  slotX: number,
  slotY: number,
  slotWidth: number,
  slotHeight: number,
) {
  const sourceInsetX = slotWidth * SLOT_CARD_CROP_INSET
  const sourceInsetY = slotHeight * SLOT_CARD_CROP_INSET
  const sourceX = clamp(slotX + sourceInsetX, 0, sourceCanvas.width - 1)
  const sourceY = clamp(slotY + sourceInsetY, 0, sourceCanvas.height - 1)
  const sourceWidth = clamp(slotWidth - sourceInsetX * 2, 1, sourceCanvas.width - sourceX)
  const sourceHeight = clamp(slotHeight - sourceInsetY * 2, 1, sourceCanvas.height - sourceY)
  const canvas = document.createElement("canvas")
  canvas.width = SLOT_CARD_CROP_WIDTH
  canvas.height = SLOT_CARD_CROP_HEIGHT
  const context = canvas.getContext("2d")

  if (!context) {
    return undefined
  }

  context.drawImage(
    sourceCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    SLOT_CARD_CROP_WIDTH,
    SLOT_CARD_CROP_HEIGHT,
  )

  return canvas.toDataURL("image/jpeg", 0.86)
}

function estimateGuidedGridRegion(width: number, height: number, rows: number, cols: number): BinderPageGridRegion {
  const targetAspect = getBinderGridAspectRatio(rows, cols)
  const maxWidth = width * GUIDED_GRID_FILL_RATIO
  const maxHeight = height * GUIDED_GRID_FILL_RATIO
  let gridWidth = Math.min(maxWidth, maxHeight * targetAspect)
  let gridHeight = gridWidth / targetAspect

  if (gridHeight > maxHeight) {
    gridHeight = maxHeight
    gridWidth = gridHeight * targetAspect
  }

  return {
    x: Math.round((width - gridWidth) / 2),
    y: Math.round((height - gridHeight) / 2),
    width: Math.round(gridWidth),
    height: Math.round(gridHeight),
    confidence: 1,
  }
}

function detectGuidedGridRegion(
  imageData: ImageData,
  width: number,
  height: number,
  rows: number,
  cols: number,
) {
  const maps = buildGridDetectionMaps(imageData, width, height)
  const estimate = estimateGuidedGridRegion(width, height, rows, cols)
  const guidedWidthStep = Math.max(6, Math.round(Math.min(width, height) * 0.018))
  const guidedPositionStep = Math.max(4, Math.round(Math.min(width, height) * 0.015))
  const guided = searchBinderGridCandidates(
    maps,
    width,
    height,
    rows,
    cols,
    guidedWidthStep,
    guidedPositionStep,
    estimate,
  )

  if (!guided || guided.confidence < MIN_GRID_CONFIDENCE * 0.72) {
    return null
  }

  return guided
}

function detectSlotBoundsFromGrid(
  maps: GridDetectionMaps,
  imageWidth: number,
  grid: BinderPageGridRegion,
  count: number,
  orientation: "vertical" | "horizontal",
) {
  const lineOffsets = getBinderSlotBoundaryOffsets(
    orientation === "vertical" ? grid.width : grid.height,
    count,
    orientation === "vertical" ? TOTAL_GAP_SHARE_X : TOTAL_GAP_SHARE_Y,
  )
  const expectedLines = lineOffsets.map((offset) =>
    Math.round((orientation === "vertical" ? grid.x : grid.y) + offset),
  )
  const maxCoordinate =
    orientation === "vertical"
      ? imageWidth
      : Math.round(maps.edgeIntegral.length / (imageWidth + 1) - 1)
  const searchRadius = Math.max(
    6,
    Math.round((orientation === "vertical" ? grid.width : grid.height) / (count * 8)),
  )
  const bandWidth = Math.max(2, Math.round(Math.min(grid.width, grid.height) * 0.008))
  const scores = expectedLines.map((line, index) =>
    scoreGridLineAt(maps, imageWidth, grid, line, bandWidth, orientation, index === 0 || index === expectedLines.length - 1),
  )
  const scoreBaseline = average(scores)
  const refinedLines: number[] = []

  for (let index = 0; index < expectedLines.length; index += 1) {
    const expected = expectedLines[index]
    const lowerBound = Math.max(
      0,
      Math.min(maxCoordinate - 1, Math.max(refinedLines[index - 1] ?? -Infinity, expected - searchRadius)),
    )
    const upperBound = Math.max(lowerBound, Math.min(maxCoordinate - 1, expected + searchRadius))
    let bestLine = clamp(expected, lowerBound, upperBound)
    let bestScore = -Infinity

    for (let candidate = lowerBound; candidate <= upperBound; candidate += 1) {
      const score = scoreGridLineAt(
        maps,
        imageWidth,
        grid,
        candidate,
        bandWidth,
        orientation,
        index === 0 || index === expectedLines.length - 1,
      )

      if (score > bestScore) {
        bestScore = score
        bestLine = candidate
      }
    }

    refinedLines.push(bestScore < scoreBaseline * 0.82 ? expected : bestLine)
  }

  return Array.from({ length: count }, (_, slotIndex) => {
    const start = refinedLines[slotIndex * 2]
    const end = refinedLines[slotIndex * 2 + 1]

    return {
      start,
      end,
      width: Math.max(8, end - start),
    }
  })
}

function scoreGridLineAt(
  maps: GridDetectionMaps,
  imageWidth: number,
  grid: BinderPageGridRegion,
  coordinate: number,
  bandWidth: number,
  orientation: "vertical" | "horizontal",
  outerEdge: boolean,
) {
  if (orientation === "vertical") {
    const lineStrength = rectMean(
      maps.verticalIntegral,
      imageWidth,
      coordinate - bandWidth,
      grid.y,
      bandWidth * 2 + 1,
      grid.height,
    )
    const edgeStrength = rectMean(
      maps.edgeIntegral,
      imageWidth,
      coordinate - bandWidth,
      grid.y,
      bandWidth * 2 + 1,
      grid.height,
    )

    return lineStrength * (outerEdge ? 1.1 : 1) + edgeStrength * 0.32
  }

  const lineStrength = rectMean(
    maps.horizontalIntegral,
    imageWidth,
    grid.x,
    coordinate - bandWidth,
    grid.width,
    bandWidth * 2 + 1,
  )
  const edgeStrength = rectMean(
    maps.edgeIntegral,
    imageWidth,
    grid.x,
    coordinate - bandWidth,
    grid.width,
    bandWidth * 2 + 1,
  )

  return lineStrength * (outerEdge ? 1.1 : 1) + edgeStrength * 0.32
}

function detectRoughGridRegion(sourceCanvas: HTMLCanvasElement, rows: number, cols: number) {
  const roughGridImage = scaleCanvasImage(sourceCanvas, MAX_GRID_DIMENSION)
  const roughGridContext = roughGridImage.canvas.getContext("2d", { willReadFrequently: true })

  if (!roughGridContext) {
    return null
  }

  const roughGridData = roughGridContext.getImageData(0, 0, roughGridImage.width, roughGridImage.height)
  const roughGridDetected = detectBinderGridRegion(roughGridData, roughGridImage.width, roughGridImage.height, rows, cols)

  if (!roughGridDetected) {
    return null
  }

  return scaleGridRegion(
    roughGridDetected,
    sourceCanvas.width / roughGridImage.width,
    sourceCanvas.height / roughGridImage.height,
  )
}

async function rectifyPageWithScanic(sourceCanvas: HTMLCanvasElement): Promise<CanvasImage | null> {
  try {
    const scanner = await getScanicScanner()
    const minArea = Math.round(sourceCanvas.width * sourceCanvas.height * SCANIC_MIN_DOCUMENT_AREA_RATIO)
    const result = await scanner.scan(sourceCanvas, {
      mode: "extract",
      output: "canvas",
      maxProcessingDimension: SCANIC_MAX_PROCESSING_DIMENSION,
      lowThreshold: 50,
      highThreshold: 160,
      dilationKernelSize: 4,
      minArea,
    })

    if (!result.success || !(result.output instanceof HTMLCanvasElement)) {
      return null
    }

    if (!looksLikeUsablePage(result.output, sourceCanvas)) {
      return null
    }

    return {
      canvas: result.output,
      width: result.output.width,
      height: result.output.height,
    }
  } catch {
    return null
  }
}

async function getScanicScanner(): Promise<ScanicScanner> {
  if (!scanicScannerPromise) {
    scanicScannerPromise = import("scanic").then(async ({ Scanner }) => {
      const scanner = new Scanner({
        maxProcessingDimension: SCANIC_MAX_PROCESSING_DIMENSION,
        mode: "extract",
        output: "canvas",
      })

      await scanner.initialize()
      return scanner
    })
  }

  return scanicScannerPromise
}

function looksLikeUsablePage(candidateCanvas: HTMLCanvasElement, sourceCanvas: HTMLCanvasElement) {
  if (candidateCanvas.width < 180 || candidateCanvas.height < 180) {
    return false
  }

  const candidateArea = candidateCanvas.width * candidateCanvas.height
  const sourceArea = sourceCanvas.width * sourceCanvas.height

  return candidateArea / sourceArea >= SCANIC_MIN_PAGE_AREA_RATIO
}

function drawScaledImage(image: HTMLImageElement, maxDimension: number) {
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Could not prepare the image for scanning.")
  }

  context.drawImage(image, 0, 0, width, height)

  return { canvas, width, height }
}

function scaleGridRegion(grid: BinderPageGridRegion, scaleX: number, scaleY: number): BinderPageGridRegion {
  return {
    x: Math.round(grid.x * scaleX),
    y: Math.round(grid.y * scaleY),
    width: Math.round(grid.width * scaleX),
    height: Math.round(grid.height * scaleY),
    confidence: grid.confidence,
  }
}

function scaleCanvasImage(sourceCanvas: HTMLCanvasElement, maxDimension: number) {
  const width = sourceCanvas.width
  const height = sourceCanvas.height
  const scale = Math.min(1, maxDimension / Math.max(width, height))

  if (scale === 1) {
    return { canvas: sourceCanvas, width, height }
  }

  const scaledWidth = Math.max(1, Math.round(width * scale))
  const scaledHeight = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = scaledWidth
  canvas.height = scaledHeight
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Could not scale the scan image.")
  }

  context.drawImage(sourceCanvas, 0, 0, scaledWidth, scaledHeight)

  return { canvas, width: scaledWidth, height: scaledHeight }
}

function detectBinderPageRect(
  imageData: ImageData,
  width: number,
  height: number,
  roughGrid: BinderPageGridRegion
): BinderPageRect | null {
  const paddingX = Math.round(roughGrid.width * PAGE_EDGE_SEARCH_PADDING)
  const paddingY = Math.round(roughGrid.height * PAGE_EDGE_SEARCH_PADDING)
  const startX = clamp(Math.round(roughGrid.x - paddingX), 1, width - 2)
  const startY = clamp(Math.round(roughGrid.y - paddingY), 1, height - 2)
  const endX = clamp(Math.round(roughGrid.x + roughGrid.width + paddingX), 1, width - 1)
  const endY = clamp(Math.round(roughGrid.y + roughGrid.height + paddingY), 1, height - 1)
  const magnitudes: number[] = []

  for (let y = startY; y < endY; y += PAGE_EDGE_SAMPLE_STEP) {
    for (let x = startX; x < endX; x += PAGE_EDGE_SAMPLE_STEP) {
      magnitudes.push(readEdgeMagnitude(imageData, width, x, y))
    }
  }

  if (magnitudes.length < 40) {
    return null
  }

  const threshold = Math.max(PAGE_EDGE_THRESHOLD_FLOOR, percentile(magnitudes, 0.8))
  let weightSum = 0
  let centerX = 0
  let centerY = 0
  const points: { x: number; y: number; weight: number }[] = []

  for (let y = startY; y < endY; y += PAGE_EDGE_SAMPLE_STEP) {
    for (let x = startX; x < endX; x += PAGE_EDGE_SAMPLE_STEP) {
      const magnitude = readEdgeMagnitude(imageData, width, x, y)
      if (magnitude < threshold) continue

      const weight = magnitude - threshold + 1
      points.push({ x, y, weight })
      weightSum += weight
      centerX += x * weight
      centerY += y * weight
    }
  }

  if (points.length < 80 || weightSum <= 0) {
    return null
  }

  centerX /= weightSum
  centerY /= weightSum

  let covXX = 0
  let covYY = 0
  let covXY = 0

  for (const point of points) {
    const dx = point.x - centerX
    const dy = point.y - centerY
    covXX += dx * dx * point.weight
    covYY += dy * dy * point.weight
    covXY += dx * dy * point.weight
  }

  const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY)
  const cosAngle = Math.cos(angle)
  const sinAngle = Math.sin(angle)
  const rotatedX: number[] = []
  const rotatedY: number[] = []

  for (const point of points) {
    const dx = point.x - centerX
    const dy = point.y - centerY
    rotatedX.push(dx * cosAngle + dy * sinAngle)
    rotatedY.push(-dx * sinAngle + dy * cosAngle)
  }

  const left = percentile(rotatedX, 0.04)
  const right = percentile(rotatedX, 0.96)
  const top = percentile(rotatedY, 0.04)
  const bottom = percentile(rotatedY, 0.96)
  const rectWidth = right - left
  const rectHeight = bottom - top

  if (rectWidth < roughGrid.width * 1.02 || rectHeight < roughGrid.height * 1.02) {
    return null
  }

  return {
    cx: centerX + ((left + right) / 2) * cosAngle - ((top + bottom) / 2) * sinAngle,
    cy: centerY + ((left + right) / 2) * sinAngle + ((top + bottom) / 2) * cosAngle,
    width: rectWidth,
    height: rectHeight,
    angle,
  }
}

function rectifyPageCanvas(sourceCanvas: HTMLCanvasElement, pageRect: BinderPageRect) {
  const width = Math.max(1, Math.round(pageRect.width))
  const height = Math.max(1, Math.round(pageRect.height))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Could not rectify the page image.")
  }

  context.translate(width / 2, height / 2)
  context.rotate(-pageRect.angle)
  context.drawImage(sourceCanvas, -pageRect.cx, -pageRect.cy)

  return { canvas, width, height }
}

function detectBinderGridRegion(
  imageData: ImageData,
  width: number,
  height: number,
  rows: number,
  cols: number
): BinderPageGridRegion | null {
  const maps = buildGridDetectionMaps(imageData, width, height)
  const coarseWidthStep = Math.max(16, Math.round(Math.min(width, height) * 0.05))
  const coarsePositionStep = Math.max(10, Math.round(Math.min(width, height) * 0.04))
  const coarse = searchBinderGridCandidates(maps, width, height, rows, cols, coarseWidthStep, coarsePositionStep)

  if (!coarse) {
    return null
  }

  const refinedWidthStep = Math.max(6, Math.round(coarseWidthStep / 2))
  const refinedPositionStep = Math.max(4, Math.round(coarsePositionStep / 2))
  const refined = searchBinderGridCandidates(
    maps,
    width,
    height,
    rows,
    cols,
    refinedWidthStep,
    refinedPositionStep,
    coarse,
  )

  if (!refined || refined.confidence < MIN_GRID_CONFIDENCE) {
    return null
  }

  return refined
}

function buildGridDetectionMaps(imageData: ImageData, width: number, height: number): GridDetectionMaps {
  const luminance = new Float32Array(width * height)
  const data = imageData.data

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const red = data[index]
      const green = data[index + 1]
      const blue = data[index + 2]
      luminance[y * width + x] = red * 0.2126 + green * 0.7152 + blue * 0.0722
    }
  }

  const verticalGradient = new Float32Array(width * height)
  const horizontalGradient = new Float32Array(width * height)
  const combinedEdge = new Float32Array(width * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const current = luminance[index]
      const right = x + 1 < width ? Math.abs(current - luminance[index + 1]) : 0
      const below = y + 1 < height ? Math.abs(current - luminance[index + width]) : 0

      verticalGradient[index] = right
      horizontalGradient[index] = below
      combinedEdge[index] = (right + below) / 2
    }
  }

  return {
    verticalIntegral: buildIntegralImage(verticalGradient, width, height),
    horizontalIntegral: buildIntegralImage(horizontalGradient, width, height),
    edgeIntegral: buildIntegralImage(combinedEdge, width, height),
  }
}

function buildSlotFeatureMaps(imageData: ImageData, width: number, height: number): SlotFeatureMaps {
  const sampleWidth = Math.ceil(width / SAMPLE_STEP)
  const sampleHeight = Math.ceil(height / SAMPLE_STEP)
  const sampleCount = sampleWidth * sampleHeight
  const luminance = new Float32Array(sampleCount)
  const luminanceSquared = new Float32Array(sampleCount)
  const chroma = new Float32Array(sampleCount)
  const chromaSquared = new Float32Array(sampleCount)
  const saturation = new Float32Array(sampleCount)
  const dark = new Float32Array(sampleCount)
  const neutral = new Float32Array(sampleCount)
  const white = new Float32Array(sampleCount)
  const blackNeutral = new Float32Array(sampleCount)
  const vivid = new Float32Array(sampleCount)
  const highlight = new Float32Array(sampleCount)
  const edgeCount = new Float32Array(sampleCount)
  const strongEdgeCount = new Float32Array(sampleCount)
  const chromaEdgeCount = new Float32Array(sampleCount)
  const data = imageData.data

  for (let sampleY = 0; sampleY < sampleHeight; sampleY += 1) {
    const pixelY = Math.min(height - 1, sampleY * SAMPLE_STEP)

    for (let sampleX = 0; sampleX < sampleWidth; sampleX += 1) {
      const pixelX = Math.min(width - 1, sampleX * SAMPLE_STEP)
      const pixelIndex = (pixelY * width + pixelX) * 4
      const sampleIndex = sampleY * sampleWidth + sampleX
      const red = data[pixelIndex]
      const green = data[pixelIndex + 1]
      const blueChannel = data[pixelIndex + 2]
      const luminanceValue = red * 0.2126 + green * 0.7152 + blueChannel * 0.0722
      const saturationValue = Math.max(red, green, blueChannel) - Math.min(red, green, blueChannel)
      const rgOpponent = red - green
      const ybOpponent = (red + green) * 0.5 - blueChannel
      const chromaValue = Math.sqrt(rgOpponent * rgOpponent + ybOpponent * ybOpponent)

      luminance[sampleIndex] = luminanceValue
      luminanceSquared[sampleIndex] = luminanceValue * luminanceValue
      chroma[sampleIndex] = chromaValue
      chromaSquared[sampleIndex] = chromaValue * chromaValue
      saturation[sampleIndex] = saturationValue
      dark[sampleIndex] = luminanceValue < DARK_PIXEL_LUMINANCE_THRESHOLD ? 1 : 0
      neutral[sampleIndex] = saturationValue < NEUTRAL_PIXEL_SATURATION_THRESHOLD ? 1 : 0
      white[sampleIndex] =
        luminanceValue > WHITE_PIXEL_LUMINANCE_THRESHOLD && saturationValue < NEUTRAL_PIXEL_SATURATION_THRESHOLD ? 1 : 0
      blackNeutral[sampleIndex] =
        luminanceValue < BLACK_NEUTRAL_LUMINANCE_THRESHOLD && saturationValue < NEUTRAL_PIXEL_SATURATION_THRESHOLD ? 1 : 0
      vivid[sampleIndex] = saturationValue > VIVID_PIXEL_SATURATION_THRESHOLD ? 1 : 0
      highlight[sampleIndex] =
        luminanceValue > HIGHLIGHT_LUMINANCE_THRESHOLD && saturationValue < HIGHLIGHT_SATURATION_THRESHOLD ? 1 : 0
    }
  }

  for (let sampleY = 0; sampleY < sampleHeight; sampleY += 1) {
    for (let sampleX = 0; sampleX < sampleWidth; sampleX += 1) {
      const sampleIndex = sampleY * sampleWidth + sampleX
      const current = luminance[sampleIndex]
      const currentChroma = chroma[sampleIndex]

      if (sampleX + 1 < sampleWidth) {
        const delta = Math.abs(current - luminance[sampleIndex + 1])
        if (delta > EDGE_DELTA_THRESHOLD) {
          edgeCount[sampleIndex] += 1
        }
        if (delta > STRONG_EDGE_DELTA_THRESHOLD) {
          strongEdgeCount[sampleIndex] += 1
        }

        const chromaDelta = Math.abs(currentChroma - chroma[sampleIndex + 1])
        if (chromaDelta > CHROMA_EDGE_DELTA_THRESHOLD) {
          chromaEdgeCount[sampleIndex] += 1
        }
      }

      if (sampleY + 1 < sampleHeight) {
        const delta = Math.abs(current - luminance[sampleIndex + sampleWidth])
        if (delta > EDGE_DELTA_THRESHOLD) {
          edgeCount[sampleIndex] += 1
        }
        if (delta > STRONG_EDGE_DELTA_THRESHOLD) {
          strongEdgeCount[sampleIndex] += 1
        }

        const chromaDelta = Math.abs(currentChroma - chroma[sampleIndex + sampleWidth])
        if (chromaDelta > CHROMA_EDGE_DELTA_THRESHOLD) {
          chromaEdgeCount[sampleIndex] += 1
        }
      }
    }
  }

  return {
    sampleWidth,
    sampleHeight,
    luminanceIntegral: buildIntegralImage(luminance, sampleWidth, sampleHeight),
    luminanceSquaredIntegral: buildIntegralImage(luminanceSquared, sampleWidth, sampleHeight),
    chromaIntegral: buildIntegralImage(chroma, sampleWidth, sampleHeight),
    chromaSquaredIntegral: buildIntegralImage(chromaSquared, sampleWidth, sampleHeight),
    saturationIntegral: buildIntegralImage(saturation, sampleWidth, sampleHeight),
    darkIntegral: buildIntegralImage(dark, sampleWidth, sampleHeight),
    neutralIntegral: buildIntegralImage(neutral, sampleWidth, sampleHeight),
    whiteIntegral: buildIntegralImage(white, sampleWidth, sampleHeight),
    blackNeutralIntegral: buildIntegralImage(blackNeutral, sampleWidth, sampleHeight),
    vividIntegral: buildIntegralImage(vivid, sampleWidth, sampleHeight),
    highlightIntegral: buildIntegralImage(highlight, sampleWidth, sampleHeight),
    edgeCountIntegral: buildIntegralImage(edgeCount, sampleWidth, sampleHeight),
    strongEdgeCountIntegral: buildIntegralImage(strongEdgeCount, sampleWidth, sampleHeight),
    chromaEdgeCountIntegral: buildIntegralImage(chromaEdgeCount, sampleWidth, sampleHeight),
  }
}

function buildIntegralImage(values: Float32Array, width: number, height: number) {
  const integralWidth = width + 1
  const integral = new Float32Array(integralWidth * (height + 1))

  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0

    for (let x = 1; x <= width; x += 1) {
      rowSum += values[(y - 1) * width + (x - 1)]
      integral[y * integralWidth + x] = integral[(y - 1) * integralWidth + x] + rowSum
    }
  }

  return integral
}

function searchBinderGridCandidates(
  maps: GridDetectionMaps,
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number,
  widthStep: number,
  positionStep: number,
  focus?: BinderPageGridRegion
): BinderPageGridRegion | null {
  const targetAspect = getBinderGridAspectRatio(rows, cols)
  const maxWidth = Math.round(Math.min(imageWidth * MAX_GRID_COVERAGE, imageHeight * MAX_GRID_COVERAGE * targetAspect))
  const minWidth = Math.round(maxWidth * MIN_GRID_COVERAGE)
  let best: BinderPageGridRegion | null = null

  const widthStart = focus
    ? clamp(Math.round(focus.width - widthStep * 2), minWidth, maxWidth)
    : minWidth
  const widthEnd = focus
    ? clamp(Math.round(focus.width + widthStep * 2), minWidth, maxWidth)
    : maxWidth

  for (let candidateWidth = widthEnd; candidateWidth >= widthStart; candidateWidth -= widthStep) {
    const candidateHeight = Math.round(candidateWidth / targetAspect)

    if (candidateHeight < imageHeight * MIN_GRID_COVERAGE || candidateHeight > imageHeight * MAX_GRID_COVERAGE) {
      continue
    }

    const xStart = focus
      ? clamp(Math.round(focus.x - positionStep * 2), 0, imageWidth - candidateWidth)
      : 0
    const xEnd = focus
      ? clamp(Math.round(focus.x + positionStep * 2), 0, imageWidth - candidateWidth)
      : imageWidth - candidateWidth
    const yStart = focus
      ? clamp(Math.round(focus.y - positionStep * 2), 0, imageHeight - candidateHeight)
      : 0
    const yEnd = focus
      ? clamp(Math.round(focus.y + positionStep * 2), 0, imageHeight - candidateHeight)
      : imageHeight - candidateHeight

    for (let x = xStart; x <= xEnd; x += positionStep) {
      for (let y = yStart; y <= yEnd; y += positionStep) {
        const confidence = scoreBinderGridCandidate(
          maps,
          imageWidth,
          imageHeight,
          rows,
          cols,
          x,
          y,
          candidateWidth,
          candidateHeight
        )

        if (!best || confidence > best.confidence) {
          best = {
            x,
            y,
            width: candidateWidth,
            height: candidateHeight,
            confidence,
          }
        }
      }
    }
  }

  return best
}

function scoreBinderGridCandidate(
  maps: GridDetectionMaps,
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number
) {
  const bandWidth = Math.max(2, Math.round(Math.min(rectWidth, rectHeight) * 0.007))
  const edgeMean = rectMean(maps.edgeIntegral, imageWidth, x, y, rectWidth, rectHeight)

  if (edgeMean < 8) {
    return -Infinity
  }

  const verticalLines = getBinderSlotBoundaryOffsets(rectWidth, cols, TOTAL_GAP_SHARE_X)
  const horizontalLines = getBinderSlotBoundaryOffsets(rectHeight, rows, TOTAL_GAP_SHARE_Y)
  const verticalLineScores = verticalLines.map((offset) =>
    rectMean(maps.verticalIntegral, imageWidth, x + Math.round(offset) - bandWidth, y, bandWidth * 2 + 1, rectHeight)
  )
  const horizontalLineScores = horizontalLines.map((offset) =>
    rectMean(maps.horizontalIntegral, imageWidth, x, y + Math.round(offset) - bandWidth, rectWidth, bandWidth * 2 + 1)
  )

  const verticalRatio = average(verticalLineScores) / (edgeMean + 1)
  const horizontalRatio = average(horizontalLineScores) / (edgeMean + 1)
  const verticalConsistency = 1 - clamp(standardDeviation(verticalLineScores) / (average(verticalLineScores) + 1), 0, 1)
  const horizontalConsistency = 1 - clamp(standardDeviation(horizontalLineScores) / (average(horizontalLineScores) + 1), 0, 1)
  const coverage = (rectWidth * rectHeight) / (imageWidth * imageHeight)
  const centeredness =
    1 -
    (Math.abs(x + rectWidth / 2 - imageWidth / 2) / imageWidth +
      Math.abs(y + rectHeight / 2 - imageHeight / 2) / imageHeight)

  return (
    verticalRatio * 1.15 +
    horizontalRatio * 1.15 +
    verticalConsistency * 0.75 +
    horizontalConsistency * 0.75 +
    coverage * 0.9 +
    centeredness * 0.35
  )
}

export function getBinderSlotBoundaryOffsets(length: number, count: number, totalGapShare: number) {
  if (count <= 1) {
    return [0, length]
  }

  const positions: number[] = []
  const gap = count > 1 ? (length * totalGapShare) / (count - 1) : 0
  const slot = (length - gap * (count - 1)) / count

  for (let index = 0; index < count; index += 1) {
    const slotStart = index * (slot + gap)
    const slotEnd = slotStart + slot

    positions.push(slotStart)
    positions.push(slotEnd)
  }

  return positions
}

export function getBinderGridAspectRatio(rows: number, cols: number) {
  return (cols * SLOT_ASPECT_RATIO) / Math.max(rows, 1)
}

function rectMean(
  integral: Float32Array,
  imageWidth: number,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const clampedX1 = clamp(Math.round(x), 0, imageWidth)
  const clampedY1 = clamp(Math.round(y), 0, integral.length / (imageWidth + 1) - 1)
  const clampedX2 = clamp(Math.round(x + width), 0, imageWidth)
  const clampedY2 = clamp(Math.round(y + height), 0, integral.length / (imageWidth + 1) - 1)

  if (clampedX2 <= clampedX1 || clampedY2 <= clampedY1) {
    return 0
  }

  const integralWidth = imageWidth + 1
  const sum =
    integral[clampedY2 * integralWidth + clampedX2] -
    integral[clampedY1 * integralWidth + clampedX2] -
    integral[clampedY2 * integralWidth + clampedX1] +
    integral[clampedY1 * integralWidth + clampedX1]

  return sum / ((clampedX2 - clampedX1) * (clampedY2 - clampedY1))
}

function rectSum(
  integral: Float32Array,
  imageWidth: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const clampedX1 = clamp(Math.round(x1), 0, imageWidth)
  const clampedY1 = clamp(Math.round(y1), 0, integral.length / (imageWidth + 1) - 1)
  const clampedX2 = clamp(Math.round(x2), 0, imageWidth)
  const clampedY2 = clamp(Math.round(y2), 0, integral.length / (imageWidth + 1) - 1)

  if (clampedX2 <= clampedX1 || clampedY2 <= clampedY1) {
    return 0
  }

  const integralWidth = imageWidth + 1
  return (
    integral[clampedY2 * integralWidth + clampedX2] -
    integral[clampedY1 * integralWidth + clampedX2] -
    integral[clampedY2 * integralWidth + clampedX1] +
    integral[clampedY1 * integralWidth + clampedX1]
  )
}

function readEdgeMagnitude(imageData: ImageData, width: number, x: number, y: number) {
  const current = readPixel(imageData, width, x, y).luminance
  const right = readPixel(imageData, width, Math.min(width - 1, x + 1), y).luminance
  const below = readPixel(imageData, width, x, Math.min(imageData.height - 1, y + 1)).luminance

  return Math.abs(current - right) + Math.abs(current - below)
}

function readPixel(imageData: ImageData, width: number, x: number, y: number) {
  const index = (y * width + x) * 4
  const data = imageData.data
  const red = data[index]
  const green = data[index + 1]
  const blue = data[index + 2]
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722

  return { red, green, blue, luminance }
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1)
  return sorted[index]
}

function standardDeviation(values: number[]) {
  if (values.length === 0) return 0

  const mean = average(values)
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length

  return Math.sqrt(variance)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function readSlotMetrics(
  maps: SlotFeatureMaps,
  startX: number,
  startY: number,
  sampleWidth: number,
  sampleHeight: number
): BinderPageScanSlotMetrics {
  const fullRegion = readRegionMetrics(maps, startX, startY, sampleWidth, sampleHeight)
  const centerWidth = Math.max(4, Math.round(sampleWidth * 0.42))
  const centerHeight = Math.max(4, Math.round(sampleHeight * 0.42))
  const centerX = startX + Math.max(0, Math.round((sampleWidth - centerWidth) / 2))
  const centerY = startY + Math.max(0, Math.round((sampleHeight - centerHeight) / 2))
  const centerRegion = readRegionMetrics(maps, centerX, centerY, centerWidth, centerHeight)
  const endX = startX + sampleWidth
  const endY = startY + sampleHeight
  const midX = startX + Math.max(1, Math.round(sampleWidth / 2))
  const midY = startY + Math.max(1, Math.round(sampleHeight / 2))
  const quadrants = [
    readRegionMetrics(maps, startX, startY, Math.max(4, midX - startX), Math.max(4, midY - startY)),
    readRegionMetrics(maps, midX, startY, Math.max(4, endX - midX), Math.max(4, midY - startY)),
    readRegionMetrics(maps, startX, midY, Math.max(4, midX - startX), Math.max(4, endY - midY)),
    readRegionMetrics(maps, midX, midY, Math.max(4, endX - midX), Math.max(4, endY - midY)),
  ]
  const activeQuadrants = quadrants.filter(isQuadrantActive).length

  return {
    ...fullRegion,
    centerLuminanceStdDev: centerRegion.luminanceStdDev,
    centerStrongEdgeRatio: centerRegion.strongEdgeRatio,
    centerVividColorRatio: centerRegion.vividColorRatio,
    centerHighlightRatio: centerRegion.highlightRatio,
    activeQuadrantRatio: activeQuadrants / quadrants.length,
  }
}

function readRegionMetrics(
  maps: SlotFeatureMaps,
  startX: number,
  startY: number,
  width: number,
  height: number
): BinderPageScanRegionMetrics {
  const sampleX1 = clamp(Math.floor(startX / SAMPLE_STEP), 0, maps.sampleWidth)
  const sampleY1 = clamp(Math.floor(startY / SAMPLE_STEP), 0, maps.sampleHeight)
  const sampleX2 = clamp(Math.ceil((startX + width) / SAMPLE_STEP), 0, maps.sampleWidth)
  const sampleY2 = clamp(Math.ceil((startY + height) / SAMPLE_STEP), 0, maps.sampleHeight)
  const sampleCount = (sampleX2 - sampleX1) * (sampleY2 - sampleY1)

  if (sampleCount <= 0) {
    return {
      meanLuminance: 255,
      luminanceStdDev: 0,
      chromaMean: 0,
      chromaStdDev: 0,
      darkPixelRatio: 0,
      neutralPixelRatio: 0,
      whitePixelRatio: 0,
      blackNeutralPixelRatio: 0,
      edgeRatio: 0,
      strongEdgeRatio: 0,
      chromaEdgeRatio: 0,
      saturationMean: 0,
      vividColorRatio: 0,
      highlightRatio: 0,
    }
  }

  const luminanceSum = rectSum(maps.luminanceIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2)
  const luminanceSquaredSum = rectSum(
    maps.luminanceSquaredIntegral,
    maps.sampleWidth,
    sampleX1,
    sampleY1,
    sampleX2,
    sampleY2,
  )
  const chromaSum = rectSum(maps.chromaIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2)
  const chromaSquaredSum = rectSum(
    maps.chromaSquaredIntegral,
    maps.sampleWidth,
    sampleX1,
    sampleY1,
    sampleX2,
    sampleY2,
  )
  const saturationSum = rectSum(maps.saturationIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2)
  const meanLuminance = luminanceSum / sampleCount
  const variance = luminanceSquaredSum / sampleCount - meanLuminance * meanLuminance
  const meanChroma = chromaSum / sampleCount
  const chromaVariance = chromaSquaredSum / sampleCount - meanChroma * meanChroma

  return {
    meanLuminance,
    luminanceStdDev: Math.sqrt(Math.max(variance, 0)),
    chromaMean: meanChroma,
    chromaStdDev: Math.sqrt(Math.max(chromaVariance, 0)),
    darkPixelRatio: rectSum(maps.darkIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2) / sampleCount,
    neutralPixelRatio:
      rectSum(maps.neutralIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2) / sampleCount,
    whitePixelRatio:
      rectSum(maps.whiteIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2) / sampleCount,
    blackNeutralPixelRatio:
      rectSum(maps.blackNeutralIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2) / sampleCount,
    edgeRatio:
      rectSum(maps.edgeCountIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2) / (sampleCount * 2),
    strongEdgeRatio:
      rectSum(maps.strongEdgeCountIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2) /
      (sampleCount * 2),
    chromaEdgeRatio:
      rectSum(maps.chromaEdgeCountIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2) /
      (sampleCount * 2),
    saturationMean: saturationSum / sampleCount,
    vividColorRatio:
      rectSum(maps.vividIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2) / sampleCount,
    highlightRatio:
      rectSum(maps.highlightIntegral, maps.sampleWidth, sampleX1, sampleY1, sampleX2, sampleY2) / sampleCount,
  }
}

function isQuadrantActive(metrics: BinderPageScanRegionMetrics) {
  if (metrics.highlightRatio > 0.2 && metrics.strongEdgeRatio < 0.02 && metrics.vividColorRatio < 0.05) {
    return false
  }
  if (regionReflectionScore(metrics) > 0.78) {
    return false
  }
  if (
    metrics.neutralPixelRatio > 0.84 &&
    metrics.whitePixelRatio + metrics.blackNeutralPixelRatio > 0.52 &&
    metrics.strongEdgeRatio < 0.018 &&
    metrics.luminanceStdDev < 13
  ) {
    return false
  }
  if (metrics.strongEdgeRatio > 0.03 && metrics.luminanceStdDev > 18) return true
  if (metrics.chromaEdgeRatio > 0.045 && metrics.chromaStdDev > 18) return true
  if (metrics.vividColorRatio > 0.08 && metrics.luminanceStdDev > 15) return true
  if (metrics.darkPixelRatio > 0.24 && metrics.edgeRatio > 0.11 && metrics.strongEdgeRatio > 0.025) return true
  if (
    (metrics.whitePixelRatio > 0.2 || metrics.blackNeutralPixelRatio > 0.16) &&
    metrics.edgeRatio > 0.075 &&
    metrics.luminanceStdDev > 12
  ) {
    return true
  }

  const quadrantScore =
    metrics.luminanceStdDev / 34 +
    metrics.chromaStdDev / 42 +
    metrics.strongEdgeRatio * 3.2 +
    metrics.chromaEdgeRatio * 2.6 +
    metrics.vividColorRatio * 0.9 +
    metrics.whitePixelRatio * 0.35 +
    metrics.blackNeutralPixelRatio * 0.45 +
    metrics.saturationMean / 145 -
    metrics.meanLuminance / 420 -
    metrics.neutralPixelRatio * 0.2 -
    metrics.highlightRatio * 0.85

  return quadrantScore > 0.8
}

function scoreSlot(metrics: BinderPageScanSlotMetrics) {
  const reflectionPenalty = slotReflectionScore(metrics)

  return (
    metrics.darkPixelRatio * 1.9 +
    metrics.chromaMean / 120 +
    metrics.chromaStdDev / 34 +
    metrics.whitePixelRatio * 0.45 +
    metrics.blackNeutralPixelRatio * 0.65 -
    metrics.neutralPixelRatio * 0.3 +
    metrics.luminanceStdDev / 38 +
    metrics.edgeRatio * 1.15 +
    metrics.strongEdgeRatio * 2.3 +
    metrics.chromaEdgeRatio * 2.7 +
    metrics.vividColorRatio * 0.8 +
    metrics.saturationMean / 110 +
    metrics.centerLuminanceStdDev / 58 +
    metrics.centerStrongEdgeRatio * 1.9 +
    metrics.centerVividColorRatio * 0.55 +
    metrics.activeQuadrantRatio * 0.9 -
    reflectionPenalty * 1.25 -
    metrics.highlightRatio * 0.45 -
    metrics.centerHighlightRatio * 0.35 -
    metrics.meanLuminance / 380
  )
}

function scoreSlotConfidence(metrics: BinderPageScanSlotMetrics, score: number) {
  const reflectionPenalty = slotReflectionScore(metrics)

  return (
    score * 0.55 +
    metrics.strongEdgeRatio * 5.8 +
    metrics.chromaEdgeRatio * 5.4 +
    metrics.centerStrongEdgeRatio * 7.2 +
    metrics.activeQuadrantRatio * 1.3 +
    metrics.whitePixelRatio * 0.45 +
    metrics.blackNeutralPixelRatio * 0.7 -
    metrics.neutralPixelRatio * 0.35 +
    metrics.centerVividColorRatio * 1.1 -
    reflectionPenalty * 1.35 -
    metrics.highlightRatio * 1.1 -
    metrics.centerHighlightRatio * 0.85
  )
}

function isOccupied(metrics: BinderPageScanSlotMetrics, score: number) {
  const centerDetailScore =
    metrics.centerLuminanceStdDev / 40 +
    metrics.centerStrongEdgeRatio * 4 +
    metrics.centerVividColorRatio * 0.8 -
    metrics.centerHighlightRatio * 0.6
  const chromaDetailScore =
    metrics.chromaStdDev / 30 +
    metrics.chromaEdgeRatio * 3.8 +
    metrics.centerVividColorRatio * 0.8
  const backgroundLike =
    metrics.neutralPixelRatio > 0.84 &&
    metrics.whitePixelRatio + metrics.blackNeutralPixelRatio > 0.58 &&
    metrics.strongEdgeRatio < 0.02 &&
    metrics.centerStrongEdgeRatio < 0.016 &&
    metrics.centerLuminanceStdDev < 12
  const reflectionPenalty = slotReflectionScore(metrics)

  if (
    metrics.activeQuadrantRatio < 0.5 &&
    centerDetailScore < 0.72 &&
    metrics.centerStrongEdgeRatio < 0.022
  ) {
    return false
  }

  if (
    metrics.highlightRatio > 0.18 &&
    metrics.activeQuadrantRatio < 0.5 &&
    metrics.centerStrongEdgeRatio < 0.022 &&
    metrics.centerVividColorRatio < 0.05
  ) {
    return false
  }
  if (backgroundLike) {
    return false
  }
  if (reflectionPenalty > 0.95) {
    return false
  }

  if (score > 1.7 && (centerDetailScore > 0.7 || chromaDetailScore > 0.72) && metrics.activeQuadrantRatio >= 0.5) return true
  if (
    score > 1.38 &&
    (metrics.strongEdgeRatio > 0.04 || metrics.chromaEdgeRatio > 0.05) &&
    metrics.centerStrongEdgeRatio > 0.024 &&
    metrics.activeQuadrantRatio >= 0.5
  ) {
    return true
  }
  if (
    metrics.darkPixelRatio > 0.28 &&
    metrics.edgeRatio > 0.11 &&
    metrics.strongEdgeRatio > 0.045 &&
    metrics.centerStrongEdgeRatio > 0.022 &&
    metrics.activeQuadrantRatio >= 0.5
  ) {
    return true
  }
  if (
    metrics.luminanceStdDev > 34 &&
    metrics.centerLuminanceStdDev > 18 &&
    (metrics.saturationMean > 24 || metrics.vividColorRatio > 0.08) &&
    metrics.strongEdgeRatio > 0.03 &&
    metrics.activeQuadrantRatio >= 0.75
  ) {
    return true
  }
  if (
    score > 1.08 &&
    (metrics.whitePixelRatio > 0.22 || metrics.blackNeutralPixelRatio > 0.18) &&
    (metrics.centerStrongEdgeRatio > 0.017 || metrics.centerLuminanceStdDev > 14 || metrics.chromaEdgeRatio > 0.042) &&
    metrics.activeQuadrantRatio >= 0.5
  ) {
    return true
  }

  return false
}

function shouldRejectAsGlareLike(metrics: BinderPageScanSlotMetrics, score: number) {
  const reflectionPenalty = slotReflectionScore(metrics)
  const glareScore =
    metrics.highlightRatio * 3.2 +
    metrics.centerHighlightRatio * 2.6 -
    metrics.chromaEdgeRatio * 2.2 -
    metrics.chromaStdDev / 26 -
    metrics.centerStrongEdgeRatio * 3.4 -
    metrics.centerVividColorRatio * 1.1 -
    metrics.activeQuadrantRatio * 1.3 -
    metrics.centerLuminanceStdDev / 42

  if (reflectionPenalty > 0.88 && score < 2.05) {
    return true
  }
  if (glareScore > 0.95 && score < 1.75) {
    return true
  }

  if (
    glareScore > 0.72 &&
    metrics.highlightRatio > 0.14 &&
    metrics.centerHighlightRatio > 0.12 &&
    metrics.centerStrongEdgeRatio < 0.024 &&
    metrics.activeQuadrantRatio < 0.5
  ) {
    return true
  }

  return false
}

function refineOccupiedSlots(slots: BinderPageScanSlotResult[]) {
  const usableScores = slots.map((slot) => slot.score)

  if (usableScores.length === 0) {
    return
  }

  const lowerBandCutoff = percentile(usableScores, 0.45)
  const lowerBand = usableScores.filter((score) => score <= lowerBandCutoff)
  const baselineScores = lowerBand.length > 0 ? lowerBand : usableScores
  const baselineMedian = percentile(baselineScores, 0.5)
  const upperMedian = percentile(usableScores, 0.65)
  const scoreSpread = Math.max(0.08, upperMedian - baselineMedian)
  const adaptiveScoreFloor = Math.max(1.18, baselineMedian + scoreSpread * 1.35)
  const adaptiveConfidenceFloor = Math.max(0.95, scoreSpread * 1.5 + 0.85)

  for (const slot of slots) {
    if (!slot.occupied) {
      continue
    }

    const strongPositive =
      slot.score > 1.92 ||
      slot.confidence > 2.3 ||
      (slot.metrics.centerStrongEdgeRatio > 0.038 && slot.metrics.activeQuadrantRatio >= 0.75)

    if (strongPositive) {
      continue
    }

    const weakRelativeToPage =
      slot.score < adaptiveScoreFloor ||
      slot.confidence < adaptiveConfidenceFloor

    const looksMarginal =
      slot.metrics.activeQuadrantRatio < 0.75 &&
      slot.metrics.centerStrongEdgeRatio < 0.03 &&
      slot.metrics.centerVividColorRatio < 0.08
    const looksLikeBinderBack =
      slot.metrics.neutralPixelRatio > 0.84 &&
      slot.metrics.whitePixelRatio + slot.metrics.blackNeutralPixelRatio > 0.6 &&
      slot.metrics.centerStrongEdgeRatio < 0.018
    const looksReflective = slotReflectionScore(slot.metrics) > 0.9

    if ((weakRelativeToPage && looksMarginal) || looksLikeBinderBack || looksReflective) {
      slot.occupied = false
    }
  }
}

function regionReflectionScore(metrics: BinderPageScanRegionMetrics) {
  return (
    metrics.highlightRatio * 2.8 +
    metrics.neutralPixelRatio * 0.85 +
    metrics.whitePixelRatio * 0.55 +
    Math.max(0, (metrics.meanLuminance - 170) / 120) -
    metrics.chromaMean / 65 -
    metrics.chromaStdDev / 32 -
    metrics.chromaEdgeRatio * 2.8 -
    metrics.strongEdgeRatio * 1.8 -
    metrics.vividColorRatio * 0.8
  )
}

function slotReflectionScore(metrics: BinderPageScanSlotMetrics) {
  return (
    metrics.highlightRatio * 3 +
    metrics.centerHighlightRatio * 2.5 +
    metrics.neutralPixelRatio * 0.9 +
    metrics.whitePixelRatio * 0.65 +
    Math.max(0, (metrics.meanLuminance - 176) / 110) -
    metrics.chromaMean / 68 -
    metrics.chromaStdDev / 34 -
    metrics.chromaEdgeRatio * 3.1 -
    metrics.centerStrongEdgeRatio * 2.7 -
    metrics.centerVividColorRatio * 1.1 -
    metrics.activeQuadrantRatio * 0.95
  )
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("The selected image could not be loaded."))
    }

    image.src = url
  })
}
