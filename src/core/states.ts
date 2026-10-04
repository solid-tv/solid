import { isArray, isString } from './utils.js';
import type { DollarString } from './intrinsicTypes.js';
export type NodeStates =
  | DollarString[]
  | DollarString
  | Record<DollarString, boolean | undefined>;

export default class States extends Array<DollarString> {
  // Assigned in the constructor, not a class field (no field emit).
  declare private onChange: () => void;

  // Array methods (slice, splice, filter, …) build a plain Array, not a
  // States: building a States ran this constructor with a length as its
  // callback, once per remove().
  static override get [Symbol.species]() {
    return Array;
  }

  constructor(callback: () => void, initialState: NodeStates = {}) {
    if (isArray(initialState)) {
      // By index: a spread runs the iterator protocol (an iterator and an
      // arguments list per call).
      super();
      const n = initialState.length;
      for (let i = 0; i < n; i++) {
        this[i] = initialState[i]!;
      }
    } else if (isString(initialState)) {
      super(initialState); // Assert as DollarString
    } else {
      super();
      for (const key in initialState) {
        if (initialState[key as DollarString]) this.push(key as DollarString);
      }
    }

    this.onChange = callback;
    return this;
  }

  has(state: DollarString) {
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

  is(state: DollarString) {
    return this.indexOf(state) >= 0;
  }

  add(state: DollarString) {
    if (this.has(state)) {
      return;
    }
    this.push(state);
    this.onChange();
  }

  toggle(state: DollarString, force?: boolean) {
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

  merge(newStates: NodeStates) {
    if (isArray(newStates)) {
      // Copied by index, then cut to length: a spread ran the iterator
      // protocol over the list (with forwardStates, the parent's States).
      const n = newStates.length;
      for (let i = 0; i < n; i++) {
        this[i] = newStates[i]!;
      }
      this.length = n;
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
            this.removeAt(stateIndexToRemove);
          }
        }
      }
    }
    return this;
  }

  remove(state: DollarString) {
    let stateIndexToRemove = this.indexOf(state);
    // remove('focus') removes '$focus', as has('focus') matches it (B2).
    if (stateIndexToRemove < 0 && state.charCodeAt(0) !== 36) {
      stateIndexToRemove = this.indexOf(('$' + state) as DollarString);
    }
    if (stateIndexToRemove >= 0) {
      this.removeAt(stateIndexToRemove);
      this.onChange();
    }
  }

  // Shift in place: splice would allocate the array of removed entries.
  private removeAt(index: number) {
    const last = this.length - 1;
    for (let i = index; i < last; i++) {
      this[i] = this[i + 1]!;
    }
    this.length = last;
  }
}
