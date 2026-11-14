import * as THREE from 'three';
import { binderCameraFrame } from '@/lib/binder-camera';
import { PUBLIC_CARD_IMAGE_BASE } from '@/lib/card-image-url';
import { createBinderTapTracker, createBinderSwipeTracker } from '@/lib/binder-pointer';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  studioCardTextureKey,
  artworkRectangle,
  binderDimensions,
  binderSpread,
  binderTurnPage,
  pageTurnPoint,
  binderPocket,
  binderPage,
  BINDER_LAYERS,
  type BinderDesign,
  type BinderPart,
  type BinderStats,
  type BinderView,
  type DesignSurface,
  type StudioCard,
} from '@/lib/binder-design';

interface RenderInput {
  design: BinderDesign;
  cards: readonly StudioCard[];
  stats: BinderStats;
  page: number;
  artwork: Record<string, string>;
}
export function createBinderRenderer(
  stage: HTMLDivElement,
  select: (part: BinderPart) => void,
  fail: (message: string) => void,
  onPageTurn?: (direction: -1 | 1) => void,
  onSlotSelect?: (slot: number) => void,
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.toneMappingExposure = 0.95;
  renderer.domElement.setAttribute(
    'aria-label',
    '3D binder, swipe to turn pages, pinch to zoom, drag when zoomed to pan, two fingers to orbit, tap a slot for details',
  );
  renderer.domElement.setAttribute('role', 'img');
  stage.append(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.minDistance = 2;
  controls.maxDistance = 40;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  let fittedDistance = 10;
  const zoomed = () => controls.getDistance() < fittedDistance * 0.8;
  const pmrem = new THREE.PMREMGenerator(renderer),
    room = new RoomEnvironment(),
    environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  scene.environmentIntensity = 0.45;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x18171a, 0.35));
  // Warm key from the top left, cool rim from behind on the right: soft studio light on leather.
  // A wide soft spot rather than a flat sun, so covers fall off from top left instead of reading as one grey slab.
  const key = new THREE.SpotLight(0xfff8f2, 260, 0, 0.42, 1, 2);
  key.position.set(-4, 6, 7);
  const rim = new THREE.DirectionalLight(0xdfe6ff, 1.1);
  rim.position.set(6, 3, -4);
  scene.add(key, key.target, rim);
  const root = new THREE.Group();
  scene.add(root);
  let hinge = new THREE.Group(),
    binding: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> | null = null;
  let layout = binderPage(3, 3),
    radius = 0.3,
    opening = 0,
    view: BinderView = 'front',
    targets: THREE.Object3D[] = [],
    textures: THREE.Texture[] = [],
    generation = 0,
    disposed = false,
    visible = true,
    pending: ReturnType<typeof setTimeout> | undefined;
  let updateKey: string | null = null;
  let openingFrame = 0;
  let frameRequest = 0,
    displayedPage = 0,
    latestInput: RenderInput | null = null;
  let closedPages = new THREE.Group(),
    openPages = new THREE.Group();
  let modelRevision = 0;
  const spreads = new Map<number, Promise<Spread>>();
  interface Spread {
    group: THREE.Group;
    left: THREE.Group;
    right: THREE.Group;
    leftZ: number;
    rightZ: number;
  }
  const pageTextures = new Map<string, THREE.Texture>(),
    motion = matchMedia('(prefers-reduced-motion: reduce)');
  let turn: {
    group: THREE.Group;
    deform: Deformable[];
    start: number;
    forward: boolean;
    rightZ: number;
    leftZ: number;
    landing: THREE.Group;
    previous: THREE.Group;
    token: number;
    settle: () => void;
  } | null = null;
  interface Deformable {
    object: THREE.Mesh | THREE.LineSegments;
    positions: Float32Array;
  }

  let surfaceKeys: string[] = [];
  let modelKey = '',
    printMaterials: THREE.MeshPhysicalMaterial[] = [],
    baseMaterials: Partial<Record<DesignSurface, THREE.MeshStandardMaterial>> = {};
  let zipMaterials: Partial<Record<'teeth' | 'tape' | 'pull', THREE.MeshStandardMaterial>> = {};
  function draw() {
    if (!disposed && visible && !document.hidden) renderer.render(scene, camera);
  }
  function disposeModel() {
    cancelAnimationFrame(openingFrame);
    openingFrame = 0;
    stopTurn();
    modelRevision++;
    for (const cached of spreads.values())
      void cached
        .then((spread) => {
          if (spread.group.parent !== root) disposeGroup(spread.group);
        })
        .catch(() => {});
    spreads.clear();
    disposeGroup(root);
    textures.forEach((t) => t.dispose());
    textures = [];
    pageTextures.forEach((t) => t.dispose());
    pageTextures.clear();
    root.clear();
    targets = [];
    displayedPage = 0;
  }
  function disposeGroup(group: THREE.Group) {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
    const removed = new Set<THREE.Object3D>();
    group.traverse((o) => removed.add(o));
    targets = targets.filter((t) => !removed.has(t));
    if (group !== root) group.removeFromParent();
  }
  function stopTurn() {
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    if (turn) {
      turn.landing.visible = true;
      disposeGroup(turn.previous);
      disposeGroup(turn.group);
      turn.settle();
    }
    turn = null;
    if (latestInput && displayedPage) {
      const spread = binderSpread(displayedPage, latestInput.design.pageCount);
      stage.dataset.currentSpread = `${spread.left}-${spread.right}`;
      stage.dataset.currentPage = String(displayedPage);
    }
    stage.setAttribute('aria-busy', 'false');
  }
  function shape(w: number, h: number, r = 0.12) {
    const s = new THREE.Shape(),
      x = -w / 2,
      y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function geometry(w: number, h: number, depth: number, r = 0.12) {
    const g = new THREE.ExtrudeGeometry(shape(w, h, r), {
      depth,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: Math.min(0.012, depth * 0.2),
      bevelThickness: Math.min(0.006, depth * 0.2),
      curveSegments: 10,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  }
  function mesh(
    parent: THREE.Group,
    g: THREE.BufferGeometry,
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
    part?: BinderPart,
  ) {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    parent.add(o);
    if (part) {
      o.userData.part = part;
      targets.push(o);
    }
    return o;
  }
  const noise = document.createElement('canvas');
  noise.width = noise.height = 512;
  const nc = noise.getContext('2d')!,
    pixels = nc.createImageData(512, 512);
  let seed = 19;
  for (let n = 0; n < pixels.data.length; n += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    pixels.data[n] = pixels.data[n + 1] = pixels.data[n + 2] = 110 + (seed % 70);
    pixels.data[n + 3] = 255;
  }
  nc.putImageData(pixels, 0, 0);
  const grain = new THREE.CanvasTexture(noise);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(9, 12);
  function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    paint(canvas.getContext('2d')!);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  // Pocket film: a faint top-lit gloss, one soft vertical glare and a thin welded edge, like the 2D sleeves.
  const sheen = canvasTexture(256, 358, (ctx) => {
    const gloss = ctx.createLinearGradient(0, 0, 0, 358);
    gloss.addColorStop(0, 'rgba(255,255,255,.07)');
    gloss.addColorStop(0.45, 'rgba(255,255,255,.015)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, 256, 358);
    const glare = ctx.createLinearGradient(0, 24, 0, 300);
    glare.addColorStop(0, 'rgba(255,255,255,.16)');
    glare.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.filter = 'blur(6px)';
    ctx.fillStyle = glare;
    ctx.beginPath();
    ctx.roundRect(22, 22, 20, 290, 10);
    ctx.fill();
    ctx.filter = 'none';
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(3, 3, 250, 352, 10);
    ctx.stroke();
  });
  // A soft contact shadow under each cover, so the binder sits on something.
  const contact = canvasTexture(256, 256, (ctx) => {
    ctx.filter = 'blur(22px)';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.roundRect(48, 48, 160, 160, 18);
    ctx.fill();
  });
  let flapShadow: THREE.MeshBasicMaterial | null = null;
  function leather(color: string, smooth = false) {
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness: smooth ? 0.4 : 0.7,
      bumpMap: grain,
      bumpScale: smooth ? 0.003 : 0.014,
      clearcoat: 0.3,
      clearcoatRoughness: 0.45,
      side: THREE.DoubleSide,
    });
  }
  const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
  function image(src?: string | null, fallback?: string): Promise<HTMLImageElement | null> {
    if (!src) return Promise.resolve(null);
    if (!imageCache.has(src))
      imageCache.set(
        src,
        new Promise((resolve) => {
          const im = new Image();
          // Public assets are CORS-readable, so they can be drawn into WebGL and share the 2D binder's offline cache.
          if (src.startsWith(PUBLIC_CARD_IMAGE_BASE)) im.crossOrigin = 'anonymous';
          im.decoding = 'async';
          im.onload = () => resolve(im);
          im.onerror = () => {
            imageCache.delete(src);
            resolve(fallback ? image(fallback) : null);
          };
          im.src = src;
        }),
      );
    return imageCache.get(src)!;
  }
  async function surfaceTexture(input: RenderInput, surface: DesignSurface) {
    const d = input.design,
      s = d.surfaces[surface],
      canvas = document.createElement('canvas');
    // Covers follow the layout's footprint so artwork and words never stretch.
    const cover = binderPage(d.rows, d.cols),
      aspect = cover.coverWidth / cover.coverHeight;
    const width = surface === 'spine' ? 256 : Math.round(1024 * aspect),
      height = 1024;
    canvas.width = surface === 'spine' ? 512 : Math.round(2732 * aspect);
    canvas.height = surface === 'spine' ? 2048 : 2732;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = s.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const im = await image(s.artwork ? (input.artwork[s.artwork] ?? s.artwork) : null);
    if (!disposed && s.artwork && !im) fail('One artwork image could not load. Your saved artwork is unchanged.');
    if (im) {
      const r = artworkRectangle(im.naturalWidth, im.naturalHeight, canvas.width, canvas.height, s.frame);
      ctx.drawImage(im, r.x, r.y, r.width, r.height);
    }
    ctx.save();
    ctx.scale(canvas.width / width, canvas.height / height);
    ctx.fillStyle = d.ink;
    ctx.font = `600 ${surface === 'spine' ? 48 : d.textSize}px ${d.font}`;
    if (surface === 'spine') {
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(s.words, 0, 16, height * 0.8);
      ctx.restore();
    } else s.words.split('\n').forEach((line, i) => ctx.fillText(line, 50, 130 + i * d.textSize * 1.15, width - 100));
    if (surface === 'lining' && d.stats !== 'off' && !input.stats.unavailable) {
      const rows = [
        `Cards owned   ${input.stats.placed}`,
        `Wanted   ${input.stats.wanted}`,
        ...(d.stats === 'full'
          ? [
              `Pages   ${d.pageCount}`,
              `Pocket faces   ${input.stats.capacity}`,
              `Preview filled   ${input.stats.filled}%`,
            ]
          : []),
      ];
      ctx.fillStyle = '#16171be8';
      ctx.beginPath();
      ctx.roundRect(45, 560, Math.min(width - 90, 678), 100 + rows.length * 50, 18);
      ctx.fill();
      ctx.fillStyle = '#bdbdbd';
      ctx.font = '500 21px sans-serif';
      ctx.fillText(input.stats.sample ? 'SAMPLE BINDER · NOT YOUR COLLECTION' : 'YOUR BINDER', 75, 607);
      ctx.fillStyle = '#fff';
      ctx.font = '500 30px sans-serif';
      rows.forEach((text, i) => ctx.fillText(text, 75, 660 + i * 50));
    }
    if (surface === 'lining' && input.stats.unavailable) {
      ctx.fillStyle = d.ink;
      ctx.font = '500 28px sans-serif';
      ctx.fillText('Collection unavailable · refresh to retry', 45, 620, width - 90);
    }
    ctx.restore();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    return tex;
  }
  function updateBinding(angle: number) {
    if (!binding) return;
    const r = radius,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const x = layout.hingeX,
      curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(x, 0, -r),
        new THREE.Vector3(x - r, 0, -r),
        new THREE.Vector3(x - r * c + r * s, 0, r * s + r * c),
        new THREE.Vector3(x + r * s, 0, r * c),
      );
    const p = binding.geometry.attributes.position;
    for (let row = 0; row < 2; row++)
      for (let n = 0; n <= 32; n++) {
        const v = curve.getPoint(n / 32);
        p.setXYZ(row * 33 + n, v.x, ((row ? 1 : -1) * layout.coverHeight) / 2, v.z);
      }
    p.needsUpdate = true;
    binding.geometry.computeVertexNormals();
    binding.geometry.computeBoundingSphere();
  }
  function fitView() {
    const frame = binderCameraFrame(view, stage.clientWidth, stage.clientHeight, radius, layout);
    controls.target.set(...frame.target);
    key.target.position.set(...frame.target);
    camera.position.set(...frame.position);
    fittedDistance = camera.position.distanceTo(controls.target);
  }
  function setView(next: BinderView, render = true, animate = true) {
    const previousView = view,
      targetOpening = next === 'inside' ? -Math.PI : 0;
    if (render && next !== 'inside') stopTurn();
    view = next;
    const applyOpening = (angle: number) => {
      opening = angle;
      hinge.rotation.y = angle;
      if (flapShadow) flapShadow.opacity = 0.55 * (-angle / Math.PI) ** 2;
      updateBinding(angle);
    };
    if (render) {
      if (next !== previousView || !openingFrame) {
        cancelAnimationFrame(openingFrame);
        openingFrame = 0;
        if (animate && !motion.matches && Math.abs(opening - targetOpening) > 0.001) {
          const from = opening,
            start = performance.now();
          stage.dataset.openingState = next === 'inside' ? 'opening' : 'closing';
          closedPages.visible = false;
          openPages.visible = true;
          const tick = (time: number) => {
            if (disposed) return;
            const progress = Math.min(1, (time - start) / 600),
              eased = progress * progress * (3 - 2 * progress);
            applyOpening(from + (targetOpening - from) * eased);
            draw();
            if (progress < 1 && !document.hidden) {
              openingFrame = requestAnimationFrame(tick);
              return;
            }
            applyOpening(targetOpening);
            closedPages.visible = next !== 'inside';
            openPages.visible = next === 'inside';
            openingFrame = 0;
            stage.dataset.openingState = 'settled';
            draw();
          };
          openingFrame = requestAnimationFrame(tick);
        } else {
          applyOpening(targetOpening);
          closedPages.visible = next !== 'inside';
          openPages.visible = next === 'inside';
          stage.dataset.openingState = 'settled';
        }
      }
    } else {
      applyOpening(targetOpening);
      closedPages.visible = next !== 'inside';
      openPages.visible = next === 'inside';
    }
    fitView();
    controls.update();
    if (render) draw();
  }

  function deform(objects: Deformable[], progress: number) {
    for (const { object, positions } of objects) {
      const attribute = object.geometry.attributes.position;
      for (let i = 0; i < attribute.count; i++) {
        const p = pageTurnPoint(positions[i * 3], positions[i * 3 + 2], layout.width + layout.inset, progress);
        attribute.setXYZ(i, p.x, positions[i * 3 + 1], p.z);
      }
      attribute.needsUpdate = true;
      if (object instanceof THREE.Mesh) object.geometry.computeVertexNormals();
      object.geometry.computeBoundingSphere();
    }
  }
  function thinPageGeometry(w: number, h: number, depth: number) {
    const g = new THREE.ExtrudeGeometry(shape(w, h, 0.035), { depth, bevelEnabled: false, curveSegments: 8 });
    g.translate(0, 0, -depth / 2);
    return g;
  }
  function seam(parent: THREE.Group, w: number, h: number, x: number, z: number) {
    const points = shape(w, h, 0.1).getPoints(80),
      vertices = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        length = a.distanceTo(b),
        steps = Math.max(1, Math.ceil(length / 0.035));
      for (let n = 0; n < steps; n++) {
        const start = a.clone().lerp(b, n / steps),
          end = a.clone().lerp(b, (n + 0.55) / steps);
        vertices.push(start.x + x, start.y, z, end.x + x, end.y, z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    parent.add(
      new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#d9d7d0', transparent: true, opacity: 0.23 })),
    );
  }
  async function makeFace(
    input: RenderInput,
    face: number,
    side: 1 | -1,
    parent: THREE.Group,
    objects: Deformable[],
    token: number,
  ) {
    if (!face || face > input.design.pageCount) return;
    const d = input.design,
      count = d.rows * d.cols,
      start = (face - 1) * count;
    const cards = input.cards.flatMap((card, i) => {
      const slot = card.slot ?? i;
      return slot >= start && slot < start + count ? [{ card, slot }] : [];
    });
    const loaded = await Promise.all(
      cards.map(async (c) => ({ ...c, image: await image(c.card.image, c.card.fallback) })),
    );
    if (disposed || token !== modelRevision) return;
    parent.userData.cardCount = cards.length;
    parent.userData.loadedCardCount = loaded.filter((card) => card.image).length;
    const attach = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      (geometry.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      const o = mesh(parent, geometry, material, 0, 0, 0, 'pages');
      objects.push({ object: o, positions: new Float32Array(geometry.attributes.position.array) });
      return o;
    };
    const sided = side === 1 ? THREE.FrontSide : THREE.BackSide,
      color = input.design.pageColors[String(face)] ?? input.design.pageColor;
    const paper = new THREE.PlaneGeometry(layout.width, layout.height, 24, 8);
    paper.translate(layout.inset + layout.width / 2, 0, (side * BINDER_LAYERS.backing) / 2);
    attach(paper, new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: sided }));
    // The first card for each pocket, as find() would pick it.
    const byPocket = new Map<number, (typeof loaded)[number]>();
    for (const c of loaded) if (!byPocket.has(c.slot - start)) byPocket.set(c.slot - start, c);
    for (let i = 0; i < count; i++) {
      const { x, y, w, h } = binderPocket(d.rows, d.cols, i, side);
      const card = byPocket.get(i),
        im = card?.image;
      if (card && (im || card.card.presentation)) {
        const presentation = card.card.presentation;
        const textureKey = studioCardTextureKey(card.card);
        let tex = pageTextures.get(textureKey);
        if (!tex) {
          const canvas = document.createElement('canvas'),
            scale = im ? Math.min(1, 2048 / Math.max(im.naturalWidth, im.naturalHeight)) : 1;
          canvas.width = im ? Math.max(1, Math.round(im.naturalWidth * scale)) : 252;
          canvas.height = im ? Math.max(1, Math.round(im.naturalHeight * scale)) : 352;
          const ctx = canvas.getContext('2d')!;
          ctx.beginPath();
          ctx.roundRect(0, 0, canvas.width, canvas.height, canvas.width * 0.0476);
          ctx.clip();
          if (im) {
            ctx.filter = presentation === 'target' ? 'grayscale(1) opacity(.45)' : 'none';
            ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
            ctx.filter = 'none';
          }
          if (presentation && (presentation !== 'owned' || !im)) {
            const font = Math.max(12, Math.round(canvas.width / 15));
            ctx.fillStyle = im ? 'rgba(0,0,0,.85)' : '#24262c';
            ctx.fillRect(0, im ? canvas.height - font * 4 : 0, canvas.width, im ? font * 4 : canvas.height);
            ctx.fillStyle = '#f4f3f8';
            ctx.font = `${font}px sans-serif`;
            ctx.textAlign = 'center';
            const words = card.card.name.split(', ');
            words
              .slice(0, 2)
              .forEach((line, index) =>
                ctx.fillText(
                  line,
                  canvas.width / 2,
                  im ? canvas.height - font * (2 - index) : canvas.height / 2 + index * font * 1.5,
                  canvas.width - 16,
                ),
              );
          }
          tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
          tex.userData.imageSource = card.card.image;
          pageTextures.set(textureKey, tex);
          renderer.initTexture(tex);
        }
        const cardW = Math.min(w * 0.92, (h * 0.92 * 63) / 88),
          g = new THREE.PlaneGeometry(cardW, (cardW * 88) / 63, 8, 4);
        g.translate(x, y, side * (BINDER_LAYERS.backing / 2 + BINDER_LAYERS.card));
        if (side === -1) {
          const uv = g.attributes.uv;
          for (let n = 0; n < uv.count; n++) uv.setX(n, 1 - uv.getX(n));
        }
        attach(
          g,
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.01, side: sided, toneMapped: false }),
        );
      }
      const filmZ = side * (BINDER_LAYERS.backing / 2 + BINDER_LAYERS.card + BINDER_LAYERS.film);
      const film = new THREE.PlaneGeometry(w * 0.96, h * 0.97, 8, 4);
      film.translate(x, y, filmZ);
      if (side === -1) {
        const uv = film.attributes.uv;
        for (let n = 0; n < uv.count; n++) uv.setX(n, 1 - uv.getX(n));
      }
      const pocket = attach(
        film,
        new THREE.MeshBasicMaterial({
          map: sheen,
          transparent: true,
          depthWrite: false,
          side: sided,
          toneMapped: false,
        }),
      );
      pocket.userData.slot = start + i;
    }
  }
  async function pagePanel(
    input: RenderInput,
    face: number,
    left: boolean,
    z: number,
    parent: THREE.Group,
    token: number,
  ) {
    const group = new THREE.Group(),
      objects: Deformable[] = [];
    group.position.set(layout.hingeX, 0, z);
    parent.add(group);
    await makeFace(input, face, left ? -1 : 1, group, objects, token);
    deform(objects, left ? 1 : 0);
    return group;
  }
  function cachedSpread(input: RenderInput, page: number) {
    const existing = spreads.get(page);
    if (existing) return existing;
    const token = modelRevision,
      d = input.design,
      { stack, leaves } = binderDimensions(d.pageCount),
      next = binderSpread(page, d.pageCount);
    const group = new THREE.Group();
    const promise = (async () => {
      // shortcut: extreme 1x1 layouts use representative thin layers across the full loaded-leaf depth.
      const layers = Math.min(leaves, 120);
      for (let n = 0; n < layers; n++) {
        const leaf = Math.floor((n * leaves) / layers),
          left = leaf < next.turnedLeaves,
          z = left ? -stack / 2 + leaf * BINDER_LAYERS.leafPitch : stack / 2 - leaf * BINDER_LAYERS.leafPitch;
        const o = mesh(
          group,
          thinPageGeometry(layout.width, layout.height, BINDER_LAYERS.backing),
          new THREE.MeshStandardMaterial({ color: d.pageColors[String(leaf * 2 + 1)] ?? d.pageColor, roughness: 0.9 }),
          left ? layout.hingeX - layout.inset - layout.width / 2 : layout.hingeX + layout.inset + layout.width / 2,
          0,
          z,
          'pages',
        );
        if (left) o.rotation.y = Math.PI;
      }
      const leftZ = -stack / 2 + next.turnedLeaves * BINDER_LAYERS.leafPitch,
        rightZ = stack / 2 - next.turnedLeaves * BINDER_LAYERS.leafPitch;
      const [left, right] = await Promise.all([
        pagePanel(input, next.left, true, leftZ, group, token),
        pagePanel(input, next.right, false, rightZ, group, token),
      ]);
      if (disposed || token !== modelRevision) {
        disposeGroup(group);
        return { group, left, right, leftZ, rightZ };
      }
      return { group, left, right, leftZ, rightZ };
    })().catch((error) => {
      disposeGroup(group);
      throw error;
    });
    spreads.set(page, promise);
    return promise;
  }
  function preloadSpreads(input: RenderInput) {
    const pages = new Set([
      input.page,
      binderTurnPage(input.page, input.design.pageCount, -1),
      binderTurnPage(input.page, input.design.pageCount, 1),
    ]);
    for (const [page, cached] of spreads)
      if (!pages.has(page)) {
        spreads.delete(page);
        void cached.then((spread) => disposeGroup(spread.group)).catch(() => {});
      }
    const count = input.design.rows * input.design.cols,
      faces = new Set<number>();
    for (const page of pages) {
      const spread = binderSpread(page, input.design.pageCount);
      faces.add(spread.left);
      faces.add(spread.right);
      void cachedSpread(input, page).catch(() => {
        spreads.delete(page);
        if (!disposed) fail('An adjacent page could not preload. Try turning the page again.');
      });
    }
    const adjacent = input.cards.filter((c, i) => faces.has(Math.floor((c.slot ?? i) / count) + 1)),
      keys = new Set(adjacent.map(studioCardTextureKey)),
      images = new Set(adjacent.map((c) => c.image));
    for (const [key, texture] of pageTextures)
      if (!keys.has(key)) {
        const src = texture.userData.imageSource ?? key;
        texture.dispose();
        pageTextures.delete(key);
        if (!images.has(src)) imageCache.delete(src);
      }
    stage.dataset.preloadedSpreads = [...pages].join(',');
  }
  async function updatePages(input: RenderInput, token: number) {
    const d = input.design,
      { stack } = binderDimensions(d.pageCount),
      next = binderSpread(input.page, d.pageCount),
      previous = binderSpread(displayedPage || input.page, d.pageCount);
    const changing =
      displayedPage !== 0 &&
      Math.abs(next.turnedLeaves - previous.turnedLeaves) === 1 &&
      view === 'inside' &&
      !openingFrame &&
      !motion.matches;
    stopTurn();
    const outgoing = openPages;
    stage.setAttribute('aria-busy', 'true');
    const { group: pageRoot, left, right, leftZ, rightZ } = await cachedSpread(input, input.page);
    if (disposed || token !== generation) return;
    const settled = () => {
      displayedPage = input.page;
      latestInput = input;
      stage.dataset.leftCards = String(left.userData.loadedCardCount ?? 0);
      stage.dataset.rightCards = String(right.userData.loadedCardCount ?? 0);
      stage.dataset.currentSpread = `${next.left}-${next.right}`;
      stage.dataset.currentPage = String(input.page);
      stage.setAttribute('aria-busy', 'false');
    };
    if (!changing) {
      outgoing.removeFromParent();
      openPages = pageRoot;
      root.add(pageRoot);
      pageRoot.visible = view === 'inside';
      settled();
      preloadSpreads(input);
      draw();
      return;
    }
    const forward = next.turnedLeaves > previous.turnedLeaves,
      front = forward ? previous.right : next.right,
      back = front + 1;
    const moving = new THREE.Group(),
      objects: Deformable[] = [];
    moving.position.set(layout.hingeX, 0, 0);
    pageRoot.add(moving);
    await Promise.all([
      makeFace(input, front, 1, moving, objects, modelRevision),
      makeFace(input, back, -1, moving, objects, modelRevision),
    ]);
    const priorZ = forward
      ? -stack / 2 + previous.turnedLeaves * BINDER_LAYERS.leafPitch
      : stack / 2 - previous.turnedLeaves * BINDER_LAYERS.leafPitch;
    const prior = await pagePanel(
      input,
      forward ? previous.left : previous.right,
      forward,
      priorZ,
      pageRoot,
      modelRevision,
    );
    if (disposed || token !== generation) {
      disposeGroup(prior);
      disposeGroup(moving);
      return;
    }
    outgoing.removeFromParent();
    openPages = pageRoot;
    root.add(pageRoot);
    pageRoot.visible = view === 'inside';
    displayedPage = input.page;
    latestInput = input;
    const landing = forward ? left : right;
    landing.visible = false;
    turn = {
      group: moving,
      deform: objects,
      start: performance.now(),
      forward,
      rightZ: forward ? stack / 2 - previous.turnedLeaves * BINDER_LAYERS.leafPitch : rightZ,
      leftZ: forward ? leftZ : -stack / 2 + previous.turnedLeaves * BINDER_LAYERS.leafPitch,
      landing,
      previous: prior,
      token,
      settle: () => {
        if (!disposed) {
          settled();
          preloadSpreads(input);
        }
      },
    };
    stage.setAttribute('aria-busy', 'true');
    const tick = (time: number) => {
      const active = turn;
      if (!active) return;
      if (disposed || active.token !== generation) {
        stopTurn();
        return;
      }
      const t = Math.min(1, (time - active.start) / 680),
        eased = t * t * (3 - 2 * t),
        progress = active.forward ? eased : 1 - eased;
      active.group.position.z = active.rightZ + (active.leftZ - active.rightZ) * progress;
      deform(active.deform, progress);
      draw();
      if (t < 1 && !document.hidden) {
        frameRequest = requestAnimationFrame(tick);
        return;
      }
      active.landing.visible = true;
      disposeGroup(active.previous);
      disposeGroup(active.group);
      turn = null;
      frameRequest = 0;
      active.settle();
      draw();
    };
    frameRequest = requestAnimationFrame(tick);
  }
  async function build(input: RenderInput) {
    const token = ++generation,
      d = input.design,
      surfaces: DesignSurface[] = ['cover', 'back', 'spine', 'lining'],
      previousMaps = textures.slice(0, 4);
    const keys = surfaces.map((surface) =>
      JSON.stringify({
        surface: d.surfaces[surface],
        layout: [d.rows, d.cols],
        ink: d.ink,
        font: d.font,
        textSize: d.textSize,
        artwork: d.surfaces[surface].artwork ? input.artwork[d.surfaces[surface].artwork!] : null,
        ...(surface === 'lining'
          ? { statsMode: d.stats, stats: d.stats !== 'off' || input.stats.unavailable ? input.stats : null }
          : {}),
      }),
    );
    const maps = await Promise.all(
      surfaces.map((surface, i) =>
        keys[i] === surfaceKeys[i] && previousMaps[i] ? previousMaps[i] : surfaceTexture(input, surface),
      ),
    );
    if (disposed || token !== generation) {
      maps.forEach((t) => {
        if (!previousMaps.includes(t)) t.dispose();
      });
      return;
    }
    previousMaps.forEach((t) => {
      if (!maps.includes(t)) t.dispose();
    });
    surfaceKeys = keys;
    const nextKey = JSON.stringify({
      pageCount: d.pageCount,
      rows: d.rows,
      cols: d.cols,
      pageColor: d.pageColor,
      pageColors: d.pageColors,
      zipType: d.zip.type,
      material: d.material,
      cards: input.cards,
    });
    if (nextKey === modelKey && printMaterials.length === 4) {
      textures.splice(0, 4, ...maps);
      printMaterials.forEach((m, i) => {
        if (m.map !== maps[i]) {
          m.map = maps[i];
        }
      });
      for (const s of ['cover', 'back', 'lining'] as const) baseMaterials[s]?.color.set(d.surfaces[s].color);
      for (const part of ['teeth', 'tape', 'pull'] as const) zipMaterials[part]?.color.set(d.zip[part]);
      if (input.page !== displayedPage) await updatePages(input, token);
      else {
        stopTurn();
        draw();
      }
      return;
    }
    modelKey = nextKey;
    textures = [];
    disposeModel();
    printMaterials = [];
    baseMaterials = {};
    textures.push(...maps);
    layout = binderPage(d.rows, d.cols);
    const { coverWidth: cw, coverHeight: ch } = layout,
      half = cw / 2;
    hinge = new THREE.Group();
    hinge.position.x = layout.hingeX;
    root.add(hinge);
    const { stack, leaves, coverZ } = binderDimensions(d.pageCount);
    radius = coverZ;
    baseMaterials.cover = leather(d.surfaces.cover.color, d.material === 'smooth');
    mesh(hinge, geometry(cw, ch, BINDER_LAYERS.cover), baseMaterials.cover, half, 0, coverZ, 'cover');
    baseMaterials.back = leather(d.surfaces.back.color, d.material === 'smooth');
    mesh(root, geometry(cw, ch, BINDER_LAYERS.cover), baseMaterials.back, 0, 0, -coverZ, 'back');
    const bg = new THREE.BufferGeometry(),
      pos = [],
      uv = [],
      indices = [];
    for (let row = 0; row < 2; row++)
      for (let n = 0; n <= 32; n++) {
        pos.push(0, ((row ? 1 : -1) * ch) / 2, 0);
        uv.push(n / 32, row);
      }
    for (let n = 0; n < 32; n++) {
      const a = n,
        b = n + 1,
        c = n + 33,
        e = n + 34;
      indices.push(a, b, e, a, e, c);
    }
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    bg.setIndex(indices);
    const bm = leather('#ffffff');
    bm.map = maps[2];
    printMaterials[2] = bm;
    binding = mesh(root, bg, bm, 0, 0, 0, 'spine') as typeof binding;
    updateBinding(opening);
    function printed(
      parent: THREE.Group,
      w: number,
      h: number,
      x: number,
      z: number,
      map: THREE.Texture,
      part: DesignSurface,
      rotate = 0,
    ) {
      const g = new THREE.ShapeGeometry(shape(w, h)),
        p = g.attributes.position,
        u = g.attributes.uv;
      for (let i = 0; i < p.count; i++) u.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
      const m = leather('#ffffff', d.material === 'smooth');
      m.map = map;
      printMaterials[{ cover: 0, back: 1, spine: 2, lining: 3 }[part]] = m;
      const o = mesh(parent, g, m, x, 0, z, part);
      o.rotation.y = rotate;
    }
    printed(hinge, cw, ch, half, coverZ + 0.024, maps[0], 'cover');
    printed(root, cw, ch, 0, -coverZ - 0.024, maps[1], 'back', Math.PI);
    printed(hinge, cw - 0.14, ch - 0.16, half, coverZ - 0.024, maps[3], 'lining', Math.PI);
    seam(hinge, cw - 0.11, ch - 0.12, half, coverZ + 0.025);
    seam(root, cw - 0.11, ch - 0.12, 0, -coverZ - 0.025);
    baseMaterials.lining = new THREE.MeshStandardMaterial({ color: d.surfaces.lining.color, roughness: 0.9 });
    mesh(root, thinPageGeometry(cw - 0.14, ch - 0.16, 0.002), baseMaterials.lining, 0, 0, -coverZ + 0.024, 'lining');
    const shadowGeometry = () => new THREE.PlaneGeometry(cw * 1.6, ch * 1.6);
    const shadowMaterial = (opacity: number) =>
      new THREE.MeshBasicMaterial({ map: contact, transparent: true, depthWrite: false, opacity });
    mesh(root, shadowGeometry(), shadowMaterial(0.55), 0, 0, -coverZ - 0.04);
    flapShadow = shadowMaterial(0);
    // Faces away from the camera while closed; lies under the open front cover.
    mesh(hinge, shadowGeometry(), flapShadow, half, 0, coverZ + 0.04).rotation.y = Math.PI;
    closedPages = new THREE.Group();
    root.add(closedPages);
    const layerCount = Math.min(leaves, 120);
    for (let n = 0; n < layerCount; n++) {
      const leaf = Math.floor((n * leaves) / layerCount),
        z = stack / 2 - leaf * BINDER_LAYERS.leafPitch;
      mesh(
        closedPages,
        thinPageGeometry(layout.width, layout.height, BINDER_LAYERS.backing),
        new THREE.MeshStandardMaterial({ color: d.pageColors[String(leaf * 2 + 1)] ?? d.pageColor, roughness: 0.9 }),
        layout.hingeX + layout.inset + layout.width / 2,
        0,
        z,
        'pages',
      );
    }
    const tape = leather(d.zip.tape, true),
      teeth = new THREE.MeshStandardMaterial({
        color: d.zip.teeth,
        metalness: d.zip.type === 'metal' ? 0.75 : 0.02,
        roughness: d.zip.type === 'metal' ? 0.3 : 0.8,
      });
    const pullMaterial = new THREE.MeshStandardMaterial({ color: d.zip.pull, metalness: 0.85, roughness: 0.25 });
    zipMaterials = { tape, teeth, pull: pullMaterial };
    // Sewn gussets bridge cover rims to a shared centre zipper seam when closed.
    for (const [parent, x, sign] of [
      [root, 0, -1],
      [hinge, half, 1],
    ] as const) {
      const seamZ = sign * 0.003,
        outer = shape(cw - 0.06, ch - 0.08, 0.13).getPoints(32),
        inner = shape(cw - 0.1, ch - 0.12, 0.13).getPoints(32),
        vertices = [],
        uv = [],
        indices = [];
      for (let row = 0; row < 4; row++)
        for (let n = 0; n < outer.length; n++) {
          const t = row / 3,
            p = outer[n].clone().lerp(inner[n], t),
            bulge = 0.012 * Math.sin(Math.PI * t);
          vertices.push(
            p.x + x + Math.sign(p.x) * bulge,
            p.y + Math.sign(p.y) * bulge,
            sign * (coverZ - 0.006) * (1 - t) + seamZ * t,
          );
          uv.push(n / (outer.length - 1), t);
        }
      for (let row = 0; row < 3; row++)
        for (let n = 0; n < outer.length - 1; n++) {
          const a = row * outer.length + n,
            b = a + 1,
            c = a + outer.length,
            e = c + 1;
          indices.push(a, b, e, a, e, c);
        }
      const gusset = new THREE.BufferGeometry();
      gusset.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      gusset.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      gusset.setIndex(indices);
      gusset.computeVertexNormals();
      mesh(parent, gusset, tape, 0, 0, 0, 'zip');
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < inner.length; i++)
        path.add(
          new THREE.LineCurve3(
            new THREE.Vector3(inner[i - 1].x + x, inner[i - 1].y, seamZ),
            new THREE.Vector3(inner[i].x + x, inner[i].y, seamZ),
          ),
        );
      // Teeth keep the 3x3 binder's spacing on any cover size.
      const n = Math.round(((d.zip.type === 'metal' ? 420 : 560) * (cw + ch - 0.22)) / 5.88),
        inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.014, 0.01, 0.009), teeth, n),
        matrix = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const t = (i + (sign === 1 ? 0.5 : 0)) / n;
        matrix.compose(
          path.getPointAt(t),
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            Math.atan2(path.getTangentAt(t).y, path.getTangentAt(t).x),
          ),
          new THREE.Vector3(1, 1, 1),
        );
        inst.setMatrixAt(i, matrix);
      }
      inst.userData.part = 'zip';
      targets.push(inst);
      parent.add(inst);
    }
    const pull = mesh(root, geometry(0.08, 0.23, 0.016, 0.025), pullMaterial, half - 0.03, 0.32 - ch / 2, 0, 'zip');
    pull.rotation.z = 0.2;
    mesh(root, new THREE.TorusGeometry(0.027, 0.007, 8, 18), pullMaterial, half - 0.04, 0.46 - ch / 2, 0, 'zip');
    setView(view, true, false);
    await updatePages(input, token);
  }
  const resize = () => {
    renderer.setSize(stage.clientWidth, stage.clientHeight, false);
    camera.aspect = stage.clientWidth / stage.clientHeight;
    camera.updateProjectionMatrix();
    fitView();
    controls.update();
    draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  const intersection = new IntersectionObserver((e) => {
    visible = e[0].isIntersecting;
    draw();
  });
  intersection.observe(stage);
  const onVisible = () => draw();
  document.addEventListener('visibilitychange', onVisible);
  controls.addEventListener('change', draw);
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2(),
    tap = createBinderTapTracker(),
    swipe = createBinderSwipeTracker();
  let tapped = false;
  const pointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const paging = e.pointerType === 'touch' && view === 'inside' && Boolean(onPageTurn) && !zoomed();
    controls.touches.ONE = paging ? null : zoomed() ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    controls.mouseButtons.LEFT = paging ? null : zoomed() ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    tapped = false;
    tap.down(e);
    swipe.down(e, paging);
    renderer.domElement.setPointerCapture(e.pointerId);
  };
  const pointerMove = (e: PointerEvent) => tap.move(e);
  const pointerCancel = (e: PointerEvent) => {
    tapped = false;
    tap.cancel(e);
    swipe.cancel(e);
  };
  // Implicit capture loss follows pointerup, so preserve its completed tap for the click.
  const lostCapture = (e: PointerEvent) => {
    tap.cancel(e);
    swipe.cancel(e);
  };
  const pointerUp = (e: PointerEvent) => {
    const direction = swipe.up(e);
    tapped = tap.up(e);
    if (direction) {
      tapped = false;
      if (!openingFrame) onPageTurn?.(direction);
    }
  };
  const click = (e: MouseEvent) => {
    if (!tapped) return;
    tapped = false;
    e.preventDefault();
    e.stopPropagation();
    if (turn || openingFrame || stage.getAttribute('aria-busy') === 'true') return;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, (-(e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hittable = targets.filter((object) => {
      for (let node: THREE.Object3D | null = object; node; node = node.parent) {
        if (!node.visible) return false;
        if (node === root) return true;
      }
      return false;
    });
    const hit = raycaster.intersectObjects(hittable, false)[0];
    if (hit) {
      if (typeof hit.object.userData.slot === 'number' && onSlotSelect) {
        onSlotSelect(hit.object.userData.slot);
        return;
      }
      if (hit.object.userData.part === 'pages' && view === 'inside' && onPageTurn) {
        if (!turn && !openingFrame) onPageTurn(hit.point.x > layout.hingeX ? 1 : -1);
      } else select(hit.object.userData.part as BinderPart);
    }
  };
  const lost = (e: Event) => {
    e.preventDefault();
    fail('3D is unavailable. Your draft can still be edited and saved. Reload to restore the preview.');
  };
  renderer.domElement.addEventListener('pointerdown', pointerDown, true);
  document.addEventListener('pointermove', pointerMove);
  document.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('click', click);
  document.addEventListener('pointercancel', pointerCancel);
  renderer.domElement.addEventListener('lostpointercapture', lostCapture);
  renderer.domElement.addEventListener('webglcontextlost', lost);
  resize();
  setView('front');
  return {
    update(input: RenderInput) {
      const key = JSON.stringify(input);
      if (key === updateKey) return;
      updateKey = key;
      clearTimeout(pending);
      stopTurn();
      stage.setAttribute('aria-busy', 'true');
      generation++;
      pending = setTimeout(() => {
        build(input).catch(() => {
          if (key === updateKey) updateKey = null;
          stage.setAttribute('aria-busy', 'false');
          if (!disposed) fail('The 3D preview could not update. Your draft is still here.');
        });
      }, 100);
    },
    setView,
    reset() {
      setView(view);
    },
    dispose() {
      disposed = true;
      generation++;
      cancelAnimationFrame(openingFrame);
      cancelAnimationFrame(frameRequest);
      clearTimeout(pending);
      observer.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('pointerup', pointerUp);
      document.removeEventListener('pointercancel', pointerCancel);
      controls.dispose();
      disposeModel();
      grain.dispose();
      sheen.dispose();
      contact.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      imageCache.clear();
    },
  };
}
