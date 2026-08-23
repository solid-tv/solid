import { createEffect, type Accessor } from 'solid-js';

type Deps<S> = Accessor<S> | ReadonlyArray<Accessor<unknown>>;

/**
 * Solid 1.x's `createEffect(on(deps, fn, options))`, rebuilt on Solid 2.0's
 * compute/effect split.
 *
 * `on()` was removed in 2.0. The compute/effect pair covers the common case,
 * but not two details this codebase relies on:
 *
 *  - `options.defer` — skip the first run. 2.0 always runs the effect after the
 *    first compute, so the skip is tracked here.
 *  - the third callback argument, `prevValue` — in 1.x the callback's *return*
 *    became the next call's `prevValue`. In 2.0 an effect's return value is a
 *    cleanup function instead, so that accumulator is threaded through a
 *    closure rather than the return.
 *
 * Keeping these exact means the primitives behave as they did under 1.x. This
 * is internal — consumers should use `createEffect(compute, effect)` directly.
 */
export function createEffectOn<S, R>(
  deps: Deps<S>,
  fn: (input: S, prevInput: S | undefined, prevValue: R | undefined) => R,
  options?: { defer?: boolean },
): void {
  const read = (
    Array.isArray(deps) ? () => deps.map((d) => d()) : deps
  ) as Accessor<S>;

  let defer = options?.defer === true;
  let prevInput: S | undefined;
  let prevValue: R | undefined;

  createEffect(read, (input: S) => {
    if (defer) {
      // `defer` skips the first run entirely — it must not seed prevInput or
      // prevValue, matching 1.x where the callback simply never fired.
      defer = false;
      return;
    }
    const currentPrevInput = prevInput;
    prevInput = input;
    prevValue = fn(input, currentPrevInput, prevValue);
  });
}
