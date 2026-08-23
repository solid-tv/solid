import { merge } from 'solid-js';

/**
 * Whether the host engine implements ES2015 `Proxy`. Chrome < 49 — notably the
 * Chrome 38 engine on LG webOS 3.x and older Tizen — does not, which changes how
 * solid-js merges props (see {@link mergeProps}).
 *
 * Solid keeps the same check internally (`@solidjs/signals`
 * `core/constants.js`) but does not re-export it, so we mirror the expression
 * rather than import it.
 */
export const SUPPORTS_PROXY = typeof Proxy === 'function';

/**
 * Mirror of solid-js's internal `resolveSource`: a reactive spread source is
 * handed to `merge` as a thunk; calling it yields the object to merge.
 */
function resolveSource(source: unknown): unknown {
  const value =
    typeof source === 'function' ? (source as () => unknown)() : source;
  return value == null ? {} : value;
}

/**
 * Proxy-free-safe `merge`, re-exported by the renderer under the name
 * `mergeProps` because that is what the JSX compiler emits
 * (`moduleName: '@solidtv/solid'` → `import { mergeProps } from '@solidtv/solid'`),
 * so every compiled spread routes through it.
 *
 * With `Proxy` this is solid-js's `merge` unchanged. Without `Proxy`
 * (Chrome 38 / webOS 3), `merge` wraps each function source in `createMemo`
 * *before* its `SUPPORTS_PROXY` branch, then falls back to enumerating each
 * source with `Object.getOwnPropertyNames`. A reactive spread — e.g.
 * `<Comp {...someFn()} />`, which the compiler passes as a *function* — reaches
 * that fallback as the memo accessor, so enumeration yields `['length','name']`
 * instead of the object's props, and every spread-provided prop is silently
 * dropped.
 *
 * Resolving function sources to their objects first lets the fallback enumerate
 * real props. Getters are preserved, so values stay reactive; only a source
 * whose object *identity* changes over time won't re-track — an accepted limit
 * of running without `Proxy`.
 *
 * Verified against solid-js 2.0.0-rc.1: the 1.x bug shape carries forward
 * unchanged, and so does this fix.
 *
 * @see https://github.com/solidjs/solid/issues/2282
 */
export const mergeProps = ((...sources: unknown[]) => {
  if (SUPPORTS_PROXY) {
    return merge(...(sources as Parameters<typeof merge>));
  }
  return merge(
    ...(sources.map((source) =>
      typeof source === 'function' ? resolveSource(source) : source,
    ) as Parameters<typeof merge>),
  );
}) as typeof merge;
