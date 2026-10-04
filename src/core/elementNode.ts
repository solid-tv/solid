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

/** A renderer `AdvancedProp`, as far as these writes read it. */
interface AdvancedPropLike {
  default?: unknown;
  resolve?: (value: unknown, props: Record<string, unknown>) => unknown;
  set?: (value: unknown, props: Record<string, unknown>) => void;
  get?: (props: Record<string, unknown>) => unknown;
}

/** The declared props of a shader type that one shader-key group writes. */
interface GroupInfo {
  /**
   * The props with the group's prefix that are neither a vec4 family nor
   * one of its element aliases, in declaration order.
   */
  readonly plain: string[];
  /** The vec4 family props with the group's prefix. */
  readonly vec4s: string[];
}

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
  /** Per resolving prop, its definition: a value compares as the facade holds it. */
  readonly resolvers: Record<string, AdvancedPropLike | undefined>;
  /**
   * Per resolving prop whose fresh value is one number repeated (a vec4 of
   * zeros), that number: it resolves to the same value, and an animation
   * takes it as a number track instead of a jump at the end.
   */
  readonly scalar: Record<string, number | undefined>;
  /** The aliases (an AdvancedProp with `set`): createShader writes them only when given. */
  readonly alias: Record<string, boolean | undefined>;
  /**
   * Per member of a vec4 family (a vec4 prop and its element aliases), the
   * prop: `familyOf['shadow-y']` is `shadow-projection`.
   */
  readonly familyOf: Record<string, string | undefined>;
  /** Per element alias, the element of its vec4 it writes. */
  readonly elementIndex: Record<string, number | undefined>;
  /** Per vec4 family prop whose every element has an alias, the alias per element. */
  readonly elements: Record<string, string[] | undefined>;
  /** Per group prefix, the group's declared props, built on first use. */
  readonly groups: Record<string, GroupInfo | undefined>;
}

const shaderTypeInfos = new WeakMap<object, ShaderTypeInfo | null>();

/** A value no alias holds, to see which prop an alias writes. */
const ALIAS_PROBE = -987654.321;

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
  const resolvers = Object.create(null) as Record<
    string,
    AdvancedPropLike | undefined
  >;
  const scalar = Object.create(null) as Record<string, number | undefined>;
  const alias = Object.create(null) as Record<string, boolean | undefined>;
  const familyOf = Object.create(null) as Record<string, string | undefined>;
  const elementIndex = Object.create(null) as Record<
    string,
    number | undefined
  >;
  const elements = Object.create(null) as Record<string, string[] | undefined>;
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
          resolvers[name] = def;
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
      // Which element of which vec4 does it write? A probe into a copy.
      const probe = copyRecord(fresh);
      def.set!(ALIAS_PROBE, probe);
      for (const k in fresh) {
        const a = fresh[k];
        const b = probe[k];
        if (k === name || alias[k] === true || !isArray(a) || !isArray(b)) {
          continue;
        }
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) {
            familyOf[k] = k;
            familyOf[name] = k;
            elementIndex[name] = i;
          }
        }
      }
    }
    for (const k in familyOf) {
      if (familyOf[k] !== k) {
        continue;
      }
      const list: string[] = [];
      const len = (fresh[k] as unknown[]).length;
      for (let i = 0; i < len; i++) {
        for (const name in elementIndex) {
          if (familyOf[name] === k && elementIndex[name] === i) {
            list[i] = name;
          }
        }
      }
      let complete = list.length === len;
      for (let i = 0; i < len; i++) {
        if (list[i] === undefined) {
          complete = false;
        }
      }
      if (complete) {
        elements[k] = list;
      }
    }
  } catch (e) {
    // A type whose props cannot be read this way: reset to undefined.
    if (isDev) console.warn('shader props not read: ', e);
    return null;
  }
  return {
    fresh,
    resolves,
    resolvers,
    scalar,
    alias,
    familyOf,
    elementIndex,
    elements,
    groups: Object.create(null) as Record<string, GroupInfo | undefined>,
  };
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

/**
 * A group of shader style keys whose objects write one prefix's props: the
 * border family (`border`, `borderTop`, ...) and the shadow. A state change
 * or a direct write of any of its keys recomputes the group as a unit.
 */
