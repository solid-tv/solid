import {
  absX,
  absY,
  DIR_INHERIT,
  DIR_RTL,
  DIRTY_ALPHA,
  DIRTY_COLOR,
  DIRTY_LOCAL,
  DIRTY_RENDERABLE,
  F_ALPHA,
  F_HEIGHT,
  F_MOUNT_X,
  F_MOUNT_Y,
  F_PIVOT_X,
  F_PIVOT_Y,
  F_ROTATION,
  F_SCALE_X,
  F_SCALE_Y,
  F_STRIDE,
  F_WIDTH,
  F_X,
  F_Y,
  F_Z_INDEX,
  I_COLOR_BL,
  I_COLOR_BR,
  I_COLOR_TL,
  I_COLOR_TR,
  I_DIRECTION,
  I_PLACEHOLDER_COLOR,
  I_STATE,
  I_STRIDE,
  NULL,
  ST_CLIPS,
  setClipping,
  setColor,
  setData,
  setField,
  setRtl,
  setSrc,
  setTexture,
  setTextureOptions,
  setZIndex,
  type ClippingValue,
  type NodeStore,
  type Texture,
  type TextureOptions,
} from '@solidtv/renderer';
import type { ElementNode } from './ElementNode.js';
import {
  DEFAULT,
  EMPTY_TEXTURE_OPTIONS,
  SET_ALPHA,
  SET_CLIPPING,
  SET_COLOR,
  SET_COLOR_BL,
  SET_COLOR_BOTTOM,
  SET_COLOR_BR,
  SET_COLOR_LEFT,
  SET_COLOR_RIGHT,
  SET_COLOR_TL,
  SET_COLOR_TOP,
  SET_COLOR_TR,
  SET_DATA,
  SET_HEIGHT,
  SET_MOUNT,
  SET_MOUNT_X,
  SET_MOUNT_Y,
  SET_PIVOT,
  SET_PIVOT_X,
  SET_PIVOT_Y,
  SET_PLACEHOLDER_COLOR,
  SET_ROTATION,
  SET_RTL,
  SET_SCALE,
  SET_SCALE_X,
  SET_SCALE_Y,
  SET_SRC,
  SET_TEXTURE,
  SET_TEXTURE_OPTIONS,
  SET_WIDTH,
  SET_X,
  SET_Y,
  SET_Z_INDEX,
} from './defaults.js';

// Store writes that take more than one binding call, shared by the
// accessors and ElementNode.setNow. Each mirrors the renderer handle's
// setter of the same prop (renderer src/core/nodes/Node.ts).

/** `width`: every size write goes through applySize (DIRTY_SHADER too). */
export function writeWidth(nodes: NodeStore, slot: number, v: number): void {
  if (slot === NULL) {
    return;
  }
  nodes.applySize(slot, v, nodes.f64[slot * F_STRIDE + F_HEIGHT]!);
}

/** `height`: every size write goes through applySize (DIRTY_SHADER too). */
export function writeHeight(nodes: NodeStore, slot: number, v: number): void {
  if (slot === NULL) {
    return;
  }
  nodes.applySize(slot, nodes.f64[slot * F_STRIDE + F_WIDTH]!, v);
}

/**
 * `placeholderColor`: also DIRTY_RENDERABLE, which setColor does not raise.
 * Coerced before comparing, as setColor does.
 */
export function writePlaceholderColor(
  nodes: NodeStore,
  slot: number,
  v: number,
): void {
  if (slot === NULL) {
    return;
  }
  const uv = v >>> 0;
  const i = slot * I_STRIDE + I_PLACEHOLDER_COLOR;
  if (nodes.u32[i] === uv) {
    return;
  }
  nodes.u32[i] = uv;
  nodes.markDirty(slot, DIRTY_COLOR | DIRTY_RENDERABLE);
}

// One accessor per prop, written out (the 1.8 shape, spec 5.1): each getter
// and setter loads or stores one constant offset, so each has its own
// inline cache; a loop-made accessor would see every name at one site.
// Written out rather than made with `new Function`, which a TV app's CSP
// may forbid.
//
// Every setter returns on a destroyed node (slot NULL), records that the
// app set the prop (`_set`, spec 5.3), then, for an animatable prop, lets a
// transition take the write (`_animate`) before storing it. Every getter
// reads DEFAULT on a destroyed node.
//
// `this: ElementNode` on each function: Object.defineProperties types a
// descriptor's `this` as `any`; annotating it keeps the bodies checked.

