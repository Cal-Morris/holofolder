// Shared camera-frame helpers for the binder page scanner, the card selector's scanner and Show mode's Scan.

export function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

/** Draws the video into the target size like CSS object-fit: cover. */
export function drawVideoCoverFrame(
  video: HTMLVideoElement,
  context: CanvasRenderingContext2D,
  targetWidth: number,
  targetHeight: number,
) {
  const videoWidth = video.videoWidth || 1280;
  const videoHeight = video.videoHeight || 720;
  const scale = Math.max(targetWidth / videoWidth, targetHeight / videoHeight);
  const drawWidth = videoWidth * scale;
  const drawHeight = videoHeight * scale;
  const offsetX = (targetWidth - drawWidth) / 2;
  const offsetY = (targetHeight - drawHeight) / 2;

  context.clearRect(0, 0, targetWidth, targetHeight);
  context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
}

export interface CardGuideCrop {
  /** Fraction of the width/height left outside the on-screen guide on each side. */
  insetX: number;
  insetY: number;
  /** Card width / height. */
  aspectRatio: number;
  minWidth: number;
  minHeight: number;
  errorMessage: string;
}

/** Crops the largest card-shaped rectangle that fits inside the on-screen guide, centred. */
export function cropCanvasToCardGuide(sourceCanvas: HTMLCanvasElement, guide: CardGuideCrop) {
  const availableWidth = sourceCanvas.width * (1 - guide.insetX * 2);
  const availableHeight = sourceCanvas.height * (1 - guide.insetY * 2);
  let cropWidth = availableWidth;
  let cropHeight = cropWidth / guide.aspectRatio;

  if (cropHeight > availableHeight) {
    cropHeight = availableHeight;
    cropWidth = cropHeight * guide.aspectRatio;
  }

  const cropX = Math.round((sourceCanvas.width - cropWidth) / 2);
  const cropY = Math.round((sourceCanvas.height - cropHeight) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(guide.minWidth, Math.round(cropWidth));
  canvas.height = Math.max(guide.minHeight, Math.round(cropHeight));
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error(guide.errorMessage);
  }

  context.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);

  return canvas;
}

/** The on-screen guide for scanning one card (shared by the card selector's scanner and Show mode's Scan). */
export const SINGLE_CARD_GUIDE = { insetX: 0.18, insetY: 0.1, aspectRatio: 2.5 / 3.5 } as const;

async function canvasToJpegFile(canvas: HTMLCanvasElement, index: number) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) {
    throw new Error('Could not encode the card scan frame.');
  }

  return new File([blob], `card-scan-${index}.jpg`, { type: 'image/jpeg' });
}

/** Grabs the camera frame, cropped to the single-card guide, as a JPEG file and a data URL preview. */
export async function captureSingleCardFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, index: number) {
  const previewWidth = Math.max(480, Math.round((video.clientWidth || 360) * 2));
  const previewHeight = Math.max(820, Math.round((video.clientHeight || 640) * 2));
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Could not capture the card scanner frame.');
  }

  drawVideoCoverFrame(video, context, previewWidth, previewHeight);
  const guidedCanvas = cropCanvasToCardGuide(canvas, {
    ...SINGLE_CARD_GUIDE,
    minWidth: 220,
    minHeight: 300,
    errorMessage: 'Could not crop the card guide frame.',
  });

  return {
    file: await canvasToJpegFile(guidedCanvas, index),
    previewUrl: guidedCanvas.toDataURL('image/jpeg', 0.82),
  };
}
