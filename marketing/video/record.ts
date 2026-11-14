// Records short vertical demo videos of Holo Folder from an iOS Simulator and composites them for TikTok/Reels.
// Usage: bun marketing/video/record.ts [clip…] [--probe] [--reuse] [--recomposite] [--draft] [--setup]
//   --probe  run each clip's steps without recording and save a screenshot after every step (for tuning coordinates)
//   --reuse  film on the golden simulator itself instead of a fresh clone (fastest probes; state carries over)
//   --recomposite  re-edit the last recordings without the simulator; --draft  fast hardware encode
//   --setup  rebuild the golden simulator (install the app and sign in again)
// Films the installed PWA signed in as @demo (seed it first with marketing/video/seed-demo.ts).
// Needs Xcode (simctl), AXe (`brew install cameroncooke/axe/axe`) and ffmpeg. See marketing/video/README.md.
/* oxlint-disable react-doctor/async-await-in-loop, react-doctor/js-index-maps, react-doctor/js-set-map-lookups -- one simulator driven strictly in order; the loops are retries over a handful of on-screen items */
import { chromium } from '@playwright/test';
import { createWorker } from 'tesseract.js';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { demoPassword } from './seed-demo';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const OUT = join(HERE, 'out');
// The golden simulator has the app installed and signed in; every take films on a throwaway clone of it.
const GOLDEN = 'Holo Folder Video';
const TAKE = 'Holo Folder Take';
const SIM_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max';
// iPhone 18 Pro Max: 440x956 pt at 3x. Every coordinate below is in points on this device.
// ponytail: coordinates are hand-tuned for this device and the current UI; rerun with --probe after UI changes.
const PT = { w: 440, h: 956, scale: 3 };
const CROP_PT = 904; // status bar, app and dock; drops the empty home-indicator strip
const W = 1080;
const H = 1920;
const TOP = 140; // margin above the phone screen
const SCREEN_H = H - TOP - 80;
const SCREEN_W = Math.round((PT.w * SCREEN_H) / CROP_PT / 2) * 2;
const SCREEN_X = (W - SCREEN_W) / 2;
const K = SCREEN_W / PT.w; // output px per point
const END_CARD_S = 1.4; // a short brand sting, so the video loops straight back to the hook
const END_FADE = 0.25;
const DRAFT = process.argv.includes('--draft');
const UTM = (source: string) => `https://holofolder.com/app?utm_source=${source}&utm_medium=social&utm_campaign=social`;

