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
  isObject,
  isString,
  isINode,
  isElementNode,
  isElementText,
  logRenderTree,
  isFunction,
  spliceItem,
} from './utils.js';
import {
  compileBlock,
  shaderParse,
  type BlockPlan,
  type ShaderParse,
} from './stylePlan.js';
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
  // Parsed once per object (stylePlan.ts): `border` and `border-w`, ...
  const parse = shaderParse(prefix, obj);
  const keys = parse.keys;
  const values = parse.values;
  for (let i = 0; i < keys.length; i++) {
    props[keys[i]!] = values[i];
  }
};

const copyOf = (value: unknown): unknown =>
  isArray(value) ? value.slice() : value;

/** What the shader writes need of a renderer v2 shader type, built once per type. */
interface ShaderTypeInfo {
  /**
   * Per declared prop and alias, the value a shader created without it
   * holds: the props resolved from nothing in declaration order, then each
   * alias read from them (`shadow-blur` is 5: the projection's default
   * `[0, 0, 5, 5]`), as `createShader` builds them.
   */
  readonly fresh: Record<string, unknown>;
  /** The props that resolve their value: a write of undefined gives their default. */
  readonly resolves: Record<string, boolean | undefined>;
  /**
   * Per resolving prop whose fresh value is one number repeated (a vec4 of
   * zeros), that number: it resolves to the same value, and an animation
   * takes it as a number track instead of a jump at the end.
   */
  readonly scalar: Record<string, number | undefined>;
  /** The aliases (an AdvancedProp with `set`): createShader writes them only when given. */
  readonly alias: Record<string, boolean | undefined>;
  /**
   * The vec4 props that have element aliases (`border-w`, `radius`,
   * `shadow-projection`), and per member of such a family (the prop and its
   * aliases) the prop: `familyOf['shadow-y']` is `shadow-projection`.
   */
  readonly families: string[];
  readonly familyOf: Record<string, string | undefined>;
  /** Per family prop: the prop, then its aliases in declaration order. */
  readonly members: Record<string, string[] | undefined>;
}

const shaderTypeInfos = new WeakMap<object, ShaderTypeInfo | null>();

/** A value no alias holds, to see which prop an alias writes. */
const ALIAS_PROBE = -987654.321;

/** A renderer `AdvancedProp`, as far as these writes read it. */
interface AdvancedPropLike {
  default?: unknown;
  resolve?: (value: unknown, props: Record<string, unknown>) => unknown;
  set?: (value: unknown, props: Record<string, unknown>) => void;
  get?: (props: Record<string, unknown>) => unknown;
}

/** Whether `a` is an array of `length` copies of `n`. */
function repeats(a: unknown, n: unknown, length: number): boolean {
  if (!isArray(a) || a.length !== length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== n) {
      return false;
    }
  }
  return true;
}

function copyRecord(from: Record<string, unknown>): Record<string, unknown> {
  const out = Object.create(null) as Record<string, unknown>;
  for (const k in from) {
    out[k] = copyOf(from[k]);
  }
  return out;
}

