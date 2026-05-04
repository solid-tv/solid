import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import * as lngp from '@solidtv/solid/primitives';
import { List } from '@solid-primitives/list';
import * as utils from '../utils.js';

const gridStyles: lng.NodeStyles = {
  display: 'flex',
  flexWrap: 'wrap',
  transition: {
    y: true,
  },
};

export type VirtualGridProps<T> = lng.NewOmit<lngp.RowProps, 'children'> & {
  each: readonly T[] | undefined | null | false;
  columns: number;
  rows?: number;
  buffer?: number;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  children: (item: s.Accessor<T>, index: s.Accessor<number>) => s.JSX.Element;
};

export function VirtualGrid<T>(props: VirtualGridProps<T>): s.JSX.Element {
  const bufferSize = () => props.buffer ?? 2;
  const [cursor, setCursor] = s.createSignal(props.selected ?? 0);
  const items = s.createMemo(() => (props.each || []) as T[]);
  const itemCount = () => items().length;
  const itemsPerRow = () => props.columns;
  const numberOfRows = () => props.rows ?? 1;
  const totalVisibleItems = () => itemsPerRow() * numberOfRows();

  const start = s.createMemo(() => {
    const perRow = itemsPerRow();
    const rowIndex = Math.floor(cursor() / perRow);
    return Math.max(0, (rowIndex - bufferSize()) * perRow);
  });

  const end = s.createMemo(() => {
    const perRow = itemsPerRow();
    const rowIndex = Math.floor(cursor() / perRow);
    return Math.min(
      items().length,
      (rowIndex + bufferSize()) * perRow + totalVisibleItems(),
    );
  });

  const [slice, setSlice] = s.createSignal(items().slice(start(), end()));

  let viewRef!: lngp.NavigableElement;

  // Tracks the container's initial y so 'always' scroll keeps items anchored at it
  let initialY: number | undefined;

  /** Scroll the container so `active` sits at the component's initial y offset. */
  function scrollColumn(elm: lngp.NavigableElement, active: lng.ElementNode) {
    initialY ??= elm.y ?? 0;
    const nextY = -(active.y ?? 0) + initialY;
    if (elm.y !== nextY) {
      elm.y = nextY;
    }
  }

  function onVerticalNav(dir: -1 | 1): lngp.KeyHandler {
    return function () {
      const perRow = itemsPerRow();
      const currentRowIndex = Math.floor(cursor() / perRow);
      const maxRows = Math.floor(itemCount() / perRow);

      if (
        (currentRowIndex === 0 && dir === -1) ||
        (currentRowIndex === maxRows && dir === 1)
      ) {
        return;
      }

      const selected = this.selected ?? 0;
      const newIndex = utils.clamp(
        selected + dir * perRow,
        0,
        itemCount() - 1,
      );
      const lastIdx = selected;
      this.selected = newIndex;
      const active = this.children[this.selected];

      if (active instanceof lng.ElementNode) {
        active.setFocus();
        chainedOnSelectedChanged.call(
          this as lngp.NavigableElement,
          this.selected,
          this as lngp.NavigableElement,
          active,
          lastIdx,
        );
        return true;
      }
    };
  }

  const onUp = onVerticalNav(-1);
  const onDown = onVerticalNav(1);

  const onSelectedChanged: lngp.OnSelectedChanged = function (
    idx,
    elm,
    active,
    lastIdx,
  ) {
    const perRow = itemsPerRow();
    const newRowIndex = Math.floor(idx / perRow);
    const prevRowIndex = Math.floor((lastIdx ?? 0) / perRow);
    const prevStart = start();

    setCursor(prevStart + idx);

    if (newRowIndex === prevRowIndex) return;

    setSlice(items().slice(start(), end()));

    // Correct the slice-relative selected index after the slice shifts
    const correction = prevStart - start();
    const correctedIdx = idx + correction;
    const correctedLastIdx = lastIdx !== undefined ? lastIdx + correction : lastIdx;
    this.selected += correction;

    if (
      props.onEndReachedThreshold !== undefined &&
      cursor() >= itemCount() - props.onEndReachedThreshold
    ) {
      props.onEndReached?.();
    }

    queueMicrotask(() => {
      const prevRowY = this.y + active.y;
      this.updateLayout();
      this.lng.y = prevRowY - active.y;
      scrollColumn(elm, active);
    });
  };

  const chainedOnSelectedChanged = lngp.chainFunctions(
    props.onSelectedChanged,
    onSelectedChanged,
  )!;

  let cachedSelected: number | undefined;

  const updateSelected = ([selected, _items]: [number?, unknown?]) => {
    if (!viewRef || selected == null) return;

    if (cachedSelected !== undefined) {
      selected = cachedSelected;
      cachedSelected = undefined;
    }

    if (selected >= itemCount() && props.onEndReached) {
      props.onEndReached?.();
      cachedSelected = selected;
      return;
    }

    const item = items()[selected];
    let active = viewRef.children.find((x) => x.item === item);
    const lastSelected = viewRef.selected;

    if (active instanceof lng.ElementNode) {
      viewRef.selected = viewRef.children.indexOf(active);
      if (lng.hasFocus(viewRef)) {
        active.setFocus();
      }
      chainedOnSelectedChanged.call(
        viewRef,
        viewRef.selected,
        viewRef,
        active,
        lastSelected,
      );
    } else {
      setCursor(selected);
      setSlice(items().slice(start(), end()));

      queueMicrotask(() => {
        viewRef.updateLayout();
        active = viewRef.children.find((x) => x.item === item);
        if (active instanceof lng.ElementNode) {
          viewRef.selected = viewRef.children.indexOf(active);
          if (lng.hasFocus(viewRef)) {
            active.setFocus();
          }
          chainedOnSelectedChanged.call(
            viewRef,
            viewRef.selected,
            viewRef,
            active,
            lastSelected,
          );
        }
      });
    }
  };

  const scrollToIndex = (index: number) => {
    s.untrack(() => updateSelected([index]));
  };

  s.createEffect(s.on([() => props.selected, items], updateSelected));

  s.createEffect(
    s.on(
      items,
      (gridItems, _prev, prevSize) => {
        if (!viewRef) return;

        if (cachedSelected !== undefined) {
          updateSelected([cachedSelected]);
          return gridItems.length;
        }

        if (gridItems.length === 0) {
          setCursor(0);
          cachedSelected = undefined;
          setSlice([]);
        } else if (cursor() >= itemCount()) {
          updateSelected([Math.max(0, itemCount() - 1)]);
        } else if (prevSize === 0) {
          updateSelected([0]);
        } else {
          setSlice(items().slice(start(), end()));
        }

        return gridItems.length;
      },
      { defer: true },
    ),
  );

  return (
    <view
      {...props}
      scroll={props.scroll || 'always'}
      ref={lngp.chainRefs(
        (el) => {
          viewRef = el as lngp.NavigableElement;
        },
        props.ref,
      )}
      selected={props.selected || 0}
      cursor={cursor()}
      onLeft={/* @once */ lngp.chainFunctions(
        props.onLeft,
        lngp.navigableHandleNavigation,
      )}
      onRight={/* @once */ lngp.chainFunctions(
        props.onRight,
        lngp.navigableHandleNavigation,
      )}
      onUp={/* @once */ lngp.chainFunctions(props.onUp, onUp)}
      onDown={/* @once */ lngp.chainFunctions(props.onDown, onDown)}
      forwardFocus={/* @once */ lngp.navigableForwardFocus}
      onCreate={
        /* @once */ props.selected
          ? lngp.chainFunctions(props.onCreate, function (this: lng.ElementNode) {
              const elm = this as lngp.NavigableElement;
              const active = elm.children[elm.selected ?? 0];
              if (active instanceof lng.ElementNode) {
                scrollColumn(elm, active);
              }
            })
          : props.onCreate
      }
      scrollToIndex={/* @once */ scrollToIndex}
      onSelectedChanged={/* @once */ chainedOnSelectedChanged}
      style={/* @once */ lng.combineStyles(props.style, gridStyles)}
    >
      <List each={slice()}>{props.children}</List>
    </view>
  );
}
