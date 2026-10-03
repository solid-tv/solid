/// <reference types="vite/client" />
// Shared setup for the real-renderer tests (vitest.webgl.config.ts): one
// @solidtv/renderer instance (WebGL, SDF text) per test file, with the Lato
// MSDF font loaded before anything renders.
import { RendererMain } from '@solidtv/renderer';
import { Config, createRenderer, loadFonts } from '@solidtv/solid';
import latoData from './fonts/Lato-Regular.msdf.json?url';
import latoAtlas from './fonts/Lato-Regular.msdf.png?url';

export const FONT_FAMILY = 'Lato';

/** The font every test lays text out with. */
export function latoFont(fontFamily: string) {
  return {
    type: 'msdf' as const,
    fontFamily,
    atlasDataUrl: latoData,
    atlasUrl: latoAtlas,
  };
}

// Read once, at the first text render: set before anything renders.
Config.fontSettings = { fontFamily: FONT_FAMILY, fontSize: 30 };

const root = document.createElement('div');
document.body.appendChild(root);

// Called before createRenderer, as apps do: the download overlaps the boot.
const fontsReady = loadFonts([latoFont(FONT_FAMILY)]);

const created = createRenderer({ appWidth: 1920, appHeight: 1080 }, root);

// The point of these tests: the WebGL renderer, not the DOM one.
if (!(created.renderer instanceof RendererMain)) {
  throw new Error('tests/webgl must run on @solidtv/renderer, not the DOM');
}

export const render = created.render;
export const renderer: RendererMain = created.renderer;

// Resolves once the description and the atlas are in (FontRegistry).
await fontsReady;

let frames = 0;
renderer.on('frameTick', () => {
  frames++;
});

/** Frames the renderer has run since it started (its `frameTick` events). */
export const frameCount = () => frames;

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      // A macrotask after the frame: Solid's post-mutation microtask and
      // anything the frame's events queued have run by then.
      setTimeout(resolve, 0);
    });
  });

/**
 * Wait until layout has settled: no font in flight, no frame requested
 * (store writes, Solid's reprocessUpdates), for two animation frames in a
 * row. Text lays out inside the renderer's walk, its `loaded` event runs
 * Solid's flex between walks, and a write that misses the frame's last walk
 * asks for another frame, so "no frame requested" means nothing is pending.
 */
export async function settle(maxFrames = 300): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < maxFrames; i++) {
    await nextFrame();
    if (renderer.frameRequested === false && renderer.pendingFonts === 0) {
      if (++quiet === 2) {
        return;
      }
    } else {
      quiet = 0;
    }
  }
  throw new Error(`layout did not settle in ${maxFrames} frames`);
}