function buildShaderTypeInfo(defs: unknown): ShaderTypeInfo | null {
  if (!isObject(defs)) {
    return null;
  }
  const fresh = Object.create(null) as Record<string, unknown>;
  const resolves = Object.create(null) as Record<string, boolean | undefined>;
  const scalar = Object.create(null) as Record<string, number | undefined>;
  const alias = Object.create(null) as Record<string, boolean | undefined>;
  const families: string[] = [];
  const familyOf = Object.create(null) as Record<string, string | undefined>;
  const members = Object.create(null) as Record<string, string[] | undefined>;
  try {
    for (const name in defs) {
      const value = defs[name];
      // An AdvancedProp has a default (the registry's test).
      if (isObject(value) && value.default !== undefined) {
        const def = value as AdvancedPropLike;
        if (def.set !== undefined) {
          alias[name] = true;
        } else if (def.resolve !== undefined) {
          resolves[name] = true;
          fresh[name] = def.resolve(undefined, fresh);
        } else {
          fresh[name] = copyOf(def.default);
        }
      } else {
        fresh[name] = copyOf(value);
      }
    }
    for (const name in resolves) {
      const f = fresh[name];
      if (isArray(f) && f.length > 0 && typeof f[0] === 'number') {
        const n = f[0];
        const def = defs[name] as AdvancedPropLike;
        if (
          repeats(f, n, f.length) &&
          repeats(def.resolve!(n, copyRecord(fresh)), n, f.length)
        ) {
          scalar[name] = n;
        }
      }
    }
    for (const name in alias) {
      const def = defs[name] as AdvancedPropLike;
      fresh[name] = def.get !== undefined ? def.get(fresh) : def.default;
      // Which prop does it write an element of? Write a probe into a copy.
      const probe = copyRecord(fresh);
      def.set!(ALIAS_PROBE, probe);
      for (const k in fresh) {
        const a = fresh[k];
        const b = probe[k];
        let changed = a !== b;
        if (isArray(a) && isArray(b)) {
          changed = false;
          for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
              changed = true;
            }
          }
        }
        if (changed && k !== name && alias[k] !== true) {
          let list = members[k];
          if (list === undefined) {
            list = members[k] = [k];
            families.push(k);
            familyOf[k] = k;
          }
          list.push(name);
          familyOf[name] = k;
        }
      }
    }
  } catch (e) {
    // A type whose props cannot be read this way: reset to undefined.
    if (isDev) console.warn('shader props not read: ', e);
    return null;
  }
  return { fresh, resolves, scalar, alias, families, familyOf, members };
}

/** The info of a renderer v2 shader's type; null on the DOM renderer (a name). */
function shaderTypeInfo(shader: IRendererShader): ShaderTypeInfo | null {
  const type = shader.shaderType as unknown;
  if (!isObject(type)) {
    return null;
  }
  let info = shaderTypeInfos.get(type);
  if (info === undefined) {
    info = buildShaderTypeInfo(type.props);
    shaderTypeInfos.set(type, info);
  }
  return info;
}

/**
 * The value to reset sub-prop `name` to, so that it holds what a shader
 * created without it holds (B18). Into the props directly, a prop that
 * resolves its value takes undefined (it resolves its own fresh default, as
 * in createShader); into an animation target it takes the fresh value (the
 * animator makes no track for undefined), as a number when one number
 * resolves to it (a shrinking track, not a jump at the end). Undefined when
 * the type is not known (the DOM renderer reads an absent sub-prop as its
 * default) or does not declare `name`.
 */
function shaderResetValue(
  info: ShaderTypeInfo | null,
  name: string,
  animated: boolean,
): unknown {
  if (info === null) {
    return undefined;
  }
  if (!animated) {
    return info.resolves[name] === true ? undefined : copyOf(info.fresh[name]);
  }
  const n = info.scalar[name];
  return n !== undefined ? n : copyOf(info.fresh[name]);
}

/** The style keys whose objects all write `border-*` shader props. */
const BORDER_KEYS = [
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
];

/** Whether a style key is one of BORDER_KEYS. */
const IS_BORDER_KEY: Record<string, boolean | undefined> = {
  border: true,
  borderTop: true,
  borderRight: true,
  borderBottom: true,
  borderLeft: true,
};

/** No object of the node names the sub-prop. */
const NOT_SET = {};

/** No state change is giving this border key a value. */
const NOT_PENDING = {};

/**
 * Per node with more than one border object: the order they were written
 * in (last write wins, as before 1.7) and, while a state change writes
 * several of them, the value it gives each.
 */
interface BorderWrites {
  /** Per border key, when its object was last written (a running count; 0: before this record). */
  readonly seq: Record<string, number>;
  /** Per border key, the object the running state change gives it, or NOT_PENDING. */
  readonly next: Record<string, unknown>;
}

let borderWriteCount = 0;

