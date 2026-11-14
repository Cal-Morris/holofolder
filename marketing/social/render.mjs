// Social images for Holo Folder posts: Instagram 4:5 carousels, X 16:9 cards and TikTok 9:16 photo slides.
//
//   node marketing/social/render.mjs capture   # screenshots of the public showcase binders (390x844, en-GB)
//   node marketing/social/render.mjs render    # every slide as JPEG, plus contact-sheet.html
//   node marketing/social/render.mjs upload    # JPEGs to R2 under marketing/social/<yyyy-mm>/ (needs R2_* env)
//
// Output goes to marketing/social/out/ (git-ignored). Copy on the slides comes from the published blog posts;
// keep it that way, and never put prices or card data on a slide that the app or the post doesn't show.
/* oxlint-disable react-doctor/async-await-in-loop -- one browser and one upload at a time, on purpose */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = process.env.SOCIAL_OUT || join(HERE, 'out');
const SHOTS = join(OUT, 'shots');
const MONTH = process.env.SOCIAL_MONTH || '2026-11';
const PUBLIC_BASE = 'https://assets.holofolder.com';
const SHOWCASE = 'https://holofolder.com/@showcase';
const CARD = 'https://assets.holofolder.com/pokemon/tcg/cards/src/malie/tcgl/me6';
const MARK = `data:image/png;base64,${readFileSync(join(HERE, '../../public/holofolder-mark.png')).toString('base64')}`;

const FORMATS = {
  ig: { width: 1080, height: 1350 },
  x: { width: 1600, height: 900 },
  tiktok: { width: 1080, height: 1920 },
};

// Visuals: phone = full app screenshot in a plain frame, panel = cropped screenshot, cards = mirror card images.
const phone = (shot) => ({ phone: shot });
const DR138 = `${CARD}/me6_en_138_std.webp`,
  DR141 = `${CARD}/me6_en_141_std.webp`;
const panel = (shot) => ({ panel: shot });

