# Virtual Component Redesign Spec

## Motivation

The current `Virtual.tsx` implementation works but has several structural problems that make it hard to maintain and extend:

- `createVirtual` mixes state management, animation, and rendering into one function
- `computeSlice` handles all four scroll modes plus wrap mode in a single switch/cascade, with many overlapping edge cases
- Animation state (`originalPosition`, `targetPosition`, `cachedAnimationController`) lives as mutable variables alongside reactive state
- `doOnce` flag for wrap initialization is a side-effect hack
- `VirtualGrid` uses the deprecated `withScrolling` utility
- Inconsistent naming: `bufferSize` (VirtualRow/Column) vs `buffer` (VirtualGrid), `displaySize` vs `columns`/`rows`
- The `scroll` prop on VirtualGrid is hardcoded to `'always'`; other modes are not usable
- `center` scroll mode is defined in the `NavigableProps` type but never implemented in Virtual

The goal is to split responsibilities cleanly, preserve the external API, and make the code understandable in isolation.

---

## Architecture Overview

```
createVirtualWindow<T>()   ← pure reactive primitive, no rendering
       │
       ├── VirtualRow<T>     ← thin wrapper, renders <view> horizontally
       ├── VirtualColumn<T>  ← thin wrapper, renders <view> vertically
       └── VirtualGrid<T>    ← 2D adapter over createVirtualWindow
```

### Separation of Concerns

| Layer                    | Responsibility                                               |
| ------------------------ | ------------------------------------------------------------ |
| `createVirtualWindow`    | Track cursor, compute slice, expose navigate/scrollToIndex   |
| `createVirtualAnimation` | Own position state, drive animation when shiftBy changes     |
| `VirtualRow/Column`      | Render view, wire key handlers, call animation on layout     |
| `VirtualGrid`            | Compute per-row cursor math, reuse window primitive per axis |

---

## `createVirtualWindow<T>` — Core Primitive

This is a pure SolidJS primitive with no JSX. Components consume it.

### Signature

```ts
type ScrollMode = 'auto' | 'edge' | 'always' | 'none';

type VirtualWindowOptions<T> = {
  items: Accessor<readonly T[]>;
  displaySize: number;
  buffer?: number; // default: 2
  scroll?: ScrollMode; // default: 'auto'
  scrollIndex?: number; // index inside the window to anchor focus (default: 0)
  wrap?: boolean;
  initialCursor?: number;
};

type WindowSlice<T> = {
  items: T[]; // the rendered subset
  start: number; // absolute index of items[0] in the source array
  selected: number; // index within items[] that should receive focus
  shiftBy: number; // number of item-widths to animate the container (negative = move back)
  atStart: boolean; // whether cursor is at absolute index 0
  atEnd: boolean; // whether cursor is at absolute last index
  cursor: number; // absolute index currently focused
};

type VirtualWindow<T> = {
  slice: Accessor<WindowSlice<T>>;
  cursor: Accessor<number>;
  navigate: (delta: number) => void; // advance by +1 or -1
  scrollToIndex: (index: number) => void; // jump to absolute index
  syncCursor: (absoluteIndex: number) => void; // re-sync without animation
};

function createVirtualWindow<T>(
  opts: VirtualWindowOptions<T>,
): VirtualWindow<T>;
```

### Slice Computation Rules

`computeSlice(cursor, delta, prev)` is a pure function (no side effects) that returns the next `WindowSlice`. Rules by scroll mode:

#### `'none'`

- `start` is always `0`
- `selected` equals `cursor`
- `shiftBy` is always `0`
- Window never shifts; focus just moves through the visible items

#### `'auto'`

- Focus drifts freely within the window while not at `scrollIndex`
- Once `selected` would pass `scrollIndex`, window advances instead
- At list start (`start === 0`), focus can drop below `scrollIndex` again
- At list end (`start + length >= total`), focus drifts right freely
- `shiftBy` is `-1` when window advances, `+1` when it retreats

#### `'edge'`

- Focus moves freely until it hits the last visible slot
- Once focus hits the edge, window scrolls and focus stays pinned at the edge
- At list start/end, focus drifts back inward normally
- `shiftBy` is non-zero only when the window shifts

#### `'always'`

