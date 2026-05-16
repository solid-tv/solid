import * as s from 'solid-js';

export type AnyFunction = (this: any, ...args: any[]) => any;

/**
 * take an array of functions and if you return `true` from a function, it will stop the chain
 * @param fns list of functions to chain together, can be `undefined`, `null`, or `false` to skip them
 * @returns a function that will call each function in the list until one returns `true` or all functions are called.
 * If no functions are provided, it will return `undefined`.
 *
 * @example
 * ```tsx
 * function Button (props: NodeProps) {
 *   function onEnter (el: ElementNode) {...}
 *   return <view onEnter={chainFunctions(props.onEnter, onEnter)} />
 * }
 * ```
 */
export function chainFunctions<T extends AnyFunction>(...fns: T[]): T;
export function chainFunctions<T extends AnyFunction>(
  ...fns: (T | undefined | null | false)[]
): T | undefined;
export function chainFunctions(
  ...fns: (AnyFunction | undefined | null | false)[]
): AnyFunction | undefined {
  // Inline filter to avoid the intermediate array allocation when most
  // callers pass 2 args and one or both happen to be falsy.
  let first: AnyFunction | undefined;
  let onlyFunctions: AnyFunction[] | undefined;
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i];
    if (typeof fn !== 'function') continue;
    if (first === undefined) {
      first = fn;
    } else {
      if (onlyFunctions === undefined) onlyFunctions = [first];
      onlyFunctions.push(fn);
    }
  }

  if (first === undefined) return undefined;
  if (onlyFunctions === undefined) return first;

  // Fast path: exactly two functions — the common case for ref/handler
  // forwarding (props.onX + local onX). Avoids the loop.
  if (onlyFunctions.length === 2) {
    const a = onlyFunctions[0]!;
    const b = onlyFunctions[1]!;
    return function (this: unknown, ...innerArgs) {
      const result = a.apply(this, innerArgs);
      if (result === true) return result;
      return b.apply(this, innerArgs);
    };
  }

  const chained = onlyFunctions;
  return function (this: unknown, ...innerArgs) {
    let result;
    for (let i = 0; i < chained.length; i++) {
      result = chained[i]!.apply(this, innerArgs);
      if (result === true) return result;
    }
    return result;
  };
}

/**
 * Utility for chaining multiple `ref` assignments with `props.ref` forwarding.
 * @param refs list of ref setters. Can be a `props.ref` prop for ref forwarding or a setter to a local variable (`el => ref = el`).
 * @example
 * ```tsx
 * function Button (props: NodeProps) {
 *    let localRef: ElementNode | undefined
 *    return <view ref={chainRefs(props.ref, el => localRef = el)} />
 * }
 * ```
 */
export const chainRefs = chainFunctions as <T>(
  ...refs: (s.Ref<T> | undefined)[]
) => (el: T) => void;
