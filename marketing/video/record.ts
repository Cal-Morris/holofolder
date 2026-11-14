// Records short vertical demo videos of Holo Folder from an iOS Simulator and composites them for TikTok/Reels.
// Usage: bun marketing/video/record.ts [clip…] [--probe]
//   --probe  run each clip's steps without recording and save a screenshot after every step (for tuning coordinates)
// Needs Xcode (simctl), AXe (`brew install cameroncooke/axe/axe`) and ffmpeg. See marketing/video/README.md.
/* oxlint-disable react-doctor/async-await-in-loop -- every step drives one simulator, strictly in order */
import { chromium } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const OUT = join(HERE, 'out');
const SIM_NAME = 'Holo Folder Video';
const SIM_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max';
// iPhone 18 Pro Max: 440x956 pt at 3x. Every coordinate below is in points on this device.
// ponytail: coordinates are hand-tuned for this device and the current UI; rerun with --probe after UI changes.
const PT = { w: 440, h: 956, scale: 3 };
const CROP_PT = 904; // keep status bar, app and dock; drop Safari's "holofolder.com" pill under the dock
const W = 1080;
const H = 1920;
const TOP = 330; // caption band above the phone screen
const SCREEN_H = H - TOP - 70;
const SCREEN_W = Math.round((PT.w * SCREEN_H) / CROP_PT / 2) * 2;
const SCREEN_X = (W - SCREEN_W) / 2;
const K = SCREEN_W / PT.w; // output px per point
const END_CARD_S = 2.4;
const UTM = (source: string) => `https://holofolder.com/app?utm_source=${source}&utm_medium=social&utm_campaign=social`;

type Step =
  | { tap: [number, number]; hold?: number; after?: number }
  | { swipe: [number, number, number, number]; dur: number; after?: number }
  | { type: string; after?: number }
  | { keys: number[]; after?: number } // HID keycodes, e.g. 42 = backspace
  | { wait: number }
  | { caption: string };

interface Clip {
  name: string;
  url: string;
  hook: string;
  setup?: Step[]; // runs before recording starts
  steps: Step[];
  post: string;
  tags: string;
}

const DOCK = {
  search: [52, 862],
  binder: [136, 862],
  list: [220, 862],
  wanted: [304, 862],
  browse: [388, 862],
} as const;

const CLIPS: Clip[] = [
  {
    name: 'binder-prices',
    url: 'https://holofolder.com/@showcase/pikachu-party',
    hook: 'Your binder, page by page, priced in pounds',
    steps: [
      { wait: 2.2 },
      { caption: 'Every pocket shows what the card is worth' },
      { wait: 1.6 },
      { caption: 'Tap a card for the low and market price' },
      { tap: [169, 445], after: 2.6 },
      { caption: 'with the source and how sure the price is' },
      { wait: 2.6 },
      { swipe: [220, 296, 220, 820], dur: 0.3, after: 1.0 },
      { caption: 'Every card, the same way' },
      { tap: [62, 585], after: 2.2 },
      { swipe: [220, 296, 220, 820], dur: 0.3, after: 1.4 },
    ],
    post: 'A Pikachu binder from our public showcase, every pocket priced in pounds. Tap any card for the low and market price, with the source and how confident the price is.',
    tags: '#pokemoncards #pokemontcg #pokemonbinder #pikachu #pokemoncollection #tcguk',
  },
  {
    name: 'delta-reign-top-value',
    url: 'https://holofolder.com/@showcase/pikachu-party',
    hook: 'Delta Reign: which cards are worth the most?',
    steps: [
      { wait: 1.6 },
      { caption: 'Open Browse, then any set' },
      { tap: [...DOCK.browse], after: 1.6 },
      { tap: [118, 500], after: 2.2 },
      { caption: 'Top value ranks the set by price, in pounds' },
      { swipe: [220, 760, 220, 330], dur: 1.4, after: 2.6 },
      { caption: 'Each price shows where it came from and when' },
      { swipe: [220, 700, 220, 420], dur: 0.7, after: 3.0 },
    ],
    post: 'Delta Reign, ranked by value. Open any set in Holo Folder and Top value lists its priciest printings in pounds, with the source and date for each price.',
    tags: '#deltareign #pokemoncards #pokemontcg #megaevolution #pokemoncollection #tcguk',
  },
  {
    name: 'card-show-price-check',
    url: 'https://holofolder.com/@showcase/pikachu-party',
    hook: "POV: you're at a card show",
    setup: [
      // Turn on Show mode before recording: Search, Quick mode, Show mode, then close it.
      { tap: [...DOCK.search], after: 1.5 },
      { tap: [308, 105], after: 1.5 },
      { tap: [322, 358], after: 2.0 },
      { tap: [390, 103], after: 1.5 },
    ],
    steps: [
      { wait: 2.0 },
      { caption: 'Show mode keeps a price check one tap away' },
      { tap: [...DOCK.search], after: 1.4 },
      { caption: 'Search the card on the table' },
      { tap: [160, 840], after: 0.6 },
      { type: 'Umbreon ex 161', after: 2.4 },
      { tap: [200, 649], after: 2.4 },
      { caption: 'Type what they are asking' },
      { type: '850', after: 2.8 },
      { caption: "If it's too steep, it tells you that too" },
      { keys: [42, 42, 42], after: 0.3 },
      { type: '1200', after: 3.0 },
    ],
    post: "At a card show and not sure about the price? Holo Folder's Show mode finds the card, shows the market price in pounds and tells you how an asking price compares.",
    tags: '#pokemoncardshow #pokemoncards #pokemontcg #umbreon #prismaticevolutions #tcguk',
  },
];

