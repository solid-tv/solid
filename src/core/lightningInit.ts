import * as lng from '@solidtv/renderer';
import { prefetchFont } from '@solidtv/renderer';
import { Config, DOM_RENDERING } from './config.js';
import { DOMRendererMain, loadFontToDom } from './dom-renderer/domRenderer.js';
import { DomRendererMainSettings } from './dom-renderer/domRendererTypes.js';
import { fontFailed, fontLoaded } from './fontLoaded.js';
import { FontLoadOptions } from './intrinsicTypes.js';

export type SdfFontType = 'ssdf' | 'msdf';
// Global renderer instance: can be either the Lightning or DOM implementation
export let renderer: lng.RendererMain | DOMRendererMain;

export const getRenderer = () => renderer;

// @solidtv/renderer 2.0 has one engine (WebGL) and one text engine (SDF), so
// these settings are gone; apps written for 1.x still pass them.
const REMOVED_SETTINGS = ['renderEngine', 'fontEngines'];

const warned: { [message: string]: true | undefined } = {};

/** `console.warn`, once per page, in every build (not only in dev). */
function warnOnce(message: string) {
  if (warned[message] !== true) {
    warned[message] = true;
    console.warn(message);
  }
}

/**
 * `options` without the settings 2.0 removed, each warned about once. The
 * app's own object is not touched: the same object is returned when it has
 * none of them, a copy when it does.
 */
function withoutRemovedSettings<T extends object>(options: T): T {
  const source = options as { [name: string]: unknown };
  let found = false;
  for (let i = 0; i < REMOVED_SETTINGS.length; i++) {
    const name = REMOVED_SETTINGS[i]!;
    if (source[name] !== undefined) {
      found = true;
      warnOnce(
        '[solid] Config.rendererOptions.' +
          name +
          ' was removed in @solidtv/renderer 2.0 and is ignored',
      );
    }
  }
  if (found === false) {
    return options;
  }

  const copy: { [name: string]: unknown } = {};
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (REMOVED_SETTINGS.indexOf(key) === -1) {
      copy[key] = source[key];
    }
  }
  return copy as T;
}

/**
 * 1.10's `renderer.stage.shManager.registerShaderType(...)`: in 2.0 the stage
 * is the renderer and `registerShaderType` is on it. Defined once, here, as an
 * alias of the renderer; it warns the first time an app reads it.
 */
function aliasShManager(rendererMain: lng.RendererMain) {
  Object.defineProperty(rendererMain, 'shManager', {
    configurable: true,
    get() {
      warnOnce(
        '[solid] renderer.stage.shManager was removed in @solidtv/renderer 2.0: use renderer.registerShaderType',
      );
      return rendererMain;
    },
  });
}

export function startLightningRenderer(
  options: lng.RendererMainSettings | DomRendererMainSettings,
  rootId: string | HTMLElement = 'app',
) {
  // Inlined (not isDomRendererActive()) so bundlers can fold DOM_RENDERING to
  // false and drop the DOMRendererMain branch + import in WebGL builds.
  const enableDomRenderer = DOM_RENDERING && Config.domRendererEnabled;
  const settings = withoutRemovedSettings(options);

  if (enableDomRenderer) {
    // Its stage has its own (inert) shManager.
    renderer = new DOMRendererMain(settings, rootId);
  } else {
    const rendererMain = new lng.RendererMain(
      settings as lng.RendererMainSettings,
      rootId,
    );
    aliasShManager(rendererMain);
    renderer = rendererMain;
  }

  // A stage now exists, so any fonts requested before this point can finish.
  flushPendingFonts();

  return renderer;
}

/**
 * A `loadFonts()` call made before the renderer existed. The download is
 * already in flight; only the stage-dependent half is still owed.
 */
interface PendingFontLoad {
  fonts: FontLoadOptions[];
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

const pendingFontLoads: PendingFontLoad[] = [];

/**
 * Hand fonts to the stage. Requires a renderer.
 */
function attachFonts(fonts: FontLoadOptions[]) {
  // Inlined so the loadFontToDom branch + import tree-shake in WebGL builds.
  const enableDomRenderer = DOM_RENDERING && Config.domRendererEnabled;
  return Promise.all(
    fonts.map((font) => {
      // The renderer draws SDF text only (@solidtv/renderer 2.0): an SDF
      // font goes to it, a web font to the DOM renderer.
      if (
        !enableDomRenderer &&
        (font.type === 'msdf' || font.type === 'ssdf')
      ) {
        // Loaded: Solid measures the texts that waited for a font, those
        // under a hidden or out-of-bounds ancestor too (no walk visits
        // them, so they hear no `loaded`). Failed: the same, so destroyed
        // ones leave the list; the rejection goes on.
        return renderer.stage
          .loadFont('sdf', font as lng.FontLoadOptions)
          .then(fontLoaded, fontFailed);
      }
      if (enableDomRenderer && font.fontUrl !== undefined) {
        loadFontToDom(font);
      }
    }),
  );
}

function flushPendingFonts() {
  if (pendingFontLoads.length === 0) {
    return;
  }

  const queued = pendingFontLoads.splice(0, pendingFontLoads.length);
  for (let i = 0; i < queued.length; i++) {
    const pending = queued[i]!;
    attachFonts(pending.fonts).then(() => pending.resolve(), pending.reject);
  }
}

/**
 * Load fonts into the renderer.
 *
 * Can be called either side of `createRenderer()`. Calling it *first* is
 * preferred: the downloads start immediately and overlap the renderer's boot
 * (GL context, shaders, buffers) instead of queueing behind it. The fonts are
 * then attached to the stage as soon as it exists.
 *
 * The returned promise resolves when the fonts are attached to the stage — so
 * when called before `createRenderer()`, it cannot settle until
 * `createRenderer()` has run. Do not `await` it before creating the renderer.
 */
export async function loadFonts(fonts: FontLoadOptions[]) {
  if (renderer !== undefined) {
    await attachFonts(fonts);
    return;
  }

  // Inlined so the loadFontToDom branch + import tree-shake in WebGL builds.
  const enableDomRenderer = DOM_RENDERING && Config.domRendererEnabled;
  const deferred: FontLoadOptions[] = [];

  for (let i = 0; i < fonts.length; i++) {
    const font = fonts[i]!;

    // The DOM path registers fonts with the document, never with a stage —
    // there is nothing to wait for, so finish it here.
    if (enableDomRenderer) {
      if ('fontUrl' in font) {
        loadFontToDom(font);
      }
      continue;
    }

    // Starts the download now; the stage-dependent half is owed until
    // `createRenderer()` runs and `flushPendingFonts()` attaches it. A web
    // font has no renderer path (2.0 draws SDF text only).
    if (font.type === 'msdf' || font.type === 'ssdf') {
      prefetchFont(font as lng.FontPrefetchOptions);
      deferred.push(font);
    }
  }

  if (deferred.length === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    pendingFontLoads.push({ fonts: deferred, resolve, reject });
  });
}