type Step =
  | { tap: [number, number]; hold?: number; after?: number }
  | { tapText: string; after?: number } // found on screen by OCR
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
  question: string; // asked in the post copy: comments are what push a video out
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
    hook: 'Ladies and gentlemen. My Kanto binder. In THREE. DIMENSIONS.',
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
      {
        caption:
          "A hundred and forty-one of a hundred and fifty-one Kanto Pokémon. My landlord thinks I'm saving for a deposit.",
      },
      { caption: 'Every single one from the 151 set. Look at it. Page by glorious page.' },
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 0.9 },
      { caption: 'Swipe, swipe. No sticky sleeves. No crisps in the pockets. Bliss.' },
      { swipe: [380, 470, 60, 470], dur: 0.3, after: 0.9 },
      { caption: 'And now. The moment. Hold onto something.' },
      { tap: [...HEADER.threeD], after: 2.2 },
      { tap: [320, 796], after: 0.8 },
      { mark: '3d' },
      { caption: 'It is a BINDER. In 3D. On my PHONE. Science has gone too far.' },
      { tap: [320, 796], after: 1.2 },
      { tap: [320, 796], after: 1.2 },
      { caption: 'Ten pockets left. My bank account has started making noises.' },
    ],
    question: 'Which empty pocket would you fill first?',
    post: 'Our Kanto binder: 141 of the 151 Kanto Pokémon, every one from the 151 set, page by page and in 3D. Ten pockets to go.',
    tags: '#pokemon151 #pokemonbinder #pokemoncards #pokemontcg #kanto #pokemoncollection',
  },
  {
    name: 'national-dex',
    hook: 'Every. Single. Pokémon. One. Binder. I need a lie down.',
    coldOpen: { mark: 'flip', dur: 1.8 },
    setup: [
      // Open the National Dex and flip through the first pages off camera, so their cards are loaded on screen.
      { tap: [50, 151], after: 1.0 },
      { tapText: 'National Dex', after: 3.0 },
      ...Array.from({ length: 8 }, () => ({ swipe: [380, 470, 60, 470], dur: 0.25, after: 1.6 }) as Step),
      ...Array.from({ length: 8 }, () => ({ swipe: [60, 470, 380, 470], dur: 0.25, after: 0.5 }) as Step),
      { tap: [50, 151], after: 1.0 },
      { tapText: 'Kanto', after: 3.0 },
    ],
    steps: [
      { caption: 'Ten twenty-five Pokémon. One binder. Zero shelves were harmed.' },
      { tap: [50, 151], after: 1.0 },
      { tapText: 'National Dex', after: 2.0 },
      { mark: 'flip' },
      { caption: 'National Dex order, so Bulbasaur gets page one. As the ancients intended.' },
      { swipe: [380, 470, 60, 470], dur: 0.25, after: 0.6 },
      { swipe: [380, 470, 60, 470], dur: 0.25, after: 0.6 },
      { swipe: [380, 470, 60, 470], dur: 0.25, after: 0.6 },
      { caption: 'Page. After page. After page. My thumb has filed a complaint.' },
      { swipe: [380, 470, 60, 470], dur: 0.25, after: 0.6 },
      { swipe: [380, 470, 60, 470], dur: 0.25, after: 0.6 },
      { swipe: [380, 470, 60, 470], dur: 0.25, after: 0.6 },
      { caption: 'Prefer a list? Fine. Every pocket, as a checklist. Tick, tick, tick.' },
      { tap: [...DOCK.inventory], after: 1.4 },
      { swipe: [220, 780, 220, 200], dur: 0.35, after: 0.8 },
      { swipe: [220, 780, 220, 200], dur: 0.35, after: 0.8 },
      { caption: "Gotta catch them all? Gotta BINDER them all. I'll see myself out." },
    ],
    question: 'Which Pokémon would you put on page one?',
    post: 'A National Dex binder in Holo Folder: a pocket for every Pokémon in Dex order, page by page or as a checklist.',
    tags: '#nationaldex #pokemonbinder #pokemoncards #pokemontcg #livingdex #pokemoncollection',
  },
  {
    name: 'similar-look',
    hook: 'Hang on. Hang ON. There are MORE cards like this?',
    coldOpen: { mark: 'similar', dur: 2.0 },
    steps: [
      { caption: 'Tap any card in your binder. Any card. Live a little.' },
      { tap: [78, 445], after: 2.4 },
      { caption: 'Scroll down to Similar look. This is where my money goes to die.' },
      { swipe: [220, 760, 220, 380], dur: 0.9, after: 1.4 },
      { mark: 'similar' },
      { caption: 'Cards with the same vibe, from every set ever made. Look at them all. LOOK at them.' },
      { swipe: [400, 700, 60, 700], dur: 0.6, after: 1.2 },
      { caption: 'Tap one and boom. Swap it straight into your binder, or stick it on your want list.' },
      { tap: [100, 700], after: 2.0 },
      { caption: 'My want list just doubled. Thanks, I hate it.' },
    ],
    question: 'What card should we look up next?',
    post: 'Similar look finds cards that share a card’s feel, colours and style, across every set. Tap one to see the card and its price in pounds.',
    tags: '#pokemoncards #pokemontcg #pokemonart #illustrationrare #pokemoncollection #tcguk',
  },
  {
    name: 'binder-worth',
    hook: 'I priced my ENTIRE Kanto binder and I need to sit down.',
    coldOpen: { mark: 'value', dur: 1.8 },
    steps: [
      { caption: 'Menu. Analytics. Deep breath. Do not look directly at it.' },
      { tap: [...HEADER.more], after: 1.2 },
      { tap: [252, 325], after: 2.4 },
      { mark: 'value' },
      { caption: 'Every card priced in pounds, and it even tells you how sure it is. Polite. Very British.' },
      { caption: "Here's who's carrying the team. Charmander. Absolute unit. Pays the rent." },
      { swipe: [220, 760, 220, 420], dur: 0.9, after: 1.2 },
      { caption: 'And this is what the last ten cards would cost. Tell my mum I love her.' },
      { swipe: [220, 760, 220, 300], dur: 0.9, after: 1.0 },
      { swipe: [220, 760, 220, 300], dur: 0.9, after: 1.0 },
      { caption: 'Right. Back to the card show. Hide the bank statements.' },
    ],
    question: 'Guess what yours is worth?',
    post: 'What our Kanto binder is worth, worked out card by card in pounds, plus what the last ten chase cards would cost to finish it.',
    tags: '#pokemon151 #pokemoncards #pokemontcg #pokemoncollection #tcguk #pokemonbinder',
  },
  {
    name: 'card-show-hunt',
    hook: 'STOP!!! Put the wallet DOWN. Do not pay £150 for this card.',
    coldOpen: { mark: 'verdict', dur: 2.0 },
    steps: [
      { caption: 'Card show. Nine a.m. I have had four coffees and I can hear colours.' },
      { tap: [...HEADER.show], after: 1.4 },
      { tap: [...DOCK.search], after: 1.6 },
      { caption: 'Show mode on. My want list. My hit list. My little list of financial ruin.' },
      { swipe: [220, 680, 220, 420], dur: 0.8, after: 1.0 },
      { caption: 'And there he is. Blastoise. Glistening. On the table. Winking at me.' },
      { tap: [200, 649], after: 2.2 },
      { caption: "Bloke behind the table goes, a hundred and fifty, mate. Let's ask the app, shall we." },
      { tap: [220, 793], after: 0.4 },
      { type: '150', after: 0.4 },
      { mark: 'verdict' },
      { caption: 'WALK AWAY. Walk away! Put the Blastoise DOWN! Back away slowly, sir!' },
      { caption: 'Right. Haggling face on. Seventy-five?' },
      { keys: [42, 42, 42], after: 0.3 },
      { type: '75', after: 1.0 },
      { caption: 'FAIR PRICE! Get in! Blastoise, pack your bags, son, you are coming home!' },
    ],
    question: 'Would you pay £150 for it?',
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

async function findSim(name: string): Promise<string | undefined> {
  const list = JSON.parse(await run(['xcrun', 'simctl', 'list', 'devices', '-j'])) as {
    devices: Record<string, { name: string; udid: string; isAvailable: boolean }[]>;
  };
  return Object.values(list.devices)
    .flat()
    .find((d) => d.name === name && d.isAvailable)?.udid;
}

async function ensureSim(): Promise<string> {
  const list = JSON.parse(await run(['xcrun', 'simctl', 'list', 'devices', '-j'])) as {
    devices: Record<string, { name: string; udid: string; state: string; isAvailable: boolean }[]>;
  };
  let dev = Object.values(list.devices)
    .flat()
    .find((d) => d.name === GOLDEN && d.isAvailable);
  if (!dev) {
    const runtime = Object.keys(list.devices)
      .filter((r) => r.includes('iOS'))
      .sort()
      .pop();
    if (!runtime) throw new Error('No iOS simulator runtime installed');
    const udid = (await run(['xcrun', 'simctl', 'create', GOLDEN, SIM_TYPE, runtime])).trim();
    dev = { name: GOLDEN, udid, state: 'Shutdown', isAvailable: true };
  }
  return dev.udid;
}

// A clean device per clip: no Show mode, cached prices or Safari state carried over from the last clip.
async function freshSim(udid: string) {
  await run(['xcrun', 'simctl', 'shutdown', udid]).catch(() => {});
  await run(['xcrun', 'simctl', 'erase', udid]);
  await bootSim(udid);
}

async function bootSim(udid: string) {
  await run(['xcrun', 'simctl', 'boot', udid]).catch(() => {});
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
  ocr ??= await createWorker('eng', 1, { cachePath: join(OUT, '.work') }); // keeps eng.traineddata out of the repo root
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

async function tapText(
  udid: string,
  text: string,
  opts: { tries?: number; before?: () => Promise<unknown> } = {},
): Promise<[number, number]> {
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
      const at: [number, number] = [Math.round(x / PT.scale), Math.round(y / PT.scale)];
      await tap(udid, ...at);
      return at;
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

// `voice` holds how long each caption line takes to say: a caption waits for the previous line to finish, so the
// voice never overlaps itself and the footage holds while it talks.
async function perform(
  udid: string,
  steps: Step[],
  now: () => number,
  tl: Timeline,
  probe?: string,
  voice: number[] = [],
) {
  let i = 0;
  let line = 0;
  let talkingUntil = 0;
  for (const s of steps) {
    if ('caption' in s) {
      if (now() < talkingUntil) await sleep(talkingUntil - now());
      tl.captions.push({ t: now(), text: s.caption });
      talkingUntil = now() + (voice[line++] ?? 0) + 0.1;
    } else if ('mark' in s) tl.marks[s.mark] = now();
    else if ('wait' in s) await sleep(s.wait);
    else if ('tap' in s) {
      const [x, y] = s.tap;
      const dur = s.hold ?? 0.12;
      await axe(udid, ['tap', '-x', `${x}`, '-y', `${y}`, ...(s.hold ? ['--hold', `${s.hold}`] : [])]);
      // AXe takes a second or so to start; it returns once the touch ends, so time the dot from there.
      tl.gestures.push({ kind: 'tap', t: now() - dur, dur, from: [x, y], to: [x, y] });
      await sleep(s.after ?? 1);
    } else if ('tapText' in s) {
      const at = await tapText(udid, s.tapText);
      tl.gestures.push({ kind: 'tap', t: now() - 0.12, dur: 0.12, from: at, to: at });
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

async function record(udid: string, clip: Clip, raw: string, voice: number[]): Promise<Timeline> {
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
  await perform(udid, clip.steps, now, tl, undefined, voice);
  // Let the last line finish over the final frames.
  const last = tl.captions.at(-1);
  if (last) await sleep(Math.max(0, last.t + (voice[tl.captions.length - 1] ?? 0) + 0.3 - now()));
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

// TikTok-style captions: a few words at a time, big and bold over the lower middle of the screen, with the word
// being spoken in the accent colour. The hook is the same treatment, larger.
const ACCENT = '#c9b8ff';
const captionHtml = (words: string[], active: number, hook: boolean) =>
  page(
    `<div style="position:absolute;left:70px;right:150px;top:${hook ? 700 : 300}px;display:flex;justify-content:center;text-align:center">
      <div style="font-size:${hook ? 96 : 84}px;font-weight:900;line-height:1.05;letter-spacing:-1.5px;text-wrap:balance;
        -webkit-text-stroke:${hook ? 12 : 10}px #000;paint-order:stroke fill;text-shadow:0 6px 30px rgba(0,0,0,.55)">${words
          .map((w, i) => `<span style="color:${i === active ? ACCENT : '#fff'}">${escapeHtml(w)}</span>`)
          .join(' ')}</div></div>`,
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

async function renderOverlays(dir: string) {
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  const shot = async (html: string, file: string, size?: { width: number; height: number }) => {
    if (size) await p.setViewportSize(size);
    await p.setContent(html);
    await p.screenshot({ path: join(dir, file), omitBackground: true });
    if (size) await p.setViewportSize({ width: W, height: H });
  };
  await shot(maskHtml(), 'mask.png');
  await shot(frameHtml(), 'frame.png');
  const icon = `data:image/png;base64,${(await readFile(join(ROOT, 'public/holofolder-icon-1024.png'))).toString('base64')}`;
  await shot(endCardHtml(icon), 'end.png');
  const d = Math.round(44 * K);
  await shot(touchHtml(), 'touch.png', { width: d, height: d });
  await browser.close();
}

// ---------- captions ----------
interface Cue {
  text: string;
  start: number; // seconds in the final video
  dur: number; // how long the voice takes to say it
  file: string; // the voiced line
  hook: boolean;
}

// Voice every line first, then place each at its moment (or right after the previous line, so none overlap).
// Both cuts use this timing, so the captions follow the voice even in the music-only cut.
async function scheduleCues(dir: string, clip: Clip, tl: Timeline): Promise<Cue[]> {
  const co = clip.coldOpen.dur;
  const lines = [{ t: -co + 0.1, text: clip.hook }, ...tl.captions];
  await speak(lines.map((line, i) => ({ out: join(dir, `vo${i}.wav`), text: line.text })));
  const cues: Cue[] = [];
  let free = 0;
  for (const [i, line] of lines.entries()) {
    const file = join(dir, `vo${i}.wav`);
    const dur = Number(
      await run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]),
    );
    const start = Math.max(co + line.t + 0.05, free);
    cues.push({ text: line.text, start, dur, file, hook: i === 0 });
    free = start + dur + 0.12;
  }
  return cues;
}

// One transparent PNG per word state, strung together with ffmpeg's concat demuxer into a single caption track.
// Words are timed in proportion to their length across the line's spoken duration.
async function renderCaptionTrack(dir: string, cues: Cue[], length: number): Promise<string> {
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  const entries: { file: string; dur: number }[] = [];
  await p.setContent(page(''));
  await p.screenshot({ path: join(dir, 'blank.png'), omitBackground: true });
  let at = 0;
  let n = 0;
  const hold = (file: string, until: number) => {
    if (until - at > 0.001) entries.push({ file, dur: until - at });
    at = Math.max(at, until);
  };
  for (const [ci, cue] of cues.entries()) {
    const words = cue.text.split(/\s+/);
    const weights = words.map((w) => w.length + 2);
    const total = weights.reduce((a, b) => a + b, 0);
    const per = cue.hook ? words.length : 4; // the hook stays whole; other lines show four words at a time
    const nextStart = ci + 1 < cues.length ? cues[ci + 1].start : length;
    hold(join(dir, 'blank.png'), cue.start);
    let t = cue.start;
    for (let w = 0; w < words.length; w++) {
      const group = Math.floor(w / per);
      const chunk = words.slice(group * per, group * per + per);
      const file = join(dir, `word${n++}.png`);
      await p.setContent(captionHtml(chunk, w - group * per, cue.hook));
      await p.screenshot({ path: file, omitBackground: true });
      t += (cue.dur * weights[w]) / total;
      const last = w === words.length - 1;
      hold(file, last ? Math.min(nextStart, t + 0.5) : t);
    }
  }
  hold(join(dir, 'blank.png'), length);
  await browser.close();
  const list = join(dir, 'captions.txt');
  // The concat demuxer needs the last file repeated to honour its duration.
  await writeFile(
    list,
    [...entries.map((e) => `file '${e.file}'\nduration ${e.dur.toFixed(3)}`), `file '${entries.at(-1)!.file}'`].join(
      '\n',
    ),
  );
  return list;
}

// ---------- compositing ----------
async function composite(
  dir: string,
  raw: string,
  tl: Timeline,
  clip: Clip,
  captions: string,
  audio: string,
  outFile: string,
) {
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
  f.push(`[co1]trim=duration=${co.dur},fps=60,settb=1/60,format=yuv420p,setsar=1[cold]`);
  let last = 'v1';
  let n = 3;
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
  inputs.push('-f', 'concat', '-safe', '0', '-i', captions);
  f.push(`[${n}:v]fps=60,format=rgba[caps]`);
  n++;
  inputs.push('-loop', '1', '-t', `${END_CARD_S}`, '-i', join(dir, 'end.png'));
  f.push(`[${last}]fps=60,settb=1/60,format=yuv420p,setsar=1[main]`);
  f.push(`[${n}:v]fps=60,settb=1/60,format=yuv420p,setsar=1[end]`);
  f.push(`[cold][main]concat=n=2:v=1:a=0,settb=1/60,format=rgba[body0]`);
  f.push(`[body0][caps]overlay=0:0:shortest=1,fps=60,settb=1/60,format=yuv420p,setsar=1[body]`);
  f.push(`[body][end]xfade=transition=fade:duration=${END_FADE}:offset=${(co.dur + total - END_FADE).toFixed(3)}[out]`);
  n++;
  inputs.push('-i', audio);
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
    // --draft: the Mac's hardware encoder, several times faster, for checking edits.
    ...(DRAFT
      ? ['-c:v', 'h264_videotoolbox', '-b:v', '14M']
      : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high']),
    '-pix_fmt',
    'yuv420p',
    '-r',
    '60',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
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
      '# TikTok (short caption, the hook first, then a question to start the comments)',
      `${clip.hook}. ${clip.question} ${clip.tags.split(' ').slice(0, 4).join(' ')}`,
      '',
      '# Instagram Reels',
      `${clip.post} ${clip.question}`,
      '',
      clip.tags,
      '',
      `TikTok link (bio): ${UTM('tiktok')}`,
      `Instagram link (bio): ${UTM('instagram')}`,
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

  if (args.includes('--voice-preview')) {
    for (const clip of clips) await run(['afplay', await voicePreview(clip)]);
    return;
  }
  if (recomposite) {
    // Re-edits run two at a time; voice lines come from the cache unless their wording changed.
    const queue = [...clips];
    const worker = async () => {
      for (let clip = queue.shift(); clip; clip = queue.shift()) {
        const work = join(OUT, '.work', clip.name);
        const tl = JSON.parse(await readFile(join(work, 'timeline.json'), 'utf8')) as Timeline;
        await finish(work, clip, tl);
      }
    };
    await Promise.all([worker(), worker()]);
    return;
  }
  await mkdir(OUT, { recursive: true });
  const golden = await ensureSim();
  const ready = join(OUT, '.golden-ready');
  if (args.includes('--setup') || !(await stat(ready).catch(() => null))) {
    console.log('▶ setting up the golden simulator: install the app and sign in as @demo');
    await freshSim(golden);
    await installAndSignIn(golden);
    await run(['xcrun', 'simctl', 'shutdown', golden]);
    await writeFile(ready, new Date().toISOString());
  }
  for (const clip of clips) {
    const work = join(OUT, '.work', clip.name);
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    let udid = golden;
    if (!reuse) {
      // A fresh clone of the golden device: same signed-in app, no state left over from the last take.
      console.log(`▶ ${clip.name}: fresh clone of the golden simulator`);
      const old = await findSim(TAKE);
      if (old) {
        await run(['xcrun', 'simctl', 'shutdown', old]).catch(() => {});
        await run(['xcrun', 'simctl', 'delete', old]);
      }
      await run(['xcrun', 'simctl', 'shutdown', golden]).catch(() => {});
      udid = (await run(['xcrun', 'simctl', 'clone', golden, TAKE])).trim();
      await bootSim(udid);
    } else {
      console.log(`▶ ${clip.name}`);
      await bootSim(udid);
    }
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
    // Voice the script first (cached), so the take can wait for each line.
    const voice = (await voiceLines(work, clip)).captions;
    const tl = await record(udid, clip, raw, voice);
    await writeFile(join(work, 'timeline.json'), JSON.stringify(tl, null, 2));
    if (udid !== golden) await run(['xcrun', 'simctl', 'shutdown', udid]).catch(() => {});
    await finish(work, clip, tl);
  }
}

// ---------- audio ----------
// Everything is synthesised here or spoken by Qwen3-TTS running locally, so there is nothing to license.
const VOICE = process.env.VO_VOICE ?? 'lewis'; // a reference voice in voices/; see tts.py
// How the voice should say words it gets wrong. Applied to the spoken text only, never to captions.
const SAY_AS: [RegExp, string][] = [
  [/£(\d+)\b/g, '$1 quid'],
  [/\bPOV\b/g, 'P O V'],
  [/\bPokémon\b/gi, 'Pokemon'],
  [/\s+ex\b/g, ''], // say the Pokémon's name only
  [/\b141 of 151\b/g, 'a hundred and forty-one of a hundred and fifty-one'],
  [/\b151 set\b/g, 'one-five-one set'],
  [/\b1,025\b/g, 'ten twenty-five'],
  [/\b3D\b/g, 'three D'],
];

async function speak(lines: { out: string; text: string }[]) {
  const spoken = lines.map((l) => ({
    ...l,
    text: SAY_AS.reduce((t, [re, to]) => t.replace(re, to), l.text),
    check: l.text.replace(/£(\d+)\b/g, '$1 quid'), // what Whisper should hear
  }));
  // Cache each line by voice, reference take and exact wording; re-edits only voice what changed.
  const cacheDir = join(OUT, '.voice-cache');
  await mkdir(cacheDir, { recursive: true });
  const ref = await readFile(join(HERE, 'voices', `${VOICE}.wav`));
  const keyed = spoken.map((l) => ({
    ...l,
    cached: join(
      cacheDir,
      `${createHash('sha1')
        .update(ref)
        .update(`chatterbox:${process.env.VO_EXAGGERATION ?? '0.9'}:${process.env.VO_CFG ?? '0.4'}`)
        .update(l.text)
        .digest('hex')}.wav`,
    ),
  }));
  const missing: ((typeof keyed)[number] & { out: string })[] = [];
  for (const l of keyed) if (!(await stat(l.cached).catch(() => null))) missing.push({ ...l, out: l.cached });
  if (missing.length)
    await new Promise<void>((resolve, reject) => {
      const p = spawn('uv', ['run', '-q', join(HERE, 'tts.py'), VOICE], { stdio: ['pipe', 'inherit', 'inherit'] });
      p.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tts.py exited ${code}`))));
      p.stdin.end(JSON.stringify(missing.map(({ out, text, check }) => ({ out, text, check }))));
    });
  for (const l of keyed) await copyFile(l.cached, l.out);
}

const BPM_BEAT = 60 / 100;

// A soft lo-fi bed: four jazzy chords, a sine kick on the beat and a quiet hat on the off-beat.
function musicExpr(): string {
  const chords = [
    [130.81, 261.63, 329.63, 392.0, 493.88], // Cmaj7
    [110.0, 220.0, 261.63, 329.63, 392.0], // Am7
    [87.31, 174.61, 220.0, 261.63, 329.63], // Fmaj7
    [98.0, 196.0, 246.94, 293.66, 349.23], // G7
  ];
  const bar = BPM_BEAT * 4;
  const env = `min(1,mod(t,${bar})/0.25)*exp(-mod(t,${bar})*0.35)`;
  const pad = chords
    .map((c, i) => {
      const notes = c.map((hz, j) => `${j === 0 ? 0.5 : 0.22}*sin(2*PI*${hz}*t)`).join('+');
      return `between(mod(t,${bar * 4}),${bar * i},${bar * (i + 1)})*(${notes})`;
    })
    .join('+');
  const kick = `sin(2*PI*(48+70*exp(-mod(t,${BPM_BEAT})*28))*mod(t,${BPM_BEAT}))*exp(-mod(t,${BPM_BEAT})*9)`;
  const hat = `(random(0)*2-1)*exp(-mod(t+${BPM_BEAT / 2},${BPM_BEAT})*70)`;
  return `0.3*(${pad})*${env}+0.8*${kick}+0.1*${hat}`;
}

// Makes the raw voice sound produced, like a creator's mic: cut the rumble, lift presence and air, tame the S's,
// compress it so it sits on top of the music.
const VOICE_CHAIN =
  'aresample=48000,highpass=f=90,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=3200:t=q:w=1:g=3,' +
  'equalizer=f=9000:t=h:w=0.7:g=2,deesser=i=0.4,acompressor=threshold=0.08:ratio=3.5:attack=4:release=90:makeup=2,';

// --voice-preview: the clip's voiceover on its own, as it will sound in the edit.
async function voicePreview(clip: Clip) {
  const dir = join(OUT, 'voice-samples', `${clip.name}-lines`);
  await mkdir(dir, { recursive: true });
  const texts = [clip.hook, ...clip.steps.flatMap((s) => ('caption' in s ? [s.caption] : []))];
  const files = texts.map((_, i) => join(dir, `${String(i).padStart(2, '0')}.wav`));
  await speak(texts.map((text, i) => ({ out: files[i], text })));
  const out = join(OUT, 'voice-samples', `${clip.name}-preview.wav`);
  const chain = files.map((_, i) => `[${i}:a]${VOICE_CHAIN}apad=pad_dur=0.2[a${i}]`).join(';');
  await run([
    'ffmpeg',
    '-y',
    '-loglevel',
    'error',
    ...files.flatMap((f) => ['-i', f]),
    '-filter_complex',
    `${chain};${files.map((_, i) => `[a${i}]`).join('')}concat=n=${files.length}:v=0:a=1,loudnorm=I=-15:TP=-1.5[out]`,
    '-map',
    '[out]',
    out,
  ]);
  console.log(`  ✓ ${out}`);
  return out;
}

async function buildAudio(dir: string, clip: Clip, tl: Timeline, cues: Cue[], withVoice: boolean, out: string) {
  const co = clip.coldOpen.dur; // where the app recording starts
  const length = videoLength(clip, tl);
  const fx = [
    ['click.wav', 'sin(2*PI*1900*t)*exp(-t*110)*0.6+sin(2*PI*950*t)*exp(-t*60)*0.25', 0.08],
    ['whoosh.wav', '(random(0)*2-1)*sin(PI*t/0.4)*0.5', 0.4],
    // The short-form staples, synthesised: a sub boom on the hook, a pop as each caption lands, a riser into the
    // payoff and a bright ding when it lands.
    ['boom.wav', 'sin(2*PI*(38+90*exp(-t*9))*t)*exp(-t*3.2)*0.95+(random(0)*2-1)*exp(-t*40)*0.25', 1.4],
    ['pop.wav', 'sin(2*PI*(520+700*t*10)*t)*exp(-t*55)*0.7', 0.09],
    ['riser.wav', '(random(0)*2-1)*pow(t/1.2,2.2)*0.55+sin(2*PI*(200+500*t)*t)*pow(t/1.2,3)*0.25', 1.2],
    ['ding.wav', '(sin(2*PI*1318.5*t)+0.6*sin(2*PI*1975.5*t)+0.35*sin(2*PI*2637*t))*exp(-t*5)*0.45', 1.2],
  ] as const;
  for (const [file, expr, dur] of fx)
    await run([
      'ffmpeg',
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc='${expr}':s=44100:d=${dur}`,
      join(dir, file),
    ]);
  const inputs = ['-f', 'lavfi', '-i', `aevalsrc='${musicExpr()}':s=44100:d=${length.toFixed(3)}`];
  const f = [
    `[0:a]lowpass=f=5000,aecho=0.8:0.4:240:0.2,volume=${withVoice ? 0.32 : 0.6},afade=t=out:st=${(length - 1.2).toFixed(2)}:d=1.2[music]`,
  ];
  const parts = ['[music]'];
  const add = (file: string, at: number, gain: number, chain = '') => {
    const n = inputs.filter((x) => x === '-i').length;
    inputs.push('-i', file);
    const ms = Math.max(0, Math.round(at * 1000));
    f.push(`[${n}:a]${chain}adelay=${ms}|${ms},volume=${gain}[a${n}]`);
    parts.push(`[a${n}]`);
  };
  add(join(dir, 'boom.wav'), 0, 0.9); // the hook lands
  add(join(dir, 'whoosh.wav'), co - 0.2, 0.45); // the cut into the app
  const payoff = tl.marks[clip.coldOpen.mark];
  if (payoff !== undefined) {
    add(join(dir, 'riser.wav'), co + payoff - 1.2, 0.5);
    add(join(dir, 'ding.wav'), co + payoff, 0.7);
  }
  for (const cue of cues) add(join(dir, 'pop.wav'), cue.start, 0.45);
  for (const g of tl.gestures)
    add(join(dir, g.kind === 'tap' ? 'click.wav' : 'whoosh.wav'), co + g.t, g.kind === 'tap' ? 0.5 : 0.18);
  if (withVoice) for (const cue of cues) add(cue.file, cue.start, 1.3, VOICE_CHAIN);
  f.push(`${parts.join('')}amix=inputs=${parts.length}:normalize=0:duration=first,loudnorm=I=-15:TP=-1.5:LRA=11[out]`);
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
    '-ac',
    '2',
    '-t',
    length.toFixed(3),
    out,
  ]);
}

const videoLength = (clip: Clip, tl: Timeline) => clip.coldOpen.dur + tl.end - END_FADE + END_CARD_S;

// How long the hook and each caption line take to say, voicing (or reusing cached) lines as needed.
async function voiceLines(dir: string, clip: Clip) {
  const texts = [clip.hook, ...clip.steps.flatMap((s) => ('caption' in s ? [s.caption] : []))];
  const files = texts.map((_, i) => join(dir, `vo${i}.wav`));
  await speak(texts.map((text, i) => ({ out: files[i], text })));
  const durs: number[] = [];
  for (const f of files)
    durs.push(Number(await run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])));
  return { hook: durs[0], captions: durs.slice(1) };
}

async function finish(work: string, clip: Clip, tl: Timeline) {
  console.log(`  voicing and compositing ${clip.name}`);
  // Captions come from the current script, so wording can change without filming again.
  const script = clip.steps.flatMap((s) => ('caption' in s ? [s.caption] : []));
  tl = { ...tl, captions: tl.captions.map((c, i) => ({ ...c, text: script[i] ?? c.text })) };
  // The cold open lasts as long as the hook takes to say (within reason).
  const hookLength = (await voiceLines(work, clip)).hook;
  clip = {
    ...clip,
    coldOpen: { ...clip.coldOpen, dur: Math.min(3.6, Math.max(clip.coldOpen.dur, hookLength + 0.25)) },
  };
  const cues = await scheduleCues(work, clip, tl);
  await renderOverlays(work);
  const captions = await renderCaptionTrack(work, cues, clip.coldOpen.dur + tl.end);
  // Two cuts: with a voiceover, and music plus sound effects only (for adding a trending sound in the app instead).
  const mp4 = join(OUT, `${clip.name}.mp4`);
  const voiced = join(OUT, `${clip.name}-voiceover.mp4`);
  await buildAudio(work, clip, tl, cues, false, join(work, 'audio.wav'));
  await buildAudio(work, clip, tl, cues, true, join(work, 'audio-vo.wav'));
  await composite(work, join(work, 'raw.mp4'), tl, clip, captions, join(work, 'audio.wav'), mp4);
  await run([
    'ffmpeg',
    '-y',
    '-loglevel',
    'error',
    '-i',
    mp4,
    '-i',
    join(work, 'audio-vo.wav'),
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-shortest',
    '-movflags',
    '+faststart',
    voiced,
  ]);
  await writeCaptionFile(clip, join(OUT, `${clip.name}.txt`));
  console.log(`  ✓ ${mp4} (${videoLength(clip, tl).toFixed(1)} s)`);
}

void main().finally(() => ocr?.terminate());
