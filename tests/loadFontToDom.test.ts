import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadFontToDom } from '../src/core/dom-renderer/domRenderer.js';

// The renderer's font descriptors accept `fontFamily` as an array to register
// one file under several names. Passing that array straight to `FontFace`
// would stringify it into a single bogus family ("Roboto,Roboto500"), so the
// DOM path has to fan it out into one face per name.

class FakeFontFace {
  static created: FakeFontFace[] = [];
  constructor(
    public family: string,
    public source: string,
  ) {
    FakeFontFace.created.push(this);
  }
  load(): Promise<FakeFontFace> {
    return Promise.resolve(this);
  }
}

describe('loadFontToDom', () => {
  let added: FakeFontFace[];
  let originalFontFace: unknown;
  let originalFonts: unknown;

  beforeEach(() => {
    added = [];
    FakeFontFace.created = [];
    originalFontFace = (globalThis as unknown as { FontFace: unknown })
      .FontFace;
    (globalThis as unknown as { FontFace: unknown }).FontFace = FakeFontFace;

    originalFonts = document.fonts;
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: (f: FakeFontFace) => added.push(f) },
    });
  });

  afterEach(() => {
    (globalThis as unknown as { FontFace: unknown }).FontFace =
      originalFontFace;
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: originalFonts,
    });
  });

  it('registers a single family name', () => {
    loadFontToDom({ fontFamily: 'Roboto', fontUrl: 'roboto.woff2' });

    expect(added.map((f) => f.family)).toEqual(['Roboto']);
    expect(added[0]!.source).toBe('url(roboto.woff2)');
  });

  it('registers one face per name when given an alias list', () => {
    loadFontToDom({
      fontFamily: ['Roboto', 'Roboto500'],
      fontUrl: 'roboto.woff2',
    });

    expect(added.map((f) => f.family)).toEqual(['Roboto', 'Roboto500']);
    // Same URL for both — the browser dedupes the actual download.
    expect(added.every((f) => f.source === 'url(roboto.woff2)')).toBe(true);
  });

  it('does nothing without a font url', () => {
    loadFontToDom({ fontFamily: 'Roboto' });

    expect(added).toEqual([]);
    expect(FakeFontFace.created).toEqual([]);
  });

  it('survives an engine with no FontFace', () => {
    (globalThis as unknown as { FontFace: unknown }).FontFace = undefined;

    expect(() =>
      loadFontToDom({ fontFamily: 'Roboto', fontUrl: 'roboto.woff2' }),
    ).not.toThrow();
    expect(added).toEqual([]);
  });

  it('swallows a failed load rather than rejecting unhandled', async () => {
    vi.spyOn(FakeFontFace.prototype, 'load').mockRejectedValueOnce(
      new Error('network'),
    );

    loadFontToDom({ fontFamily: 'Roboto', fontUrl: 'roboto.woff2' });

    // Give the rejection a turn to surface if it were unhandled.
    await new Promise((r) => setTimeout(r, 0));
    expect(added.map((f) => f.family)).toEqual(['Roboto']);
  });
});
