import { renderer } from './lightningInit.js';
import {
  type BorderRadius,
  type BorderStyle,
  type StyleEffects,
  type AnimationSettings,
  type ElementText,
  type Styles,
  type AnimationEvents,
  type AnimationEventHandler,
  AddColorString,
  TextProps,
  type OnEvent,
  NewOmit,
  SingleBorderStyle,
  type DollarString,
} from './intrinsicTypes.js';
import States, { type NodeStates } from './states.js';
import calculateFlexOld from './flex.js';
import calculateFlexNew from './flexLayout.js';

const calculateFlex = import.meta.env?.VITE_USE_NEW_FLEX
  ? calculateFlexNew
  : calculateFlexOld;
import {
  log,
  isArray,
  keyExists,
  isINode,
  isElementNode,
  isElementText,
  logRenderTree,
  isFunction,
} from './utils.js';
import { isDev, SHADERS_ENABLED } from './env.js';
import { Config, isDomRendererActive } from './config.js';
import type {
  RendererMain,
  INode,
  AnimateProps,
  IAnimationController,
  LinearGradientProps,
  RadialGradientProps,
  ShadowProps,
  ITextNodeProps,
  INodeProps,
} from '@solidtv/renderer';
import { assertTruthy } from '@solidtv/renderer/utils';
import { NodeType, TextNode } from './nodeTypes.js';
import {
  ForwardFocusHandler,
  setActiveElementCore,
  FocusNode,
} from './focusManager.js';
import { initClickInspector } from './clickInspector.js';

import {
  IRendererNode,
  IRendererNodeProps,
  IRendererShader,
  IRendererShaderProps,
  IRendererTextNode,
  IRendererTextNodeProps,
} from './dom-renderer/domRendererTypes.js';

// Unified post-mutation scheduler.
//
// Three phases run in one microtask (or one renderer-tick callback):
//   1. delete-flush — destroy nodes that were removed and not re-inserted
//   2. layout       — recompute flex layout for any dirty subtree
//   3. focus        — resolve forwardFocus on deferred elements, then apply
//
// Order matters: layout reads the rendered tree (so destroyed nodes must be
// gone), and focus reads the laid-out tree.
let postMutationQueued = false;
let nextActiveElement: ElementNode | null = null;
let deferredFocusElement: ElementNode | null = null;
const layoutQueue = new Set<ElementNode>();
const elementDeleteQueue: ElementNode[] = [];

export function enqueueDelete(node: ElementNode, n: number): void {
  if (node._queueDelete === undefined) {
    node._queueDelete = n;
    if (elementDeleteQueue.push(node) === 1) {
      schedulePostMutation();
    }
  } else {
    node._queueDelete += n;
  }
}

function schedulePostMutation() {
  if (postMutationQueued) return;
  postMutationQueued = true;
  if ('reprocessUpdates' in renderer.stage && renderer.stage.reprocessUpdates) {
    renderer.stage.reprocessUpdates(runPostMutation);
  }
  queueMicrotask(runPostMutation);
}

function runPostMutation() {
  postMutationQueued = false;

  // Phase 1: delete-flush
  if (elementDeleteQueue.length > 0) {
    for (const el of elementDeleteQueue) {
      if ((el._queueDelete ?? 0) < 0) {
        el.destroy();
      }
      el._queueDelete = undefined;
    }
    elementDeleteQueue.length = 0;
  }

  // Phase 2: layout
  while (layoutQueue.size > 0) {
    const queue = [...layoutQueue];
    layoutQueue.clear();
    for (let i = queue.length - 1; i >= 0; i--) {
      const node = queue[i] as ElementNode;
      node.updateLayout();
    }
  }

  // Phase 3: focus.  setFocus() may have evaluated forwardFocus pre-render
  // (when no children existed yet); deferredFocusElement re-runs setFocus
  // here once the subtree has rendered, then setActiveElementCore is applied.
  if (deferredFocusElement !== null) {
    const el = deferredFocusElement;
    deferredFocusElement = null;
    el.setFocus();
  } else if (nextActiveElement !== null) {
    const element = nextActiveElement;
    nextActiveElement = null;
    setActiveElementCore(element);
  }
}

function addToLayoutQueue(node: ElementNode) {
  layoutQueue.add(node);
  schedulePostMutation();
}

// Text-default template, built once on first use.  Config.fontSettings is
// expected to be set at app startup and not change afterwards.
let _fontTemplate: Array<[string, any]> | undefined;
let _fontFamilyIdx = -1;
let _fontFamilyWithWeight: string | undefined;

function buildFontTemplate() {
  const tpl: Array<[string, any]> = [];
  const fs = Config.fontSettings;
  if (fs) {
    for (const key in fs) {
      if (key === 'fontFamily') {
        _fontFamilyIdx = tpl.length;
        _fontFamilyWithWeight = `${fs.fontFamily}${fs.fontWeight || ''}`;
      }
      tpl.push([key, fs[key]]);
    }
  }
  _fontTemplate = tpl;
}

const EFFECT_SHADER_KEYS = [
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'shadow',
] as const satisfies ReadonlyArray<keyof StyleEffects>;

const parseAndAssignShaderProps = (
  prefix: string,
  obj: Record<string, unknown>,
  props: Record<string, unknown> = {},
) => {
  if (!obj) return;

  // Handle individual border sides: transform width/w to bottom/left/right/top
  const borderSideMap: Record<string, string> = {
    borderBottom: 'bottom',
    borderLeft: 'left',
    borderRight: 'right',
    borderTop: 'top',
  };

  const side = borderSideMap[prefix];
  const actualPrefix = side ? 'border' : prefix;

  props[actualPrefix] = obj;
  Object.entries(obj).forEach(([key, value]) => {
    let transformedKey = key === 'width' ? 'w' : key;

    // If border side and key is width/w, transform to side (bottom/left/right/top)
    if (side && transformedKey === 'w') {
      transformedKey = side;
    }

    props[`${actualPrefix}-${transformedKey}`] = value;
  });
};

export function convertToShader(
  _node: ElementNode,
  v: StyleEffects,
): IRendererShader {
  let type = 'rounded';
  if (v.border) type += 'WithBorder';
  if (v.shadow) type += 'WithShadow';
  return renderer.createShader(
    type,
    v as Record<string, unknown>,
  ) as IRendererShader;
}

declare global {
  interface HTMLElement {
    /** Assigned for development, to quickly get ElementNode from selected HTMLElement */
    element?: ElementNode;
  }
}

initClickInspector();

export type RendererNode = AddColorString<
  Partial<
    NewOmit<
      INode,
      'parent' | 'shader' | 'src' | 'children' | 'id' | 'removeChild'
    >
  >
