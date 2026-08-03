# `useHold`

Creates a reactive hold gesture handler, allowing you to trigger a different behavior when an interaction (e.g. key or button press) is held beyond a specified threshold.

This is useful in scenarios like press-and-hold navigation or repeated actions after a delay.

---

### Usage

```tsx
const [holdRight, releaseRight] = useHold({
  onHold: handleHoldRight,
  onEnter: handleOnRight,
  onRelease: handleReleaseHold,
  holdThreshold: 200,
  performOnEnterImmediately: true,
});

<view onRight={holdRight} onRightRelease={releaseRight} />;
```

---

### Parameters

#### `UseHoldProps`

| Prop                        | Type           | Description                                                                                                                           | Default      |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `onHold`                    | `HoldCallback` | Called once the hold threshold is exceeded.                                                                                           | **Required** |
| `onEnter`                   | `HoldCallback` | Called on press or key entry. May be delayed depending on config.                                                                     | **Required** |
| `onRelease`                 | `HoldCallback` | Called after a successful hold is released.                                                                                           | `undefined`  |
| `holdThreshold`             | `number`       | Time in milliseconds to wait before triggering `onHold`.                                                                              | `500`        |
| `performOnEnterImmediately` | `boolean`      | Whether `onEnter` is triggered immediately or only if released early.                                                                 | `false`      |
| `holdRequiresRepeat`        | `boolean`      | Whether a hold must be confirmed by an auto-repeat key-down. See [Not every key can report a hold](#not-every-key-can-report-a-hold). | `true`       |

Each callback receives the same context a `KeyHandler` gets — the `KeyboardEvent`
that began the press, the element whose handler ran, and the focused element:

```ts
type HoldCallback = (
  e?: KeyboardEvent,
  target?: ElementNode,
  handlerElm?: ElementNode,
) => void;
```

For `onHold` and for timer-resolved `onEnter`, this is the context captured from
the originating key-down, since those fire from a timer with no event of their
own.

---

### Returns

```ts
[startHold, releaseHold]: [HoldHandler, HoldHandler]

type HoldHandler = (
  e?: KeyboardEvent,
  target?: ElementNode,
  handlerElm?: ElementNode,
) => boolean;
```

- `startHold`: Call this on a key/button press. Starts the hold timer and conditionally calls `onEnter`.
- `releaseHold`: Call this on a key/button release. Stops the timer and calls `onEnter` or `onRelease` depending on how long it was held.

> **`startHold` needs the event.** It reads `e.repeat` to detect a hold. Passed
> directly as a key handler (`onRight={holdRight}`) it receives one. If you wrap
> it, forward all of the arguments — a wrapper that drops the event yields a
> primitive that can never detect a hold, silently, and typically only on device.

---

### Behavior Summary

| Action                | Description                                                                          |
| --------------------- | ------------------------------------------------------------------------------------ |
| Press + hold          | `onEnter` (optional) → after delay → `onHold`                                        |
| Press + release early | Calls `onEnter` if not already triggered                                             |
| Press + release late  | Calls `onHold` after threshold → on release calls `onRelease`                        |
| Immediate trigger     | If `performOnEnterImmediately` is `true`, `onEnter` is fired on press before timeout |

---

### Example Integration

```tsx
const [onHoldEnter, onHoldRelease] = useHold({
  onHold: () => console.log('Held long enough'),
  onEnter: () => console.log('Entered'),
  onRelease: () => console.log('Released after hold'),
  holdThreshold: 300,
  performOnEnterImmediately: false,
});

<MyComponent onEnter={onHoldEnter} onRelease={onHoldRelease} />;
```

---

### Holds that move focus

The canonical hold — hold OK to open a context menu — moves focus while the key
is still physically down. The platform keeps emitting auto-repeat key-downs after
`onHold` fires, and those would otherwise propagate down the **new** focus path
and fire whatever just took focus.

`useHold` handles this by latching the key in the focus manager once `onHold`
fires. Remaining auto-repeats are dropped until the key is released, and the
latch delivers `onRelease` even though the key-up now propagates somewhere the
holding element can no longer see. Suppression lifts on key-up, or on the next
fresh (non-repeat) key-down so a swallowed key-up cannot wedge a key.

Non-repeat key-downs are never suppressed, so a real press always gets through.

If you implement hold behavior without this primitive, the same latch is
available directly:

```ts
import {
  suppressKeyUntilRelease,
  releaseKeySuppression,
} from '@solidtv/solid/primitives';

suppressKeyUntilRelease(event, () => console.log('key released'));
```

Pass the `KeyboardEvent` rather than a key name where you have one. `key` is not a
stable identity for a physical key across key-down and key-up — webOS reports
Back as:

```
key-down  { key: 'GoBack',       keyCode: 461, repeat: false }
key-up    { key: 'Unidentified', keyCode: 461 }
```

Given the event, a key is matched on both its name and its keyCode, so a key-up
that renames the key still lifts the suppression. Such a key must also be mapped
by keyCode for its release to route at all:

```tsx
useFocusManager({ Back: [461, 'GoBack'] });
```

---

### Not every key can report a hold

A hold is detected from what the device sends between press and release. Some
keys send nothing usable, and on those a hold is **not detectable at all** — by
this primitive or any other.

Verified on an LG remote: the Back button emits its key-down and key-up
back-to-back the instant it is pressed, before the user has let go. Nothing
distinguishes a tap from a five-second hold, because both produce exactly the
same two events at exactly the same time.

There is no setting that recovers a hold here. `holdRequiresRepeat: false` does
not help: the key-up arrives immediately and cancels the hold timer long before
it can fire, so the press always resolves as a tap. That is the correct outcome —
the alternative would be firing `onHold` on a plain tap.

**Design around it.** If a gesture must work on every device, do not put it on a
key that cannot report one. Put the hold on OK/Enter, which does report a real
press duration on the remotes tested, and give Back a plain `onEnter` action.

The three signals a key can offer, in the order the primitive prefers them:

| Signal                      | Hold detectable? |                                                                                |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------ |
| Auto-repeat key-downs       | Yes              | Confirms the key is still down. The default and most reliable path.            |
| Key-up only on real release | Yes              | No key-up by the threshold means still held — set `holdRequiresRepeat: false`. |
| Key-up immediately on press | **No**           | Tap and hold are indistinguishable. LG Back behaves this way.                  |

If a press delivers no key-up and no auto-repeat by the threshold, it is
ambiguous, and by default resolves as a **tap** — which is what keeps taps
working on remotes that swallow key-up entirely (webOS OK). Set
`holdRequiresRepeat: false` for a key you know reports key-up only on real
release, so the timer alone resolves the hold:

```tsx
const [holdEnter, releaseEnter] = useHold({
  onHold: openContextMenu,
  onEnter: openTile,
  holdRequiresRepeat: false, // this key emits no auto-repeat
});
```

Confirm behavior per key on real hardware before relying on it — it varies by
key and by device, not just by platform. Logging the raw events is enough:

```tsx
<view
  onCaptureKey={(e) => {
    console.log('down', e.key, e.keyCode, e.repeat, performance.now());
    return false;
  }}
  onCaptureKeyRelease={(e) => {
    console.log('up', e.key, e.keyCode, performance.now());
    return false;
  }}
/>
```

If the `up` line appears at press time rather than release time, that key cannot
report a hold.

---

### Caveat: `startHold` stops propagation

`startHold` returns `true`, which ends the focus manager's bubble phase —
**ancestor handlers for that key will not run.** Attaching `useHold` to a row
removes that row's subtree from every ancestor `onEnter`.

This is structural rather than incidental: whether the press was a tap isn't
known until key-up or until the timer fires, by which point the propagation pass
is long over, so a deferred tap cannot be handed back to ancestors.

If an ancestor performs work on that key — a root-level handler resolving an
`href`, or a container doing analytics — invoke it from `onEnter` yourself:

```ts
const onEnter: HoldCallback = (e, target, focused) => {
  for (let elm = target?.parent; elm; elm = elm.parent) {
    if (
      typeof elm.onEnter === 'function' &&
      elm.onEnter(e, elm, focused) === true
    )
      return;
  }
};
```
