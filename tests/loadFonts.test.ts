import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { RendererCore } from '@solidtv/renderer';

// `loadFonts()` may be called either side of `startRenderer()`. Calling it
// first is the point of the prefetch: the download overlaps renderer boot
// instead of queueing behind it. Calling it after must keep behaving exactly
// as it always did.
//
// Both paths hinge on the module-level `core` in renderer.ts being unset, so
// each case re-imports the module, with the renderer's prefetch mocked (the
// real one would start a network request) and a headless core.

const prefetchFont = vi.fn();

const sdfFont = {
  type: 'msdf' as const,
  fontFamily: 'Roboto',
  atlasUrl: 'Roboto.png',
  atlasDataUrl: 'Roboto.json',
};

async function freshInit() {
  vi.resetModules();
  vi.doMock('@solidtv/renderer', async (original) => ({
    ...(await original<typeof import('@solidtv/renderer')>()),
    prefetchFont,
  }));
  const mod = await import('../src/core/renderer.js');
  vi.doUnmock('@solidtv/renderer');
  return mod;
}

/** A headless core whose loadFont resolves (or does what `impl` does). */
function headless(impl: () => Promise<void> = () => Promise.resolve()) {
  const core = new RendererCore({ appWidth: 640, appHeight: 360 });
  const loadFont = vi.spyOn(core, 'loadFont').mockImplementation(impl);
  return { core, loadFont };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('loadFonts', () => {
  beforeEach(() => {
    prefetchFont.mockClear();
  });

  // Leave the module registry clean for any test file that loads afterwards.
  afterAll(() => {
    vi.resetModules();
  });

  it('starts the download before the renderer exists, and attaches once it does', async () => {
    const init = await freshInit();
    const { core, loadFont } = headless();

    const pending = init.loadFonts([sdfFont]);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    // Network started; nothing handed to a core that does not exist yet.
    expect(prefetchFont).toHaveBeenCalledWith(sdfFont);
    expect(loadFont).not.toHaveBeenCalled();
    await flush();
    expect(settled).toBe(false);

    init.startRenderer({ core });

    await pending;
    expect(loadFont).toHaveBeenCalledWith(sdfFont);
  });

  it('attaches immediately when the renderer already exists', async () => {
    const init = await freshInit();
    const { core, loadFont } = headless();
    init.startRenderer({ core });

    await init.loadFonts([sdfFont]);

    expect(loadFont).toHaveBeenCalledWith(sdfFont);
    // Nothing to prefetch: the core is right there.
    expect(prefetchFont).not.toHaveBeenCalled();
  });

  it('rejects the deferred call when attaching fails', async () => {
    const init = await freshInit();
    const { core } = headless(() => Promise.reject(new Error('boom')));

    const pending = init.loadFonts([sdfFont]);
    init.startRenderer({ core });

    await expect(pending).rejects.toThrow('boom');
  });

  it('registers every alias of a multi-name font', async () => {
    const init = await freshInit();
    const { core, loadFont } = headless();
    const aliased = { ...sdfFont, fontFamily: ['Roboto', 'Roboto500'] };

    const pending = init.loadFonts([aliased]);
    expect(prefetchFont).toHaveBeenCalledWith(aliased);

    init.startRenderer({ core });
    await pending;

    // One descriptor, one load: the core registers every name from it.
    expect(loadFont).toHaveBeenCalledTimes(1);
    expect(loadFont).toHaveBeenCalledWith(aliased);
  });
});
