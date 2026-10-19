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
});
