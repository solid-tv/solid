import {
  Renderer,
  prefetchFont,
  type CoreSettings,
  type FontLoadOptions,
  type RendererCore,
  type RendererMainSettings,
} from '@solidtv/renderer';
import { isDev } from './env.js';
import { fontFailed, fontLoaded } from './fontLoaded.js';

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

/** The Renderer the first `startRenderer` made, null when it adopted a core. */
let glRenderer: Renderer | null = null;

/**
 * The app's renderer (1.x's export): the core `startRenderer` made or
 * adopted, a `Renderer` unless headless.
 */
export let renderer: RendererCore;

/** `renderer`, read at call time. */
export const getRenderer = (): RendererCore => renderer;

/**
 * A `loadFonts()` call made before the renderer existed. The download is
 * already in flight (`prefetchFont`); only the core-dependent half is owed.
 */
interface PendingFontLoad {
  fonts: FontLoadOptions[];
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

const pendingFontLoads: PendingFontLoad[] = [];

function attachFonts(fonts: FontLoadOptions[]): Promise<unknown> {
  // Loaded: Solid measures the texts that waited for a font, those under a
  // hidden or out-of-bounds ancestor too (no walk visits them, so they hear
  // no `loaded`). Failed: the same, so destroyed ones leave the list; the
  // rejection goes on.
  return Promise.all(
    fonts.map((font) => core.loadFont(font).then(fontLoaded, fontFailed)),
  );
}

function flushPendingFonts() {
  const queued = pendingFontLoads.splice(0, pendingFontLoads.length);
  for (let i = 0; i < queued.length; i++) {
    const pending = queued[i]!;
    attachFonts(pending.fonts).then(() => pending.resolve(), pending.reject);
  }
}

/**
 * Start the app's renderer, or adopt `options.core`: the core is then used
 * headless (`renderer` is null). A second call returns the first call's core
 * and renderer.
 */
export function startRenderer(options: RendererOptions): {
  core: RendererCore;
  renderer: Renderer | null;
} {
  if (core !== undefined) {
    if (isDev) {
      console.warn(
        '[solid] startRenderer was called more than once: the new options and core are ignored, the first core is kept',
      );
    }
    return { core, renderer: glRenderer };
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
  } else {
    // The Renderer's own `canvas` setting is an HTMLCanvasElement; ours is the
    // mount target, which is its second argument. Key by key, not spread.
    const source = options as { [name: string]: unknown };
    const settings: { [name: string]: unknown } = {};
    const keys = Object.keys(source);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      if (key !== 'canvas' && key !== 'core') {
        settings[key] = source[key];
      }
    }
    glRenderer = new Renderer(
      settings as Partial<RendererMainSettings>,
      options.canvas === undefined ? 'app' : options.canvas,
    );
    core = glRenderer;
  }
  renderer = core;

  // A core exists, so any fonts requested before this point can finish.
  flushPendingFonts();

  return { core, renderer: glRenderer };
}

/**
 * Load SDF fonts into the core.
 *
 * Can be called either side of `startRenderer()`. Calling it *first* is
 * preferred: the downloads start immediately and overlap the renderer's boot.
 * The fonts are then attached as soon as the core exists, and the returned
 * promise cannot settle until `startRenderer()` has run: do not `await` it
 * before starting the renderer.
 */
export function loadFonts(fonts: FontLoadOptions[]): Promise<void> {
  // A synchronous throw rejects the promise, as it did under `await`.
  try {
    if (core !== undefined) {
      return attachFonts(fonts).then(toVoid);
    }

    if (fonts.length === 0) {
      return Promise.resolve();
    }
    for (let i = 0; i < fonts.length; i++) {
      prefetchFont(fonts[i]!);
    }
    return new Promise<void>((resolve, reject) => {
      pendingFontLoads.push({ fonts, resolve, reject });
    });
  } catch (error) {
    // Rethrown inside a promise: the rejection reason is the caller's, as it was.
    return new Promise<void>(() => {
      throw error;
    });
  }
}

function toVoid(): void {}
