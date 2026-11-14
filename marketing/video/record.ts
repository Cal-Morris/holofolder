// Records short vertical demo videos of Holo Folder from an iOS Simulator and composites them for TikTok/Reels.
// Usage: bun marketing/video/record.ts [clip…] [--probe] [--reuse]
//   --probe  run each clip's steps without recording and save a screenshot after every step (for tuning coordinates)
//   --reuse  keep the signed-in simulator instead of erasing it (faster probes; state can carry over)
// Films the installed PWA signed in as @demo (seed it first with marketing/video/seed-demo.ts).
// Needs Xcode (simctl), AXe (`brew install cameroncooke/axe/axe`) and ffmpeg. See marketing/video/README.md.
/* oxlint-disable react-doctor/async-await-in-loop, react-doctor/js-index-maps, react-doctor/js-set-map-lookups -- one simulator driven strictly in order; the loops are retries over a handful of on-screen items */
import { chromium } from '@playwright/test';
import { createWorker } from 'tesseract.js';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { demoPassword } from './seed-demo';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const OUT = join(HERE, 'out');
const SIM_NAME = 'Holo Folder Video';
const SIM_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max';
// iPhone 18 Pro Max: 440x956 pt at 3x. Every coordinate below is in points on this device.
// ponytail: coordinates are hand-tuned for this device and the current UI; rerun with --probe after UI changes.
const PT = { w: 440, h: 956, scale: 3 };
const CROP_PT = 904; // status bar, app and dock; drops the empty home-indicator strip
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
  | { caption: string }
  | { mark: string }; // names a moment for the cold open

interface Clip {
  name: string;
  hook: string; // shown over the cold open
  // The payoff, shown first: `dur` seconds from the step marked `mark`, with a slow push-in.
  coldOpen: { mark: string; dur: number };
  setup?: Step[]; // runs before recording starts
  steps: Step[];
  post: string;
  tags: string;
}

const DOCK = {
  search: [52, 862],
  binder: [136, 862],
  inventory: [220, 862],
  wanted: [304, 862],
  browse: [388, 862],
} as const;
const HEADER = { threeD: [310, 102], show: [363, 102], more: [407, 102] } as const;

