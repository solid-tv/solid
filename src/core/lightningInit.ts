import * as lng from '@solidtv/renderer';
import { prefetchFont } from '@solidtv/renderer';
import { Config, DOM_RENDERING } from './config.js';
import { DOMRendererMain, loadFontToDom } from './dom-renderer/domRenderer.js';
import { DomRendererMainSettings } from './dom-renderer/domRendererTypes.js';
import { FontLoadOptions } from './intrinsicTypes.js';

export type SdfFontType = 'ssdf' | 'msdf';
// Global renderer instance: can be either the Lightning or DOM implementation
export let renderer: lng.RendererMain | DOMRendererMain;

export const getRenderer = () => renderer;

export function startLightningRenderer(
  options: lng.RendererMainSettings | DomRendererMainSettings,
  rootId: string | HTMLElement = 'app',
) {
  // Inlined (not isDomRendererActive()) so bundlers can fold DOM_RENDERING to
  // false and drop the DOMRendererMain branch + import in WebGL builds.
  const enableDomRenderer = DOM_RENDERING && Config.domRendererEnabled;

  renderer = enableDomRenderer
    ? new DOMRendererMain(options, rootId)
    : new lng.RendererMain(options, rootId);

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
        return renderer.stage.loadFont('sdf', font as lng.FontLoadOptions);
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
