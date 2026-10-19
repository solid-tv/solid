import {
  animateSlotProp,
  DIRTY_ALPHA,
  DIRTY_LOCAL,
  F_ALPHA,
  F_MOUNT_X,
  F_MOUNT_Y,
  F_PIVOT_X,
  F_PIVOT_Y,
  F_ROTATION,
  F_SCALE_X,
  F_SCALE_Y,
  F_X,
  F_Y,
  I_COLOR_BL,
  I_COLOR_BR,
  I_COLOR_TL,
  I_COLOR_TR,
  NULL,
  setColor,
  setField,
  setZIndex,
  type AnimateProps,
  type ClippingValue,
  type IAnimationController,
  type RendererCore,
  type ShaderNode,
  type SlotOwner,
  type Texture,
  type TextureOptions,
  type TextAlign,
  type TextContain,
  type TextFontStyle,
  type TextVerticalAlign,
  type TextWordBreak,
} from '@solidtv/renderer';
import { Config } from '../config.js';
import { isDev } from '../env.js';
import type {
  AnimationSettings,
  BorderStyle,
  DollarString,
  SingleBorderStyle,
  Styles,
} from '../intrinsicTypes.js';
import { NodeType, type TextNode } from '../nodeTypes.js';
import States, { type NodeStates } from '../states.js';
import {
  installAccessors,
  writeHeight,
  writePlaceholderColor,
  writeTextHeight,
  writeTextWidth,
  writeWidth,
} from './accessors.js';
import {
  animateNode,
  chainAnimation,
  installAnimationAccessors,
  startChain,
  stoppedHook,
  transitionSettings,
} from './animation.js';
import {
  SET_COUNT,
  SET_INDEX,
  type StoreProp,
  type TextNumberProp,
} from './defaults.js';
import { installShaderAccessors, SHADER_UNMANAGED } from './shader.js';
import {
  BORDER_FAMILY,
  readKey,
  resolveStateValue,
  rewriteBorderKeys,
  setStateBlock,
  stateBlock,
  styleFallback,
  trackKeys,
  writeKey,
} from './styles.js';
import { installTextAccessors, writeTextNumber } from './textProps.js';

/** The two kinds of ElementNode: a `<view>` and a `<text>`. */
export type ElementKind = typeof NodeType.Element | typeof NodeType.TextNode;

/** A child of an ElementNode: an element, or a string inside a `<text>`. */
export type SolidNode = ElementNode | TextNode;

/** A listener of a renderer event (`loaded`, `inViewport`, ...). */
export type NodeEventHandler = (node: ElementNode, data: unknown) => void;

/** The `onEvent` prop: a listener per event name (`loaded`, `failed`, ...). */
export type OnEventProp = Record<string, NodeEventHandler | undefined>;

/**
 * An `onAnimation` handler: the prop's name and a value. `animating` gets
 * the value written (the target); `stopped` gets the prop's value at the
 * stop: the target on completion, where it stopped if interrupted.
 */
export type AnimationEventHandler = (
  this: ElementNode,
  name: string,
  endValue: number,
) => void;

/** `onAnimation`: called as a transition starts and when it stops. */
export interface AnimationEvents {
  animating?: AnimationEventHandler;
  stopped?: AnimationEventHandler;
}

/** One `chain` entry. */
interface ChainedAnimation {
  props: AnimateProps;
  animationSettings: AnimationSettings | undefined;
}

/** A key handler (`onUp`, `onEnter`, ...); true stops the bubbling. */
export type KeyHandler = (
  this: ElementNode,
  e: KeyboardEvent,
  target: ElementNode,
  handlerElm: ElementNode,
  mappedEvent?: string,
) => boolean | void;

/** `transition`: per-prop settings, or true/false for all props. */
export type TransitionSetting =
  | Record<string, AnimationSettings | undefined | true | false>
  | true
  | false;

type Spacing =
  | number
  | [number, number]
  | [number, number, number]
  | [number, number, number, number];

/**
 * The renderer handle (spec 5.1): an ElementNode owns one store slot from
 * construction and reads and writes the store through the renderer's
 * slot-keyed functions. Store props are prototype accessors (accessors.ts);
 * every own field is assigned in the constructor, in one order, so every
 * node has one hidden class.
 */