>;
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface ElementNode extends RendererNode, FocusNode {
  [key: string]: unknown;

  // Properties
  /** @internal for managing series of insertions and deletions */
  _queueDelete?: number;
  _animationQueue?:
    | Array<{
        props: Partial<AnimateProps>;
        animationSettings?: AnimationSettings;
      }>
    | undefined;
  _animationQueueSettings?: AnimationSettings;
  _animationRunning?: boolean;
  _animationSettings?: AnimationSettings;
  _autofocus?: any;
  _containsFlexGrow?: boolean | null;
  _hasRenderedChildren?: boolean;
  _effects?: Record<string, any>;
  _fontFamily?: string;
  _id: string | undefined;
  _parent: ElementNode | undefined;
  _rendererProps?: any;
  _states?: States;
  _style?: Styles;
  /** @internal text-only props written to an element that is not a `<text>` (B20) */
  _textProps?: Record<string, unknown>;
  _theme?: Styles;
  _lastAnyKeyPressTime?: number;
  _type: 'element' | 'textNode';
  _undoStyles?: string[];
  _display?: 'flex' | 'block';
  _onLayout?: (this: ElementNode, target: ElementNode) => void;
  _requiresLayout: boolean;
  autosize?: boolean;
  /**
   * Optional component name for inspector / dev tooling — emitted by the
   * Babel devtools plugin (see `devtools/jsx-locator.js`).
   */
  componentName?: string;
  /**
   * Optional source-location string for inspector / dev tooling — emitted by
   * the Babel devtools plugin.
   */
  componentLocation?: string;
  /**
   * The distance from the bottom edge of the parent element.
   * When `bottom` is set, `mountY` is automatically set to 1.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  bottom?: number;
  /**
   * An array of child `ElementNode` or `ElementText` nodes.
   */
  children: Array<ElementNode | ElementText>;
  /**
   * Enable debug logging for this specific node.
   */
  debug?: boolean;
  /**
   * Specifies how much a flex item should grow relative to the rest of the flex items.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=flex-grow
   */
  flexGrow?: number;
  /**
   * Specifies whether flex items are forced onto one line or can wrap onto multiple lines.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  /**
   * Determines if an element is a flex item. If set to `false`, the element will be ignored by the flexbox layout.
   * @default false
   */
  flexItem?: boolean;
  /**
   * Specifies the order of a flex item relative to the rest of the flex items.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  flexOrder?: number;
  /**
   * Defines the ability for a flex item to shrink if necessary.
   * Defaults to 0 since existing legacy implementations did not shrink layout boxes.
   * Only available in NEW flex layout.
   */
  flexShrink?: number;
  /**
   * Defines the default size of an element before the remaining space is distributed.
   * Only available in NEW flex layout.
   */
  flexBasis?: number | string;
  /**
   * Forwards focus to a child element. It can be a numeric index of the child or a handler function.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/focus?id=forwardfocus
   */
  forwardFocus?: number | ForwardFocusHandler;
  /**
   * If `true`, the states of this node will be propagated to its children.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/states?id=forwardstates
   */
  forwardStates?: boolean;
  /**
   * The underlying Lightning Renderer node object. This is where the properties are ultimately set for rendering.
   */
  lng:
    | INode
    | IRendererNode
    | Partial<ElementNode>
    | (IRendererTextNode & { shader?: any });
  /**
   * A reference to the `ElementNode` instance. Can be an object or a callback function.
   */
  ref?: ElementNode | ((node: ElementNode) => void) | undefined;
  /**
   * A boolean indicating whether the node has been rendered.
   */
  rendered: boolean;
  /**
   * The main renderer instance.
   */
  renderer?: RendererMain;
  /**
   * The distance from the right edge of the parent element.
   * When `right` is set, `mountX` is automatically set to 1.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=layout-and-positioning-elements
   */
  right?: number;
  /**
   * The index of the currently selected child element, used for focus management for Column and Row components.
   */
  selected?: number;
  /**
   * The width of the element before flexbox layout is applied. Used internally for layout calculations.
   */
  preFlexwidth?: number;
  /**
   * The height of the element before flexbox layout is applied. Used internally for layout calculations.
   */
  preFlexheight?: number;
  /**
   * The text content of a text node.
   */
  text?: string;
  /**
   * Aligns flex items along the cross axis of the current line of the flex container.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=flex-properties
   */
  alignItems?: 'flexStart' | 'flexEnd' | 'center';
  /**
   * Aligns a flex item along the cross axis, overriding the `alignItems` value of the flex container.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=flex-properties
   */
  alignSelf?: 'flexStart' | 'flexEnd' | 'center';
  /**
   * The border style for all sides of the element. Takes an object with width and color properties.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/effects?id=border-and-borderradius
   */
  border?: BorderStyle;
  /**
   * The border style for the bottom side of the element.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/effects?id=border-and-borderradius
   */
  borderBottom?: SingleBorderStyle;
  /**
   * The border style for the left side of the element.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/effects?id=border-and-borderradius
   */
  borderLeft?: SingleBorderStyle;
  /**
   * The radius of the element's corners.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/effects?id=border-and-borderradius
   */
  borderRadius?: BorderRadius;
  /**
   * The border style for the right side of the element.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/effects?id=border-and-borderradius
   */
  borderRight?: SingleBorderStyle;
  /**
   * The border style for the top side of the element.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/effects?id=border-and-borderradius
   */
  borderTop?: SingleBorderStyle;
  /**
   * A shorthand to set both `centerX` and `centerY` to true.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=layout-and-positioning-elements
   */
  center?: boolean;
  /**
   * If `true`, centers the element horizontally within its parent.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=layout-and-positioning-elements
   */
  centerX?: boolean;
  /**
   * If `true`, centers the element vertically within its parent.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=layout-and-positioning-elements
   */
  centerY?: boolean;
  /**
   * Specifies the direction of the flex items.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  direction?: 'ltr' | 'rtl';
  /**
   * Defines how the flex container's size is determined. 'contain' allows it to grow with its content, 'fixed' keeps it at its specified size.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  flexBoundary?: 'contain' | 'fixed';
  /**
   * Defines how the flex container's cross-axis size is determined. 'fixed' keeps it at its specified size. Default is 'contain'.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  flexCrossBoundary?: 'fixed'; // default is contain
  /**
   * Specifies the direction of the main axis for flex items.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  /**
   * The gap between flex items.
   *
   * @see @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  gap?: number;
  /**
   * The gap between flex rows.
   *
   * @see @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  rowGap?: number;
  /**
   * The gap between flex columns.
   *
   * @see @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  columnGap?: number;
  /**
   * Defines the alignment of flex items along the main axis.
   *
   * @see @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  justifyContent?:
    | 'flexStart'
    | 'flexEnd'
    | 'center'
    | 'spaceBetween'
    | 'spaceAround'
    | 'spaceEvenly';
  /**
   * Applies a linear gradient effect to the element.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/effects
   */
  linearGradient?: LinearGradientProps;
  /**
   * Applies a radial gradient effect to the element.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/effects
   */
  radialGradient?: RadialGradientProps;
  /**
   * The margin on the bottom side of the element for a flexItem.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  marginBottom?: number;
  /**
   * The margin on the left side of the element for a flexItem.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  marginLeft?: number;
  /**
   * The margin on the right side of the element for a flexItem.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  marginRight?: number;
  /**
   * The margin on the top side of the element for a flexItem.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  marginTop?: number;
  /**
   * The padding on all sides of the flex element, or an array defining [Top, Right, Bottom, Left] padding.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  padding?:
    | number
    | [number, number]
    | [number, number, number]
    | [number, number, number, number];
  /**
   * The margin on all sides of the flex element, or an array defining [Top, Right, Bottom, Left] margins.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  margin?:
    | number
    | [number, number]
    | [number, number, number]
    | [number, number, number, number];
  /**
   * The x-coordinate of the element's position.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  x: number;
  /**
   * The y-coordinate of the element's position.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  y: number;
  /**
   * Throttles key press events by the specified number of milliseconds.
   *
   * @see https://solid-tv.github.io/solid/#/primitives/useFocusManager?id=input-throttling-available-core-212
   */
  throttleInput?: number;
  /**
   * The width of the element.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  w: number;
  /**
   * The height of the element.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  h: number;
  /**
   * The maximum width of the element.
   */
  maxWidth?: number;
  /**
   * The maximum height of the element.
   */
  maxHeight?: number;
  /**
   * The minimum width of the element.
   */
  minWidth?: number;
  /**
   * The minimum height of the element.
   */
  minHeight?: number;
  /**
   * The z-index of the element, which affects its stacking order.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  zIndex?: number;
  /**
   * Defines transitions for animatable properties.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/transitions?id=transitions-animations
   */
  transition?:
    | Record<string, AnimationSettings | undefined | true | false>
    | true
    | false;
  /**
   * Optional handlers for animation events.
   *
   * Available animation events:
   * - 'animating': Fired when the animation starts.
   * - 'stopped': Fired (via setTimeout for the animation duration) when the animation completes.
   *
   * Each event handler is optional and maps to a corresponding event.
   *
   * @see https://solid-tv.github.io/solid/#/essentials/transitions?id=animation-callbacks
   */
  onAnimation?: Partial<Record<AnimationEvents, AnimationEventHandler>>;
  /** Optional handler for when the element is created and rendered.
   *
   * @see https://solid-tv.github.io/solid/#/flow/ondestroy
   */
  onCreate?: (this: ElementNode, el: ElementNode) => void;
  /**
   * Optional handler for when the element is destroyed.
   * It can return a promise to wait for the cleanup to finish before the element is destroyed.
   *
   * @see https://solid-tv.github.io/solid/#/flow/ondestroy
   */
  onDestroy?: (this: ElementNode, el: ElementNode) => Promise<void> | void;
  /**
   * Optional handlers for when the element is rendered—after creation and when switching parents.
   *
   * @see https://solid-tv.github.io/solid/#/primitives/KeepAlive
   */
  onRender?: (this: ElementNode, el: ElementNode) => void;
  /**
   * Optional handlers for when the element is removed from a parent element.
   *
   * @see https://solid-tv.github.io/solid/#/primitives/KeepAlive
   */
  onRemove?: (this: ElementNode, el: ElementNode) => void;
  /**
   * Listen to Events coming from the renderer
   * @param NodeEvents
   *
   * Available events:
   * - 'loaded'
   * - 'failed'
   * - 'freed'
   * - 'inViewport'
   * - 'outOfViewport'
   *
   * @typedef {'loaded' | 'failed' | 'freed' | 'inViewport' | 'outOfViewport'} NodeEvents
   *
   * @param {Partial<Record<NodeEvents, EventHandler>>} events - An object where the keys are event names from NodeEvents and the values are the respective event handlers.
   * @returns {void}
   *
   * @see https://solid-tv.github.io/solid/#/essentials/events
   */
  onEvent?: OnEvent;

  /**
   * Callback event for when the element is clicked with a mouse.
   * Triggered when `useMouse` is running.
   */
  onMouseClick?: (
    this: ElementNode,
    event: MouseEvent,
    node: ElementNode,
  ) => void;

  /**
   * The individual padding on each side of an element, acting as an override to the `padding` array property.
   * `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`.
   * Only in the new flex engine.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  /**
   * Defines the order in which state styles are applied for this element.
   * Overrides the global `Config.stateOrder`.
   */
  stateOrder?: DollarString[];
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class ElementNode {
  constructor(name: string) {
    this._type = name === 'text' ? NodeType.TextNode : NodeType.Element;
    this.rendered = false;
    // initialize lng with standard properties for v8 optimization
    this.lng = {
      w: undefined,
      h: undefined,
      x: undefined,
      y: undefined,
      alpha: undefined,
      color: undefined,
      shader: undefined,
      clipping: undefined,
      text: undefined,
      ignoreParentAlpha: undefined,
      placeholderColor: undefined,
    };
    this.children = [];

    // Initialize lazy underscore fields explicitly in a fixed order.  This
    // gives every ElementNode the same hidden class on construction; later
    // assignments transition predictably instead of forking shapes by
    // first-touch order.
    this._queueDelete = undefined;
    this._animationQueue = undefined;
    this._animationQueueSettings = undefined;
    this._animationRunning = undefined;
    this._animationSettings = undefined;
    this._autofocus = undefined;
    this._calcWidth = undefined;
    this._calcHeight = undefined;
    this._containsFlexGrow = undefined;
    this._hasRenderedChildren = undefined;
    this._effects = undefined;
    this._fontFamily = undefined;
    this._fontWeight = undefined;
    this._id = undefined;
    this._parent = undefined;
    this._states = undefined;
    this._style = undefined;
    this._theme = undefined;
    this._lastAnyKeyPressTime = undefined;
    this._undoStyles = undefined;
    this._display = undefined;
    this._onLayout = undefined;
    this._requiresLayout = false;
    this._textProps = undefined;
  }

  get effects(): StyleEffects | undefined {
    return this.lng.shader;
  }

  /**
   * Commit a built shader-props target back to `this.lng.shader`. When the
   * node is already rendered we either convert the props into a real shader
   * (first time) or self-assign so the DOM renderer's setter reapplies style;
   * pre-render we just attach the bag for the upcoming `render()`.
   */
  _writeShaderTarget(target: unknown) {
    if (this.rendered) {
      if (!this.lng.shader) {
        this.lng.shader = Config.convertToShader(this, target as StyleEffects);
      } else if (isDomRendererActive()) {
        // eslint-disable-next-line no-self-assign -- lng.shader is a setter, force style update
        this.lng.shader = this.lng.shader;
      }
    } else {
      this.lng.shader = target;
    }
  }

  set effects(v: StyleEffects) {
    if (!SHADERS_ENABLED) return;
    let target = this.lng.shader || {};
    if (this.lng.shader?.props) {
      target = this.lng.shader.props;
    }
    if (v.rounded) target.radius = v.rounded.radius;
    if (v.borderRadius) target.radius = v.borderRadius;
    for (const k of EFFECT_SHADER_KEYS) {
      if (v[k]) parseAndAssignShaderProps(k, v[k], target);
    }

    this._writeShaderTarget(target);
  }

  set id(id: string) {
    this._id = id;
    if (Config.rendererOptions?.inspector) {
      this.data = { ...this.data, testId: id };
    }
  }

  get id(): string | undefined {
    return this._id;
  }

  get parent() {
    return this._parent;
  }

  set parent(p) {
    this._parent = p;
    if (this.rendered && p?.rendered) {
      this.lng.parent = (p.lng as IRendererNode) ?? null;
    }
  }

  get height(): number {
    return this.maxHeight || this.h;
  }

  set height(h: number) {
    this.h = h;
  }

  get width(): number {
    return this.maxWidth || this.w;
  }

  set width(w: number) {
    this.w = w;
  }

  set fontWeight(v) {
    if (this._fontWeight === v) {
      return;
    }

    this._fontWeight = v;
    this._writeFontFamily();
  }

  get fontWeight() {
    return this._fontWeight;
  }

  set fontFamily(v) {
    this._fontFamily = v;
    this._writeFontFamily();
  }

  get fontFamily() {
    return this._fontFamily;
  }

  /**
   * The renderer's family name from `fontFamily` and `fontWeight`, resolved
   * in one place so either JSX order gives the same name (B17). Only a
   * `<text>` has a font: another element keeps both on the ElementNode and
   * writes nothing to its renderer node (B20).
   */
  _writeFontFamily() {
    if (this._type !== NodeType.TextNode) {
      return;
    }
    const weight = this._fontWeight as number | string | undefined;
    if (weight === undefined) {
      // No family of its own: before render, undefined lets render's font
      // template fill it in; after render, write what the template gave
      // (Config.fontSettings' family and weight, read at the first text
      // render), not undefined, which the renderer takes as its default.
      const family = this._fontFamily;
      (this.lng as ElementNode).fontFamily =
        family === undefined && this.rendered ? _fontFamilyWithWeight : family;
      return;
    }
    const alias = Config.fontWeightAlias;
    const aliased =
      alias !== undefined && alias !== null
        ? (alias[weight] as number | string | undefined)
        : undefined;
    (this.lng as ElementNode).fontFamily =
      `${this._fontFamily || Config.fontSettings?.fontFamily}${aliased ?? weight}`;
  }

  insertChild(
    node: ElementNode | ElementText | TextNode,
    beforeNode?: ElementNode | ElementText | TextNode | null,
  ) {
    const children = this.children;
    const prevParent = node.parent;
    // The renderer node of a rendered element is placed among its siblings
    // in `children` order (B19: renderer v2 draws siblings in that order).
    // The renderer keeps siblings sorted by zIndex: when the anchor's zIndex
    // is not the child's, it takes the nearest sorted place instead, so
    // among equal-zIndex siblings its order can then differ from `children`.
    const drawn = this.rendered && isElementNode(node) && node.rendered;
    // A move within this node: the renderer sibling it was drawn before, so
    // a move that leaves it there costs the renderer nothing.
    let drawnBefore: ElementNode | null = null;
    // Before itself: it stays where it is (DOM semantics). Solid's swap of
    // adjacent items asks for this (insertNode(parent, y, nextSibling(x))).
    if (beforeNode === node) {
      beforeNode =
        prevParent === this
          ? children[lastIndexOf(children, node) + 1]
          : undefined;
    }
    // A node in a parent (this one too) is taken out first, then inserted
    // before `beforeNode`, or appended.
    if (prevParent !== undefined) {
      if (drawn && prevParent === this) {
        drawnBefore = nextDrawn(children, lastIndexOf(children, node) + 1);
      }
      prevParent.removeChild(node);
    }

    // We're inserting a node thats been rendered into a node that hasn't been
    if (!this.rendered && isElementNode(node) && node.rendered) {
      this._hasRenderedChildren = true;
    }

    // DOM insertBefore semantics: an anchor that is not a child appends.
    let index =
      beforeNode !== undefined && beforeNode !== null
        ? lastIndexOf(children, beforeNode)
        : -1;
    if (index === -1) {
      index = children.length;
      children.push(node as ElementNode);
    } else {
      insertAt(children, index, node as ElementNode);
    }

    if (!drawn) {
      node.parent = this;
      return;
    }
    // insertBefore reparents the renderer node too, so the parent setter's
    // renderer write is skipped.
    (node as ElementNode)._parent = this;
    const next = nextDrawn(children, index + 1);
    if (prevParent !== this || next !== drawnBefore) {
      (this.lng as INode).insertBefore(
        (node as ElementNode).lng as INode,
        next === null ? null : (next.lng as INode),
      );
    }
  }

  /**
   * After `render()` made `node`'s renderer node (it appends), move it before
   * the renderer node of its next rendered sibling (B19). solidOpts calls it
   * for a node inserted before an anchor.
   */
  _drawInOrder(node: ElementNode) {
    const children = this.children;
    const next = nextDrawn(children, lastIndexOf(children, node) + 1);
    if (next !== null) {
      (this.lng as INode).insertBefore(node.lng as INode, next.lng as INode);
    }
  }

  removeChild(node: ElementNode | ElementText | TextNode) {
    const children = this.children;
    const index = lastIndexOf(children, node);
    if (index > -1) {
      removeAt(children, index);
      if (isElementNode(node) && node.onRemove) {
        node.onRemove.call(node, node);
      }
      // Out of the tree: a re-insert finds no parent to remove it from.
      node.parent = undefined;

      if (this.requiresLayout()) {
        addToLayoutQueue(this);
      }
    }
  }

  get selectedNode(): ElementNode | undefined {
    const selectedIndex = this.selected || 0;

    for (let i = selectedIndex; i < this.children.length; i++) {
      const element = this.children[i];
      if (isElementNode(element)) {
        this.selected = i;
        return element;
      }
    }

    return undefined;
  }

  set shader(
    shaderProps: IRendererShader | [kind: string, props: IRendererShaderProps],
  ) {
    this.lng.shader = isArray(shaderProps)
      ? renderer.createShader(...shaderProps)
      : shaderProps;
  }

  /**
   * The transition path of an animatable prop's setter, which calls it only
   * when the node has a `transition`. Returns true when the write became an
   * animation; false when the setter stores the value itself (the common
   * case is a direct store in the setter, under its own name).
   */
  _sendToLightningAnimatable(name: string, value: number): boolean {
    const transition = this.transition;
    if (!this.rendered || !transition || !Config.animationsEnabled) {
      return false;
    }
    let animationSettings: AnimationSettings | undefined;
    if (transition !== true) {
      const own = transition[name];
      // The transition may name w/h as width/height. Written inline: a
      // single-use helper here is what terser inlines as an IIFE (a closure
      // per call) under its default compress options.
      const setting =
        own ||
        (name === 'w'
          ? transition.width
          : name === 'h'
            ? transition.height
            : undefined);
      if (!setting) {
        return false;
      }
      animationSettings =
        own === true ? undefined : (setting as AnimationSettings | undefined);
    }

    // If the renderer doesn't support animateProp,
    // keep backwards compatible with LightningRenderer
    if (!('animateProp' in this.lng)) {
      const animationController = this.animate(
        { [name]: value },
        animationSettings,
      );
      this._fireAnimationEvents(name, value, animationSettings);
      animationController.start();
      return true;
    }

    (this.lng as INode).animateProp(
      name,
      value,
      animationSettings || this.animationSettings || {},
    );
    this._fireAnimationEvents(name, value, animationSettings);
    return true;
  }

  _fireAnimationEvents(
    name: string,
    value: number,
    animationSettings?: AnimationSettings,
  ) {
    if (!this.onAnimation) return;
    const settings = animationSettings || this.animationSettings;
    const { animating, stopped } = this.onAnimation;
    if (animating) {
      animating.call(this, name, value);
    }
    if (stopped) {
      const total = (settings?.duration ?? 0) + (settings?.delay ?? 0);
      setTimeout(() => stopped.call(this, name, value), total);
    }
  }

  animate(
    props: Partial<AnimateProps>,
    animationSettings?: AnimationSettings,
  ): IAnimationController {
    if (!this.rendered) {
      if (isDev) console.log('NOT RENDERED! CANNOT ANIMATE');
      return { start: () => {} } as IAnimationController;
    }
    return (this.lng as IRendererNode).animate(
      props,
      animationSettings || this.animationSettings || {},
    );
  }

  chain(props: Partial<AnimateProps>, animationSettings?: AnimationSettings) {
    if (this._animationRunning) {
      this._animationQueue = [];
      this._animationRunning = false;
    }

    if (animationSettings) {
      this._animationQueueSettings = animationSettings;
    } else if (!this._animationQueueSettings) {
      this._animationQueueSettings =
        animationSettings || this.animationSettings;
    }
    animationSettings = animationSettings || this._animationQueueSettings;
    this._animationQueue = this._animationQueue || [];
    this._animationQueue.push({ props, animationSettings });
    return this;
  }

  async start() {
    let animation = this._animationQueue!.shift();
    while (animation) {
      this._animationRunning = true;
      await this.animate(animation.props, animation.animationSettings)
        .start()
        .waitUntilStopped();
      animation = this._animationQueue!.shift();
    }
    this._animationRunning = false;
    this._animationQueueSettings = undefined;
  }

  emit(event: string, ...args: any[]): boolean {
    let current = this as ElementNode;
    const capitalizedEvent = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;

    while (current) {
      const handler = current[capitalizedEvent];
      if (isFunction(handler)) {
        if (handler.call(current, this, ...args) === true) {
          return true;
        }
      }
      current = current.parent!;
    }
    return false;
  }

  setFocus(): void {
    if (this.rendered) {
      // can be 0
      if (this.forwardFocus !== undefined) {
        if (isFunction(this.forwardFocus)) {
          if (this.forwardFocus.call(this, this) !== false) {
            return;
          }
        } else {
          const focusedIndex =
            typeof this.forwardFocus === 'number' ? this.forwardFocus : null;
          const nodes = this.children;
          if (focusedIndex !== null && focusedIndex < nodes.length) {
            const child = nodes[focusedIndex];
            isElementNode(child) && child.setFocus();
            return;
          }
        }
      }
      // Delay setting focus so children can render (useful for Row + Column).
      // The post-mutation scheduler applies setActiveElement in its focus phase.
      nextActiveElement = this;
      schedulePostMutation();
    } else {
      this._autofocus = true;
    }
  }

  _layoutOnLoad() {
    (this.lng as IRendererNode).on('loaded', () => {
      schedulePostMutation();
      this.parent!.updateLayout();
    });
  }

  getText(this: ElementText) {
    const len = this.children.length;
    if (len === 1) return this.children[0]!.text;
    if (len === 0) return '';
    let result = '';
    for (let i = 0; i < len; i++) {
      result += this.children[i]!.text;
    }
    return result;
  }

  destroy() {
    if (this.onDestroy) {
      const destroyPromise: unknown = this.onDestroy(this);

      // If onDestroy returns a promise, wait for it to resolve before destroying
      // Useful with animations waitUntilStopped method which returns promise
      if (destroyPromise instanceof Promise) {
        void destroyPromise.then(() => this._destroy());
      } else {
        this._destroy();
      }
    } else {
      this._destroy();
    }
  }

  _destroy() {
    if (isINode(this.lng)) {
      this.lng.destroy();
    }
  }

  set style(style: Styles | undefined) {
    if (isDev && this._style) {
      // Avoid processing style changes again
      console.warn(
        'Style already set: https://solid-tv.github.io/solid/#/essentials/styling?id=style-patterns-to-avoid',
      );
    }

    if (Config.lockStyles && this._style) {
      return;
    }

    if (!style) {
      return;
    }

    this._style = style;

    // Keys set in JSX are more important
    for (const key in this._style) {
      // be careful of 0 values
      if (this[key as keyof Styles] === undefined) {
        this[key as keyof Styles] = this._style[key as keyof Styles];
      }
    }
  }

  get style(): Styles {
    return this._style || {};
  }

  set theme(styles: Styles | undefined) {
    if (!styles) {
      return;
    }
    this._theme = styles;
    for (const key in styles) {
      this[key as keyof Styles] = styles[key as keyof Styles];
    }
  }

  get theme(): Styles {
    this._theme = this._theme || {};
    return this._theme;
  }

  get hasChildren() {
    return this.children.length > 0;
  }

  set src(src) {
    if (typeof src === 'string') {
      this.lng.src = src;
      if (!this.color && this.rendered) {
        this.color = 0xffffffff;
      }
    } else {
      this.color = 0x00000000;
    }
  }

  get src(): string | null | undefined {
    // Renderer 1.8 widened `src` to `string | Blob | ImageData`. The solid
    // `src` prop only ever assigns strings (see the setter above), so the
    // non-string arms are unreachable through this path.
    return this.lng.src as string | null | undefined;
  }

  getChildById(id: string) {
    return this.children.find((c) => c.id === id);
  }

  searchChildrenById(id: string): ElementNode | undefined {
    // traverse all the childrens children
    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i];
      if (isElementNode(child)) {
        if (child.id === id) {
          return child;
        }

        const found = child.searchChildrenById(id);
        if (found) {
          return found;
        }
      }
    }
  }

  set states(states: NodeStates) {
    this._states = this._states
      ? this._states.merge(states)
      : new States(this._stateChanged.bind(this), states);
    if (this.rendered) {
      this._stateChanged();
    }
  }

  get states(): States {
    this._states = this._states || new States(this._stateChanged.bind(this));
    return this._states;
  }

  get animationSettings(): AnimationSettings | undefined {
    return this._animationSettings || Config.animationSettings;
  }

  set animationSettings(animationSettings: AnimationSettings | undefined) {
    this._animationSettings = animationSettings;
  }

  set hidden(val: boolean) {
    this.alpha = val ? 0 : 1;
  }

  get hidden() {
    return this.alpha === 0;
  }

  get preserve(): boolean {
    return this._queueDelete === 0;
  }

  set preserve(v: boolean) {
    this._queueDelete = v ? 0 : undefined;
  }

  /**
   * Sets the autofocus state of the element.
   * When set to a truthy value, the element will automatically gain focus.
   * You can also set it to a signal to recalculate
   *
   * @param val - A value to determine if the element should autofocus.
   *              A truthy value enables autofocus, otherwise disables it.
   */
  set autofocus(val: any) {
    this._autofocus = val;
    // Defer setFocus so children render first (forwardFocus needs them).
    // The post-mutation focus phase calls setFocus on this element.
    if (val) {
      deferredFocusElement = this;
      schedulePostMutation();
    }
  }

  get autofocus() {
    return this._autofocus;
  }

  /**
   * Specifies the display behavior of an element. 'flex' enables flexbox layout.
   *
   * @default 'block'
   * @see https://solid-tv.github.io/solid/#/flow/layout?id=flex
   */
  get display(): 'flex' | 'block' | undefined {
    return this._display;
  }

  set display(v: 'flex' | 'block' | undefined) {
    this._display = v;
    this._requiresLayout = v === 'flex' || this._onLayout !== undefined;
  }

  /**
   * Callback run after flex layout is calculated on flex elements.
   *
   * @see https://solid-tv.github.io/solid/#/flow/layout
   */
  get onLayout():
    | ((this: ElementNode, target: ElementNode) => void)
    | undefined {
    return this._onLayout;
  }

  set onLayout(
    fn: ((this: ElementNode, target: ElementNode) => void) | undefined,
  ) {
    this._onLayout = fn;
    this._requiresLayout = this._display === 'flex' || fn !== undefined;
  }

  requiresLayout() {
    return this._requiresLayout;
  }

  set updateLayoutOn(_v: unknown) {
    this.updateLayout();
  }

  get updateLayoutOn() {
    return null;
  }

  updateLayout() {
    if (this.hasChildren) {
      if (isDev) log('Layout: ', this);

      if (this.display === 'flex' && this.flexGrow && this.width === 0) {
        return;
      }

      const flexChanged = this.display === 'flex' && calculateFlex(this);
      layoutQueue.delete(this);
      const onLayoutChanged =
        isFunction(this.onLayout) && this.onLayout.call(this, this);

      if ((flexChanged || onLayoutChanged) && this.parent) {
        addToLayoutQueue(this.parent);
      }

      if (this._containsFlexGrow === true) {
        // Need to reprocess children
        this.children.forEach((c) => {
          if (c.display === 'flex' && isElementNode(c)) {
            // calculating directly to prevent infinite loops recalculating parents
            calculateFlex(c);
            isFunction(c.onLayout) && c.onLayout.call(c, c);
            addToLayoutQueue(this);
          }
        });
      }
    }
  }

  _stateChanged() {
    if (isDev) log('State Changed: ', this, this.states);

    if (isDev) {
      const div = (this.lng as IRendererNode)?.div;
      if (div) {
        if (this.states.length > 0) {
          div.dataset.states = this.states.join(' ');
        } else {
          delete div.dataset.states;
        }
      }
    }

    if (this.forwardStates) {
      // apply states to children first
      const states = this.states.slice() as States;
      this.children.forEach((c) => {
        c.states = states;
      });
    }

    const states = this.states;

    // An empty _undoStyles (left behind once a state style has been undone)
    // must not force the resolution branch: with nothing to undo and no style
    // matching any active state, the branch provably assigns nothing, and it
    // runs on every path element of every focus change.
    if (
      (this._undoStyles !== undefined && this._undoStyles.length > 0) ||
      keyExists(this, states)
    ) {
      let stylesToUndo: { [key: string]: any } | undefined;
      if (this._undoStyles && this._undoStyles.length) {
        stylesToUndo = {};
        this._undoStyles.forEach((styleKey) => {
          let fallbackValue = this.theme[styleKey];

          if (fallbackValue === undefined) {
            fallbackValue = this.style[styleKey];
          }

          if (isDev) {
            if (fallbackValue === undefined) {
              console.warn('fallback style key not found: ', styleKey);
            }
          }
          stylesToUndo![styleKey] = fallbackValue;
        });
      }

      const numStates = states.length;
      if (numStates === 0) {
        Object.assign(this, stylesToUndo);
        this._undoStyles = [];
        return;
      }

      let newStyles: Styles;
      if (numStates === 1) {
        newStyles = this[states[0] as keyof Styles] as Styles;
        newStyles = stylesToUndo
          ? { ...stylesToUndo, ...newStyles }
          : newStyles;
      } else {
        let sortedStates = states as DollarString[];
        const stateOrder = this.stateOrder || Config.stateOrder;
        if (stateOrder && stateOrder.length > 0) {
          sortedStates = states.slice().sort((a, b) => {
            const aIdx = stateOrder.indexOf(a);
            const bIdx = stateOrder.indexOf(b);

            // If a state is in the stateOrder, it should have higher specificity
            // than states not in the stateOrder.
            if (aIdx !== -1 && bIdx === -1) return 1;
            if (aIdx === -1 && bIdx !== -1) return -1;

            return aIdx - bIdx;
          });
        }

        newStyles = sortedStates.reduce((acc, state) => {
          const styles = this[state];
          return styles ? { ...acc, ...styles } : acc;
        }, stylesToUndo || {});
      }

      if (newStyles) {
        this._undoStyles = Object.keys(newStyles);
        // Apply transition first
        if (newStyles.transition !== undefined) {
          this.transition = newStyles.transition;
        }

        // Apply the styles
        Object.assign(this, newStyles);
      } else {
        this._undoStyles = [];
      }
    }
  }

  render(topNode?: boolean) {
    // Elements are inserted from the inside out, then rendered from the outside in.
    // Render starts when an element is inserted with a parent that is already renderered.
    const node = this;
    const parent = this.parent;

    if (!parent) {
      console.warn('Parent not set - no node created for: ', this);
      return;
    }

    if (!parent.rendered) {
      console.warn('Parent not rendered yet: ', this);
      return;
    }

    if (parent.requiresLayout()) {
      layoutQueue.add(parent);
    }

    if (this.rendered) {
      // This happens if Array of items is reordered to reuse elements.
      // We return after layout is queued so the change can trigger layout updates.
      this.onRender?.(this);
      return;
    }

    if (this._states) {
      this._stateChanged();
    }

    const props = node.lng;
    const parentWidth = parent.w || 0;
    const parentHeight = parent.h || 0;

    props.x = props.x || 0;
    props.y = props.y || 0;
    props.parent = parent.lng as IRendererNode;

    if (this.right || this.right === 0) {
      props.x = parentWidth - this.right;
      props.mountX = 1;
    }

    if (this.bottom || this.bottom === 0) {
      props.y = parentHeight - this.bottom;
      props.mountY = 1;
    }

    if (this.center) {
      this.centerX = this.centerY = true;
    }

    if (this.centerX) {
      props.x += parentWidth / 2;
      props.mountX = 0.5;
    }

    if (this.centerY) {
      props.y += parentHeight / 2;
      props.mountY = 0.5;
    }

    if (isElementText(node)) {
      const textProps = props as TextProps;
      if (_fontTemplate === undefined) buildFontTemplate();
      const tpl = _fontTemplate!;
      if (tpl.length > 0) {
        const familyIdx = _fontFamilyIdx;
        const familyWithWeight =
          textProps['fontWeight'] === undefined
            ? _fontFamilyWithWeight
            : undefined;
        for (let i = 0; i < tpl.length; i++) {
          const entry = tpl[i]!;
          const key = entry[0];
          if (textProps[key] === undefined) {
            textProps[key] =
              i === familyIdx && familyWithWeight !== undefined
                ? familyWithWeight
                : entry[1];
          }
        }
      }
      textProps.text = textProps.text || node.getText();

      if (textProps.textAlign && !textProps.contain) {
        console.warn('Text align requires contain: ', node.getText());
      }

      // contain is either width or both
      if (textProps.contain) {
        if (textProps.contain === 'both') {
          textProps.maxWidth = textProps.maxWidth ?? textProps.w;
          textProps.maxHeight = textProps.maxHeight ?? textProps.h;
        } else if (textProps.contain === 'width') {
          textProps.maxWidth = textProps.maxWidth ?? textProps.w;
        }

        if (!textProps.h && !textProps.maxHeight) {
          textProps.maxLines = textProps.maxLines ?? 99;
        }

        if (!textProps.maxWidth) {
          textProps.maxWidth =
            parentWidth - textProps.x! - (textProps.marginRight || 0);
        }

        if (textProps.contain === 'both' && !textProps.maxHeight) {
          textProps.maxHeight =
            parentHeight - textProps.y! - (textProps.marginBottom || 0);
        } else if (textProps.maxLines === 1) {
          textProps.maxHeight =
            textProps.maxHeight || textProps.lineHeight || textProps.fontSize;
        }
        // textProps.w = textProps.h = 0;
      }

      // Can you put effects on Text nodes? Need to confirm...
      // A built shader node (WebGL, Canvas, or the DOM test fake) always has a
      // `shaderType`; a raw StyleEffects props object never does. Only convert
      // the latter — a built shader is already ready to render.
      if (SHADERS_ENABLED && props.shader && !('shaderType' in props.shader)) {
        props.shader = Config.convertToShader(node, props.shader);
      }

      if (isDev) log('Rendering: ', this, props);

      node.lng = renderer.createTextNode(
        props as Partial<ITextNodeProps> & Partial<IRendererTextNodeProps>,
      ) as IRendererTextNode;

      if (parent.requiresLayout()) {
        if (!textProps.maxWidth || !textProps.maxHeight) {
          node._layoutOnLoad();
        }
      }
    } else {
      // If its not an image or texture apply some defaults
      if (!props.texture) {
        // Set width and height to parent less offset
        if (isNaN(props.w as number)) {
          // A flex container that sizes its width to its children (contain on the
          // main axis) should default to 1 rather than filling its parent, so it
          // shrinks to fit content once layout runs.
          let flexFitsWidth = false;
          if (node.display === 'flex') {
            const flexDirection = node.flexDirection || 'row';
            const isFlexRow =
              flexDirection === 'row' || flexDirection === 'row-reverse';
            flexFitsWidth = isFlexRow && node.flexBoundary !== 'fixed';

            // Every justify mode except flexStart positions children out of the
            // container's free space. Shrinking to fit leaves none, so fall back
            // to filling the parent unless the developer explicitly asked to
            // contain — in which case honor it and warn about the contradiction.
            if (
              flexFitsWidth &&
              node.justifyContent !== undefined &&
              node.justifyContent !== 'flexStart'
            ) {
              if (node.flexBoundary === undefined) {
                flexFitsWidth = false;
              } else if (isDev) {
                console.warn(
                  `justifyContent '${node.justifyContent}' has no free space to distribute on a flexBoundary 'contain' container without an explicit width: `,
                  this,
                );
              }
            }
          }

          if (node.flexGrow || flexFitsWidth) {
            props.w = 0;
          } else {
            props.w = parentWidth - props.x;
          }
          node._calcWidth = true;
        }

        if (isNaN(props.h as number)) {
          props.h = parentHeight - props.y;
          node._calcHeight = true;
        }

        if (!props.color && !props.src) {
          // Default color to transparent - If you later set a src, you'll need
          // to set color '#ffffffff'
          props.color = 0x00000000;
        }
      }

      if (SHADERS_ENABLED && props.shader && !('shaderType' in props.shader)) {
        props.shader = Config.convertToShader(node, props.shader);
      }

      if (isDev) log('Rendering: ', this, props);

      node.lng = renderer.createNode(
        props as Partial<INodeProps> & Partial<IRendererNodeProps>,
      );
    }

    node.rendered = true;
    if (isDev) {
      // Store props so we can recreate raw renderer code
      node._rendererProps = props;
    }

    if (node.autosize && parent.requiresLayout()) {
      node._layoutOnLoad();
    }

    this.onCreate?.(this);
    this.onRender?.(this);

    if (node.onEvent) {
      for (const [name, handler] of Object.entries(node.onEvent)) {
        if (typeof node.lng.on === 'function') {
          node.lng.on(name, (_inode, data) => handler.call(node, node, data));
        }
      }
    }

    // L3 Inspector adds div to the lng object
    const div: HTMLElement | undefined = (node.lng as IRendererNode)?.div;
    if (isDev && div) {
      div.element = node;
      if (node._states && node._states.length > 0) {
        div.dataset.states = node._states.join(' ');
      }
    }

    if (node._type === NodeType.Element) {
      // only element nodes will have children that need rendering
      // Children rendered before this node (moved in) are reparented here,
      // in children order with the new ones (B19: v2 draws in that order).
      const reparent = node._hasRenderedChildren === true;
      node._hasRenderedChildren = false;
      const numChildren = node.children.length;
      for (let i = 0; i < numChildren; i++) {
        const c = node.children[i];
        if (isDev) assertTruthy(c, 'Child is undefined');
        // Text elements sneak in from Solid creating tracked nodes
        if (isElementNode(c)) {
          if (reparent && isINode(c.lng)) {
            c.lng.parent = node.lng as INode;
          }
          c.render();
        }
      }
    }
    if (topNode) {
      // Schedule one post-mutation pass; <For> may add many children in one
      // tick, but the scheduler dedupes and runs everything once.
      schedulePostMutation();
    }

    if (node._autofocus) node.setFocus();
  }
}

