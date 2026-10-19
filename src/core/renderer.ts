import {
  Renderer,
  type CoreSettings,
  type FontLoadOptions,
  type RendererCore,
  type RendererMainSettings,
} from '@solidtv/renderer';
import { isDev } from './env.js';

/**
 * Settings for `startRenderer`: the core's settings, the GL loop's options of
 * the renderer's `Renderer`, the `canvas` target, or an existing `core` to use
 * headless.
 */
export interface RendererOptions
  extends Partial<CoreSettings>, Omit<Partial<RendererMainSettings>, 'canvas'> {
  /** The element (or its id) the renderer's canvas goes into. Default `app`. */
  canvas?: HTMLElement | string;
  /** Use this core as it is: no `Renderer`, no canvas, no GL loop. */
  core?: RendererCore;
}

/** The one core of the app, set by `startRenderer`. */
export let core: RendererCore;

// @solidtv/renderer 2.x has one engine (WebGL) and one text engine (SDF), the
// DOM renderer is gone, and the stage is the renderer: these 1.x settings are
// ignored.
const DROPPED_SETTINGS = ['renderEngine', 'fontEngines', 'domRendererEnabled'];

function warnDropped(name: string) {
  console.warn(
    '[solid] Config.rendererOptions.' +
      name +
      ' was removed in @solidtv/renderer 2.0 and is ignored',
  );
}

/**
 * Start the app's renderer, or adopt `options.core`: the core is then used
 * headless (`renderer` is null). A second call returns the first core.
 */
export function startRenderer(options: RendererOptions): {
  core: RendererCore;
  renderer: Renderer | null;
} {
  if (core !== undefined) {
    if (isDev) {
      console.warn(
        '[solid] startRenderer was called more than once: the first core is kept',
      );
    }
    return { core, renderer: null };
  }

  if (isDev) {
    const source = options as { [name: string]: unknown };
    for (let i = 0; i < DROPPED_SETTINGS.length; i++) {
      if (source[DROPPED_SETTINGS[i]!] !== undefined) {
        warnDropped(DROPPED_SETTINGS[i]!);
      }
    }
  }

  if (options.core !== undefined) {
    core = options.core;
    return { core, renderer: null };
  }

  const renderer = new Renderer(
    options as Partial<RendererMainSettings>,
    options.canvas,
  );
  core = renderer;
  return { core, renderer };
}

/**
 * Load SDF fonts into the core. Needs `startRenderer` to have run.
 */
export async function loadFonts(fonts: FontLoadOptions[]): Promise<void> {
  await Promise.all(fonts.map((font) => core.loadFont(font)));
}
