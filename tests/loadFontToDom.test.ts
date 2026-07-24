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
  let originalFontsDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    added = [];
    FakeFontFace.created = [];
    originalFontFace = (globalThis as unknown as { FontFace: unknown })
      .FontFace;
    (globalThis as unknown as { FontFace: unknown }).FontFace = FakeFontFace;

    // Capture the whole descriptor, not just the value: jsdom has no
    // `document.fonts` at all, so there may be nothing here to put back.
    originalFontsDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'fonts',
    );
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      writable: true,
      value: { add: (f: FakeFontFace) => added.push(f) },
    });
  });

  afterEach(() => {
    (globalThis as unknown as { FontFace: unknown }).FontFace =
      originalFontFace;

    // Restore exactly what was there — including nothing. Vitest runs with
    // `isolate: false`, so this document is shared with every other test file,
    // and tests/setup.ts assigns `document.fonts = {...}` when it finds it
    // absent. Leaving a non-writable stand-in behind makes that assignment
    // throw in whichever file happens to run next.
    if (originalFontsDescriptor !== undefined) {
      Object.defineProperty(document, 'fonts', originalFontsDescriptor);
    } else {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
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

// Sibling block: runs outside the hooks above, so it sees the document exactly
// as the next test file would. Guards the restore in `afterEach` — a leftover
// non-writable `fonts` here makes tests/setup.ts throw
// "Cannot assign to read only property 'fonts'" in an unrelated file.
describe('loadFontToDom global cleanup', () => {
  it('leaves document.fonts assignable for other test files', () => {
    const before = Object.getOwnPropertyDescriptor(document, 'fonts');
    expect(before === undefined || before.writable === true).toBe(true);

    // The exact operation tests/setup.ts performs when it finds no fonts.
    expect(() => {
      (document as unknown as { fonts?: unknown }).fonts = { add: () => {} };
    }).not.toThrow();

    // ...and put it back, so this guard is itself side-effect free.
    if (before !== undefined) {
      Object.defineProperty(document, 'fonts', before);
    } else {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });
});
