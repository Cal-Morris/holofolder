'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import NextImage from 'next/image';
import { ArrowLeft, Upload } from 'lucide-react';
import { FEATURED_CARDS, getFeaturedCardImageUrl } from '@/lib/featured-cards';
import {
  DESIGN_SURFACES,
  defaultBinderDesign,
  binderFill,
  binderTurnPage,
  artworkRectangle,
  isCardArtworkUrl,
  type BinderDesign,
  type BinderPart,
  type BinderStats,
  type BinderView,
  type DesignSurface,
  type StudioCard,
} from '@/lib/binder-design';
import { validateArtwork } from '@/lib/binder-design-storage';
import { useBinderAppearance } from '@/hooks/use-binder-appearance';
import type { BinderSettings } from '@/lib/settings';
import { BinderPresetPicker } from '@/components/binder-preset-picker';
import { applyBinderDesignPreset } from '@/lib/binder-design-presets';
import { CreditsNotice } from '@/components/credits';
import { useCardSearch } from '@/hooks/use-card-search';
import { toCardImageProxySrc, toCardThumbnailSrc } from '@/lib/card-image-url';
import './studio.css';
const Viewport = dynamic(() => import('./viewport'), {
  ssr: false,
  loading: () => <div className="studio-stage studio-loading">Opening the 3D studio…</div>,
});
const views: { view: BinderView; label: string }[] = [
  { view: 'front', label: 'Front' },
  { view: 'back', label: 'Back' },
  { view: 'spine', label: 'Spine' },
  { view: 'inside', label: 'Inside' },
  { view: 'detail', label: 'Detail' },
];
const labels: Record<BinderPart, string> = {
  cover: 'Front cover',
  back: 'Back cover',
  spine: 'Spine',
  lining: 'Inside lining',
  pages: 'Pocket pages',
  zip: 'Zip hardware',
};
const sampleCards: readonly StudioCard[] = FEATURED_CARDS.map((c) => ({
  id: c.id,
  name: c.name,
  image: getFeaturedCardImageUrl(c),
}));
export interface DesignerProps {
  owner: string | null;
  legacyKey?: string;
  cards: StudioCard[];
  placed: number;
  wanted: number;
  occupiedSlots?: number[];
  settings: BinderSettings;
  collectionError?: boolean;
}
export default function BinderDesigner({
  owner,
  legacyKey,
  cards,
  placed,
  wanted,
  occupiedSlots,
  settings,
  collectionError,
}: DesignerProps) {
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.darkMode);
  }, [settings.darkMode]);
  const appearance = useBinderAppearance({ owner, settings, legacyKey });
  const initial = useMemo(() => defaultBinderDesign(settings), [settings]);
  const [preset, setPreset] = useState<string | null>(null);
  const [draft, setDraft] = useState(initial),
    [saved, setSaved] = useState(initial),
    [history, setHistory] = useState<BinderDesign[]>([]);
  const [mode, setMode] = useState<'sample' | 'collection'>(owner ? 'collection' : 'sample'),
    [part, setPart] = useState<BinderPart>('cover'),
    [view, setView] = useState<BinderView>('front'),
    [page, setPage] = useState(1);
  const [uploads, setUploads] = useState<Record<string, Blob>>({}),
    [artwork, setArtwork] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(''),
    [ready, setReady] = useState(false),
    [saving, setSaving] = useState(false),
    [search, setSearch] = useState('');
  const inspector = useRef<HTMLElement>(null),
    parts = useRef<HTMLElement>(null),
    presetLibrary = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    parts.current?.querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [part]);
  const draftRef = useRef(initial),
    savedRef = useRef(initial),
    draftRevision = useRef(0);
  const replaceDraft = useCallback((value: BinderDesign) => {
    draftRef.current = value;
    setDraft(value);
  }, []);
  const urlsRef = useRef<Record<string, string>>({}),
    uploadGeneration = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      uploadGeneration.current = -1;
      Object.values(urlsRef.current).forEach(URL.revokeObjectURL);
      urlsRef.current = {};
    };
  }, []);
  const installUploads = useCallback((next: Record<string, Blob>) => {
    const urls = Object.fromEntries(
      Object.entries(next).map(([id, blob]) => [id, urlsRef.current[id] ?? URL.createObjectURL(blob)]),
    );
    for (const [id, url] of Object.entries(urlsRef.current)) if (!urls[id]) URL.revokeObjectURL(url);
    urlsRef.current = urls;
    setUploads(next);
    setArtwork(urls);
  }, []);
  useEffect(() => {
    if (appearance.loading) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const pristine = JSON.stringify(draftRef.current) === JSON.stringify(savedRef.current);
      if (!ready || pristine) {
        replaceDraft(appearance.design);
        installUploads(appearance.uploads);
        draftRevision.current = appearance.revision;
      }
      savedRef.current = appearance.design;
      setSaved(appearance.design);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [
    appearance.loading,
    appearance.design,
    appearance.uploads,
    appearance.revision,
    ready,
    replaceDraft,
    installUploads,
  ]);
  const edit = useCallback(
    (change: (d: BinderDesign) => BinderDesign) => {
      setPreset(null);
      const previous = draftRef.current;
      const next = change(previous);
      setHistory((h) => [...h.slice(-29), previous]);
      replaceDraft(next);
      setMessage('');
    },
    [replaceDraft],
  );
  const surface = DESIGN_SURFACES.includes(part as DesignSurface) ? (part as DesignSurface) : null;
  const selected = surface ? draft.surfaces[surface] : null;
  const editSurface = (change: Partial<BinderDesign['surfaces'][DesignSurface]>, target = surface) => {
    if (target) edit((d) => ({ ...d, surfaces: { ...d.surfaces, [target]: { ...d.surfaces[target], ...change } } }));
  };
  const select = useCallback((p: BinderPart) => {
    if (presetLibrary.current) presetLibrary.current.open = false;
    inspector.current?.scrollTo({ top: 0 });
    setPart(p);
    setView(
      p === 'lining' || p === 'pages'
        ? 'inside'
        : p === 'back'
          ? 'back'
          : p === 'spine'
            ? 'spine'
            : p === 'zip'
              ? 'detail'
              : 'front',
    );
  }, []);
  const shownCards = mode === 'sample' ? sampleCards : cards;
  const geometryDesign = useMemo(
    () =>
      mode === 'sample'
        ? { ...draft, rows: 3, cols: 3 }
        : { ...draft, pageCount: Math.max(draft.pageCount, Math.ceil(1025 / (draft.rows * draft.cols))) },
    [mode, draft],
  );
  const stats = useMemo<BinderStats>(
    () => ({
      sample: mode === 'sample',
      placed: mode === 'sample' ? sampleCards.length : placed,
      wanted: mode === 'sample' ? 0 : wanted,
      filled: binderFill(
        mode === 'sample' ? sampleCards.map((_, i) => i) : (occupiedSlots ?? []),
        geometryDesign.pageCount * geometryDesign.rows * geometryDesign.cols,
      ),
      unavailable: mode === 'collection' && collectionError,
      capacity: geometryDesign.pageCount * geometryDesign.rows * geometryDesign.cols,
    }),
    [
      mode,
      placed,
      wanted,
      occupiedSlots,
      collectionError,
      geometryDesign.pageCount,
      geometryDesign.rows,
      geometryDesign.cols,
    ],
  );
  const maxPreviewPages = geometryDesign.pageCount;
  const previewPage = Math.min(page, maxPreviewPages);
  // Featured cards until there's a query, then the whole catalogue. Only TCGdex images can be saved as artwork.
  const cardSearch = useCardSearch(search, true);
  const searching = search.trim().length >= 2;
  const picker = searching
    ? cardSearch.cards.flatMap((c) => {
        const artwork = toCardImageProxySrc(c.image);
        return artwork && isCardArtworkUrl(artwork)
          ? [{ id: c.id, name: c.name, set: c.set.name, num: c.localId, artwork }]
          : [];
      })
    : FEATURED_CARDS.map((c) => ({
        id: c.id,
        name: c.name,
        set: c.set,
        num: c.num,
        artwork: getFeaturedCardImageUrl(c),
      }));
  async function upload(file?: File) {
    if (!file || !surface) return;
    const target = surface,
      token = ++uploadGeneration.current;
    try {
      await validateArtwork(file);
      if (!mounted.current || token !== uploadGeneration.current) return;
      const id = `upload:${crypto.randomUUID()}`;
      installUploads({ ...uploads, [id]: file });
      editSurface({ artwork: id, frame: { fit: 'fill', zoom: 1, x: 0, y: 0 } }, target);
    } catch (e) {
      if (mounted.current) setMessage(e instanceof Error ? e.message : 'Could not open artwork.');
    }
  }
  async function save() {
    if (!ready || saving) return;
    const snapshot = draft;
    setSaving(true);
    try {
      const result = await appearance.save(snapshot, uploads, draftRevision.current);
      if (mounted.current) {
        draftRevision.current = result.revision;
        savedRef.current = snapshot;
        setSaved(snapshot);
        setMessage('');
      }
    } catch (e) {
      if (mounted.current) setMessage(e instanceof Error ? e.message : 'Could not save. Your draft is still here.');
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <main className="binder-studio">
      <header className="studio-header">
        <Link href="/">
          <ArrowLeft size={16} aria-hidden="true" />
          Your binder
        </Link>
        <div>
          <button
            disabled={!history.length || saving}
            onClick={() => {
              const previous = history.at(-1);
              if (previous) {
                replaceDraft(previous);
                setPreset(null);
                setHistory((h) => h.slice(0, -1));
                setMessage('');
              }
            }}
          >
            Undo
          </button>
          <button
            disabled={saving}
            onClick={() => {
              uploadGeneration.current++;
              replaceDraft(saved);
              installUploads(appearance.uploads);
              draftRevision.current = appearance.revision;
              setPreset(null);
              setHistory([]);
              setMessage('Draft discarded. Your saved appearance is restored.');
            }}
          >
            Cancel
          </button>
          <button
            className="studio-primary holo-action"
            aria-label="Save appearance"
            disabled={!ready || saving}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>
      <section className="studio-title">
        <div>
          <h1>Binder Studio</h1>
          <p>A home for your collection. Made yours.</p>
        </div>
        <div>
          <label>
            Preview collection
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as typeof mode);
                setPage(1);
              }}
            >
              <option value="sample">100-card sample · not owned</option>
              {owner && <option value="collection">Your National Dex collection</option>}
            </select>
          </label>
        </div>
      </section>
      {collectionError && mode === 'collection' && (
        <p role="alert" className="studio-error">
          Your collection could not load. No counts or cards are assumed. Try refreshing.
        </p>
      )}

      <div className="studio-workspace">
        <section className="studio-preview" aria-label="Binder preview">
          {ready ? (
            <Viewport
              design={geometryDesign}
              cards={shownCards}
              stats={stats}
              page={previewPage}
              artwork={artwork}
              view={view}
              onSelect={select}
              onPageTurn={(direction) => setPage((p) => binderTurnPage(p, maxPreviewPages, direction))}
            />
          ) : (
            <div className="studio-stage studio-loading">Loading your appearance…</div>
          )}
          <div className="studio-views holo-toolbar" role="group" aria-label="Preview angle">
            {views.map(({ view: v, label }) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                {label}
              </button>
            ))}
          </div>
          {view === 'inside' && (
            <div className="studio-pagination">
              <button
                aria-label="Previous preview page"
                disabled={binderTurnPage(previewPage, maxPreviewPages, -1) === previewPage}
                onClick={() => setPage((p) => binderTurnPage(p, maxPreviewPages, -1))}
              >
                ←
              </button>
              <span>Page {previewPage}</span>
              <button
                aria-label="Next preview page"
                disabled={binderTurnPage(previewPage, maxPreviewPages, 1) === previewPage}
                onClick={() => setPage((p) => binderTurnPage(p, maxPreviewPages, 1))}
              >
                →
              </button>
            </div>
          )}
        </section>
        <div className="studio-editor holo-panel">
          <nav ref={parts} className="studio-parts holo-toolbar" aria-label="Binder parts">
            {(Object.keys(labels) as BinderPart[]).map((p) => (
              <button key={p} disabled={!ready || saving} aria-pressed={part === p} onClick={() => select(p)}>
                {labels[p]}
              </button>
            ))}
          </nav>
          <section ref={inspector} className="studio-controls" aria-label="Appearance controls">
            <fieldset disabled={!ready || saving}>
              <details ref={presetLibrary} className="studio-preset-library">
                <summary>Presets</summary>
                <BinderPresetPicker
                  active={preset}
                  disabled={!ready || saving}
                  onSelect={(id) => {
                    edit((d) => applyBinderDesignPreset(d, id));
                    setPreset(id);
                    setPart('cover');
                    setView('front');
                  }}
                />
              </details>
              <div className="studio-inspector-heading">
                <h2>{labels[part]}</h2>
              </div>
              {selected && surface && (
                <>
                  <label className="studio-colour-control">
                    <span>Surface colour</span>
                    <span className="studio-colour-value">
                      <output aria-hidden="true">{selected.color.toUpperCase()}</output>
                      <input
                        aria-label="Surface colour"
                        type="color"
                        value={selected.color}
                        onChange={(e) => editSurface({ color: e.target.value })}
                      />
                    </span>
                  </label>
                  <details key={`lettering-${surface}`} className="studio-control-group">
                    <summary>
                      Lettering <span>{selected.words ? 'Custom words' : 'Add words'}</span>
                    </summary>
                    <label>
                      Words
                      <textarea
                        aria-label="Words"
                        value={selected.words}
                        maxLength={240}
                        onChange={(e) => editSurface({ words: e.target.value })}
                      />
                    </label>
                    <div className="studio-control-row">
                      <label>
                        Lettering
                        <select
                          value={draft.font}
                          onChange={(e) => edit((d) => ({ ...d, font: e.target.value as BinderDesign['font'] }))}
                        >
                          <option value="sans-serif">Sans</option>
                          <option value="serif">Serif</option>
                          <option value="monospace">Mono</option>
                        </select>
                      </label>
                      <label>
                        Ink
                        <input
                          type="color"
                          value={draft.ink}
                          onChange={(e) => edit((d) => ({ ...d, ink: e.target.value }))}
                        />
                      </label>
                    </div>
                    <Range
                      label="Lettering size"
                      value={draft.textSize}
                      min={20}
                      max={150}
                      step={1}
                      onChange={(value) => edit((d) => ({ ...d, textSize: value }))}
                    />
                  </details>
                  <div className="studio-artwork-group">
                    <h3>Artwork</h3>
                    <label className="studio-upload">
                      <Upload size={16} aria-hidden="true" />
                      <span>{selected.artwork ? 'Replace artwork' : 'Upload artwork'}</span>
                      <input
                        aria-label="Upload artwork"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => {
                          upload(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <small>PNG, JPEG or WebP · 5 MB · 24 megapixels</small>
                    {selected.artwork && (
                      <details className="studio-artwork-adjust" key={`artwork-${surface}`}>
                        <summary>
                          Adjust artwork <span>Crop & position</span>
                        </summary>
                        <ArtworkCrop
                          key={surface}
                          src={artwork[selected.artwork] ?? selected.artwork}
                          surface={surface}
                          frame={selected.frame}
                          onChange={(value) => editSurface({ frame: value })}
                        />
                        <label>
                          Framing
                          <select
                            value={selected.frame.fit}
                            onChange={(e) =>
                              editSurface({ frame: { ...selected.frame, fit: e.target.value as 'fit' | 'fill' } })
                            }
                          >
                            <option value="fill">Fill and crop</option>
                            <option value="fit">Fit entire artwork</option>
                          </select>
                        </label>
                        <Range
                          label="Artwork zoom"
                          value={selected.frame.zoom}
                          min={0.25}
                          max={4}
                          step={0.05}
                          onChange={(zoom) => editSurface({ frame: { ...selected.frame, zoom } })}
                        />
                        <Range
                          label="Horizontal placement"
                          value={selected.frame.x}
                          min={-1}
                          max={1}
                          step={0.01}
                          onChange={(x) => editSurface({ frame: { ...selected.frame, x } })}
                        />
                        <Range
                          label="Vertical placement"
                          value={selected.frame.y}
                          min={-1}
                          max={1}
                          step={0.01}
                          onChange={(y) => editSurface({ frame: { ...selected.frame, y } })}
                        />
                        <button onClick={() => editSurface({ artwork: null })} className="studio-remove-artwork">
                          Remove artwork
                        </button>
                      </details>
                    )}
                    <details>
                      <summary>Choose Pokémon card artwork</summary>
                      <label>
                        Find a card
                        <input
                          className="studio-card-search"
                          placeholder="Name, set or number"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      {searching && (cardSearch.loading || !picker.length) && (
                        <p className="studio-picker-status" role="status">
                          {cardSearch.loading ? 'Searching…' : 'No cards found.'}
                        </p>
                      )}
                      <div className="studio-card-picker">
                        {picker.map((c) => (
                          <button
                            key={c.id}
                            aria-label={`Use ${c.name} ${c.num} artwork`}
                            onClick={() => {
                              editSurface({
                                artwork: c.artwork,
                                frame: { fit: 'fill', zoom: 1, x: 0, y: 0 },
                              });
                              setSearch('');
                            }}
                          >
                            <NextImage
                              unoptimized
                              width={315}
                              height={440}
                              loading="lazy"
                              src={toCardThumbnailSrc(c.artwork)?.src ?? c.artwork}
                              alt={`${c.name} ${c.set} ${c.num}`}
                              className="trading-card"
                            />
                            <span>
                              {c.name}
                              <small>
                                {c.set} · {c.num}
                              </small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </details>
                  </div>
                  {surface === 'lining' && (
                    <label>
                      Binder statistics
                      <select
                        value={draft.stats}
                        onChange={(e) => edit((d) => ({ ...d, stats: e.target.value as BinderDesign['stats'] }))}
                      >
                        <option value="off">Off</option>
                        <option value="compact">Compact</option>
                        <option value="full">Full</option>
                      </select>
                    </label>
                  )}
                </>
              )}
              {part === 'pages' && (
                <>
                  <Range
                    label="Page count"
                    value={draft.pageCount}
                    min={1}
                    max={1025}
                    step={1}
                    onChange={(pageCount) => edit((d) => ({ ...d, pageCount }))}
                  />
                  <p>
                    {geometryDesign.pageCount * geometryDesign.rows * geometryDesign.cols} pockets · Appearance only.
                  </p>
                  <label>
                    Default page colour
                    <input
                      type="color"
                      value={draft.pageColor}
                      onChange={(e) => edit((d) => ({ ...d, pageColor: e.target.value }))}
                    />
                  </label>
                  <label>
                    Preview page face
                    <input
                      type="number"
                      min={1}
                      max={maxPreviewPages}
                      value={previewPage}
                      onChange={(e) => setPage(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </label>
                  <label>
                    This page colour
                    <input
                      type="color"
                      value={draft.pageColors[String(previewPage)] ?? draft.pageColor}
                      onChange={(e) =>
                        edit((d) => ({ ...d, pageColors: { ...d.pageColors, [String(previewPage)]: e.target.value } }))
                      }
                    />
                  </label>
                  <button
                    onClick={() =>
                      edit((d) => {
                        const pageColors = { ...d.pageColors };
                        delete pageColors[String(previewPage)];
                        return { ...d, pageColors };
                      })
                    }
                  >
                    Use default for this page
                  </button>
                </>
              )}
              {part === 'zip' && (
                <>
                  {(['teeth', 'tape', 'pull'] as const).map((k) => (
                    <label key={k}>
                      Zip {k} colour
                      <input
                        type="color"
                        value={draft.zip[k]}
                        onChange={(e) => edit((d) => ({ ...d, zip: { ...d.zip, [k]: e.target.value } }))}
                      />
                    </label>
                  ))}
                  <label>
                    Zip type
                    <select
                      value={draft.zip.type}
                      onChange={(e) =>
                        edit((d) => ({ ...d, zip: { ...d.zip, type: e.target.value as 'metal' | 'nylon' } }))
                      }
                    >
                      <option value="metal">Metal teeth</option>
                      <option value="nylon">Nylon coil</option>
                    </select>
                  </label>
                </>
              )}
              <details className="studio-control-group">
                <summary>
                  Binder setup <span>Name & finish</span>
                </summary>
                <label>
                  Binder name
                  <input
                    value={draft.name}
                    maxLength={100}
                    onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
                  />
                </label>
                <label>
                  Cover material
                  <select
                    value={draft.material}
                    onChange={(e) => edit((d) => ({ ...d, material: e.target.value as 'pebbled' | 'smooth' }))}
                  >
                    <option value="pebbled">Pebbled leather</option>
                    <option value="smooth">Smooth leather</option>
                  </select>
                </label>
              </details>
              <CreditsNotice className="studio-attribution" />
            </fieldset>
          </section>
        </div>
      </div>
      <p role="status" className="studio-save-status">
        {message ||
          appearance.message ||
          (owner ? 'Appearance syncs with your account.' : 'Guest appearances stay on this device.')}
      </p>
      {owner && appearance.message.includes('changed on another device') && (
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              const latest = await appearance.loadLatest();
              const next = latest?.design ?? initial;
              replaceDraft(next);
              installUploads(latest?.uploads ?? {});
              savedRef.current = next;
              draftRevision.current = latest?.revision ?? 0;
              setSaved(next);
              setHistory([]);
              setMessage('');
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'Could not load the latest appearance.');
            } finally {
              setSaving(false);
            }
          }}
        >
          Load latest appearance
        </button>
      )}
    </main>
  );
}
function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <span className="studio-range">
        <input
          type="range"
          aria-label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output>{Number(value.toFixed(2))}</output>
      </span>
    </label>
  );
}
function ArtworkCrop({
  src,
  surface,
  frame,
  onChange,
}: {
  src: string;
  surface: DesignSurface;
  frame: BinderDesign['surfaces'][DesignSurface]['frame'];
  onChange: (f: typeof frame) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    image = useRef<HTMLImageElement | null>(null),
    drag = useRef<{ x: number; y: number; frame: typeof frame } | null>(null);
  const [error, setError] = useState(''),
    [loaded, setLoaded] = useState(0);
  useEffect(() => {
    let active = true;
    const im = new Image();
    im.onload = () => {
      if (active) {
        image.current = im;
        setError('');
        setLoaded((n) => n + 1);
      }
    };
    im.onerror = () => {
      if (active) setError('Artwork preview could not load.');
    };
    im.src = src;
    return () => {
      active = false;
      image.current = null;
    };
  }, [src]);
  function paint() {
    const c = canvas.current,
      im = image.current;
    if (!c || !im) return;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#292a2d';
    ctx.fillRect(0, 0, c.width, c.height);
    const r = artworkRectangle(im.naturalWidth, im.naturalHeight, c.width, c.height, frame);
    ctx.drawImage(im, r.x, r.y, r.width, r.height);
  }
  useEffect(() => {
    paint();
  }, [frame, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <canvas
        ref={canvas}
        width={surface === 'spine' ? 100 : 300}
        height={400}
        className={`studio-crop ${surface === 'spine' ? 'studio-crop-spine' : ''}`}
        tabIndex={0}
        aria-label="Artwork crop preview, drag to position, arrow keys to move"
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          onChange({
            ...frame,
            x: Math.max(-1, Math.min(1, frame.x + (e.key === 'ArrowLeft' ? -0.03 : e.key === 'ArrowRight' ? 0.03 : 0))),
            y: Math.max(-1, Math.min(1, frame.y + (e.key === 'ArrowUp' ? -0.03 : e.key === 'ArrowDown' ? 0.03 : 0))),
          });
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, frame };
        }}
        onPointerMove={(e) => {
          const d = drag.current,
            im = image.current;
          if (!d || !im) return;
          const box = e.currentTarget.getBoundingClientRect(),
            r = artworkRectangle(im.naturalWidth, im.naturalHeight, box.width, box.height, d.frame);
          onChange({
            ...d.frame,
            x: Math.max(-1, Math.min(1, d.frame.x + ((e.clientX - d.x) * 2) / Math.max(box.width, r.width))),
            y: Math.max(-1, Math.min(1, d.frame.y + ((e.clientY - d.y) * 2) / Math.max(box.height, r.height))),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      {error && <p role="status">{error}</p>}
    </>
  );
}
