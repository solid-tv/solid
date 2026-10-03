import * as s from 'solid-js';
import * as lng from '@solidtv/solid';
import * as lngp from '@solidtv/solid/primitives';
import { List } from '@solid-primitives/list';
import * as utils from '../utils.js';
// Imported directly, not via lngp: this call runs at module init, and the
// barrel's withScrolling binding is not yet initialized when the barrel is
// the import entry (circular init — index.ts re-exports withScrolling after
// VirtualGrid).
import { withScrolling } from './utils/withScrolling.js';

const columnScroll = withScrolling(false);

const rowStyles: lng.NodeStyles = {
  display: 'flex',
  flexWrap: 'wrap',
  transition: {
    y: true,
  },
};

export type VirtualGridProps<T> = lng.NewOmit<lngp.RowProps, 'children'> & {
  each: readonly T[] | undefined | null | false;
  columns: number; // items per row
  rows?: number; // number of visible rows (default: 1)
  buffer?: number;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  children: (item: s.Accessor<T>, index: s.Accessor<number>) => s.JSX.Element;
};

export function VirtualGrid<T>(props: VirtualGridProps<T>): s.JSX.Element {
  const bufferSize = () => props.buffer ?? 2;
  const [ cursor, setCursor ] = s.createSignal(props.selected ?? 0);
  const items = s.createMemo(() => props.each || []);
  const itemCount = () => items().length;
  const itemsPerRow = () => props.columns;
  const numberOfRows = () => props.rows ?? 1;
  const totalVisibleItems = () => itemsPerRow() * numberOfRows();

  const start = s.createMemo(() => {
    const perRow = itemsPerRow();
    const newRowIndex = Math.floor(cursor() / perRow);
    const rawStart = newRowIndex * perRow - bufferSize() * perRow;
    return Math.max(0, rawStart);
  });

  const end = s.createMemo(() => {
    const perRow = itemsPerRow();
    const newRowIndex = Math.floor(cursor() / perRow);
    const rawEnd = (newRowIndex + bufferSize()) * perRow + totalVisibleItems();
    return Math.min(items().length, rawEnd);
  });

  const [slice, setSliceSignal] = s.createSignal(items().slice(start(), end()));
  // Set when the window's items change, cleared by the grid's next flex pass
  // (onLayout): a window shift lays the grid out only if nothing else has.
  let layoutPending = false;
  function setSlice(window: T[]) {
    layoutPending = true;
    setSliceSignal(window);
  }

  let viewRef!: lngp.NavigableElement;

  function onVerticalNav(dir: -1 | 1): lngp.KeyHandler {
    return function () {
      const perRow = itemsPerRow();
      const count = items().length;
      const currentRowIndex = Math.floor(cursor() / perRow);
      // B15: the last row's index. floor(length / perRow) was one row late
      // when the length is a multiple of perRow.
      const maxRows = Math.floor((count - 1) / perRow);

      if (
        currentRowIndex === 0 && dir === -1
        || currentRowIndex === maxRows && dir === 1
      ) return;

      const selected = this.selected || 0;
      const offset = dir * perRow;
      const newIndex = utils.clamp(selected + offset, 0, count - 1);
      const active = this.children[newIndex];

      // B15: `selected` changes only when there is a child to move to. It was
      // written first, so a Down with nothing below left it past the mounted
      // children and the next Up was lost.
      if (active instanceof lng.ElementNode) {
        this.selected = newIndex;
        active.setFocus();
        chainedOnSelectedChanged.call(
          this as lngp.NavigableElement,
          newIndex,
          this as lngp.NavigableElement,
          active,
          selected
        );
        return true;
      }
    };
  }

  const onUp = onVerticalNav(-1);
  const onDown = onVerticalNav(1);

  const onSelectedChanged: lngp.OnSelectedChanged = function (_idx, elm, active, _lastIdx,) {
    let idx = _idx;
    let lastIdx = _lastIdx;
    const perRow = itemsPerRow();
    const newRowIndex = Math.floor(idx / perRow);
    const prevRowIndex = Math.floor((lastIdx || 0) / perRow);
    const prevStart = start();

    setCursor(prevStart + idx);
    if (newRowIndex === prevRowIndex) return;

    setSlice(items().slice(start(), end()));

    // this.selected is relative to the slice
    // and it doesn't get corrected automatically after children change
    const idxCorrection = prevStart - start();
    if (lastIdx) lastIdx += idxCorrection;
    idx += idxCorrection;
    this.selected += idxCorrection;

    if (props.onEndReachedThreshold !== undefined && cursor() >= items().length - props.onEndReachedThreshold) {
      props.onEndReached?.();
    }

    // `elm` is the grid (`this`): navigation calls it on itself.
    shiftView = elm;
    shiftActive = active;
    shiftIdx = idx;
    shiftLastIdx = lastIdx;
    queueMicrotask(applyShift);
  };

  // The scroll after a row change, run in a microtask once the new window is
  // mounted. One function for every press (no closure per press): the press
  // stores what it needs here.
  let shiftView!: lngp.NavigableElement;
  let shiftActive!: lng.ElementNode;
  let shiftIdx = 0;
  let shiftLastIdx: number | undefined;
  function applyShift() {
    const view = shiftView;
    const active = shiftActive;
    const prevRowY = view.y + active.y;
    // One flex pass per window shift: lay out here only if the post-mutation
    // layout has not already run since the window changed.
    if (layoutPending) view.updateLayout();
    view.lng.y = prevRowY - active.y;
    columnScroll(shiftIdx, view, active, shiftLastIdx);
  }

  const chainedOnSelectedChanged = lngp.chainFunctions(props.onSelectedChanged, onSelectedChanged)!;

  let cachedSelected: number | undefined;
  const updateSelected = ([selected, _items]: [number?, any?]) => {
    if (!viewRef || selected == null) return;

    if (cachedSelected !== undefined) {
      selected = cachedSelected;
      cachedSelected = undefined;
    }

    if (selected >= items().length && props.onEndReached) {
      props.onEndReached?.();
      cachedSelected = selected;
      return;
    }

    const item = items()[selected];
    let active = viewRef.children.find(x => x.item === item);
    const lastSelected = viewRef.selected;

    if (active instanceof lng.ElementNode) {
      viewRef.selected = viewRef.children.indexOf(active);
      if (lng.hasFocus(viewRef)) {
        // force focus as scrollToIndex is manually called
        active.setFocus();
      }
      chainedOnSelectedChanged.call(viewRef, viewRef.selected, viewRef, active, lastSelected);
    } else {
      setCursor(selected);
      setSlice(items().slice(start(), end()));

      queueMicrotask(() => {
        if (layoutPending) viewRef.updateLayout();
        active = viewRef.children.find(x => x.item === item);
        if (active instanceof lng.ElementNode) {
          viewRef.selected = viewRef.children.indexOf(active);
          if (lng.hasFocus(viewRef)) {
            active.setFocus();
          }
          chainedOnSelectedChanged.call(viewRef, viewRef.selected, viewRef, active, lastSelected);
        }
      });
    }
  };

  const scrollToIndex = (index: number) => {
    s.untrack(() => updateSelected([index]));
  }

  s.createEffect(s.on([() => props.selected, items], updateSelected));

  s.createEffect(
    s.on(items, (gridItems, _prevGridItems, prevSize) => {
      if (!viewRef) return;

      if (cachedSelected !== undefined) {
        // This occurs when VG is reloaded and user wants to select a paginated item
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
    }, { defer: true })
  );


  // Clears layoutPending: the grid's flex pass has run since the window
  // changed. The app's onLayout still runs, read when called.
  function onLayout(this: lng.ElementNode, target: lng.ElementNode) {
    layoutPending = false;
    return props.onLayout?.call(this, target);
  }

  // B15: `selected` on the node is a child index into the window, set once
  // here and then by navigation and the selected effect. Passing the data
  // index (`props.selected`) made the first forwardFocus pick the wrong child,
  // and its reactive rewrite hid the previous child index from updateSelected.
  const initialSelected = s.untrack(() =>
    Math.max(0, (props.selected || 0) - start()),
  );

  const view = (
    <view
      {...props}
      scroll={props.scroll || 'always'}
      ref={lngp.chainRefs(el => { viewRef = el as lngp.NavigableElement; }, props.ref)}
      selected={/* @once */ initialSelected}
      onLayout={/* @once */ onLayout}
      onLeft={/* @once */ lngp.chainFunctions(props.onLeft, lngp.navigableHandleNavigation)}
      onRight={/* @once */ lngp.chainFunctions(props.onRight, lngp.navigableHandleNavigation)}
      onUp={/* @once */ lngp.chainFunctions(props.onUp, onUp)}
      onDown={/* @once */ lngp.chainFunctions(props.onDown, onDown)}
      forwardFocus={/* @once */ lngp.navigableForwardFocus}
      onCreate={/* @once */ props.selected ? lngp.chainFunctions(props.onCreate, columnScroll) : props.onCreate}
      scrollToIndex={/* @once */ scrollToIndex}
      onSelectedChanged={/* @once */ chainedOnSelectedChanged}
      style={/* @once */ lng.combineStyles(props.style, rowStyles)}
    >
      <List each={slice()}>{props.children}</List>
    </view>
  );

  // `cursor` has an effect of its own: in the spread above, a cursor change
  // (every press) re-ran every prop of the spread.
  s.createRenderEffect(() => {
    viewRef.cursor = cursor();
  });

  return view;
}