/**
 * The index of `item` in `list`, scanning from the end: Solid appends and
 * removes at the tail most often. The first item is checked first, for
 * Solid's cleanChildren, which removes the first child until none is left.
 */
function lastIndexOf<T>(list: T[], item: T): number {
  if (list[0] === item) {
    return 0;
  }
  let i = list.length - 1;
  while (i > 0 && list[i] !== item) {
    i--;
  }
  return i === 0 ? -1 : i;
}

/** Removes `list[index]` without allocating (`splice` returns an array). */
function removeAt<T>(list: T[], index: number): void {
  if (index === 0) {
    list.shift();
    return;
  }
  const last = list.length - 1;
  for (let i = index; i < last; i++) {
    list[i] = list[i + 1]!;
  }
  list.pop();
}

/** Inserts `item` at `index` without allocating. */
function insertAt<T>(list: T[], index: number, item: T): void {
  let i = list.length;
  list.push(item);
  for (; i > index; i--) {
    list[i] = list[i - 1]!;
  }
  list[index] = item;
}

/** The first rendered element in `children` from `from` on: the renderer sibling to draw before. */
function nextDrawn(
  children: ElementNode['children'],
  from: number,
): ElementNode | null {
  for (let i = from; i < children.length; i++) {
    const c = children[i];
    if (c instanceof ElementNode && c.rendered) {
      return c;
    }
  }
  return null;
}

