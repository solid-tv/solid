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

| Prop                        | Type                | Description                                                                                                             | Default      |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------ |
| `onHold`                    | `HoldCallback`      | Called once the hold threshold is exceeded.                                                                             | **Required** |
| `onEnter`                   | `HoldCallback`      | Called on press or key entry. May be delayed depending on config.                                                       | **Required** |
| `onRelease`                 | `HoldCallback`      | Called after a successful hold is released.                                                                             | `undefined`  |
| `holdThreshold`             | `number`            | Time in milliseconds to wait before triggering `onHold`.                                                                | `500`        |
| `performOnEnterImmediately` | `boolean`           | Whether `onEnter` is triggered immediately or only if released early.                                                   | `false`      |
| `holdRequiresRepeat`        | `boolean \| 'auto'` | Whether a hold must be confirmed by an auto-repeat key-down. See [Keys without auto-repeat](#keys-without-auto-repeat). | `'auto'`     |

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

---

### Keys without auto-repeat

When the timer fires having seen neither a key-up nor an auto-repeat, the press
is ambiguous: the key is either still held, or already released with its key-up
swallowed. `holdRequiresRepeat` decides how that resolves.

This is a **per-key** property, not a per-platform one. On webOS, OK emits
auto-repeat but swallows key-up; Back is the reverse — it emits key-up but no
OS-level `repeat === true`. A hold on Back is therefore unreachable if
auto-repeat is required, and a timer is the only way to detect it.

| Value              | Behavior                                                             |
| ------------------ | -------------------------------------------------------------------- |
| `'auto'` (default) | Use auto-repeat where the key needs it, fall back to timer where not |
| `false`            | Always resolve by timer                                              |
| `true`             | Require an auto-repeat; never resolve a repeat-less press as a hold  |

`'auto'` keys off whether the key delivers key-up, which is the only thing that
disambiguates the case:

- **Key delivers key-up** (webOS Back): reaching the threshold without one means
  it is genuinely still down. No auto-repeat needed — resolve by timer → `onHold`.
- **Key swallows key-up** (webOS OK): a finished press looks identical to one
  still held, so only an auto-repeat can confirm a hold. Without one → `onEnter`.

The focus manager records key-up delivery per key as it observes it, so this
needs no configuration. It does mean **the first press of a key resolves as a
tap**, since nothing has been observed yet. For a key whose behavior you already
know, say so and skip the warm-up:

```tsx
// webOS Back: emits key-up, but never emits auto-repeat.
const [holdBack, releaseBack] = useHold({
  onHold: exitApp,
  onEnter: goBack,
  holdThreshold: 1000,
  holdRequiresRepeat: false, // resolve by timer from the very first press
});

<view onBack={holdBack} onCaptureBackRelease={releaseBack} />;
```

An early key-up still resolves as a tap under every setting — this only governs
the no-key-up **and** no-repeat case.

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