- Focus is always pinned at `scrollIndex` (default: `bufferSize`)
- Window always advances/retreats to keep cursor at that position
- Near the start/end of the list, focus drifts as needed
- `shiftBy` is always `-delta` when window moves

#### Wrap Mode (overlay on any mode)

- Cursor uses modulo arithmetic: `mod(cursor + delta, total)`
- Slice wraps around the array boundary using modulo index mapping
- `atStart` / `atEnd` are both `false` in wrap mode (no edges)
- `shiftBy` normalizes delta through the window length to avoid jumping

#### Initial Setup (delta === 0)

- Computes the correct `start`/`selected` for a given cursor without animation
- Used on `scrollToIndex`, `selected` prop change, and item array change

### Item Array Changes

When `items` changes reactively:

- If `cursor >= items().length`, clamp cursor to `items().length - 1`
- Recompute slice with `delta = 0`
- Update `viewRef.selected` to match new `slice.selected`

---

## `createVirtualAnimation` — Animation Primitive

Owns all mutable animation state so `createVirtualWindow` stays pure.

```ts
type VirtualAnimationOptions = {
  axis: 'x' | 'y';
  getSize: () => number; // returns current item size (px)
  defaultDuration?: number; // default: 250ms
};

type VirtualAnimation = {
  /** Call after layout update when shiftBy changes. Pass the element and shiftBy value. */
  animate: (el: ElementNode, shiftBy: number) => void;
  /** Reset origin tracking (call when scrollToIndex resets position) */
  reset: (el: ElementNode) => void;
};

function createVirtualAnimation(
  opts: VirtualAnimationOptions,
): VirtualAnimation;
```

### Animation Logic