function borderWritesOf(node: ElementNode): BorderWrites {
  let writes = node._borderWrites;
  if (writes === undefined) {
    const seq = Object.create(null) as Record<string, number>;
    const next = Object.create(null) as Record<string, unknown>;
    for (let i = 0; i < BORDER_KEYS.length; i++) {
      seq[BORDER_KEYS[i]!] = 0;
      next[BORDER_KEYS[i]!] = NOT_PENDING;
    }
    writes = node._borderWrites = { seq, next };
  }
  return writes;
}

/** Whether a border object other than `key`'s is set on the node. */
function otherBorderSet(
  effects: Record<string, unknown>,
  key: string,
): boolean {
  for (let i = 0; i < BORDER_KEYS.length; i++) {
    const k = BORDER_KEYS[i]!;
    if (k !== key && isObject(effects[k])) {
      return true;
    }
  }
  return false;
}

// One write's view of the node's objects for the key's group (the five
// border keys, or the shadow alone), as they will be once the write and
// the running state change are done: each parsed once, in the order they
// were written, the object being written last. Module scratch: a write
// does not nest.
const groupParses: (ShaderParse | null)[] = [null, null, null, null, null];
const groupOrder: number[] = [0, 1, 2, 3, 4];
let groupSize = 0;
let groupSelf = 0;

function loadGroup(
  key: string,
  value: unknown,
  effects: Record<string, unknown>,
  writes: BorderWrites | undefined,
): void {
  if (IS_BORDER_KEY[key] !== true) {
    groupParses[0] = isObject(value) ? shaderParse(key, value) : null;
    groupOrder[0] = 0;
    groupSize = 1;
    groupSelf = 0;
    return;
  }
  groupSize = BORDER_KEYS.length;
  for (let i = 0; i < groupSize; i++) {
    const k = BORDER_KEYS[i]!;
    let obj: unknown;
    if (k === key) {
      obj = value;
      groupSelf = i;
    } else {
      obj = writes !== undefined ? writes.next[k] : NOT_PENDING;
      if (obj === NOT_PENDING) {
        obj = effects[k];
      }
    }
    groupParses[i] = isObject(obj) ? shaderParse(k, obj) : null;
    // Insertion sort by write order; ties keep BORDER_KEYS order.
    const s = groupSeq(i, writes);
    let j = i - 1;
    while (j >= 0 && groupSeq(groupOrder[j]!, writes) > s) {
      groupOrder[j + 1] = groupOrder[j]!;
      j--;
    }
    groupOrder[j + 1] = i;
  }
}

function groupSeq(i: number, writes: BorderWrites | undefined): number {
  if (i === groupSelf) {
    return Infinity;
  }
  return writes !== undefined ? writes.seq[BORDER_KEYS[i]!]! : 0;
}

/** The value the latest other object of the group gives `name`, or NOT_SET. */
function otherValue(name: string): unknown {
  for (let o = groupSize - 1; o >= 0; o--) {
    const i = groupOrder[o]!;
    const parse = groupParses[i]!;
    if (i !== groupSelf && parse !== null) {
      const at = parse.index[name];
      if (at !== undefined) {
        return parse.values[at];
      }
    }
  }
  return NOT_SET;
}

/** Whether another object of the group remains. */
function otherObjectSet(): boolean {
  for (let i = 0; i < groupSize; i++) {
    if (i !== groupSelf && groupParses[i]! !== null) {
      return true;
    }
  }
  return false;
}

/** Whether another object of the group names any of `names`. */
function otherNamesAny(names: string[]): boolean {
  for (let i = 0; i < groupSize; i++) {
    const parse = groupParses[i]!;
    if (i !== groupSelf && parse !== null && familyNamed(parse, names)) {
      return true;
    }
  }
  return false;
}

/**
 * Rebuild a vec4 family after one of its members was reset: the vec4 from
 * the latest object that names it, else its reset value, then the element
 * aliases the objects written after that one name (its own after the vec4,
 * in its key order), in write order: the values the writes left, without
 * the removed ones.
 */