export class ElementNode implements SlotOwner {
  // Own fields: assigned in the constructor, not class fields (spec 3).
  /** The store slot (never `id`); NULL once destroyed. */
  declare slot: number;
  declare readonly core: RendererCore;
  declare readonly _type: ElementKind;
  declare parent: ElementNode | undefined;
  declare children: SolidNode[];
  /** Attached to the rendered tree (spec 5.2). */
  declare rendered: boolean;
  /** One byte per SET_* index (defaults.ts): 1 once the app wrote the prop. */
  declare _set: Uint8Array;
  declare _states: States | undefined;
  declare _style: Styles | undefined;
  declare _theme: Styles | undefined;
  declare _shader: ShaderNode | undefined;
  /** The raw shader prop objects, by accessor name (shader.ts). */
  declare _shaderProps: Record<string, unknown> | undefined;
  /** The feature bits of the rounded shader made, or SHADER_UNMANAGED. */
  declare _shaderFeatures: number;
  /** The key that made the node's shader while it is not the rounded one. */
  declare _shaderKey: string | undefined;
  declare _textProps: Record<string, unknown> | undefined;
  declare _transition: TransitionSetting | undefined;
  declare _animationSettings: AnimationSettings | undefined;
  declare _onEvent: Record<string, NodeEventHandler[]> | undefined;
  declare _flexX: number | undefined;
  declare _flexY: number | undefined;
  declare _flexWidth: number | undefined;
  declare _flexHeight: number | undefined;
  declare _queueDelete: number | undefined;
  declare _layoutDepth: number | undefined;
  // The flex props: plain fields, never renderer state.
  declare display: 'flex' | 'block' | undefined;
  declare direction: 'ltr' | 'rtl' | undefined;
  declare flexDirection:
    | 'row'
    | 'column'
    | 'row-reverse'
    | 'column-reverse'
    | undefined;
  declare flexWrap: 'nowrap' | 'wrap' | 'wrap-reverse' | undefined;
  declare flexBoundary: 'contain' | 'fixed' | undefined;
  declare flexCrossBoundary: 'fixed' | undefined;
  declare flexGrow: number | undefined;
  declare flexShrink: number | undefined;
  declare flexBasis: number | string | undefined;
  declare flexOrder: number | undefined;
  declare flexItem: boolean | undefined;
  declare alignItems: 'flexStart' | 'flexEnd' | 'center' | undefined;
  declare alignSelf: 'flexStart' | 'flexEnd' | 'center' | undefined;
  declare justifyContent:
    | 'flexStart'
    | 'flexEnd'
    | 'center'
    | 'spaceBetween'
    | 'spaceAround'
    | 'spaceEvenly'
    | undefined;
  declare gap: number | undefined;
  declare rowGap: number | undefined;
  declare columnGap: number | undefined;
  declare padding: Spacing | undefined;
  declare paddingTop: number | undefined;
  declare paddingRight: number | undefined;
  declare paddingBottom: number | undefined;
  declare paddingLeft: number | undefined;
  declare margin: Spacing | undefined;
  declare marginTop: number | undefined;
  declare marginRight: number | undefined;
  declare marginBottom: number | undefined;
  declare marginLeft: number | undefined;
  // The placement shortcuts' requests (accessors right, bottom, center,
  // centerX, centerY), resolved once by attach.
  declare _right: number | undefined;
  declare _bottom: number | undefined;
  declare _center: boolean | undefined;
  declare _centerX: boolean | undefined;
  declare _centerY: boolean | undefined;
  // The fontFamily and fontWeight as written; the text state's family is
  // derived from both (textProps.ts, B17).
  declare _fontFamily: string | undefined;
  declare _fontWeight: number | string | undefined;