interface ShaderGroup {
  /** Its style keys. */
  readonly keys: string[];
  /** The shader-prop prefix: a parse's first key, and `<prefix>-` on the others. */
  readonly prefix: string;
  readonly dashed: string;
  readonly colorKey: string;
}

/** The style keys whose objects write `border-*` shader props, in their fixed order. */
const BORDER_KEYS: string[] = [
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
];

/**
 * Per style object, BORDER_KEYS in the order a node with that style applies
 * them at creation: the style's border keys in its key order (the order
 * `set style` writes them), then the rest in the fixed order. Read inline
 * where it is used; buildBorderOrder fills a miss (once per style).
 */
const borderOrders = new WeakMap<object, string[]>();

function buildBorderOrder(style: object): string[] {
  const order: string[] = [];
  for (const key in style) {
    if (SHADER_GROUP_OF[key] === BORDER_GROUP) {
      order.push(key);
    }
  }
  for (let i = 0; i < BORDER_KEYS.length; i++) {
    const key = BORDER_KEYS[i]!;
    if (order.indexOf(key) === -1) {
      order.push(key);
    }
  }
  borderOrders.set(style, order);
  return order;
}

const BORDER_GROUP: ShaderGroup = {
  keys: BORDER_KEYS,
  prefix: 'border',
  dashed: 'border-',
  colorKey: 'border-color',
};

const SHADOW_GROUP: ShaderGroup = {
  keys: ['shadow'],
  prefix: 'shadow',
  dashed: 'shadow-',
  colorKey: 'shadow-color',
};

/** Per shader style key, its group. */
const SHADER_GROUP_OF: Record<string, ShaderGroup | undefined> = {
  border: BORDER_GROUP,
  borderTop: BORDER_GROUP,
  borderRight: BORDER_GROUP,
  borderBottom: BORDER_GROUP,
  borderLeft: BORDER_GROUP,
  shadow: SHADOW_GROUP,
};

/** Per shader style key, its bit in a change mask (the keys a state change wrote). */
const SHADER_BIT: Record<string, number | undefined> = {
  border: 1,
  borderTop: 2,
  borderRight: 4,
  borderBottom: 8,
  borderLeft: 16,
  shadow: 32,
};
const BORDER_BITS = 31;
const SHADOW_BIT = 32;

/** No object of the group names the sub-prop. */
const NOT_SET = {};

/** Marks a key a state change tracks but has not written yet. */
const UNWRITTEN = {};

// Module scratch for one group write (a write does not nest): the group's
// effective objects, parsed, in application order (at most the five border
// keys as base objects and again as state objects); a vec4 being rebuilt;
// a plain target's keys and values.
const groupParses: (ShaderParse | null)[] = [
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
];
const scratchVec: number[] = [0, 0, 0, 0];
const scratchKeys: string[] = [];
const scratchValues: unknown[] = [];

/** replayGroup modes. */
const INTO_BAG = 0;
const INTO_PROPS = 1;
const INTO_ANIMATION = 2;

/**
 * Write a group's sub-props as the replay of its `n` effective objects
 * (`groupParses`, in application order) gives them. Into a props bag for
 * createShader or the DOM renderer's props (`info` null, `INTO_BAG` or
 * `INTO_PROPS`): each object's keys in order, the last wins, as the writes
 * before 1.7 did; a sub-prop of the group no object names any more is
 * undefined (B18: createShader and the DOM renderer read an absent one as
 * its default). Into a renderer v2 shader's props (`INTO_PROPS`) or an
 * animation target (`INTO_ANIMATION`) with `info` the type's: every
 * declared prop of the group; a plain one takes the latest object's value,
 * else a fresh shader's; a vec4 family (`border-w` with `border-top`, ...)
 * is rebuilt from the fresh value through the objects' vec4 and element
 * writes, and written as one number when its elements are equal, else
 * element by element (an animation then runs a track per element, the
 * renderer animates an array from its first element). The colour of a
 * group with no object left keeps its RGB at alpha 0 (a transition fades
 * it out; the next add starts from transparent). Only what differs from
 * `current` (the shader's props; the target itself for a plain one) is
 * written, since a facade write repacks even when the value is unchanged.
 * Returns whether anything was written.
 */