function replayFamily(
  target: Record<string, unknown>,
  info: ShaderTypeInfo,
  prop: string,
  animated: boolean,
): void {
  let from = -1;
  for (let o = groupSize - 1; o >= 0; o--) {
    const parse = groupParses[groupOrder[o]!]!;
    if (parse !== null && parse.index[prop] !== undefined) {
      from = o;
      break;
    }
  }
  if (from === -1) {
    target[prop] = shaderResetValue(info, prop, animated);
  } else {
    const parse = groupParses[groupOrder[from]!]!;
    target[prop] = parse.values[parse.index[prop]!];
  }
  for (let o = from === -1 ? 0 : from; o < groupSize; o++) {
    const parse = groupParses[groupOrder[o]!]!;
    if (parse === null) {
      continue;
    }
    const keys = parse.keys;
    const start = o === from ? parse.index[prop]! + 1 : 0;
    for (let j = start; j < keys.length; j++) {
      const name = keys[j]!;
      if (name !== prop && info.familyOf[name] === prop) {
        target[name] = parse.values[j];
      }
    }
  }
}

/** Whether a write from `old` to `next` changes any member of a family. */
function familyChanges(
  old: ShaderParse | null,
  next: ShaderParse | null,
  names: string[],
): boolean {
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    const a = old !== null ? old.index[name] : undefined;
    const b = next !== null ? next.index[name] : undefined;
    if (a === undefined ? b !== undefined : b === undefined) {
      return true;
    }
    if (a !== undefined && old!.values[a] !== next!.values[b!]) {
      return true;
    }
  }
  return false;
}

/** Whether `parse` names any of `names`. */
function familyNamed(parse: ShaderParse, names: string[]): boolean {
  for (let i = 0; i < names.length; i++) {
    if (parse.index[names[i]!] !== undefined) {
      return true;
    }
  }
  return false;
}

/** Whether `old` names a member of a family that `next` does not. */
function familyResets(
  old: ShaderParse,
  next: ShaderParse | null,
  names: string[],
): boolean {
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    if (
      old.index[name] !== undefined &&
      (next === null || next.index[name] === undefined)
    ) {
      return true;
    }
  }
  return false;
}

/** writeShaderValue modes. */
const INTO_BAG = 0;
const INTO_PROPS = 1;
const INTO_ANIMATION = 2;

/**
 * Write a `border`/`borderTop`/.../`shadow` object (parsed once per object)
 * or a radius: into a props bag for createShader (`INTO_BAG`: everything),
 * into a shader's props (`INTO_PROPS`: only what changed, since a renderer
 * v2 facade write repacks even when the value is unchanged), or into an
 * animation target (`INTO_ANIMATION`: everything).
 *
 * The object written wins for every sub-prop it names, in its key order
 * (the last write wins, as before 1.7). A sub-prop `prev` named and
 * `value` does not (an undo, B18) takes the value the latest remaining
 * object of the node gives it, else a fresh shader's (`info`, the shader
 * type's; null for a bag or the DOM renderer, which reset to undefined);
 * a vec4 one of whose members is reset this way (`border-w` and its
 * element `border-top`) is rebuilt from the remaining objects in write
 * order. A removed object with no other object left leaves its colour
 * transparent (RGB kept, so a transition fades it out); an object written
 * over none that names no colour, with no other object naming one, gets
 * the fresh colour back. A sub-prop another object also names is never
 * skipped as unchanged. `current` is the shader's props (the colour a
 * removal fades from), null for a bag. Returns whether anything was
 * written.
 */
function writeShaderValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  prev: unknown,
  effects: Record<string, unknown>,
  writes: BorderWrites | undefined,
  info: ShaderTypeInfo | null,
  mode: number,
  current: Record<string, unknown> | null,
): boolean {
  const animated = mode === INTO_ANIMATION;
  if (key === 'rounded' || typeof value === 'number') {
    if (mode === INTO_PROPS && value === prev) {
      return false;
    }
    target.radius =
      animated && value === undefined
        ? shaderResetValue(info, 'radius', true)
        : value;
    return true;
  }
  loadGroup(key, value, effects, writes);
  const next = groupParses[groupSelf]!;
  const old = isObject(prev) ? shaderParse(key, prev) : null;
  if (old === next) {
    // The same object again (its parse is cached), or none over none.
    return false;
  }
  const colorKey = key === 'shadow' ? 'shadow-color' : 'border-color';
  let wrote = false;

  // Sub-props outside the vec4 families that only `prev` named.
  if (old !== null) {
    const keys = old.keys;
    for (let i = 0; i < keys.length; i++) {
      const name = keys[i]!;
      if (
        (next !== null && next.index[name] !== undefined) ||
        (info !== null && info.familyOf[name] !== undefined) ||
        (name === colorKey && next === null && info !== null)
      ) {
        continue;
      }
      const v = otherValue(name);
      target[name] = v !== NOT_SET ? v : shaderResetValue(info, name, animated);
      wrote = true;
    }
  }
  if (next === null && info !== null) {
    // Removed: the colour of the latest remaining object, else the fresh
    // one when another object remains, else transparent with its RGB kept
    // (a transition fades it out; Box neither draws a transparent border
    // or shadow nor grows the quad for it).
    let v = otherValue(colorKey);
    if (v === NOT_SET) {
      if (otherObjectSet()) {
        v = old!.index[colorKey] !== undefined ? info.fresh[colorKey] : NOT_SET;
      } else {
        const c = current !== null ? current[colorKey] : undefined;
        v = typeof c === 'number' ? (c & 0xffffff00) >>> 0 : 0x00000000;
      }
    }
    if (v !== NOT_SET) {
      target[colorKey] = v;
      wrote = true;
    }
  }

  // The vec4 families (a vec4 and its element aliases).
  if (info !== null) {
    const force = mode !== INTO_PROPS || (next !== null && !next.cached);
    const families = info.families;
    for (let f = 0; f < families.length; f++) {
      const prop = families[f]!;
      const names = info.members[prop]!;
      if (old !== null && familyResets(old, next, names)) {
        replayFamily(target, info, prop, animated);
        wrote = true;
      } else if (
        next !== null &&
        familyNamed(next, names) &&
        (force || familyChanges(old, next, names) || otherNamesAny(names))
      ) {
        const keys = next.keys;
        for (let j = 0; j < keys.length; j++) {
          if (info.familyOf[keys[j]!] === prop) {
            target[keys[j]!] = next.values[j];
          }
        }
        wrote = true;
      }
    }
  }

  if (next === null) {
    return wrote;
  }
  // The other sub-props `value` names: what changed (everything but into
  // props), and what another object also names.
  const diff = mode === INTO_PROPS && old !== null && next.cached;
  const keys = next.keys;
  const values = next.values;
  for (let i = 0; i < keys.length; i++) {
    const name = keys[i]!;
    if (info !== null && info.familyOf[name] !== undefined) {
      continue;
    }
    const v = values[i];
    if (diff) {
      const at = old.index[name];
      if (
        at !== undefined &&
        old.values[at] === v &&
        otherValue(name) === NOT_SET
      ) {
        continue;
      }
    }
    target[name] = v;
    wrote = true;
  }
  // Over none, a colour it does not name is the fresh one (a removal may
  // have left it transparent).
  if (
    old === null &&
    info !== null &&
    mode !== INTO_BAG &&
    next.index[colorKey] === undefined &&
    otherValue(colorKey) === NOT_SET
  ) {
    const fresh = info.fresh[colorKey];
    if (fresh !== undefined) {
      target[colorKey] = fresh;
      wrote = true;
    }
  }
  return wrote;
}

/** The gradient shaders the raw accessors made, by accessor key. */
const gradientShaders = new WeakMap<object, string>();