// ---------- shell helpers ----------
const exec = promisify(execFile);
async function run(cmd: string[]): Promise<string> {
  const { stdout } = await exec(cmd[0], cmd.slice(1), { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

async function ensureSim(): Promise<string> {
  const list = JSON.parse(await run(['xcrun', 'simctl', 'list', 'devices', '-j'])) as {
    devices: Record<string, { name: string; udid: string; state: string; isAvailable: boolean }[]>;
  };
  let dev = Object.values(list.devices)
    .flat()
    .find((d) => d.name === SIM_NAME && d.isAvailable);
  if (!dev) {
    const runtime = Object.keys(list.devices)
      .filter((r) => r.includes('iOS'))
      .sort()
      .pop();
    if (!runtime) throw new Error('No iOS simulator runtime installed');
    const udid = (await run(['xcrun', 'simctl', 'create', SIM_NAME, SIM_TYPE, runtime])).trim();
    dev = { name: SIM_NAME, udid, state: 'Shutdown', isAvailable: true };
  }
  return dev.udid;
}

// A clean device per clip: no Show mode, cached prices or Safari state carried over from the last clip.
async function freshSim(udid: string) {
  await run(['xcrun', 'simctl', 'shutdown', udid]).catch(() => {});
  await run(['xcrun', 'simctl', 'erase', udid]);
  await run(['xcrun', 'simctl', 'boot', udid]);
  await run(['xcrun', 'simctl', 'bootstatus', udid, '-b']);
  await run(['xcrun', 'simctl', 'ui', udid, 'appearance', 'dark']);
  await run([
    'xcrun',
    'simctl',
    'status_bar',
    udid,
    'override',
    '--time',
    '9:41',
    '--batteryState',
    'charged',
    '--batteryLevel',
    '100',
    '--cellularBars',
    '4',
    '--wifiBars',
    '3',
  ]);
}

const axe = (udid: string, args: string[]) => run(['axe', ...args, '--udid', udid]);

async function labels(udid: string): Promise<Set<string>> {
  const out = new Set<string>();
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as { AXLabel?: string; children?: unknown[] };
    if (node.AXLabel) out.add(node.AXLabel);
    node.children?.forEach(walk);
  };
  // describe-ui sometimes times out just after boot; give it a few tries.
  for (let attempt = 0; ; attempt++) {
    try {
      walk(JSON.parse(await axe(udid, ['describe-ui'])));
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(3);
    }
  }
  return out;
}

async function openPage(udid: string, url: string) {
  // On a just-erased device Safari's first launch swallows the URL; retry until the start page is gone.
  let attempts = 0;
  do {
    if (attempts++ === 5) throw new Error(`Safari did not open ${url}`);
    await run(['xcrun', 'simctl', 'openurl', udid, url]);
    await sleep(7);
  } while ((await labels(udid)).has('Start Page'));
  await sleep(4);
  // Hide Safari's toolbar (Page Menu, scroll the menu, Hide Toolbar) so the app fills the screen.
  await axe(udid, ['tap', '--label', 'Page Menu']);
  await sleep(1.2);
  await axe(udid, [
    'swipe',
    '--start-x',
    '250',
    '--start-y',
    '720',
    '--end-x',
    '250',
    '--end-y',
    '480',
    '--duration',
    '0.8',
  ]);
  await sleep(1);
  await axe(udid, ['tap', '--label', 'Hide Toolbar', '--wait-timeout', '3']);
  await sleep(1.5);
  // The first touch on the page asks for motion access (holo tilt); answer it now, off camera.
  await axe(udid, ['tap', '-x', '220', '-y', '170']);
  await sleep(1.5);
  if ((await labels(udid)).has('Cancel')) await axe(udid, ['tap', '--label', 'Cancel']);
  await sleep(1);
}

// ---------- recording ----------
interface Gesture {
  kind: 'tap' | 'swipe';
  t: number;
  dur: number;
  from: [number, number];
  to: [number, number];
}
interface Timeline {
  captions: { t: number; text: string }[];
  gestures: Gesture[];
  end: number;
}

async function perform(udid: string, steps: Step[], now: () => number, tl: Timeline, probe?: string) {
  let i = 0;
  for (const s of steps) {
    if ('caption' in s) tl.captions.push({ t: now(), text: s.caption });
    else if ('wait' in s) await sleep(s.wait);
    else if ('tap' in s) {
      const [x, y] = s.tap;
      const dur = s.hold ?? 0.12;
      await axe(udid, ['tap', '-x', `${x}`, '-y', `${y}`, ...(s.hold ? ['--hold', `${s.hold}`] : [])]);
      // AXe takes a second or so to start; it returns once the touch ends, so time the dot from there.
      tl.gestures.push({ kind: 'tap', t: now() - dur, dur, from: [x, y], to: [x, y] });
      await sleep(s.after ?? 1);
    } else if ('swipe' in s) {
      const [x1, y1, x2, y2] = s.swipe;
      await axe(udid, [
        'swipe',
        '--start-x',
        `${x1}`,
        '--start-y',
        `${y1}`,
        '--end-x',
        `${x2}`,
        '--end-y',
        `${y2}`,
        '--duration',
        `${s.dur}`,
        '--delta',
        '8',
      ]);
      tl.gestures.push({ kind: 'swipe', t: now() - s.dur, dur: s.dur, from: [x1, y1], to: [x2, y2] });
      await sleep(s.after ?? 1);
    } else if ('keys' in s) {
      await axe(udid, ['key-sequence', '--keycodes', s.keys.join(','), '--delay', '0.08']);
      await sleep(s.after ?? 1);
    } else if ('type' in s) {
      await axe(udid, ['type', s.type]);
      await sleep(s.after ?? 1);
    }
    if (probe && !('caption' in s)) {
      await run(['xcrun', 'simctl', 'io', udid, 'screenshot', join(probe, `${String(++i).padStart(2, '0')}.png`)]);
    }
  }
}

async function record(udid: string, clip: Clip, raw: string): Promise<Timeline> {
  const rec = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', raw]);
  const exited = new Promise((r) => rec.once('exit', r));
  // simctl prints "Recording started" once frames are being written.
  await new Promise<void>((resolve, reject) => {
    let buf = '';
    rec.stderr.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      if (buf.includes('Recording started')) resolve();
    });
    rec.once('exit', () => reject(new Error(`recordVideo exited early: ${buf}`)));
  });
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const tl: Timeline = { captions: [{ t: 0, text: clip.hook }], gestures: [], end: 0 };
  await perform(udid, clip.steps, now, tl);
  tl.end = now();
  rec.kill('SIGINT');
  await exited;
  return tl;
}

