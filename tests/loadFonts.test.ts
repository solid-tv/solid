import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// `loadFonts()` may be called either side of `createRenderer()`. Calling it
// first is the point of the prefetch: the download overlaps renderer boot
// instead of queueing behind it. Calling it after must keep behaving exactly
// as it always did.
//
// Both paths hinge on the module-level `renderer` in lightningInit being unset,
// so each case re-imports the module against a mocked renderer package.

const prefetchFont = vi.fn();
const loadFont = vi.fn(() => Promise.resolve());

vi.mock('@solidtv/renderer', () => {
  class RendererMain {
    root = {};
    stage = {
      renderer: { mode: 'webgl' },
      textRenderers: { sdf: {} },
      loadFont,
    };
    on() {}
  }
  return { RendererMain, prefetchFont };
});

const sdfFont = {
  type: 'msdf' as const,
  fontFamily: 'Roboto',
  atlasUrl: 'Roboto.png',
  atlasDataUrl: 'Roboto.json',
};

async function freshInit() {
  vi.resetModules();
  return import('../src/core/lightningInit.js');
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('loadFonts', () => {
  beforeEach(() => {
    prefetchFont.mockClear();
    loadFont.mockClear();
  });

  // Leave the module registry clean for any test file that loads afterwards.
  afterAll(() => {
    vi.resetModules();
  });

  it('starts the download before the renderer exists, and attaches once it does', async () => {
    const init = await freshInit();

    const pending = init.loadFonts([sdfFont]);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    // Network started; nothing handed to a stage that does not exist yet.
    expect(prefetchFont).toHaveBeenCalledWith(sdfFont);
    expect(loadFont).not.toHaveBeenCalled();
    await flush();
    expect(settled).toBe(false);

    init.startLightningRenderer({}, document.createElement('div'));

    await pending;
    expect(loadFont).toHaveBeenCalledWith('sdf', sdfFont);
  });

  it('attaches immediately when the renderer already exists', async () => {
    const init = await freshInit();
    init.startLightningRenderer({}, document.createElement('div'));

    await init.loadFonts([sdfFont]);

    expect(loadFont).toHaveBeenCalledWith('sdf', sdfFont);
    // Nothing to prefetch — the stage is right there.
    expect(prefetchFont).not.toHaveBeenCalled();
  });

  it('rejects the deferred call when attaching fails', async () => {
    const init = await freshInit();
    loadFont.mockImplementationOnce(() => Promise.reject(new Error('boom')));

    const pending = init.loadFonts([sdfFont]);
    init.startLightningRenderer({}, document.createElement('div'));

    await expect(pending).rejects.toThrow('boom');
  });

  it('registers every alias of a multi-name font', async () => {
    const init = await freshInit();
    const aliased = { ...sdfFont, fontFamily: ['Roboto', 'Roboto500'] };

    const pending = init.loadFonts([aliased]);
    expect(prefetchFont).toHaveBeenCalledWith(aliased);

    init.startLightningRenderer({}, document.createElement('div'));
    await pending;

    // One descriptor, one load — the renderer registers every name from it.
    expect(loadFont).toHaveBeenCalledTimes(1);
    expect(loadFont).toHaveBeenCalledWith('sdf', aliased);
  });
});
