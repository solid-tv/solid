# useFocusManager for Key Handling

The `useFocusManager` primitive is designed to handle user input, manage focus paths, and trigger focus and blur events on components. This primitive is set up once during app initialization and provides key handling capabilities.

## Usage

### Import and Setup

Import the `useFocusManager` and configure it with your custom key mappings:

```jsx
import { useFocusManager } from '@solidtv/solid/primitives';

const App = () => {
  // The defaults are already applied, so you can just call useFocusManager().
  // Anything you pass is merged over them.
  useFocusManager({
    Left: ['ArrowLeft', 37],
    Right: ['ArrowRight', 39],
    Up: ['ArrowUp', 38],
    Down: ['ArrowDown', 40],
    Enter: 'Enter',
    Last: 'l',
  });

  // Additional application logic...
};
```

### Focus Path Tracking

`focusPath` is a signal holding the array of elements that currently have focus, from the focused leaf up to the root. It is imported separately — `useFocusManager` itself returns nothing:

```jsx
import { useFocusManager, focusPath } from '@solidtv/solid/primitives';
```

When the `activeElement` changes, the focus path is recalculated. During this process:

- All elements in focus will have a `focus` state added, and `onFocus(currentFocusedElm, prevFocusedElm, nodeWithCallback)` event is called.
- Elements losing focus will have the `focus` state removed, and `onBlur(currentFocusedElm, prevFocusedElm, nodeWithCallback)` event is called.

There is also an `onFocusChanged(hasFocus, currentFocusedElm, prevFocusedElm, nodeWithCallback)` callback which is useful for setting a focusSignal to use for more complicated scenarios.

```jsx
const [hasFocus, setHasFocus] = createSignal(false);
return <view onFocusChanged={setHasFocus}>{/* use hasFocus() */}</view>;
```

### Key Handling

When a key is pressed:

1. The `keyMap` resolves the event's `key` (falling back to its `keyCode`) to a mapped event name, e.g. `ArrowLeft` → `Left`. A key with no mapping still propagates, but only to the generic handlers.
2. **Capture phase**, root → focused leaf: on each element it looks for `onCapture${key}`, then `onCaptureKey`. If the mapping failed, the raw `e.key` is used in place of `${key}`.
3. **Bubble phase**, focused leaf → root: on each element it looks for `on${key}`, then falls back to `onKeyPress` on that _same_ element before moving to its parent.

Note that step 3 is a single interleaved walk — `onKeyPress` on an element is tried before its parent's `on${key}`, not as a separate pass after the whole tree.

The key handler signature is:

```ts
type KeyHandler = (
  this: ElementNode,
  e: KeyboardEvent,
  target: ElementNode, // the element whose handler is running
  handlerElm: ElementNode, // the focused leaf element
  mappedEvent?: string, // capture-phase handlers only
) => boolean | void;
```

`onKeyPress` takes the mapped event name as its second argument instead:
`(e, mappedKeyEvent, handlerElm, currentFocusedElm)`.

To stop the propagation of a key press, the handler must return `true`. Any other return value or no return value will continue to propagate the key press through the focus path, looking for additional handlers.

### Input Throttling (`Available Core 2.12+`)

You can now control input speed in two powerful ways . This feature helps prevent unwanted behavior from rapid key presses, leading to a smoother, more predictable user experience and giving you, the developer, precise control over input handling.

#### Global Throttling (`Config.throttleInput`)

For a quick, app-wide solution, you can set a global throttle on all key inputs directly in your configuration. This is perfect for setting a baseline input speed for your entire application.

```javascript
import { Config } from '@solidtv/solid';

// Allow one keypress every 200ms across the entire app
Config.throttleInput = 200;
```

#### Per-Element Throttling (`throttleInput` property)

For more granular control, you can add a `throttleInput` property directly to any ElementNode. This allows you specific components that might need a different throttle rate, like a fast-scrolling list or a sensitive menu item.

```jsx
// This Row will only accept a keypress every 500ms
<Row throttleInput={500}>...</Row>
```

### Focus History Logging

