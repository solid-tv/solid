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
import calculateFlex, { getArrayValue } from './flexLayout.js';
import {
  log,
  isArray,
  isObject,
  isString,
  isINode,
  isElementNode,
  isElementText,
  logRenderTree,
  isFunction,
} from './utils.js';
import { compileBlock, shaderParse, type BlockPlan } from './stylePlan.js';
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
import { onFontLoaded } from './fontLoaded.js';

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
// Three phases run in one microtask (or, for a `loaded` handler, in the
// renderer frame between its walks: schedulePostMutationInFrame):
//   1. delete-flush — destroy nodes that were removed and not re-inserted
//   2. layout       — measure the texts written since the last run (and
//                     those that waited for a font), then recompute flex
//                     layout for any dirty subtree
//   3. focus        — resolve forwardFocus on deferred elements, then apply
//
// Order matters: layout reads the rendered tree (so destroyed nodes must be
// gone), and focus reads the laid-out tree.
let postMutationQueued = false;
let postMutationInFrame = false;
let nextActiveElement: ElementNode | null = null;
let deferredFocusElement: ElementNode | null = null;
// Entries past elementDeleteCount are undefined; the array keeps its
// capacity between runs.
const elementDeleteQueue: Array<ElementNode | undefined> = [];
let elementDeleteCount = 0;

// The layout queue: containers bucketed by depth (the root's children are at
// depth 1), laid out deepest first, so a container runs after every queued
// container inside it. A node is in at most one bucket entry that counts
// (`_layoutQueued`); updateLayout() clears it, so a node laid out directly is
// skipped when its entry comes up. Buckets keep their capacity: no allocation
// per run once the tree's depth has been seen.
const layoutBuckets: Array<Array<ElementNode | undefined>> = [];
const layoutBucketSize: number[] = [];
let layoutMaxDepth = -1; // deepest bucket that may hold a node
let layoutSweepDepth = -1; // bucket the layout phase is on, -1 outside it
// A node was queued since the layout phase last ran to its end (one that
// threw leaves it set, so the entries it left run next time).
let layoutPending = false;

// Text measurement (design 3.4): a `<text>` whose parent lays out is sized by
// the renderer's synchronous `measure()` before the parent's flex, not by the
// walk and its `loaded` event. A write to a prop its layout reads queues it
// here (`TextMeasure.due`); the layout phase measures the queue and queues
// the parent of a text whose size, as flex reads it, changed. Entries past
// textMeasureCount are undefined; the array keeps its capacity.
const textMeasureQueue: Array<ElementNode | undefined> = [];
let textMeasureCount = 0;
// Texts whose font's description was missing when measured (`waiting`):
// each hears `loaded` once (the walk lays it out when the font arrives), and
// loadFonts() tells when a font has loaded, for those no walk visits. Both
// set fontWaitingDue; the layout phase then measures them.
const fontWaiting: ElementNode[] = [];
let fontWaitingDue = false;
// Length at which the list is next swept of texts that no longer wait
// (destroyed: nothing else takes them off while their font never loads).
// Never while measureFontWaiting walks it (`measuringFontWaiting`).
let fontWaitingSweepAt = 64;
let measuringFontWaiting = false;
// Re-measures in one layout phase before the rest waits for its next change:
// a text whose size flex writes (flexGrow, flexShrink, minWidth) settles in
// one or two, so more means a layout that does not converge.
const MAX_TEXT_SWEEPS = 16;

export function enqueueDelete(node: ElementNode, n: number): void {
  if (node._queueDelete === undefined) {
    node._queueDelete = n;
    elementDeleteQueue[elementDeleteCount++] = node;
    schedulePostMutation();
  } else {
    node._queueDelete += n;
  }
}

function schedulePostMutation() {
  if (postMutationQueued) return;
  postMutationQueued = true;
  queueMicrotask(runPostMutation);
}

/**
 * Also runs the post-mutation pass inside the renderer's current or next
 * frame, after its walk and before the draw, so what it writes is drawn in
 * that frame. For handlers the renderer calls between its walks (`loaded`).
 */
function schedulePostMutationInFrame(): void {
  schedulePostMutation();
  if (postMutationInFrame) return;
  const stage = renderer.stage;
  if ('reprocessUpdates' in stage && stage.reprocessUpdates) {
    postMutationInFrame = true;
    stage.reprocessUpdates(runPostMutation);
  }
}

