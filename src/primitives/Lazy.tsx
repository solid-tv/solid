import * as lng from '@solidtv/solid';
import * as lngp from '@solidtv/solid/primitives';
import * as s from 'solid-js';

type LazyProps<T extends readonly any[]> = lng.NewOmit<lng.NodeProps, 'children'> & {
  each: T | undefined | null | false;

  /** Initial visible item count before user navigation. */
  upCount: number;

  /**
   * Items to keep rendered ahead of the current selection. When selection
   * moves within this distance of the rendered edge, the next item is
   * scheduled to mount. Default depends on the scroll mode.
   */
  buffer?: number;

  /**
   * Milliseconds to wait after a navigation key press before mounting the
   * next item. Should match the scroll animation duration — mounting items
   * mid-animation causes jank. If the user presses again before this timer
   * fires (faster than the animation), an item is added synchronously to
   * keep the rendered window ahead of selection.
   */
  delay?: number;

  /** Render `upCount` items synchronously on mount instead of ramping up. */
  sync?: boolean;

  /** Continue mounting items in the background past `upCount`. */
  eagerLoad?: boolean;

  /** Skip refocusing the container when `each.length` changes. */
  noRefocus?: boolean;

  children: (item: s.Accessor<T[number]>, index: number) => s.JSX.Element;
};

// Lifecycle when props.each changes:
//  1. items memo invalidates → <Index> reconciles → new ElementNodes mounted (sync)
//  2. refocus effect runs (microtask) → calls viewRef.setFocus()
//  3. setFocus queues runPostMutation
//  4. post-mutation: delete-flush → layout → setActiveElement
// Children are always mounted before focus is applied; do not wrap setFocus
// in queueMicrotask — it only adds a redundant defer.
//
// Navigation key handler (updateOffset):
//  - On each onRight/onDown, if selection is within `buffer` of the rendered
//    edge, mount one more item. With `delay` set, the mount is deferred until
//    the scroll animation completes so it doesn't drop a frame mid-animation.
//    If the user out-paces `delay`, the mount fires synchronously instead.
function createLazy<T>(
  component: s.ValidComponent,
  props: LazyProps<readonly T[]>,
  keyHandler: (updateOffset: (event: KeyboardEvent, container: lng.ElementNode) => void) => Record<string, (event: KeyboardEvent, container: lng.ElementNode) => void>
) {
  // Need at least one item so it can be focused
  const [offset, setOffset] = s.createSignal<number>(props.sync ? props.upCount : 0);
  let preloadTimer: ReturnType<typeof setTimeout> | null = null;
  let navDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let viewRef!: lngp.NavigableElement;
  let itemLength = 0;

  s.onCleanup(() => {
    disposed = true;
    if (preloadTimer) clearTimeout(preloadTimer);
    if (navDelayTimer) clearTimeout(navDelayTimer);
  });

  const buffer = s.createMemo(() => {
    if (typeof props.buffer === 'number') {
      return props.buffer;
    }
    const scroll = props.scroll || props.style?.scroll;
    if (
      !scroll ||
      scroll === 'auto' ||
      scroll === 'always' ||
      scroll === 'bounded'
    )
      return props.upCount + 1;
    if (scroll === 'center') return Math.ceil(props.upCount / 2) + 1;
    return 2;
  });

  s.createRenderEffect(() => setOffset(offset => Math.max(offset, (props.selected || 0) + buffer())));

  if (!props.sync || props.eagerLoad) {
    s.createEffect(() => {
      if (!props.each) return;
      // Cancel any in-flight preload chain from a prior effect run before
      // starting a new one — otherwise two chains share state and race.
      if (preloadTimer) {
        clearTimeout(preloadTimer);
        preloadTimer = null;
      }
      const loadItems = () => {
        if (disposed) return;
        const count = s.untrack(offset);
        if (count < props.upCount) {
          setOffset(count + 1);
          preloadTimer = setTimeout(loadItems, 16); // ~60fps
        } else if (props.eagerLoad) {
          const maxOffset = props.each ? props.each.length : 0;
          if (count >= maxOffset) return;
          setOffset((prev) => Math.min(prev + 1, maxOffset));
          lng.scheduleTask(loadItems);
        }
      };
      loadItems();
    });
  }

  // Refocus when each.length changes. Side effect kept out of the items memo
  // (memos must be pure — Solid may skip evaluation when there are no readers).
  s.createEffect(() => {
    if (!Array.isArray(props.each)) {
      itemLength = 0;
      return;
    }
    const len = props.each.length;
    if (itemLength !== len) {
      itemLength = len;
      if (viewRef && !viewRef.noRefocus && lng.hasFocus(viewRef)) {
        // Clamp selected so a shrunk list doesn't refocus a disposed index.
        if (typeof viewRef.selected === 'number' && viewRef.selected >= len) {
          viewRef.selected = Math.max(0, len - 1);
        }
        viewRef.setFocus();
      }
    }
  });

  const items: s.Accessor<T[]> = s.createMemo(() =>
    Array.isArray(props.each) ? props.each.slice(0, offset()) : [],
  );

  function lazyScrollToIndex(this: lngp.NavigableElement, index: number, options?: {noFocus?: boolean}) {
    setOffset(Math.max(index, 0) + buffer())
    queueMicrotask(() => viewRef.scrollToIndex(index, options));
  }

  const updateOffset = (_event: KeyboardEvent, container: lng.ElementNode) => {
    const maxOffset = props.each ? props.each.length : 0;
    const selected = container.selected || 0;
    const rendered = offset(); // == container.children.length

    // Already mounted everything, or still far enough from the rendered edge
    // that the buffer covers the next selection — no work to do.
    if (rendered >= maxOffset || selected < rendered - buffer()) return;

    const bump = () => setOffset((prev) => Math.min(prev + 1, maxOffset));

    // No animation to hide behind — mount immediately.
    if (!props.delay) {
      bump();
      return;
    }

    // A delayed mount from the previous press hasn't fired yet, which means
    // the user is navigating faster than the scroll animation. Drop the wait
    // (we can't smooth a frame the user is already past) and mount now.
    if (navDelayTimer) {
      clearTimeout(navDelayTimer);
      bump();
    }

    // Schedule the trailing mount to land after the scroll animation completes,
    // so a single item mount doesn't jank the in-flight animation.
    navDelayTimer = setTimeout(() => {
      bump();
      navDelayTimer = null;
    }, props.delay);
  };

  const handler = keyHandler(updateOffset);

  return (
    <lng.Dynamic
      {...props}
      component={component}
      {/* @once */ ...handler}
      lazyScrollToIndex={lazyScrollToIndex}
      ref={lngp.chainRefs(el => { viewRef = el as lngp.NavigableElement; }, props.ref)} >
      <s.Index each={items()} children={props.children} />
    </lng.Dynamic>
  );
}

export function LazyRow<T extends readonly any[]>(props: LazyProps<T>) {
  return createLazy(lngp.Row, props, (updateOffset) => ({ onRight: updateOffset }));
}

export function LazyColumn<T extends readonly any[]>(props: LazyProps<T>) {
  return createLazy(lngp.Column, props, (updateOffset) => ({ onDown: updateOffset }));
}