/** Marks a key a state change tracks but has not written yet. */
const UNWRITTEN = {};

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
function styleFallback(node: ElementNode, key: string, warn = true): unknown {
  const theme = node._theme as Record<string, unknown> | undefined;
  let value = theme !== undefined ? theme[key] : undefined;
  if (value === undefined) {
    const style = node._style as Record<string, unknown> | undefined;
    if (style !== undefined) {
      value = style[key];
    }
  }
  if (isDev && warn && value === undefined) {
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
  warn = true,
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
    return styleFallback(node, key, warn);
  }
  // A getter is read now, each time the state is applied (pinned).
  return plan.getters[at] === true ? plan.block[key] : plan.values[at];
}

/**
 * When a state change writes two or more border objects, give each write
 * the values the change gives the others (`_borderWrites.next`): an undo
 * then removes them all before anything is rebuilt from what remains, so
 * no animation keeps a removed object's element. Returns the record to
 * clear after the writes, or undefined.
 */
function pendBorders(
  node: ElementNode,
  keys: string[],
  count: number,
  states: States | null,
  order: DollarString[] | undefined,
): BorderWrites | undefined {
  let borders = 0;
  for (let i = 0; i < count; i++) {
    if (IS_BORDER_KEY[keys[i]!] === true) {
      borders++;
    }
  }
  if (borders < 2) {
    return undefined;
  }
  const writes = borderWritesOf(node);
  for (let i = 0; i < count; i++) {
    const key = keys[i]!;
    if (IS_BORDER_KEY[key] === true) {
      writes.next[key] =
        states === null
          ? styleFallback(node, key, false)
          : resolveStateValue(node, key, states, order, false);
    }
  }
  return writes;
}

