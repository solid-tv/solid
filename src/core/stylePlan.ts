// Compiled style plans (design 3.3). A `$state` block and a border or shadow
// object are read once per object, into flat arrays, and cached by object
// identity: static module-level styles compile once per app, an inline
// literal once per node. A key that is a getter keeps being read from its
// object on each apply, so getters are read at the same moments as before.
//
// No imports from the rest of core: elementNode.ts imports this file.

/** One `$state` block, compiled. */
export interface BlockPlan {
  /** The block's own enumerable keys, in its key order. */
  readonly keys: string[];
  /** The value of each key, by position (a getter's as read at compile). */
  readonly values: unknown[];
  /** By position: true for a getter, whose value is read from `block`. */
  readonly getters: boolean[];
  /** The position of each key (an object without a prototype). */
  readonly index: Record<string, number | undefined>;
  /** The block itself. */
  readonly block: Record<string, unknown>;
}

/** A style's `$state` blocks, compiled: one BlockPlan per `$` key. */
export type StylePlan = Record<string, BlockPlan>;

/** A border or shadow object as shader props, in the order they are written. */
export interface ShaderParse {
  /** The prefix itself (`border` for every side), then one per object key. */
  readonly keys: string[];
  readonly values: unknown[];
  /** The position of each key (an object without a prototype). */
  readonly index: Record<string, number | undefined>;
  /** False when the object has a getter: parsed again on each write. */
  readonly cached: boolean;
}

const blockPlans = new WeakMap<object, BlockPlan>();
const stylePlans = new WeakMap<object, StylePlan>();

/** The shader-prop prefixes of the style keys that take a border or shadow object. */
const SHADER_PREFIXES: Record<string, string | undefined> = {
  border: 'border',
  borderTop: 'border',
  borderRight: 'border',
  borderBottom: 'border',
  borderLeft: 'border',
  shadow: 'shadow',
};

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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** The plan of a `$state` block, compiled on first use. */
export function compileBlock(block: Record<string, unknown>): BlockPlan {
  let plan = blockPlans.get(block);
  if (plan !== undefined) {
    return plan;
  }
  // Object.keys: the own enumerable keys, the ones Object.assign and spread
  // read when states were applied before 1.7.
  const keys = Object.keys(block);
  const values: unknown[] = [];
  const getters: boolean[] = [];
  const index = Object.create(null) as Record<string, number | undefined>;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const value = block[key];
    values.push(value);
    getters.push(isGetter(block, key));
    index[key] = i;
    if (SHADER_PREFIXES[key] !== undefined && isObject(value)) {
      // Pre-parse into shader keys, so the first apply finds it cached.
      shaderParse(key, value);
    }
  }
  plan = { keys, values, getters, index, block };
  blockPlans.set(block, plan);
  return plan;
}

/**
 * The plans of a style's `$state` blocks, cached by the style object. A
 * style whose `$state` key is a getter can give another block each read: it
 * is compiled on every call.
 */
export function compileStyle(style: object): StylePlan {
  let plan = stylePlans.get(style);
  if (plan !== undefined) {
    return plan;
  }
  plan = Object.create(null) as StylePlan;
  let cacheable = true;
  const source = style as Record<string, unknown>;
  for (const key in source) {
    if (key.charCodeAt(0) !== 36 /* $ */) {
      continue;
    }
    const block = source[key];
    if (isObject(block)) {
      plan[key] = compileBlock(block);
      if (isGetter(style, key)) {
        cacheable = false;
      }
    }
  }
  if (cacheable) {
    stylePlans.set(style, plan);
  }
  return plan;
}

/**
 * The shader props a `border`, `borderTop`/`Right`/`Bottom`/`Left` or
 * `shadow` object stands for: `<prefix>` itself (the object), then
 * `<prefix>-<key>` per key, with `width` written `w` (a side's width is the
 * side: `border-top`). The same keys, order and values as the writes before
 * 1.7, parsed once per object.
 */
export function shaderParse(
  key: string,
  obj: Record<string, unknown>,
): ShaderParse {
  const cache = shaderParses[key];
  let parse = cache !== undefined ? cache.get(obj) : undefined;
  if (parse !== undefined) {
    return parse;
  }
  const side = BORDER_SIDES[key];
  const prefix = side !== undefined ? 'border' : key;
  const keys: string[] = [prefix];
  const values: unknown[] = [obj];
  const index = Object.create(null) as Record<string, number | undefined>;
  index[prefix] = 0;
  let cached = true;
  const own = Object.keys(obj);
  for (let i = 0; i < own.length; i++) {
    const name = own[i]!;
    if (isGetter(obj, name)) {
      cached = false;
    }
    let sub = name === 'width' ? 'w' : name;
    if (side !== undefined && sub === 'w') {
      sub = side;
    }
    const shaderKey = prefix + '-' + sub;
    const at = index[shaderKey];
    if (at !== undefined) {
      // `width` and `w` both given: the later one wins, as it did.
      values[at] = obj[name];
    } else {
      index[shaderKey] = keys.length;
      keys.push(shaderKey);
      values.push(obj[name]);
    }
  }
  parse = { keys, values, index, cached };
  if (cached && cache !== undefined) {
    cache.set(obj, parse);
  }
  return parse;
}
