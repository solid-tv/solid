// The jsdom suite's host (spec 6): a headless RendererCore (the real store,
// scene pass, text layout, shader packing and animation step; no canvas, no
// WebGL). Tests drive frames with `tick()`.
import { RendererCore } from '@solidtv/renderer';
import * as lng from '@solidtv/solid';
import { loadBoxFont } from './fonts.js';

export const core = new RendererCore({ appWidth: 1920, appHeight: 1080 });
lng.registerDefaultShaders(core);

export const renderer = lng.createRenderer({ core });

/** One frame: advance animations 16 ms, update the scene, deliver events. */
export const tick = () => {
  core.step(16);
  core.update();
  core.events.flush();
};

/** Settle the microtask queue (the post-mutation pass), then one frame. */
export const waitForUpdate = async () => {
  await Promise.resolve();
  await Promise.resolve();
  tick();
};

// The Box font (tests/fonts.ts: every glyph advances 8 at design size 10)
// under the family the text tests use by default, Config.fontSettings'.
await loadBoxFont(core, lng.Config.fontSettings.fontFamily!);