  // App props with no accessor: plain fields the app writes, assigned in
  // the constructor too so a write adds no field.
  /** The app's string id (KeepAlive, focus, getChildById), not the slot. */
  declare id: string | undefined;
  declare autofocus: unknown;
  declare forwardFocus:
    | number
    | ((this: ElementNode, elm: ElementNode) => boolean | void)
    | undefined;
  declare skipFocus: boolean | undefined;
  declare onCreate: ((this: ElementNode, el: ElementNode) => void) | undefined;
  declare onRender: ((this: ElementNode, el: ElementNode) => void) | undefined;
  declare onDestroy:
    | ((this: ElementNode, el: ElementNode) => Promise<void> | void)
    | undefined;
  declare onLayout:
    | ((this: ElementNode, target: ElementNode) => void)
    | undefined;
  declare updateLayoutOn: unknown;
  declare onUp: KeyHandler | undefined;
  declare onDown: KeyHandler | undefined;
  declare onLeft: KeyHandler | undefined;
  declare onRight: KeyHandler | undefined;
  declare onEnter: KeyHandler | undefined;
  declare onLast: KeyHandler | undefined;
  declare onFocus:
    | ((
        this: ElementNode,
        currentFocusedElm: ElementNode,
        prevFocusedElm: ElementNode | undefined,
        nodeWithCallback: ElementNode,
      ) => void)
    | undefined;
  declare onFocusChanged:
    | ((
        this: ElementNode,
        hasFocus: boolean,
        currentFocusedElm: ElementNode,
        prevFocusedElm: ElementNode | undefined,
        nodeWithCallback: ElementNode,
      ) => void)
    | undefined;
  declare onBlur:
    | ((
        this: ElementNode,
        currentFocusedElm: ElementNode,
        prevFocusedElm: ElementNode,
        nodeWithCallback: ElementNode,
      ) => void)
    | undefined;
  declare onKeyPress:
    | ((
        this: ElementNode,
        e: KeyboardEvent,
        mappedKeyEvent: string | undefined,
        handlerElm: ElementNode,
        currentFocusedElm: ElementNode,
      ) => boolean | void)
    | undefined;
  declare onAnimation: AnimationEvents | undefined;
  /** The `onEvent` object as written (animation.ts). */
  declare _onEventProp: OnEventProp | undefined;
  // `chain` and `start` (animation.ts).
  declare _animationQueue: ChainedAnimation[] | undefined;
  declare _animationQueueSettings: AnimationSettings | undefined;
  declare _animationRunning: boolean;
  // States (styles.ts).
  /** The children take this node's states whenever they change. */
  declare forwardStates: boolean | undefined;
  /** The precedence of the states, lowest first; else Config.stateOrder. */
  declare stateOrder: DollarString[] | undefined;
  /** The keys state changes wrote, in first-write order: undo walks them. Reused, never shrunk. */
  declare _undoStyles: string[] | undefined;
  /** How many entries of `_undoStyles` are live. */
  declare _undoCount: number;
  /** Per key in `_undoStyles`, the value the last state change wrote. */
  declare _applied: Record<string, unknown> | undefined;
  /** The `$state` blocks written on the node (JSX `$name`, theme keys). */
  declare _stateBlocks: Record<string, unknown> | undefined;

  // Prototype accessors (animation.ts).
  declare transition: TransitionSetting | undefined;
  declare animationSettings: AnimationSettings | undefined;
  declare onEvent: OnEventProp | undefined;

  // Prototype accessors (accessors.ts): the store props.
  declare x: number;
  declare y: number;
  declare width: number;
  declare height: number;
  declare alpha: number;
  declare scale: number;
  declare scaleX: number;
  declare scaleY: number;
  declare rotation: number;
  declare mount: number;
  declare mountX: number;
  declare mountY: number;
  declare pivot: number;
  declare pivotX: number;
  declare pivotY: number;
  declare zIndex: number;
  declare color: number;
  declare colorTop: number;
  declare colorBottom: number;
  declare colorLeft: number;
  declare colorRight: number;
  declare colorTl: number;
  declare colorTr: number;
  declare colorBl: number;
  declare colorBr: number;
  declare placeholderColor: number;
  declare clipping: ClippingValue;
  declare rtl: boolean | null;
  declare data: Record<string, unknown> | null;
  declare src: string | null;
  declare texture: Texture | null;
  declare textureOptions: TextureOptions;
  declare readonly absX: number;
  declare readonly absY: number;
  declare hidden: boolean;
  declare right: number | undefined;
  declare bottom: number | undefined;
  declare center: boolean | undefined;
  declare centerX: boolean | undefined;
  declare centerY: boolean | undefined;
  // The text props (textProps.ts): the renderer's text state on a `<text>`,
  // `_textProps` on a `<view>`.
  declare text: string;
  declare fontFamily: string | undefined;
  declare fontWeight: number | string | undefined;
  declare fontSize: number;
  declare fontStyle: TextFontStyle;
  declare lineHeight: number;
  declare textAlign: TextAlign;
  declare verticalAlign: TextVerticalAlign;
  declare contain: TextContain;
  declare maxWidth: number;
  declare maxHeight: number;
  declare maxLines: number;
  declare overflowSuffix: string;
  declare wordBreak: TextWordBreak;
  declare letterSpacing: number;
  declare offsetY: number;
  declare forceLoad: boolean;
  // The shader props (shader.ts): the raw objects, written to the node's
  // shader once parsed.
  declare border: BorderStyle | undefined;
  declare borderTop: SingleBorderStyle | undefined;
  declare borderRight: SingleBorderStyle | undefined;
  declare borderBottom: SingleBorderStyle | undefined;
  declare borderLeft: SingleBorderStyle | undefined;
  declare shadow: Record<string, unknown> | undefined;
  declare borderRadius: number | number[] | undefined;
  declare rounded: number | number[] | undefined;
  declare linearGradient: Record<string, unknown> | undefined;
  declare radialGradient: Record<string, unknown> | undefined;
  declare holePunch: Record<string, unknown> | undefined;
  declare shader:
    | ShaderNode
    | [type: string, props: Record<string, unknown>]
    | null
    | undefined;

