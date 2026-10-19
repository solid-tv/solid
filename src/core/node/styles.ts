import { isDev } from '../env.js';
import type { DollarString } from '../intrinsicTypes.js';
import type States from '../states.js';
import type { ElementNode } from './ElementNode.js';
import { compileBlock, type BlockPlan } from './stylePlan.js';

// `style`, `theme`, `states` and the `$state` blocks (1.8's port, spec 5.7
// item 3). The accessors and `_stateChanged`/`_writeStates` are ElementNode's
// own (their bodies are on the class: a method is never inlined by a
// minifier as a per-call closure, and `states` reads a States but takes any
// NodeStates); what they share is here.
//
// A `$state` block lives on the node's style (spec 5.8), or, written as a
// prop of its own (JSX `$focus={...}`, or a `theme` key), in `_stateBlocks`,
// which wins: the 1.x node took both as its own props, the style's only
// when the node had none. The node has no index signature, so a style key is
// read and written by name through `readKey`/`writeKey`.

/** Marks a key a state change tracks but has not written yet. */
const UNWRITTEN = {};

/**
 * The border family: the style keys whose objects write the `border-*`
 * shader props (a `border` write sets all four widths, a side its own).
 */
export const BORDER_FAMILY: Readonly<Record<string, boolean | undefined>> = {
  border: true,
  borderTop: true,
  borderRight: true,
  borderBottom: true,
  borderLeft: true,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** A node prop by the name a style or a `$state` block gives it. */
export function readKey(node: ElementNode, key: string): unknown {
  // A style key names a prop of the node: an accessor or a field.
  return (node as unknown as Record<string, unknown>)[key];
}

/**
 * Write a style or `$state` key through the node's setter for it. An
 * `undefined` value is "no value": each setter writes the prop's default
 * and clears its `_set` byte (spec 5.3).
 */
export function writeKey(node: ElementNode, key: string, value: unknown): void {
  // A style key names a prop of the node: an accessor or a field.
  (node as unknown as Record<string, unknown>)[key] = value;
}

/**
 * A `$state` block written on the node itself: a JSX `$name` prop, or a
 * `theme` key. It wins over the style's block of the same name.
 */
export function setStateBlock(
  node: ElementNode,
  name: DollarString,
  block: unknown,
): void {
  let blocks = node._stateBlocks;
  if (blocks === undefined) {
    // No prototype: a block named like an Object method is no block.
    blocks = Object.create(null) as Record<string, unknown>;
    node._stateBlocks = blocks;
  }
  blocks[name] = block;
}

/** The `$state` block of `state`: the node's own, else the style's. */
export function stateBlock(
  node: ElementNode,
  state: string,
): Record<string, unknown> | undefined {
  const own = node._stateBlocks;
  let block = own !== undefined ? own[state] : undefined;
  if (block === undefined) {
    const style = node._style;
    if (style !== undefined) {
      // A style object: its keys are strings.
      block = (style as Record<string, unknown>)[state];
    }
  }
  return isObject(block) ? block : undefined;
}

/**
 * Append the keys of the `$state` block `block` that `keys` does not hold
 * yet (they are written for the first time). Returns the new count.
 */
export function trackKeys(
  block: Record<string, unknown> | undefined,
  keys: string[],
  count: number,
  applied: Record<string, unknown>,
): number {
  if (block === undefined) {
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

/**
 * The base value undo restores: theme[key], else style[key] (pinned), else
 * `undefined`, which each setter takes as the prop's default (spec 5.3: the
 * store default, the TextState default, a rounded-family prop taken off the
 * shader), clearing its `_set` byte.
 */
export function styleFallback(node: ElementNode, key: string): unknown {
  // Theme and style objects: their keys are strings.
  const theme = node._theme as Record<string, unknown> | undefined;
  let value = theme !== undefined ? theme[key] : undefined;
  if (value === undefined) {
    // A style object: its keys are strings.
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
export function resolveStateValue(
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
    const block = stateBlock(node, state);
    if (block !== undefined) {
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

/**
 * Write every tracked border-family key again, in tracked order, with the
 * value the state change resolved for it (`_applied`): see `_writeStates`.
 */
export function rewriteBorderKeys(node: ElementNode, count: number): void {
  const keys = node._undoStyles!;
  const applied = node._applied!;
  for (let i = 0; i < count; i++) {
    const key = keys[i]!;
    if (BORDER_FAMILY[key] === true) {
      writeKey(node, key, applied[key]);
    }
  }
}
