import type {
  ElementNode,
  ElementText,
  INode,
  Styles,
} from '../../core/index.js';

export type Scroller = (
  selected: number | ElementNode,
  component?: ElementNode,
  selectedElement?: ElementNode | ElementText,
  lastSelected?: number,
) => void;

// Adds properties expected by withScrolling
export interface ScrollableElement extends ElementNode {
  scrollIndex?: number;
  scroll?: 'always' | 'none' | 'edge' | 'auto' | 'center' | 'bounded';
  selected: number;
  offset?: number;
  endOffset?: number;
  upCount?: number;
  onScrolled?: (
    elm: ScrollableElement,
    offset: number,
    isInitial: boolean,
  ) => void;
  _targetPosition?: number;
  _screenOffset?: number;
  _initialPosition?: number;
  scrollStopLast?: boolean;
}

// From the renderer, not exported
const InViewPort = 8 as const;
const isNotShown = (node: ElementNode | ElementText): boolean => {
  return (node.lng.renderState as number) !== InViewPort;
};
/*
  Auto Scrolling starts scrolling right away until the last item is shown. Keeping a full view of the list.
  Edge starts scrolling when it reaches the edge of the viewport.
  Always scroll moves the list every time
*/

/**
 * Checks if the selected index is in the non-scrollable zone (last upCount items).
 */
export function checkIsInNonScrollableZone(
  componentRef: ScrollableElement,
): boolean {
  const totalItems = componentRef.children.length;
  const upCount = componentRef.upCount || 6;
  const selected = componentRef.selected || 0;
  const nonScrollableZoneStart = Math.max(0, totalItems - upCount);
  return selected >= nonScrollableZoneStart;
}

