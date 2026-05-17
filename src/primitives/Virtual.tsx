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
  wrap?: boolean;
  scrollIndex?: number;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  debugInfo?: boolean;
  children: (item: s.Accessor<T>, index: s.Accessor<number>) => s.JSX.Element;
};

type DerivedDims = {
  visibleCount: number;
  bufferSize: number;
  itemSize: number;
};

function createVirtual<T>(
  component: typeof lngp.Row | typeof lngp.Column,
  props: VirtualProps<T>,
  keyHandlers: Record<string, lng.KeyHandler>,
) {
  const isRow = component === lngp.Row;
  const axis = isRow ? 'x' : 'y';
  const sizeDim = isRow ? 'width' : 'height';
  const [cursor, setCursor] = s.createSignal(props.selected ?? 0);
  const scrollIndex = s.createMemo(() => props.scrollIndex || 0);
  const items = s.createMemo(() => props.each || []);
  const itemCount = s.createMemo(() => items().length);
  const scrollType = s.createMemo(() => props.scroll || 'auto');

  // Derived from a single measurement of the container + first child.
  // `undefined` means we haven't measured yet — slice rendering stays in probe mode.
  const [derivedDims, setDerivedDims] = s.createSignal<DerivedDims | undefined>();
  const visibleCount = () => derivedDims()?.visibleCount ?? 0;
  const bufferSize = () => derivedDims()?.bufferSize ?? 2;

  const selected = () => {
    const vc = visibleCount();
    const total = itemCount();
    if (!vc) {
      return utils.clamp(props.selected || 0, 0, Math.max(0, total - 1));
    }
    if (total <= vc) {
      return utils.clamp(props.selected || 0, 0, Math.max(0, total - 1));
    }
    if (props.wrap) {
      return Math.max(bufferSize(), scrollIndex());
    }
    return utils.clamp(props.selected || 0, 0, Math.max(0, total - 1));
  };

  let targetPosition: number | undefined;
  let cachedAnimationController: lng.IAnimationController | undefined;

  type SliceState = {
    start: number;
    slice: T[];
    selected: number;
    delta: number;
    shiftBy: number;
    atStart: boolean;
    cursor: number;
  };
  const [slice, setSlice] = s.createSignal<SliceState>({
    start: 0,
    slice: [],
    selected: 0,
    delta: 0,
    shiftBy: 0,
    atStart: true,
    cursor: 0,
  });

  function normalizeDeltaForWindow(delta: number, windowLen: number): number {
    if (!windowLen) return 0;
    const half = windowLen / 2;
    if (delta > half) return delta - windowLen;
    if (delta < -half) return delta + windowLen;
    return delta;
  }

  function computeSize() {
    return derivedDims()?.itemSize ?? 0;
  }

  function computeSlice(
    c: number,
    delta: number,
    prev: SliceState,
  ): SliceState {
    const total = itemCount();
    const vc = visibleCount();
    if (total === 0 || vc === 0)
      return {
        start: 0,
        slice: [],
        selected: 0,
        delta,
        shiftBy: 0,
        atStart: true,
        cursor: 0,
      };

    if (total <= vc) {
      return {
        start: 0,
        slice: items() as T[],
        selected: utils.clamp(c, 0, total - 1),
        delta,
        shiftBy: 0,
        atStart: c <= 0,
        cursor: utils.clamp(c, 0, total - 1),
      };
    }

    const buf = bufferSize();
    const length = vc + buf;
    let start = prev.start;
    let selected = prev.selected;
    let atStart = prev.atStart;
    let shiftBy = -delta;

    switch (scrollType()) {
      case 'always':
        if (props.wrap) {
          start = utils.mod(c - 1, total);
          selected = 1;
        } else {
          start = utils.clamp(
            c - buf,
            0,
            Math.max(0, total - vc - buf),
          );
          if (delta === 0 && c > 3) {
            shiftBy = c < 3 ? -c : -2;
            selected = 2;
          } else {
            selected =
              c < buf
                ? c
                : c >= total - vc
                  ? c - (total - vc) + buf
                  : buf;
          }
        }
        break;

      case 'auto':
        if (props.wrap) {
          if (delta === 0) {
            selected = scrollIndex() || 1;
            start = utils.mod(c - (scrollIndex() || 1), total);
          } else {
            start = utils.mod(c - (prev.selected || 1), total);
          }
        } else {
          if (delta < 0) {
            // Moving left
            if (prev.start > 0 && prev.selected >= vc) {
              start = prev.start;
              selected = prev.selected - 1;
            } else if (prev.start > 0) {
              start = prev.start - 1;
              selected = prev.selected;
            } else if (prev.start === 0 && !prev.atStart) {
              start = 0;
              selected = prev.selected - 1;
              atStart = true;
            } else if (selected >= vc - 1) {
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
            } else if (prev.start >= total - vc) {
              start = prev.start;
              selected = c - start;
              shiftBy = 0;
            } else {
              start = prev.start + 1;
              selected = Math.max(prev.selected, scrollIndex() + 1);
            }
          } else {
            // Initial setup
            if (c > 0) {
              start = Math.min(
                c - (scrollIndex() || 1),
                total - vc - buf,
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
          vc + (atStart ? -1 : 0),
        );
        if (props.wrap) {
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
        start = 0;
        selected = c;
        shiftBy = 0;
        break;
    }

    let newSlice = prev.slice;
    if (start !== prev.start || newSlice.length === 0) {
      newSlice = props.wrap
        ? (Array.from(
            { length },
            (_, i) => items()[utils.mod(start + i, total)],
          ) as T[])
        : items().slice(start, start + length);
    }

    const state: SliceState = {
      start,
      slice: newSlice,
      selected,
      delta,
      shiftBy,
      atStart,
      cursor: c,
    };

    if (props.debugInfo) {
      console.log(`[Virtual]`, {
        cursor: c,
        delta,
        start,
        selected,
        shiftBy,
        slice: state.slice,
      });
    }

    return state;
  }

  let viewRef!: lngp.NavigableElement;

  function scrollToIndex(this: lng.ElementNode, index: number) {
    s.untrack(() => {
      if (itemCount() === 0 || !derivedDims()) return;

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

    if (noChange || !derivedDims()) return;

    const rawDelta = idx - (lastIdx ?? 0);
    const windowLen =
      elm?.children?.length ?? visibleCount() + bufferSize();
    const delta = props.wrap
      ? normalizeDeltaForWindow(rawDelta, windowLen)
      : rawDelta;

    setCursor((c) => {
      const next = c + delta;
      return props.wrap
        ? utils.mod(next, total)
        : utils.clamp(next, 0, total - 1);
    });

    const newState = computeSlice(cursor(), delta, slice());
    setSlice(newState);
    elm.selected = newState.selected;

    if (
      props.onEndReachedThreshold !== undefined &&
      cursor() >= itemCount() - props.onEndReachedThreshold
    ) {
      props.onEndReached?.();
    }

    if (newState.shiftBy === 0) return;

    const prevChildPos = (targetPosition ?? this[axis]) + active[axis];

    queueMicrotask(() => {
      elm.updateLayout();
      const childSize = computeSize();

      if (
        cachedAnimationController &&
        cachedAnimationController.state === 'running'
      ) {
        cachedAnimationController.stop();
      }

      if (lng.Config.animationsEnabled) {
        this.lng[axis] = prevChildPos - active[axis];
        targetPosition = this.lng[axis] + childSize * slice().shiftBy;
        cachedAnimationController = this.animate(
          { [axis]: targetPosition },
          {
            ...this.animationSettings,
            duration: getAdaptiveDuration(this.animationSettings?.duration),
          },
        ).start();
      } else {
        this.lng[axis] = this.lng[axis]! + childSize * slice().shiftBy;
      }
    });
  };

  const updateSelected = ([sel, _items]: [number?, any?]) => {
    if (!viewRef || sel === undefined || itemCount() === 0 || !derivedDims())
      return;
    const safeSel = utils.clamp(sel, 0, itemCount() - 1);
    const item = items()[safeSel];
    setCursor(safeSel);
    const newState = computeSlice(safeSel, 0, slice());
    setSlice(newState);

    queueMicrotask(() => {
      viewRef.updateLayout();
      const activeIndex = viewRef.children.findIndex((x) => x.item === item);
      if (activeIndex === -1) return;
      viewRef.selected = activeIndex;
      if (lng.hasFocus(viewRef)) {
        viewRef.children[activeIndex]?.setFocus();
      }

      if (newState.shiftBy === 0) return;

      const childSize = computeSize();
      // Original Position is offset to support scrollToIndex
      originalPosition = originalPosition ?? viewRef.lng[axis];
      targetPosition = targetPosition ?? viewRef.lng[axis];

      viewRef.lng[axis] = (viewRef.lng[axis] || 0) + childSize * -1;
    });
  };

  // Measure container + first probe child, derive visibleCount/bufferSize.
  function measureAndInit() {
    if (!viewRef || derivedDims() || itemCount() === 0) return;

    viewRef.updateLayout();
    const containerSize = viewRef[sizeDim] || 0;
    if (!containerSize) return;

    const firstChild = viewRef.children[0];
    if (!(firstChild instanceof lng.ElementNode)) return;

    const childSize = firstChild[sizeDim] || 0;
    if (!childSize) return;

    const gap = viewRef.gap || 0;
    const itemSize = childSize + gap;
    const vc = Math.max(1, Math.floor(containerSize / itemSize));
    const buf = Math.max(2, Math.ceil(vc * 0.25));

    if (props.debugInfo) {
      console.log('[Virtual] measured', {
        containerSize,
        childSize,
        gap,
        visibleCount: vc,
        bufferSize: buf,
      });
    }

    setDerivedDims({ visibleCount: vc, bufferSize: buf, itemSize });

    const sel = utils.clamp(props.selected ?? 0, 0, itemCount() - 1);
    setCursor(sel);
    const initialState = computeSlice(sel, 0, slice());
    setSlice(initialState);
    viewRef.selected = initialState.selected;
  }

  // Re-attempt measurement when items first populate (covers async load).
  s.createEffect(() => {
    items();
    if (!viewRef || derivedDims() || itemCount() === 0) return;
    queueMicrotask(measureAndInit);
  });

  let doOnce = false;
  s.createEffect(
    s.on([() => props.wrap, items], () => {
      if (
        !viewRef ||
        itemCount() === 0 ||
        !props.wrap ||
        doOnce ||
        !derivedDims()
      )
        return;
      doOnce = true;
      if (itemCount() <= visibleCount()) {
        queueMicrotask(() => {
          originalPosition = viewRef.lng[axis];
          targetPosition = viewRef.lng[axis];
        });
        return;
      }
      // offset just for wrap so we keep one item before
      queueMicrotask(() => {
        const childSize = computeSize();
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
      if (!viewRef || !derivedDims()) return;
      let c = cursor();
      if (c >= itemCount()) {
        c = Math.max(0, itemCount() - 1);
        setCursor(c);
      }
      const newState = computeSlice(c, 0, slice());
      setSlice(newState);
      viewRef.selected = newState.selected;
    }),
  );

  // Before measurement completes, render just the first item so we have
  // something to measure. Once derivedDims is set, render the real slice.
  const renderedSlice = s.createMemo(() => {
    if (!derivedDims()) {
      const list = items();
      return list.length > 0 ? ([list[0]] as T[]) : [];
    }
    return slice().slice;
  });

  return (
    <view
      transitionLeft={isRow ? defaultTransitionBack : undefined}
      transitionRight={isRow ? defaultTransitionForward : undefined}
      transitionUp={!isRow ? defaultTransitionUp : undefined}
      transitionDown={!isRow ? defaultTransitionDown : undefined}
      {...props}
      {...keyHandlers}
      ref={lngp.chainRefs((el) => {
        viewRef = el as lngp.NavigableElement;
        queueMicrotask(measureAndInit);
      }, props.ref)}
      selected={selected()}
      cursor={cursor()}
      forwardFocus={/* @once */ lngp.navigableForwardFocus}
      scrollToIndex={/* @once */ scrollToIndex}
      onSelectedChanged={/* @once */ onSelectedChanged}
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
      <List each={renderedSlice()}>{props.children}</List>
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
