import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RendererCore } from '@solidtv/renderer';

// `core` is a module singleton, so each case loads a fresh copy of the module.
const load = () => import('../src/core/renderer.js');
const headless = () => new RendererCore({ appWidth: 640, appHeight: 360 });

describe('startRenderer', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the core it is given, with no Renderer', async () => {
    const mod = await load();
    const given = headless();
    const started = mod.startRenderer({ core: given });
    expect(started.core).toBe(given);
    expect(started.renderer).toBeNull();
    // `core` is a live binding: read it through the namespace.
    expect(mod.core).toBe(given);
  });

  it('warns once about a setting 2.0 dropped, and carries on', async () => {
    const { startRenderer } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const given = headless();
    const started = startRenderer({ core: given, renderEngine: {} } as any);
    expect(started.core).toBe(given);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('renderEngine');
  });

  it('called twice returns the first core and warns', async () => {
    const { startRenderer } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = headless();
    expect(startRenderer({ core: first }).core).toBe(first);
    expect(warn).not.toHaveBeenCalled();
    const second = startRenderer({ core: headless() });
    expect(second.core).toBe(first);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  describe('the GL path', () => {
    afterEach(() => {
      vi.doUnmock('@solidtv/renderer');
    });

    // A Renderer stand-in that records its arguments and is a real core.
    const mockRenderer = async () => {
      const calls: unknown[][] = [];
      vi.doMock('@solidtv/renderer', async (original) => {
        const real = await original<typeof import('@solidtv/renderer')>();
        return {
          ...real,
          Renderer: function (...args: unknown[]) {
            calls.push(args);
            return new real.RendererCore({ appWidth: 640, appHeight: 360 });
          },
        };
      });
      return calls;
    };

    it('mounts on "app" by default and keeps canvas and core out of the settings', async () => {
      const calls = await mockRenderer();
      const mod = await load();
      const started = mod.startRenderer({ appWidth: 1280, appHeight: 720 });
      expect(calls.length).toBe(1);
      expect(calls[0]![1]).toBe('app');
      expect(calls[0]![0]).toEqual({ appWidth: 1280, appHeight: 720 });
      expect(started.renderer).not.toBeNull();
      expect(started.core).toBe(started.renderer);
      // A second call returns the first call's renderer too.
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(mod.startRenderer({ core: headless() }).renderer).toBe(
        started.renderer,
      );
    });

    it('passes the canvas target through as the second argument', async () => {
      const calls = await mockRenderer();
      const { startRenderer } = await load();
      const target = document.createElement('div');
      startRenderer({ canvas: target, appWidth: 800 });
      expect(calls[0]![1]).toBe(target);
      expect(Object.keys(calls[0]![0] as object)).toEqual(['appWidth']);
    });
  });

  it('loadFonts before startRenderer prefetches and waits, then loads through the core', async () => {
    // The real prefetch would start a network request.
    const prefetchFont = vi.fn();
    vi.doMock('@solidtv/renderer', async (original) => ({
      ...(await original<typeof import('@solidtv/renderer')>()),
      prefetchFont,
    }));
    const mod = await load();
    vi.doUnmock('@solidtv/renderer');
    const font = {
      fontFamily: 'Test',
      atlasUrl: 'test.png',
      atlasDataUrl: 'test.json',
    };
    const given = headless();
    const loadFont = vi
      .spyOn(given, 'loadFont')
      .mockImplementation(() => Promise.resolve());
    let done = false;
    const pending = mod.loadFonts([font]).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    expect(prefetchFont).toHaveBeenCalledWith(font);
    expect(loadFont).not.toHaveBeenCalled();
    mod.startRenderer({ core: given });
    await pending;
    expect(loadFont).toHaveBeenCalledWith(font);
  });

  it('createRenderer({ core }) wraps the core root in the root ElementNode', async () => {
    const { createRenderer } = await import('../src/render.js');
    const given = new RendererCore({ appWidth: 100, appHeight: 50 });
    const { rootNode, renderer } = createRenderer({ core: given });
    expect(renderer).toBe(given);
    expect(rootNode.slot).toBe(given.root.slot);
    expect(rootNode.rendered).toBe(true);
    expect(rootNode.width).toBe(100);
    expect(rootNode.height).toBe(50);
    expect(given.nodes.handles[given.root.slot]).toBe(rootNode);
  });
});
