import { isArray, isString } from './utils.js';
import type { DollarString } from './intrinsicTypes.js';
export type NodeStates =
  | DollarString[]
  | DollarString
  | Record<DollarString, boolean | undefined>;

export default class States extends Array<DollarString> {
  private onChange: () => void;

  constructor(callback: () => void, initialState: NodeStates = {}) {
    if (isArray(initialState)) {
      super(...initialState);
    } else if (isString(initialState)) {
      super(initialState); // Assert as DollarString
    } else {
      super(
        ...Object.entries(initialState)
          .filter(([_key, value]) => value)
          .map(([key]) => key as DollarString), // Assert as DollarString
      );
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
      this.length = 0; // Clear the current states
      this.push(...newStates);
    } else if (isString(newStates)) {
      this.length = 0; // Clear the current states
      this.push(newStates); // Assert as DollarString
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
            this.splice(stateIndexToRemove, 1);
          }
        }
      }
    }
    return this;
  }

  remove(state: DollarString) {
    const stateIndexToRemove = this.indexOf(state);
    if (stateIndexToRemove >= 0) {
      this.splice(stateIndexToRemove, 1);
      this.onChange();
    }
  }
}
