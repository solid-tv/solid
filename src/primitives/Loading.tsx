import * as s from 'solid-js';

/**
 * Tracks all async reads inside a component and renders a fallback until they
 * all resolve.
 *
 * ```tsx
 * const data = createMemo(() => fetchThing());
 *
 * <Loading fallback={<LoadingIndicator />}>
 *   <view>
 *     <text>{data()}</text>
 *   </view>
 * </Loading>
 * ```
 *
 * Renamed from `Suspense` in SolidTV 2.0, tracking Solid 2.0's rename of
 * `Suspense` → `Loading`.
 *
 * BEHAVIOUR CHANGE FROM 1.x: the 1.x version called Solid's `Suspense` as a
 * plain function, treated the return value as a memo accessor, and used it to
 * mount the children into an off-screen `<view hidden>` while suspended so the
 * Lightning renderer could warm their textures early. That trick relied on 1.x
 * Suspense internals: it created the children eagerly and kept them reachable
 * while suspended. In 2.0 `Loading` returns an `Element`, and the children do
 * not exist until the suspending read resolves — so there are no nodes to warm,
 * and the off-screen slot has been dropped rather than faked.
 *
 * @see https://docs.solidjs.com/reference/components/suspense
 */
export function Loading(props: {
  fallback?: s.Element;
  children: s.Element;
}): s.Element {
  return s.Loading({
    fallback: props.fallback,
    get children() {
      return props.children;
    },
  });
}