// ---------- overlays (rendered as transparent PNGs with Chromium, so we get real typography) ----------
const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif`;
const page = (body: string, bg = 'transparent') => `<!doctype html><html><head><style>
  html,body{margin:0;width:${W}px;height:${H}px;background:${bg};font-family:${FONT};color:#fff;-webkit-font-smoothing:antialiased}
  .band{position:absolute;left:72px;right:72px;top:0;height:${TOP}px;display:flex;align-items:center;justify-content:center;text-align:center}
</style></head><body>${body}</body></html>`;

const captionHtml = (text: string, hook: boolean) =>
  page(
    `<div class="band"><div style="font-size:${hook ? 74 : 56}px;font-weight:${hook ? 800 : 650};line-height:1.12;letter-spacing:${hook ? -1.5 : -0.6}px;text-wrap:balance">${escapeHtml(text)}</div></div>`,
  );

const maskHtml = () =>
  page(
    `<div style="position:absolute;left:${SCREEN_X}px;top:${TOP}px;width:${SCREEN_W}px;height:${SCREEN_H}px;border-radius:${Math.round(56 * K)}px;background:#fff"></div>`,
    '#000',
  );

const frameHtml = () =>
  page(
    `<div style="position:absolute;left:${SCREEN_X - 3}px;top:${TOP - 3}px;width:${SCREEN_W}px;height:${SCREEN_H}px;border-radius:${Math.round(56 * K) + 3}px;border:3px solid rgba(255,255,255,.14)"></div>`,
  );

const touchHtml = () => {
  const d = Math.round(44 * K);
  return `<!doctype html><html><body style="margin:0;background:transparent;width:${d}px;height:${d}px">
    <div style="width:${d - 6}px;height:${d - 6}px;margin:3px;border-radius:50%;background:rgba(255,255,255,.38);box-shadow:0 0 0 3px rgba(255,255,255,.75),0 4px 18px rgba(0,0,0,.35)"></div></body></html>`;
};

const endCardHtml = (icon: string) =>
  page(
    `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center">
    <img src="${icon}" style="width:230px;height:230px;border-radius:52px">
    <div style="font-size:96px;font-weight:800;letter-spacing:-2px">Holo Folder</div>
    <div style="font-size:52px;font-weight:600;color:#c9c3ff">holofolder.com</div>
    <div style="margin-top:18px;font-size:44px;font-weight:600;padding:20px 40px;border-radius:999px;border:2px solid rgba(255,255,255,.22)">Free: unlimited cards</div>
  </div>
  <div style="position:absolute;left:80px;right:80px;bottom:110px;text-align:center;font-size:27px;line-height:1.4;color:rgba(255,255,255,.55)">
    Not affiliated with The Pokémon Company. Card images © The Pokémon Company, Nintendo, Creatures and GAME FREAK.</div>`,
    '#0a0a0d',
  );

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

async function renderOverlays(dir: string, captions: string[], hookIndex = 0) {
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  const shot = async (html: string, file: string, size?: { width: number; height: number }) => {
    if (size) await p.setViewportSize(size);
    await p.setContent(html);
    await p.screenshot({ path: join(dir, file), omitBackground: true });
    if (size) await p.setViewportSize({ width: W, height: H });
  };
  for (const [i, text] of captions.entries()) await shot(captionHtml(text, i === hookIndex), `cap${i}.png`);
  await shot(maskHtml(), 'mask.png');
  await shot(frameHtml(), 'frame.png');
  const icon = `data:image/png;base64,${(await readFile(join(ROOT, 'public/holofolder-icon-1024.png'))).toString('base64')}`;
  await shot(endCardHtml(icon), 'end.png');
  const d = Math.round(44 * K);
  await shot(touchHtml(), 'touch.png', { width: d, height: d });
  await browser.close();
}

// ---------- compositing ----------
async function composite(dir: string, raw: string, tl: Timeline, outFile: string) {
  const total = tl.end;
  const d = Math.round(44 * K);
  const inputs = ['-i', raw, '-loop', '1', '-i', join(dir, 'mask.png'), '-loop', '1', '-i', join(dir, 'frame.png')];
  const f: string[] = [];
  const cropPx = CROP_PT * PT.scale;
  f.push(`color=c=0x0a0a0d:s=${W}x${H}:r=60:d=${total.toFixed(3)}[bg]`);
  f.push(
    `[0:v]fps=60,crop=iw:${cropPx}:0:0,scale=${SCREEN_W}:${SCREEN_H}:flags=lanczos,pad=${W}:${H}:${SCREEN_X}:${TOP}:black,format=rgba[scr]`,
  );
  f.push(`[1:v]format=gray[m]`, `[scr][m]alphamerge[scrm]`, `[bg][scrm]overlay=0:0[v0]`, `[v0][2:v]overlay=0:0[v1]`);
  let last = 'v1';
  let n = 3;
  const fade = 0.18;
  const caps = tl.captions;
  caps.forEach((c, i) => {
    const a = c.t;
    const b = i + 1 < caps.length ? caps[i + 1].t : total;
    inputs.push('-loop', '1', '-t', total.toFixed(3), '-i', join(dir, `cap${i}.png`));
    f.push(
      `[${n}:v]format=rgba,fade=t=in:st=${a.toFixed(3)}:d=${fade}:alpha=1,fade=t=out:st=${Math.max(a, b - fade).toFixed(3)}:d=${fade}:alpha=1[c${i}]`,
    );
    f.push(`[${last}][c${i}]overlay=0:0:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[cv${i}]`);
    last = `cv${i}`;
    n++;
  });
  tl.gestures.forEach((g, i) => {
    // AXe reports the touch slightly before the frame shows it; the dot leads by a hair, which reads naturally.
    const a = g.t;
    const b = g.t + g.dur + 0.25;
    const px = (x: number) => SCREEN_X + x * K - d / 2;
    const py = (y: number) => TOP + y * K - d / 2;
    const prog = `min(max((t-${a.toFixed(3)})/${Math.max(g.dur, 0.01).toFixed(3)},0),1)`;
    const x =
      g.kind === 'tap'
        ? px(g.from[0]).toFixed(1)
        : `${px(g.from[0]).toFixed(1)}+(${(px(g.to[0]) - px(g.from[0])).toFixed(1)})*${prog}`;
    const y =
      g.kind === 'tap'
        ? py(g.from[1]).toFixed(1)
        : `${py(g.from[1]).toFixed(1)}+(${(py(g.to[1]) - py(g.from[1])).toFixed(1)})*${prog}`;
    inputs.push('-loop', '1', '-t', total.toFixed(3), '-i', join(dir, 'touch.png'));
    f.push(
      `[${n}:v]format=rgba,fade=t=in:st=${a.toFixed(3)}:d=0.06:alpha=1,fade=t=out:st=${(b - 0.2).toFixed(3)}:d=0.2:alpha=1[t${i}]`,
    );
    f.push(
      `[${last}][t${i}]overlay=x='${x}':y='${y}':eval=frame:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[tv${i}]`,
    );
    last = `tv${i}`;
    n++;
  });
  inputs.push('-loop', '1', '-t', `${END_CARD_S}`, '-i', join(dir, 'end.png'));
  f.push(`[${last}]format=yuv420p,setsar=1[main]`);
  f.push(`[${n}:v]fps=60,format=yuv420p,setsar=1[end]`);
  f.push(`[main][end]xfade=transition=fade:duration=0.35:offset=${(total - 0.35).toFixed(3)}[out]`);
  n++;
  inputs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  await run([
    'ffmpeg',
    '-y',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    f.join(';'),
    '-map',
    '[out]',
    '-map',
    `${n}:a`,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '17',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '60',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-shortest',
    '-movflags',
    '+faststart',
    outFile,
  ]);
}

async function writeCaptionFile(clip: Clip, file: string) {
  await writeFile(
    file,
    [
      clip.post,
      '',
      clip.tags,
      '',
      `TikTok link: ${UTM('tiktok')}`,
      `Instagram link: ${UTM('instagram')}`,
      '',
      'Card images © The Pokémon Company, Nintendo, Creatures and GAME FREAK. Holo Folder is not affiliated with The Pokémon Company.',
      '',
    ].join('\n'),
  );
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2);
  const probe = args.includes('--probe');
  const wanted = args.filter((a) => !a.startsWith('--'));
  const clips = wanted.length ? CLIPS.filter((c) => wanted.includes(c.name)) : CLIPS;
  if (!clips.length) throw new Error(`Unknown clip. Choose from: ${CLIPS.map((c) => c.name).join(', ')}`);

  await mkdir(OUT, { recursive: true });
  const udid = await ensureSim();
  for (const clip of clips) {
    const work = join(OUT, '.work', clip.name);
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    console.log(`▶ ${clip.name}: preparing a clean simulator`);
    await freshSim(udid);
    await openPage(udid, clip.url);
    const tl0: Timeline = { captions: [], gestures: [], end: 0 };
    if (clip.setup) {
      const setupProbe = probe ? join(work, 'setup') : undefined;
      if (setupProbe) await mkdir(setupProbe);
      await perform(udid, clip.setup, () => 0, tl0, setupProbe);
    }
    if (probe) {
      await perform(udid, clip.steps, () => 0, tl0, work);
      console.log(`  probe screenshots in ${work}`);
      continue;
    }
    const raw = join(work, 'raw.mp4');
    console.log('  recording');
    const tl = await record(udid, clip, raw);
    await writeFile(join(work, 'timeline.json'), JSON.stringify(tl, null, 2));
    console.log('  compositing');
    await renderOverlays(
      work,
      tl.captions.map((c) => c.text),
    );
    const mp4 = join(OUT, `${clip.name}.mp4`);
    await composite(work, raw, tl, mp4);
    await writeCaptionFile(clip, join(OUT, `${clip.name}.txt`));
    console.log(`  ✓ ${mp4} (${(tl.end + END_CARD_S - 0.35).toFixed(1)} s)`);
  }
}

void main();
