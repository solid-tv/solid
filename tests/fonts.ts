import type { RendererCore } from '@solidtv/renderer';

/** One glyph of an SDF atlas description. */
interface BoxGlyph {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
}

/**
 * The shape of the renderer's `SdfFontData` (not exported from the package
 * root), as much of it as the Box font uses.
 */
interface BoxFontData {
  pages: string[];
  chars: BoxGlyph[];
  kernings: { first: number; second: number; amount: number }[];
  info: { face: string; size: number };
  common: { lineHeight: number; base: number; scaleW: number; scaleH: number };
  distanceField: { fieldType: string; distanceRange: number };
  lightningMetrics: {
    ascender: number;
    descender: number;
    lineGap: number;
    unitsPerEm: number;
    capHeight: number;
    xHeight: number;
  };
}

/**
 * A copy of the renderer's `boxFont()` fixture (test/sdfFonts.ts; the
 * renderer package does not ship its tests), for exact layout arithmetic:
 * design size 10 (so fontSize 20 is scale 2), base 8, a 256 x 128 atlas,
 * distance range 4. Every letter, digit and '?' is 6 x 8 with xoffset 1,
 * yoffset 2 and advance 8, at (8 * i, 0) for the i-th, and '_' too, at
 * (8, 120) on the atlas's bottom edge (its far UV is 1.0); the space
 * advances 5 and has no width, and '-' advances 8 and is 6 wide with no
 * height, so neither draws anything. 'A' then 'V' kerns by -2, 'A' then the
 * space by -1. Metrics: ascender 800, descender -200, no line gap, cap
 * height 700, x height 500.
 */
export function boxFont(): BoxFontData {
  const chars: BoxGlyph[] = [
    {
      id: 32,
      x: 0,
      y: 120,
      width: 0,
      height: 8,
      xoffset: 0,
      yoffset: 0,
      xadvance: 5,
    },
    {
      id: 95,
      x: 8,
      y: 120,
      width: 6,
      height: 8,
      xoffset: 1,
      yoffset: 2,
      xadvance: 8,
    },
    {
      id: 45,
      x: 16,
      y: 120,
      width: 6,
      height: 0,
      xoffset: 1,
      yoffset: 2,
      xadvance: 8,
    },
  ];
  const codes =
    '?0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < codes.length; i++) {
    chars.push({
      id: codes.charCodeAt(i),
      x: (i % 32) * 8,
      y: Math.floor(i / 32) * 8,
      width: 6,
      height: 8,
      xoffset: 1,
      yoffset: 2,
      xadvance: 8,
    });
  }
  return {
    pages: ['box.png'],
    chars,
    kernings: [
      { first: 65, second: 86, amount: -2 },
      { first: 65, second: 32, amount: -1 },
    ],
    info: { face: 'Box', size: 10 },
    common: { lineHeight: 12, base: 8, scaleW: 256, scaleH: 128 },
    distanceField: { fieldType: 'msdf', distanceRange: 4 },
    lightningMetrics: {
      ascender: 800,
      descender: -200,
      lineGap: 0,
      unitsPerEm: 1000,
      capHeight: 700,
      xHeight: 500,
    },
  };
}

/** Let every queued promise continuation run (20 microtask turns). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/**
 * Load the Box font into `core` under `family` (a name, or names), the way
 * the renderer's own text tests do (RendererCore.text.test.ts): its atlas
 * description is served to the core's font registry, then the loader's and
 * uploader's part is played, so the atlas image counts as uploaded and the
 * font is ready (`measureText` and the walk both lay text out). Resolves
 * once both have run.
 */
export async function loadBoxFont(
  core: RendererCore,
  family: string | string[] = 'Box',
): Promise<void> {
  const data = boxFont();
  core.fonts.fetch = () => Promise.resolve(data);
  core
    .loadFont({
      fontFamily: family,
      atlasUrl: 'box.png',
      atlasDataUrl: 'box.json',
    })
    .catch(() => {});
  await flush();
  const store = core.textures;
  const rec = store.nextQueued();
  store.decoded(rec, {}, 256, 128, false);
  store.nextDecoded();
  store.uploaded(rec, 256 * 128 * 4);
  core.events.flush();
}