  /**
   * A node on a new slot of `core` (a text slot for a `<text>`), or on
   * `slot` when given (fromSlot); it becomes the slot's owner.
   */
  constructor(core: RendererCore, type: ElementKind, slot?: number) {
    if (slot === undefined) {
      slot =
        type === NodeType.TextNode ? core.allocTextNode() : core.allocNode();
    }
    this.slot = slot;
    this.core = core;
    this._type = type;
    this.parent = undefined;
    this.children = [];
    this.rendered = false;
    this._set = new Uint8Array(SET_COUNT);
    this._states = undefined;
    this._style = undefined;
    this._theme = undefined;
    this._shader = undefined;
    this._shaderProps = undefined;
    this._shaderFeatures = SHADER_UNMANAGED;
    this._shaderKey = undefined;
    this._textProps = undefined;
    this._transition = undefined;
    this._animationSettings = undefined;
    this._onEvent = undefined;
    this._flexX = undefined;
    this._flexY = undefined;
    this._flexWidth = undefined;
    this._flexHeight = undefined;
    this._queueDelete = undefined;
    this._layoutDepth = undefined;
    this.display = undefined;
    this.direction = undefined;
    this.flexDirection = undefined;
    this.flexWrap = undefined;
    this.flexBoundary = undefined;
    this.flexCrossBoundary = undefined;
    this.flexGrow = undefined;
    this.flexShrink = undefined;
    this.flexBasis = undefined;
    this.flexOrder = undefined;
    this.flexItem = undefined;
    this.alignItems = undefined;
    this.alignSelf = undefined;
    this.justifyContent = undefined;
    this.gap = undefined;
    this.rowGap = undefined;
    this.columnGap = undefined;
    this.padding = undefined;
    this.paddingTop = undefined;
    this.paddingRight = undefined;
    this.paddingBottom = undefined;
    this.paddingLeft = undefined;
    this.margin = undefined;
    this.marginTop = undefined;
    this.marginRight = undefined;
    this.marginBottom = undefined;
    this.marginLeft = undefined;
    this._right = undefined;
    this._bottom = undefined;
    this._center = undefined;
    this._centerX = undefined;
    this._centerY = undefined;
    this._fontFamily = undefined;
    this._fontWeight = undefined;
    this.id = undefined;
    this.autofocus = undefined;
    this.forwardFocus = undefined;
    this.skipFocus = undefined;
    this.onCreate = undefined;
    this.onRender = undefined;
    this.onDestroy = undefined;
    this.onLayout = undefined;
    this.updateLayoutOn = undefined;
    this.onUp = undefined;
    this.onDown = undefined;
    this.onLeft = undefined;
    this.onRight = undefined;
    this.onEnter = undefined;
    this.onLast = undefined;
    this.onFocus = undefined;
    this.onFocusChanged = undefined;
    this.onBlur = undefined;
    this.onKeyPress = undefined;
    this.onAnimation = undefined;
    this._onEventProp = undefined;
    this._animationQueue = undefined;
    this._animationQueueSettings = undefined;
    this._animationRunning = false;
    this.forwardStates = undefined;
    this.stateOrder = undefined;
    this._undoStyles = undefined;
    this._undoCount = 0;
    this._applied = undefined;
    this._stateBlocks = undefined;
    core.nodes.handles[slot] = this;
  }

