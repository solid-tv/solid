import { createSignal, createMemo, createEffect, JSX, untrack, Index } from "solid-js";
import { type NodeProps, ElementNode, NewOmit, hasFocus } from "@solidtv/solid";
import { chainRefs } from "./utils/chainFunctions.js";

export interface GridItemProps<T> {
  item:   T
  index:  number
  width:  number
  height: number
  x:      number
  y:      number
}

export interface GridProps<T> extends NewOmit<NodeProps, 'children'> {
  items: readonly T[];
  children: (props: GridItemProps<T>) => JSX.Element,
  itemHeight?: number;
  itemWidth?: number;
  itemOffset?: number;
  columns?: number;
  looping?: boolean;
  scroll?: "auto" | "none";
  selected?: number;
  onSelectedChanged?: (index: number, grid: ElementNode, elm?: ElementNode) => void;
}

export function Grid<T>(props: GridProps<T>): JSX.Element {

  const [focusedIndex, setFocusedIndex] = createSignal(0);
  const baseColumns = 4;

  createEffect(() => {
    const currentIndex = untrack(focusedIndex);
    if (props.selected === currentIndex) return;
    if (props.selected !== undefined && props.items?.length > props.selected) {
      moveFocus(props.selected - currentIndex);
    }
  });

  const itemWidth = () => props.itemWidth ?? 300
  const itemHeight = () => props.itemHeight ?? 300

  const columns = createMemo(() => props.columns || baseColumns);
  const totalWidth = createMemo(() => itemWidth() + (props.itemOffset ?? 0));
  const totalHeight = createMemo(() => itemHeight() + (props.itemOffset ?? 0));
  const rows = createMemo(() => Math.ceil(props.items.length / columns()));

  function focus() {
    const focusedElm = gridRef.children[focusedIndex()];
    if (focusedElm instanceof ElementNode && !hasFocus(focusedElm)) {
      focusedElm.setFocus();
      props.onSelectedChanged?.call(gridRef, focusedIndex(), gridRef, focusedElm);
      return true;
    }
    return false;
  }

  function moveFocus(delta: number) {
    if (!props.items || props.items.length === 0) return false;
    const newIndex = focusedIndex() + delta;

    if (newIndex >= 0 && newIndex < props.items.length) {
      setFocusedIndex(newIndex);
    } else if (props.looping) {
      const totalItems = props.items.length;
      if (delta < 0) {
        const lastRowStart = totalItems - (totalItems % columns()) || totalItems - columns();
        const target = lastRowStart + (focusedIndex() % columns());
        setFocusedIndex(target < totalItems ? target : target - columns());
      } else {
        setFocusedIndex(focusedIndex() % columns());
      }
    } else {
      return false;
    }
    return focus();
  };

  function handleHorizontalFocus(delta: number) {
    if (!props.items || props.items.length === 0) return false;
    const newIndex = focusedIndex() + delta;
    const isWithinRow = Math.floor(newIndex / columns()) === Math.floor(focusedIndex() / columns());

    if (newIndex >= 0 && newIndex < props.items.length && isWithinRow) {
      setFocusedIndex(newIndex);
    } else if (props.looping) {
      const rowStart = Math.floor(focusedIndex() / columns()) * columns();
      const rowEnd = Math.min(rowStart + columns() - 1, props.items.length - 1);
      setFocusedIndex(delta > 0 ? (newIndex > rowEnd ? rowStart : newIndex) : newIndex < rowStart ? rowEnd : newIndex);
    } else {
      return false;
    }
    return focus();
  };

  // Handle focus when items change - important for autofocus
  createEffect(() => {
    if (props.items && props.items.length > 0 && gridRef && hasFocus(gridRef)) {
      queueMicrotask(focus)
    }
  })

  function scrollToIndex(this: ElementNode, index: number) {
    untrack(() => {
      if (!props.items || props.items.length === 0) return;

      if (!hasFocus(gridRef)) {
        gridRef.setFocus();
      }

      const clampedIndex = Math.max(0, Math.min(index, props.items.length - 1));
      setFocusedIndex(clampedIndex);
      queueMicrotask(focus);
    });
  }

  const scrollY = createMemo(() =>
    props.scroll === "none" ? props.y ?? 0 : -Math.floor(focusedIndex() / columns()) * totalHeight() + (props.y || 0)
  );

  // Created once. The spread below re-runs on every vertical move (for `y`),
  // and handlers built inline in it were new functions each time. Each runs
  // the app's handler of the same name first (read when called, so a reactive
  // one still applies) and stops if it returns true.
  type HandlerName = "onUp" | "onDown" | "onLeft" | "onRight" | "onFocus";
  function chainProp(name: HandlerName, own: () => boolean) {
    return function (this: ElementNode, a: unknown, b: unknown, c: unknown, d?: unknown) {
      const user = props[name] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof user === "function" && user.call(this, a, b, c, d) === true) return true;
      return own();
    };
  }
  const onUp = chainProp("onUp", () => moveFocus(-columns()));
  const onDown = chainProp("onDown", () => moveFocus(columns()));
  const onLeft = chainProp("onLeft", () => handleHorizontalFocus(-1));
  const onRight = chainProp("onRight", () => handleHorizontalFocus(1));
  const onFocus = chainProp("onFocus", () => handleHorizontalFocus(0));

  let gridRef!: ElementNode;
  return (
    <view
      {...props}
      ref={chainRefs(el => gridRef = el, props.ref)}
      transition={/* @once */ { y: true }}
      height={totalHeight() * rows()}
      scrollToIndex={/* @once */ scrollToIndex}
      onUp={/* @once */ onUp}
      onDown={/* @once */ onDown}
      onLeft={/* @once */ onLeft}
      onRight={/* @once */ onRight}
      onFocus={/* @once */ onFocus}
      y={scrollY()}
    >
      <Index each={props.items}>
        {(item, index) => (
          <props.children
            item={item()}
            index={index}
            width={itemWidth()}
            height={itemHeight()}
            x={(index % columns()) * totalWidth()}
            y={Math.floor(index / columns()) * totalHeight()}
          />
        )}
      </Index>
    </view>
  );
};