/** The end of a state change's border writes. */
function unpendBorders(writes: BorderWrites | undefined): void {
  if (writes !== undefined) {
    for (let i = 0; i < BORDER_KEYS.length; i++) {
      writes.next[BORDER_KEYS[i]!] = NOT_PENDING;
    }
  }
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

function getPropertyAlias(name: string) {
  if (name === 'w') return 'width';
  if (name === 'h') return 'height';
  return name;
}

const LightningRendererNumberProps = [
  'alpha',
  'color',
  'colorTop',
  'colorRight',
  'colorLeft',
  'colorBottom',
  'colorTl',
  'colorTr',
  'colorBl',
  'colorBr',
  'h',
  'fontSize',
  'lineHeight',
  'mount',
  'mountX',
  'mountY',
  'pivot',
  'pivotX',
  'pivotY',
  'rotation',
  'scale',
  'scaleX',
  'scaleY',
  'w',
  'x',
  'y',
  'zIndex',
];

// Forwarded to the renderer node (lng[key] = v). Only the renderer's props:
// on a @solidtv/renderer 2.0 node any other name becomes a field of its
// own. fontStretch, the DOM renderer's alone, has an accessor below.
const LightningRendererNonAnimatingProps = [
  'absX',
  'absY',
  'autosize',
  'clipping',
  'contain',
  'componentName',
  'componentLocation',
  'data',
  'destroyed',
  'forceLoad',
  'fontStyle',
  'ignoreParentAlpha',
  'imageType',
  'letterSpacing',
  'maxHeight',
  'maxLines',
  'maxWidth',
  'offsetY',
  'overflowSuffix',
  'placeholderColor',
  'srcHeight',
  'srcWidth',
  'srcX',
  'srcY',
  'text',
  'textAlign',
  'texture',
  'textureOptions',
  'verticalAlign',
  'wordBreak',
];

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
  _theme?: Styles;
  _lastAnyKeyPressTime?: number;
  _type: 'element' | 'textNode';
  /** @internal The keys state changes wrote, in first-write order: undo walks them. Reused, never shrunk. */
  _undoStyles?: string[];
  /** @internal How many entries of `_undoStyles` are live. */
  _undoCount: number;
  /** @internal Per key in `_undoStyles`, the value the last state change wrote. */
  _applied?: Record<string, unknown>;
  /** @internal With two or more border objects: their write order, and a state change's values for them. */
  _borderWrites?: BorderWrites;
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
    this._undoCount = 0;
    this._applied = undefined;
    this._borderWrites = undefined;
    this._display = undefined;
    this._onLayout = undefined;
    this._requiresLayout = false;
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
    const weight =
      (Config.fontWeightAlias &&
        (Config.fontWeightAlias[v as string] as number | string)) ??
      v;
    (this.lng as ElementNode).fontFamily =
      `${this.fontFamily || Config.fontSettings?.fontFamily}${weight}`;
  }

  get fontWeight() {
    return this._fontWeight;
  }

  set fontFamily(v) {
    this._fontFamily = v;
    (this.lng as ElementNode).fontFamily = v;
  }

  get fontFamily() {
    return this._fontFamily;
  }

  insertChild(
    node: ElementNode | ElementText | TextNode,
    beforeNode?: ElementNode | ElementText | TextNode | null,
  ) {
    // always remove nodes if they have a parent - for back swap of node
    // this will then put the node at the end of the array when re-added
    if (node.parent) {
      node.parent.removeChild(node);

      // We're inserting a node thats been rendered into a node that hasn't been
      if (!this.rendered) {
        this._hasRenderedChildren = true;
      }
    }

    node.parent = this;

    if (beforeNode) {
      // SolidJS can move nodes around in the children array.
      // We need to insert following DOM insertBefore which moves elements.
      spliceItem(this.children, node as ElementNode, 1);
      if (spliceItem(this.children, beforeNode as ElementNode, 0, node) > -1) {
        return;
      }
    }

    this.children.push(node as ElementNode);
  }

  removeChild(node: ElementNode | ElementText | TextNode) {
    if (spliceItem(this.children, node, 1) > -1) {
      if (isElementNode(node) && node.onRemove) {
        node.onRemove.call(node, node);
      }

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

  _sendToLightningAnimatable(name: string, value: number) {
    if (
      this.rendered &&
      this.transition &&
      Config.animationsEnabled &&
      (this.transition === true ||
        this.transition[name] ||
        this.transition[getPropertyAlias(name)])
    ) {
      const animationSettings =
        this.transition === true || this.transition[name] === true
          ? undefined
          : this.transition[name] ||
            (this.transition[getPropertyAlias(name)] as
              | undefined
              | AnimationSettings);

      // If the renderer doesn't support animateProp,
      // keep backwards compatible with LightningRenderer
      if (!('animateProp' in this.lng)) {
        const animationController = this.animate(
          { [name]: value },
          animationSettings,
        );
        this._fireAnimationEvents(name, value, animationSettings);
        return animationController.start();
      }

      const result = (this.lng as INode).animateProp(
        name,
        value,
        animationSettings || this.animationSettings || {},
      );
      this._fireAnimationEvents(name, value, animationSettings);
      return result;
    }

    (this.lng[name as keyof (IRendererNode | INode)] as number | string) =
      value;
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
    let count = this._undoCount;
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

    let keys = this._undoStyles;
    if (keys === undefined) {
      keys = this._undoStyles = [];
    }
    let applied = this._applied;
    if (applied === undefined) {
      applied = this._applied = Object.create(null) as Record<string, unknown>;
    }
    const diff = this.rendered;

    if (n === 0) {
      // Undo every tracked key, in its order (`transition` too: pinned).
      const pending = pendBorders(this, keys, count, null, undefined);
      for (let i = 0; i < count; i++) {
        const key = keys[i]!;
        const value = styleFallback(this, key);
        if (!diff || value !== applied[key]) {
          applied[key] = value;
          this[key] = value;
        }
      }
      unpendBorders(pending);
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
    const pending = pendBorders(this, keys, count, states, order);
    for (let i = 0; i < count; i++) {
      const key = keys[i]!;
      const value = resolveStateValue(this, key, states, order);
      if (!diff || value !== applied[key]) {
        applied[key] = value;
        this[key] = value;
      }
    }
    unpendBorders(pending);
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

      if (node._hasRenderedChildren) {
        node._hasRenderedChildren = false;

        for (const child of node.children) {
          if (isElementNode(child) && isINode(child.lng)) {
            child.lng.parent = node.lng as INode;
          }
        }
      }
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
      const numChildren = node.children.length;
      for (let i = 0; i < numChildren; i++) {
        const c = node.children[i];
        if (isDev) assertTruthy(c, 'Child is undefined');
        // Text elements sneak in from Solid creating tracked nodes
        if (isElementNode(c)) {
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

for (const key of LightningRendererNumberProps) {
  Object.defineProperty(ElementNode.prototype, key, {
    get(): number {
      return this.lng[key];
    },
    set(this: ElementNode, v: number) {
      this._sendToLightningAnimatable(key, v);
    },
  });
}

for (const key of LightningRendererNonAnimatingProps) {
  Object.defineProperty(ElementNode.prototype, key, {
    get(): unknown {
      return this.lng[key];
    },
    set(v: unknown) {
      this.lng[key] = v;
    },
  });
}

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
        // declared prop `value` does not name takes its default.
        const info = shaderTypeInfo(shader);
        if (info === null) {
          // The DOM renderer keeps the given object as the props.
          shader.props = value as IRendererShaderProps;
        } else {
          const props = shader.props as Record<string, unknown>;
          // Props first, then aliases, each in declaration order (`fresh`
          // holds them in that order), as createShader applies them.
          for (const name in info.fresh) {
            const given = value[name];
            if (given !== undefined) {
              // createShader copies an array, unless the prop resolves it.
              props[name] =
                info.resolves[name] === true ? given : copyOf(given);
            } else if (info.alias[name] !== true) {
              // An alias only writes when given, as in createShader.
              props[name] = shaderResetValue(info, name, false);
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
  const transitionKey = key === 'rounded' ? 'borderRadius' : key;
  return {
    set(this: ElementNode, value: T) {
      let effects = this._effects;
      if (effects === undefined) {
        effects = this._effects = {};
      }
      const prev: unknown = effects[key];
      effects[key] = value;
      // The write order of the border objects, once there are two.
      let writes = this._borderWrites;
      if (
        writes === undefined &&
        IS_BORDER_KEY[key] === true &&
        otherBorderSet(effects, key)
      ) {
        writes = borderWritesOf(this);
      }
      if (writes !== undefined && IS_BORDER_KEY[key] === true) {
        writes.seq[key] = ++borderWriteCount;
      }

      const shader = this.lng.shader as IRendererShader | null | undefined;
      const props = shader != null ? shader.props : undefined;
      if (props != null) {
        const transition = this.transition;
        if (transition && (transition === true || transition[transitionKey])) {
          // Animated: the full new props, in a target of their own.
          const target: Record<string, unknown> = {};
          writeShaderValue(
            target,
            key,
            value,
            prev,
            effects,
            writes,
            shaderTypeInfo(shader!),
            INTO_ANIMATION,
            props as Record<string, unknown>,
          );
          this._writeShaderTarget(target);
          const animationSettings =
            transition === true || transition[transitionKey] === true
              ? undefined
              : (transition[transitionKey] as undefined | AnimationSettings);
          if (animationSettings) {
            this.animate({ shaderProps: target }, animationSettings).start();
          }
          return;
        }
        // Into the shader's props: only the sub-props that changed.
        if (
          writeShaderValue(
            props as Record<string, unknown>,
            key,
            value,
            prev,
            effects,
            writes,
            shaderTypeInfo(shader!),
            INTO_PROPS,
            props as Record<string, unknown>,
          )
        ) {
          this._writeShaderTarget(props);
        }
        return;
      }

      // No shader yet: before render, the props bag createShader reads at
      // render; after render, the props of a new shader. (A rendered DOM
      // node without one holds the renderer's shared default: never write
      // into it.)
      const target =
        shader != null && !this.rendered
          ? (shader as unknown as Record<string, unknown>)
          : {};
      writeShaderValue(
        target,
        key,
        value,
        prev,
        effects,
        writes,
        null,
        INTO_BAG,
        null,
      );
      this._writeShaderTarget(target);
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
