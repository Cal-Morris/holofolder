import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const publicDir = path.join(process.cwd(), 'public');
// The high-resolution framed card is the same artwork used by Framer's header.
const master = await sharp('assets/brand/holo-card-master.png').trim().png().toBuffer();
const svgMaster = await sharp(master).resize(512, 512, { fit: 'inside' }).png({ palette: true, effort: 10 }).toBuffer();
const vector = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><image width="512" height="512" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${svgMaster.toString('base64')}"/></svg>`;
const lightBackground = '#07070a';
const darkBackground = '#07070a';

async function appIcon(size, background, maskable = false) {
  // A square at 56% fits entirely inside Android's 80%-diameter maskable safe circle.
  const extent = Math.round(size * (maskable ? 0.56 : 0.84));
  const mark = await sharp(master).resize({ width: extent, height: extent, fit: 'inside' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: 'centre' }])
    .removeAlpha()
    .png({ palette: true, effort: 10 })
    .toBuffer();
}

async function faviconIcon(size) {
  const extent = Math.round(size * 0.84);
  const mark = await sharp(master).resize({ width: extent, height: extent, fit: 'inside' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function createIco(file) {
  const sizes = [16, 32, 48, 64];
  const images = await Promise.all(sizes.map(faviconIcon));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + sizes.length * 16;
  const entries = images.map((png, index) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(sizes[index], 0);
    entry.writeUInt8(sizes[index], 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  fs.writeFileSync(file, Buffer.concat([header, ...entries, ...images]));
}

const outputs = [
  ['apple-touch-icon-holo-cards.png', 180, lightBackground],
  ['apple-touch-icon-holo-dark.png', 180, darkBackground],
  ['pwa-holo-cards-dark-192.png', 192, darkBackground],
  ['pwa-holo-cards-dark-maskable-192.png', 192, darkBackground, true],
  ['pwa-holo-cards-dark-maskable-512.png', 512, darkBackground, true],
  ['pwa-holo-cards-192.png', 192, lightBackground],
  ['pwa-holo-cards-512.png', 512, lightBackground],
  ['pwa-holo-cards-1024.png', 1024, lightBackground],
  ['pwa-holo-cards-dark-512.png', 512, darkBackground],
  ['pwa-holo-cards-maskable-192.png', 192, lightBackground, true],
  ['pwa-holo-cards-maskable-512.png', 512, lightBackground, true],
];
for (const [name, size, background, maskable] of outputs)
  fs.writeFileSync(path.join(publicDir, name), await appIcon(size, background, maskable));

for (const [name, size] of [
  ['holo-cards-light-32.png', 32],
  ['holo-cards-dark-32.png', 32],
  ['holofolder-favicon-512.png', 512],
])
  fs.writeFileSync(path.join(publicDir, name), await faviconIcon(size));

for (const [source, aliases] of [
  ['holo-cards-light-32.png', ['icon-light-32x32.png']],
  ['holo-cards-dark-32.png', ['icon-dark-32x32.png']],
  ['apple-touch-icon-holo-cards.png', ['apple-icon.png', 'apple-touch-icon-holo-card.png']],
  ['pwa-holo-cards-maskable-192.png', ['pwa-192x192.png', 'pwa-holo-card-192.png']],
  ['pwa-holo-cards-maskable-512.png', ['pwa-512x512.png', 'pwa-holo-card-512.png']],
])
  for (const alias of aliases) fs.copyFileSync(path.join(publicDir, source), path.join(publicDir, alias));

await sharp(master)
  .resize({ width: 192, height: 192, fit: 'contain', background: '#00000000' })
  .png({ palette: true, effort: 10 })
  .toFile(path.join(publicDir, 'holo-cards-mark.png'));
fs.copyFileSync(path.join(publicDir, 'holo-cards-mark.png'), path.join(publicDir, 'holo-card-mark.png'));
fs.writeFileSync(path.join(publicDir, 'holo-cards-mark.svg'), vector);
const artwork = vector.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
function vectorIcon(background, styles = '', scale = 0.84) {
  const inset = (512 - 512 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><style>${styles}</style>${background}<g transform="translate(${inset} ${inset}) scale(${scale})">${artwork}</g></svg>\n`;
}
const adaptive = vectorIcon(
  '<rect width="512" height="512" fill="var(--bg)"/>',
  `:root{--bg:${lightBackground}}@media(prefers-color-scheme:dark){:root{--bg:${darkBackground}}}`,
);
for (const name of ['holo-cards-icon.svg', 'icon.svg']) fs.writeFileSync(path.join(publicDir, name), adaptive);
fs.writeFileSync(path.join(publicDir, 'holo-cards-favicon.svg'), vectorIcon(''));
fs.writeFileSync(
  path.join(publicDir, 'holo-cards-light.svg'),
  vectorIcon(`<rect width="512" height="512" fill="${lightBackground}"/>`),
);
fs.writeFileSync(
  path.join(publicDir, 'holo-cards-dark.svg'),
  vectorIcon(`<rect width="512" height="512" fill="${darkBackground}"/>`),
);
fs.writeFileSync(
  path.join(publicDir, 'holo-cards-maskable.svg'),
  vectorIcon(`<rect width="512" height="512" fill="${lightBackground}"/>`, '', 0.56),
);
fs.writeFileSync(
  path.join(publicDir, 'holo-cards-glass.svg'),
  vectorIcon('', '.card-face{fill-opacity:.55}.card-border{fill-opacity:.7}'),
);
const monochrome =
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><g transform="rotate(-6 256 256)"><rect x="112" y="56" width="288" height="400" rx="40" fill="none" stroke="black" stroke-width="24"/><path d="M256 142Q266 236 340 250Q266 264 256 358Q246 264 172 250Q246 236 256 142" fill="black"/><path d="M160 405h192" stroke="black" stroke-width="18" stroke-linecap="round"/></g></svg>\n';
fs.writeFileSync(path.join(publicDir, 'holo-cards-monochrome.svg'), monochrome);
await createIco(path.join(publicDir, 'holo-cards-favicon.ico'));
fs.copyFileSync(path.join(publicDir, 'holo-cards-favicon.ico'), path.join(publicDir, 'favicon.ico'));

// New canonical URLs bypass cached artwork, old URLs remain compatible aliases.
for (const [source, destination] of [
  ['holo-cards-dark-32.png', 'holofolder-icon-32.png'],
  ['holo-cards-favicon.svg', 'holofolder-favicon.svg'],
  ['holo-cards-dark.svg', 'holofolder-icon.svg'],
  ['holo-cards-favicon.ico', 'holofolder-favicon.ico'],
  ['apple-touch-icon-holo-dark.png', 'holofolder-apple-touch-icon.png'],
  ['pwa-holo-cards-dark-192.png', 'holofolder-icon-192.png'],
  ['pwa-holo-cards-dark-512.png', 'holofolder-icon-512.png'],
  ['pwa-holo-cards-1024.png', 'holofolder-icon-1024.png'],
  ['pwa-holo-cards-dark-maskable-192.png', 'holofolder-maskable-192.png'],
  ['pwa-holo-cards-dark-maskable-512.png', 'holofolder-maskable-512.png'],
  ['holo-cards-monochrome.svg', 'holofolder-monochrome.svg'],
  ['holo-card-mark.png', 'holofolder-mark.png'],
])
  fs.copyFileSync(path.join(publicDir, source), path.join(publicDir, destination));
