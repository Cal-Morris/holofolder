// Records short vertical demo videos of Holo Folder from an iOS Simulator and composites them for TikTok/Reels.
// Usage: bun marketing/video/record.ts [clip…] [--probe] [--reuse] [--recomposite] [--draft] [--setup]
//   --probe  run each clip's steps without recording and save a screenshot after every step (for tuning coordinates)
//   --reuse  film on the golden simulator itself instead of a fresh clone (fastest probes; state carries over)
//   --recomposite  re-edit the last recordings without the simulator; --draft  fast hardware encode
//   --setup  rebuild the golden simulator (install the app and sign in again)
// Films the installed PWA signed in as @demo (seed it first with marketing/video/seed-demo.ts).
// Needs Xcode (simctl), AXe (`brew install cameroncooke/axe/axe`) and ffmpeg. See marketing/video/README.md.
/* oxlint-disable react-doctor/async-await-in-loop, react-doctor/async-defer-await, react-doctor/js-index-maps, react-doctor/js-set-map-lookups -- one simulator driven strictly in order: every action must finish before the next check; the loops are retries over a handful of on-screen items */
import { chromium } from '@playwright/test';
import { createWorker } from 'tesseract.js';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CLIPS, DOCK, type Clip, type Step } from './clips';
import { demoPassword, withDemoKey } from './seed-demo';

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
const TOP = 340; // the caption band above the phone screen, so captions never cover the app
const SCREEN_H = H - TOP - 40;
const SCREEN_W = Math.round((PT.w * SCREEN_H) / CROP_PT / 2) * 2;
const SCREEN_X = (W - SCREEN_W) / 2;
const K = SCREEN_W / PT.w; // output px per point
const END_CARD_S = 1.4; // a short brand sting, so the video loops straight back to the hook
const END_FADE = 0.25;
const DRAFT = process.argv.includes('--draft');
const UTM = (source: string) => `https://holofolder.com/app?utm_source=${source}&utm_medium=social&utm_campaign=social`;

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
  opts: { tries?: number; before?: () => Promise<unknown>; offset?: [number, number] } = {},
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
      const [dx, dy] = opts.offset ?? [0, 0];
      const at: [number, number] = [Math.round(x / PT.scale) + dx, Math.round(y / PT.scale) + dy];
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
  // The web app can sit on a black screen for a while after a deploy (cold caches), so wait until it draws.
  // Ready once the dock's labels can be read (a blank black or white screen has none).
  for (let waited = 0; waited < 120; waited += 3) {
    const text = (await screenLines(udid)).map((l) => l.text).join(' ');
    if (/Binder/.test(text) && /Wanted/.test(text)) break;
    await sleep(3);
  }
  await sleep(4);
}

// The brightest pixel (0–255) in part of the screen, as an ffmpeg crop.
async function brightest(udid: string, crop: string) {
  const shot = join(tmpdir(), `holofolder-luma-${udid}.png`);
  await run(['xcrun', 'simctl', 'io', udid, 'screenshot', shot]);
  const out = await run([
    'ffmpeg',
    '-loglevel',
    'error',
    '-i',
    shot,
    '-vf',
    `${crop},signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-`,
    '-f',
    'null',
    '-',
  ]);
  return Number(/YMAX=(\d+)/.exec(out)?.[1] ?? 255);
}

// True while a system prompt dims the screen: the header's white "Holo Folder" title drops from ~225 to ~125.
const dimmed = async (udid: string) => (await brightest(udid, 'crop=270:60:120:276')) < 170;