/**
 * Install the store accessors on `proto` (ElementNode.prototype). A
 * function rather than an import side effect: this module would otherwise
 * import ElementNode at runtime and form a cycle with it.
 */
export function installAccessors(proto: ElementNode): void {
  Object.defineProperties(proto, {
    // Position and size
    x: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.x
          : this.core.nodes.f64[s * F_STRIDE + F_X]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_X] = 1;
        if (this._transition === undefined || !this._animate('x', v)) {
          setField(this.core.nodes, s, F_X, v, DIRTY_LOCAL);
        }
      },
    },
    y: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.y
          : this.core.nodes.f64[s * F_STRIDE + F_Y]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_Y] = 1;
        if (this._transition === undefined || !this._animate('y', v)) {
          setField(this.core.nodes, s, F_Y, v, DIRTY_LOCAL);
        }
      },
    },
    width: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.width
          : this.core.nodes.f64[s * F_STRIDE + F_WIDTH]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_WIDTH] = 1;
        if (this._transition === undefined || !this._animate('width', v)) {
          writeWidth(this.core.nodes, s, v);
        }
      },
    },
    height: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.height
          : this.core.nodes.f64[s * F_STRIDE + F_HEIGHT]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_HEIGHT] = 1;
        if (this._transition === undefined || !this._animate('height', v)) {
          writeHeight(this.core.nodes, s, v);
        }
      },
    },

    alpha: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.alpha
          : this.core.nodes.f64[s * F_STRIDE + F_ALPHA]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_ALPHA] = 1;
        if (this._transition === undefined || !this._animate('alpha', v)) {
          setField(this.core.nodes, s, F_ALPHA, v, DIRTY_ALPHA);
        }
      },
    },

    // Scale: `scale` writes both and reads scaleX (the handle's rule).
    scale: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.scale
          : this.core.nodes.f64[s * F_STRIDE + F_SCALE_X]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_SCALE] = 1;
        if (this._transition === undefined || !this._animate('scale', v)) {
          const nodes = this.core.nodes;
          setField(nodes, s, F_SCALE_X, v, DIRTY_LOCAL);
          setField(nodes, s, F_SCALE_Y, v, DIRTY_LOCAL);
        }
      },
    },
    scaleX: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.scaleX
          : this.core.nodes.f64[s * F_STRIDE + F_SCALE_X]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_SCALE_X] = 1;
        if (this._transition === undefined || !this._animate('scaleX', v)) {
          setField(this.core.nodes, s, F_SCALE_X, v, DIRTY_LOCAL);
        }
      },
    },
    scaleY: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.scaleY
          : this.core.nodes.f64[s * F_STRIDE + F_SCALE_Y]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_SCALE_Y] = 1;
        if (this._transition === undefined || !this._animate('scaleY', v)) {
          setField(this.core.nodes, s, F_SCALE_Y, v, DIRTY_LOCAL);
        }
      },
    },

    rotation: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.rotation
          : this.core.nodes.f64[s * F_STRIDE + F_ROTATION]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_ROTATION] = 1;
        if (this._transition === undefined || !this._animate('rotation', v)) {
          setField(this.core.nodes, s, F_ROTATION, v, DIRTY_LOCAL);
        }
      },
    },

    // Mount: `mount` writes both and reads mountX (the handle's rule).
    mount: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.mount
          : this.core.nodes.f64[s * F_STRIDE + F_MOUNT_X]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_MOUNT] = 1;
        if (this._transition === undefined || !this._animate('mount', v)) {
          const nodes = this.core.nodes;
          setField(nodes, s, F_MOUNT_X, v, DIRTY_LOCAL);
          setField(nodes, s, F_MOUNT_Y, v, DIRTY_LOCAL);
        }
      },
    },
    mountX: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.mountX
          : this.core.nodes.f64[s * F_STRIDE + F_MOUNT_X]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_MOUNT_X] = 1;
        if (this._transition === undefined || !this._animate('mountX', v)) {
          setField(this.core.nodes, s, F_MOUNT_X, v, DIRTY_LOCAL);
        }
      },
    },
    mountY: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.mountY
          : this.core.nodes.f64[s * F_STRIDE + F_MOUNT_Y]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_MOUNT_Y] = 1;
        if (this._transition === undefined || !this._animate('mountY', v)) {
          setField(this.core.nodes, s, F_MOUNT_Y, v, DIRTY_LOCAL);
        }
      },
    },

    // Pivot: `pivot` writes both and reads pivotX (the handle's rule).
    pivot: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.pivot
          : this.core.nodes.f64[s * F_STRIDE + F_PIVOT_X]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_PIVOT] = 1;
        if (this._transition === undefined || !this._animate('pivot', v)) {
          const nodes = this.core.nodes;
          setField(nodes, s, F_PIVOT_X, v, DIRTY_LOCAL);
          setField(nodes, s, F_PIVOT_Y, v, DIRTY_LOCAL);
        }
      },
    },
    pivotX: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.pivotX
          : this.core.nodes.f64[s * F_STRIDE + F_PIVOT_X]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_PIVOT_X] = 1;
        if (this._transition === undefined || !this._animate('pivotX', v)) {
          setField(this.core.nodes, s, F_PIVOT_X, v, DIRTY_LOCAL);
        }
      },
    },
    pivotY: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.pivotY
          : this.core.nodes.f64[s * F_STRIDE + F_PIVOT_Y]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_PIVOT_Y] = 1;
        if (this._transition === undefined || !this._animate('pivotY', v)) {
          setField(this.core.nodes, s, F_PIVOT_Y, v, DIRTY_LOCAL);
        }
      },
    },

    zIndex: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.zIndex
          : this.core.nodes.f64[s * F_STRIDE + F_Z_INDEX]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_Z_INDEX] = 1;
        if (this._transition === undefined || !this._animate('zIndex', v)) {
          setZIndex(this.core.nodes, s, v);
        }
      },
    },

    // Colours (RGBA, the u32 view). `color` writes the four corners and
    // reads the top-left one; each side pair reads its first corner.
    color: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.color
          : this.core.nodes.u32[s * I_STRIDE + I_COLOR_TL]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_COLOR] = 1;
        if (this._transition === undefined || !this._animate('color', v)) {
          const nodes = this.core.nodes;
          setColor(nodes, s, I_COLOR_TL, v);
          setColor(nodes, s, I_COLOR_TR, v);
          setColor(nodes, s, I_COLOR_BL, v);
          setColor(nodes, s, I_COLOR_BR, v);
        }
      },
    },
    colorTop: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.colorTop
          : this.core.nodes.u32[s * I_STRIDE + I_COLOR_TL]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_COLOR_TOP] = 1;
        if (this._transition === undefined || !this._animate('colorTop', v)) {
          const nodes = this.core.nodes;
          setColor(nodes, s, I_COLOR_TL, v);
          setColor(nodes, s, I_COLOR_TR, v);
        }
      },
    },
    colorBottom: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.colorBottom
          : this.core.nodes.u32[s * I_STRIDE + I_COLOR_BL]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_COLOR_BOTTOM] = 1;
        if (
          this._transition === undefined ||
          !this._animate('colorBottom', v)
        ) {
          const nodes = this.core.nodes;
          setColor(nodes, s, I_COLOR_BL, v);
          setColor(nodes, s, I_COLOR_BR, v);
        }
      },
    },
    colorLeft: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.colorLeft
          : this.core.nodes.u32[s * I_STRIDE + I_COLOR_TL]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_COLOR_LEFT] = 1;
        if (this._transition === undefined || !this._animate('colorLeft', v)) {
          const nodes = this.core.nodes;
          setColor(nodes, s, I_COLOR_TL, v);
          setColor(nodes, s, I_COLOR_BL, v);
        }
      },
    },
    colorRight: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.colorRight
          : this.core.nodes.u32[s * I_STRIDE + I_COLOR_TR]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_COLOR_RIGHT] = 1;
        if (this._transition === undefined || !this._animate('colorRight', v)) {
          const nodes = this.core.nodes;
          setColor(nodes, s, I_COLOR_TR, v);
          setColor(nodes, s, I_COLOR_BR, v);
        }
      },
    },
    colorTl: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.colorTl
          : this.core.nodes.u32[s * I_STRIDE + I_COLOR_TL]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_COLOR_TL] = 1;
        if (this._transition === undefined || !this._animate('colorTl', v)) {
          setColor(this.core.nodes, s, I_COLOR_TL, v);
        }
      },
    },
    colorTr: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.colorTr
          : this.core.nodes.u32[s * I_STRIDE + I_COLOR_TR]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_COLOR_TR] = 1;
        if (this._transition === undefined || !this._animate('colorTr', v)) {
          setColor(this.core.nodes, s, I_COLOR_TR, v);
        }
      },
    },
    colorBl: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.colorBl
          : this.core.nodes.u32[s * I_STRIDE + I_COLOR_BL]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_COLOR_BL] = 1;
        if (this._transition === undefined || !this._animate('colorBl', v)) {
          setColor(this.core.nodes, s, I_COLOR_BL, v);
        }
      },
    },
    colorBr: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.colorBr
          : this.core.nodes.u32[s * I_STRIDE + I_COLOR_BR]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_COLOR_BR] = 1;
        if (this._transition === undefined || !this._animate('colorBr', v)) {
          setColor(this.core.nodes, s, I_COLOR_BR, v);
        }
      },
    },

    // Not animatable from here on.
    placeholderColor: {
      get(this: ElementNode): number {
        const s = this.slot;
        return s === NULL
          ? DEFAULT.placeholderColor
          : this.core.nodes.u32[s * I_STRIDE + I_PLACEHOLDER_COLOR]!;
      },
      set(this: ElementNode, v: number) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_PLACEHOLDER_COLOR] = 1;
        writePlaceholderColor(this.core.nodes, s, v);
      },
    },

    clipping: {
      get(this: ElementNode): ClippingValue {
        const s = this.slot;
        if (s === NULL) {
          return false;
        }
        const nodes = this.core.nodes;
        const margins = nodes.clipMargins[s];
        if (margins !== null && margins !== undefined) {
          // The store keeps the margins array setClipping was given, which
          // is the four-number tuple of ClippingValue.
          return margins as [number, number, number, number];
        }
        return (nodes.u32[s * I_STRIDE + I_STATE]! & ST_CLIPS) !== 0;
      },
      set(this: ElementNode, v: ClippingValue) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_CLIPPING] = 1;
        setClipping(this.core.nodes, s, v);
      },
    },

    // The own layout direction: true rtl, false ltr, null inherit.
    rtl: {
      get(this: ElementNode): boolean | null {
        const s = this.slot;
        if (s === NULL) {
          return null;
        }
        const own = this.core.nodes.i32[s * I_STRIDE + I_DIRECTION]!;
        return own === DIR_INHERIT ? null : own === DIR_RTL;
      },
      set(this: ElementNode, v: boolean | null | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_RTL] = 1;
        setRtl(this.core.nodes, s, v === undefined ? null : v);
      },
    },

    // A live node always has a data object: the first read stores `{}`
    // (the handle's rule), so app code writes into it without making one.
    data: {
      get(this: ElementNode): Record<string, unknown> | null {
        const s = this.slot;
        if (s === NULL) {
          return null;
        }
        const nodes = this.core.nodes;
        // The store keeps what the data setter stored: a record or null.
        let d = nodes.data[s] as Record<string, unknown> | null | undefined;
        if (d === null || d === undefined) {
          d = {};
          nodes.data[s] = d;
        }
        return d;
      },
      set(this: ElementNode, v: Record<string, unknown> | null | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_DATA] = 1;
        setData(this.core.nodes, s, v === undefined ? null : v);
      },
    },

    // Texture inputs. A string src on an attached node with no colour
    // shows the image white; clearing src makes the node transparent
    // (today's src rule, elementNode.ts's src setter).
    src: {
      get(this: ElementNode): string | null {
        const s = this.slot;
        if (s === NULL) {
          return null;
        }
        const src = this.core.nodes.srcs[s];
        return src === undefined ? null : src;
      },
      set(this: ElementNode, v: string | null | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_SRC] = 1;
        if (typeof v === 'string') {
          setSrc(this.core, s, v);
          // "No colour" is a top-left corner of 0, what `!this.color` read
          // before: an unset colour reads 0 once attach defaulted it, and
          // a gradient set through the corner props is left alone.
          if (
            this.rendered &&
            this.core.nodes.u32[s * I_STRIDE + I_COLOR_TL] === 0
          ) {
            this.color = 0xffffffff;
          }
        } else {
          setSrc(this.core, s, null);
          this.color = 0x00000000;
        }
      },
    },
    texture: {
      get(this: ElementNode): Texture | null {
        const s = this.slot;
        if (s === NULL) {
          return null;
        }
        // The store keeps what the texture setter stored: a Texture or null.
        const t = this.core.nodes.textureRefs[s] as Texture | null | undefined;
        return t === undefined ? null : t;
      },
      set(this: ElementNode, v: Texture | null | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_TEXTURE] = 1;
        setTexture(this.core, s, v === undefined ? null : v);
      },
    },
    textureOptions: {
      get(this: ElementNode): TextureOptions {
        const s = this.slot;
        if (s === NULL) {
          return EMPTY_TEXTURE_OPTIONS;
        }
        // The store keeps what the textureOptions setter stored.
        const o = this.core.nodes.textureOptions[s] as
          | TextureOptions
          | null
          | undefined;
        return o === null || o === undefined ? EMPTY_TEXTURE_OPTIONS : o;
      },
      set(this: ElementNode, v: TextureOptions | null | undefined) {
        const s = this.slot;
        if (s === NULL) {
          return;
        }
        this._set[SET_TEXTURE_OPTIONS] = 1;
        setTextureOptions(this.core, s, v === undefined ? null : v);
      },
    },

    // The world position as of the last update (0 on a destroyed node).
    absX: {
      get(this: ElementNode): number {
        return absX(this.core.nodes, this.slot);
      },
    },
    absY: {
      get(this: ElementNode): number {
        return absY(this.core.nodes, this.slot);
      },
    },

    // Shortcuts (spec 5.3).
    hidden: {
      get(this: ElementNode): boolean {
        return this.alpha === 0;
      },
      set(this: ElementNode, v: boolean) {
        this.alpha = v ? 0 : 1;
      },
    },
    // Placement requests, resolved once against the parent's size by
    // attach (into x/y and mountX/mountY), not reactive afterwards. They
    // mark the props they resolve to as set.
    right: {
      get(this: ElementNode): number | undefined {
        return this._right;
      },
      set(this: ElementNode, v: number | undefined) {
        this._right = v;
        this._set[SET_X] = 1;
        this._set[SET_MOUNT_X] = 1;
      },
    },
    bottom: {
      get(this: ElementNode): number | undefined {
        return this._bottom;
      },
      set(this: ElementNode, v: number | undefined) {
        this._bottom = v;
        this._set[SET_Y] = 1;
        this._set[SET_MOUNT_Y] = 1;
      },
    },
    center: {
      get(this: ElementNode): boolean | undefined {
        return this._center;
      },
      set(this: ElementNode, v: boolean | undefined) {
        this._center = v;
        const set = this._set;
        set[SET_X] = 1;
        set[SET_MOUNT_X] = 1;
        set[SET_Y] = 1;
        set[SET_MOUNT_Y] = 1;
      },
    },
    centerX: {
      get(this: ElementNode): boolean | undefined {
        return this._centerX;
      },
      set(this: ElementNode, v: boolean | undefined) {
        this._centerX = v;
        this._set[SET_X] = 1;
        this._set[SET_MOUNT_X] = 1;
      },
    },
    centerY: {
      get(this: ElementNode): boolean | undefined {
        return this._centerY;
      },
      set(this: ElementNode, v: boolean | undefined) {
        this._centerY = v;
        this._set[SET_Y] = 1;
        this._set[SET_MOUNT_Y] = 1;
      },
    },
  });
}
