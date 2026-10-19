import { isArray, isString } from './utils.js';
import type { DollarString } from './intrinsicTypes.js';
export type NodeStates =
  | DollarString[]
  | DollarString
  | Record<DollarString, boolean | undefined>;

/**
 * A node's states: an Array of `$` names with these methods.
 *
 * A plain Array (Array.prototype), with the methods as own non-enumerable
 * properties, not an Array subclass: V8's fast push and pop take only an
 * Array of the initial prototype, and on any other array the generic path
 * drops the backing store when the list empties (length 0), so the next
 * add allocated a new one (76 bytes) on every focus change, state toggle
 * and forwardStates copy. Spread, slice, indexing, `Array.isArray` and
 * `for…in` read it as before.
 */
export default interface States extends Array<DollarString> {
  /** Called after a change (add, toggle, remove). */
  readonly onChange: () => void;
  /** Has `state`; `has('focus')` also matches `$focus`. */
  has(state: DollarString): boolean;
  /** Has exactly `state`. */
  is(state: DollarString): boolean;
  add(state: DollarString): void;
  toggle(state: DollarString, force?: boolean): void;
  /**
   * An array or a string replaces the list; an object adds its truthy keys
   * and removes its falsy ones. Does not call onChange.
   */
  merge(newStates: NodeStates): States;
  remove(state: DollarString): void;
}

/** Drops the entry at `index`, shifting the rest down in place; pop keeps the store. */
function removeAt(states: States, index: number): void {
  const last = states.length - 1;
  for (let i = index; i < last; i++) {
    states[i] = states[i + 1]!;
  }
  states.pop();
}

function has(this: States, state: DollarString): boolean {
  if (this.indexOf(state) >= 0) {
    return true;
  }
  // temporary check for $ prefix, so has('focus') matches '$focus'. A query
  // that already starts with '$' could only match a doubled prefix, which
  // nothing produces, so skip the lookup: this runs per path element on
  // every focus change and the template string was a per-call allocation.
  return (
    state.charCodeAt(0) !== 36 &&
    this.indexOf(('$' + state) as DollarString) >= 0
  );
}

function is(this: States, state: DollarString): boolean {
  return this.indexOf(state) >= 0;
}

function add(this: States, state: DollarString): void {
  if (this.has(state)) {
    return;
  }
  this.push(state);
  this.onChange();
}

function toggle(this: States, state: DollarString, force?: boolean): void {
  if (force === true) {
    this.add(state);
  } else if (force === false) {
    this.remove(state);
  } else {
    if (this.has(state)) {
      this.remove(state);
    } else {
      this.add(state);
    }
  }
}

function merge(this: States, newStates: NodeStates): States {
  if (newStates === this) {
    // As 1.6 (length = 0, then a spread of the emptied list): a self-merge
    // clears the list.
    this.length = 0;
  } else if (isArray(newStates)) {
    // Copied by index, then cut to length by pop (which keeps the store): a
    // spread ran the iterator protocol over the list (with forwardStates,
    // the parent's States).
    const n = newStates.length;
    for (let i = 0; i < n; i++) {
      this[i] = newStates[i]!;
    }
    while (this.length > n) {
      this.pop();
    }
  } else if (isString(newStates)) {
    this[0] = newStates;
    this.length = 1;
  } else {
    for (const state in newStates) {
      const value = newStates[state as DollarString];
      if (value) {
        if (!this.has(state as DollarString)) {
          this.push(state as DollarString);
        }
      } else {
        const stateIndexToRemove = this.indexOf(state as DollarString);
        if (stateIndexToRemove >= 0) {
          removeAt(this, stateIndexToRemove);
        }
      }
    }
  }
  return this;
}

function remove(this: States, state: DollarString): void {
  let stateIndexToRemove = this.indexOf(state);
  // remove('focus') removes '$focus', as has('focus') matches it (B2).
  if (stateIndexToRemove < 0 && state.charCodeAt(0) !== 36) {
    stateIndexToRemove = this.indexOf(('$' + state) as DollarString);
  }
  if (stateIndexToRemove >= 0) {
    removeAt(this, stateIndexToRemove);
    this.onChange();
  }
}

// One descriptor map for every list: the methods are added in one order, so
// every States shares one hidden class. `value` only: non-enumerable, as a
// class's prototype methods were.
const METHODS: PropertyDescriptorMap = {
  has: { value: has },
  is: { value: is },
  add: { value: add },
  toggle: { value: toggle },
  merge: { value: merge },
  remove: { value: remove },
};

/** A States list, calling `callback` after each change. */
export function createStates(
  callback: () => void,
  initialState: NodeStates = {},
): States {
  const list: DollarString[] = [];
  if (isArray(initialState)) {
    // By index: a spread runs the iterator protocol (an iterator and an
    // arguments list per call).
    const n = initialState.length;
    for (let i = 0; i < n; i++) {
      list[i] = initialState[i]!;
    }
  } else if (isString(initialState)) {
    list[0] = initialState;
  } else {
    for (const key in initialState) {
      if (initialState[key as DollarString]) list.push(key as DollarString);
    }
  }
  Object.defineProperties(list, METHODS);
  Object.defineProperty(list, 'onChange', { value: callback });
  // The methods and onChange were just defined on it: it is a States now.
  return list as States;
}
