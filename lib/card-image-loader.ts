import { toSmallCardAssetSrc } from './card-image-url';
import { getImageProps, type ImageLoaderProps } from 'next/image';

const PROXY_PATH = '/app/api/card-image-proxy';
const WIDTHS = [96, 160, 240, 320, 480, 600] as const;

export function isProxiedCardImage(src: string) {
  return src.startsWith(`${PROXY_PATH}?`);
}

/** Keep responsive variants on our CDN-cached proxy, outside Vercel's image optimizer. */
export function cardImageLoader({ src, width }: Pick<ImageLoaderProps, 'src' | 'width'>) {
  if (!isProxiedCardImage(src)) return src;
  const params = new URLSearchParams(src.slice(src.indexOf('?') + 1));
  const size = WIDTHS.find((size) => size >= width) ?? 600;
  params.set('w', String(size));
  return `${PROXY_PATH}?${params}`;
}

/** Prefetch and render must let the browser select exactly the same variant. */
export function getCardImageAttributes(src: string, sizes: string) {
  const small = toSmallCardAssetSrc(src);
  // TCGdex `high` is 600 wide; other sources are stored up to 734 wide.
  if (small) return { src, srcSet: `${small} 320w, ${src} ${/\/high\.(webp|png|jpg)$/.test(src) ? 600 : 734}w`, sizes };
  const { props } = getImageProps({
    src,
    alt: '',
    sizes,
    width: 600,
    height: 825,
    loader: cardImageLoader,
    unoptimized: !isProxiedCardImage(src),
  });
  return { src: props.src, srcSet: props.srcSet, sizes: props.sizes };
}