// Back to a known screen: the Kanto binder, first page, with the motion prompt (holo tilt) answered off camera.
async function resetApp(udid: string) {
  await axe(udid, ['button', 'home']);
  await sleep(2);
  await run(['xcrun', 'simctl', 'terminate', udid, 'com.apple.webapp']).catch(() => {});
  await launchApp(udid);
  // The app reopens on the last view. This first touch after a launch always raises the motion prompt, which a
  // web app doesn't expose to accessibility, so answer it (Cancel) by position.
  // The prompt can take a few seconds to appear, and a missed tap leaves it over the whole take. It is invisible to
  // OCR and accessibility, but it dims the screen, so check the header title's brightness and tap Allow by position
  // until it is gone. Allow, because Cancel only lasts until Show mode asks again; it also turns on holo tilt.
  // It can turn up several seconds after the first touch, so keep looking until it has been seen and answered.
  for (let attempt = 0; attempt < 4; attempt++) {
    await tap(udid, ...DOCK.binder); // a real button, and harmless on the binder
    await sleep(3);
    if (!(await dimmed(udid))) continue;
    await tap(udid, 293, 526);
    await sleep(1.5);
    if (!(await dimmed(udid))) break;
  }
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
  let lastText: [number, number] = [0, 0];
  for (const s of steps) {
    if ('caption' in s) {
      if (now() < talkingUntil) await sleep(talkingUntil - now());
      tl.captions.push({ t: now(), text: s.caption });
      talkingUntil = now() + (voice[line++] ?? 0);
    } else if ('mark' in s) tl.marks[s.mark] = now();
    else if ('wait' in s) await sleep(s.wait);
    else if ('tap' in s) {
      const [x, y] = s.tap;
      const dur = s.hold ?? 0.12;
      await axe(udid, ['tap', '-x', `${x}`, '-y', `${y}`, ...(s.hold ? ['--hold', `${s.hold}`] : [])]);
      // AXe takes a second or so to start; it returns once the touch ends, so time the dot from there.
      tl.gestures.push({ kind: 'tap', t: now() - dur, dur, from: [x, y], to: [x, y] });
      await sleep(s.after ?? 1);
    } else if ('launch' in s) {
      await axe(udid, ['button', 'home']);
      await sleep(1.5);
      await launchApp(udid);
      await sleep(s.after ?? 1);
    } else if ('open' in s) {
      await run(['xcrun', 'simctl', 'openurl', udid, s.open]);
      await sleep(s.after ?? 1);
    } else if ('again' in s) {
      await tap(udid, ...lastText);
      tl.gestures.push({ kind: 'tap', t: now() - 0.12, dur: 0.12, from: lastText, to: lastText });
      await sleep(s.after ?? 1);
    } else if ('tapText' in s) {
      const at = await tapText(udid, s.tapText, { offset: s.offset });
      lastText = at;
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
  try {
    await perform(udid, clip.steps, now, tl, undefined, voice); // each line waits for the last one to finish
    // Let the last line finish over the final frames.
    const last = tl.captions.at(-1);
    if (last) await sleep(Math.max(0, last.t + (voice[tl.captions.length - 1] ?? 0) + 0.3 - now()));
    tl.end = now();
  } finally {
    rec.kill('SIGINT'); // stop recording even when a step fails, so no recorder is left running
    await exited;
  }
  return tl;
}

// ---------- terminal clips ----------
// The commands really run, against the API as @demo with a short-lived key, and their real output is what shows.
// The footage is drawn frame by frame in Chromium on a virtual clock, typing each command out as the voice talks.
const TERM_FPS = 30;
const TYPE_CPS = 32; // characters typed a second

// A read-only MCP token for @demo, through Holo Folder's real OAuth flow: register a public client once, open the
// authorize URL in a headless browser, sign in as @demo, approve the default (read-only) access and swap the code.
async function demoMcpToken(): Promise<string> {
  const MCP = 'https://app.holofolder.com/app/mcp';
  const meta = (await (
    await fetch('https://app.holofolder.com/.well-known/oauth-protected-resource/app/mcp')
  ).json()) as {
    authorization_servers: string[];
  };
  const as = meta.authorization_servers[0];
  const redirect = 'http://127.0.0.1:8976/callback';
  const saved = join(OUT, '.mcp-client.json');
  let client = (JSON.parse(await readFile(saved, 'utf8').catch(() => '{}')) as { client_id?: string }).client_id;
  if (!client) {
    const reg = (await (
      await fetch(`${as}/oauth/clients/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Holo Folder demo video',
          redirect_uris: [redirect],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      })
    ).json()) as { client_id: string };
    client = reg.client_id;
    await writeFile(saved, JSON.stringify({ client_id: client }));
  }
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = `${as}/oauth/authorize?${new URLSearchParams({
    client_id: client,
    redirect_uri: redirect,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'openid',
    resource: MCP,
    state: randomBytes(8).toString('hex'),
  })}`;
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ viewport: { width: 430, height: 932 } });
    let code = '';
    p.on('request', (r) => {
      if (r.url().startsWith(redirect)) code = new URL(r.url()).searchParams.get('code') ?? '';
    });
    await p.goto(authorize).catch(() => {});
    await p.waitForURL(/oauth\/consent/, { timeout: 30000 });
    const consent = p.url();
    // Wait for each page to settle before clicking: a click before hydration does nothing.
    await p.waitForLoadState('networkidle');
    await p
      .getByRole('button', { name: /sign in to holo folder/i })
      .or(p.getByRole('link', { name: /sign in to holo folder/i }))
      .first()
      .click();
    await p.waitForLoadState('networkidle');
    await p
      .getByText(/use a password instead/i)
      .first()
      .click();
    await p.locator('input[type=password]').first().waitFor();
    await p.getByRole('textbox', { name: /email/i }).first().fill('demo@holofolder.com');
    await p
      .locator('input[type=password]')
      .first()
      .fill(await demoPassword());
    await p
      .getByRole('button', { name: /^sign in$/i })
      .first()
      .click();
    await p.waitForURL((u) => !u.pathname.includes('/auth/'), { timeout: 30000 });
    await p.goto(consent).catch(() => {}); // sign-in lands on the app, not back on the consent page
    // First time, approve the default (read-only) access; once approved, the page offers to open the callback here.
    const approve = p.getByRole('button', { name: /approve access/i });
    const openHere = p
      .getByRole('button', { name: /open on this device/i })
      .or(p.getByRole('link', { name: /open on this device/i }));
    await approve.or(openHere).first().waitFor();
    await ((await approve.isVisible()) ? approve : openHere.first()).click();
    for (let i = 0; i < 40 && !code; i++) await sleep(0.25);
    if (!code) throw new Error('OAuth approval did not return a code');
    const token = (await (
      await fetch(`${as}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirect,
          client_id: client,
          code_verifier: verifier,
        }),
      })
    ).json()) as { access_token?: string };
    if (!token.access_token) throw new Error('OAuth token exchange failed');
    return token.access_token;
  } catch (error) {
    // Leave a screenshot of where the flow stopped, for the next person debugging it.
    await browser
      .contexts()[0]
      ?.pages()[0]
      ?.screenshot({ path: join(OUT, '.work', 'oauth-failed.png') })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

type AgentLine = { kind: 'tool' | 'text'; text: string };
// Runs the real Claude Code CLI on `prompt` with only Holo Folder's MCP server attached, and keeps what it did: each
// tool call and what it said. Cached by prompt in out/.agent-cache/ so a clip's narration keeps matching its footage;
// delete the cache file to ask again.
async function agentRun(prompt: string): Promise<AgentLine[]> {
  const cache = join(OUT, '.agent-cache', `${createHash('sha1').update(prompt).digest('hex')}.json`);
  const hit = await readFile(cache, 'utf8').catch(() => null);
  if (hit) return JSON.parse(hit) as AgentLine[];
  const dir = join(tmpdir(), `holofolder-agent-${process.pid}`);
  await mkdir(dir, { recursive: true });
  const config = join(dir, 'mcp.json');
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: {
        holofolder: {
          type: 'http',
          url: 'https://app.holofolder.com/app/mcp',
          headers: { Authorization: `Bearer ${await demoMcpToken()}` },
        },
      },
    }),
    { mode: 0o600 },
  );
  try {
    const out = execFileSync(
      'claude',
      [
        '-p',
        prompt,
        '--mcp-config',
        config,
        '--strict-mcp-config',
        '--allowedTools',
        'mcp__holofolder',
        '--output-format',
        'stream-json',
        '--verbose',
      ],
      { cwd: dir, input: '', maxBuffer: 64 * 1024 * 1024, timeout: 300000 },
    ).toString();
    const lines: AgentLine[] = [];
    for (const raw of out.split('\n')) {
      const m = (() => {
        try {
          return JSON.parse(raw) as {
            type?: string;
            message?: { content?: { type: string; name?: string; text?: string }[] };
          };
        } catch {
          return null;
        }
      })();
      if (m?.type !== 'assistant') continue;
      for (const c of m.message?.content ?? []) {
        if (c.type === 'tool_use' && c.name?.startsWith('mcp__holofolder__'))
          lines.push({ kind: 'tool', text: c.name.slice(17) });
        if (c.type === 'text' && c.text) lines.push({ kind: 'text', text: c.text.replace(/\*\*/g, '').trim() });
      }
    }
    await mkdir(join(OUT, '.agent-cache'), { recursive: true });
    await writeFile(cache, JSON.stringify(lines, null, 2));
    return lines;
  } finally {
    await rm(dir, { recursive: true, force: true }); // the token never outlives the run
  }
}

