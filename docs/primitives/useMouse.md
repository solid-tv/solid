# useMouse for Mouse Handling

The `useMouse` primitive enables mouse interaction by setting the `activeElement` to any element the mouse pointer hovers over, provided the element has a `focus` state, `onFocus`, or `onEnter` property, and does not have `skipFocus` set to `true`.

Additionally, `useMouse` handles wheel scrolling. When the user scrolls with the mouse wheel, it triggers `onUp` and `onDown` events on the current `activeElement`.

This primitive should be enabled for TV's with mouse input like LG's Magic Remote.

## Usage

### Import and Setup

Import the `useMouse` and call it:

```jsx
import { useMouse } from '@solidtv/solid';

const App = () => {
  // rootNode, throttleBy in ms, and options
  useMouse(undefined, 100, {
    customStates: {
      hoverState: '$hover',
      pressedState: '$pressed',
      pressedStateDuration: 150, // optional, default is 150ms
    },
  });

  // Additional application logic...
};
```

### Custom States

You can configure `useMouse` to apply custom states to elements when they are hovered or pressed. This is useful for styling elements based on mouse interaction.

- `hoverState`: Applied to the element currently under the mouse cursor.
- `pressedState`: Applied to the element when it is clicked.

To use this, pass the `customStates` option to `useMouse`.

### Click Handling

When an element is clicked, `useMouse` handles the interaction as follows:

1. **`onMouseClick`**: If the element has an `onMouseClick` handler, it is called directly with the mouse event and the element instance. `onMouseClick` is mouse-specific and never fires from a keyboard/remote Enter.
2. **Everything else**: The element is focused (`setFocus()`) and a synthetic `Enter` key event (keydown + keyup) is dispatched. This routes through the `focusManager` exactly like a remote/keyboard Enter press — the capture phase, leaf→root bubbling, return-value propagation (a handler returning `true` stops it), per-element throttling, and keyHold all apply. In practice this means a click and a remote Enter invoke the same `onEnter` path.

Example of handling clicks:

```jsx
const MyButton = (props) => {
  return (
    <view
      {...props}
      onMouseClick={(e, elm) => {
        console.log('Clicked!', elm);
      }}
    />
  );
};
```

## Cursor Visibility (webOS Magic Remote)

On webOS TVs the Magic Remote can show an on-screen pointer. `isCursorVisible` is a reactive accessor that returns `true` while that pointer is on screen and `false` otherwise. It attaches a single, app-lifetime listener to the webOS `cursorStateChange` event on first read, so it's cheap to call from many components.

```jsx
import { isCursorVisible } from '@solidtv/solid/primitives';
import { Show } from '@solidtv/solid';

// Reactive — read it inside JSX or an effect
<Show when={isCursorVisible()}>{/* pointer-only affordances */}</Show>;
```

### Why this matters for Rows

A `Row` scrolls horizontally in response to **Left/Right** key presses that advance its selected index. When the Magic Remote pointer is active, users move focus by **hovering** rather than pressing arrows — so the Row never shifts, and any items outside the initial viewport are unreachable with the pointer alone.

The recommended pattern is to render on-screen **Left and Right arrow** affordances whenever the cursor is visible, and have them scroll the Row **without moving focus** — the pointer, not the arrows, owns focus. Drive the Row directly with `scrollToIndex` (plain `<Row>`/`<Column>`) or `lazyScrollToIndex` (`<LazyRow>`), passing `{ noFocus: true }`:

```jsx
import { createSignal } from 'solid-js';
import { Show } from '@solidtv/solid';
import { isCursorVisible, Row } from '@solidtv/solid/primitives';

const MouseRow = (props) => {
  let rowRef;
  const itemCount = () => props.items.length;
  const [, setSelectedIndex] = createSignal(0);

  // Mouse-only advance: scroll the row one item without moving focus.
  const advanceRow = (delta) => {
    const row = rowRef;
    if (!row || itemCount() === 0) return;
    const target = Math.min(
      Math.max((row.selected ?? 0) + delta, 0),
      itemCount() - 1,
    );
    // `<LazyRow>` exposes lazyScrollToIndex; a plain `<Row>` exposes scrollToIndex.
    (row.lazyScrollToIndex ?? row.scrollToIndex)?.call(row, target, {
      noFocus: true,
    });
    setSelectedIndex(target);
  };

  return (
    <view>
      <Row ref={rowRef} {...props} />
      {/* Only show arrows when the pointer is on screen */}
      <Show when={isCursorVisible()}>
        <view onMouseClick={() => advanceRow(-1)}>{/* ‹ left arrow */}</view>
        <view onMouseClick={() => advanceRow(1)}>{/* › right arrow */}</view>
      </Show>
    </view>
  );
};
```

`{ noFocus: true }` scrolls the Row and updates its `selected` index without calling `setFocus()` on the target child, so the pointer keeps focus while the rail moves under it. This works regardless of which element is the `activeElement`, unlike dispatching synthetic arrow keys (which only navigate whatever currently has focus).