  // Styles and states (1.8's port; the helpers are styles.ts).

  get style(): Styles {
    return this._style || {};
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
    // A style object: its keys are strings.
    const source = style as Record<string, unknown>;
    const set = this._set;
    for (const key in source) {
      // `$state` blocks are read from the style (styles.ts stateBlock).
      if (key.charCodeAt(0) === 36 /* $ */) {
        continue;
      }
      // A prop the app wrote wins over the style (spec 5.3): its `_set`
      // byte, or, for a prop without one, a value other than undefined.
      const at = SET_INDEX[key];
      if (at !== undefined ? set[at] === 0 : readKey(this, key) === undefined) {
        writeKey(this, key, source[key]);
      }
    }
  }

  get theme(): Styles {
    this._theme = this._theme || {};
    return this._theme;
  }

  set theme(styles: Styles | undefined) {
    if (!styles) {
      return;
    }
    this._theme = styles;
    // A theme object: its keys are strings.
    const source = styles as Record<string, unknown>;
    for (const key in source) {
      if (key.charCodeAt(0) === 36 /* $ */) {
        // A `$` key is a block of the node's own, as 1.x wrote it; the
        // check above makes the key a DollarString.
        setStateBlock(this, key as DollarString, source[key]);
      } else {
        writeKey(this, key, source[key]);
      }
    }
  }

