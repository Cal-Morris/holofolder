import test from "node:test"
import assert from "node:assert/strict"
import { compareCardImageDescriptors, type CardImageDescriptor } from "../lib/card-image-match"

function bits(length: number, value = 0) {
  return Array.from({ length }, () => value)
}

function signature(length: number, pattern: number[]) {
  return Array.from({ length }, (_, index) => pattern[index % pattern.length])
}

function descriptor(overrides: Partial<CardImageDescriptor> = {}): CardImageDescriptor {
  return {
    regionFeatures: bits(30 * 6, 0.5),
    regionWeights: bits(30, 1),
    horizontalHashBits: bits(216),
    verticalHashBits: bits(221),
    averageHashBits: bits(64),
    rowProfile: bits(24, 0.5),
    columnProfile: bits(24, 0.5),
    borderProfile: bits(16, 0.5),
    focusPatches: [],
    microColorSignature: bits(10 * 14 * 4, 0.5),
    edgeOrientationSignature: bits(5 * 7 * 4, 0.25),
    colorBlobSignature: bits(8 * 4, 0.25),
    ...overrides,
  }
}

test("compareCardImageDescriptors uses micro color detail to break coarse descriptor ties", () => {
  const query = descriptor({
    microColorSignature: signature(10 * 14 * 4, [0.1, 0.2, 0.3, 0.4]),
  })
  const closeCandidate = descriptor({
    microColorSignature: signature(10 * 14 * 4, [0.12, 0.22, 0.32, 0.42]),
  })
  const wrongCandidate = descriptor({
    microColorSignature: signature(10 * 14 * 4, [0.82, 0.72, 0.62, 0.52]),
  })

  const closeMatch = compareCardImageDescriptors(query, closeCandidate)
  const wrongMatch = compareCardImageDescriptors(query, wrongCandidate)

  assert.ok(closeMatch.similarity > wrongMatch.similarity + 0.04)
})

test("compareCardImageDescriptors uses oriented edge detail when color and hashes are ambiguous", () => {
  const query = descriptor({
    edgeOrientationSignature: signature(5 * 7 * 4, [0.8, 0.1, 0.05, 0.05]),
  })
  const closeCandidate = descriptor({
    edgeOrientationSignature: signature(5 * 7 * 4, [0.72, 0.16, 0.06, 0.06]),
  })
  const wrongCandidate = descriptor({
    edgeOrientationSignature: signature(5 * 7 * 4, [0.08, 0.12, 0.7, 0.1]),
  })

  const closeMatch = compareCardImageDescriptors(query, closeCandidate)
  const wrongMatch = compareCardImageDescriptors(query, wrongCandidate)

  assert.ok(closeMatch.similarity > wrongMatch.similarity + 0.03)
})

test("compareCardImageDescriptors uses hue blob position for full-art style colour layouts", () => {
  const query = descriptor({
    colorBlobSignature: signature(8 * 4, [0.58, 0.22, 0.26, 0.18]),
  })
  const closeCandidate = descriptor({
    colorBlobSignature: signature(8 * 4, [0.56, 0.25, 0.27, 0.2]),
  })
  const wrongCandidate = descriptor({
    colorBlobSignature: signature(8 * 4, [0.58, 0.78, 0.72, 0.5]),
  })

  const closeMatch = compareCardImageDescriptors(query, closeCandidate)
  const wrongMatch = compareCardImageDescriptors(query, wrongCandidate)

  assert.ok(closeMatch.similarity > wrongMatch.similarity + 0.025)
})