// Props forwarded to the renderer node, one accessor per prop (design
// 3.6.6): every getter and setter below loads or stores one constant name,
// so each has its own inline cache. A shared `this.lng[key]` body made from
// a loop sees every name at one site: a megamorphic keyed access, and into
// renderer v2's prototype accessors a call V8 does not inline (the double
// it returns is boxed). Written out rather than made with `new Function`,
// which a TV app's CSP may forbid.
//
// `lng` is the props bag before render and the renderer node after it. An
// animatable setter stores directly unless the node has a `transition`,
// then `_sendToLightningAnimatable` may animate instead.
type Forwarding = Pick<
  ElementNode,
  'transition' | '_sendToLightningAnimatable'
> & { lng: Record<string, unknown> };

const NO_TEXT_PROPS: Readonly<Record<string, unknown>> = Object.freeze({});

/**
 * Where a text-only prop is written: a `<text>`'s renderer node (its props
 * bag before render); on any other element, the ElementNode's `_textProps`.
 * A renderer v2 handle takes no field it does not know (it would become a
 * field of its own) and a view draws no text (B20).
 */
function textPropsFor(node: ElementNode): Record<string, unknown> {
  if (node._type === NodeType.TextNode) {
    return node.lng as Record<string, unknown>;
  }
  let own = node._textProps;
  if (own === undefined) {
    own = {};
    node._textProps = own;
  }
  return own;
}

