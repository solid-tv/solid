import type { RendererOptions } from './renderer.js';
import type {
  TextProps,
  AnimationSettings,
  DollarString,
} from './intrinsicTypes.js';
import type { ElementNode } from './node/ElementNode.js';
import { convertToShader } from './node/shader.js';
import { setActiveElement as setActiveElementSignal } from './activeElement.js';

/**
  STATIC LIGHTNING CONFIGURATION \
  Replace the values below with in your build system, \
  or set them in the global scope before importing lightning-core.
  See `vite-env.d.ts` for environment variable type definitions.
*/

export { isDev, SHADERS_ENABLED } from './env.js';

/**
  RUNTIME LIGHTNING CONFIGURATION \
  This configuration can be set at runtime, but it is recommended to set it
  before running any Lightning modules to ensure consistent behavior across the application.
*/
export interface Config {
  debug: boolean;
  focusDebug: boolean;
  keyDebug: boolean;
  focusHistoryDebug: number;
  animationSettings?: AnimationSettings;
  animationsEnabled: boolean;
  fontSettings: Partial<TextProps>;
  /** Renderer settings: what `startRenderer` takes. */
  rendererOptions?: RendererOptions;
  /**
   * Hook the focus manager calls to publish the active element. Defaults to
   * writing the {@link activeElement} signal directly; a custom focus manager
   * (or the built-in `useFocusManager`) may reassign this — e.g. to run the
   * write inside a captured Solid owner context. This is the seam that keeps
   * the `activeElement` signal decoupled from focus-manager logic.
   */
  setActiveElement: (elm: ElementNode) => void;
  focusStateKey: DollarString;
  lockStyles?: boolean;
  fontWeightAlias?: Record<string, number | string>;
  throttleInput?: number;
  /**
   * Call `preventDefault()` on every key event the app consumed: a handler
   * returned `true`, or the focus manager dropped the press itself (a
   * throttled press, a suppressed repeat). A host that hands the system
   * whatever the app leaves unhandled, such as the Menu button on tvOS,
   * reads it to tell the two apart. Off by default: in a browser it would
   * also stop the default action of every handled key.
   */
  preventDefaultOnHandledKeys: boolean;
  taskDelay?: number;
  /**
   * Make the shader a node's shader props call for, and give it to the node
   * (attach, and the first shader prop written after it).
   */
  convertToShader: (node: ElementNode) => void;
  stateOrder?: DollarString[];
}

export const Config: Config = {
  debug: false,
  focusDebug: false,
  keyDebug: false,
  focusHistoryDebug: 0,
  animationsEnabled: true,
  animationSettings: {
    duration: 250,
    easing: 'ease-in-out',
  },
  convertToShader,
  setActiveElement: (elm) => setActiveElementSignal(elm),
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
  preventDefaultOnHandledKeys: false,
  rendererOptions: {},
  stateOrder: [],
};
