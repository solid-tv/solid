import {
  createMemo,
  untrack,
  type Component,
  type Element as JSXElement,
} from 'solid-js';

/**
 * Lazily load a function component asynchronously.
 *
 * Ported from Solid's own `lazy()`. Two things changed for Solid 2.0:
 *
 *  - `createResource` was removed. An async compute is the replacement: reading
 *    the memo suspends to the nearest `<Loading>` boundary until it resolves.
 *  - The hydration branch is gone. It read and wrote `sharedConfig.context` /
 *    `.count` / `.done`, but SolidTV renders to WebGL/Canvas and never hydrates,
 *    so that path was dead code carried over from the original.
 */
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>,
): T & { preload: () => Promise<{ default: T }> } {
  let comp: (() => T | undefined) | undefined;
  let p: Promise<{ default: T }> | undefined;

  const wrap: T & { preload?: () => void } = ((props: any) => {
    if (!comp) {
      // Returning the promise directly (rather than an `async` compute) keeps
      // this file free of async syntax, which matters for the Chrome 38 target.
      comp = createMemo(() => (p || (p = fn())).then((mod) => mod.default));
    }
    return createMemo(() => {
      const Comp = comp!();
      return Comp ? untrack(() => Comp(props)) : null;
    }) as unknown as JSXElement;
  }) as T;

  wrap.preload = () =>
    p || ((p = fn()).then((mod) => (comp = () => mod.default)), p);

  return wrap as T & { preload: () => Promise<{ default: T }> };
}