async function recordTerminal(clip: Clip, raw: string, voice: number[]): Promise<Timeline> {
  const cmds = clip.steps.flatMap((s) => ('cmd' in s ? [s] : []));
  const agents: AgentLine[][] = [];
  for (const s of clip.steps) if ('agent' in s) agents.push(await agentRun(s.agent));
  const outputs = !cmds.length
    ? []
    : await withDemoKey(async (key) => {
        const env = { ...process.env, HF: 'https://app.holofolder.com/app/api/v1', HF_KEY: key };
        const results: string[] = [];
        for (const c of cmds) {
          // A brand-new key or a cold API can return nothing for a moment, so give each command a few tries.
          let out = '';
          for (let attempt = 0; attempt < 4; attempt++) {
            out = execFileSync('zsh', ['-c', c.cmd], { env }).toString().trimEnd();
            if (!c.expect || out.includes(c.expect)) break;
            await sleep(4);
          }
          if (c.expect && !out.includes(c.expect))
            throw new Error(`Expected "${c.expect}" from:\n${c.cmd}\ngot:\n${out}`);
          results.push(out);
        }
        return results;
      });
  // Lay the steps out on a clock: a line of voice holds the next line back, as in perform().
  const tl: Timeline = { marks: {}, captions: [], gestures: [], end: 0 };
  // Each command is typed out, then its output appears, line by line for an agent as it works.
  const shown: { cmd: string; at: number; outAt: number; out: { html: string; at: number }[] }[] = [];
  let t = 0.5;
  let talkingUntil = 0;
  let line = 0;
  for (const s of clip.steps) {
    if ('caption' in s) {
      t = Math.max(t, talkingUntil);
      tl.captions.push({ t, text: s.caption });
      talkingUntil = t + (voice[line++] ?? 0);
    } else if ('mark' in s) tl.marks[s.mark] = t;
    else if ('wait' in s) t += s.wait;
    else if ('cmd' in s) {
      const outAt = t + s.cmd.length / TYPE_CPS + 0.45;
      const out = outputs[shown.filter((x) => !x.cmd.startsWith('claude')).length];
      shown.push({ cmd: s.cmd, at: t, outAt, out: [{ html: `<div class="o">${escapeHtml(out)}</div>`, at: outAt }] });
      t = outAt + (s.after ?? 1);
    } else if ('agent' in s) {
      const cmd = `claude "${s.agent}"`;
      const outAt = t + cmd.length / TYPE_CPS + 0.6;
      let at = outAt;
      const out: { html: string; at: number }[] = [];
      for (const l of agents[shown.filter((x) => x.cmd.startsWith('claude')).length]) {
        if (l.kind === 'tool') {
          out.push({ html: `<div class="tool">● holofolder · ${escapeHtml(l.text)}</div>`, at });
          at += 0.9;
        } else
          for (const row of l.text.split('\n').filter((r) => !/^\|[-| ]+\|$/.test(r.trim()))) {
            out.push({ html: `<div class="say">${escapeHtml(row) || '&nbsp;'}</div>`, at });
            at += 0.14;
          }
      }
      shown.push({ cmd, at: t, outAt, out });
      t = outAt + (s.after ?? 1);
    }
  }
  const last = tl.captions.at(-1);
  tl.end = Math.max(t, last ? last.t + (voice[tl.captions.length - 1] ?? 0) + 0.3 : 0);

  const width = PT.w * PT.scale;
  const height = CROP_PT * PT.scale;
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width, height } });
  await p.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;width:${width}px;height:${height}px;background:#101014;color:#e8e6f0;overflow:hidden;
      font:600 52px/1.35 "SF Mono",Menlo,monospace;-webkit-font-smoothing:antialiased}
    #bar{height:${60 * PT.scale}px}
    #t{position:absolute;left:48px;right:40px;bottom:${150 * PT.scale}px;white-space:pre-wrap;overflow-wrap:anywhere}
    .p{color:#9d8cff}.o{color:#8fe3b0;margin:12px 0 44px}.c{background:#e8e6f0;color:#101014}
    .tool{color:#7fd4e0;margin:6px 0}.say{color:#f1effa;font-weight:500}
  </style></head><body><div id="bar"></div><div id="t"></div></body></html>`);
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-framerate',
    `${TERM_FPS}`,
    '-i',
    '-',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '14',
    '-pix_fmt',
    'yuv420p',
    raw,
  ]);
  const done = new Promise((r) => ffmpeg.once('exit', r));
  for (let f = 0; f <= tl.end * TERM_FPS; f++) {
    const now = f / TERM_FPS;
    const html = shown
      .flatMap((c) => {
        if (c.at > now) return [];
        const typed = Math.min(c.cmd.length, Math.floor((now - c.at) * TYPE_CPS));
        const cursor = now < c.outAt && Math.floor(now * 2) % 2 === 0 ? '<span class="c"> </span>' : '';
        const out = c.out
          .filter((o) => o.at <= now)
          .map((o) => o.html)
          .join('');
        return [`<div><span class="p">$ </span>${escapeHtml(c.cmd.slice(0, typed))}${cursor}</div>${out}`];
      })
      .join('');
    const idle = shown.every((c) => now >= (c.out.at(-1)?.at ?? c.outAt))
      ? `<div><span class="p">$ </span>${Math.floor(now * 2) % 2 ? '' : '<span class="c"> </span>'}</div>`
      : '';
    await p.evaluate((h) => (document.getElementById('t')!.innerHTML = h), html + idle);
    ffmpeg.stdin.write(await p.screenshot({ type: 'jpeg', quality: 95 }));
  }
  ffmpeg.stdin.end();
  await done;
  await browser.close();
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
// Captions sit in their own band above the phone (below TikTok's top tabs), so the whole app stays visible: a few
// words at a time, bold, with the word being spoken in the accent colour. The hook shows whole.
const captionHtml = (words: string[], active: number, hook: boolean) =>
  page(
    `<div style="position:absolute;left:56px;right:56px;top:150px;height:${TOP - 172}px;display:flex;align-items:flex-end;justify-content:center;text-align:center">
      <div style="font-size:${hook ? 56 : 62}px;font-weight:900;line-height:1.1;letter-spacing:-1px;text-wrap:balance">${words
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

// The marketing site's backdrop: deep navy with soft holographic streaks (teal, violet, amber, rose). Rendered
// larger than the frame so the edit can drift it slowly behind the phone.
const AURORA = { w: 1440, h: 2560 };
const auroraHtml = () =>
  `<!doctype html><html><body style="margin:0;width:${AURORA.w}px;height:${AURORA.h}px;background:#0b0b16;overflow:hidden">
  <div style="position:absolute;inset:0;filter:blur(90px) saturate(1.15)">
    ${[
      ['8%', '6%', 900, 520, '#2f8f95', 0.55, -18],
      ['46%', '18%', 1000, 420, '#6b4fd6', 0.55, 24],
      ['-10%', '38%', 1100, 380, '#c8834a', 0.35, -30],
      ['40%', '55%', 900, 460, '#3a6fb0', 0.5, 15],
      ['5%', '72%', 1000, 420, '#8a4fc0', 0.45, -12],
      ['55%', '82%', 800, 360, '#d06a8a', 0.3, 28],
    ]
      .map(
        ([left, top, w, h, c, o, r]) =>
          `<div style="position:absolute;left:${left};top:${top};width:${w}px;height:${h}px;border-radius:50%;background:${c};opacity:${o};transform:rotate(${r}deg)"></div>`,
      )
      .join('')}
  </div>
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,transparent 30%,rgba(5,5,12,.55) 100%)"></div>
</body></html>`;
// The backdrop's slow drift, as an ffmpeg crop of the larger render.
const AURORA_DRIFT = `crop=${W}:${H}:x='${(AURORA.w - W) / 2}+${(AURORA.w - W) / 2 - 10}*sin(t/7)':y='${(AURORA.h - H) / 2}+${(AURORA.h - H) / 2 - 10}*sin(t/9)'`;

const endCardHtml = (icon: string, aurora: string) =>
  page(
    `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center">
    <img src="${icon}" style="width:230px;height:230px;border-radius:52px">
    <div style="font-size:96px;font-weight:800;letter-spacing:-2px">Holo Folder</div>
    <div style="font-size:52px;font-weight:600;color:#c9c3ff">holofolder.com</div>
  </div>
  <div style="position:absolute;left:80px;right:80px;bottom:110px;text-align:center;font-size:27px;line-height:1.4;color:rgba(255,255,255,.55)">
    Not affiliated with The Pokémon Company. Card images © The Pokémon Company, Nintendo, Creatures and GAME FREAK.</div>`,
    `#0b0b16 url(${aurora}) center/cover`,
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
  await p.setViewportSize({ width: AURORA.w, height: AURORA.h });
  await p.setContent(auroraHtml());
  await p.screenshot({ path: join(dir, 'aurora.png') });
  await p.setViewportSize({ width: W, height: H });
  await shot(maskHtml(), 'mask.png');
  await shot(frameHtml(), 'frame.png');
  const icon = `data:image/png;base64,${(await readFile(join(ROOT, 'public/holofolder-icon-1024.png'))).toString('base64')}`;
  const aurora = `data:image/png;base64,${(await readFile(join(dir, 'aurora.png'))).toString('base64')}`;
  await shot(endCardHtml(icon, aurora), 'end.png');
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
    free = start + dur;
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
    const per = cue.hook ? words.length : 6; // the hook stays whole; other lines show up to six words (two lines)
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
  inputs.push('-loop', '1', '-framerate', '60', '-t', (total + co.dur).toFixed(3), '-i', join(dir, 'aurora.png'));
  const f: string[] = [];
  const cropPx = CROP_PT * PT.scale;
  f.push(`[3:v]${AURORA_DRIFT},format=rgba,split[bgall][cbgall]`);
  f.push(`[bgall]trim=start=${co.dur.toFixed(3)}:duration=${total.toFixed(3)},setpts=PTS-STARTPTS[bg]`);
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
  f.push(`[cbgall]trim=duration=${co.dur},setpts=PTS-STARTPTS[cbg]`, `[cos][mc]alphamerge[cosm]`);
  f.push(`[cbg][cosm]overlay=0:0[co0]`, `[co0][frc]overlay=0:0[co1]`);
  f.push(`[co1]trim=duration=${co.dur},fps=60,settb=1/60,format=yuv420p,setsar=1[cold]`);
  let last = 'v1';
  let n = 4;
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
  // A baked-in track's licence line sits next to it as music/<clip>.txt (or default.txt) and goes in the post.
  const credit = [`${clip.name}.txt`, 'default.txt'].map((f) => join(HERE, 'music', f));
  const musicCredit = (
    await readFile(credit[0], 'utf8').catch(() => readFile(credit[1], 'utf8').catch(() => ''))
  ).trim();
  await writeFile(
    file,
    [
      '# TikTok (short caption, the hook first, then a question to start the comments)',
      `${clip.hook.replace(/[.!?]*$/, '.')} ${clip.question} ${clip.tags.split(' ').slice(0, 4).join(' ')}`,
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
      'Voice: synthesised locally, cloned from the VCTK corpus (CC BY 4.0, CSTR, University of Edinburgh).',
      musicCredit,
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
  // One failed clip (a missed tap, a slow load) shouldn't lose the rest of the run.
  const failed: string[] = [];
  const film = async (clip: Clip) => {
    const work = join(OUT, '.work', clip.name);
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    if (clip.terminal) {
      console.log(`▶ ${clip.name}: terminal`);
      const tl = await recordTerminal(clip, join(work, 'raw.mp4'), (await voiceLines(work, clip)).captions);
      await writeFile(join(work, 'timeline.json'), JSON.stringify(tl, null, 2));
      await finish(work, clip, tl);
      return;
    }
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
      return;
    }
    const raw = join(work, 'raw.mp4');
    console.log('  recording');
    // Voice the script first (cached), so the take can wait for each line.
    const voice = (await voiceLines(work, clip)).captions;
    const tl = await record(udid, clip, raw, voice);
    await writeFile(join(work, 'timeline.json'), JSON.stringify(tl, null, 2));
    if (udid !== golden) await run(['xcrun', 'simctl', 'shutdown', udid]).catch(() => {});
    await finish(work, clip, tl);
  };
  for (const clip of clips)
    await film(clip).catch((error: unknown) => {
      console.error(`  ✗ ${clip.name}: ${error instanceof Error ? error.message : error}`);
      failed.push(clip.name);
    });
  if (failed.length) {
    process.exitCode = 1;
    console.error(`Failed: ${failed.join(' ')}`);
  }
}

// ---------- audio ----------
// Everything is synthesised here or spoken by Qwen3-TTS running locally, so there is nothing to license.
// The narrator is cloned from voices/<VOICE>.wav; see tts.py and voices/README.md.
const VOICE = process.env.VO_VOICE ?? 'york';
const ONES =
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(
    ' ',
  );
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
// 0–999 as a British speaker says it: "a hundred and fifty", "seventy-five".
function numberWords(n: number): string {
  if (n >= 100)
    return `${n < 200 ? 'a' : ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${numberWords(n % 100)}` : ''}`;
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}
// How the voice should say words it gets wrong. Applied to the spoken text only, never to captions.
const SAY_AS: [RegExp, string | ((m: string, n: string) => string)][] = [
  [/£(\d{1,3})\b/g, (_, n) => `${numberWords(Number(n))} quid`],
  [/\bPOV\b/g, 'P O V'],
  [/\bPokémon\b/gi, 'Pokemon'],
  [/\s+ex\b/g, ''], // say the Pokémon's name only
  [/\b151\b/g, 'one-five-one'],
  [/\b3D\b/g, 'three D'],
  [/\b(\d{1,3})\b(?!,\d)/g, (_, n) => numberWords(Number(n))],
];
const say = (text: string) =>
  SAY_AS.reduce(
    (t, [re, to]) => t.replace(re, to as string),
    text.replace(/(?<!^)\b([A-Z]{2,})\b/g, (w) => (w === 'POV' ? w : w.toLowerCase())),
  );

// The clip's whole script is voiced as one take (tts.py) and cut back into a file per line. Cached by voice and
// exact wording, so re-edits only voice a clip again when its script changes.
async function speak(lines: { out: string; text: string }[]) {
  const spoken = lines.map((l) => say(l.text));
  const ref = await readFile(join(HERE, 'voices', `${VOICE}.wav`));
  const key = createHash('sha1')
    .update(ref)
    .update('qwen3-base-untrimmed')
    .update(JSON.stringify(spoken))
    .digest('hex');
  const cacheDir = join(OUT, '.voice-cache', key);
  const cached = spoken.map((_, i) => join(cacheDir, `${i}.wav`));
  if (!(await stat(cached.at(-1)!).catch(() => null))) {
    await mkdir(cacheDir, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const p = spawn('uv', ['run', '-q', join(HERE, 'tts.py'), VOICE], { stdio: ['pipe', 'inherit', 'inherit'] });
      p.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tts.py exited ${code}`))));
      p.stdin.end(JSON.stringify(spoken.map((text, i) => ({ out: cached[i], text }))));
    });
  }
  for (const [i, l] of lines.entries()) await copyFile(cached[i], l.out);
}

