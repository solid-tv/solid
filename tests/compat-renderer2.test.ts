import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// Phase 2 stream M, decision 5.6: @solidtv/renderer 2.0 removed
// `Config.rendererOptions.renderEngine` and `.fontEngines` (WebGL and SDF text
// are the only engines) and `renderer.stage.shManager` (the stage is the
// renderer: `registerShaderType` is on it). Solid absorbs the three: the
// options are dropped before the renderer is built, `shManager` is an alias of
// the renderer, and each says once, in every build, that it was removed.
//
// The DOM renderer is the one active in this suite, so the real
// `startLightningRenderer` runs here against a mocked renderer package (as
// loadFonts.test.ts does). tests/webgl/compat-renderer2.test.tsx runs the
// same alias on the real renderer.

const h = vi.hoisted(() => ({
  constructed: [] as unknown[],
  instances: [] as unknown[],
}));

vi.mock('@solidtv/renderer', () => {
  class RendererMain {
    root = {};
    registered: [string, unknown][] = [];
    constructor(public settings: unknown) {
      h.constructed.push(settings);
      h.instances.push(this);
    }
    // @solidtv/renderer 2.0: the stage is the renderer.
    get stage() {
      return this;
    }
    registerShaderType(name: string, type: unknown) {
      this.registered.push([name, type]);
    }
    on() {}
  }
  return { RendererMain, prefetchFont() {} };
});

const RENDER_ENGINE_WARNING =
  '[solid] Config.rendererOptions.renderEngine was removed in @solidtv/renderer 2.0 and is ignored';
const FONT_ENGINES_WARNING =
  '[solid] Config.rendererOptions.fontEngines was removed in @solidtv/renderer 2.0 and is ignored';
const SH_MANAGER_WARNING =
  '[solid] renderer.stage.shManager was removed in @solidtv/renderer 2.0: use renderer.registerShaderType';

// The warn-once state is module state: each case imports a fresh module.
async function freshInit() {
  vi.resetModules();
  return import('../src/core/lightningInit.js');
}

type Stage = { shManager: Record<string, unknown> };

const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
const target = () => document.createElement('div');

describe('renderer 2.0 compatibility (5.6)', () => {
  beforeEach(() => {
    warn.mockClear();
    h.constructed.length = 0;
    h.instances.length = 0;
  });

  // Leave the module registry clean for any test file that loads afterwards.
  afterAll(() => {
    warn.mockRestore();
    vi.resetModules();
  });

  describe('renderEngine and fontEngines', () => {
    it('are not passed to the renderer', async () => {
      const init = await freshInit();
      const engine = class {};

      init.startLightningRenderer(
        {
          appWidth: 1280,
          renderEngine: engine,
          fontEngines: [engine],
          inspector: false,
        } as never,
        target(),
      );

      expect(h.constructed.length).toBe(1);
      const passed = h.constructed[0] as Record<string, unknown>;
      expect(passed).toEqual({ appWidth: 1280, inspector: false });
      expect('renderEngine' in passed).toBe(false);
      expect('fontEngines' in passed).toBe(false);
    });

    it("leave the app's own options object as it was", async () => {
      const init = await freshInit();
      const engine = class {};
      const options = { appWidth: 1280, renderEngine: engine };

      init.startLightningRenderer(options as never, target());

      expect(options).toEqual({ appWidth: 1280, renderEngine: engine });
      expect(h.constructed[0]).not.toBe(options);
    });

    it('hand the renderer the very object they were given when neither is set', async () => {
      const init = await freshInit();
      const options = { appWidth: 1280 };

      init.startLightningRenderer(options, target());

      expect(h.constructed[0]).toBe(options);
      expect(warn).not.toHaveBeenCalled();
    });

    it('each warn once, however many renderers are created', async () => {
      const init = await freshInit();
      const options = { renderEngine: class {}, fontEngines: [class {}] };

      init.startLightningRenderer(options as never, target());
      init.startLightningRenderer(options as never, target());

      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(RENDER_ENGINE_WARNING);
      expect(warn).toHaveBeenCalledWith(FONT_ENGINES_WARNING);
    });

    it('warn only for the one that is set', async () => {
      const init = await freshInit();

      init.startLightningRenderer(
        { fontEngines: [class {}] } as never,
        target(),
      );

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(FONT_ENGINES_WARNING);
    });
  });

  describe('renderer.stage.shManager', () => {
    it('registers a shader type on the renderer', async () => {
      const init = await freshInit();
      const renderer = init.startLightningRenderer({}, target());
      const type = { props: {} };

      (renderer.stage as unknown as Stage).shManager.registerShaderType(
        'rounded',
        type,
      );

      expect(
        (renderer as unknown as { registered: unknown[] }).registered,
      ).toEqual([['rounded', type]]);
    });

    it('is the renderer', async () => {
      const init = await freshInit();
      const renderer = init.startLightningRenderer({}, target());

      expect((renderer.stage as unknown as Stage).shManager).toBe(renderer);
    });

    it('warns once, on first use, not when the renderer is created', async () => {
      const init = await freshInit();
      const renderer = init.startLightningRenderer({}, target());
      expect(warn).not.toHaveBeenCalled();

      const stage = renderer.stage as unknown as Stage;
      void stage.shManager;
      void stage.shManager;
      stage.shManager.registerShaderType('shadow', {});

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(SH_MANAGER_WARNING);
    });

    it('warns once for every renderer together', async () => {
      const init = await freshInit();
      const first = init.startLightningRenderer({}, target());
      const second = init.startLightningRenderer({}, target());

      void (first.stage as unknown as Stage).shManager;
      void (second.stage as unknown as Stage).shManager;

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('is not enumerable: nothing that walks the renderer sees it', async () => {
      const init = await freshInit();
      const renderer = init.startLightningRenderer({}, target());

      expect(Object.keys(renderer)).not.toContain('shManager');
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