- Tracks `originalPosition` (the element's baseline `x`/`y`) as a stable reference
- Tracks `targetPosition` (where the current animation is heading)
- Computes `nextTarget = targetPosition + itemSize * shiftBy`
- Stops any in-flight animation before starting a new one
- Adapts `duration` based on time since last navigation:
  - If navigating faster than `defaultDuration`, use elapsed time as duration instead
- When `lng.Config.animationsEnabled` is `false`, sets position directly

### Wrap Initialization

When `wrap` is enabled, the container needs to be offset by `-1 itemSize` at mount so the pre-rendered item before the start is hidden off-screen. This is a one-time `queueMicrotask` call that sets `originalPosition`.

---

## `VirtualRow<T>` and `VirtualColumn<T>`

These are thin rendering components.

### Type

```ts
type VirtualProps<T> = Omit<RowProps, 'children'> & {
  each: readonly T[] | undefined | null | false;
  displaySize: number;
  buffer?: number; // renamed from bufferSize, default: 2
  wrap?: boolean;
  scrollIndex?: number;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  debugInfo?: boolean;
  factorScale?: boolean;
  uniformSize?: boolean; // default: true
  children: (item: Accessor<T>, index: Accessor<number>) => JSX.Element;
};
```

Note: `bufferSize` is replaced by `buffer` for consistency with VirtualGrid.

### Internal Wiring

```
onSelectedChanged (from LightningTV)
  │
  ├── 1. Call props.onSelectedChanged (user callback)
  ├── 2. Compute delta from idx/lastIdx
  ├── 3. window.navigate(delta)                ← update slice
  ├── 4. elm.selected = slice().selected       ← correct LightningTV's internal selected
  ├── 5. Check onEndReachedThreshold
  └── 6. queueMicrotask:
         elm.updateLayout()
         animation.animate(this, slice().shiftBy)
```

### `scrollToIndex` (exposed on element node)

```
1. Clamp index to [0, items.length - 1]
2. animation.reset(viewRef)      ← reset origin so position doesn't drift
3. window.scrollToIndex(index)
4. viewRef.setFocus() if not already focused
```

### Default Styles

```ts
// VirtualRow
{ display: 'flex', gap: 30 }

// VirtualColumn
{ display: 'flex', flexDirection: 'column', gap: 30 }
```

Transitions are set on the view element (not the style object) as before:

- VirtualRow: `transitionLeft={defaultTransitionBack}`, `transitionRight={defaultTransitionForward}`
- VirtualColumn: `transitionUp={defaultTransitionUp}`, `transitionDown={defaultTransitionDown}`

---

## `VirtualGrid<T>`

### Type

```ts
type VirtualGridProps<T> = Omit<RowProps, 'children'> & {
  each: readonly T[] | undefined | null | false;
  columns: number;
  rows?: number; // visible rows, default: 1
  buffer?: number; // row buffer, default: 2
  scroll?: 'always' | 'none'; // only these two make sense for a grid, default: 'always'
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  children: (item: Accessor<T>, index: Accessor<number>) => JSX.Element;
};
```

### Slice Logic

VirtualGrid does not use `createVirtualWindow`. It has simpler 2D slice math:

```ts
// Current row of cursor
rowIndex = floor(cursor / columns);

// Rendered range (in rows)
startRow = max(0, rowIndex - buffer);
endRow = rowIndex + buffer + rows;

// Item range
sliceStart = startRow * columns;
sliceEnd = min(total, endRow * columns);
slice = items.slice(sliceStart, sliceEnd);
```

### Navigation

- `onLeft` / `onRight`: standard `navigableHandleNavigation` (no changes needed)
- `onUp` / `onDown`: custom handlers that increment/decrement cursor by `columns`
  - Guard against going past row 0 or past the last row
  - After updating cursor, call `onSelectedChanged` manually to trigger slice update + scroll

### Vertical Scroll Animation

When a row boundary is crossed:

```
queueMicrotask:
  prevRowY = this.y + active.y
  this.updateLayout()
  this.lng.y = prevRowY - active.y    // restore visual position
  columnScroll(...)                    // animate to new position
```

Replace the deprecated `withScrolling(false)` with an inline equivalent or the new `createVirtualAnimation`.

### `onSelectedChanged` Index Correction

When the slice shifts, `this.selected` is slice-relative and must be corrected:

```ts
const correction = prevStart - newStart;
this.selected += correction;
if (lastIdx !== undefined) lastIdx += correction;
idx += correction;
```

This logic is correct and should be preserved as-is.

---

## Key Behavioral Contracts

These must be preserved in the new implementation:

1. **Focus is never lost during slice changes.** After `updateLayout()`, the correct child must be focused.

2. **`cursor` on the element node** reflects the absolute index into `props.each`. (Set via the `cursor` prop on the view.)

3. **`scrollToIndex` is exposed on the element node** and can be called programmatically without focus.

4. **`onEndReached` fires once** when cursor enters the threshold zone; it fires again only after items are added (cursor moves back out of the zone).

5. **`selected` prop** controls initial selection and can be updated externally to drive programmatic scrolling.

6. **Wrap mode always has one buffer item off-screen** before the visible start. The container is pre-offset at mount.

7. **Animation adapts to fast navigation.** If the user navigates faster than `defaultDuration`, the animation duration shrinks to match.

---

## Naming Consolidation

| Old (VirtualRow/Column) | Old (VirtualGrid)  | New (all)                                 |
| ----------------------- | ------------------ | ----------------------------------------- |
| `bufferSize`            | `buffer`           | `buffer`                                  |
| `displaySize`           | `rows` + `columns` | `displaySize` (1D), `rows`/`columns` (2D) |
| N/A                     | N/A                | `scroll` supported on all components      |

---

## What Changes vs Current

| Area                    | Current                                                            | New                                                                |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Slice logic             | Inside `createVirtual`, mixed with rendering                       | `createVirtualWindow`, pure reactive                               |
| Animation state         | Mutable closures (`cachedAnimationController`, `originalPosition`) | `createVirtualAnimation` with owned state                          |
| Wrap init               | `doOnce` flag + `createEffect`                                     | Explicit `createEffect` on `wrap` + init call in animation         |
| VirtualGrid scroll      | Hardcoded `withScrolling(false)`                                   | Inline equivalent or reused animation primitive                    |
| `bufferSize` prop       | `bufferSize`                                                       | `buffer` (match VirtualGrid)                                       |
| `scroll` in VirtualGrid | Hardcoded `'always'`                                               | Accepts `'always'` \| `'none'`                                     |
| `center` scroll mode    | Not implemented                                                    | Out of scope for this redesign                                     |
| `debugInfo`             | `console.log` inside `computeSlice`                                | Pass-through into `createVirtualWindow`, logged from pure function |

---

## Out of Scope

- `center` scroll mode (not currently implemented anywhere)
- Horizontal scrolling in VirtualGrid
- Variable-size items beyond the current `factorScale` approach
- Accessibility / announce changes