function runPostMutation() {
  postMutationQueued = false;
  postMutationInFrame = false;

  // Phase 1: delete-flush (the count is read every time: a destroy can
  // queue more). An entry is cleared before its destroy, so one whose
  // onDestroy threw is not retried and the next run carries on after it.
  if (elementDeleteCount > 0) {
    for (let i = 0; i < elementDeleteCount; i++) {
      const el = elementDeleteQueue[i];
      elementDeleteQueue[i] = undefined;
      if (el === undefined) continue;
      const queued = el._queueDelete ?? 0;
      el._queueDelete = undefined;
      if (queued < 0) {
        el.destroy();
      }
    }
    elementDeleteCount = 0;
  }

  // Phase 2: layout. Inline, not a function of its own: terser's default
  // `reduce_funcs` turns a module function with one call site into a
  // closure per call (as with every helper on this path).
  if (fontWaitingDue === true) {
    TextMeasure.measureFontWaiting();
  }
  if (layoutPending === true || textMeasureCount > 0) {
    measureQueuedTexts();
    // Start from the deepest bucket there is, so entries a run that threw
    // left behind are not stranded.
    layoutMaxDepth = layoutBuckets.length - 1;
    let textSweeps = 0;
    while (layoutMaxDepth >= 0) {
      let depth = layoutMaxDepth;
      layoutMaxDepth = -1;
      for (; depth >= 0; depth--) {
        layoutSweepDepth = depth;
        const bucket = layoutBuckets[depth]!;
        // Read the size every time: a run can queue more at this depth.
        for (let i = 0; i < layoutBucketSize[depth]!; i++) {
          const node = bucket[i];
          bucket[i] = undefined;
          if (node !== undefined && node._layoutQueued === true) {
            node.updateLayout();
          }
        }
        layoutBucketSize[depth] = 0;
      }
      layoutSweepDepth = -1;
      // Texts the sweep wrote (flex sizing a text, an onLayout): measured
      // now, so the container of one that resized runs again in another
      // sweep.
      if (textMeasureCount > 0 && textSweeps < MAX_TEXT_SWEEPS) {
        textSweeps++;
        measureQueuedTexts();
      }
    }
    if (textMeasureCount > 0) {
      // Not converging: drop the rest (each is measured again at its next
      // change), or the run its writes scheduled would start over.
      for (let i = 0; i < textMeasureCount; i++) {
        const t = textMeasureQueue[i];
        textMeasureQueue[i] = undefined;
        if (t !== undefined) {
          t._text!.due = false;
        }
      }
      textMeasureCount = 0;
      if (isDev) {
        console.warn(
          '[solid] Text sizes did not settle in ' +
            MAX_TEXT_SWEEPS +
            ' layout passes (a layout that changes the size of a text it lays out); the rest waits for its next change.',
        );
      }
    }
    layoutPending = false;
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

function enqueueLayout(node: ElementNode): void {
  if (node._layoutQueued === true) return;
  node._layoutQueued = true;
  layoutPending = true;
  // The depth in its tree: a removed node's tree ends at it.
  let depth = 0;
  for (
    let n: ElementNode = node, p = n.parent;
    n._detached !== true && p !== undefined && p !== null;
    n = p, p = n.parent
  ) {
    depth++;
  }
  while (layoutBuckets.length <= depth) {
    layoutBuckets.push([]);
    layoutBucketSize.push(0);
  }
  const size = layoutBucketSize[depth]!;
  layoutBuckets[depth]![size] = node;
  layoutBucketSize[depth] = size + 1;
  // During a sweep, a node at the bucket being run or shallower is reached
  // by that sweep; a deeper one needs another.
  if (depth > layoutMaxDepth && depth > layoutSweepDepth) {
    layoutMaxDepth = depth;
  }
}

/**
 * Queue `node`'s layout (flex and `onLayout`) for the post-mutation pass.
 * Within one pass, containers run deepest first, each at most once unless a
 * child's size changed after its run.
 */
function queueLayout(node: ElementNode): void {
  enqueueLayout(node);
  schedulePostMutation();
}

/**
 * Measures the texts written since the last call (`_textLayoutDirty`) and
 * queues the parent of each whose size, as flex reads it, changed. A text
 * the parent's updateLayout() measured already is skipped.
 */
function measureQueuedTexts(): void {
  for (let i = 0; i < textMeasureCount; i++) {
    const t = textMeasureQueue[i];
    textMeasureQueue[i] = undefined;
    // Cleared by a run that threw part way (the count was not reset).
    if (t === undefined) {
      continue;
    }
    const m = t._text!;
    if (m.due !== true) {
      continue;
    }
    const parent = t._parent;
    if (
      parent === undefined ||
      t._detached === true ||
      parent._requiresLayout !== true
    ) {
      // Moved out, or the parent stopped laying out: nothing to size.
      m.due = false;
      m.w = NaN;
      continue;
    }
    if (t._measureText() === true) {
      enqueueLayout(parent);
    }
  }
  textMeasureCount = 0;
}

/**
 * A text that waited for its font heard `loaded`: the walk laid it out, as
 * the font's description arrived. Shared by every waiting text (no closure
 * per text); the layout phase, in this frame, measures them all.
 */
function fontWaitHeard(): void {
  fontWaitingDue = true;
  schedulePostMutationInFrame();
}

/** Drops the texts that no longer wait for a font (destroyed ones). */
function sweepFontWaiting(): void {
  let kept = 0;
  for (let i = 0; i < fontWaiting.length; i++) {
    const t = fontWaiting[i]!;
    if (t._text!.waiting === true && t.destroyed !== true) {
      fontWaiting[kept++] = t;
    }
  }
  fontWaiting.length = kept;
  fontWaitingSweepAt = kept * 2 > 64 ? kept * 2 : 64;
}

/**
 * What Solid knows of a `<text>` it measures (`ElementNode._text`), made the
 * first time: only texts in a container that lays out have one. Its sizes
 * start as doubles, so storing a measured size allocates nothing.
 */
class TextMeasure {
  // `declare`d, assigned in the constructor: a class field would be emitted
  // as a native field that starts undefined (design 3.6.5).
  /** A prop its layout reads was written since it was last measured; queued. */
  declare due: boolean;
  /** Its font was missing when measured (`_waitForFont`). */
  declare waiting: boolean;
  /** Width and height, as flex reads them, when last measured; NaN before. */
  declare w: number;
  declare h: number;
  /**
   * Hears every layout (`_listenTextLoaded`): a text Solid animated a layout
   * prop of, and every measured text in DOM builds. For its lifetime.
   */
  declare listening: boolean;

  constructor() {
    this.due = false;
    this.waiting = false;
    this.w = NaN;
    this.h = NaN;
    this.listening = false;
  }

  /**
   * Measures the texts that waited for a font (`_waitForFont`): one whose
   * font is there now stops waiting and, if its size changed, queues its
   * parent; one whose font is still missing waits again. A method, not a
   * module function: the post-mutation pass is its one caller, and terser's
   * default `reduce_funcs` turns such a function into a closure per call.
   * (Its own: the try would keep that pass from being optimized.)
   */
  static measureFontWaiting(): void {
    fontWaitingDue = false;
    const n = fontWaiting.length;
    // A text whose font is still missing is appended again (_waitForFont),
    // which must not sweep the list under this loop.
    measuringFontWaiting = true;
    try {
      for (let i = 0; i < n; i++) {
        const t = fontWaiting[i]!;
        const m = t._text!;
        if (m.waiting !== true) {
          continue; // measured meanwhile
        }
        // Off first, so a measure() now queues no `loaded` for it.
        (t.lng as IRendererTextNode).off('loaded', fontWaitHeard);
        m.waiting = false;
        if (t.destroyed === true) {
          continue;
        }
        const parent = t._parent;
        if (
          parent === undefined ||
          t._detached === true ||
          parent._requiresLayout !== true
        ) {
          m.w = NaN;
          continue;
        }
        // Waits again (appended past n) while the font is still missing.
        if (t._measureText() === true) {
          enqueueLayout(parent);
        }
      }
    } finally {
      measuringFontWaiting = false;
    }
    // Keep the entries appended meanwhile, without allocating.
    const length = fontWaiting.length;
    for (let i = n; i < length; i++) {
      fontWaiting[i - n] = fontWaiting[i]!;
    }
    fontWaiting.length = length - n;
  }
}

/**
 * The settings of an animation that has none (no `animationSettings` on the
 * node or in Config): one object, so renderer v2's animateProp, which reuses
 * its controller for the same settings object, retargets a running one
 * rather than stopping it and making another per write. Nothing writes it.
 */
const NO_ANIMATION_SETTINGS: Readonly<AnimationSettings> = Object.freeze({});

/** onAnimation.stopped for one write, after its duration and delay. */
function fireAnimationStopped(
  node: ElementNode,
  stopped: AnimationEventHandler,
  name: string,
  value: number,
): void {
  stopped.call(node, name, value);
}

onFontLoaded(() => {
  if (fontWaiting.length > 0) {
    fontWaitingDue = true;
    schedulePostMutation();
  }
});

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
  props: Record<string, unknown>,
) => {
  // Parsed once per object (stylePlan.ts): `border` and `border-w`, ... A
  // sub-prop the props already hold with that value is not written again
  // (a facade write repacks); the result is the merge 1.6's writes gave.
  const parse = shaderParse(prefix, obj);
  const keys = parse.keys;
  const values = parse.values;
  for (let i = 0; i < keys.length; i++) {
    const name = keys[i]!;
    const value = values[i];
    if (props[name] !== value) {
      props[name] = value;
    }
  }
};

const copyOf = (value: unknown): unknown =>
  isArray(value) ? value.slice() : value;

/** A renderer `AdvancedProp`, as far as the gradient update reads it. */
interface AdvancedPropLike {
  default?: unknown;
  resolve?: unknown;
  set?: unknown;
}

/** The gradient shaders the raw accessors made, by accessor key. */
const gradientShaders = new WeakMap<object, string>();

/** Marks a key a state change tracks but has not written yet. */
const UNWRITTEN = {};

/**
 * The border family: the style keys whose objects write the `border-*`
 * shader props (a `border` write sets all four widths, a side its own).
 */
const BORDER_FAMILY: Record<string, boolean | undefined> = {
  border: true,
  borderTop: true,
  borderRight: true,
  borderBottom: true,
  borderLeft: true,
};

/**
 * Append the keys of the `$state` block `block` that `keys` does not hold
 * yet (they are written for the first time). Returns the new count.
 */
function trackKeys(
  block: unknown,
  keys: string[],
  count: number,
  applied: Record<string, unknown>,
): number {
  if (!isObject(block)) {
    return count;
  }
  const blockKeys = compileBlock(block).keys;
  for (let j = 0; j < blockKeys.length; j++) {
    const key = blockKeys[j]!;
    let k = 0;
    while (k < count && keys[k] !== key) {
      k++;
    }
    if (k === count) {
      if (count < keys.length) {
        keys[count] = key;
      } else {
        keys.push(key);
      }
      count++;
      applied[key] = UNWRITTEN;
    }
  }
  return count;
}

/** The base value undo restores: theme[key], else style[key] (pinned). */
function styleFallback(node: ElementNode, key: string): unknown {
  const theme = node._theme as Record<string, unknown> | undefined;
  let value = theme !== undefined ? theme[key] : undefined;
  if (value === undefined) {
    const style = node._style as Record<string, unknown> | undefined;
    if (style !== undefined) {
      value = style[key];
    }
  }
  if (isDev && value === undefined) {
    console.warn('fallback style key not found: ', key);
  }
  return value;
}

/**
 * The value `key` takes with `states` on: from the block of the state of
 * highest precedence that has it (the later in `order`, then the later
 * added; `order` undefined: the later added), else the base value.
 */
function resolveStateValue(
  node: ElementNode,
  key: string,
  states: States,
  order: DollarString[] | undefined,
): unknown {
  let best = -2;
  let plan: BlockPlan | undefined;
  let at = 0;
  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    const block = node[state];
    if (isObject(block)) {
      const candidate = compileBlock(block);
      const pos = candidate.index[key];
      if (pos !== undefined) {
        const rank = order === undefined ? -1 : order.indexOf(state);
        if (rank >= best) {
          best = rank;
          plan = candidate;
          at = pos;
        }
      }
    }
  }
  if (plan === undefined) {
    return styleFallback(node, key);
  }
  // A getter is read now, each time the state is applied (pinned).
  return plan.getters[at] === true ? plan.block[key] : plan.values[at];
}

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
  /** @internal flexGrow record (B8): the size before the last growth. */
  _flexBase?: number;
  /** @internal flexGrow record (B8): the size the last growth wrote. */
  _flexGrown?: number;
  /** @internal the last x, y, width, height flex wrote with a transition */
  _flexX?: number;
  _flexY?: number;
  _flexW?: number;
  _flexH?: number;
  /** @internal in the layout queue (queueLayout) */
  _layoutQueued: boolean;
  /**
   * @internal a `<text>` in a container that lays out: what Solid's text
   * measurement knows of it (`_textLayoutDirty`, `_measureText`); undefined
   * until it is first queued or measured
   */
  _text: TextMeasure | undefined;
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
  /**
   * @internal removed from its parent's children and not inserted since. Its
   * `parent` link stays (1.6: keys and events still bubble through it), but
   * it does not lay out that parent.
   */
  _detached: boolean;
  _theme?: Styles;
  _lastAnyKeyPressTime?: number;
  _type: 'element' | 'textNode';
  /** @internal The keys state changes wrote, in first-write order: undo walks them. Reused, never shrunk. */
  _undoStyles?: string[];
  /** @internal How many entries of `_undoStyles` are live. */
  _undoCount: number;
  /** @internal Per key in `_undoStyles`, the value the last state change wrote. */
  _applied?: Record<string, unknown>;
  _display?: 'flex' | 'block';
  _onLayout?: (this: ElementNode, target: ElementNode) => void;
  _requiresLayout: boolean;
  /** @internal the focus manager's generation stamp for the focus-path diff */
  _focusGen: number;
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
   */
  flexShrink?: number;
  /**
   * Defines the default size of an element before the remaining space is distributed.
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
    this._flexBase = undefined;
    this._flexGrown = undefined;
    this._flexX = undefined;
    this._flexY = undefined;
    this._flexW = undefined;
    this._flexH = undefined;
    // Written by flexLayout when it resizes a container: here, so that
    // write adds no field.
    this.preFlexwidth = undefined;
    this.preFlexheight = undefined;
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
    this._undoCount = 0;
    this._applied = undefined;
    this._display = undefined;
    this._onLayout = undefined;
    this._requiresLayout = false;
    this._focusGen = 0;
    this._layoutQueued = false;
    this._textProps = undefined;
    this._detached = false;
    this._text = undefined;
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
    const props = this.lng.shader?.props;
    if (props) {
      target = props;
    }
    if (v.rounded) target.radius = v.rounded.radius;
    if (v.borderRadius) target.radius = v.borderRadius;
    for (const k of EFFECT_SHADER_KEYS) {
      const obj = v[k];
      if (isObject(obj)) {
        parseAndAssignShaderProps(k, obj, target);
      }
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
    } else {
      const alias = Config.fontWeightAlias;
      const aliased =
        alias !== undefined && alias !== null
          ? (alias[weight] as number | string | undefined)
          : undefined;
      (this.lng as ElementNode).fontFamily =
        `${this._fontFamily || Config.fontSettings?.fontFamily}${aliased ?? weight}`;
    }
    this._textLayoutDirty();
  }

  insertChild(
    node: ElementNode | ElementText | TextNode,
    beforeNode?: ElementNode | ElementText | TextNode | null,
  ) {
    const children = this.children;
    const prevParent = node.parent;
    // Removed earlier (its parent link stays, as in 1.6): it is in no child
    // list, so there is nothing to take it out of.
    const detached = isElementNode(node) && node._detached;
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
        prevParent === this && !detached
          ? children[lastIndexOf(children, node) + 1]
          : undefined;
    }
    // A node in a parent (this one too) is taken out first, then inserted
    // before `beforeNode`, or appended.
    if (prevParent !== undefined && !detached) {
      if (drawn && prevParent === this) {
        drawnBefore = nextDrawn(children, lastIndexOf(children, node) + 1);
      }
      prevParent.removeChild(node);
    }
    // In a child list again (removeChild above marked it detached).
    if (isElementNode(node)) {
      node._detached = false;
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
      // Shifted up by hand: splice allocates, and a module helper with this
      // one call site would be a closure per call under terser's defaults.
      let i = children.length;
      children.push(node as ElementNode);
      for (; i > index; i--) {
        children[i] = children[i - 1]!;
      }
      children[index] = node as ElementNode;
    }

    if (!drawn) {
      node.parent = this;
      return;
    }
    // insertBefore reparents the renderer node too, so the parent setter's
    // renderer write is skipped.
    (node as ElementNode)._parent = this;
    const next = nextDrawn(children, index + 1);
    if (prevParent !== this || detached || next !== drawnBefore) {
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
      // Shifted down by hand: splice allocates the array of removed items,
      // and a module helper with this one call site would be a closure per
      // call under terser's defaults.
      if (index === 0) {
        children.shift();
      } else {
        const last = children.length - 1;
        for (let i = index; i < last; i++) {
          children[i] = children[i + 1]!;
        }
        children.pop();
      }
      if (isElementNode(node)) {
        node._detached = true;
        if (node.onRemove) {
          node.onRemove.call(node, node);
        }
      }

      if (this.requiresLayout()) {
        queueLayout(this);
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
      animationSettings || this.animationSettings || NO_ANIMATION_SETTINGS,
    );
    // A text's layout prop: its container follows the animated sizes.
    if (
      this._type === NodeType.TextNode &&
      (name === 'fontSize' ||
        name === 'lineHeight' ||
        name === 'w' ||
        name === 'h')
    ) {
      this._textLayoutAnimated();
    }
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
      // Its arguments through the timer, not a closure per write.
      setTimeout(fireAnimationStopped, total, this, stopped, name, value);
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
    const controller = (this.lng as IRendererNode).animate(
      props,
      animationSettings || this.animationSettings || NO_ANIMATION_SETTINGS,
    );
    // A prop the text's layout reads (inline: a module function with this
    // one call site would be a closure per call under terser's defaults).
    if (
      this._type === NodeType.TextNode &&
      ('fontSize' in props ||
        'lineHeight' in props ||
        'letterSpacing' in props ||
        'maxWidth' in props ||
        'maxHeight' in props ||
        'maxLines' in props ||
        'w' in props ||
        'h' in props)
    ) {
      // Started now or later, again or not at all: the text hears its
      // layouts from now on (`_listenTextLoaded`).
      this._textLayoutAnimated();
    }
    return controller;
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
    // An autosize node takes its size from its texture: the size the
    // parent's last layout saw, so a load that leaves it unchanged needs no
    // layout; a new one queues the parent and runs the pass in the frame.
    // (A text in a layout parent is measured instead: _measureText.)
    let width = this.width;
    let height = this.height;
    (this.lng as IRendererNode).on('loaded', () => {
      const w = this.width;
      const h = this.height;
      if (w === width && h === height) return;
      width = w;
      height = h;
      const parent = this.parent;
      if (parent !== undefined && parent !== null && !this._detached) {
        enqueueLayout(parent);
        schedulePostMutationInFrame();
      }
    });
  }

  /**
   * @internal A prop the text layout reads was written on this element:
   * `text`, `fontFamily`/`fontWeight`, `fontSize`, `lineHeight`,
   * `letterSpacing`, `maxWidth`/`width`, `maxHeight`/`height`, `maxLines`,
   * `wordBreak`, `overflowSuffix`. A rendered `<text>` whose parent lays out
   * is measured again in the post-mutation pass, and its parent laid out if
   * its size changed. Anything else returns at once.
   */
  _textLayoutDirty(): void {
    if (this._type !== NodeType.TextNode || this.rendered !== true) {
      return;
    }
    let m = this._text;
    if (m !== undefined && m.due === true) {
      return;
    }
    const parent = this._parent;
    if (
      parent === undefined ||
      this._detached === true ||
      parent._requiresLayout !== true
    ) {
      // No layout reads it: a parent that lays it out later measures it
      // first (updateLayout), as one it never measured.
      if (m !== undefined) {
        m.w = NaN;
      }
      return;
    }
    if (m === undefined) {
      m = new TextMeasure();
      this._text = m;
    }
    m.due = true;
    textMeasureQueue[textMeasureCount++] = this;
    schedulePostMutation();
  }

  /**
   * @internal Size this rendered `<text>` for its parent's layout now, with
   * the renderer's synchronous `measure()` (renderer v2 lays it out into its
   * layout cache, and the walk reuses that layout). Returns whether its
   * width or height, as flex reads them (`maxWidth || w`, `maxHeight || h`),
   * changed since the last call. A text with both max sizes is that large to
   * flex whatever its layout: the walk lays it out. While its font is
   * missing it waits (`_waitForFont`).
   */
  _measureText(): boolean {
    let m = this._text;
    if (m === undefined) {
      m = new TextMeasure();
      this._text = m;
    }
    m.due = false;
    const lng = this.lng as IRendererTextNode;
    const maxWidth = lng.maxWidth;
    const maxHeight = lng.maxHeight;
    if (!(maxWidth > 0 && maxHeight > 0)) {
      if (lng.measure() === true) {
        if (m.waiting === true) {
          // The font arrived: stop listening (the list entry goes at the
          // next measureFontWaiting).
          m.waiting = false;
          lng.off('loaded', fontWaitHeard);
          fontWaitingDue = true;
        }
      } else if (lng.destroyed === true) {
        return false; // in a subtree destroyed since it was written
      } else if (m.waiting === false) {
        this._waitForFont(m);
      }
    }
    const w = maxWidth || lng.w;
    const h = maxHeight || lng.h;
    if (w === m.w && h === m.h) {
      return false;
    }
    m.w = w;
    m.h = h;
    return true;
  }

  /**
   * @internal Development only, on `loaded`: a layout Solid did not ask for
   * (the walk's) changed the size of a text Solid measures, so its parent's
   * flex has the old one. A prop the layout reads was written on the
   * renderer node (`el.lng`) rather than on the element, or animated there.
   */
  _warnUnmeasuredLayout(): void {
    const m = this._text;
    if (
      m === undefined ||
      m.due === true ||
      m.waiting === true ||
      m.listening === true ||
      m.w !== m.w ||
      this._detached === true ||
      this._parent === undefined ||
      this._parent._requiresLayout !== true
    ) {
      return;
    }
    const lng = this.lng as IRendererTextNode;
    if ((lng.maxWidth || lng.w) !== m.w || (lng.maxHeight || lng.h) !== m.h) {
      console.warn(
        '[solid] A text in a flex container was laid out at a size Solid did not measure: a prop its layout reads was written, or animated, on its renderer node (el.lng) instead of on the element. Its container keeps the old size.',
        this,
      );
    }
  }

  /**
   * @internal `measure()` found no font description: hear `loaded` once,
   * when the walk lays the text out (the renderer wakes the nodes it
   * visited), and wait for loadFonts() to say a font loaded (for one no walk
   * visits). Either way measureFontWaiting measures it again.
   */
  _waitForFont(m: TextMeasure): void {
    m.waiting = true;
    (this.lng as IRendererTextNode).on('loaded', fontWaitHeard);
    if (
      measuringFontWaiting === false &&
      fontWaiting.length >= fontWaitingSweepAt
    ) {
      sweepFontWaiting();
    }
    fontWaiting.push(this);
  }

  /**
   * @internal Solid animated a prop this text's layout reads
   * (`_sendToLightningAnimatable`, `animate()`): from now on, for the text's
   * lifetime, each layout the walk makes of an animated value lays its
   * container out again in that frame, as 1.6's `loaded` listener did.
   * Lifetime, not the animation's: Solid does not see a controller started
   * later, or again (`animate()` returns it to the app).
   */
  _textLayoutAnimated(): void {
    if (this.rendered !== true) {
      return;
    }
    const parent = this._parent;
    if (
      parent === undefined ||
      this._detached === true ||
      parent._requiresLayout !== true
    ) {
      return;
    }
    this._listenTextLoaded();
  }

  /**
   * @internal Hear every layout of this text: one whose size, as flex reads
   * it, Solid did not measure lays the container out in that frame. One
   * closure per text, made once and kept for its lifetime, on its renderer
   * node only (nothing else holds it, so it goes with the node). A layout
   * Solid measured changes nothing, and asks for no second walk.
   */
  _listenTextLoaded(): void {
    let m = this._text;
    if (m === undefined) {
      m = new TextMeasure();
      this._text = m;
    }
    if (m.listening === true) {
      return;
    }
    m.listening = true;
    this._hearTextLayouts();
  }

  /**
   * @internal The listener `_listenTextLoaded` adds, once per text. A method
   * of its own: an arrow's `this` is allocated in a context on every call of
   * the method that holds it, and that one runs on every animated write.
   */
  _hearTextLayouts(): void {
    (this.lng as IRendererTextNode).on('loaded', () => {
      if (this._textSizeChanged() === true) {
        enqueueLayout(this._parent!);
        schedulePostMutationInFrame();
      }
    });
  }

  /**
   * @internal After a layout Solid did not make (the walk's, of an animated
   * value; the DOM renderer's late re-measure): whether this text's size, as
   * flex reads it, changed since Solid last saw it. If so, it is recorded
   * and the caller lays the parent out. False while a measure is due.
   */
  _textSizeChanged(): boolean {
    const m = this._text;
    if (m === undefined || m.due === true || m.waiting === true) {
      return false;
    }
    const parent = this._parent;
    if (this._detached === true) {
      // Removed (N3 keeps `parent`): the parent it joins next measures it.
      m.w = NaN;
      return false;
    }
    if (parent === undefined || parent._requiresLayout !== true) {
      return false;
    }
    const lng = this.lng as IRendererTextNode;
    const w = lng.maxWidth || lng.w;
    const h = lng.maxHeight || lng.h;
    if (w === m.w && h === m.h) {
      return false;
    }
    m.w = w;
    m.h = h;
    return true;
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
        // Bound here, not an arrow: an arrow's `this` is allocated in a
        // context on every destroy(), a promise or not.
        void destroyPromise.then(this._destroy.bind(this));
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
    const current = this._states;
    if (current === undefined) {
      const created = new States(this._stateChanged.bind(this), states);
      this._states = created;
      if (this.rendered && created.length > 0) {
        this._stateChanged();
      }
      return;
    }
    // An unchanged list is a no-op (design 3.3.3): nothing to re-apply.
    // "Unchanged" by the rules of States.merge: an array or a string
    // replaces the list, an object adds its truthy keys (`has`) and removes
    // its falsy ones. (Inline on purpose here and in the gradient accessor:
    // terser's default `reduce_funcs` turns a single-use helper into a
    // closure per call.)
    const len = current.length;
    let changed = false;
    if (isArray(states)) {
      changed = states.length !== len;
      for (let i = 0; !changed && i < len; i++) {
        changed = states[i] !== current[i];
      }
    } else if (isString(states)) {
      changed = len !== 1 || current[0] !== states;
    } else {
      for (const key in states) {
        const state = key as DollarString;
        if (states[state]) {
          changed = !current.has(state);
        } else {
          for (let i = 0; !changed && i < len; i++) {
            changed = current[i] === state;
          }
        }
        if (changed) {
          break;
        }
      }
    }
    if (!changed) {
      return;
    }
    current.merge(states);
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
    this._layoutQueued = false;
    const children = this.children;
    const numChildren = children.length;
    if (numChildren === 0) return;
    if (isDev) log('Layout: ', this);

    const isFlex = this._display === 'flex';
    if (isFlex && this.flexGrow && this.width === 0) {
      return;
    }

    // Texts written since Solid last measured them (a direct updateLayout()
    // before the post-mutation pass), or never measured (this container lays
    // out only now): sized before the pass reads them.
    for (let i = 0; i < numChildren; i++) {
      const c = children[i] as ElementNode;
      if (c._type === NodeType.TextNode && c.rendered === true) {
        const m = c._text;
        if (m === undefined || m.due === true || m.w !== m.w) {
          c._measureText();
        }
      }
    }

    let flexChanged = isFlex && calculateFlex(this);

    if (isFlex && this._containsFlexGrow === true) {
      // This pass changed its children's sizes: lay out the flex ones again,
      // directly, so they do not queue this container back through their
      // own size. If one of them resized, lay this container out once more.
      let childResized = false;
      for (let i = 0; i < numChildren; i++) {
        const c = children[i]!;
        if (isElementNode(c) && c._display === 'flex') {
          if (calculateFlex(c)) childResized = true;
          const childOnLayout = c._onLayout;
          if (childOnLayout !== undefined && isFunction(childOnLayout)) {
            childOnLayout.call(c, c);
          }
        }
      }
      if (childResized && calculateFlex(this)) {
        flexChanged = true;
      }
      this._containsFlexGrow = null;
    }

    // One onLayout, after the final layout (the children's included).
    const onLayout = this._onLayout;
    const onLayoutChanged =
      onLayout !== undefined &&
      isFunction(onLayout) &&
      onLayout.call(this, this);

    // A container whose size changed queues its parent (one with nothing to
    // lay out would do nothing).
    // A removed container keeps its parent link but not its place.
    const parent = this._detached ? undefined : this.parent;
    if ((flexChanged || onLayoutChanged) && parent && parent._requiresLayout) {
      queueLayout(parent);
    }
  }

  /**
   * Apply the `$state` blocks of the active states (design 3.3). The keys
   * any state wrote since the states were last empty are tracked in
   * `_undoStyles`, in first-write order; each takes its value from the
   * active block of highest precedence, else the base value (`theme`, then
   * `style`, then undefined: pinned). After render a key is written only
   * when that value differs from the one written last (`_applied`); before
   * render every key is written, into the props bag, as before 1.7.
   */
  _stateChanged() {
    if (isDev) log('State Changed: ', this, this.states);
    const states = this.states;

    if (isDev) {
      const div = (this.lng as IRendererNode)?.div;
      if (div) {
        if (states.length > 0) {
          div.dataset.states = states.join(' ');
        } else {
          delete div.dataset.states;
        }
      }
    }

    if (this.forwardStates) {
      // Children first. They take this list: their setter copies it
      // (forwardStates overwrites their own states, pinned) and does nothing
      // when it is unchanged.
      const children = this.children;
      for (let i = 0; i < children.length; i++) {
        children[i]!.states = states;
      }
    }

    const n = states.length;
    const count = this._undoCount;
    if (count === 0) {
      // Nothing to undo: done unless an active state has a block. This runs
      // on every path element of every focus change.
      let i = 0;
      while (i < n && !isObject(this[states[i]!])) {
        i++;
      }
      if (i === n) {
        return;
      }
    }

    if (this._undoStyles === undefined) {
      this._undoStyles = [];
    }
    if (this._applied === undefined) {
      this._applied = Object.create(null) as Record<string, unknown>;
    }
    this._writeStates(n);
  }

  /**
   * The state-style loops of `_stateChanged`, for `n` active states: a
   * method of its own, so that `_stateChanged`, which runs for every path
   * element of every focus change, stays the short early-return above. Each
   * key is written through its setter, as before 1.7: a border or shadow
   * object merges into the shader props, the later write of a sub-prop
   * winning.
   */
  _writeStates(n: number) {
    const states = this._states!;
    const keys = this._undoStyles!;
    const applied = this._applied!;
    const diff = this.rendered;
    let count = this._undoCount;

    // The border family's keys write one set of shader props. When a change
    // writes some of the tracked family keys and skips the others as
    // unchanged, a written one may have overwritten what a skipped one holds
    // (a `border` sets all four widths): then the family is written again,
    // every tracked key in tracked order, the order 1.6 wrote the merged
    // object in, so the later key wins as it did. (The shadow is one key.)
    let borderKeys = 0;
    let borderWrites = 0;

    if (n === 0) {
      // Undo every tracked key, in its order (`transition` too: pinned), to
      // its base value. A setter that throws leaves the keys after it for
      // the next change, as before 1.7.
      for (let i = 0; i < count; i++) {
        const key = keys[i]!;
        const value = styleFallback(this, key);
        const border = BORDER_FAMILY[key] === true;
        if (border) {
          borderKeys++;
        }
        if (!diff || value !== applied[key]) {
          applied[key] = value;
          this[key] = value;
          if (border) {
            borderWrites++;
          }
        }
      }
      if (borderWrites !== 0 && borderWrites !== borderKeys) {
        this._rewriteBorderKeys(count);
      }
      this._undoCount = 0;
      return;
    }

    // Track the active blocks' keys, block by block in precedence order
    // (lowest first), after the tracked ones: the key order of the merged
    // object before 1.7, which decides the write order.
    const stateOrder = this.stateOrder || Config.stateOrder;
    const order =
      n > 1 && stateOrder !== undefined && stateOrder.length > 0
        ? stateOrder
        : undefined;
    if (order === undefined) {
      for (let i = 0; i < n; i++) {
        count = trackKeys(this[states[i]!], keys, count, applied);
      }
    } else {
      // States not in `order` first, in the order added, then by `order`.
      let lastRank = -2;
      let lastPos = -1;
      for (let done = 0; done < n; done++) {
        let pick = 0;
        let pickRank = 0;
        let found = false;
        for (let i = 0; i < n; i++) {
          const rank = order.indexOf(states[i]!);
          if (
            (rank > lastRank || (rank === lastRank && i > lastPos)) &&
            (!found || rank < pickRank)
          ) {
            pick = i;
            pickRank = rank;
            found = true;
          }
        }
        count = trackKeys(this[states[pick]!], keys, count, applied);
        lastRank = pickRank;
        lastPos = pick;
      }
    }
    this._undoCount = count;

    // `transition` first, so the other keys animate with it (pinned); one
    // that resolves to undefined is written in its place.
    for (let i = 0; i < count; i++) {
      if (keys[i] === 'transition') {
        const value = resolveStateValue(this, 'transition', states, order);
        if (value !== undefined && (!diff || value !== applied.transition)) {
          applied.transition = value;
          this.transition = value as ElementNode['transition'];
        }
        break;
      }
    }
    for (let i = 0; i < count; i++) {
      const key = keys[i]!;
      const value = resolveStateValue(this, key, states, order);
      const border = BORDER_FAMILY[key] === true;
      if (border) {
        borderKeys++;
      }
      if (!diff || value !== applied[key]) {
        applied[key] = value;
        this[key] = value;
        if (border) {
          borderWrites++;
        }
      }
    }
    if (borderWrites !== 0 && borderWrites !== borderKeys) {
      this._rewriteBorderKeys(count);
    }
  }

  /**
   * Write every tracked border-family key again, in tracked order, with the
   * value the state change resolved for it (`_applied`): see `_writeStates`.
   */
  _rewriteBorderKeys(count: number) {
    const keys = this._undoStyles!;
    const applied = this._applied!;
    for (let i = 0; i < count; i++) {
      const key = keys[i]!;
      if (BORDER_FAMILY[key] === true) {
        this[key] = applied[key];
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
      queueLayout(parent);
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

        // B11: margins live on the ElementNode, not in the renderer props;
        // resolved as flex resolves them (a side, else the margin array).
        if (!textProps.maxWidth) {
          textProps.maxWidth =
            parentWidth -
            textProps.x! -
            (node.marginRight || getArrayValue(node.margin, 1));
        }

        if (textProps.contain === 'both' && !textProps.maxHeight) {
          textProps.maxHeight =
            parentHeight -
            textProps.y! -
            (node.marginBottom || getArrayValue(node.margin, 2));
        } else if (textProps.maxLines === 1 && !textProps.maxHeight) {
          // B12: a lineHeight at or below 3 multiplies the font size.
          const lineHeight = textProps.lineHeight;
          textProps.maxHeight =
            lineHeight && lineHeight <= 3 && textProps.fontSize
              ? lineHeight * textProps.fontSize
              : lineHeight || textProps.fontSize;
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

      // A text in a layout parent is queued to be measured below, once its
      // listeners are on (an `onEvent.loaded` hears the layout measure()
      // makes).
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

    const onEvent = node.onEvent;
    if (onEvent) {
      // for-in with an own-property test, as Object.entries (Chrome 54)
      // reads it: the floor is Chrome 47.
      for (const name in onEvent) {
        if (
          Object.prototype.hasOwnProperty.call(onEvent, name) &&
          typeof node.lng.on === 'function'
        ) {
          const handler = onEvent[name as keyof OnEvent]!;
          // The listener captures these block-scoped names, not render()'s
          // `node`: a captured local is allocated in a context on every
          // call, onEvent or not.
          const target = node;
          node.lng.on(name, (_inode, data) =>
            handler.call(target, target, data),
          );
        }
      }
    }

    if (node._type === NodeType.TextNode && parent._requiresLayout === true) {
      // Its parent's flex reads its size: it is measured in the post-mutation
      // pass, before the parent's layout (queued above) and before the frame,
      // instead of waiting for the walk's `loaded`. Not here: a write later
      // in this tick would lay it out twice (and `loaded` twice).
      if (isDomRendererActive()) {
        // The DOM renderer measures again when a web font loads after the
        // text was measured (its size then was the fallback font's): lay the
        // container out at that size, as before 1.7.
        node._listenTextLoaded();
      } else if (isDev) {
        (node.lng as IRendererTextNode).on('loaded', () =>
          node._warnUnmeasuredLayout(),
        );
      }
      node._textLayoutDirty();
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
  'transition' | '_sendToLightningAnimatable' | '_type' | '_textLayoutDirty'
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
      // On a text, the max height (renderer v2), which its layout reads.
      if (this._type === NodeType.TextNode) {
        this._textLayoutDirty();
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
      // On a text, the max width (renderer v2), which its layout reads.
      if (this._type === NodeType.TextNode) {
        this._textLayoutDirty();
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
      this._textLayoutDirty();
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
      this._textLayoutDirty();
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
      // The DOM renderer sizes a text by it (renderer v2 only moves the
      // block: the measure finds nothing to lay out).
      this._textLayoutDirty();
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
      this._textLayoutDirty();
    },
  },
  maxHeight: {
    get(this: ElementNode) {
      return textPropsOf(this).maxHeight;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).maxHeight = v;
      this._textLayoutDirty();
    },
  },
  maxLines: {
    get(this: ElementNode) {
      return textPropsOf(this).maxLines;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).maxLines = v;
      this._textLayoutDirty();
    },
  },
  maxWidth: {
    get(this: ElementNode) {
      return textPropsOf(this).maxWidth;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).maxWidth = v;
      this._textLayoutDirty();
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
      this._textLayoutDirty();
    },
  },
  text: {
    get(this: ElementNode) {
      return textPropsOf(this).text;
    },
    set(this: ElementNode, v: unknown) {
      textPropsFor(this).text = v;
      this._textLayoutDirty();
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
      this._textLayoutDirty();
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
      const shader = this.lng.shader as IRendererShader | null | undefined;
      if (
        shader != null &&
        isObject(value) &&
        gradientShaders.get(shader) === key
      ) {
        // The gradient shader this accessor made: update it, not a new one,
        // to the props createShader would have built from `value`: a
        // declared prop `value` does not name takes its default. The type's
        // declaration is read here, each set: a gradient is set rarely.
        const type = shader.shaderType as unknown;
        const defs = isObject(type) ? type.props : undefined;
        if (!isObject(defs)) {
          // The DOM renderer keeps the given object as the props.
          shader.props = value as IRendererShaderProps;
        } else {
          const props = shader.props as Record<string, unknown>;
          // Props first, then aliases, each in declaration order, as
          // createShader applies them; an alias only writes when given.
          for (let pass = 0; pass < 2; pass++) {
            for (const name in defs) {
              const def = defs[name];
              // An AdvancedProp has a default (the registry's test).
              const advanced = isObject(def) && def.default !== undefined;
              const alias =
                advanced && (def as AdvancedPropLike).set !== undefined;
              if (alias !== (pass === 1)) {
                continue;
              }
              const resolves =
                advanced && (def as AdvancedPropLike).resolve !== undefined;
              const given = value[name];
              if (given !== undefined) {
                // createShader copies an array, unless the prop resolves it.
                props[name] = resolves ? given : copyOf(given);
              } else if (!alias) {
                // What a shader created without it holds: a prop that
                // resolves its value resolves its default from undefined, a
                // plain one takes a copy of its default.
                props[name] = resolves
                  ? undefined
                  : copyOf(advanced ? (def as AdvancedPropLike).default : def);
              }
            }
          }
        }
        if (this.rendered && isDomRendererActive()) {
          // The DOM renderer restyles when its shader is assigned.
          (this.lng as IRendererNode).shader = shader;
        }
        return;
      }
      this.shader = [key, value as unknown as IRendererShaderProps];
      const created = this.lng.shader as object | null | undefined;
      if (created != null) {
        gradientShaders.set(created, key);
      }
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
      let effects = this._effects;
      if (effects === undefined) {
        effects = this._effects = {};
      }
      const prev: unknown = effects[key];
      effects[key] = value;
      // The radius (a number written to a border key too), else a border or
      // shadow object: as before 1.7, its sub-props merge into the shader
      // props, the later write winning, so a state undo that writes the
      // style's object back leaves the sub-props it does not name (B18, not
      // fixed in 1.7); undefined writes nothing.
      const radius = key === 'rounded' || typeof value === 'number';
      const shader = this.lng.shader as IRendererShader | null | undefined;
      const props = shader != null ? shader.props : undefined;
      let target: Record<string, unknown>;
      let animationSettings: AnimationSettings | undefined;
      if (props != null) {
        target = props as Record<string, unknown>;
        // With a transition for the key, the sub-props go into a target of
        // their own, which animates (one of `true` is built and dropped, as
        // before 1.7).
        const transition = this.transition;
        if (transition) {
          const setting =
            transition === true
              ? true
              : transition[key === 'rounded' ? 'borderRadius' : key];
          if (setting) {
            target = {};
            animationSettings =
              setting === true ? undefined : (setting as AnimationSettings);
          }
        }
      } else {
        // No shader yet: before render, the props bag createShader reads at
        // render; after render, the props of a new shader. (A rendered DOM
        // node without one holds the renderer's shared default: never write
        // into it.)
        target =
          shader != null && !this.rendered
            ? (shader as unknown as Record<string, unknown>)
            : {};
      }
      if (radius) {
        // Into the shader's props only when it changed. An animated undo to
        // no radius animates to 0, which is what 1.6.4 showed: renderer 1.9
        // made a track for undefined and resolved it to [0, 0, 0, 0];
        // renderer 2.0 makes no track for undefined.
        if (target === props && value === prev) {
          return;
        }
        target.radius =
          value === undefined && animationSettings !== undefined ? 0 : value;
      } else if (isObject(value)) {
        parseAndAssignShaderProps(key, value, target);
      }
      this._writeShaderTarget(target);
      if (animationSettings !== undefined) {
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