const POSTS = [
  {
    slug: 'holo-folder-launch',
    eyebrow: 'Now live',
    title: 'Your real binder, page by page.',
    sub: 'Track the exact cards you own and want, laid out like real binder pages and priced in pounds.',
    visual: panel('binder-pikachu'),
    cta: { title: 'Start your binder', sub: 'holofolder.com · link in bio' },
    points: [
      {
        title: 'Track the exact card',
        body: 'Every card records its set, number, language and finish, so a reverse holo and a regular print are never confused.',
        visual: panel('price'),
      },
      {
        title: 'Fill a National Dex',
        body: 'One Pokémon per pocket, and you choose the printing. Empty pockets show your gaps at a glance.',
        visual: phone('list-dex'),
      },
      {
        title: 'Take it to a show',
        body: 'Look up any card by search or scan and check the ask against labelled evidence. Saved cards and prices work without signal.',
      },
    ],
  },
  {
    slug: 'pokemon-delta-reign-set-guide',
    eyebrow: 'Set guide',
    title: 'Delta Reign is out.',
    sub: 'Released on 6 November 2026, with Mega Rayquaza ex leading the set.',
    visual: { cards: [DR138, DR141] },
    cta: { title: 'Read the set guide', sub: 'holofolder.com/blog · link in bio' },
    points: [
      {
        title: '103 cards, 141 numbered',
        body: 'Our catalogue records 103 cards in the printed base numbering and 141 numbered entries, counting the cards beyond it.',
        visual: phone('sets'),
      },
      {
        title: 'One name, two printings',
        body: 'Mega Rayquaza ex 138/103 is the Special Illustration Rare and 141/103 is the Mega Hyper Rare. Match the number before you compare prices.',
        visual: { cards: [DR138, DR141], labels: ['138/103 · Special Illustration Rare', '141/103 · Mega Hyper Rare'] },
      },
      {
        title: 'Give it its own binder',
        body: 'Browse Sets, search for Delta Reign and add the exact printings you want, kept apart from your Dex or trade cards.',
        visual: panel('binder-evolution'),
      },
    ],
  },
  {
    slug: 'national-dex-vs-master-set',
    eyebrow: 'Collecting guide',
    title: 'National Dex or master set?',
    sub: 'One card for every Pokémon, or every card in a release. Pick a goal you will enjoy finishing.',
    visual: phone('list-dex'),
    cta: { title: 'Which one are you building?', sub: 'Full guide on holofolder.com/blog' },
    points: [
      {
        title: 'A National Dex follows the Pokémon',
        body: 'Each species gets a pocket and you choose the printing that fills it, old favourites and modern art side by side.',
        visual: phone('list-dex'),
      },
      {
        title: 'A master set follows a release',
        body: 'Decide up front whether it includes alternate finishes, promos and extras. Collectors use the term differently.',
        visual: phone('sets'),
      },
      {
        title: 'Pick the rule that makes buying easier',
        body: 'Does this card fill a species gap, or a missing printing in the set? Named binders keep separate goals apart.',
        visual: panel('binder-base'),
      },
    ],
  },
  {
    slug: 'understand-card-price-confidence',
    eyebrow: 'Price guide',
    title: 'Read a card price with confidence.',
    sub: 'Check the source, freshness and coverage behind the number before you trust it.',
    visual: panel('price'),
    cta: { title: 'Read the price guide', sub: 'holofolder.com/blog' },
    points: [
      {
        title: 'Confidence is about the evidence',
        body: 'A catalogue estimate, an asking listing and a recorded sale describe different things. Unknown prices stay unknown.',
        visual: panel('price'),
      },
      {
        title: 'Freshness is about when',
        body: 'Check the quote date. Opening a saved price does not make it fresh.',
      },
      {
        title: 'A trend needs context',
        body: 'A rising line describes the recorded data, not every sale. Treat it as a reason to look closer, not a forecast.',
      },
    ],
  },
  {
    slug: 'pokemon-card-show-checklist',
    eyebrow: 'Card show checklist',
    title: 'Card show this weekend?',
    sub: 'Make a hunting list, prepare offline and check the evidence before you make an offer.',
    visual: panel('price'),
    checklist: [
      'Hunting list of exact printings',
      'Binder saved for offline',
      'Match the printing first',
      'Compare sold evidence to the ask',
    ],
    cta: { title: 'Read the checklist', sub: 'holofolder.com/blog' },
    points: [
      {
        title: 'Make the list useful',
        body: 'Add the exact cards you want, not just the Pokémon. Set, number, language and finish separate a target from a lookalike.',
        visual: phone('list-dex'),
      },
      {
        title: 'Prepare for the hall Wi-Fi',
        body: 'Save your binder for offline while you are still connected, then reopen the app without signal to check it.',
      },
      {
        title: 'Match first, then compare',
        body: 'Confirm the printing and condition, then compare sold evidence with the ask. Walking away is a valid outcome.',
        visual: panel('price'),
      },
    ],
  },
  {
    slug: 'inside-holo-folder-mcp-server',
    eyebrow: 'For developers',
    title: 'Your collection, in your AI assistant.',
    sub: 'The Holo Folder MCP server gives compatible assistants the same 70 tools as our REST API.',
    visual: {
      prompt: 'Switch my Base Set binder to 3×4 pages. Tell me which cards move before you change anything.',
      tools: ['set_binder_layout', 'identify_card', 'check_deal', 'suggest_cards'],
    },
    cta: { title: 'Connect an assistant', sub: 'holofolder.com/blog' },
    points: [
      {
        title: 'From a screenshot to a binder',
        body: 'Drop in a screenshot of a trade list. Your assistant finds each exact printing and shows you the list before adding anything.',
      },
      {
        title: 'Rearrange without touching a sleeve',
        body: 'Layout changes run as a dry run first. Applying one is a single change in Activity, and you can undo it in the app.',
        visual: panel('binder-base'),
      },
      {
        title: 'You stay in control',
        body: 'Sign in with OAuth, start with read access and approve writes. Missing prices stay missing.',
      },
    ],
  },
  {
    slug: 'organise-pokemon-card-collection-binders',
    eyebrow: 'Collecting guide',
    title: 'A collection you can find things in.',
    sub: 'Named binders, owned and wanted kept apart, and the exact printing for every slot.',
    visual: panel('binder-erikas'),
    cta: { title: 'Read the guide', sub: 'holofolder.com/blog · link in bio' },
    points: [
      {
        title: 'Give each binder one job',
        body: 'A Dex binder, a trade binder or one for a favourite illustrator is easier to keep up than one binder for everything.',
        visual: panel('binder-evolution'),
      },
      {
        title: 'Record the exact printing',
        body: 'Set, number, language and finish, so your collection matches what is actually in the sleeve.',
        visual: panel('price'),
      },
      {
        title: 'Keep owned and wanted apart',
        body: 'A want is a plan. An owned card is a fact. Keeping them separate keeps your want list honest.',
        visual: phone('list-dex'),
      },
    ],
  },
  {
    slug: 'getting-back-into-pokemon-cards',
    eyebrow: 'Returning collectors',
    title: 'Getting back into Pokémon cards?',
    sub: 'Catch up on what changed, take stock of what you own and pick a goal before you buy.',
    visual: phone('sets'),
    cta: { title: 'Read the guide', sub: 'holofolder.com/blog · link in bio' },
    points: [
      {
        title: 'Start with what you own',
        body: 'Search or scan your old cards, confirm each printing and add them to a binder. You may be closer to a goal than you think.',
        visual: panel('binder-base'),
      },
      {
        title: 'Browse sets at your own pace',
        body: 'See what released while you were away, read a set guide or two, then add the cards you genuinely like as wants.',
        visual: phone('sets'),
      },
      {
        title: 'Pick one goal for now',
        body: 'A National Dex, a favourite Pokémon or a single era. A narrow goal keeps spending in check.',
      },
    ],
  },
  {
    slug: 'collect-pokemon-cards-with-a-partner',
    eyebrow: 'Collect together',
    title: 'Collect together without the duplicates.',
    sub: 'Share one collection, keep the want list clear and stop buying the same card twice.',
    visual: panel('binder-gold'),
    cta: { title: 'Read the guide', sub: 'holofolder.com/blog · link in bio' },
    points: [
      {
        title: 'Agree what you share',
        body: 'Partner Mode lets someone edit the owner’s collection and binders. A read-only binder link is for people who only browse.',
        visual: panel('binder-pikachu'),
      },
      {
        title: 'Record printings, not just names',
        body: 'One of you may own a Pokémon while the other hunts a particular illustration. Check set and number before calling it a duplicate.',
      },
      {
        title: 'Plan for a phone with no signal',
        body: 'Offline edits queue and sync later. Give both phones time to catch up before entering the same purchase again.',
      },
    ],
  },
];