/** Where a text-only prop is read (textPropsFor), without allocating. */
function textPropsOf(node: ElementNode): Readonly<Record<string, unknown>> {
  if (node._type === NodeType.TextNode) {
    return node.lng as Record<string, unknown>;
  }
  const own = node._textProps;
  return own === undefined ? NO_TEXT_PROPS : own;
}

/** The setter of a read-only forwarded prop: the write is ignored. */
function ignoreWrite(_v: unknown) {}

Object.defineProperties(ElementNode.prototype, {
  // Animatable
  alpha: {
    get(this: Forwarding) {
      return this.lng.alpha;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('alpha', v)
      ) {
        this.lng.alpha = v;
      }
    },
  },
  color: {
    get(this: Forwarding) {
      return this.lng.color;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('color', v)
      ) {
        this.lng.color = v;
      }
    },
  },
  colorTop: {
    get(this: Forwarding) {
      return this.lng.colorTop;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('colorTop', v)
      ) {
        this.lng.colorTop = v;
      }
    },
  },
  colorRight: {
    get(this: Forwarding) {
      return this.lng.colorRight;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('colorRight', v)
      ) {
        this.lng.colorRight = v;
      }
    },
  },
  colorLeft: {
    get(this: Forwarding) {
      return this.lng.colorLeft;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('colorLeft', v)
      ) {
        this.lng.colorLeft = v;
      }
    },
  },
  colorBottom: {
    get(this: Forwarding) {
      return this.lng.colorBottom;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('colorBottom', v)
      ) {
        this.lng.colorBottom = v;
      }
    },
  },
  colorTl: {
    get(this: Forwarding) {
      return this.lng.colorTl;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('colorTl', v)
      ) {
        this.lng.colorTl = v;
      }
    },
  },
  colorTr: {
    get(this: Forwarding) {
      return this.lng.colorTr;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('colorTr', v)
      ) {
        this.lng.colorTr = v;
      }
    },
  },
  colorBl: {
    get(this: Forwarding) {
      return this.lng.colorBl;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('colorBl', v)
      ) {
        this.lng.colorBl = v;
      }
    },
  },
  colorBr: {
    get(this: Forwarding) {
      return this.lng.colorBr;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('colorBr', v)
      ) {
        this.lng.colorBr = v;
      }
    },
  },
  h: {
    get(this: Forwarding) {
      return this.lng.h;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('h', v)
      ) {
        this.lng.h = v;
      }
    },
  },
  mount: {
    get(this: Forwarding) {
      return this.lng.mount;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('mount', v)
      ) {
        this.lng.mount = v;
      }
    },
  },
  mountX: {
    get(this: Forwarding) {
      return this.lng.mountX;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('mountX', v)
      ) {
        this.lng.mountX = v;
      }
    },
  },
  mountY: {
    get(this: Forwarding) {
      return this.lng.mountY;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('mountY', v)
      ) {
        this.lng.mountY = v;
      }
    },
  },
  pivot: {
    get(this: Forwarding) {
      return this.lng.pivot;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('pivot', v)
      ) {
        this.lng.pivot = v;
      }
    },
  },
  pivotX: {
    get(this: Forwarding) {
      return this.lng.pivotX;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('pivotX', v)
      ) {
        this.lng.pivotX = v;
      }
    },
  },
  pivotY: {
    get(this: Forwarding) {
      return this.lng.pivotY;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('pivotY', v)
      ) {
        this.lng.pivotY = v;
      }
    },
  },
  rotation: {
    get(this: Forwarding) {
      return this.lng.rotation;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('rotation', v)
      ) {
        this.lng.rotation = v;
      }
    },
  },
  scale: {
    get(this: Forwarding) {
      return this.lng.scale;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('scale', v)
      ) {
        this.lng.scale = v;
      }
    },
  },
  scaleX: {
    get(this: Forwarding) {
      return this.lng.scaleX;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('scaleX', v)
      ) {
        this.lng.scaleX = v;
      }
    },
  },
  scaleY: {
    get(this: Forwarding) {
      return this.lng.scaleY;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('scaleY', v)
      ) {
        this.lng.scaleY = v;
      }
    },
  },
  w: {
    get(this: Forwarding) {
      return this.lng.w;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('w', v)
      ) {
        this.lng.w = v;
      }
    },
  },
  x: {
    get(this: Forwarding) {
      return this.lng.x;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('x', v)
      ) {
        this.lng.x = v;
      }
    },
  },
  y: {
    get(this: Forwarding) {
      return this.lng.y;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('y', v)
      ) {
        this.lng.y = v;
      }
    },
  },
  zIndex: {
    get(this: Forwarding) {
      return this.lng.zIndex;
    },
    set(this: Forwarding, v: number) {
      if (
        this.transition === undefined ||
        !this._sendToLightningAnimatable('zIndex', v)
      ) {
        this.lng.zIndex = v;
      }
    },
  },
  // Animatable, text only
  fontSize: {
    get(this: ElementNode) {
      return textPropsOf(this).fontSize;
    },
    set(this: ElementNode, v: number) {
      if (
        this._type !== NodeType.TextNode ||
        this.transition === undefined ||
        !this._sendToLightningAnimatable('fontSize', v)
      ) {
        textPropsFor(this).fontSize = v;
      }
    },
  },
  lineHeight: {
    get(this: ElementNode) {
      return textPropsOf(this).lineHeight;
    },
    set(this: ElementNode, v: number) {
      if (
        this._type !== NodeType.TextNode ||
        this.transition === undefined ||
        !this._sendToLightningAnimatable('lineHeight', v)
      ) {
        textPropsFor(this).lineHeight = v;
      }
    },
  },
  // Not animated
  autosize: {
    get(this: Forwarding) {
      return this.lng.autosize;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.autosize = v;
    },
  },
  clipping: {
    get(this: Forwarding) {
      return this.lng.clipping;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.clipping = v;
    },
  },
  componentName: {
    get(this: Forwarding) {
      return this.lng.componentName;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.componentName = v;
    },
  },
  componentLocation: {
    get(this: Forwarding) {
      return this.lng.componentLocation;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.componentLocation = v;
    },
  },
  data: {
    get(this: Forwarding) {
      return this.lng.data;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.data = v;
    },
  },
  ignoreParentAlpha: {
    get(this: Forwarding) {
      return this.lng.ignoreParentAlpha;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.ignoreParentAlpha = v;
    },
  },
  imageType: {
    get(this: Forwarding) {
      return this.lng.imageType;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.imageType = v;
    },
  },
  placeholderColor: {
    get(this: Forwarding) {
      return this.lng.placeholderColor;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.placeholderColor = v;
    },
  },
  srcHeight: {
    get(this: Forwarding) {
      return this.lng.srcHeight;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.srcHeight = v;
    },
  },
  srcWidth: {
    get(this: Forwarding) {
      return this.lng.srcWidth;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.srcWidth = v;
    },
  },
  srcX: {
    get(this: Forwarding) {
      return this.lng.srcX;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.srcX = v;
    },
  },
  srcY: {
    get(this: Forwarding) {
      return this.lng.srcY;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.srcY = v;
    },
  },
  texture: {
    get(this: Forwarding) {
      return this.lng.texture;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.texture = v;
    },
  },
  textureOptions: {
    get(this: Forwarding) {
      return this.lng.textureOptions;
    },
    set(this: Forwarding, v: unknown) {
      this.lng.textureOptions = v;
    },
  },
  // Not animated, text only
  contain: {
    get(this: ElementNode) {
      return textPropsOf(this).contain;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).contain = v;
    },
  },
  forceLoad: {
    get(this: ElementNode) {
      return textPropsOf(this).forceLoad;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).forceLoad = v;
    },
  },
  fontStyle: {
    get(this: ElementNode) {
      return textPropsOf(this).fontStyle;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).fontStyle = v;
    },
  },
  letterSpacing: {
    get(this: ElementNode) {
      return textPropsOf(this).letterSpacing;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).letterSpacing = v;
    },
  },
  maxHeight: {
    get(this: ElementNode) {
      return textPropsOf(this).maxHeight;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).maxHeight = v;
    },
  },
  maxLines: {
    get(this: ElementNode) {
      return textPropsOf(this).maxLines;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).maxLines = v;
    },
  },
  maxWidth: {
    get(this: ElementNode) {
      return textPropsOf(this).maxWidth;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).maxWidth = v;
    },
  },
  offsetY: {
    get(this: ElementNode) {
      return textPropsOf(this).offsetY;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).offsetY = v;
    },
  },
  overflowSuffix: {
    get(this: ElementNode) {
      return textPropsOf(this).overflowSuffix;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).overflowSuffix = v;
    },
  },
  text: {
    get(this: ElementNode) {
      return textPropsOf(this).text;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).text = v;
    },
  },
  textAlign: {
    get(this: ElementNode) {
      return textPropsOf(this).textAlign;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).textAlign = v;
    },
  },
  verticalAlign: {
    get(this: ElementNode) {
      return textPropsOf(this).verticalAlign;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).verticalAlign = v;
    },
  },
  wordBreak: {
    get(this: ElementNode) {
      return textPropsOf(this).wordBreak;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).wordBreak = v;
    },
  },
  // Read-only on the renderer node: a write would throw there (B20)
  absX: {
    get(this: Forwarding) {
      return this.lng.absX;
    },
    set: ignoreWrite,
  },
  absY: {
    get(this: Forwarding) {
      return this.lng.absY;
    },
    set: ignoreWrite,
  },
  destroyed: {
    get(this: Forwarding) {
      return this.lng.destroyed;
    },
    set: ignoreWrite,
  },
});