Focus history logging records each focus change — whether triggered by a key press or programmatically — into a ring buffer of up to 50 entries. This is a **dev-only** feature: recording and printing are both gated behind the `isDev` flag and do nothing in production builds.

#### Enabling (`Config.focusHistoryDebug`)

Set `Config.focusHistoryDebug` to a positive integer to enable recording and automatically `console.table` the last N entries after every focus change. Set it to `0` (the default) to disable the feature entirely.

```javascript
import { Config } from '@solidtv/solid';

// Record history and print the last 5 entries after each focus change
Config.focusHistoryDebug = 5;
```

When running in dev mode, a startup message is printed to the console reminding you of the `$f` shortcut and how to enable the flag.

#### `console.table` output

Each print shows the following columns:

| Column    | Description                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `prev`    | Label of the element that lost focus (`id ?? componentName ?? 'Unknown'`)                                                       |
| `key`     | The key that triggered the change — `mappedKey` if available, otherwise raw `keyPressed`, or `—` for programmatic focus changes |
| `next`    | Label of the element that gained focus                                                                                          |
| `nextElm` | The `ElementNode` object itself — expandable in DevTools                                                                        |
| `nextDiv` | The underlying `HTMLDivElement` from the renderer — click to jump to it in the Elements panel                                   |

Example output:

```
┌───────┬─────────────────┬──────────┬─────────────────────┬──────────┬─────────────────────┐
│ (idx) │ prev            │ key      │ next                │ nextElm  │ nextDiv             │
├───────┼─────────────────┼──────────┼─────────────────────┼──────────┼─────────────────────┤
│     0 │ 'hero-card-0'   │ 'Right'  │ 'hero-card-1'       │ {…}      │ <div>               │
│     1 │ 'hero-card-1'   │ 'Down'   │ 'rail-item-0'       │ {…}      │ <div>               │
│     2 │ 'rail-item-0'   │ '—'      │ 'modal-close-btn'   │ {…}      │ <div>               │
└───────┴─────────────────┴──────────┴─────────────────────┴──────────┴─────────────────────┘
```

A `key` of `—` means focus was moved programmatically (e.g. via `elm.setFocus()` on mount) rather than by a key press.

#### `$f` — quick DevTools inspection

After every `printFocusHistory` call, `window.$f` is set to the DOM div of the most recently focused element. You can then call `inspect($f)` in the browser console to jump directly to that node in the Elements panel.

#### Manual printing (`printFocusHistory`)

`printFocusHistory(n)` prints the last N entries at any time. `n` is required.

```javascript
import { printFocusHistory } from '@solidtv/solid/primitives';

printFocusHistory(20);
```

It is not attached to `window`, so it is not callable from the DevTools console on its own. If you want it there, assign it yourself during dev setup:

```javascript
if (import.meta.env.DEV) window.printFocusHistory = printFocusHistory;
```

#### Inspecting the buffer programmatically (`getFocusHistory`)

`getFocusHistory()` returns the full ring buffer as a read-only array of `FocusHistoryEntry` objects. This is useful for custom devtools panels, automated tests, or sending focus traces to a logging service.

```typescript
import {
  getFocusHistory,
  type FocusHistoryEntry,
} from '@solidtv/solid/primitives';

const history: Readonly<FocusHistoryEntry[]> = getFocusHistory();
```

Each entry has the following shape:

| Field        | Type                            | Description                                                              |
| ------------ | ------------------------------- | ------------------------------------------------------------------------ |
| `timestamp`  | `number`                        | `performance.now()` at the moment focus changed                          |
| `keyPressed` | `string \| number \| undefined` | Raw key value (e.g. `"ArrowLeft"`, `37`). `undefined` if programmatic.   |
| `mappedKey`  | `string \| undefined`           | Mapped event name (e.g. `"Left"`). `undefined` if programmatic.          |
| `prev`       | `ElementNode \| undefined`      | The element that lost focus. `undefined` on the very first focus change. |
| `next`       | `ElementNode`                   | The element that gained focus.                                           |