function replayGroup(
  target: Record<string, unknown>,
  current: Record<string, unknown> | null,
  info: ShaderTypeInfo | null,
  group: ShaderGroup,
  base: number,
  n: number,
  mode: number,
): boolean {
  let wrote = false;
  if (info === null) {
    let sc = 0;
    for (let p = 0; p < n; p++) {
      const parse = groupParses[p]!;
      const keys = parse.keys;
      const values = parse.values;
      for (let j = 0; j < keys.length; j++) {
        const name = keys[j]!;
        let at = 0;
        while (at < sc && scratchKeys[at] !== name) {
          at++;
        }
        scratchKeys[at] = name;
        scratchValues[at] = values[j];
        if (at === sc) {
          sc++;
        }
      }
    }
    const prefix = group.prefix;
    const dashed = group.dashed;
    for (const name in target) {
      if (
        target[name] !== undefined &&
        (name === prefix || name.lastIndexOf(dashed, 0) === 0)
      ) {
        let at = 0;
        while (at < sc && scratchKeys[at] !== name) {
          at++;
        }
        if (at === sc) {
          target[name] = undefined;
          wrote = true;
        }
      }
    }
    for (let i = 0; i < sc; i++) {
      const name = scratchKeys[i]!;
      const value = scratchValues[i];
      if (target[name] !== value) {
        target[name] = value;
        wrote = true;
      }
    }
    return wrote;
  }

  let gi = info.groups[group.prefix];
  if (gi === undefined) {
    const plain: string[] = [];
    const vec4s: string[] = [];
    const dashed = group.dashed;
    for (const name in info.fresh) {
      if (name.lastIndexOf(dashed, 0) !== 0) {
        continue;
      }
      const family = info.familyOf[name];
      if (family === undefined) {
        plain.push(name);
      } else if (family === name) {
        vec4s.push(name);
      }
    }
    gi = info.groups[group.prefix] = { plain, vec4s };
  }
  const held = current!;
  const animated = mode === INTO_ANIMATION;

  const plain = gi.plain;
  for (let i = 0; i < plain.length; i++) {
    const name = plain[i]!;
    // The latest object naming it wins (a value of undefined names nothing).
    let value: unknown = NOT_SET;
    for (let p = n - 1; p >= 0 && value === NOT_SET; p--) {
      const parse = groupParses[p]!;
      const at = parse.index[name];
      if (at !== undefined && parse.values[at] !== undefined) {
        value = parse.values[at];
      }
    }
    if (value === NOT_SET) {
      if (n === 0 && name === group.colorKey) {
        const c = held[name];
        value = typeof c === 'number' ? (c & 0xffffff00) >>> 0 : 0;
      } else {
        value = copyOf(info.fresh[name]);
      }
    }
    // Compared as the facade holds it (an align of 'outside' is 1).
    const def = info.resolvers[name];
    const resolved = def !== undefined ? def.resolve!(value, held) : value;
    if (held[name] !== resolved) {
      target[name] = value;
      wrote = true;
    }
  }

  const vec4s = gi.vec4s;
  for (let f = 0; f < vec4s.length; f++) {
    const prop = vec4s[f]!;
    const fresh = info.fresh[prop] as number[];
    const len = fresh.length;
    for (let i = 0; i < len; i++) {
      scratchVec[i] = fresh[i]!;
    }
    // The base objects as createShader applies a props bag (a never-focused
    // node's): the vec4 writes, then the element writes, the last of each
    // winning (passes 0 and 1); then the state objects in sequence, as the
    // live writes before 1.7 (pass 2: a vec4 resets the elements before it).
    for (let pass = 0; pass < 3; pass++) {
      const to = pass < 2 ? base : n;
      for (let p = pass < 2 ? 0 : base; p < to; p++) {
        const parse = groupParses[p]!;
        const keys = parse.keys;
        const values = parse.values;
        for (let j = 0; j < keys.length; j++) {
          const name = keys[j]!;
          const v = values[j];
          if (v === undefined || info.familyOf[name] !== prop) {
            continue;
          }
          if (name !== prop) {
            if (pass !== 0) {
              scratchVec[info.elementIndex[name]!] = v as number;
            }
          } else if (pass === 1) {
            continue;
          } else if (isArray(v)) {
            // toVec4: 4 as given; 3 → [a, b, c, a]; 2 → [a, b, a, b]; else
            // the first everywhere (0 when empty).
            const m = v.length;
            for (let i = 0; i < len; i++) {
              scratchVec[i] = (
                m >= len
                  ? v[i]
                  : m === 3
                    ? v[i === 3 ? 0 : i]
                    : m === 2
                      ? v[i & 1]
                      : m === 1
                        ? v[0]
                        : 0
              ) as number;
            }
          } else {
            for (let i = 0; i < len; i++) {
              scratchVec[i] = v as number;
            }
          }
        }
      }
    }
    const was = held[prop];
    const isVec = isArray(was) && was.length === len;
    let same = isVec;
    let uniform = true;
    let wasUniform = isVec;
    for (let i = 0; i < len; i++) {
      const t = scratchVec[i]!;
      if (t !== scratchVec[0]) {
        uniform = false;
      }
      if (isVec) {
        const h = (was as number[])[i];
        if (h !== t) {
          same = false;
        }
        if (h !== (was as number[])[0]) {
          wasUniform = false;
        }
      }
    }
    if (same) {
      continue;
    }
    wrote = true;
    const aliases = info.elements[prop];
    if (uniform && (wasUniform || !animated)) {
      // One write; an animation runs its number from the first element.
      target[prop] = scratchVec[0];
    } else if (aliases === undefined || !isVec) {
      target[prop] = scratchVec.slice(0, len);
    } else {
      for (let i = 0; i < len; i++) {
        if ((was as number[])[i] !== scratchVec[i]) {
          target[aliases[i]!] = scratchVec[i];
        }
      }
    }
  }
  return wrote;
}