const CLIPS: Clip[] = [
  {
    name: 'kanto-3d',
    hook: 'Your binder, but in 3D',
    coldOpen: { mark: '3d', dur: 1.8 },
    setup: [
      // Warm the first pages' images and the 3D view off camera, so nothing loads on screen.
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 2.5 },
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 2.5 },
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 2.5 },
      { swipe: [60, 470, 380, 470], dur: 0.3, after: 1.0 },
      { swipe: [60, 470, 380, 470], dur: 0.3, after: 1.0 },
      { swipe: [60, 470, 380, 470], dur: 0.3, after: 1.5 },
      { tap: [...HEADER.threeD], after: 8 },
      { tap: [...HEADER.threeD], after: 2 },
    ],
    steps: [
      { wait: 1.0 },
      { caption: '141 of 151 Kanto Pokémon, all from the 151 set' },
      { wait: 1.8 },
      { caption: 'Swipe through it like the real thing' },
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 1.3 },
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 1.3 },
      { caption: 'Or open it up in 3D' },
      { tap: [...HEADER.threeD], after: 2.5 },
      { tap: [320, 796], after: 1.5 },
      { mark: '3d' },
      { tap: [320, 796], after: 1.5 },
      { tap: [320, 796], after: 2.0 },
    ],
    post: 'Our Kanto binder: 141 of the 151 Kanto Pokémon, every one from the 151 set, page by page and in 3D. Ten pockets to go.',
    tags: '#pokemon151 #pokemonbinder #pokemoncards #pokemontcg #kanto #pokemoncollection',
  },
  {
    name: 'binder-worth',
    hook: 'What is my binder actually worth?',
    coldOpen: { mark: 'value', dur: 1.8 },
    steps: [
      { wait: 1.0 },
      { caption: 'Open Analytics from the menu' },
      { tap: [...HEADER.more], after: 1.4 },
      { tap: [252, 325], after: 3.0 },
      { mark: 'value' },
      { caption: 'Every card priced in pounds, with how sure each price is' },
      { wait: 2.6 },
      { caption: 'The cards carrying the value' },
      { swipe: [220, 760, 220, 420], dur: 0.9, after: 2.6 },
      { caption: 'And what the gaps would cost to fill' },
      { swipe: [220, 760, 220, 300], dur: 0.9, after: 1.2 },
      { swipe: [220, 760, 220, 300], dur: 0.9, after: 2.6 },
    ],
    post: 'What our Kanto binder is worth, worked out card by card in pounds, plus what the last ten chase cards would cost to finish it.',
    tags: '#pokemon151 #pokemoncards #pokemontcg #pokemoncollection #tcguk #pokemonbinder',
  },
  {
    name: 'card-show-hunt',
    hook: 'POV: the Blastoise ex you need is £150 at a card show',
    coldOpen: { mark: 'verdict', dur: 2.0 },
    steps: [
      { wait: 1.0 },
      { caption: 'Show mode, built for the show floor' },
      { tap: [...HEADER.show], after: 1.8 },
      { tap: [...DOCK.search], after: 2.0 },
      { caption: 'Your want list, ready to hunt' },
      { swipe: [220, 680, 220, 420], dur: 0.8, after: 1.6 },
      { caption: 'Tap the card on the table' },
      { tap: [200, 649], after: 2.8 },
      { caption: 'Type what the seller is asking' },
      { tap: [220, 793], after: 0.5 },
      { type: '150', after: 0.4 },
      { mark: 'verdict' },
      { wait: 2.4 },
      { caption: 'Talk them down and check again' },
      { keys: [42, 42, 42], after: 0.3 },
      { type: '75', after: 3.0 },
    ],
    post: "Card show tip: Holo Folder's Show mode keeps your want list on screen and tells you straight away how an asking price compares with the market, in pounds.",
    tags: '#pokemoncardshow #pokemoncards #pokemontcg #blastoise #pokemon151 #tcguk',
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

type Frame = { x: number; y: number; width: number; height: number };
async function elements(udid: string): Promise<{ label: string; frame: Frame }[]> {
  const out: { label: string; frame: Frame }[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as { AXLabel?: string; frame: Frame; children?: unknown[] };
    if (node.AXLabel) out.push({ label: node.AXLabel, frame: node.frame });
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
const labels = async (udid: string) => new Set((await elements(udid)).map((e) => e.label));

const tap = (udid: string, x: number, y: number) => axe(udid, ['tap', '-x', `${x}`, '-y', `${y}`]);

// A web app's page isn't in the accessibility tree and its layout shifts with the keyboard and messages, so find
// on-screen text by OCR (tesseract.js, already a dependency) and tap the middle of the first line containing it.
let ocr: Awaited<ReturnType<typeof createWorker>> | null = null;
async function screenLines(udid: string) {
  ocr ??= await createWorker('eng');
  const shot = join(tmpdir(), `holofolder-ocr-${udid}.png`);
  await run(['xcrun', 'simctl', 'io', udid, 'screenshot', shot]);
  const { data } = await ocr.recognize(shot, {}, { blocks: true });
  return (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
}

// The software keyboard's ✓ isn't in the accessibility tree either; it sits 107 pt above the top letter row.
async function dismissKeyboard(udid: string) {
  const row = (await screenLines(udid)).find((l) => /t\s*y\s*u\s*i/i.test(l.text));
  if (!row) return;
  await tap(udid, 395, Math.round(row.bbox.y0 / PT.scale) - 107);
  await sleep(1.2);
}

async function tapText(udid: string, text: string, opts: { tries?: number; before?: () => Promise<unknown> } = {}) {
  for (let attempt = 0; attempt < (opts.tries ?? 8); attempt++) {
    if (opts.before) await opts.before();
    const lines = await screenLines(udid);
    if (process.env.OCR_DEBUG) console.log(attempt, lines.map((l) => l.text.trim()).join(' | '));
    const line = lines.find((l) => l.text.toLowerCase().includes(text.toLowerCase()));
    if (line) {
      // Only the matching words: OCR can merge labels that sit side by side into one line.
      const tokens = text.toLowerCase().split(/\s+/);
      const words = line.words.filter((w) => tokens.includes(w.text.toLowerCase().replace(/[^a-z0-9@.]/g, '')));
      const boxes = (words.length ? words : [line]).map((w) => w.bbox);
      const x = (Math.min(...boxes.map((b) => b.x0)) + Math.max(...boxes.map((b) => b.x1))) / 2;
      const y = (Math.min(...boxes.map((b) => b.y0)) + Math.max(...boxes.map((b) => b.y1))) / 2;
      await tap(udid, Math.round(x / PT.scale), Math.round(y / PT.scale));
      return;
    }
    await sleep(1.5);
  }
  throw new Error(`"${text}" not found on screen`);
}

// Installs the PWA from Safari and signs in as @demo inside it (a home-screen web app has its own storage).
async function installAndSignIn(udid: string) {
  // On a just-erased device Safari's first launch swallows the URL; retry until the start page is gone.
  let attempts = 0;
  do {
    if (attempts++ === 5) throw new Error('Safari did not open holofolder.com/app');
    await run(['xcrun', 'simctl', 'openurl', udid, 'https://holofolder.com/app']);
    await sleep(7);
  } while ((await labels(udid)).has('Start Page'));
  await sleep(3);
  await tap(udid, 220, 60); // blur the autofocused email field so Safari's toolbar comes back
  await sleep(1.5);
  await axe(udid, ['tap', '--label', 'Page Menu']);
  await sleep(1.5);
  await axe(udid, ['tap', '--label', 'Share', '--element-type', 'Button']);
  await sleep(2.5);
  // The share sheet isn't in the accessibility tree: View More, Add to Home Screen, then Add.
  await tapText(udid, 'View More');
  await sleep(1.5);
  await tapText(udid, 'Add to Home Screen');
  await sleep(4);
  await tap(udid, 383, 100); // the native sheet's Add button
  await sleep(3);
  await launchApp(udid);
  // The email field autofocuses (sometimes late) and its keyboard covers the link, so dismiss it before each look.
  await tapText(udid, 'Use a password instead', { before: () => dismissKeyboard(udid) });
  await sleep(1.5);
  // The password form autofocuses its email field.
  await axe(udid, ['type', 'demo@holofolder.com']);
  await axe(udid, ['key', '43']); // Tab to the password field
  await sleep(0.4);
  await axe(udid, ['type', await demoPassword()]);
  await axe(udid, ['key', '40']); // Return submits
  await sleep(9);
  // iOS may offer to save the password; it's a system sheet, so it is in the accessibility tree.
  if ((await labels(udid)).has('Not Now')) await axe(udid, ['tap', '--label', 'Not Now']);
  await sleep(2);
}

async function launchApp(udid: string) {
  // Tap the home screen icon by its frame (`tap --label` also matches it when it's on another page).
  for (let attempt = 0; ; attempt++) {
    const icon = (await elements(udid)).find((e) => e.label === 'Holo Folder' && e.frame.width > 0);
    if (icon) {
      await tap(
        udid,
        Math.round(icon.frame.x + icon.frame.width / 2),
        Math.round(icon.frame.y + icon.frame.height / 2),
      );
      break;
    }
    if (attempt === 4) throw new Error('Holo Folder icon not found on the home screen');
    // Off-page icons have a zero frame; page left twice, then back right.
    const [from, to] = attempt < 2 ? ['400', '40'] : ['40', '400'];
    await axe(udid, [
      'swipe',
      '--start-x',
      from,
      '--start-y',
      '600',
      '--end-x',
      to,
      '--end-y',
      '600',
      '--duration',
      '0.3',
    ]);
    await sleep(1.5);
  }
  await sleep(12);
}

// Back to a known screen: the Kanto binder, first page, with the motion prompt (holo tilt) answered off camera.
async function resetApp(udid: string) {
  await axe(udid, ['button', 'home']);
  await sleep(2);
  await run(['xcrun', 'simctl', 'terminate', udid, 'com.apple.webapp']).catch(() => {});
  await launchApp(udid);
  // The app reopens on the last view. This first touch after a launch always raises the motion prompt, which a
  // web app doesn't expose to accessibility, so answer it (Cancel) by position.
  await tap(udid, 220, 812); // the empty strip above the dock: raises it without touching anything
  await sleep(1.5);
  await tap(udid, 293, 526); // Allow (Cancel only lasts until Show mode asks again; Allow also turns on holo tilt)
  await sleep(1.2);
  await tap(udid, ...DOCK.binder); // also closes any sheet a stray touch opened
  await sleep(2);
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
  marks: Record<string, number>;
  captions: { t: number; text: string }[];
  gestures: Gesture[];
  end: number;
}

async function perform(udid: string, steps: Step[], now: () => number, tl: Timeline, probe?: string) {
  let i = 0;
  for (const s of steps) {
    if ('caption' in s) tl.captions.push({ t: now(), text: s.caption });
    else if ('mark' in s) tl.marks[s.mark] = now();
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
    if (probe && !('caption' in s) && !('mark' in s)) {
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
  const tl: Timeline = { marks: {}, captions: [], gestures: [], end: 0 };
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
  </div>
  <div style="position:absolute;left:80px;right:80px;bottom:110px;text-align:center;font-size:27px;line-height:1.4;color:rgba(255,255,255,.55)">
    Not affiliated with The Pokémon Company. Card images © The Pokémon Company, Nintendo, Creatures and GAME FREAK.</div>`,
    '#0a0a0d',
  );

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

async function renderOverlays(dir: string, hook: string, captions: string[]) {
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  const shot = async (html: string, file: string, size?: { width: number; height: number }) => {
    if (size) await p.setViewportSize(size);
    await p.setContent(html);
    await p.screenshot({ path: join(dir, file), omitBackground: true });
    if (size) await p.setViewportSize({ width: W, height: H });
  };
  await shot(captionHtml(hook, true), 'hook.png');
  for (const [i, text] of captions.entries()) await shot(captionHtml(text, false), `cap${i}.png`);
  await shot(maskHtml(), 'mask.png');
  await shot(frameHtml(), 'frame.png');
  const icon = `data:image/png;base64,${(await readFile(join(ROOT, 'public/holofolder-icon-1024.png'))).toString('base64')}`;
  await shot(endCardHtml(icon), 'end.png');
  const d = Math.round(44 * K);
  await shot(touchHtml(), 'touch.png', { width: d, height: d });
  await browser.close();
}

// ---------- compositing ----------
async function composite(dir: string, raw: string, tl: Timeline, clip: Clip, outFile: string) {
  const total = tl.end;
  const co = clip.coldOpen;
  const coStart = Math.min(tl.marks[co.mark] ?? 0, total - co.dur);
  const d = Math.round(44 * K);
  const inputs = ['-i', raw, '-loop', '1', '-i', join(dir, 'mask.png'), '-loop', '1', '-i', join(dir, 'frame.png')];
  const f: string[] = [];
  const cropPx = CROP_PT * PT.scale;
  f.push(`color=c=0x0a0a0d:s=${W}x${H}:r=60:d=${total.toFixed(3)}[bg]`);
  f.push(`[0:v]fps=60,crop=iw:${cropPx}:0:0,split[raw1][raw2]`);
  f.push(`[raw1]scale=${SCREEN_W}:${SCREEN_H}:flags=lanczos,pad=${W}:${H}:${SCREEN_X}:${TOP}:black,format=rgba[scr]`);
  f.push(`[1:v]format=gray,split[m][mc]`, `[2:v]split[fr][frc]`);
  f.push(`[scr][m]alphamerge[scrm]`, `[bg][scrm]overlay=0:0[v0]`, `[v0][fr]overlay=0:0[v1]`);
  // Cold open: the payoff first, with a slow push-in, under the hook line.
  const push = `(1+0.04*t/${co.dur})`;
  f.push(
    `[raw2]trim=start=${coStart.toFixed(3)}:duration=${co.dur},setpts=PTS-STARTPTS,` +
      `scale=w='trunc(${SCREEN_W}*${push}/2)*2':h='trunc(${SCREEN_H}*${push}/2)*2':eval=frame:flags=lanczos,` +
      `crop=${SCREEN_W}:${SCREEN_H}:x='(in_w-out_w)/2':y='(in_h-out_h)/2',pad=${W}:${H}:${SCREEN_X}:${TOP}:black,format=rgba[cos]`,
  );
  f.push(`color=c=0x0a0a0d:s=${W}x${H}:r=60:d=${co.dur}[cbg]`, `[cos][mc]alphamerge[cosm]`);
  f.push(`[cbg][cosm]overlay=0:0[co0]`, `[co0][frc]overlay=0:0[co1]`);
  inputs.push('-loop', '1', '-t', `${co.dur}`, '-i', join(dir, 'hook.png'));
  f.push(`[co1][3:v]overlay=0:0,trim=duration=${co.dur},fps=60,settb=1/60,format=yuv420p,setsar=1[cold]`);
  let last = 'v1';
  let n = 4;
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
  f.push(`[${last}]fps=60,settb=1/60,format=yuv420p,setsar=1[main]`);
  f.push(`[${n}:v]fps=60,settb=1/60,format=yuv420p,setsar=1[end]`);
  f.push(`[cold][main]concat=n=2:v=1:a=0,settb=1/60[body]`);
  f.push(`[body][end]xfade=transition=fade:duration=0.35:offset=${(co.dur + total - 0.35).toFixed(3)}[out]`);
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
  const reuse = args.includes('--reuse');
  const recomposite = args.includes('--recomposite'); // re-edit the last recording, no simulator
  const wanted = args.filter((a) => !a.startsWith('--'));
  const clips = wanted.length ? CLIPS.filter((c) => wanted.includes(c.name)) : CLIPS;
  if (!clips.length) throw new Error(`Unknown clip. Choose from: ${CLIPS.map((c) => c.name).join(', ')}`);

  await mkdir(OUT, { recursive: true });
  const udid = recomposite ? '' : await ensureSim();
  for (const clip of clips) {
    const work = join(OUT, '.work', clip.name);
    if (recomposite) {
      const tl = JSON.parse(await readFile(join(work, 'timeline.json'), 'utf8')) as Timeline;
      await finish(work, clip, tl);
      continue;
    }
    if (!recomposite) await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    if (!reuse) {
      console.log(`▶ ${clip.name}: clean simulator, installing the app and signing in`);
      await freshSim(udid);
      await installAndSignIn(udid);
    } else console.log(`▶ ${clip.name}`);
    await resetApp(udid);
    const tl0: Timeline = { marks: {}, captions: [], gestures: [], end: 0 };
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
    await finish(work, clip, tl);
  }
}

async function finish(work: string, clip: Clip, tl: Timeline) {
  console.log(`  compositing ${clip.name}`);
  await renderOverlays(
    work,
    clip.hook,
    tl.captions.map((c) => c.text),
  );
  const mp4 = join(OUT, `${clip.name}.mp4`);
  await composite(work, join(work, 'raw.mp4'), tl, clip, mp4);
  await writeCaptionFile(clip, join(OUT, `${clip.name}.txt`));
  console.log(`  ✓ ${mp4} (${(clip.coldOpen.dur + tl.end + END_CARD_S - 0.35).toFixed(1)} s)`);
}

void main().finally(() => ocr?.terminate());
