import { shaderParse } from './shader.js';

// Compiled style plans (design 3.3). A `$state` block is read once per
// object, into flat arrays, and cached by object identity: static
// module-level styles compile once per app, an inline literal once per node.
// A key that is a getter keeps being read from its object on each apply, so
// getters are read at the same moments as before. A border or shadow object
// in a block is parsed into its facade keys at compile (shader.ts
// `shaderParse`, cached per object), so the first apply finds it parsed.

/** One `$state` block, compiled. */
export interface BlockPlan {
  /** The block's own enumerable keys, in its key order. */
  readonly keys: string[];
  /** The value of each key, by position (undefined for a getter). */
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

const blockPlans = new WeakMap<object, BlockPlan>();
const stylePlans = new WeakMap<object, StylePlan>();

/** The style keys that take a border or shadow object. */
const SHADER_OBJECT_KEYS: Record<string, true | undefined> = {
  border: true,
  borderTop: true,
  borderRight: true,
  borderBottom: true,
  borderLeft: true,
  shadow: true,
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
    // A getter is not read here: each apply reads it, as before 1.7.
    const getter = isGetter(block, key);
    const value = getter ? undefined : block[key];
    values.push(value);
    getters.push(getter);
    index[key] = i;
    if (SHADER_OBJECT_KEYS[key] === true && isObject(value)) {
      // Pre-parse into facade keys, so the first apply finds it cached.
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
  // A style object: its keys are strings.
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
