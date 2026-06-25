import { vi, describe, it, expect, afterEach } from 'vitest';
import { getWebglSupportedVersions } from '../src/utils.ts';

// jsdom has no real WebGL, so stub the globals the detection branch checks and
// hand back a fake context that reports support + exposes the lifecycle methods
// the probe-cleanup path calls.
function fakeGl(opts: { contextLost?: boolean } = {}) {
  return {
    getParameter: vi.fn(),
    isContextLost: vi.fn(() => opts.contextLost === true),
    getExtension: vi.fn((name: string) =>
      name === 'WEBGL_lose_context' ? { loseContext: vi.fn() } : null,
    ),
  };
}

function stubCanvas(getContext: (id: string) => unknown) {
  vi.stubGlobal('WebGLRenderingContext', class {});
  vi.stubGlobal('WebGL2RenderingContext', class {});
  const createElement = vi.spyOn(document, 'createElement').mockReturnValue({
    getContext: vi.fn(getContext),
  } as unknown as HTMLElement);
  return createElement;
}

describe('getWebglSupportedVersions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('releases the probe context instead of leaking a GL slot', () => {
    const gl = fakeGl();
    // Unique id list per test so the module-level cache never collides across
    // tests (vitest runs this file with isolate:false).
    stubCanvas((id) => (id === 'webgl-a' ? gl : null));

    const versions = getWebglSupportedVersions(['webgl-a']);

    expect(versions).toEqual(['webgl-a']);
    expect(gl.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
  });

  it('creates a probe context at most once across repeated calls', () => {
    const gl = fakeGl();
    const createElement = stubCanvas((id) => (id === 'webgl-b' ? gl : null));

    getWebglSupportedVersions(['webgl-b']);
    getWebglSupportedVersions(['webgl-b']);
    getWebglSupportedVersions(['webgl-b']);

    // Only the first call probes; the rest hit the cache and create nothing.
    expect(createElement).toHaveBeenCalledTimes(1);
  });

  it('does not call loseContext when the probe context is already lost', () => {
    const gl = fakeGl({ contextLost: true });
    const ext = { loseContext: vi.fn() };
    gl.getExtension = vi.fn(() => ext);
    stubCanvas((id) => (id === 'webgl-c' ? gl : null));

    getWebglSupportedVersions(['webgl-c']);

    expect(ext.loseContext).not.toHaveBeenCalled();
  });

  it('does not throw when no WebGL context is available', () => {
    stubCanvas(() => null);
    expect(() => getWebglSupportedVersions(['webgl-d'])).not.toThrow();
    expect(getWebglSupportedVersions(['webgl-d'])).toEqual([]);
  });
});
