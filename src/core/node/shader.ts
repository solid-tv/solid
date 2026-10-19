import {
  createAnimation,
  NULL,
  setShader,
  type AdvancedProp,
  type ShaderNode,
} from '@solidtv/renderer';
import { Config } from '../config.js';
import { SHADERS_ENABLED } from '../env.js';
import type {
  AnimationSettings,
  BorderStyle,
  SingleBorderStyle,
} from '../intrinsicTypes.js';
import { transitionSettings } from './animation.js';
import type { ElementNode } from './ElementNode.js';
import {
  SET_BORDER,
  SET_BORDER_BOTTOM,
  SET_BORDER_LEFT,
  SET_BORDER_RADIUS,
  SET_BORDER_RIGHT,
  SET_BORDER_TOP,
  SET_HOLE_PUNCH,
  SET_LINEAR_GRADIENT,
  SET_RADIAL_GRADIENT,
  SET_SHADER,
  SET_SHADOW,
} from './defaults.js';

// The shader props (spec 5.4). A write stores the app's object in
// `node._shaderProps` under the accessor's name (for the getter and for
// style undo), parses it once per object identity into the facade's
// flattened keys (`shaderParse`), merges those keys into the same bag (under
// their facade names, `border-width`, `radius`: a shader keeps only the
// props its type declares, so what a swapped-in type needs must be kept
// here), and writes them to the node's ShaderNode facade. The raw object is
// not written to the shader.
//
// The rounded family (`rounded`, `roundedWithBorder`, `roundedWithShadow`,
// `roundedWithBorderWithShadow`) is made by `convertToShader`, from the
// feature bits of what `_shaderProps` holds: at attach, or on the first
// shader prop written after it. A border width crossing 0 swaps the type
// (`syncShaderType`). `linearGradient`, `radialGradient`, `holePunch` and
// `shader` make their shader at once and replace the node's.

/** The raw shader prop objects, by the accessor that wrote them. */
type ShaderKey =
  | 'border'
  | 'borderTop'
  | 'borderRight'
  | 'borderBottom'
  | 'borderLeft'
  | 'shadow'
  | 'rounded'
  | 'linearGradient'
  | 'radialGradient'
  | 'holePunch';

/**
 * `_shaderFeatures` while the node's shader is not one convertToShader made
 * (none yet, or a gradient, `holePunch` or `shader`): never swapped.
 */
export const SHADER_UNMANAGED = -1;

/** A border or shadow object as facade props, in the order they are written. */
export interface ShaderParse {
  /** One facade key per key of the object (`border-width`, `shadow-blur`). */
  readonly keys: string[];
  readonly values: unknown[];
  /** False when the object has a getter: parsed again on each write. */
  readonly cached: boolean;
}

/** A border side's width key. */
const BORDER_SIDES: Record<string, string | undefined> = {
  borderTop: 'top',
  borderRight: 'right',
  borderBottom: 'bottom',
  borderLeft: 'left',
};

/** One parse cache per style key: the same object parses differently under each. */
const shaderParses: Record<string, WeakMap<object, ShaderParse>> = {
  border: new WeakMap(),
  borderTop: new WeakMap(),
  borderRight: new WeakMap(),
  borderBottom: new WeakMap(),
  borderLeft: new WeakMap(),
  shadow: new WeakMap(),
};

