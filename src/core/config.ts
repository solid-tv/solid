import type { RendererMainSettings } from '@solidtv/renderer';
import type {
  TextProps,
  AnimationSettings,
  DollarString,
  StyleEffects,
} from './intrinsicTypes.js';
import {
  type ElementNode,
  convertToShader as defaultConvertToShader,
} from './elementNode.js';
import { setActiveElement as setActiveElementSignal } from './activeElement.js';
import {
  DomRendererMainSettings,
  IRendererShader,
} from './dom-renderer/domRendererTypes.js';

/**
  STATIC LIGHTNING CONFIGURATION \
  Replace the values below with in your build system, \
  or set them in the global scope before importing lightning-core.
  See `vite-env.d.ts` for environment variable type definitions.
*/

export { isDev, DOM_RENDERING, SHADERS_ENABLED } from './env.js';
import { DOM_RENDERING } from './env.js';

/**
 * True when the DOM renderer is both built in (`DOM_RENDERING`) and turned on
 * at runtime (`Config.domRendererEnabled`). `Config.domRendererEnabled` is
 * mutable up until the renderer starts, so this is a function rather than a
 * constant.
 *
 * NOTE: do not use this to gate code paths whose dead-code elimination matters
 * (e.g. branches that reference DOM-renderer-only modules). Bundlers don't
 * inline this call, so the gated branch — and its imports — stay live. In
 * those spots inline `DOM_RENDERING && Config.domRendererEnabled` so the
 * `DOM_RENDERING` build constant can collapse the branch.
 */
export const isDomRendererActive = () =>
  DOM_RENDERING && Config.domRendererEnabled;

/**
  RUNTIME LIGHTNING CONFIGURATION \
  This configuration can be set at runtime, but it is recommended to set it
  before running any Lightning modules to ensure consistent behavior across the application.
*/
export interface Config {
  debug: boolean;
  focusDebug: boolean;
  domRendererEnabled: boolean;
  keyDebug: boolean;
  focusHistoryDebug: number;
  animationSettings?: AnimationSettings;
  animationsEnabled: boolean;
  fontSettings: Partial<TextProps>;
  rendererOptions?: Partial<RendererMainSettings> | DomRendererMainSettings;
  /**
   * Hook the focus manager calls to publish the active element. Defaults to
   * writing the {@link activeElement} signal directly; a custom focus manager
   * (or the built-in `useFocusManager`) may reassign this — e.g. to run the
   * write inside a captured Solid owner context. This is the seam that keeps
   * the `activeElement` signal decoupled from focus-manager logic.
   */
  setActiveElement: (elm: ElementNode) => void;
  /**
   * When the focused element is removed from the tree, automatically refocus
   * the nearest still-attached ancestor on its focus path (letting that
   * ancestor's `forwardFocus`/`selected` logic pick a child). Prevents key
   * events from dead-ending on a stale focus path. Defaults to true.
   */
  focusLossRecovery: boolean;
  focusStateKey: DollarString;
  lockStyles?: boolean;
  fontWeightAlias?: Record<string, number | string>;
  throttleInput?: number;
  taskDelay?: number;
  convertToShader: (_node: ElementNode, v: StyleEffects) => IRendererShader;
  stateOrder?: DollarString[];
}

export const Config: Config = {
  debug: false,
  domRendererEnabled: false,
  focusDebug: false,
  keyDebug: false,
  focusHistoryDebug: 0,
  animationsEnabled: true,
  animationSettings: {
    duration: 250,
    easing: 'ease-in-out',
  },
  convertToShader: defaultConvertToShader,
  setActiveElement: (elm) => setActiveElementSignal(elm),
  focusLossRecovery: true,
  fontSettings: {
    fontFamily: 'Ubuntu',
    fontSize: 100,
  },
  fontWeightAlias: {
    thin: 100,
    light: 300,
    regular: '',
    400: '',
    medium: 500,
    bold: 700,
    black: 900,
  },
  focusStateKey: '$focus',
  lockStyles: true,
  rendererOptions: {},
  stateOrder: [],
};
