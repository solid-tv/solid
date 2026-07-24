import { mergeProps as solidMergeProps } from 'solid-js';

/**
 * Whether the host engine implements ES2015 `Proxy`. Chrome < 49 — notably the
 * Chrome 38 engine on LG webOS 3.x and older Tizen — does not, which changes how
 * solid-js merges props (see {@link mergeProps}).
 */
export const SUPPORTS_PROXY = typeof Proxy === 'function';

/**
 * Mirror of solid-js's internal `resolveSource`: a reactive spread source is
 * handed to `mergeProps` as a thunk; calling it yields the object to merge.
 */
function resolveSource(source: unknown): unknown {
  const value =
    typeof source === 'function' ? (source as () => unknown)() : source;
  return value == null ? {} : value;
}

/**
 * Proxy-free-safe `mergeProps`, re-exported by the renderer so the JSX compiler
 * (`moduleName: '@lightningtv/solid'`) routes every compiled spread through it.
 *
 * With `Proxy` this is solid-js's `mergeProps` unchanged. Without `Proxy`
 * (Chrome 38 / webOS 3), solid-js falls back to a path that enumerates each
 * source via `Object.getOwnPropertyNames`. A reactive spread — e.g.
 * `<Comp {...someFn()} />`, which the compiler passes as a *function* — reaches
 * that fallback as the function itself, so enumeration yields `['length','name']`
 * (or throws on `caller`/`callee`/`arguments` for strict-mode functions) instead
 * of the object's props, and every spread-provided prop is silently dropped.
 *
 * Resolving function sources to their objects first lets the fallback enumerate
 * real props. Getters are preserved, so values stay reactive; only a source
 * whose object *identity* changes over time won't re-track — an accepted limit
 * of running without `Proxy`.
 *
 * @see https://github.com/solidjs/solid/issues/2282
 */
export const mergeProps = ((...sources: unknown[]) => {
  if (SUPPORTS_PROXY) {
    return solidMergeProps(...(sources as Parameters<typeof solidMergeProps>));
  }
  return solidMergeProps(
    ...(sources.map((source) =>
      typeof source === 'function' ? resolveSource(source) : source,
    ) as Parameters<typeof solidMergeProps>),
  );
}) as typeof solidMergeProps;
