import * as lng from '@solidtv/renderer';
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
  return renderer;
}

export async function loadFonts(fonts: FontLoadOptions[]) {
  // Inlined so the loadFontToDom branch + import tree-shake in WebGL builds.
  const enableDomRenderer = DOM_RENDERING && Config.domRendererEnabled;
  await Promise.all(
    fonts.map((font) => {
      // WebGL — SDF
      if (
        renderer.stage.renderer.mode === 'webgl' &&
        'type' in font &&
        (font.type === 'msdf' || font.type === 'ssdf')
      ) {
        return renderer.stage.loadFont('sdf', font);
      }
      // Canvas — Web
      if ('fontUrl' in font) {
        if (enableDomRenderer) {
          loadFontToDom(font);
        } else {
          return renderer.stage.loadFont('canvas', font);
        }
      }
    }),
  );
}