/**
 * Recompute and write one group's shader props for `node`, after a state
 * change wrote the group's keys in `mask`, or a direct write of one of
 * them. The effective objects are replayed in the order the writes before
 * 1.7 applied them: the base objects in the style's key order (for a key
 * the running state session wrote, the session's fallback: theme, then
 * style; else the node's current object, a direct write included), then,
 * while states are on, the objects the session wrote, in its key order
 * (the merged object's, pinned). With no state on, the base objects alone:
 * a blurred node equals a never-focused one (B18). Animated when
 * `transition` is true or names a key of `mask`: the replayed values make
 * an animation target, as before 1.7 (settings of the first such key).
 */
function writeShaderGroup(
  node: ElementNode,
  group: ShaderGroup,
  mask: number,
): void {
  const effects = node._effects!;
  const states = node._states;
  const count = states !== undefined && states.length > 0 ? node._undoCount : 0;
  const tracked = node._undoStyles;
  const applied = node._applied;
  let order = group.keys;
  if (group === BORDER_GROUP) {
    const style = node._style;
    if (style !== undefined) {
      // The cache read inline: a single-use helper here would be a closure
      // per call under terser's default `reduce_funcs` (the miss path is
      // evaluated once per style).
      const cached = borderOrders.get(style);
      order = cached !== undefined ? cached : buildBorderOrder(style);
    }
  }
  let n = 0;
  for (let i = 0; i < order.length; i++) {
    const key = order[i]!;
    let obj: unknown = effects[key];
    if (count > 0) {
      let k = 0;
      while (k < count && tracked![k] !== key) {
        k++;
      }
      if (k < count && applied![key] !== UNWRITTEN) {
        obj = styleFallback(node, key, false);
      }
    }
    if (isObject(obj)) {
      groupParses[n++] = shaderParse(key, obj);
    }
  }
  const base = n;
  for (let i = 0; i < count; i++) {
    const key = tracked![i]!;
    if (SHADER_GROUP_OF[key] === group && applied![key] !== UNWRITTEN) {
      const obj = effects[key];
      if (isObject(obj)) {
        groupParses[n++] = shaderParse(key, obj);
      }
    }
  }

  const shader = node.lng.shader as IRendererShader | null | undefined;
  const props =
    shader != null
      ? (shader.props as Record<string, unknown> | undefined)
      : undefined;
  if (props != null) {
    const info = shaderTypeInfo(shader!);
    const transition = node.transition;
    let settings: AnimationSettings | true | undefined;
    if (transition === true) {
      settings = true;
    } else if (transition) {
      const keys = group.keys;
      for (let i = 0; i < keys.length && settings === undefined; i++) {
        const key = keys[i]!;
        if ((mask & SHADER_BIT[key]!) !== 0) {
          const t = transition[key];
          if (t) {
            settings = t;
          }
        }
      }
    }
    if (settings !== undefined) {
      // Animated: the changed sub-props, in a target of their own. (With
      // `true`, no settings: built and dropped, as before 1.7.)
      const target: Record<string, unknown> = {};
      if (replayGroup(target, props, info, group, base, n, INTO_ANIMATION)) {
        node._writeShaderTarget(target);
        if (settings !== true) {
          node.animate({ shaderProps: target }, settings).start();
        }
      }
      return;
    }
    if (replayGroup(props, props, info, group, base, n, INTO_PROPS)) {
      node._writeShaderTarget(props);
    }
    return;
  }

  // No shader yet: before render, the props bag createShader reads at
  // render; after render, the props of a new shader. (A rendered DOM node
  // without one holds the renderer's shared default: never write into it.)
  const target =
    shader != null && !node.rendered
      ? (shader as unknown as Record<string, unknown>)
      : {};
  replayGroup(target, null, null, group, base, n, INTO_BAG);
  node._writeShaderTarget(target);
}