// The voice goes in as generated, unprocessed: the take you hear in the voice samples is the take in the video.
const VOICE_CHAIN = 'aresample=48000,';

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

const BEAT = 60 / 80; // 80 BPM

// The default bed: slow, warm lo-fi made right here, so there is nothing to license. Four soft seventh chords that
// swell in and drift a little in pitch (tape wow), a gentle kick on 1 and 3, a brushed snare on 2 and 4, quiet
// swung hats and a little vinyl crackle. It is lowpassed afterwards so it stays in the background.
function lofiExpr(): string {
  const chords = [
    [87.31, 174.61, 220.0, 261.63, 329.63], // Fmaj7
    [82.41, 164.81, 196.0, 246.94, 293.66], // Em7
    [73.42, 146.83, 174.61, 220.0, 261.63], // Dm7
    [65.41, 130.81, 164.81, 196.0, 246.94], // Cmaj7
  ];
  const bar = BEAT * 4;
  const wow = '(1+0.003*sin(2*PI*0.4*t))';
  const swell = `min(1,mod(t,${bar})/0.6)*(0.55+0.45*exp(-mod(t,${bar})*0.5))`;
  const pad = chords
    .map((c, i) => {
      const notes = c.map((hz, j) => `${j === 0 ? 0.45 : 0.18}*sin(2*PI*${hz}*${wow}*t)`).join('+');
      return `between(mod(t,${bar * 4}),${bar * i},${bar * (i + 1)})*(${notes})`;
    })
    .join('+');
  const two = BEAT * 2;
  const kick = `sin(2*PI*(45+55*exp(-mod(t,${two})*30))*mod(t,${two}))*exp(-mod(t,${two})*8)`;
  const snare = `(random(0)*2-1)*exp(-mod(t+${BEAT},${two})*22)`;
  const hat = `(random(1)*2-1)*exp(-mod(t+${BEAT * 0.58},${BEAT})*90)`; // swung off-beat
  const crackle = '(gt(random(2),0.9993))*(random(3)*2-1)';
  return `0.32*(${pad})*${swell}+0.55*${kick}+0.07*${snare}+0.035*${hat}+0.25*${crackle}`;
}

