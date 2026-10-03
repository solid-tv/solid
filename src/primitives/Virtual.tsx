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

export type VirtualProps<T> = lng.NewOmit<lngp.RowProps, 'children'> & {
  each: readonly T[] | undefined | null | false;
  displaySize: number;
  bufferSize?: number;
  wrap?: boolean;
  /** With `wrap`, defers wrap behavior until the first right press. Ignored when `selected` is non-zero at mount. */
  skipInitialWrap?: boolean;
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
  const [cursor, setCursor] = s.createSignal(props.selected ?? 0);
  const bufferSize = s.createMemo(() => props.bufferSize || 2);
  const scrollIndex = s.createMemo(() => props.scrollIndex || 0);
  const items = s.createMemo(() => props.each || []);
  const itemCount = s.createMemo(() => items().length);
  const scrollType = s.createMemo(() => props.scroll || 'auto');

  const initiallyLocked =
    !!props.skipInitialWrap &&
    !!props.wrap &&
    (props.selected ?? 0) === 0;
  const [wrapUnlocked, setWrapUnlocked] = s.createSignal(!initiallyLocked);
  const effectiveWrap = s.createMemo(() => !!props.wrap && wrapUnlocked());

  const selected = () => {
    if (itemCount() <= props.displaySize) {
      return utils.clamp(props.selected || 0, 0, Math.max(0, itemCount() - 1));
    }
    if (props.wrap && !initiallyLocked) {
      return Math.max(bufferSize(), scrollIndex());
    }
    return utils.clamp(props.selected || 0, 0, Math.max(0, itemCount() - 1));
  };

  let cachedScaledSize: number | undefined;
  let targetPosition: number | undefined;
  let cachedAnimationController: lng.IAnimationController | undefined;
  const uniformSize = s.createMemo(() => {
    return props.uniformSize !== false;
  });

  type SliceState = {
    start: number;
    slice: T[];
    selected: number;
    delta: number;
    shiftBy: number;
    atStart: boolean;
    cursor: number;
  };
  const noItems: T[] = [];
  // One state object, updated in place by computeSlice, so a press allocates
  // no state. The mounted items have a signal of their own: <List> re-runs
  // only when the window's items change, not on every press.
  const slice: SliceState = {
    start: 0,
    slice: noItems,
    selected: 0,
    delta: 0,
    shiftBy: 0,
    atStart: true,
    cursor: 0,
  };
  const [sliceItems, setSliceItems] = s.createSignal<T[]>(noItems);
  // Set when the window's items change, cleared by the row's next flex pass
  // (onLayout): the window shift lays the row out only if nothing else has.
  let layoutPending = false;

  function normalizeDeltaForWindow(delta: number, windowLen: number): number {
    if (!windowLen) return 0;
    const half = windowLen / 2;
    if (delta > half) return delta - windowLen;
    if (delta < -half) return delta + windowLen;
    return delta;
  }

  function computeSize(selected: number = 0) {
    if (uniformSize() && cachedScaledSize) {
      return cachedScaledSize;
    } else if (viewRef) {
      const gap = viewRef.gap || 0;
      const dimension = isRow ? 'width' : 'height'; // This can't be moved up as it depends on viewRef
      const prevSelectedChild = viewRef.children[selected];

      if (prevSelectedChild instanceof lng.ElementNode) {
        const itemSize = prevSelectedChild[dimension] || 0;
        // B14: the focus state's styles are on the node under `$focus`;
        // `style.focus` was never set, so the scale was missed whenever the
        // size was measured before the child had focus.
        const focusStyle = prevSelectedChild.$focus as
          | lng.NodeStyles
          | undefined;
        const scale = focusStyle?.scale ?? prevSelectedChild.scale ?? 1;
        const scaledSize = itemSize * (props.factorScale ? scale : 1) + gap;
        cachedScaledSize = scaledSize;
        return scaledSize;
      }
    }
    return 0;
  }

  function applySlice(
    start: number,
    windowItems: T[],
    selected: number,
    delta: number,
    shiftBy: number,
    atStart: boolean,
    c: number,
  ): SliceState {
    const prevItems = slice.slice;
    slice.start = start;
    slice.slice = windowItems;
    slice.selected = selected;
    slice.delta = delta;
    slice.shiftBy = shiftBy;
    slice.atStart = atStart;
    slice.cursor = c;
    if (windowItems !== prevItems) {
      layoutPending = true;
      setSliceItems(windowItems);
    }
    return slice;
  }

  function computeSlice(c: number, delta: number): SliceState {
    const prev = slice;
    const total = itemCount();
    if (total === 0) return applySlice(0, noItems, 0, delta, 0, true, 0);

    if (total <= props.displaySize) {
      const clamped = utils.clamp(c, 0, total - 1);
      return applySlice(
        0,
        items() as T[],
        clamped,
        delta,
        0,
        c <= 0,
        clamped,
      );
    }

    const length = props.displaySize + bufferSize();
    let start = prev.start;
    let selected = prev.selected;
    let atStart = prev.atStart;
    let shiftBy = -delta;

    switch (scrollType()) {
      case 'always':
        if (effectiveWrap()) {
          start = utils.mod(c - 1, total);
          selected = 1;
        } else {
          start = utils.clamp(
            c - bufferSize(),
            0,
            Math.max(0, total - props.displaySize - bufferSize()),
          );
          if (delta === 0 && c > 3) {
            shiftBy = c < 3 ? -c : -2;
            selected = 2;
          } else {
            selected =
              c < bufferSize()
                ? c
                : c >= total - props.displaySize
                  ? c - (total - props.displaySize) + bufferSize()
                  : bufferSize();
          }
        }
        break;

      case 'auto':
        if (effectiveWrap()) {
          if (delta === 0) {
            selected = scrollIndex() || 1;
            start = utils.mod(c - (scrollIndex() || 1), total);
          } else {
            start = utils.mod(c - (prev.selected || 1), total);
          }
        } else {
          if (delta < 0) {
            // Moving left
            if (prev.start > 0 && prev.selected >= props.displaySize) {
              // Move selection left inside slice
              start = prev.start;
              selected = prev.selected - 1;
            } else if (prev.start > 0) {
              // Move selection left inside slice
              start = prev.start - 1;
              selected = prev.selected;
              // shiftBy = 0;
            } else if (prev.start === 0 && !prev.atStart) {
              start = 0;
              selected = prev.selected - 1;
              atStart = true;
            } else if (selected >= props.displaySize - 1) {
              // Shift window left, keep selection pinned
              start = 0;
              selected = prev.selected - 1;
            } else {
              start = 0;
              selected = prev.selected - 1;
              shiftBy = 0;
            }
          } else if (delta > 0) {
            // Moving right
            if (prev.selected < scrollIndex()) {
              // Move selection right inside slice
              start = prev.start;
              selected = prev.selected + 1;
              shiftBy = 0;
            } else if (prev.selected === scrollIndex() || atStart) {
              start = prev.start;
              selected = prev.selected + 1;
              atStart = false;
            } else if (prev.start === 0 && prev.selected === 0) {
              start = 0;
              selected = 1;
              atStart = false;
            } else if (prev.start >= total - props.displaySize) {
              // At end: clamp slice, selection drifts right
              start = prev.start;
              selected = c - start;
              shiftBy = 0;
            } else {
              // Shift window right, keep selection pinned
              start = prev.start + 1;
              selected = Math.max(prev.selected, scrollIndex() + 1);
            }
          } else {
            // Initial setup
            if (c > 0) {
              start = Math.min(
                c - (scrollIndex() || 1),
                total - props.displaySize - bufferSize(),
              );
              selected = Math.max(scrollIndex() || 1, c - start);
              shiftBy = total - c < 3 ? c - total : -1;
              atStart = false;
            } else {
              // ScrollToIndex was called
              if (c !== prev.cursor) {
                start = c;
                if (c === 0) {
                  atStart = true;
                  selected = 0;
                }
              } else {
                start = prev.start;
                selected = prev.selected;
              }
            }
          }
        }
        break;

      case 'edge': {
        const startScrolling = Math.max(
          1,
          props.displaySize + (atStart ? -1 : 0),
        );
        if (effectiveWrap()) {
          if (delta > 0) {
            if (prev.selected < startScrolling) {
              selected = prev.selected + 1;
              shiftBy = 0;
            } else if (prev.selected === startScrolling && atStart) {
              selected = prev.selected + 1;
              atStart = false;
            } else {
              start = utils.mod(prev.start + 1, total);
              selected = prev.selected;
            }
          } else if (delta < 0) {
            if (prev.selected > 1) {
              selected = prev.selected - 1;
              shiftBy = 0;
            } else {
              start = utils.mod(prev.start - 1, total);
              selected = 1;
            }
          } else {
            start = utils.mod(c - 1, total);
            selected = 1;
            shiftBy = -1;
            atStart = false;
          }
        } else {
          if (delta === 0 && c > 0) {
            //initial setup
            selected = c > startScrolling ? startScrolling : c;
            start = Math.max(0, c - startScrolling + 1);
            shiftBy = c > startScrolling ? -1 : 0;
            atStart = c < startScrolling;
          } else if (delta > 0) {
            if (prev.selected < startScrolling) {
              selected = prev.selected + 1;
              shiftBy = 0;
            } else if (prev.selected === startScrolling && atStart) {
              selected = prev.selected + 1;
              atStart = false;
            } else {
              start = prev.start + 1;
              selected = prev.selected;
              atStart = false;
            }
          } else if (delta < 0) {
            if (prev.selected > 1) {
              selected = prev.selected - 1;
              shiftBy = 0;
            } else if (c > 1) {
              start = Math.max(0, c - 1);
              selected = 1;
            } else if (c === 1) {
              start = 0;
              selected = 1;
            } else {
              start = 0;
              selected = 0;
              shiftBy = atStart ? 0 : shiftBy;
              atStart = true;
            }
          }
        }
        break;
      }
      case 'none':
      default:
        // B13: the window follows the cursor, keeping an item mounted on
        // each side of it so the next press finds a child. The row itself
        // does not scroll. VirtualRow does not implement "center": it
        // behaves as "none".
        start = prev.start;
        if (c + 1 >= start + length) {
          start = c + 2 - length;
        } else if (c - 1 < start) {
          start = c - 1;
        }
        start = utils.clamp(start, 0, Math.max(0, total - length));
        selected = c - start;
        shiftBy = 0;
        break;
    }

    let newSlice = prev.slice;
    if (start !== prev.start || newSlice.length === 0) {
      const all = items();
      if (effectiveWrap()) {
        newSlice = new Array<T>(length);
        for (let i = 0; i < length; i++) {
          newSlice[i] = all[utils.mod(start + i, total)] as T;
        }
      } else {
        newSlice = all.slice(start, start + length) as T[];
      }
    }

    if (props.debugInfo) {
      console.log(`[Virtual]`, {
        cursor: c,
        delta,
        start,
        selected,
        shiftBy,
        slice: newSlice,
      });
    }

    return applySlice(start, newSlice, selected, delta, shiftBy, atStart, c);
  }

  let viewRef!: lngp.NavigableElement;

  function scrollToIndex(this: lng.ElementNode, index: number) {
    s.untrack(() => {
      if (itemCount() === 0) return;

      lastNavTime = performance.now();
      if (originalPosition !== undefined) {
        viewRef.lng[axis] = originalPosition;
        targetPosition = originalPosition;
      }

      if (!lng.hasFocus(viewRef)) {
        // force focus as scrollToIndex is manually called
        viewRef.setFocus();
      }

      updateSelected([utils.clamp(index, 0, itemCount() - 1)]);
    });
  }

  let lastNavTime = 0;
  function getAdaptiveDuration(duration: number = 250) {
    const now = performance.now();
    const delta = now - lastNavTime;
    lastNavTime = now;
    if (delta < duration) return delta;
    return duration;
  }

  let originalPosition: number | undefined;

  // The window shift after a press, run in a microtask once the new window
  // is mounted. One function for every press (no closure per press): the
  // press stores what it needs here.
  let shiftView!: lng.ElementNode;
  let shiftActive!: lng.ElementNode;
  let shiftPrevChildPos = 0;
  // The shift animation's props and settings, reused: renderer v2 and the
  // DOM renderer copy both when they create the animation. The settings are
  // copied again from the row's animationSettings on every shift, into a
  // new object only when the row's settings object changes.
  const shiftProps: Partial<lng.AnimateProps> = isRow ? { x: 0 } : { y: 0 };
  let shiftSettings: lng.AnimationSettings = {};
  let shiftSettingsFrom: lng.AnimationSettings | undefined;
  function applyShift() {
    const view = shiftView;
    const active = shiftActive;
    // One flex pass per window shift: lay out here only if the post-mutation
    // layout has not already run since the window changed.
    if (layoutPending) view.updateLayout();
    const childSize = computeSize(slice.selected);

    if (
      cachedAnimationController &&
      cachedAnimationController.state === 'running'
    ) {
      cachedAnimationController.stop();
    }

    if (lng.Config.animationsEnabled) {
      view.lng[axis] = shiftPrevChildPos - active[axis];
      targetPosition = view.lng[axis] + childSize * slice.shiftBy;
      const settings = view.animationSettings;
      if (settings !== shiftSettingsFrom) {
        shiftSettings = {};
        shiftSettingsFrom = settings;
      }
      for (const key in settings) {
        (shiftSettings as Record<string, unknown>)[key] =
          settings[key as keyof lng.AnimationSettings];
      }
      shiftSettings.duration = getAdaptiveDuration(settings?.duration);
      shiftProps[axis] = targetPosition;
      cachedAnimationController = view
        .animate(shiftProps, shiftSettings)
        .start();
    } else {
      view.lng[axis] =
        shiftPrevChildPos - active[axis] + childSize * slice.shiftBy;
    }
  }

  const onSelectedChanged: lngp.OnSelectedChanged = function (
    _idx,
    elm,
    _active,
    _lastIdx,
  ) {
    const idx = _idx;
    const lastIdx = _lastIdx || 0;
    const active = _active;
    const noChange = idx === lastIdx;
    const total = itemCount();
    originalPosition = originalPosition ?? elm[axis];

    if (props.onSelectedChanged) {
      props.onSelectedChanged.call(this, idx, this, active, lastIdx);
    }

    if (noChange) return;

    const rawDelta = idx - (lastIdx ?? 0);
    const windowLen = elm?.children?.length ?? props.displaySize + bufferSize();
    const wrap = effectiveWrap();
    const delta = wrap ? normalizeDeltaForWindow(rawDelta, windowLen) : rawDelta;

    const next = s.untrack(cursor) + delta;
    const c = wrap ? utils.mod(next, total) : utils.clamp(next, 0, total - 1);
    setCursor(c);

    const newState = computeSlice(c, delta);
    elm.selected = newState.selected;

    if (!wrapUnlocked() && rawDelta > 0) setWrapUnlocked(true);

    if (
      props.onEndReachedThreshold !== undefined &&
      c >= itemCount() - props.onEndReachedThreshold
    ) {
      props.onEndReached?.();
    }

    if (newState.shiftBy === 0) return;

    // `elm` is the row (`this`): navigation calls it on itself.
    shiftView = elm;
    shiftActive = active;
    shiftPrevChildPos = (targetPosition ?? this[axis]) + active[axis];
    queueMicrotask(applyShift);
  };

  const updateSelected = ([sel, _items]: [number?, any?]) => {
    if (!viewRef || sel === undefined || itemCount() === 0) return;
    const safeSel = utils.clamp(sel, 0, itemCount() - 1);
    const item = items()[safeSel];
    setCursor(safeSel);
    const shiftBy = computeSlice(safeSel, 0).shiftBy;

    queueMicrotask(() => {
      if (layoutPending) viewRef.updateLayout();
      const activeIndex = viewRef.children.findIndex((x) => x.item === item);
      if (activeIndex === -1) return;
      viewRef.selected = activeIndex;
      if (lng.hasFocus(viewRef)) {
        viewRef.children[activeIndex]?.setFocus();
      }

      if (shiftBy === 0) return;

      const childSize = computeSize(slice.selected);
      // Original Position is offset to support scrollToIndex
      originalPosition = originalPosition ?? viewRef.lng[axis];
      targetPosition = targetPosition ?? viewRef.lng[axis];

      viewRef.lng[axis] = (viewRef.lng[axis] || 0) + childSize * -1;
    });
  };

  let doOnce = initiallyLocked;
  s.createEffect(
    s.on([effectiveWrap, items], () => {
      if (!viewRef || itemCount() === 0 || !effectiveWrap() || doOnce) return;
      doOnce = true;
      if (itemCount() <= props.displaySize) {
        queueMicrotask(() => {
          originalPosition = viewRef.lng[axis];
          targetPosition = viewRef.lng[axis];
        });
        return;
      }
      // offset just for wrap so we keep one item before
      queueMicrotask(() => {
        const childSize = computeSize(slice.selected);
        viewRef.lng[axis] = (viewRef.lng[axis] || 0) + childSize * -1;
        // Original Position is offset to support scrollToIndex
        originalPosition = viewRef.lng[axis];
        targetPosition = viewRef.lng[axis];
      });
    }),
  );

  s.createEffect(s.on([() => props.selected, items], updateSelected));

  s.createEffect(
    s.on(items, () => {
      if (!viewRef) return;
      let c = cursor();
      if (c >= itemCount()) {
        c = Math.max(0, itemCount() - 1);
        setCursor(c);
      }
      viewRef.selected = computeSlice(c, 0).selected;
    }),
  );

  // Clears layoutPending: the row's flex pass has run since the window
  // changed. The app's onLayout still runs, read when called.
  function onLayout(this: lng.ElementNode, target: lng.ElementNode) {
    layoutPending = false;
    return props.onLayout?.call(this, target);
  }

  const view = (
    <view
      transitionLeft={isRow ? defaultTransitionBack : undefined}
      transitionRight={isRow ? defaultTransitionForward : undefined}
      transitionUp={!isRow ? defaultTransitionUp : undefined}
      transitionDown={!isRow ? defaultTransitionDown : undefined}
      {...props}
      {...keyHandlers}
      ref={lngp.chainRefs((el) => {
        viewRef = el as lngp.NavigableElement;
      }, props.ref)}
      wrap={effectiveWrap()}
      selected={selected()}
      forwardFocus={/* @once */ lngp.navigableForwardFocus}
      scrollToIndex={/* @once */ scrollToIndex}
      onSelectedChanged={/* @once */ onSelectedChanged}
      onLayout={/* @once */ onLayout}
      style={
        /* @once */ lng.combineStyles(
        props.style,
        component === lngp.Row
          ? {
            display: 'flex',
            gap: 30,
          }
          : {
            display: 'flex',
            flexDirection: 'column',
            gap: 30,
          },
      )
      }
    >
      <List each={sliceItems()}>{props.children}</List>
    </view>
  );

  // `cursor` has an effect of its own: in the spread above, a cursor change
  // (every press) re-ran every prop of the spread.
  s.createRenderEffect(() => {
    viewRef.cursor = cursor();
  });

  return view;
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
