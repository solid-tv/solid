# Migration Guide: SolidTV v1.x to v2.0

SolidTV 2.0 moves the framework onto **SolidJS 2.0**. Solid 2.0 rewrote its
reactive core, split its subpath exports into separate packages, renamed most of
the control-flow components, and changed the custom-renderer contract SolidTV is
built on.

SolidTV absorbs everything it can, but Solid's renames and its new update timing
reach application code. This guide covers what you have to change.

> SolidTV 2.0 tracks Solid's `2.0.0-rc` line. Solid calls the API frozen
> "barring showstoppers", but there is no stable release date yet, and
> `@solidjs/router` is still on `next`. The 1.x line continues to receive fixes
> — stay on it if you need a stable dependency tree.

## Overview of steps

1. Upgrade `solid-js` to `2.0.0-rc.1` and install the Solid 2.0 toolchain
2. Rename the control-flow components (`Suspense` → `Loading`, and friends)
3. Split every `createEffect` into a compute and an effect
4. Add `flush()` wherever you write state and then read it synchronously
5. Replace `createResource`, `batch`, `on`, and the other removed primitives
6. Move lifecycle out of `ref` callbacks
7. Rebuild your router — routes are data now, not `<Route>` components
8. Repoint JSX types at `@solidtv/solid`
9. Rename `w`/`h`, drop `effects`, `node.lng` and the DOM renderer ([the renderer binding](#renderer-binding-20-on-solidtvrenderer-21))

---

## 1. Dependencies

Solid 2.0's satellite packages publish under the `next` dist-tag, and
`solid-js@2.0.0-rc.1` requires `^2.0.0-rc.1` of them. Installing from `latest`
gives you `rc.0` and two mismatched reactive cores, so pin exact versions:

```jsonc
{
  "dependencies": {
    "solid-js": "2.0.0-rc.1",
    // only if you use @solidtv/solid/primitives/router
    "@solidjs/router": "2.0.0-next.17",
  },
  "devDependencies": {
    "babel-preset-solid": "2.0.0-rc.1",
    "vite-plugin-solid": "3.0.0-next.27",
    // if you test with it — 0.8.x is Solid 1.x only
    "@solidjs/testing-library": "1.0.0-beta.2",
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

### `createMemo` lost its initial value

`createMemo(fn, initialValue, options)` is now `createMemo(fn, options)`. The
compute's `prev` parameter simply starts as `undefined`:

```diff
- const seen = createMemo((p) => p || props.active, false);
+ const seen = createMemo((p) => p || props.active);
```

Passing the old second argument is a type error (`Expected 1-2 arguments`), so
the compiler finds these. `equals` and `name` still live in `options`.

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

## 8. TypeScript: JSX types come from SolidTV now

Solid 2.0 no longer ships a `JSX` namespace — each renderer declares its own,
and SolidTV declares the one for `<view>` / `<text>` / `<node>`. Type-only
imports from `solid-js` therefore move:

```diff
- import type { JSX, JSXElement } from 'solid-js';
+ import type { JSX } from '@solidtv/solid';
```

`JSX.Element` keeps working through `@solidtv/solid`. Solid's own renderer-
agnostic equivalent is now the top-level `Element` type, so
`import type { Element } from 'solid-js'` also works if you prefer it — just
note it shadows the DOM `Element` global.

No change is needed to `jsxImportSource: "@solidtv/solid"` in your tsconfig.

## SolidTV-specific changes

Beyond Solid itself:

- **`View` and `Text`** (the capitalized components, deprecated since 1.x) are
  removed. Use the `<view>` and `<text>` intrinsic elements.
- **The `./shaders` subpath** is removed. It pointed at a directory deleted some
  releases ago; shaders are exported from the main entry point.
- **`VITE_USE_NEW_FLEX` is gone.** The CSS-aligned flex engine — `flexShrink`,
  `flexBasis`, array-syntax padding/margin — is now the only engine, so drop the
  environment variable. Behaviour matches having had the flag enabled, plus the
  legacy engine's `flex-grow` overflow warning, which the new engine had been
  missing.
- **`createBlurredImage`** returns a plain accessor rather than a
  `Resource`, since Solid removed the `Resource` type. Reads behave as before
  (`undefined` until the first blur resolves), but `.loading`, `.error` and
  `.state` are gone.
- **`mergeProps`** is still exported under that name — the JSX compiler requires
  it — and still carries SolidTV's Proxy-free fix for
  [solidjs/solid#2282](https://github.com/solidjs/solid/issues/2282).

### Renderer binding (2.0 on @solidtv/renderer 2.1)

SolidTV 2.0 runs on `@solidtv/renderer` 2.1, and an `ElementNode` is now the
renderer's handle for its node: it owns a slot in the renderer's node store and
reads and writes the store directly. There is no second object behind it, no
bag of props held until the node renders, and no DOM renderer. The app-facing
syntax is unchanged (`<view>`, `<text>`, `style`, `transition`, `states`,
`border`, `shadow`, the shortcuts, `ref`); these are the removals, each with
its replacement.

| 1.x                                                                                                                                                            | 2.0                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `w` and `h`, as JSX props and as style keys                                                                                                                    | `width` and `height`                                                                                                                                                                                                                                                |
| `node.lng`, `node._rendererProps`                                                                                                                              | The node itself: `node.alpha`, `node.setNow('alpha', 1)` to write without the transition                                                                                                                                                                            |
| A prop reading `undefined` (`node.alpha` before any write, or after a style undo with no base value)                                                           | The renderer default: `alpha` 1, `scale` 1, `color` transparent (white once `src` is set first), `fontSize` 16, and so on                                                                                                                                           |
| `effects={{ linearGradient, radialGradient, holePunch, shadow, border, … }}`                                                                                   | The direct keys: `border`, `borderTop/Right/Bottom/Left`, `borderRadius`, `linearGradient`, `radialGradient`, `shadow`, `holePunch`                                                                                                                                 |
| `worldX`, `worldY`, `zIndexLocked`, `scrollable`, `scrollY`, `strictBounds`, `fontStretch`, `textBaseline`, `textOverflow`, `textRendererOverride`, `wordWrap` | None. They were forwarded to the renderer, which never had them, so they did nothing. Use `absX` and `absY` for world position, `overflowSuffix` and `maxLines` for text overflow                                                                                   |
| `DOMRendererMain`, `DOMNode`, `isDomRenderer`, `isDomRendererActive`, `Config.domRendererEnabled`, the `SOLIDTV_DOM_RENDERING` define                          | A headless `RendererCore` for tests: `createRenderer({ core })` (see [DOM Renderer](/articles/domrenderer.md)). Delete the define                                                                                                                                   |
| `renderer.stage.shManager` and the other 1.x renderer shims                                                                                                    | `renderer.registerShaderType(...)`, and `core` (the `RendererCore`) for the rest                                                                                                                                                                                    |
| `Config.rendererOptions` typed as the 1.x renderer's settings                                                                                                  | `RendererOptions`: the renderer's `CoreSettings` plus the options of the GL loop (and `canvas`, or `core` to run headless)                                                                                                                                          |
| `renderEngine`, `fontEngines` in `Config.rendererOptions`                                                                                                      | Dropped: there is one engine (WebGL) and one text engine (SDF). They are ignored with a console warning                                                                                                                                                             |
| `startLightningRenderer(options, node)`, the 1.x export                                                                                                        | `startRenderer(options)`, with the mount target in `options.canvas`. `createRenderer(options, node)` is unchanged: it passes `node` on as `canvas`                                                                                                                  |
| `registerDefaultShaders(shManager)` and the `registerDefaultShader*` functions, taking the shader manager                                                      | They take a `RendererCore`: pass the exported `renderer` (or your headless core), as in `registerDefaultShaders(renderer)`                                                                                                                                          |
| `Config.convertToShader`, `(node, effects) => shader`                                                                                                          | `(node) => void`: it reads the node's props and writes the shader to the node itself                                                                                                                                                                                |
| `isINode(x)`, `logRenderTree(node)`, `loadFontToDom(font)`                                                                                                     | `isINode`: use `x instanceof ElementNode`. `logRenderTree`: none. `loadFontToDom`: `core.loadFont(font)`, or `loadFonts([...])`                                                                                                                                     |
| `node.emit('name', data)` bubbling to the `on<Name>` handlers up the parent chain, returning `true` when one handled it                                        | `node.bubble('name', data?)`, with the same walk and result. `emit(name, data)` is now the renderer's delivery to `on(name, fn)` listeners: it returns nothing, does not bubble, and never calls an `on<Name>` prop (dev builds warn once per name when one exists) |

Types that went with them: `Effects`, `StyleEffects`, `RenderedNode` (every
node reads numbers now), `IntrinsicNodeProps`, `IntrinsicNodeStyleProps` and
`IntrinsicTextNodeStyleProps` (use `NodeProps`, `NodeStyles` and `TextStyles`;
`NodeStyles` is also the replacement for `Effects` and `StyleEffects`).
`AnyFunction` is now `(this: never, ...args: never[]) => unknown`: it still
constrains `chainFunctions` and accepts every function, but a value typed
`AnyFunction` can no longer be called, and unannotated lambdas in an
all-lambda `chainFunctions` call are contextually typed `never`. `isArray` is
`isArray(item): item is unknown[]` (it was `any[]`).
`createRawShaderAccessor` and `shaderAccessor` are no longer exported. The
`endValue` parameter of an `onAnimation` handler is named `value` (the
animating handler gets the value written, the stopped handler the value at the
stop).

`ElementNode` is a class with declared members and no index signature, so
`node.somethingElse` is a type error. To keep your own data on a node, use the
`data` prop or augment the class:

```ts
declare module '@solidtv/solid' {
  interface ElementNode {
    contractItem?: { href: string };
  }
}
```

`NodeProps` and `TextProps` do keep `[key: string]: unknown`, so a data prop
such as `item={x}` on a `<view>` still type-checks (it lands on the node as a
plain field, as in 1.x). The `holePunch` prop is kept, with its prop types.

Behaviour you may notice:

- **`absX` and `absY` read the last frame's world transform.** A write to `x`
  shows in `absX` after the next frame, not at once.
- **`onAnimation.stopped` fires from the renderer, once per stop.** It is the
  renderer's `onStop` for the animation of that prop, not a timer, and it
  reports the value at the stop: the target when the animation completes, where
  it stopped when something interrupted it. The hook is installed once per
  controller, so repeated writes with the same `transition` settings do not
  stack handlers.
- **Border and shadow transitions allocate per write.** The two shaders animate
  their parsed props, which allocates on each write, so nodes with a border or
  shadow transition are outside the zero-garbage rule of the plain props.
- **A removed node stays drawn until its destroy.** `removeChild` runs
  `onRemove` and queues the delete; the node stays linked in the renderer's
  store, and drawn, until it is destroyed at the next post-mutation flush, so an
  exit animation started in the same tick still plays. A node reinserted before
  the flush keeps its slot.
- **`preserve`d nodes are unlinked at remove.** The flush never destroys a node
  with `preserve`, so `removeChild` unlinks it from its renderer parent at once,
  right after `onRemove`. Hide it in `onRemove` if it must not stay on screen;
  no exit is drawn from the old place. Inserting it again links it back.
- **`createRenderer` returns `rootNode` lazily.** There is no module-level
  `rootNode` before `createRenderer` has run; read it from the returned object,
  or after the call.

## Routing

`@solidtv/solid/primitives/router` requires `@solidjs/router@^2.0.0-next.17`.
Solid Router 2.0 is a redesign: a router is built from a **route tree plus a
history adapter**, and `<Route>` components no longer exist — routes are plain
data.

### `HashRouter` → `createHashRouter`

Because the route tree is supplied when the router is created, the 1.x
`<HashRouter>` component becomes a factory. Solid Router now ships
`hashHistory()` itself, so all SolidTV adds is the Proxy-free params/query path
for Chrome 38.

```diff
- <HashRouter root={App}>
-   <Route path="/" component={Home} />
-   <Route path="/show/:id" component={Show} />
- </HashRouter>
+ const Router = createHashRouter({
+   routes: [
+     { path: '/', component: Home },
+     { path: '/show/:id', component: Show },
+   ],
+ });
+
+ render(() => <Router>{(props) => <App>{props.children}</App>}</Router>);
```

`forceProxy` and `queryParams` are unchanged and still control the Proxy-free
path. `hashParser`, `bindEvent`, `SUPPORTS_PROXY`, `createMemoWithoutProxy`,
and `collectDynamicParams` are all still exported.

### `KeepAliveRoute` returns a route definition

It previously returned `<Route>` JSX; it now returns a `RouteDefinition` object
to place in a `routes` array. Its options are otherwise unchanged.

```diff
- <KeepAliveRoute path="/browse" component={Browse} />
+ createHashRouter({
+   routes: [KeepAliveRoute({ path: '/browse', component: Browse })],
+ });
```

The component's props are now typed `RouteSectionProps` (Solid Router's new
name) rather than `RouteProps`, and `isAlive` is still injected.

`KeepAlive` itself — the non-route component — is unchanged.

> One packaging note: `@solidjs/router` ships its factory as untranspiled
> `.jsx` under the `solid` export condition, so your bundler compiles it with
> whatever `moduleName` you configured. That is fine for SolidTV — the router's
> JSX is entirely component tags, which compile to renderer-agnostic
> `createComponent` calls.

## Legacy device support

Chrome 38 (LG webOS 3.x, older Tizen, PS4) remains supported. Solid 2.0 keeps
its `SUPPORTS_PROXY` feature detection, its reactive core is Proxy-free, and it
adds no `async`/generator syntax to that core — so the
[legacy build setup](/deploy/legacy.md) is unchanged.

The one caveat is the same as in 1.x: reactive spreads (`<Comp {...fn()} />`)
lose their props on engines without `Proxy` unless they go through SolidTV's
`mergeProps`, which the JSX compiler wires up automatically when `moduleName` is
set to `@solidtv/solid`.