Note that `prev` and `next` are live `ElementNode` references. Labels (`id ?? componentName ?? 'Unknown'`) are resolved at print time by `printFocusHistory`, not at record time.

#### Memory safety

Per-element metadata (focus count, last focused timestamp) is stored in a `WeakMap` keyed by `ElementNode`. This means the data is automatically released when an element is garbage collected — there is no need to manually clean up history entries when components unmount.

### Key Release

On release of a key:

1. The `keyMap` resolves the key to a mapped event name, as for a key press.
2. **Capture phase**, root → leaf: `onCapture${key}Release`, then `onCaptureKeyRelease`.
3. **Bubble phase**, leaf → root: `on${key}Release`.

Note: there is no generic `onKeyRelease` in the bubble phase — `onKeyPress` is not called for key-ups. `onCaptureKeyRelease` is the only catch-all for a release.

### Hold Key Handling

Hold gestures are handled by the [useHold](./useHold.md) primitive, which is
scoped to the elements that need it rather than delaying key-press events
globally.

The global `keyHoldOptions` / `userKeyHoldMap` second parameter has been removed,
along with the `onKeyHold` and `on${Key}Hold` handlers it dispatched. Move a
`userKeyHoldMap` entry to `useHold` on the element that owns the gesture:

```tsx
// Before: useFocusManager(keyMap, { userKeyHoldMap: { EnterHold: 'Enter' }, holdThreshold: 1000 })
//         <view onEnterHold={openMenu} onEnter={openTile} />

// After:
const [holdEnter, releaseEnter] = useHold({
  onHold: openMenu,
  onEnter: openTile,
  holdThreshold: 1000,
});

<view onEnter={holdEnter} onEnterRelease={releaseEnter} />;
```

### Custom Key Mappings

You can pass in an array of keys for a single event. What you pass is written over the default mapping, so you only need to declare what differs.

Note the direction: the map you pass is `{ EventName: key(s) }`, while the table it merges into is keyed the other way, `{ key: EventName }`. These are the defaults:

```js
{
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Enter: 'Enter',
  l: 'Last',
  ' ': 'Space',
  Backspace: 'Back',
  Escape: 'Escape',
}
```

**No numeric keyCodes are mapped by default.** Devices that report keys by keyCode — or that report a different `key` on key-down and key-up, as LG does for Back — need those added explicitly:

```js
useFocusManager({
  Back: [461, 'GoBack', 'Backspace'],
  Enter: ['Enter', 13],
});
```

#### Typing of custom handlers

Only `Left`, `Right`, `Up`, `Down`, `Enter` and `Last` have typed handler props
(`onLeft`, `onLeftRelease`, `onCaptureLeft`, …). Handlers for any other mapping —
including the built-in `Back`, `Space` and `Escape`, and anything you add
yourself — dispatch correctly at runtime, but are only accepted by the compiler
through `ElementNode`'s `[key: string]: unknown` index signature. You get no
autocompletion and no argument checking on them, so annotate the handler itself:

```tsx
const onBack: KeyHandler = (e, target, focused) => { ... };

<view onBack={onBack} />;
```

### Example

Here's a complete example of how to use `useFocusManager`:

```jsx
import { createSignal } from 'solid-js';
import { useFocusManager } from '@solidtv/solid/primitives';
import { Button } from '@solidtv/solid-ui';

const App = () => {
  useFocusManager({
    Announcer: ["a"],
    Menu: ["m"],
    Escape: ["Escape", 27],
    Backspace: ["Backspace", 8],
    Left: ["ArrowLeft", 37],
    Right: ["ArrowRight", 39],
    Up: ["ArrowUp", 38],
    Down: ["ArrowDown", 40],
    Enter: ["Enter", 13],
  } as unknown as KeyMap);

  return (
    <view>
      <Button onEnter={() => console.log('Enter pressed')}>Button 1</Button>
      {/* More components... */}
    </view>
  );
};

export default App;
```

In this example, buttons will handle the `Enter` key press and log a message to the console. Adjust the key mappings and handlers as needed for your application.
