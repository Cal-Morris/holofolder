'use client';

import { useState } from 'react';
import { Flashlight, FlashlightOff } from 'lucide-react';

type ZoomRange = { min: number; max: number; step: number };
// Not in lib.dom yet: Chrome on Android and recent Safari expose these on the back camera.
type ExtraCapabilities = { zoom?: ZoomRange; torch?: boolean };
type ExtraSettings = { zoom?: number; torch?: boolean };

/** Zoom slider and torch toggle over a camera preview, shown only for what the camera supports. */
export default function CameraControls({ track }: { track: MediaStreamTrack | null }) {
  return track ? <Controls key={track.id} track={track} /> : null;
}

function Controls({ track }: { track: MediaStreamTrack }) {
  const caps = (track.getCapabilities?.() ?? {}) as ExtraCapabilities;
  const zoomRange = caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
  const [zoom, setZoom] = useState(() => (track.getSettings() as ExtraSettings).zoom ?? null);
  const [torch, setTorch] = useState(() => !!(track.getSettings() as ExtraSettings).torch);

  if (!zoomRange && !caps.torch) return null;
  const apply = (constraint: ExtraSettings) =>
    track.applyConstraints({ advanced: [constraint as MediaTrackConstraintSet] }).catch(() => undefined);

  return (
    <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-full bg-black/60 px-3 py-1.5 text-white backdrop-blur">
      {zoomRange && (
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
          <span className="w-9 shrink-0 tabular-nums">{(zoom ?? zoomRange.min).toFixed(1)}×</span>
          <input
            type="range"
            aria-label="Zoom"
            min={zoomRange.min}
            max={zoomRange.max}
            step={zoomRange.step || 0.1}
            value={zoom ?? zoomRange.min}
            onChange={(event) => {
              const next = Number(event.target.value);
              setZoom(next);
              void apply({ zoom: next });
            }}
            className="h-9 min-w-0 flex-1 accent-white"
          />
        </label>
      )}
      {caps.torch && (
        <button
          type="button"
          aria-label={torch ? 'Turn light off' : 'Turn light on'}
          aria-pressed={torch}
          onClick={() => {
            setTorch(!torch);
            void apply({ torch: !torch });
          }}
          className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10"
        >
          {torch ? <Flashlight className="h-4 w-4" aria-hidden /> : <FlashlightOff className="h-4 w-4" aria-hidden />}
        </button>
      )}
    </div>
  );
}
