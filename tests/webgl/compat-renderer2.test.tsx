/**
 * Decision 5.6 on the real renderer: 1.x apps register shader types through
 * `renderer.stage.shManager.registerShaderType`, which @solidtv/renderer 2.0
 * removed (the stage is the renderer). Solid keeps it working, with one
 * warning. The option half (renderEngine, fontEngines) and the DOM renderer
 * are in tests/compat-renderer2.test.ts.
 *
 *   pnpm test:webgl
 */
import * as v from 'vitest';
import { Rounded } from '@solidtv/renderer/shaders';
import { renderer } from './setup.js';

type Stage = {
  shManager: {
    registerShaderType(name: string, type: unknown): void;
  };
};

v.test(
  'stage.shManager.registerShaderType registers on the renderer, and warns once',
  () => {
    const warn = v.vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stage = renderer.stage as unknown as Stage;

    stage.shManager.registerShaderType('compatRounded', Rounded);
    stage.shManager.registerShaderType('compatRounded2', Rounded);

    // The type is registered: createShader finds it (it warns and returns null
    // for a name that is not registered).
    v.expect(renderer.createShader('compatRounded', { radius: 8 })).not.toBe(
      null,
    );
    v.expect(renderer.createShader('compatRounded2')).not.toBe(null);
    v.expect(renderer.createShader('compatNotRegistered')).toBe(null);

    const solid = warn.mock.calls
      .map((args) => String(args[0]))
      .filter((message) => message.indexOf('[solid]') === 0);
    v.expect(solid).toEqual([
      '[solid] renderer.stage.shManager was removed in @solidtv/renderer 2.0: use renderer.registerShaderType',
    ]);
    warn.mockRestore();
  },
);

v.test('stage.shManager is the renderer', () => {
  const stage = renderer.stage as unknown as Stage;
  v.expect(stage.shManager).toBe(renderer);
});
