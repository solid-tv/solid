import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import * as lngp from '@solidtv/solid/primitives';
import { List } from '@solid-primitives/list';
import * as utils from '../utils.js';
import {
  defaultTransitionBack,
  defaultTransitionForward,
  defaultTransitionDown,
  defaultTransitionUp,
} from './utils/handleNavigation.js';
import { createVirtualWindow } from './utils/createVirtualWindow.js';
import { createVirtualAnimation } from './utils/createVirtualAnimation.js';

export type VirtualProps<T> = lng.NewOmit<lngp.RowProps, 'children'> & {
  each: readonly T[] | undefined | null | false;
  displaySize: number;
  /** Number of items to pre-render outside the visible window. Default: 2. */
  buffer?: number;
  wrap?: boolean;
  scrollIndex?: number;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  debugInfo?: boolean;
  factorScale?: boolean;
  uniformSize?: boolean;
  children: (item: s.Accessor<T>, index: s.Accessor<number>) => s.JSX.Element;
};

function createVirtual<T>(
  component: typeof lngp.Row | typeof lngp.Column,
  props: VirtualProps<T>,
  keyHandlers: Record<string, lng.KeyHandler>,
) {
  const isRow = component === lngp.Row;
  const axis = isRow ? 'x' : 'y';

  const bufferSize = s.createMemo(() => props.buffer ?? 2);
  const scrollIndex = s.createMemo(() => props.scrollIndex ?? 0);
  const scrollType = s.createMemo(
    () => (props.scroll as 'auto' | 'edge' | 'always' | 'none') ?? 'auto',
  );
  const items = s.createMemo(() => (props.each || []) as T[]);
  const itemCount = s.createMemo(() => items().length);

  const vwindow = createVirtualWindow<T>({
    items,
    displaySize: props.displaySize,
    buffer: bufferSize,
    scroll: scrollType,
    scrollIndex,
    wrap: props.wrap,
    debugInfo: props.debugInfo,
  });

  const animation = createVirtualAnimation(axis);

  let cachedScaledSize: number | undefined;
  const uniformSize = s.createMemo(() => props.uniformSize !== false);

  let viewRef!: lngp.NavigableElement;

  function computeSize(selectedInSlice: number): number {
    if (uniformSize() && cachedScaledSize) {
      return cachedScaledSize;
    }
    if (viewRef) {
      const gap = viewRef.gap ?? 0;
      const dimension = isRow ? 'width' : 'height';
      const child = viewRef.children[selectedInSlice];
      if (child instanceof lng.ElementNode) {
        const itemSize = child[dimension] ?? 0;
        const focusStyle = child.style?.focus as lng.NodeStyles;
        const scale = ((focusStyle?.scale ?? child.scale ?? 1) as number);
        const size = (itemSize as number) * (props.factorScale ? scale : 1) + (gap as number);
        if (uniformSize()) cachedScaledSize = size;
        return size;
      }
    }
    return 0;
  }

  const onSelectedChanged: lngp.OnSelectedChanged = function (
    idx,
    elm,
    active,
    lastIdx,
  ) {
    const noChange = idx === lastIdx;

    if (props.onSelectedChanged) {
      props.onSelectedChanged.call(
        this as lngp.NavigableElement,
        idx,
        this as lngp.NavigableElement,
        active,
        lastIdx,
      );
    }

    if (noChange) return;

    const rawDelta = idx - (lastIdx ?? 0);
    vwindow.navigate(rawDelta);

    const newSlice = vwindow.slice();
    elm.selected = newSlice.selected;

    if (
      props.onEndReachedThreshold !== undefined &&
      vwindow.cursor() >= itemCount() - props.onEndReachedThreshold
    ) {
      props.onEndReached?.();
    }

    if (newSlice.shiftBy === 0) return;

    // Capture the active child's screen position before layout updates
    const prevScreenPos =
      (animation.getTargetPosition() ?? this[axis]) + active[axis];

    queueMicrotask(() => {
      elm.updateLayout();
      const childSize = computeSize(vwindow.slice().selected);
      animation.start(this, prevScreenPos, active, childSize, newSlice.shiftBy);
    });
  };

  function scrollToIndex(this: lng.ElementNode, index: number) {
    s.untrack(() => {
      if (itemCount() === 0) return;
      animation.resetToOrigin(viewRef);
      if (!lng.hasFocus(viewRef)) {
        viewRef.setFocus();
      }
      const safeSel = utils.clamp(index, 0, itemCount() - 1);
      updateSelected([safeSel]);
      if (
        props.onEndReachedThreshold !== undefined &&
        safeSel >= itemCount() - props.onEndReachedThreshold
      ) {
        props.onEndReached?.();
      }
    });
  }

  const updateSelected = ([sel, _items]: [number?, unknown?]) => {
    if (!viewRef || sel === undefined || itemCount() === 0) return;

    const safeSel = utils.clamp(sel, 0, itemCount() - 1);
    const item = items()[safeSel];

    vwindow.scrollToIndex(safeSel);
    const newSlice = vwindow.slice();

    queueMicrotask(() => {
      viewRef.updateLayout();

      const activeIndex = viewRef.children.findIndex((x) => x.item === item);
      if (activeIndex === -1) return;

      viewRef.selected = activeIndex;
      if (lng.hasFocus(viewRef)) {
        viewRef.children[activeIndex]?.setFocus();
      }

      if (newSlice.shiftBy === 0) return;

      const childSize = computeSize(vwindow.slice().selected);
      if (!animation.hasOrigin()) {
        animation.initOrigin(viewRef);
      }
      viewRef.lng[axis] = (viewRef.lng[axis] ?? 0) + childSize * -1;
    });
  };

  // One-time initialization of the wrap offset
  let wrapInitDone = false;
  s.createEffect(
    s.on([() => props.wrap, items], () => {
      if (!viewRef || itemCount() === 0 || !props.wrap || wrapInitDone) return;
      wrapInitDone = true;

      if (itemCount() <= props.displaySize) {
        queueMicrotask(() => animation.initOrigin(viewRef));
        return;
      }

      // Offset the container by -1 item so the buffer item before start is hidden
      queueMicrotask(() => {
        const childSize = computeSize(vwindow.slice().selected);
        animation.initOrigin(viewRef, childSize * -1);
        viewRef.lng[axis] = animation.getTargetPosition()!;
      });
    }),
  );

  // React to external selected prop changes and item array replacements
  s.createEffect(s.on([() => props.selected, items], updateSelected));

  // Clamp cursor when items array shrinks and refresh the slice
  s.createEffect(
    s.on(items, () => {
      if (!viewRef) return;
      const c = Math.min(vwindow.cursor(), Math.max(0, itemCount() - 1));
      vwindow.scrollToIndex(c);
      viewRef.selected = vwindow.slice().selected;
    }),
  );

  const initialSelected = () => {
    if (itemCount() <= props.displaySize) {
      return utils.clamp(
        props.selected ?? 0,
        0,
        Math.max(0, itemCount() - 1),
      );
    }
    if (props.wrap) {
      return Math.max(bufferSize(), scrollIndex());
    }
    return utils.clamp(
      props.selected ?? 0,
      0,
      Math.max(0, itemCount() - 1),
    );
  };

  return (
    <view
      transition={/* @once */ {}}
      transitionLeft={isRow ? defaultTransitionBack : undefined}
      transitionRight={isRow ? defaultTransitionForward : undefined}
      transitionUp={!isRow ? defaultTransitionUp : undefined}
      transitionDown={!isRow ? defaultTransitionDown : undefined}
      {...props}
      {...keyHandlers}
      ref={lngp.chainRefs((el) => {
        viewRef = el as lngp.NavigableElement;
      }, props.ref)}
      selected={initialSelected()}
      cursor={vwindow.cursor()}
      forwardFocus={/* @once */ lngp.navigableForwardFocus}
      scrollToIndex={/* @once */ scrollToIndex}
      onSelectedChanged={/* @once */ onSelectedChanged}
      style={
        /* @once */ lng.combineStyles(
          props.style,
          component === lngp.Row
            ? { display: 'flex', gap: 30 }
            : { display: 'flex', flexDirection: 'column', gap: 30 },
        )
      }
    >
      <List each={vwindow.slice().items}>{props.children}</List>
    </view>
  );
}

export function VirtualRow<T>(props: VirtualProps<T>) {
  return createVirtual(lngp.Row, props, {
    onLeft: lngp.chainFunctions(
      props.onLeft,
      lngp.handleNavigation('left'),
    ) as lng.KeyHandler,
    onRight: lngp.chainFunctions(
      props.onRight,
      lngp.handleNavigation('right'),
    ) as lng.KeyHandler,
  });
}

export function VirtualColumn<T>(props: VirtualProps<T>) {
  return createVirtual(lngp.Column, props, {
    onUp: lngp.chainFunctions(
      props.onUp,
      lngp.handleNavigation('up'),
    ) as lng.KeyHandler,
    onDown: lngp.chainFunctions(
      props.onDown,
      lngp.handleNavigation('down'),
    ) as lng.KeyHandler,
  });
}