/** The groups a state change's `mask` touched, each recomputed once. */
function writeShaderGroups(node: ElementNode, mask: number): void {
  if ((mask & BORDER_BITS) !== 0) {
    writeShaderGroup(node, BORDER_GROUP, mask);
  }
  if ((mask & SHADOW_BIT) !== 0) {
    writeShaderGroup(node, SHADOW_GROUP, mask);
  }
}

/** The gradient shaders the raw accessors made, by accessor key. */
const gradientShaders = new WeakMap<object, string>();

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
      // Undo every tracked key, in its order (`transition` too: pinned). A
      // border or shadow object goes to `_effects`, and its group is
      // recomputed once after the loop (writeShaderGroup), so an undo of
      // several objects removes them all before anything is rebuilt.
      let mask = 0;
      for (let i = 0; i < count; i++) {
        const key = keys[i]!;
        const value = styleFallback(this, key);
        if (!diff || value !== applied[key]) {
          applied[key] = value;
          const bit = SHADER_BIT[key];
          if (bit === undefined) {
            this[key] = value;
          } else {
            (this._effects || (this._effects = {}))[key] = value;
            mask |= bit;
          }
        }
      }
      this._undoCount = 0;
      if (mask !== 0) {
        writeShaderGroups(this, mask);
      }
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
    let mask = 0;
    for (let i = 0; i < count; i++) {
      const key = keys[i]!;
      const value = resolveStateValue(this, key, states, order);
      if (!diff || value !== applied[key]) {
        applied[key] = value;
        const bit = SHADER_BIT[key];
        if (bit === undefined) {
          this[key] = value;
        } else {
          // Its group is recomputed once, after every key is in `_effects`.
          (this._effects || (this._effects = {}))[key] = value;
          mask |= bit;
        }
      }
    }
    if (mask !== 0) {
      writeShaderGroups(this, mask);
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
  return {
    set(this: ElementNode, value: T) {
      let effects = this._effects;
      if (effects === undefined) {
        effects = this._effects = {};
      }
      const prev: unknown = effects[key];
      effects[key] = value;
      if (key !== 'rounded' && typeof value !== 'number') {
        // A border or shadow object: its group, replayed.
        writeShaderGroup(this, SHADER_GROUP_OF[key]!, SHADER_BIT[key]!);
        return;
      }

      // The radius (a number written to a border key too, as before 1.7).
      const shader = this.lng.shader as IRendererShader | null | undefined;
      const props = shader != null ? shader.props : undefined;
      if (props != null) {
        const transition = this.transition;
        if (transition && (transition === true || transition.borderRadius)) {
          // Animated: in a target of its own; an undo to no radius animates
          // to the fresh one (the animator makes no track for undefined).
          const target: Record<string, unknown> = {};
          target.radius =
            value === undefined
              ? shaderResetValue(shaderTypeInfo(shader!), 'radius', true)
              : value;
          this._writeShaderTarget(target);
          const animationSettings =
            transition === true || transition.borderRadius === true
              ? undefined
              : (transition.borderRadius as undefined | AnimationSettings);
          if (animationSettings) {
            this.animate({ shaderProps: target }, animationSettings).start();
          }
          return;
        }
        // Into the shader's props, when it changed.
        if (value !== prev) {
          (props as Record<string, unknown>).radius = value;
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
      target.radius = value;
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