/** @deprecated Use {@link scrollRow} or {@link scrollColumn} */
export function withScrolling(isRow: boolean): Scroller {
  const dimension = isRow ? 'width' : 'height';
  const axis = isRow ? 'x' : 'y';

  return (selected, component, selectedElement, lastSelected) => {
    let componentRef = component as ScrollableElement;
    if (typeof selected !== 'number') {
      componentRef = selected as ScrollableElement;
      selected = componentRef.selected || 0;
    }
    if (!componentRef) return;
    // Each input is read once into a local: on renderer v2 every node prop
    // read goes through an accessor.
    const scrollProp = componentRef.scroll;
    const children = componentRef.children;
    const childCount = children.length;
    if (scrollProp === 'none' || selected === lastSelected || !childCount)
      return;

    const position = componentRef[axis];
    let initialPosition = componentRef._initialPosition;
    if (initialPosition === undefined) {
      initialPosition = position;
      componentRef._initialPosition = position;
    }

    const lng = componentRef.lng as unknown as INode;
    const root = lng.stage.root;
    const screenSize = isRow ? root.w : root.h;
    // Determine if movement is incremental or decremental
    const isIncrementing =
      lastSelected === undefined || lastSelected - 1 !== selected;

    let offset = componentRef.offset;
    let endOffset = componentRef.endOffset;
    let screenOffset = componentRef._screenOffset;
    if (screenOffset === undefined) {
      // A removed Row/Column has no parent (removeChild clears it).
      const p = componentRef.parent;
      if (p !== undefined && p !== null && p.clipping) {
        endOffset =
          endOffset ??
          screenSize - ((isRow ? p.absX : p.absY) || 0) - p[dimension];
        componentRef.endOffset = endOffset;
      }

      screenOffset = offset ?? (isRow ? lng.absX : lng.absY) - position;
      componentRef._screenOffset = screenOffset;
    }

    const gap = componentRef.gap || 0;
    const scrollIndex = componentRef.scrollIndex;
    // when creating we set scroll to always so we setup the right location for selected and scrollIndex
    const scroll =
      scrollProp ||
      (lastSelected === undefined
        ? scrollIndex
          ? 'center'
          : 'always'
        : 'auto');

    // Allows manual position control
    const targetPosition = componentRef._targetPosition ?? position;
    const rootPosition = isIncrementing
      ? Math.min(targetPosition, position)
      : Math.max(targetPosition, position);
    offset = offset ?? rootPosition;
    componentRef.offset = offset;
    const selectedEl = selectedElement || children[selected];

    if (!selectedEl) {
      return;
    }
    const selectedPosition = selectedEl[axis] ?? 0;
    const selectedSize = selectedEl[dimension] ?? 0;
    // `$focus`, not `style.focus`: the focus state's styles live on the node
    // under the state key, and the `style` getter allocates when unset.
    const selectedScale =
      selectedEl.scale ?? (selectedEl.$focus as Styles | undefined)?.scale ?? 1;
    const selectedSizeScaled = selectedSize * selectedScale;
    const containerSize = componentRef[dimension] ?? 0;
    const maxOffset = Math.min(
      screenSize - containerSize - screenOffset - (endOffset ?? 2 * gap),
      offset,
    );

    // Determine the next element based on whether incrementing or decrementing
    const nextIndex = isIncrementing ? selected + 1 : selected - 1;
    const nextElement = children[nextIndex] || null;
    const scrollStopLast = componentRef.scrollStopLast;

    // Default nextPosition to align with the selected position and offset
    let nextPosition = rootPosition;

    // Update nextPosition based on scroll type and specific conditions
    if (selectedEl.centerScroll) {
      nextPosition = -selectedPosition + (screenSize - selectedSizeScaled) / 2;
    } else if (scroll === 'always') {
      nextPosition = -selectedPosition + offset;
    } else if (scroll === 'bounded') {
      const upCount = componentRef.upCount || 6;
      const nonScrollableZoneStart = Math.max(0, childCount - upCount);
      const isInNonScrollableZone = selected >= nonScrollableZoneStart;
      const isFirstOfNonScrollableZone = selected === nonScrollableZoneStart;
      const isEnteringZone =
        isFirstOfNonScrollableZone &&
        lastSelected !== undefined &&
        lastSelected < nonScrollableZoneStart;

      if (!isInNonScrollableZone) {
        nextPosition = -selectedPosition + offset;
      } else if (isIncrementing) {
        if (isEnteringZone) {
          const firstOfZoneElement = children[nonScrollableZoneStart];
          nextPosition = firstOfZoneElement
            ? -(firstOfZoneElement[axis] ?? 0) + offset
            : rootPosition;
        } else {
          nextPosition = rootPosition;
        }
      } else if (isFirstOfNonScrollableZone) {
        nextPosition = -selectedPosition + offset;
      } else {
        nextPosition = rootPosition;
      }
    } else if (scroll === 'center') {
      const centerPosition =
        -selectedPosition +
        (screenSize - selectedSizeScaled) / 2 -
        screenOffset;
      // clamp position to avoid going beyond bounds
      nextPosition = Math.min(Math.max(centerPosition, maxOffset), offset);
    } else if (!nextElement) {
      // If at the last element, align to end
      if (scrollStopLast && isIncrementing) {
        nextPosition = rootPosition - selectedSize - gap;
      } else {
        nextPosition = isIncrementing ? maxOffset : offset;
      }
    } else if (scroll === 'auto') {
      if (scrollIndex && scrollIndex > 0) {
        // Prevent scrolling if the selected item is within the last scrollIndex items
        const nearEndIndex = childCount - scrollIndex;
        const currentSelected = componentRef.selected;

        if (isIncrementing && currentSelected >= scrollIndex) {
          nextPosition = rootPosition - selectedSize - gap;
        } else if (!isIncrementing && currentSelected < nearEndIndex) {
          nextPosition = rootPosition + selectedSize + gap;
        }
      } else if (isIncrementing) {
        nextPosition = rootPosition - selectedSize - gap;
      } else {
        nextPosition = rootPosition + selectedSize + gap;
      }
    } // Handle Edge scrolling
    else if (isNotShown(nextElement)) {
      nextPosition = isIncrementing
        ? rootPosition - selectedSize - gap
        : -selectedPosition + offset;
    }

    // Prevent container from moving beyond bounds
    const isScrollStopLastCase =
      scrollStopLast && !nextElement && isIncrementing;
    nextPosition =
      isIncrementing &&
      scroll !== 'always' &&
      scroll !== 'bounded' &&
      !isScrollStopLastCase
        ? Math.max(nextPosition, maxOffset)
        : Math.min(nextPosition, offset);

    // Update position if it has changed
    if (position !== nextPosition) {
      const onScrolled = componentRef.onScrolled;
      if (onScrolled) {
        const isInitial = nextPosition === initialPosition;
        onScrolled.call(componentRef, componentRef, nextPosition, isInitial);
      }

      componentRef[axis] = nextPosition;
      // Store the new position to keep track during animations
      componentRef._targetPosition = nextPosition;
    }
  };
}

export const scrollRow = /* @__PURE__ */ withScrolling(true);
export const scrollColumn = /* @__PURE__ */ withScrolling(false);