  get states(): States {
    let states = this._states;
    if (states === undefined) {
      states = new States(this._stateChanged.bind(this));
      this._states = states;
    }
    return states;
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
    // its falsy ones. (Inline on purpose: terser's default `reduce_funcs`
    // turns a single-use helper into a closure per call.)
    const len = current.length;
    let changed = false;
    if (Array.isArray(states)) {
      changed = states.length !== len;
      for (let i = 0; !changed && i < len; i++) {
        changed = states[i] !== current[i];
      }
    } else if (typeof states === 'string') {
      changed = len !== 1 || current[0] !== states;
    } else {
      for (const key in states) {
        // A NodeStates object's keys are DollarStrings.
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

  /**
   * Apply the `$state` blocks of the active states (design 3.3). The keys
   * any state wrote since the states were last empty are tracked in
   * `_undoStyles`, in first-write order; each takes its value from the
   * active block of highest precedence, else the base value (`theme`, then
   * `style`, then the prop's default: spec 5.3). After attach a key is
   * written only when that value differs from the one written last
   * (`_applied`); before, every key is written.
   */
  _stateChanged(): void {
    const states = this.states;

    if (this.forwardStates) {
      // Children first. They take this list: their setter copies it
      // (forwardStates overwrites their own states, pinned) and does nothing
      // when it is unchanged.
      const children = this.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i]!;
        if (child._type !== NodeType.Text) {
          child.states = states;
        }
      }
    }

    const n = states.length;
    if (this._undoCount === 0) {
      // Nothing to undo: done unless an active state has a block. This runs
      // on every path element of every focus change.
      let i = 0;
      while (i < n && stateBlock(this, states[i]!) === undefined) {
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
      // No prototype (a key named like an Object method is a key); the
      // record holds the values written.
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
   * winning (B18 is not fixed: spec 5.7).
   */
  _writeStates(n: number): void {
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
          writeKey(this, key, value);
          if (border) {
            borderWrites++;
          }
        }
      }
      if (borderWrites !== 0 && borderWrites !== borderKeys) {
        rewriteBorderKeys(this, count);
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
        count = trackKeys(stateBlock(this, states[i]!), keys, count, applied);
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
        count = trackKeys(
          stateBlock(this, states[pick]!),
          keys,
          count,
          applied,
        );
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
          writeKey(this, 'transition', value);
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
        writeKey(this, key, value);
        if (border) {
          borderWrites++;
        }
      }
    }
    if (borderWrites !== 0 && borderWrites !== borderKeys) {
      // The tracked count as it is now: a setter above may have changed the
      // states and tracked more keys.
      rewriteBorderKeys(this, this._undoCount);
    }
  }

  /** An ElementNode owning an existing slot (the root's, at startup). */
  static fromSlot(core: RendererCore, slot: number): ElementNode {
    return new ElementNode(core, NodeType.Element, slot);
  }

  /**
   * Let a transition take a write of `name`: true when it started or
   * retargeted an animation (the store is then written by the animation),
   * false when the caller writes the store.
   */
  _animate(name: StoreProp, value: number): boolean {
    const settings = transitionSettings(this, name);
    if (settings === undefined) {
      return false;
    }
    // The same settings object retargets the prop's controller: no
    // allocation. A new controller gets its stop hook once.
    const controller = animateSlotProp(this.core, this, name, value, settings);
    if (controller.onStop === null) {
      controller.onStop = stoppedHook(this, name);
    }
    const handlers = this.onAnimation;
    if (handlers !== undefined && handlers.animating !== undefined) {
      handlers.animating.call(this, name, value);
    }
    return true;
  }

  /**
   * An unstarted controller animating `props` with `settings` (else the
   * node's, else Config's); an inert one before attach.
   */
  animate(
    props: AnimateProps,
    settings?: AnimationSettings,
  ): IAnimationController {
    return animateNode(this, props, settings);
  }

  /** Queue an animation for `start`. */
  chain(props: AnimateProps, settings?: AnimationSettings): this {
    chainAnimation(this, props, settings);
    return this;
  }

  /** Run the `chain`ed animations in order; resolves when all have run. */
  start(): Promise<void> {
    return startChain(this);
  }

  /** Listen to a renderer event (`loaded`, `failed`, `freed`, ...). */
  on(name: string, fn: NodeEventHandler): void {
    let events = this._onEvent;
    if (events === undefined) {
      // No prototype: an event named like an Object method is no listener.
      events = Object.create(null) as Record<string, NodeEventHandler[]>;
      this._onEvent = events;
    }
    const list = events[name];
    if (list === undefined) {
      events[name] = [fn];
    } else {
      list.push(fn);
    }
  }

  /** Stop listening: removes one registration of `fn`. */
  off(name: string, fn: NodeEventHandler): void {
    const events = this._onEvent;
    if (events === undefined) {
      return;
    }
    const list = events[name];
    if (list === undefined) {
      return;
    }
    const at = list.indexOf(fn);
    if (at !== -1) {
      list.splice(at, 1);
    }
  }

  // SlotOwner (renderer SlotOwner.ts)

  hasListener(name: string): boolean {
    const events = this._onEvent;
    if (events === undefined) {
      return false;
    }
    const list = events[name];
    return list !== undefined && list.length > 0;
  }

  emit(name: string, data: unknown): void {
    const events = this._onEvent;
    if (events === undefined) {
      return;
    }
    const list = events[name];
    if (list === undefined) {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      // `this` is the node too, as 1.x registered `onEvent` handlers.
      list[i]!.call(this, this, data);
    }
  }

  removeAllListeners(): void {
    this._onEvent = undefined;
  }

  /**
   * Lay the text out now instead of in the next walk, so that `width` and
   * `height` read its size (the flex pass sizes by it). False on a
   * `<view>`, on a destroyed node, and while the font's description is
   * missing.
   */
  measureText(): boolean {
    if (this._type !== NodeType.TextNode || this.slot === NULL) {
      return false;
    }
    return this.core.textNodes.measure(this.slot);
  }

  /** The text of the string children of a `<text>`, joined. */
  getText(): string {
    const children = this.children;
    const len = children.length;
    if (len === 1) {
      return children[0]!.text;
    }
    let result = '';
    for (let i = 0; i < len; i++) {
      result += children[i]!.text;
    }
    return result;
  }

  /** The animation setter track's write: a plain store write. */
  writeProp(name: string, value: number): void {
    // The animation track writes the names of the props it animates: the
    // store props and the numeric text props (a name outside both falls
    // through setNow's default).
    this.setNow(name as StoreProp | TextNumberProp, value);
  }

  /**
   * Write a store prop now, without consulting `transition` and without
   * marking it as set by the app (`_set`): for the animation track, the
   * flex engine and the primitives that move nodes themselves.
   */
  setNow(name: StoreProp | TextNumberProp, value: number): void {
    const nodes = this.core.nodes;
    const s = this.slot;
    switch (name) {
      case 'x':
        setField(nodes, s, F_X, value, DIRTY_LOCAL);
        break;
      case 'y':
        setField(nodes, s, F_Y, value, DIRTY_LOCAL);
        break;
      case 'width':
        if (this._type === NodeType.TextNode) {
          writeTextWidth(this, value);
        } else {
          writeWidth(nodes, s, value);
        }
        break;
      case 'height':
        if (this._type === NodeType.TextNode) {
          writeTextHeight(this, value);
        } else {
          writeHeight(nodes, s, value);
        }
        break;
      case 'alpha':
        setField(nodes, s, F_ALPHA, value, DIRTY_ALPHA);
        break;
      case 'scale':
        setField(nodes, s, F_SCALE_X, value, DIRTY_LOCAL);
        setField(nodes, s, F_SCALE_Y, value, DIRTY_LOCAL);
        break;
      case 'scaleX':
        setField(nodes, s, F_SCALE_X, value, DIRTY_LOCAL);
        break;
      case 'scaleY':
        setField(nodes, s, F_SCALE_Y, value, DIRTY_LOCAL);
        break;
      case 'rotation':
        setField(nodes, s, F_ROTATION, value, DIRTY_LOCAL);
        break;
      case 'mount':
        setField(nodes, s, F_MOUNT_X, value, DIRTY_LOCAL);
        setField(nodes, s, F_MOUNT_Y, value, DIRTY_LOCAL);
        break;
      case 'mountX':
        setField(nodes, s, F_MOUNT_X, value, DIRTY_LOCAL);
        break;
      case 'mountY':
        setField(nodes, s, F_MOUNT_Y, value, DIRTY_LOCAL);
        break;
      case 'pivot':
        setField(nodes, s, F_PIVOT_X, value, DIRTY_LOCAL);
        setField(nodes, s, F_PIVOT_Y, value, DIRTY_LOCAL);
        break;
      case 'pivotX':
        setField(nodes, s, F_PIVOT_X, value, DIRTY_LOCAL);
        break;
      case 'pivotY':
        setField(nodes, s, F_PIVOT_Y, value, DIRTY_LOCAL);
        break;
      case 'zIndex':
        setZIndex(nodes, s, value);
        break;
      case 'color':
        setColor(nodes, s, I_COLOR_TL, value);
        setColor(nodes, s, I_COLOR_TR, value);
        setColor(nodes, s, I_COLOR_BL, value);
        setColor(nodes, s, I_COLOR_BR, value);
        break;
      case 'colorTop':
        setColor(nodes, s, I_COLOR_TL, value);
        setColor(nodes, s, I_COLOR_TR, value);
        break;
      case 'colorBottom':
        setColor(nodes, s, I_COLOR_BL, value);
        setColor(nodes, s, I_COLOR_BR, value);
        break;
      case 'colorLeft':
        setColor(nodes, s, I_COLOR_TL, value);
        setColor(nodes, s, I_COLOR_BL, value);
        break;
      case 'colorRight':
        setColor(nodes, s, I_COLOR_TR, value);
        setColor(nodes, s, I_COLOR_BR, value);
        break;
      case 'colorTl':
        setColor(nodes, s, I_COLOR_TL, value);
        break;
      case 'colorTr':
        setColor(nodes, s, I_COLOR_TR, value);
        break;
      case 'colorBl':
        setColor(nodes, s, I_COLOR_BL, value);
        break;
      case 'colorBr':
        setColor(nodes, s, I_COLOR_BR, value);
        break;
      case 'placeholderColor':
        writePlaceholderColor(nodes, s, value);
        break;
      case 'fontSize':
      case 'lineHeight':
      case 'maxWidth':
      case 'maxHeight':
      case 'maxLines':
      case 'letterSpacing':
      case 'offsetY':
        writeTextNumber(this, name, value);
        break;
      default:
        // Not a prop of ours: nothing to write.
        break;
    }
  }
}

installAccessors(ElementNode.prototype);
installTextAccessors(ElementNode.prototype);
installShaderAccessors(ElementNode.prototype);
installAnimationAccessors(ElementNode.prototype);
