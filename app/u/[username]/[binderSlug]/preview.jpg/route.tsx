import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { loadPublicBinder } from '@/lib/server/public-binder';
import { binderPreviewSummary } from '@/lib/binder-share-preview';
import { getBinderColorPreset } from '@/lib/binder-colors';

const size = { width: 1200, height: 630 };
const fonts = Promise.all(
  [500, 600].map(async (weight) => ({
    name: 'Inter',
    weight: weight as 500 | 600,
    style: 'normal' as const,
    data: await readFile(join(process.cwd(), `assets/fonts/Inter-${weight}.ttf`)),
  })),
);

// Satori can't draw WebP, which is what the card mirror stores. Wanted cards are greyed like in the binder.
async function pngDataUri(src: string, grey: boolean) {
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(5000), next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const png = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({ width: 300 })
      .grayscale(grey)
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

/** The named binder's link-preview image, in the holofolder.com share card style, referenced from its page metadata. */
export async function GET(_: Request, { params }: RouteContext<'/u/[username]/[binderSlug]/preview.jpg'>) {
  const { username, binderSlug } = await params;
  const binder = await loadPublicBinder({ username, binderSlug }).catch(() => null);
  if (!binder) return new Response('Not found', { status: 404 });
  const { collected, total, page } = binderPreviewSummary(binder);
  const pockets = await Promise.all(
    page.map(async (pocket) => ({ ...pocket, img: pocket.src ? await pngDataUri(pocket.src, !pocket.owned) : null })),
  );
  const preset = getBinderColorPreset(binder.appearance.color);
  const glow = ['white', 'black', 'transparent', 'slate'].includes(preset.id) ? '#4a3f8c' : preset.swatch[0];
  const owner = binder.username ?? username;
  // Close-up: the page is sized past the canvas height so it bleeds off the top and bottom.
  const gap = 14;
  const cardW = Math.min(150, Math.floor((520 - 40 - gap * (binder.cols - 1)) / binder.cols));
  const cardH = Math.round((cardW * 88) / 63);

  const png = await new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        fontFamily: 'Inter',
        color: 'white',
        backgroundColor: '#08080b',
        backgroundImage: `radial-gradient(circle at 78% 50%, ${glow}66 0%, ${glow}1f 35%, transparent 65%)`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', width: 600, paddingLeft: 72, paddingRight: 24 }}>
        <div style={{ fontSize: 26, fontWeight: 500, color: '#8e8e98' }}>{`@${owner} · Holo Folder`}</div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 600,
            letterSpacing: -2,
            lineHeight: 1.08,
            marginTop: 18,
            lineClamp: 3,
          }}
        >
          {binder.name}
        </div>
        {total > 0 && (
          <div style={{ fontSize: 28, fontWeight: 600, marginTop: 28 }}>{`${collected} of ${total} collected`}</div>
        )}
        <div style={{ fontSize: 22, fontWeight: 500, color: '#8e8e98', marginTop: 20 }}>holofolder.com</div>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap,
          padding: 20,
          width: cardW * binder.cols + gap * (binder.cols - 1) + 44,
          flexShrink: 0,
          borderRadius: 24,
          background: preset.dark.background,
          border: `2px solid ${preset.dark.border}`,
          boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
          transform: 'rotate(-3deg)',
        }}
      >
        {pockets.map((pocket, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              width: cardW,
              height: cardH,
              borderRadius: 8,
              backgroundColor: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              overflow: 'hidden',
            }}
          >
            {pocket.img && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pocket.img}
                width={cardW}
                height={cardH}
                style={{ objectFit: 'cover', opacity: pocket.owned ? 1 : 0.4 }}
                alt=""
              />
            )}
          </div>
        ))}
      </div>
    </div>,
    { ...size, fonts: await fonts },
  ).arrayBuffer();
  // JPEG keeps it well under the ~600 KB some messengers accept; the PNG is ~750 KB.
  const jpeg = await sharp(Buffer.from(png)).jpeg({ quality: 85 }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