// ---------------------------------------------------------------- capture

async function capture() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    colorScheme: 'dark',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  });
  const open = async (slug) => {
    const page = await ctx.newPage();
    await page.goto(`${SHOWCASE}/${slug}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    return page;
  };
  // The binder page is the box around every card image.
  const binderPanel = async (page, name) => {
    const box = await page.locator('main img').evaluateAll((imgs) => {
      const r = [];
      for (const img of imgs) {
        const b = img.getBoundingClientRect();
        if (b.width > 40) r.push(b);
      }
      const x = Math.min(...r.map((b) => b.left)),
        y = Math.min(...r.map((b) => b.top));
      return { x, y, width: Math.max(...r.map((b) => b.right)) - x, height: Math.max(...r.map((b) => b.bottom)) - y };
    });
    const pad = 6;
    await page.screenshot({
      path: join(SHOTS, `${name}.png`),
      clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 },
    });
  };
  const tab = async (page, name) => {
    await page.getByRole('button', { name, exact: true }).first().click();
    await page.waitForTimeout(3500);
  };

  for (const [showcase, name] of [
    ['pikachu-party', 'pikachu'],
    ['erikas-garden', 'erikas'],
    ['gold-stars', 'gold'],
    ['base-set-classics', 'base'],
    ['evolution-lines', 'evolution'],
  ]) {
    const page = await open(showcase);
    await binderPanel(page, `binder-${name}`);
    if (name === 'evolution') {
      await tab(page, 'List');
      await page.screenshot({ path: join(SHOTS, 'list-dex.png') });
    }
    if (name === 'base') {
      await tab(page, 'Browse');
      await page.screenshot({ path: join(SHOTS, 'sets.png') });
    }
    if (name === 'pikachu') {
      // Card detail for a high-confidence price, with the price evidence expanded.
      await page.locator('main img').nth(5).click();
      await page.waitForTimeout(3000);
      await page.getByText('Price details', { exact: true }).first().click();
      await page.waitForTimeout(1500);
      // Crop the sheet from its top to just above "Similar look".
      const sheet = await page.getByRole('dialog').first().boundingBox();
      const similar = await page
        .getByText(/similar look/i)
        .first()
        .boundingBox();
      await page.screenshot({ path: join(SHOTS, 'price.png'), clip: { ...sheet, height: similar.y - sheet.y - 8 } });
    }
    await page.close();
  }
  await browser.close();
  console.log('screenshots in', SHOTS);
}

// ---------------------------------------------------------------- render

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shotUrl = (name) => `file://${join(SHOTS, `${name}.png`)}`;

function visualHtml(v) {
  if (!v) return '';
  if (v.phone) return `<div class="visual"><div class="phone"><img src="${shotUrl(v.phone)}"></div></div>`;
  if (v.panel) return `<div class="visual"><img class="panel" src="${shotUrl(v.panel)}"></div>`;
  if (v.labels)
    return `<div class="visual cards flat">${v.cards
      .map((c, i) => `<figure><img class="card" src="${c}"><figcaption>${esc(v.labels[i])}</figcaption></figure>`)
      .join('')}</div>`;
  if (v.cards) return `<div class="visual cards">${v.cards.map((c) => `<img class="card" src="${c}">`).join('')}</div>`;
  if (v.prompt)
    return `<div class="visual"><div class="prompt"><div class="bubble">${esc(v.prompt)}</div><div class="tools">${v.tools
      .map((t) => `<span class="chip">${esc(t)}</span>`)
      .join('')}</div><div class="tools-note">4 of the 70 tools</div></div></div>`;
  return '';
}

const showsCardArt = (v) => Boolean(v && (v.phone || v.panel || v.cards));

function slideHtml(format, post, slide, index, total) {
  const { width, height } = FORMATS[format];
  const art = showsCardArt(slide.visual);
  const count = total > 1 ? `<span class="count">${index + 1}/${total}</span>` : '';
  let body;
  if (slide.kind === 'cover') {
    body = `<div class="eyebrow">${esc(post.eyebrow)}</div><h1>${esc(post.title)}</h1><p class="sub">${esc(post.sub)}</p>${
      format === 'x' && post.checklist
        ? `<ul class="check">${post.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
        : ''
    }`;
  } else if (slide.kind === 'point') {
    body = `<div class="num">0${slide.n}</div><h2>${esc(slide.title)}</h2><p class="body">${esc(slide.body)}</p>`;
  } else {
    body = `<div class="eyebrow">${esc(post.eyebrow)}</div><h1>${esc(post.cta.title)}</h1><p class="sub accent">${esc(post.cta.sub)}</p><p class="sub small">Browse a showcase binder without an account at holofolder.com/collections</p>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=block" rel="stylesheet">
<style>${CSS}</style></head>
<body class="${format} ${slide.kind}${slide.visual ? ' has-visual' : ''}" style="width:${width}px;height:${height}px">
<header><div class="brand"><img src="${MARK}">Holo Folder</div>${count}</header>
<main><div class="text">${body}</div>${visualHtml(slide.visual)}</main>
<footer><span>holofolder.com</span>${art ? '<span>Not affiliated with The Pokémon Company</span>' : ''}</footer>
</body></html>`;
}

const CSS = `
:root { --bg:#07070a; --card:#111116; --fg:#f4f3f8; --muted:#a3a1b3; --accent:#b9a6ff; --line:rgba(244,243,248,.10); }
* { box-sizing:border-box; margin:0; padding:0; }
body { background:var(--bg); color:var(--fg); font-family:Inter,system-ui,sans-serif; display:flex; flex-direction:column; overflow:hidden;
  padding:var(--pt) var(--pr) 0 var(--pl); -webkit-font-smoothing:antialiased; }
header { display:flex; justify-content:space-between; align-items:center; font-weight:600; font-size:var(--brand); letter-spacing:-.01em; }
.brand { display:flex; align-items:center; gap:.45em; }
.brand img { width:1.5em; height:1.5em; }
.count { color:var(--muted); font-weight:500; font-size:.8em; font-variant-numeric:tabular-nums; }
main { flex:1; min-height:0; display:flex; flex-direction:column; }
.text { padding-top:var(--gap); }
.eyebrow { color:var(--accent); font-weight:600; font-size:var(--eyebrow); letter-spacing:.06em; text-transform:uppercase; margin-bottom:.9em; }
h1 { font-size:var(--h1); line-height:1.02; letter-spacing:-.045em; font-weight:700; text-wrap:balance; }
h2 { font-size:var(--h2); line-height:1.05; letter-spacing:-.04em; font-weight:700; text-wrap:balance; }
.sub, .body { color:var(--muted); font-size:var(--sub); line-height:1.35; margin-top:.75em; text-wrap:pretty; max-width:24em; }
.sub.accent { color:var(--accent); font-weight:600; }
.sub.small { font-size:calc(var(--sub) * .78); }
.num { font-family:'JetBrains Mono',monospace; color:var(--accent); font-size:var(--eyebrow); margin-bottom:.9em; }
.check { list-style:none; margin-top:1.1em; font-size:calc(var(--sub) * .9); display:grid; gap:.5em; }
.check li::before { content:''; display:inline-block; width:.85em; height:.85em; margin-right:.6em; vertical-align:-.08em; border:2px solid var(--accent); border-radius:.22em; }
.visual { flex:1; min-height:0; display:flex; justify-content:center; align-items:flex-start; padding-top:var(--gap); position:relative; }
.phone { width:var(--phone); border-radius:calc(var(--phone) * .12) calc(var(--phone) * .12) 0 0; border:calc(var(--phone) * .025) solid #1c1c24; border-bottom:0;
  overflow:hidden; background:#000; height:calc(100% + 2px); }
.phone img { width:100%; display:block; }
.panel { max-width:100%; max-height:100%; border-radius:28px; border:1px solid var(--line); align-self:center; }
.cards { align-items:center; }
.card { height:92%; max-height:var(--card-h); border-radius:3.6% / 2.6%; box-shadow:0 30px 60px rgba(0,0,0,.55); }
.card:first-child { transform:rotate(-6deg) translateX(8%); }
.card:last-child { transform:rotate(6deg) translateX(-8%); }
.flat { gap:4%; }
.flat figure { height:100%; display:flex; flex-direction:column; align-items:center; gap:18px; min-width:0; }
.flat .card { height:auto; width:100%; max-height:calc(100% - 60px); object-fit:contain; transform:none !important; box-shadow:none; }
.flat figcaption { color:var(--muted); font-size:calc(var(--sub) * .7); white-space:nowrap; }
.prompt { width:100%; max-width:var(--prompt); align-self:center; display:flex; flex-direction:column; gap:calc(var(--sub) * .8); }
.bubble { background:var(--card); border:1px solid var(--line); border-radius:28px; padding:1.1em 1.25em; font-size:var(--sub); line-height:1.35; }
.tools { display:flex; flex-wrap:wrap; gap:.5em; font-family:'JetBrains Mono',monospace; font-size:calc(var(--sub) * .72); }
.chip { color:var(--accent); background:rgba(185,166,255,.10); border:1px solid rgba(185,166,255,.25); border-radius:999px; padding:.4em .8em; }
.tools-note { color:var(--muted); font-size:calc(var(--sub) * .7); }
footer { height:var(--foot); flex:none; display:flex; justify-content:space-between; align-items:center; color:var(--muted); font-size:var(--small);
  border-top:1px solid var(--line); background:var(--bg); position:relative; z-index:1; margin:0 calc(var(--pr) * -1) var(--pb) calc(var(--pl) * -1); padding:0 var(--pr) 0 var(--pl); }

.ig { --pt:64px; --pr:72px; --pl:72px; --pb:0px; --foot:76px; --gap:40px; --brand:30px; --eyebrow:24px; --h1:88px; --h2:72px; --sub:34px; --small:22px; --phone:500px; --card-h:640px; --prompt:900px; }
.ig.cover .visual { padding-top:48px; }
.ig.point h2 { font-size:68px; }
.ig.cta main, .tiktok.cta main, body.point:not(.has-visual) main { justify-content:center; }
body.point:not(.has-visual) .text { padding-bottom:var(--gap); }
.ig.point:not(.has-visual) h2 { font-size:96px; }
.tiktok.point:not(.has-visual) h2 { font-size:104px; }
body.point:not(.has-visual) .body { font-size:calc(var(--sub) * 1.2); color:var(--fg); opacity:.78; }
.ig.cta h1 { font-size:104px; }

.tiktok { --pt:150px; --pr:120px; --pl:72px; --pb:330px; --foot:76px; --gap:44px; --brand:30px; --eyebrow:26px; --h1:96px; --h2:76px; --sub:36px; --small:22px; --phone:560px; --card-h:760px; --prompt:880px; }
.tiktok footer { border-top:0; }
.tiktok .phone { border-radius:64px; border-bottom:14px solid #1c1c24; height:auto; max-height:100%; }
.tiktok .visual { overflow:hidden; }

.x { --pt:64px; --pr:72px; --pl:80px; --pb:0px; --foot:72px; --gap:0px; --brand:30px; --eyebrow:24px; --h1:88px; --h2:72px; --sub:32px; --small:22px; --phone:500px; --card-h:700px; --prompt:640px; }
.x main { flex-direction:row; align-items:stretch; gap:56px; }
.x .text { flex:1.15; display:flex; flex-direction:column; justify-content:center; padding:0 0 24px; }
.x .visual { flex:1; padding-top:48px; }
.x .flat { gap:4%; }
.flat figure { height:100%; display:flex; flex-direction:column; align-items:center; gap:18px; min-width:0; }
.flat .card { height:auto; width:100%; max-height:calc(100% - 60px); object-fit:contain; transform:none !important; box-shadow:none; }
.flat figcaption { color:var(--muted); font-size:calc(var(--sub) * .7); white-space:nowrap; }
.prompt { align-self:center; }
`;

function slidesFor(post, format) {
  const cover = { kind: 'cover', visual: post.visual };
  if (format === 'x') return [cover];
  const points = post.points.map((p, i) => ({ kind: 'point', n: i + 1, ...p }));
  return [cover, ...points, { kind: 'cta' }];
}

const altText = (post, slide) =>
  slide.kind === 'cover'
    ? `${post.title} ${post.sub}`
    : slide.kind === 'point'
      ? `${slide.title}. ${slide.body}`
      : `${post.cta.title}. ${post.cta.sub}`;

async function render() {
  const only = process.argv[3]?.split(',');
  const browser = await chromium.launch();
  const manifest = [];
  const wanted = only && new Set(only);
  for (const post of POSTS.filter((p) => !wanted || wanted.has(p.slug))) {
    mkdirSync(join(OUT, post.slug), { recursive: true });
    for (const format of Object.keys(FORMATS)) {
      const slides = slidesFor(post, format);
      for (const [i, slide] of slides.entries()) {
        const page = await browser.newPage({ viewport: FORMATS[format] });
        const html = slideHtml(format, post, slide, i, slides.length);
        const htmlPath = join(OUT, post.slug, `${format}-${i + 1}.html`);
        writeFileSync(htmlPath, html);
        await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        const file = `${post.slug}/${format}-${i + 1}.jpg`;
        await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 88 });
        await page.close();
        manifest.push({
          slug: post.slug,
          format,
          index: i + 1,
          file,
          url: `${PUBLIC_BASE}/marketing/social/${MONTH}/${file}`,
          alt: altText(post, slide),
        });
      }
    }
  }
  await browser.close();
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeContactSheet(manifest);
  console.log(`${manifest.length} images, contact sheet at ${join(OUT, 'contact-sheet.html')}`);
}

function writeContactSheet(manifest) {
  const rendered = new Set(manifest.map((m) => m.slug));
  let rows = '';
  for (const p of POSTS) {
    if (!rendered.has(p.slug)) continue;
    const imgs = (format) => {
      let html = '';
      for (const m of manifest)
        if (m.slug === p.slug && m.format === format)
          html += `<a href="${m.file}"><img class="${format}" src="${m.file}" title="${esc(m.alt)}"></a>`;
      return html;
    };
    rows += `<section><h2>${esc(p.slug)}</h2><h3>Instagram 1080×1350</h3><div class="row">${imgs('ig')}</div><h3>X 1600×900 · TikTok 1080×1920</h3><div class="row">${imgs('x')}${imgs('tiktok')}</div></section>`;
  }
  writeFileSync(
    join(OUT, 'contact-sheet.html'),
    `<!doctype html><meta charset="utf-8"><title>Holo Folder social images</title><style>body{background:#0e0e12;color:#f4f3f8;font:14px Inter,system-ui,sans-serif;margin:24px}section{margin-bottom:40px}h2{font-size:18px;margin-bottom:8px}h3{font-size:12px;color:#a3a1b3;font-weight:500;margin:12px 0 6px}.row{display:flex;gap:8px;align-items:flex-start;overflow-x:auto}img{border:1px solid #2a2a33;display:block}img.ig{height:300px}img.x{height:225px}img.tiktok{height:300px}</style><h1>Holo Folder social images</h1>${rows}`,
  );
}

// ---------------------------------------------------------------- upload

async function upload() {
  const { AwsClient } = await import('aws4fetch');
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET = 'holofolder-assets' } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)
    throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required');
  const r2 = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const only = process.argv[3]?.split(',');
  const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')).filter(
    (m) => !only || only.includes(m.slug),
  );
  for (const m of manifest) {
    const key = `marketing/social/${MONTH}/${m.file}`;
    const res = await r2.fetch(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`, {
      method: 'PUT',
      body: readFileSync(join(OUT, m.file)),
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' },
    });
    if (!res.ok) throw new Error(`${key}: ${res.status} ${await res.text()}`);
    console.log('uploaded', key);
  }
}

const command = process.argv[2];
if (command === 'capture') await capture();
else if (command === 'render') await render();
else if (command === 'upload') await upload();
else console.log('usage: node marketing/social/render.mjs capture|render|upload [slug,slug]');