function isGetter(obj: object, key: string): boolean {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  return desc !== undefined && desc.get !== undefined;
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

/**
 * The facade props a `border`, `borderTop`/`Right`/`Bottom`/`Left` or
 * `shadow` object stands for: `<prefix>-<key>` per key, with `w` written
 * `width` (a side's width is the side: `border-top`). Parsed once per
 * object identity (1.8's `shaderParse`; `width` is `border-width` here, not
 * `border-w`). `key` is one of the six style keys that take a border or
 * shadow object.
 */
export function shaderParse(key: string, obj: object): ShaderParse {
  const cache = shaderParses[key];
  let parse = cache !== undefined ? cache.get(obj) : undefined;
  if (parse !== undefined) {
    return parse;
  }
  const side = BORDER_SIDES[key];
  const prefix = side !== undefined ? 'border' : key;
  const keys: string[] = [];
  const values: unknown[] = [];
  // The position of each facade key, to merge `width` and `w`.
  const index = Object.create(null) as Record<string, number | undefined>;
  // The keys of a plain object the app wrote, which `obj` is for a border or
  // shadow: read by name, as a getter on it is read once per parse.
  // `obj` is a border or shadow object the app wrote: its keys are strings.
  const source = obj as Record<string, unknown>;
  let cached = true;
  const own = Object.keys(obj);
  for (let i = 0; i < own.length; i++) {
    const name = own[i]!;
    if (isGetter(obj, name)) {
      cached = false;
    }
    let sub = name === 'w' ? 'width' : name;
    if (side !== undefined && sub === 'width') {
      sub = side;
    }
    const facadeKey = prefix + '-' + sub;
    const at = index[facadeKey];
    if (at !== undefined) {
      // `width` and `w` both given: the later one wins, as it did.
      values[at] = source[name];
    } else {
      index[facadeKey] = keys.length;
      keys.push(facadeKey);
      values.push(source[name]);
    }
  }
  parse = { keys, values, cached };
  if (cached && cache !== undefined) {
    cache.set(obj, parse);
  }
  return parse;
}

// The shader types convertToShader makes, by feature bits.
const BORDER_FEATURE = 1;
const SHADOW_FEATURE = 2;
const ROUNDED_SHADER_TYPES = [
  'rounded',
  'roundedWithBorder',
  'roundedWithShadow',
  'roundedWithBorderWithShadow',
];

/** The facade keys that hold a border width. */
const BORDER_WIDTH_KEYS = [
  'border-width',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
];

/** Whether a border width (a number or an array of them) is above 0. */
function positive(w: unknown): boolean {
  if (Array.isArray(w)) {
    for (let i = 0; i < w.length; i++) {
      // A width array holds numbers.
      if ((w[i] as number) > 0) {
        return true;
      }
    }
    return false;
  }
  // A width is a number (a string or undefined compares false).
  return (w as number) > 0;
}

/**
 * Whether a border width is above 0: read from `change` where it has the
 * key (the values an animation moves to), else from the bag. A border of
 * width 0 needs no border shader.
 */
function hasBorderWidth(
  bag: Record<string, unknown>,
  change?: Record<string, unknown>,
): boolean {
  for (let i = 0; i < BORDER_WIDTH_KEYS.length; i++) {
    const key = BORDER_WIDTH_KEYS[i]!;
    if (
      positive(change !== undefined && key in change ? change[key] : bag[key])
    ) {
      return true;
    }
  }
  return false;
}

/** The raw keys of the rounded family. */
const ROUNDED_KEYS = [
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'shadow',
  'rounded',
] as const;

/** Whether the bag holds a raw prop of the rounded family. */
function hasRoundedProps(bag: Record<string, unknown>): boolean {
  for (let i = 0; i < ROUNDED_KEYS.length; i++) {
    const v = bag[ROUNDED_KEYS[i]!];
    if (v !== undefined && v !== null) {
      return true;
    }
  }
  return false;
}

/**
 * Keys of the last parse whose value the bag did not hold: the positions in
 * `parse.keys`, the first `changedCount` entries of a scratch array, so a
 * write allocates nothing (a write runs to its end before the next starts).
 * A count, not the array's length: `length = 0` drops an array's store, and
 * the next push allocated a new one (76 bytes) on every merge.
 */
const CHANGED: number[] = [];
let changedCount = 0;

/**
 * Merge what a rounded-family object stands for into the bag's facade keys,
 * as the facade write does: a key the object does not name keeps its value,
 * so a `$focus` border of `{ width: 4 }` keeps the base border's colour.
 * Fills CHANGED (changedCount) with the keys whose value differs from what
 * the bag held.
 */
function mergeIntoBag(
  bag: Record<string, unknown>,
  key: ShaderKey,
  value: unknown,
  parse: ShaderParse | undefined,
): void {
  changedCount = 0;
  if (key === 'rounded') {
    if (value !== undefined && value !== null && bag.radius !== value) {
      bag.radius = value;
      CHANGED[changedCount++] = 0;
    }
    return;
  }
  if (parse === undefined) {
    return;
  }
  const keys = parse.keys;
  const values = parse.values;
  for (let i = 0; i < keys.length; i++) {
    if (bag[keys[i]!] !== values[i]) {
      bag[keys[i]!] = values[i];
      CHANGED[changedCount++] = i;
    }
  }
}

/** Make `shader` the node's shader (null: none). */
function useShader(node: ElementNode, shader: ShaderNode | null): void {
  node._shader = shader === null ? undefined : shader;
  setShader(node.core, node.slot, shader);
}

/**
 * Make the rounded-family shader of what `_shaderProps` holds and give it to
 * the node: what attach calls when the node has shader props and no shader
 * (through `Config.convertToShader`), and the first shader prop written
 * after attach. Does nothing with no rounded-family prop set.
 */
export function convertToShader(node: ElementNode): void {
  const bag = node._shaderProps;
  if (bag === undefined || node.slot === NULL || !hasRoundedProps(bag)) {
    return;
  }
  const features =
    (hasBorderWidth(bag) ? BORDER_FEATURE : 0) |
    (bag.shadow ? SHADOW_FEATURE : 0);
  // The bag is the props: createShader reads the keys the type declares.
  const shader = node.core.createShader(ROUNDED_SHADER_TYPES[features]!, bag);
  if (shader === null) {
    return;
  }
  node._shaderFeatures = features;
  node._shaderKey = undefined;
  useShader(node, shader);
}

/** The bag keys of the rounded family's raw objects (`rounded` is `borderRadius`). */
export type RoundedKey = (typeof ROUNDED_KEYS)[number];

/** The border family's raw keys, `border` first: the order they re-merge in. */
const BORDER_KEYS = [
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
] as const;

/**
 * Take a rounded-family prop off the node: its setter's `undefined` write
 * (a style undo with no base value writes that). Merging `undefined` would
 * leave the facade keys the last object stood for in the bag; here they are
 * cleared with the raw object, the border family's other objects are merged
 * in again (`border` first, then the sides) so a key one of them names
 * keeps its value, and the node's rounded shader is made again from the
 * bag, so a cleared key takes its shader type's default (none is left: no
 * shader). B18 stays: this is the only path that clears a key.
 */
export function resetShaderProp(node: ElementNode, key: RoundedKey): void {
  const bag = node._shaderProps;
  if (bag === undefined || node.slot === NULL) {
    return;
  }
  const previous = bag[key];
  bag[key] = undefined;
  if (key === 'rounded') {
    bag.radius = undefined;
  } else if (isObject(previous)) {
    const keys = shaderParse(key, previous).keys;
    for (let i = 0; i < keys.length; i++) {
      bag[keys[i]!] = undefined;
    }
    if (key !== 'shadow') {
      for (let i = 0; i < BORDER_KEYS.length; i++) {
        const sibling = BORDER_KEYS[i]!;
        const obj = bag[sibling];
        if (isObject(obj)) {
          mergeIntoBag(bag, sibling, obj, shaderParse(sibling, obj));
        }
      }
    }
  }
  if (!SHADERS_ENABLED || node._shaderFeatures === SHADER_UNMANAGED) {
    // No shader yet (attach makes it from the bag), or one the app made.
    return;
  }
  if (!hasRoundedProps(bag)) {
    node._shaderFeatures = SHADER_UNMANAGED;
    useShader(node, null);
    return;
  }
  // createShader gives every key the bag holds no value for its default.
  convertToShader(node);
}

/**
 * Swap the shader convertToShader made when a border width moves to or from
 * 0. For an animated write, `change` holds what animates (facade keys to
 * their values): a border it adds is swapped in before the animation reads
 * its start values, one it removes stays until the animation stops (call it
 * again without `change`). A shader the app made (`shader`, a gradient) is
 * never swapped.
 */
export function syncShaderType(
  node: ElementNode,
  change?: Record<string, unknown>,
): void {
  const bag = node._shaderProps;
  const features = node._shaderFeatures;
  if (bag === undefined || features === SHADER_UNMANAGED) {
    return;
  }
  let next = bag.shadow ? SHADOW_FEATURE : 0;
  if (hasBorderWidth(bag, change)) {
    next |= BORDER_FEATURE;
  } else if (change !== undefined) {
    next |= features & BORDER_FEATURE;
  }
  if (next === features) {
    return;
  }
  const shader = node.core.createShader(ROUNDED_SHADER_TYPES[next]!, bag);
  if (shader === null) {
    return;
  }
  node._shaderFeatures = next;
  useShader(node, shader);
}

/**
 * Write what `value` stands for to the facade of a shader the app made, which
 * the bag was not built into: only what differs from what it reads back.
 */
function writeFacade(
  shader: ShaderNode,
  key: ShaderKey,
  value: unknown,
  parse: ShaderParse | undefined,
): void {
  const props = shader.props;
  if (key === 'rounded') {
    if (value !== undefined && value !== null && props.radius !== value) {
      props.radius = value;
    }
    return;
  }
  if (parse === undefined) {
    return;
  }
  const keys = parse.keys;
  const values = parse.values;
  for (let i = 0; i < keys.length; i++) {
    if (props[keys[i]!] !== values[i]) {
      props[keys[i]!] = values[i];
    }
  }
}

/** The bag of a node's raw shader objects; the first write makes it. */
function bagOf(node: ElementNode): Record<string, unknown> {
  let bag = node._shaderProps;
  if (bag === undefined) {
    bag = {};
    node._shaderProps = bag;
  }
  return bag;
}

/**
 * A transitioned write of a rounded-family prop to a node that has its
 * shader: the facade keys whose value changes animate through the
 * renderer's shader track instead of being written. The changed keys are
 * read against the bag before the merge (against the facade for a shader
 * the app made), so a border this write adds is swapped in from the old
 * values and animates from them; one it removes stays until the animation
 * stops, whose `onStop` swaps the type to what the bag (merged now, for the
 * getter and a later swap) says.
 */
function animateRounded(
  node: ElementNode,
  shader: ShaderNode,
  key: ShaderKey,
  value: unknown,
  parse: ShaderParse | undefined,
  settings: AnimationSettings,
): void {
  const bag = node._shaderProps!;
  const managed = node._shaderFeatures !== SHADER_UNMANAGED;
  const current = managed ? bag : shader.props;
  const change: Record<string, unknown> = {};
  let changed = false;
  if (key === 'rounded') {
    if (value !== undefined && value !== null && current.radius !== value) {
      change.radius = value;
      changed = true;
    }
  } else if (parse !== undefined) {
    for (let i = 0; i < parse.keys.length; i++) {
      const k = parse.keys[i]!;
      if (current[k] !== parse.values[i]) {
        change[k] = parse.values[i];
        changed = true;
      }
    }
  }
  if (managed) {
    syncShaderType(node, change);
  }
  mergeIntoBag(bag, key, value, parse);
  if (!changed) {
    return;
  }
  const animation = createAnimation(
    node.core,
    node,
    { shaderProps: change },
    settings,
  );
  if (managed) {
    animation.onStop = () => syncShaderType(node);
  }
  animation.start();
}

/**
 * `border`, a side, `shadow`, `borderRadius`: store the object, merge its
 * parse into the bag, then reach the facade with the keys that changed (or
 * animate them, under a transition: animateRounded).
 * Before attach (no shader yet, not rendered) the object only waits in the
 * bag for convertToShader. A shader convertToShader made was built from the
 * bag, so a key the bag held already is on it: writing the same object again
 * touches nothing (a facade write repacks every node using the shader).
 */
function writeRounded(node: ElementNode, key: ShaderKey, value: unknown): void {
  const bag = bagOf(node);
  bag[key] = value;
  // One parse per write (a getter object's getters run once).
  const parse =
    key !== 'rounded' && isObject(value) ? shaderParse(key, value) : undefined;
  const shader = node._shader;
  if (
    SHADERS_ENABLED &&
    shader !== undefined &&
    node._transition !== undefined
  ) {
    // `rounded` is `borderRadius` to a transition.
    const settings = transitionSettings(
      node,
      key === 'rounded' ? 'borderRadius' : key,
    );
    if (settings !== undefined) {
      animateRounded(node, shader, key, value, parse, settings);
      return;
    }
  }
  mergeIntoBag(bag, key, value, parse);
  if (!SHADERS_ENABLED) {
    return;
  }
  if (shader === undefined) {
    if (node.rendered) {
      Config.convertToShader(node);
    }
    return;
  }
  if (node._shaderFeatures === SHADER_UNMANAGED) {
    // The app's shader: the bag never reached it.
    writeFacade(shader, key, value, parse);
    return;
  }
  const before = node._shaderFeatures;
  syncShaderType(node);
  if (node._shaderFeatures !== before) {
    // The new shader was made from the bag, which holds this write.
    return;
  }
  const props = shader.props;
  if (key === 'rounded') {
    if (changedCount > 0) {
      props.radius = value;
    }
    return;
  }
  for (let i = 0; i < changedCount; i++) {
    const at = CHANGED[i]!;
    props[parse!.keys[at]!] = parse!.values[at];
  }
}

/**
 * `linearGradient`, `radialGradient`, `holePunch`: a shader of a type other
 * than the rounded family, replacing the node's. No value takes the shader
 * away only when this key made it (`_shaderKey`), and the rounded shader of
 * the border props then comes back after attach. The same object again
 * keeps the shader it made.
 */
function writeReplacing(
  node: ElementNode,
  key: ShaderKey,
  type: string,
  value: unknown,
): void {
  const bag = bagOf(node);
  const previous = bag[key];
  bag[key] = value;
  if (!SHADERS_ENABLED) {
    return;
  }
  if (value === undefined || value === null) {
    if (node._shaderKey === key) {
      node._shaderKey = undefined;
      node._shaderFeatures = SHADER_UNMANAGED;
      useShader(node, null);
      if (node.rendered) {
        Config.convertToShader(node);
      }
    }
    return;
  }
  const current = node._shader;
  if (node._shaderKey === key && current !== undefined) {
    if (previous === value) {
      return;
    }
    if (isObject(previous) && isObject(value)) {
      // The shader this key made is of this key's type: update it (1.8).
      // The gradient and hole punch props are an object of string keys.
      updateInPlace(
        current,
        previous as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      return;
    }
  }
  // The gradient and hole punch props are an object, as written.
  const shader = node.core.createShader(type, value as Record<string, unknown>);
  node._shaderKey = key;
  node._shaderFeatures = SHADER_UNMANAGED;
  useShader(node, shader);
}

/**
 * Write `value` to a shader made from `previous` of the same type, to the
 * props createShader would make from `value` (1.8): a prop the type
 * declares takes the value given, else its default; one both objects give
 * the same value is not written. Props first, then aliases (only when
 * given), each in declaration order, as createShader applies them.
 */
function updateInPlace(
  shader: ShaderNode,
  previous: Record<string, unknown>,
  value: Record<string, unknown>,
): void {
  const props = shader.props;
  const defs = shader.shaderType.props;
  if (defs === undefined) {
    for (const name in value) {
      if (previous[name] !== value[name]) {
        props[name] = value[name];
      }
    }
    return;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const name in defs) {
      const def = defs[name];
      // An AdvancedProp has a default (the renderer registry's test).
      const advanced =
        isObject(def) && (def as AdvancedProp).default !== undefined;
      // `advanced` narrowed `def` to an AdvancedProp.
      const config = def as AdvancedProp;
      const alias = advanced && config.set !== undefined;
      if (alias !== (pass === 1)) {
        continue;
      }
      const given = value[name];
      if (previous[name] === given) {
        continue;
      }
      const resolves = advanced && config.resolve !== undefined;
      if (given !== undefined) {
        // createShader copies an array, unless the prop resolves it.
        props[name] = resolves ? given : copyOf(given);
      } else if (!alias) {
        // What a shader made without it holds: a resolving prop resolves
        // its default from undefined, a plain one takes a copy of it.
        props[name] = resolves
          ? undefined
          : copyOf(advanced ? config.default : def);
      }
    }
  }
}

/** An array is copied: a shader never holds the app's array. */
function copyOf(value: unknown): unknown {
  return Array.isArray(value) ? value.slice() : value;
}

/**
 * `shader`: a ShaderNode, or `[type, props]` for one to make. A `[type,
 * props]` of the type of the one this prop made last updates that shader
 * (1.8), as a gradient does; the array is kept in the bag for that.
 */
function writeShader(
  node: ElementNode,
  value: ShaderNode | [type: string, props: Record<string, unknown>] | null,
): void {
  if (!SHADERS_ENABLED) {
    return;
  }
  const bag = bagOf(node);
  const previous = bag.shader;
  const current = node._shader;
  bag.shader = Array.isArray(value) ? value : undefined;
  if (
    Array.isArray(value) &&
    Array.isArray(previous) &&
    node._shaderKey === 'shader' &&
    current !== undefined &&
    previous[0] === value[0]
  ) {
    // The bag's `shader` holds a `[type, props]` this function stored.
    updateInPlace(
      current,
      (previous as [string, Record<string, unknown>])[1],
      value[1],
    );
    return;
  }
  node._shaderFeatures = SHADER_UNMANAGED;
  node._shaderKey = value === null ? undefined : 'shader';
  if (Array.isArray(value)) {
    useShader(node, node.core.createShader(value[0], value[1]));
  } else {
    useShader(node, value);
  }
}

/**
 * The shader prop accessors (spec 5.4), written out for the same reason as
 * accessors.ts. Every setter returns on a destroyed node and records the
 * write in `_set` (an `undefined` write clears the byte: a rounded-family
 * prop is then taken off the shader, resetShaderProp); every getter returns
 * what was written. `rounded` is the alias of `borderRadius`: one prop, one
 * `_set` byte.
 */
export function installShaderAccessors(proto: ElementNode): void {
  Object.defineProperties(proto, {
    border: {
      get(this: ElementNode): BorderStyle | undefined {
        const bag = this._shaderProps;
        // The bag holds what the setter stored under this key.
        return bag === undefined
          ? undefined
          : (bag.border as BorderStyle | undefined);
      },
      set(this: ElementNode, v: BorderStyle | undefined) {
        if (this.slot === NULL) {
          return;
        }
        if (v === undefined) {
          this._set[SET_BORDER] = 0;
          resetShaderProp(this, 'border');
          return;
        }
        this._set[SET_BORDER] = 1;
        writeRounded(this, 'border', v);
      },
    },
    borderTop: {
      get(this: ElementNode): SingleBorderStyle | undefined {
        const bag = this._shaderProps;
        // The bag holds what the setter stored under this key.
        return bag === undefined
          ? undefined
          : (bag.borderTop as SingleBorderStyle | undefined);
      },
      set(this: ElementNode, v: SingleBorderStyle | undefined) {
        if (this.slot === NULL) {
          return;
        }
        if (v === undefined) {
          this._set[SET_BORDER_TOP] = 0;
          resetShaderProp(this, 'borderTop');
          return;
        }
        this._set[SET_BORDER_TOP] = 1;
        writeRounded(this, 'borderTop', v);
      },
    },
    borderRight: {
      get(this: ElementNode): SingleBorderStyle | undefined {
        const bag = this._shaderProps;
        // The bag holds what the setter stored under this key.
        return bag === undefined
          ? undefined
          : (bag.borderRight as SingleBorderStyle | undefined);
      },
      set(this: ElementNode, v: SingleBorderStyle | undefined) {
        if (this.slot === NULL) {
          return;
        }
        if (v === undefined) {
          this._set[SET_BORDER_RIGHT] = 0;
          resetShaderProp(this, 'borderRight');
          return;
        }
        this._set[SET_BORDER_RIGHT] = 1;
        writeRounded(this, 'borderRight', v);
      },
    },
    borderBottom: {
      get(this: ElementNode): SingleBorderStyle | undefined {
        const bag = this._shaderProps;
        // The bag holds what the setter stored under this key.
        return bag === undefined
          ? undefined
          : (bag.borderBottom as SingleBorderStyle | undefined);
      },
      set(this: ElementNode, v: SingleBorderStyle | undefined) {
        if (this.slot === NULL) {
          return;
        }
        if (v === undefined) {
          this._set[SET_BORDER_BOTTOM] = 0;
          resetShaderProp(this, 'borderBottom');
          return;
        }
        this._set[SET_BORDER_BOTTOM] = 1;
        writeRounded(this, 'borderBottom', v);
      },
    },
    borderLeft: {
      get(this: ElementNode): SingleBorderStyle | undefined {
        const bag = this._shaderProps;
        // The bag holds what the setter stored under this key.
        return bag === undefined
          ? undefined
          : (bag.borderLeft as SingleBorderStyle | undefined);
      },
      set(this: ElementNode, v: SingleBorderStyle | undefined) {
        if (this.slot === NULL) {
          return;
        }
        if (v === undefined) {
          this._set[SET_BORDER_LEFT] = 0;
          resetShaderProp(this, 'borderLeft');
          return;
        }
        this._set[SET_BORDER_LEFT] = 1;
        writeRounded(this, 'borderLeft', v);
      },
    },
    shadow: {
      get(this: ElementNode): Record<string, unknown> | undefined {
        const bag = this._shaderProps;
        // The bag holds what the setter stored under this key.
        return bag === undefined
          ? undefined
          : (bag.shadow as Record<string, unknown> | undefined);
      },
      set(this: ElementNode, v: Record<string, unknown> | undefined) {
        if (this.slot === NULL) {
          return;
        }
        if (v === undefined) {
          this._set[SET_SHADOW] = 0;
          resetShaderProp(this, 'shadow');
          return;
        }
        this._set[SET_SHADOW] = 1;
        writeRounded(this, 'shadow', v);
      },
    },
    borderRadius: {
      get(this: ElementNode): number | number[] | undefined {
        const bag = this._shaderProps;
        // The bag holds what the setter stored under this key.
        return bag === undefined
          ? undefined
          : (bag.rounded as number | number[] | undefined);
      },
      set(this: ElementNode, v: number | number[] | undefined) {
        if (this.slot === NULL) {
          return;
        }
        if (v === undefined) {
          this._set[SET_BORDER_RADIUS] = 0;
          resetShaderProp(this, 'rounded');
          return;
        }
        this._set[SET_BORDER_RADIUS] = 1;
        writeRounded(this, 'rounded', v);
      },
    },
    // The alias of borderRadius.
    rounded: {
      get(this: ElementNode): number | number[] | undefined {
        const bag = this._shaderProps;
        // The bag holds what the setter stored under this key.
        return bag === undefined
          ? undefined
          : (bag.rounded as number | number[] | undefined);
      },
      set(this: ElementNode, v: number | number[] | undefined) {
        if (this.slot === NULL) {
          return;
        }
        if (v === undefined) {
          this._set[SET_BORDER_RADIUS] = 0;
          resetShaderProp(this, 'rounded');
          return;
        }
        this._set[SET_BORDER_RADIUS] = 1;
        writeRounded(this, 'rounded', v);
      },
    },

    linearGradient: {
      get(this: ElementNode): Record<string, unknown> | undefined {
        const bag = this._shaderProps;
        // The bag holds what the setter stored under this key.
        return bag === undefined
          ? undefined
          : (bag.linearGradient as Record<string, unknown> | undefined);
      },
      set(this: ElementNode, v: Record<string, unknown> | undefined) {
        if (this.slot === NULL) {
          return;
        }
        this._set[SET_LINEAR_GRADIENT] = v === undefined ? 0 : 1;
        writeReplacing(this, 'linearGradient', 'linearGradient', v);
      },
    },
    radialGradient: {
      get(this: ElementNode): Record<string, unknown> | undefined {
        const bag = this._shaderProps;
        // The bag holds what the setter stored under this key.
        return bag === undefined
          ? undefined
          : (bag.radialGradient as Record<string, unknown> | undefined);
      },
      set(this: ElementNode, v: Record<string, unknown> | undefined) {
        if (this.slot === NULL) {
          return;
        }
        this._set[SET_RADIAL_GRADIENT] = v === undefined ? 0 : 1;
        writeReplacing(this, 'radialGradient', 'radialGradient', v);
      },
    },
    holePunch: {
      get(this: ElementNode): Record<string, unknown> | undefined {
        const bag = this._shaderProps;
        // The bag holds what the setter stored under this key.
        return bag === undefined
          ? undefined
          : (bag.holePunch as Record<string, unknown> | undefined);
      },
      set(this: ElementNode, v: Record<string, unknown> | undefined) {
        if (this.slot === NULL) {
          return;
        }
        this._set[SET_HOLE_PUNCH] = v === undefined ? 0 : 1;
        writeReplacing(this, 'holePunch', 'holePunch', v);
      },
    },

    // The shader itself: not parsed, not swapped by a border width.
    shader: {
      get(this: ElementNode): ShaderNode | undefined {
        return this._shader;
      },
      set(
        this: ElementNode,
        v:
          | ShaderNode
          | [type: string, props: Record<string, unknown>]
          | null
          | undefined,
      ) {
        if (this.slot === NULL) {
          return;
        }
        this._set[SET_SHADER] = v === undefined ? 0 : 1;
        writeShader(this, v === undefined ? null : v);
      },
    },
  });
}