// The DOM renderer draws fontStretch; a rendered WebGL text node has no such
// prop, and a @solidtv/renderer 2.0 node would take it as a field of its own.
// Before render the value waits in the props bag, which the renderer's
// createTextNode ignores.
Object.defineProperty(ElementNode.prototype, 'fontStretch', {
  get(this: ElementNode): unknown {
    return (this.lng as unknown as Record<string, unknown>).fontStretch;
  },
  set(this: ElementNode, v: unknown) {
    if (this.rendered && !isDomRendererActive()) return;
    (this.lng as unknown as Record<string, unknown>).fontStretch = v;
  },
});

export function createRawShaderAccessor<T>(key: keyof StyleEffects) {
  return {
    set(this: ElementNode, value: T) {
      this.shader = [key, value as unknown as IRendererShaderProps];
    },

    get(this: ElementNode) {
      return this.shader;
    },
  };
}

export function shaderAccessor<T extends Record<string, any> | number>(
  key:
    | 'border'
    | 'shadow'
    | 'rounded'
    | 'borderBottom'
    | 'borderLeft'
    | 'borderRight'
    | 'borderTop',
) {
  return {
    set(this: ElementNode, value: T) {
      let target = this.lng.shader || {};
      this._effects = this._effects || {};
      this._effects[key] = value;

      let animationSettings: AnimationSettings | undefined;

      if (this.lng.shader?.props) {
        target = this.lng.shader.props;
        const transitionKey = key === 'rounded' ? 'borderRadius' : key;
        if (
          this.transition &&
          (this.transition === true || this.transition[transitionKey])
        ) {
          target = {};
          animationSettings =
            this.transition === true || this.transition[transitionKey] === true
              ? undefined
              : (this.transition[transitionKey] as
                  | undefined
                  | AnimationSettings);
        }
      }

      if (key === 'rounded' || typeof value === 'number') {
        target.radius = value;
      } else {
        parseAndAssignShaderProps(key, value, target);
      }

      this._writeShaderTarget(target);

      if (animationSettings) {
        this.animate({ shaderProps: target }, animationSettings).start();
      }
    },
    get(this: ElementNode) {
      return this._effects?.[key];
    },
  };
}

if (isDev) {
  ElementNode.prototype.lngTree = function () {
    return logRenderTree(this);
  };
}

Object.defineProperties(ElementNode.prototype, {
  border: shaderAccessor<BorderStyle>('border'),
  borderBottom: shaderAccessor<BorderStyle>('borderBottom'),
  borderTop: shaderAccessor<BorderStyle>('borderTop'),
  borderLeft: shaderAccessor<BorderStyle>('borderLeft'),
  borderRight: shaderAccessor<BorderStyle>('borderRight'),
  shadow: shaderAccessor<ShadowProps>('shadow'),
  rounded: shaderAccessor<BorderRadius>('rounded'),
  // Alias for rounded
  borderRadius: shaderAccessor<BorderRadius>('rounded'),
  linearGradient:
    createRawShaderAccessor<LinearGradientProps>('linearGradient'),
  radialGradient:
    createRawShaderAccessor<RadialGradientProps>('radialGradient'),
});
