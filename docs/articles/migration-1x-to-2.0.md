# Migration Guide: SolidTV v1.x to v2.0

SolidTV 2.0 moves the framework onto **SolidJS 2.0**. Solid 2.0 rewrote its
reactive core, split its subpath exports into separate packages, renamed most of
the control-flow components, and changed the custom-renderer contract SolidTV is
built on.

SolidTV absorbs everything it can, but Solid's renames and its new update timing
reach application code. This guide covers what you have to change.

> SolidTV 2.0 tracks Solid's `2.0.0-rc` line. Solid calls the API frozen
> "barring showstoppers", but there is no stable release date yet. The 1.x line
> continues to receive fixes — stay on it if you need a stable dependency, or if
> you use the router (see [Routing](#routing-is-temporarily-unavailable)).

## Overview of steps

1. Upgrade `solid-js` to `2.0.0-rc.1` and install the Solid 2.0 toolchain
2. Rename the control-flow components (`Suspense` → `Loading`, and friends)
3. Split every `createEffect` into a compute and an effect
4. Add `flush()` wherever you write state and then read it synchronously
5. Replace `createResource`, `batch`, `on`, and the other removed primitives
6. Move lifecycle out of `ref` callbacks

---

## 1. Dependencies

Solid 2.0's satellite packages publish under the `next` dist-tag, and
`solid-js@2.0.0-rc.1` requires `^2.0.0-rc.1` of them. Installing from `latest`
gives you `rc.0` and two mismatched reactive cores, so pin exact versions:

```jsonc
{
  "dependencies": {
    "solid-js": "2.0.0-rc.1",
  },
  "devDependencies": {
    "babel-preset-solid": "2.0.0-rc.1",
    "vite-plugin-solid": "3.0.0-next.27",
  },
}
```

`solid-js`'s subpaths became separate packages — `solid-js/web` is now
`@solidjs/web`, and `solid-js/universal` is `@solidjs/universal`. Most apps do
not import these directly, but check any that do.

Your Vite config is otherwise unchanged; `generate: 'universal'` and
`moduleName: '@solidtv/solid'` still work:

```ts
solidPlugin({
  solid: { moduleName: '@solidtv/solid', generate: 'universal', builtIns: [] },
});
```

## 2. Component renames

Solid renamed most control-flow components, and SolidTV re-exports them under
Solid's new names rather than aliasing the old ones. Every one of these fails at
build time — a missing export or an unknown JSX element — so the compiler will
find them all for you.

| v1.x                             | v2.0                  |
| -------------------------------- | --------------------- |
| `Suspense`                       | `Loading`             |
| `SuspenseList`                   | `Reveal`              |
| `ErrorBoundary`                  | `Errored`             |
| `Index`                          | `<For keyed={false}>` |
| `For`, `Show`, `Switch`, `Match` | unchanged             |

`Index` maps onto `<For keyed={false}>` with **no callback changes** — the
signature `(item: Accessor<T>, index: number)` is identical:

```diff
- <Index each={items()}>
-   {(item, index) => <text>{item().label}</text>}
- </Index>
+ <For each={items()} keyed={false}>
+   {(item, index) => <text>{item().label}</text>}
+ </For>
```

Solid also adds `Repeat`, which renders from a **count** rather than an array.
It is not a replacement for `Index`.

The Lightning-aware `Suspense` from `@solidtv/solid/primitives` is likewise now
`Loading`. Note one behaviour change: the 1.x version mounted your children into
a hidden view while suspended so the renderer could warm their textures early.
That relied on 1.x Suspense internals — in 2.0 the children do not exist until
the suspending read resolves, so the off-screen slot was removed rather than
faked.

## 3. `createEffect` takes two functions

This is the largest mechanical change. An effect is now a **tracked compute**
plus an **untracked effect**:

```diff
- createEffect(() => {
-   console.log(count());
- });
+ createEffect(
+   () => count(),
+   (value) => console.log(value),
+ );
```

The compute tracks; the effect does not. Anything the effect needs to react to
must be read in the compute.

Cleanup moved too — return it from the effect instead of calling `onCleanup`:

```diff
  createEffect(
    () => src(),
    (url) => {
      const img = load(url);
-     onCleanup(() => img.cancel());
+     return () => img.cancel();
    },
  );
```

**If your effect's body genuinely needs to track throughout**, use
`createTrackedEffect`, the single-phase escape hatch:

```ts
createTrackedEffect(() => {
  const el = focused();
  if (!el) return;
  el.on('change', handler);
  return () => el.off('change', handler); // cleanup is the return value
});
```

Note `onCleanup` is **forbidden** inside `createTrackedEffect` — return a
cleanup function instead.

> A one-argument `createEffect` throws `[MISSING_EFFECT_FN]` at **runtime**, not
> at compile time. TypeScript types the single-argument overload as `never`,
> which is still valid as a statement — so the typechecker will not find these
> for you. Grep for them.

## 4. Updates are batched — the one silent change

Solid 2.0 batches writes to a microtask. A write is **not visible to a
synchronous read** until it flushes:

```js
setCount(1);
count(); // → still the old value
flush();
count(); // → 1
```

Nothing errors. Code that writes state and then immediately reads it back — or
reads a DOM/node property that a write was expected to have updated — silently
changes behaviour. This is the change most likely to bite, and the only one with
no compiler or runtime signal.

Where you need a synchronous settle point, call `flush()`:

```diff
+ import { flush } from 'solid-js';

  setSelected(3);
+ flush();
  doSomethingWith(container.children[3]);
```

`batch()` is gone — batching is automatic, so delete the call. There is no
`flushSync`; the function is named `flush`.

SolidTV already flushes internally where the framework itself depends on
synchronous visibility — most importantly the focus path, so a keypress landing
immediately after a focus change still sees the new path. You only need `flush()`
in your own write-then-read sequences.

## 5. Removed primitives

| Removed                                                                              | Replacement                                                     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `batch`                                                                              | nothing — batching is automatic; use `flush()` for a sync point |
| `createResource`                                                                     | an async compute: `createMemo(() => fetchThing())`              |
| `on(deps, fn)`                                                                       | the compute/effect split                                        |
| `createComputed`                                                                     | `createRenderEffect` or `createEffect`                          |
| `mergeProps`                                                                         | `merge`                                                         |
| `splitProps`                                                                         | `omit`                                                          |
| `unwrap`                                                                             | `snapshot`                                                      |
| `onMount`                                                                            | `onSettled`                                                     |
| `produce`, `createMutable`                                                           | store setters mutate a draft directly                           |
| `createSelector`, `createDeferred`, `startTransition`, `useTransition`, `catchError` | see Solid's migration guide                                     |
| `/*@once*/`                                                                          | no replacement — remove the annotation                          |

### Async data

`createResource` is replaced by returning a promise from a compute. Reading the
result suspends to the nearest `<Loading>` boundary:

```diff
- const [data] = createResource(userId, fetchUser);
+ const data = createMemo(() => fetchUser(userId()));

  <Loading fallback={<text>Loading…</text>}>
    <text>{data().name}</text>
  </Loading>
```

To read without suspending — the equivalent of a resource's `undefined`-while-
loading behaviour — wrap the read in `latest`:

```ts
const user = () => latest(data);
```

### `omit` is not `splitProps`

`omit` takes **rest arguments**, not an array, and returns a **single object**
rather than a `[picked, rest]` tuple. Passing an array silently returns the
props unchanged:

```diff
- const [local, others] = splitProps(props, ['component']);
+ const others = omit(props, 'component');   // read props.component directly
```

### Context

`Context.Provider` is gone — the context object is itself the provider:

```diff
- <MyContext.Provider value={value}>{props.children}</MyContext.Provider>
+ <MyContext value={value}>{props.children}</MyContext>
```

## 6. Refs are no longer owned

`getOwner()` returns `null` inside a `ref` callback, so `onCleanup()` there
**silently stops working**. Move that lifecycle to `onSettled` or to the
component body.

## 7. Writing signals from inside a computation

Solid 2.0 rejects writes to reactive state from inside an owned scope with
`[REACTIVE_WRITE_IN_OWNED_SCOPE]`. If the write is deliberate — a high-water
mark, or state driven from an imperative event handler re-entered into an owner
— opt the signal in:

```ts
const [offset, setOffset] = createSignal(0, { ownedWrite: true });
```

## SolidTV-specific changes

Beyond Solid itself:

- **`View` and `Text`** (the capitalized components, deprecated since 1.x) are
  removed. Use the `<view>` and `<text>` intrinsic elements.
- **The `./shaders` subpath** is removed. It pointed at a directory deleted some
  releases ago; shaders are exported from the main entry point.
- **`VITE_USE_NEW_FLEX` is gone.** The CSS-aligned flex engine — `flexShrink`,
  `flexBasis`, array-syntax padding/margin — is now the only engine, so drop the
  environment variable. Behaviour matches having had the flag enabled.
- **`createBlurredImage`** returns a plain accessor rather than a
  `Resource`, since Solid removed the `Resource` type. Reads behave as before
  (`undefined` until the first blur resolves), but `.loading`, `.error` and
  `.state` are gone.
- **`mergeProps`** is still exported under that name — the JSX compiler requires
  it — and still carries SolidTV's Proxy-free fix for
  [solidjs/solid#2282](https://github.com/solidjs/solid/issues/2282).

## Routing is temporarily unavailable

The `@solidtv/solid/primitives/router` entry point — `HashRouter`, `KeepAlive`,
and `KeepAliveRoute` — is **not available in 2.0.0**. It depends on
`@solidjs/router`, which has no Solid 2.0 release yet (it is at
`2.0.0-next.17`), and on several of its internals.

If your app uses routing, stay on SolidTV 1.x for now. The entry point returns
once the router ships Solid 2.0 support.

## Legacy device support

Chrome 38 (LG webOS 3.x, older Tizen, PS4) remains supported. Solid 2.0 keeps
its `SUPPORTS_PROXY` feature detection, its reactive core is Proxy-free, and it
adds no `async`/generator syntax to that core — so the
[legacy build setup](/deploy/legacy.md) is unchanged.

The one caveat is the same as in 1.x: reactive spreads (`<Comp {...fn()} />`)
lose their props on engines without `Proxy` unless they go through SolidTV's
`mergeProps`, which the JSX compiler wires up automatically when `moduleName` is
set to `@solidtv/solid`.