// Narration over a music bed, with no sound effects. The bed is the lo-fi above unless a track you have the rights to
// is at music/<clip>.mp3 or music/default.mp3 (its licence line in music/<clip>.txt goes into the post copy). The
// music sits well under the voice and dips further while the narrator talks.
async function buildAudio(clip: Clip, cues: Cue[], length: number, out: string) {
  const track = [join(HERE, 'music', `${clip.name}.mp3`), join(HERE, 'music', 'default.mp3')];
  const music = (await stat(track[0]).catch(() => null))
    ? track[0]
    : (await stat(track[1]).catch(() => null))
      ? track[1]
      : null;
  const inputs = ['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${length.toFixed(3)}`];
  const f: string[] = [];
  const voices = cues.map((cue, i) => {
    inputs.push('-i', cue.file);
    const ms = Math.round(cue.start * 1000);
    f.push(`[${i + 1}:a]${VOICE_CHAIN}adelay=${ms}|${ms}[v${i}]`);
    return `[v${i}]`;
  });
  f.push(`[0:a]${voices.join('')}amix=inputs=${voices.length + 1}:normalize=0:duration=first[vo]`);
  const n = cues.length + 1;
  if (music) inputs.push('-stream_loop', '-1', '-i', music);
  else inputs.push('-f', 'lavfi', '-i', `aevalsrc='${lofiExpr()}':s=48000:d=${length.toFixed(3)}`);
  const colour = music ? '' : 'lowpass=f=2600,aecho=0.8:0.5:180:0.15,';
  f.push(`[vo]asplit[vo1][key]`);
  f.push(
    `[${n}:a]aresample=48000,${colour}atrim=0:${length.toFixed(3)},volume=${music ? 0.3 : 0.45},` +
      `afade=t=in:d=0.6,afade=t=out:st=${(length - 1.5).toFixed(2)}:d=1.5[bed]`,
  );
  f.push(`[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=500[ducked]`);
  f.push(`[ducked][vo1]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11[out]`);
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
  const mp4 = join(OUT, `${clip.name}.mp4`);
  await buildAudio(clip, cues, videoLength(clip, tl), join(work, 'audio.wav'));
  await composite(work, join(work, 'raw.mp4'), tl, clip, captions, join(work, 'audio.wav'), mp4);
  await writeCaptionFile(clip, join(OUT, `${clip.name}.txt`));
  console.log(`  ✓ ${mp4} (${videoLength(clip, tl).toFixed(1)} s)`);
}

void main().finally(() => ocr?.terminate());
