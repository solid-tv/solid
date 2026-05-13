import * as lng from '@solidtv/solid';
import * as lngp from '@solidtv/solid/primitives';
import * as s from 'solid-js';

type LazyProps<T extends readonly any[]> = lng.NewOmit<lng.NodeProps, 'children'> & {
  each: T | undefined | null | false;
  upCount: number;
  buffer?: number;
  delay?: number;
  sync?: boolean;
  eagerLoad?: boolean;
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

  function lazyScrollToIndex(this: lngp.NavigableElement, index: number) {
    setOffset(Math.max(index, 0) + buffer())
    queueMicrotask(() => viewRef.scrollToIndex(index));
  }

  const updateOffset = (_event: KeyboardEvent, container: lng.ElementNode) => {
    const maxOffset = props.each ? props.each.length : 0;
    const selected = container.selected || 0;
    const numChildren = container.children.length;
    if (offset() >= maxOffset || selected < numChildren - buffer()) return;

    if (!props.delay) {
      setOffset((prev) => Math.min(prev + 1, maxOffset));
      return;
    }

    if (navDelayTimer) {
      clearTimeout(navDelayTimer);
      //Moving faster than the delay so need to go sync
      setOffset((prev) => Math.min(prev + 1, maxOffset));
    }

    navDelayTimer = setTimeout(() => {
      setOffset((prev) => Math.min(prev + 1, maxOffset));
      navDelayTimer = null;
    }, props.delay ?? 0);
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
