import type { RendererCore } from '@solidtv/renderer';

/**
 * A font for exact layout arithmetic (the renderer's own `boxFont` fixture,
 * copied: the renderer package does not ship its tests): design size 10, so
 * fontSize 20 is scale 2. Every letter, digit and '?' is 6 x 8 with xoffset
 * 1, yoffset 2 and advance 8, at (8 * i, 0) for the i-th on a 256 x 128
 * atlas; the space advances 5 and has no width. Metrics: ascender 800,
 * descender -200, no line gap. So at fontSize 20 a glyph advances 16 and a
 * line is 1.2 x 20 high (lineHeight 1.2 is a multiplier).
 */
export function boxFont(): unknown {
  const chars = [
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
    kernings: [],
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

/**
 * Load the Box font into `core` under `family` (a name, or names): its
 * atlas description is served to the core's font registry, so text lays
 * out (`measureText`, the walk). The atlas image is not uploaded; layout
 * does not need it. Resolves once the description has arrived.
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
    // Rejects while the atlas image cannot load headless: not needed.
    .catch(() => {});
  // Let the description's promise chain run.
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}
