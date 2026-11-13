export type BinderColorId =
  'emerald' | 'ocean' | 'ruby' | 'violet' | 'amber' | 'slate' | 'black' | 'white' | 'transparent';

/** A page colour: one of the presets, or a custom `#rrggbb`. */
export type BinderColor = BinderColorId | `#${string}`;

export type BinderColorTheme = {
  background: string;
  border: string;
  activeOutline: string;
  shadow: string;
  gloss: string;
};

type BinderColorPreset = {
  id: BinderColorId;
  label: string;
  swatch: [string, string];
  dark: BinderColorTheme;
  light: BinderColorTheme;
};

export const DEFAULT_BINDER_COLOR_ID: BinderColorId = 'black';

export const BINDER_COLOR_PRESETS: BinderColorPreset[] = [
  {
    id: 'emerald',
    label: 'Emerald',
    swatch: ['#1c6b43', '#0f2d25'],
    dark: {
      background: 'linear-gradient(145deg, rgba(16,61,44,0.98) 0%, rgba(14,31,26,0.98) 55%, rgba(10,18,19,0.98) 100%)',
      border: 'rgba(52, 145, 96, 0.42)',
      activeOutline: 'rgba(17, 74, 49, 0.92)',
      shadow: '0 24px 60px rgba(4, 16, 11, 0.42)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 28%, rgba(255,255,255,0) 100%)',
    },
    light: {
      background:
        'linear-gradient(145deg, rgba(236,247,241,0.98) 0%, rgba(211,234,220,0.96) 52%, rgba(170,206,185,0.94) 100%)',
      border: 'rgba(48, 117, 84, 0.22)',
      activeOutline: 'rgba(40, 98, 69, 0.46)',
      shadow: '0 24px 56px rgba(36, 97, 69, 0.12)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.46) 0%, rgba(255,255,255,0.08) 36%, rgba(255,255,255,0) 100%)',
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    swatch: ['#2b6cb8', '#13233f'],
    dark: {
      background: 'linear-gradient(145deg, rgba(18,52,92,0.98) 0%, rgba(14,27,49,0.98) 58%, rgba(10,18,28,0.98) 100%)',
      border: 'rgba(85, 153, 230, 0.38)',
      activeOutline: 'rgba(24, 56, 98, 0.92)',
      shadow: '0 24px 60px rgba(7, 16, 34, 0.4)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 30%, rgba(255,255,255,0) 100%)',
    },
    light: {
      background:
        'linear-gradient(145deg, rgba(238,243,252,0.98) 0%, rgba(214,226,246,0.96) 55%, rgba(176,198,230,0.94) 100%)',
      border: 'rgba(52, 103, 177, 0.22)',
      activeOutline: 'rgba(45, 86, 146, 0.42)',
      shadow: '0 24px 56px rgba(41, 86, 154, 0.12)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.48) 0%, rgba(255,255,255,0.1) 36%, rgba(255,255,255,0) 100%)',
    },
  },
  {
    id: 'ruby',
    label: 'Ruby',
    swatch: ['#b83252', '#33151d'],
    dark: {
      background: 'linear-gradient(145deg, rgba(95,25,48,0.98) 0%, rgba(43,17,28,0.98) 58%, rgba(18,13,18,0.98) 100%)',
      border: 'rgba(213, 94, 129, 0.34)',
      activeOutline: 'rgba(78, 22, 40, 0.88)',
      shadow: '0 24px 60px rgba(24, 8, 15, 0.42)',
      gloss:
        'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.015) 32%, rgba(255,255,255,0) 100%)',
    },
    light: {
      background:
        'linear-gradient(145deg, rgba(252,239,243,0.99) 0%, rgba(241,214,223,0.97) 55%, rgba(221,182,196,0.94) 100%)',
      border: 'rgba(167, 57, 89, 0.22)',
      activeOutline: 'rgba(150, 50, 80, 0.4)',
      shadow: '0 24px 56px rgba(153, 44, 76, 0.11)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.48) 0%, rgba(255,255,255,0.1) 36%, rgba(255,255,255,0) 100%)',
    },
  },
  {
    id: 'violet',
    label: 'Violet',
    swatch: ['#7856d8', '#25193c'],
    dark: {
      background: 'linear-gradient(145deg, rgba(60,39,112,0.98) 0%, rgba(29,20,51,0.98) 56%, rgba(16,13,24,0.98) 100%)',
      border: 'rgba(146, 121, 230, 0.34)',
      activeOutline: 'rgba(47, 31, 88, 0.9)',
      shadow: '0 24px 60px rgba(17, 10, 30, 0.44)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 30%, rgba(255,255,255,0) 100%)',
    },
    light: {
      background:
        'linear-gradient(145deg, rgba(244,240,252,0.99) 0%, rgba(228,219,247,0.97) 55%, rgba(201,187,233,0.94) 100%)',
      border: 'rgba(102, 77, 181, 0.2)',
      activeOutline: 'rgba(92, 69, 160, 0.4)',
      shadow: '0 24px 56px rgba(93, 70, 166, 0.11)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.11) 36%, rgba(255,255,255,0) 100%)',
    },
  },
  {
    id: 'amber',
    label: 'Amber',
    swatch: ['#c98a20', '#39250b'],
    dark: {
      background: 'linear-gradient(145deg, rgba(100,68,15,0.98) 0%, rgba(46,31,11,0.98) 54%, rgba(18,14,12,0.98) 100%)',
      border: 'rgba(220, 168, 73, 0.34)',
      activeOutline: 'rgba(77, 53, 14, 0.9)',
      shadow: '0 24px 60px rgba(25, 17, 7, 0.4)',
      gloss:
        'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.015) 32%, rgba(255,255,255,0) 100%)',
    },
    light: {
      background:
        'linear-gradient(145deg, rgba(252,246,234,0.99) 0%, rgba(242,230,202,0.97) 55%, rgba(224,201,151,0.94) 100%)',
      border: 'rgba(164, 112, 26, 0.2)',
      activeOutline: 'rgba(144, 98, 24, 0.38)',
      shadow: '0 24px 56px rgba(158, 111, 36, 0.11)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.11) 36%, rgba(255,255,255,0) 100%)',
    },
  },
  {
    id: 'slate',
    label: 'Slate',
    swatch: ['#4f6478', '#1c2430'],
    dark: {
      background: 'linear-gradient(145deg, rgba(41,53,69,0.98) 0%, rgba(24,31,42,0.98) 58%, rgba(13,18,26,0.98) 100%)',
      border: 'rgba(120, 142, 166, 0.3)',
      activeOutline: 'rgba(31, 42, 56, 0.92)',
      shadow: '0 24px 60px rgba(8, 12, 18, 0.42)',
      gloss:
        'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.015) 34%, rgba(255,255,255,0) 100%)',
    },
    light: {
      background:
        'linear-gradient(145deg, rgba(242,245,248,0.99) 0%, rgba(224,230,237,0.97) 55%, rgba(194,204,215,0.94) 100%)',
      border: 'rgba(80, 98, 118, 0.18)',
      activeOutline: 'rgba(71, 88, 107, 0.38)',
      shadow: '0 24px 56px rgba(63, 79, 99, 0.1)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.48) 0%, rgba(255,255,255,0.1) 36%, rgba(255,255,255,0) 100%)',
    },
  },
  {
    id: 'black',
    label: 'Black',
    swatch: ['#191919', '#050505'],
    dark: {
      background: 'linear-gradient(145deg, rgba(24,24,24,0.985) 0%, rgba(10,10,10,0.99) 60%, rgba(4,4,4,0.995) 100%)',
      border: 'rgba(255, 255, 255, 0.1)',
      activeOutline: 'rgba(255, 255, 255, 0.16)',
      shadow: '0 24px 64px rgba(0, 0, 0, 0.58)',
      gloss:
        'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.012) 34%, rgba(255,255,255,0) 100%)',
    },
    light: {
      background: 'linear-gradient(145deg, rgba(38,38,38,0.97) 0%, rgba(18,18,18,0.98) 60%, rgba(8,8,8,0.99) 100%)',
      border: 'rgba(255, 255, 255, 0.12)',
      activeOutline: 'rgba(255, 255, 255, 0.18)',
      shadow: '0 24px 56px rgba(0, 0, 0, 0.3)',
      gloss:
        'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.015) 36%, rgba(255,255,255,0) 100%)',
    },
  },
  {
    id: 'white',
    label: 'White',
    swatch: ['#ffffff', '#dde2e9'],
    dark: {
      background:
        'linear-gradient(145deg, rgba(250,251,252,0.96) 0%, rgba(233,237,241,0.95) 56%, rgba(214,220,228,0.94) 100%)',
      border: 'rgba(255, 255, 255, 0.2)',
      activeOutline: 'rgba(150, 160, 176, 0.44)',
      shadow: '0 24px 56px rgba(0, 0, 0, 0.18)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.2) 34%, rgba(255,255,255,0) 100%)',
    },
    light: {
      background:
        'linear-gradient(145deg, rgba(255,255,255,0.985) 0%, rgba(246,248,250,0.975) 56%, rgba(233,237,242,0.965) 100%)',
      border: 'rgba(137, 146, 161, 0.24)',
      activeOutline: 'rgba(125, 136, 152, 0.34)',
      shadow: '0 24px 52px rgba(113, 125, 143, 0.12)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.24) 34%, rgba(255,255,255,0) 100%)',
    },
  },
  {
    id: 'transparent',
    label: 'Transparent',
    swatch: ['#95a3b8', '#5b6678'],
    dark: {
      background: 'linear-gradient(145deg, rgba(18,22,30,0.68) 0%, rgba(18,22,30,0.56) 58%, rgba(18,22,30,0.48) 100%)',
      border: 'rgba(255, 255, 255, 0.12)',
      activeOutline: 'rgba(38, 47, 63, 0.78)',
      shadow: '0 24px 56px rgba(0, 0, 0, 0.24)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 34%, rgba(255,255,255,0) 100%)',
    },
    light: {
      background:
        'linear-gradient(145deg, rgba(255,255,255,0.58) 0%, rgba(245,248,252,0.46) 56%, rgba(228,234,242,0.36) 100%)',
      border: 'rgba(110, 126, 146, 0.2)',
      activeOutline: 'rgba(92, 107, 128, 0.34)',
      shadow: '0 24px 48px rgba(92, 108, 132, 0.08)',
      gloss: 'linear-gradient(180deg, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.08) 34%, rgba(255,255,255,0) 100%)',
    },
  },
];

const HEX = /^#[0-9a-f]{6}$/i;

export const isCustomBinderColor = (value: unknown): value is `#${string}` =>
  typeof value === 'string' && HEX.test(value);

/** A preset id or custom hex, else undefined. */
export const normalizeBinderColor = (value: unknown): BinderColor | undefined =>
  isCustomBinderColor(value)
    ? (value.toLowerCase() as BinderColor)
    : BINDER_COLOR_PRESETS.find((preset) => preset.id === value)?.id;

/** Mixes two `#rrggbb` colours; `amount` is how much of `to` (0–1). Plain hex so image renderers can draw it. */
function mixHex(from: string, to: string, amount: number) {
  const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function customPreset(hex: string): Omit<BinderColorPreset, 'id'> & { id: BinderColor } {
  const deep = mixHex(hex, '#000000', 0.45);
  const theme: BinderColorTheme = {
    background: `linear-gradient(145deg, ${hex} 0%, ${mixHex(hex, '#000000', 0.2)} 55%, ${deep} 100%)`,
    border: mixHex(hex, '#ffffff', 0.35),
    activeOutline: mixHex(hex, '#000000', 0.3),
    shadow: `0 24px 60px ${deep}66`,
    gloss: 'linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.02) 32%, rgba(255,255,255,0) 100%)',
  };
  return { id: hex as BinderColor, label: hex.toUpperCase(), swatch: [hex, deep], dark: theme, light: theme };
}

export function getBinderColorPreset(colorId: BinderColor | string | null | undefined) {
  if (isCustomBinderColor(colorId)) return customPreset(colorId.toLowerCase());
  return (
    BINDER_COLOR_PRESETS.find((preset) => preset.id === colorId) ??
    BINDER_COLOR_PRESETS.find((preset) => preset.id === DEFAULT_BINDER_COLOR_ID)!
  );
}
