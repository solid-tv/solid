# Virtual Row & Column Primitives

`VirtualRow` & `VirtualColumn` renders a dynamic slice of items from a larger dataset, displaying them in a horizontal row / column. It's designed to optimize performance for long lists by only rendering the items currently visible or nearby.

### Behavior

- Renders a 1D list of items.
- Visible count and overscan buffer are derived automatically from the container size and the first child's measured size — no need to pass `displaySize` or `bufferSize`.
- On mount, a single probe item is rendered so the layout pass can measure it; the full slice is rendered as soon as measurement completes.
- Item size is assumed uniform; the first child is the reference. If your dataset swaps to differently-sized items, remount the component.
- Only a subset of the total items is rendered, improving performance.
- Triggers `onEndReached` when the user approaches the end of the list, allowing for infinite scrolling or fetching more data.
- Focus is updated and maintained internally, with optional control via `scrollToIndex`.
- `selected` can be set to an index in the total array of items.

### Example Usage

```tsx
import { VirtualRow, VirtualColumn } from './primitives/Virtual';

<VirtualRow
  x={100}
  y={100}
  width={1720}
  each={myItemsArray}
  onEndReached={loadMoreItems}
  onEndReachedThreshold={3}
  onSelectedChanged={updateContent}
  autofocus
>
  {(item, index) => <Thumbnail item={item()} index={index()} />}
</VirtualRow>;
```

The container must have a measurable `width` (for `VirtualRow`) or `height` (for `VirtualColumn`) on first layout — either set explicitly or sized by a flex parent that has finished laying out.

### Props

- **each** (`readonly T[] | undefined | null | false`): The full list of items to be rendered.
- **wrap** (`boolean`): If `true`, navigation wraps around the ends of the list and scrolling loops infinitely.
- **scrollIndex** (`number`): Specifies the index within the visible window where the focus should be anchored during scrolling.
- **onEndReached** (`() => void`): Callback triggered when selection moves near the end of the list. Requires `onEndReachedThreshold` to be set.
- **onEndReachedThreshold** (`number`): Number from end of items when `onEndReached` will be called (default: `undefined`).
- **debugInfo** (`boolean`): Logs internal slice recalculations, derived dimensions, and bounds shifts to the console.
- **children** (`(item: Accessor<T>, index: Accessor<number>) => JSX.Element`): Function that renders each item.
- **selected** (`number`): Initial selected index.
- **autofocus** (`boolean`): If `true`, the component will auto-focus the first item on mount.
- **onSelectedChanged** (`OnSelectedChanged`): Optional callback triggered when selection changes.

Use `cursor` property on the node to get the absolute index in the list of items.

### Performance Optimization

- Renders only a subset of the full list (`slice`) for improved memory and render-time performance.
- Visible count and buffer are computed once from a single child measurement, then cached.
- Automatically re-calculates the slice on selection or data change.
- Reuses Children components
- Merges styles with internal layout defaults:
  - `display: flex`, `gap: 30`
  - Column variant adds `flexDirection: column`

### Focus & Navigation

- Focus is managed via `selected` and handled automatically when navigating.
- Navigation moves by item (`onLeft`/`onRight` for `VirtualRow`, `onUp`/`onDown` for `VirtualColumn`).
- When selection crosses the window edge, the slice is updated and the row/column scrolls accordingly.
- Internal `onSelectedChanged` adjusts for slice-relative index offset to maintain correct selection.

### Migration from previous versions

The following props were removed and are now derived automatically:

| Removed prop  | Replacement                                      |
| ------------- | ------------------------------------------------ |
| `displaySize` | derived from `container size / first child size` |
| `bufferSize`  | derived as `max(2, ceil(visibleCount * 0.25))`   |
| `uniformSize` | always treated as uniform (was the default)      |
| `factorScale` | dropped; layout uses unscaled item size          |

If you previously passed `displaySize` to constrain how many items render, set `width`/`height` on the container instead — the visible count will follow.
