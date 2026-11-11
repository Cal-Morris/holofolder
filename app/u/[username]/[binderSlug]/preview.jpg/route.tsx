import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { loadPublicBinder } from '@/lib/server/public-binder';
import { binderPreviewSummary } from '@/lib/binder-share-preview';
import { BINDER_COLOR_PRESETS } from '@/lib/binder-colors';

const size = { width: 1200, height: 630 };

// Satori can't draw WebP, which is what the card mirror stores.
async function pngDataUri(src: string) {
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(5000), next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const png = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({ width: 300 })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

/** The named binder's link-preview image, referenced from its page metadata. */
export async function GET(_: Request, { params }: RouteContext<'/u/[username]/[binderSlug]/preview.jpg'>) {
  const { username, binderSlug } = await params;
  const binder = await loadPublicBinder({ username, binderSlug }).catch(() => null);
  if (!binder) return new Response('Not found', { status: 404 });
  const { collected, total, images } = binderPreviewSummary(binder);
  const cards = (await Promise.all(images.map(pngDataUri))).filter((src): src is string => Boolean(src));
  const preset = BINDER_COLOR_PRESETS.find((p) => p.id === binder.appearance.color);
  const [from, to] = preset && preset.id !== 'white' ? preset.swatch : ['#191919', '#050505'];
  const owner = binder.username ?? username;

  const png = await new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 64,
        color: 'white',
        background: `linear-gradient(145deg, ${from} 0%, ${to} 100%)`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 28, opacity: 0.7 }}>{`@${owner} · Holo Folder`}</div>
        <div style={{ fontSize: 64, fontWeight: 700, marginTop: 8, lineClamp: 1 }}>{binder.name}</div>
        {total > 0 && (
          <div style={{ fontSize: 30, opacity: 0.8, marginTop: 8 }}>{`${collected} of ${total} collected`}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 24 }}>
        {cards.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={src} width={190} height={265} style={{ borderRadius: 10, objectFit: 'cover' }} alt="" />
        ))}
      </div>
    </div>,
    size,
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
