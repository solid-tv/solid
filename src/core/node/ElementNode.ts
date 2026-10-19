import {
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
  type AnimationSettings,
  type ClippingValue,
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
import type {
  BorderStyle,
  SingleBorderStyle,
  Styles,
} from '../intrinsicTypes.js';
import { NodeType, type TextNode } from '../nodeTypes.js';
import type States from '../states.js';
import {
  installAccessors,
  writeHeight,
  writePlaceholderColor,
  writeTextHeight,
  writeTextWidth,
  writeWidth,
} from './accessors.js';
import { SET_COUNT, type StoreProp, type TextNumberProp } from './defaults.js';
import { installShaderAccessors, SHADER_UNMANAGED } from './shader.js';
import { installTextAccessors, writeTextNumber } from './textProps.js';

/** The two kinds of ElementNode: a `<view>` and a `<text>`. */
export type ElementKind = typeof NodeType.Element | typeof NodeType.TextNode;

/** A child of an ElementNode: an element, or a string inside a `<text>`. */
export type SolidNode = ElementNode | TextNode;

/** A listener of a renderer event (`loaded`, `inViewport`, ...). */
export type NodeEventHandler = (node: ElementNode, data: unknown) => void;

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
    core.nodes.handles[slot] = this;
  }

  /** An ElementNode owning an existing slot (the root's, at startup). */
  static fromSlot(core: RendererCore, slot: number): ElementNode {
    return new ElementNode(core, NodeType.Element, slot);
  }

  /**
   * Let a transition take a write of `name`: true when it started or
   * retargeted an animation (the store is then written by the animation).
   * Task 6 fills it in; until then every write is direct.
   */
  _animate(_name: StoreProp, _value: number): boolean {
    return false;
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
      list[i]!(this, data);
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
