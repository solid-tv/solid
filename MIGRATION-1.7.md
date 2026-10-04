# Migrating to @solidtv/solid 1.7

Solid 1.7 runs on `@solidtv/renderer` 2.0 (WebGL and SDF text only) and
rewrites Solid's internals for less CPU per key press. Apps written against
`<view>`, `<text>` and the primitives keep their code, except where this file
says otherwise.

> **Status: draft until Checkpoint 2.** Section 1 is final (the renderer's
> breaks). Sections 2 and 3 hold the changes the maintainer approved at
> Checkpoint 1 on 2026-10-03 (decisions 5.1-5.6, the fixes B1-B21 and the demo
> app's terser `reduce_funcs: false`), as implemented in the streams merged so
> far: M (exports, renderer-break absorption), F (focus), P (primitives),
> L (flex), N (nodes), T (text measurement) and the renderer's R1, R2 and R4.
> The styles stream (S) is not merged yet: its entries go where the
> `<!-- S: pending -->` markers are. The
> gains quoted are single 6x runs taken while other work ran (see
> `docs/perf/log.md`); the Checkpoint 2 series replaces them.

Every entry gives what changes, the solid-demo-app files it hits, the measured
gain that justifies it (for Solid's own changes), and the upgrade step.

## 1. Breaks inherited from @solidtv/renderer 2.0

These come with renderer 2.0 and cannot be avoided by Solid. The full list,
with the renderer's numbered behaviour changes, is the renderer's
`docs/upgrade-1.x-to-2.0.md` and section 14 of its design
(`docs/superpowers/specs/2026-09-29-renderer-v2-architecture-design.md`). The ones an app built on Solid meets:

| What breaks                                                                                                                                                            | solid-demo-app                                                                                                      | Upgrade step                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@solidtv/renderer/webgl` and `/canvas` are gone (`WebGlCoreRenderer`, `SdfTextRenderer`, `CanvasCoreRenderer`, `CanvasTextRenderer`)                                  | `src/index.tsx:22-23`                                                                                               | Delete the imports. `@solidtv/renderer/webgl/shaders` stays as an alias of `/shaders` for 2.x.                                                                                                                                         |
| `Config.rendererOptions.renderEngine` and `.fontEngines` are removed: WebGL and SDF text are the only engines                                                          | `src/index.renderer1.tsx:193-197` (the 1.x entry; `src/index.tsx` is ported)                                        | Delete them. A `?mode=canvas` switch no longer does anything. Solid drops both from the options before it builds the renderer and logs one `console.warn` for each, in every build, that it was removed in renderer 2.0 (section 2.6). |
| `renderer.stage.shManager.registerShaderType` is gone                                                                                                                  | `src/index.renderer1.tsx:218-226` (the 1.x entry; `src/index.tsx` is ported)                                        | `renderer.registerShaderType(name, type)`. Solid keeps `stage.shManager` working on the WebGL renderer and logs one `console.warn`, in every build, the first time it is read (section 2.6).                                           |
| Text is SDF only. A web font (`fontUrl`) no longer draws on the WebGL renderer; every family needs an MSDF/SSDF font loaded or aliased, the default family included    | `src/fonts.ts:44,48` (web fonts, DOM mode only)                                                                     | Load an SDF font for each family the app uses on WebGL.                                                                                                                                                                                |
| A text whose font family is not loaded is no longer an error: it draws nothing (1.9 threw and the rest of the page failed)                                             | `src/styles.ts:155`, `src/pages/gridStyles.ts:35` (`fontWeight` `normal` and `600` build families no font provides) | Load the families the app names, or add the weights to `Config.fontWeightAlias`.                                                                                                                                                       |
| SDF text draws above a later quad without a `zIndex` (it used to be under a scrim drawn after it)                                                                      | to check on device                                                                                                  | Give the covering quad a `zIndex`.                                                                                                                                                                                                     |
| The minimum browser is **Chrome 47** (1.9: Chrome 38). webOS 3.x (Chromium 38) is below the floor                                                                      | `BENCHMARKING.md` (`LGWhite`)                                                                                       | Target Chrome 47+.                                                                                                                                                                                                                     |
| `renderer.stage.options` is gone                                                                                                                                       | `src/pages/Benchmark.tsx:28-36, 57-66, 97-108` (guarded, falls back)                                                | Read `renderer.settings`; write with `renderer.setOptions`.                                                                                                                                                                            |
| `stage.txMemManager.getMemoryInfo()` is gone                                                                                                                           | none in the web app (Solid's `FPSCounter` is updated); `nativescript/app/app.ts:54` calls it                        | `renderer.memoryInfo()`.                                                                                                                                                                                                               |
| `el.lng.id` is the node's slot in the renderer's store (0 for the root, reused after a destroy, -1 once destroyed)                                                     | none found                                                                                                          | Use `el.lng.uid` for a stable id.                                                                                                                                                                                                      |
| `loaded` for text arrives between the walks of the frame that lays it out; `idle` fires in the frame that drew the last change, and can fire while textures still load | `src/pages/Benchmark.tsx` (waits for idle)                                                                          | Wait for `renderer.pendingTextures === 0` at an `idle` to wait for every texture.                                                                                                                                                      |
| `Image` with a placeholder: the image's download starts once the placeholder shows (1.6 started both at once)                                                          | none found                                                                                                          | None.                                                                                                                                                                                                                                  |
| Shaders: `el.lng.shader` reads `null` without one; `createShader` of an unregistered type returns `null` with a warning                                                | `src/pages/ButtonsMaterial.tsx` (`RoundedRectangle` is not registered, on every arm)                                | Register the type.                                                                                                                                                                                                                     |

## 2. Solid 1.7 changes (approved at Checkpoint 1)

The maintainer approved these on 2026-10-03. Each states the measured gain
that justifies it. The ids 2.1-2.6 are the proposal numbers of the Checkpoint 1
draft, kept because tests and commits cite them; the design spec's decision
numbers (`docs/superpowers/specs/2026-10-03-solid-1.7-design.md`, section 5)
are in the titles. Decision 5.4 (a `$focus` width or height change still does
not reflow its flex parent) changes nothing.

### Keys and focus

- **2.1 One reactive flush per focus change (decision 5.1).**
  - **What changes:** `onFocus`, `onBlur` and `onFocusChanged` still run in
    the same order, but the whole focus change (the callbacks, `focusPath`,
    `activeElement`) runs in one Solid `batch`.
    - An effect or JSX binding triggered by a signal written in one of these
      callbacks runs once, after the last callback of the change, instead of
      right after each write.
    - Effects on `focusPath` now run in the same flush as those on
      `activeElement`, after both are published.
    - Memos read inside the callbacks are still current.
    - A callback that writes a signal and then reads a node prop that an
      effect sets from that signal sees the old value until the change ends.
    - A focus change made from inside a focus callback (for example
      `setActiveElementCore`) no longer publishes the intermediate
      `activeElement`/`focusPath` to effects. Outside a key handler, effects
      used to see A, then B; now they see only B. The callbacks, the focus
      states and the final values are as before.
    - If a focus callback throws, Solid's `batch` drops the effects queued by
      earlier callbacks of that change (before, each write had already
      flushed). The exception still propagates as before.
  - **Gain:** portal-focus-text reactivity 1.80 → 1.08 KiB/op, total 26.01 →
    24.34 KiB/op; time 0.949 → 0.734 ms (1 run, noisy).
  - **Demo app:** `src/pages/Portal.tsx:227` (`onFocusChanged={setHasFocus}`).
    `src/components/NavDrawer/NavDrawer.tsx:40-47` (`onFocus`/`onBlur`:
    `setFocus` is deferred anyway, `states.remove('$focus')`) is unaffected.
  - **Upgrade step:** none expected. If a focus callback relied on an effect
    having already run after its own signal write, read the signal instead.
- **2.4 The hold contract (decision 5.5).**
  - **What changes:** nothing in Solid. `useHold` is the contract:
    `on<Name>Hold` handlers and `useFocusManager`'s `userKeyHoldMap` and
    `holdThreshold` options were removed in 1.5.1 and are not restored.
  - **Demo app:** `src/pages/App.tsx:5, 32-38` and `src/pages/KeyHandling.tsx:49`
    moved their hold handlers to `useHold` (the demo's `EnterHold` and
    `BackHold` never fired on 1.6.4; `BackHold` had no handler and was
    dropped).
  - **Upgrade step:** none for an app already on `useHold`; otherwise move
    each `userKeyHoldMap` entry and `on<Name>Hold` handler to `useHold` on the
    element that owns it. Two differences from the removed hold map: it
    resolved a hold by its timer alone, while `useHold` by default needs an
    auto-repeat key-down by the threshold and otherwise resolves the press as
    a tap (set `holdRequiresRepeat: false` for a key that reports key-up only
    on real release); and the handler `useHold` returns handles the key, so
    `onEnter={holdEnter}` stops Enter from bubbling to ancestors.

### States and styles

- **2.5 `states` Array methods return plain arrays.**
  - **What changes:** `states.slice()`, `filter()`, `map()`, `splice()` and
    the other `Array` methods return a plain `Array`, not a `States`. `States`
    itself is still an `Array` subclass, and every `States` method behaves as
    before (except B2 in section 3).
  - **Gain:** no `States` construction per `remove`: about 200 B/op on every
    navigation scenario; navdrawer-toggle total 22.08 → 14.15 KiB/op, together
    with in-place removal.
  - **Demo app:** none found (grep for `states.(slice|map|filter|concat|splice|reduce|find)`).
  - **Upgrade step:** none, unless code calls `States` methods
    (`has`/`add`/`toggle`) on the result of `states.slice()`. Use
    `node.states` itself.

<!-- S: pending -->

### Layout and flex

- **2.3 One flex engine (decision 5.3).**
  - **What changes:** `src/core/flex.ts` and `VITE_USE_NEW_FLEX` are gone;
    every build runs `flexLayout.ts`. Apps that did not set the variable now
    get, where the engines differed:
    - a number `padding` also offsets the cross axis (rows start at
      `paddingTop` with `alignItems`/wrap);
    - padding arrays and `paddingLeft`/`Top`/`Right`/`Bottom` work
      (`flex.ts` produced NaN), and the `margin` array works;
    - wrap lines start at the cross padding and the height adds the end
      padding;
    - `flexShrink` shrinks overflowing items (`flex.ts` ignored it) and
      `flexBasis` replaces the width/height for positioning (ignored);
    - a container whose items only have `flexShrink` gets
      `flexBoundary: 'fixed'` (`flex.ts` set it for `flexGrow` only), so such
      a container no longer auto-sizes;
    - no `console.warn` when `flexGrow` has no free space;
    - positions are float64 (no float32 rounding such as 109.70999908).
  - **Gain:** one allocation-free engine that writes only what changed. Node
    writes per op (arm B → C) 54.4 → 15.0 (text-details-panel), 26.1 → 15.2
    (virtual-row), 179.0 → 51.9 (virtual-grid); framework KiB per op (C before
    → after) 12.05 → 3.62, 8.37 → 5.58, 12.55 → 8.62; bytes charged to the
    flex function 9,725 → 1,284 (details panel). `flex.ts` (about 330 lines)
    is deleted.
  - **Demo app:** none (its `.env` sets `VITE_USE_NEW_FLEX=true`, now ignored).
  - **Upgrade step:** optionally delete `VITE_USE_NEW_FLEX` from `.env`.
    `docs/flow/layout.md` describes the one engine.
- **Flex runs on `loaded`, between the renderer's walks (design 3.4.4).**
  - **What changes:** an autosize node's `loaded` queues its parent's
    layout for the post-mutation pass, run between the renderer's walks of the
    same frame, instead of laying it out synchronously inside the event; a
    `loaded` that leaves the size unchanged lays nothing out. An app
    `onEvent.loaded` handler on such a node now runs before the parent's
    relayout (it ran after). On the DOM renderer the relayout is one microtask
    after the event. A text in a layout container is no longer laid out from
    its `loaded`: Solid measures it (the next entries).
  - **Gain:** flex passes per op 7.0 → 3.0 (text-details-panel), 42.0 → 32.0
    (text-flex-mount-same and -new); frames to the final layout unchanged
    (1.0).
  - **Demo app:** none found (`src/pages/ImagePerformance.tsx:131`'s `loaded`
    handler counts images and reads no layout).
  - **Upgrade step:** none; a `loaded` handler that reads the parent's layout
    now sees it before the relayout (read it from the parent's `onLayout`).
- **Post-mutation scheduling is a microtask only (design 3.5).**
  - **What changes:** the pass runs as a microtask; Solid no longer asks the
    renderer for an in-frame run (and a frame) on every mutation. Nodes an app
    inserts or removes inside a renderer callback that runs between the walks
    (an app's own `onEvent` handler, `loaded` included) are laid out after
    that frame is drawn, one frame later, unless a Solid text/autosize
    relayout registered the in-frame run in the same walk.
  - **Gain:** part of the pass count above; no frame is requested per
    mutation.
  - **Demo app:** none found.
  - **Upgrade step:** none.
- **A flexGrow container calls `onLayout` once per layout.**
  - **What changes:** a flexGrow container with a flex child calls `onLayout`
    once per layout, after the grown children are laid out again (and, if one
    resized, after the container's own second pass), so it sees the final
    layout as the second of the two calls before 1.7 did; the first call, made
    before the children were laid out again, is gone.
  - **Demo app:** none found (`src/pages/FlexGrow.tsx`'s grow items are plain
    views).
  - **Upgrade step:** none; do not count on two calls.
- **Text in a layout container is sized by Solid, before the frame (design
  3.4).**
  - **What changes:** a `<text>` whose parent has `display="flex"` or an
    `onLayout` is measured in Solid's post-mutation pass with the renderer's
    `measure()`. The container's flex and `onLayout` run in that microtask,
    before the frame, instead of between the frame's walks after `loaded`.
    Positions on screen are the same, and they are now right in the first
    frame that shows the change. A change that leaves a text's size unchanged
    lays nothing out.
    - **`loaded` for apps.** An `onEvent.loaded` on such a text still fires
      once per layout, between the walks of the next frame, and now after the
      container's relayout (an autosize node's handler still runs before it).
      It fires for the layout `measure()` made, including the first one. On
      the DOM renderer it fires for every new size, as before.
    - **Animations keep 1.6's result.** A `transition` on a text's
      `fontSize`, `lineHeight`, `width` or `height`, and `el.animate()` /
      `chain()` of a text's layout props, still lay the container out on every
      animated frame, as 1.6's `loaded` listener did, and the container ends
      where the final size puts it. That includes a controller from
      `el.animate()` that the app starts later, after the text laid out
      again, or starts again after it finished. Animated frames walk twice, as
      in 1.6. This is not a break.
    - **Cost after an animation.** A text Solid has animated keeps one
      `loaded` listener for the rest of its life. Its later changes that Solid
      measures still cost one walk. But because the text has a listener,
      renderer v2 allocates the `{ type, dimensions }` payload for each of its
      later layouts: 2 objects per text change. In production WebGL builds,
      texts without such an animation allocate nothing; development builds
      carry a warning listener on every measured text, and the DOM renderer a
      `loaded` listener on every measured text, so there `loaded` is queued
      for each layout. The 2-object payload is an accepted exception to the
      allocation rule: it is rare, since only texts animated through the
      element are affected.
    - **Writes that bypass Solid.** Layout props written, or animated, on the
      renderer node itself (`el.lng.text = …`, `el.lng.fontSize = …`,
      `el.lng.animate({ fontSize })`) no longer relayout the container. The
      walk lays the text out again, but Solid is not told. Development builds
      warn: "A text in a flex container was laid out at a size Solid did not
      measure: a prop its layout reads was written, or animated, on its
      renderer node (el.lng)…". This was already true for non-text props on
      `el.lng`. Exceptions: a text Solid has animated through the element (it
      keeps its listener for its lifetime), and every measured text on the
      DOM renderer. On these, `el.lng.*` writes do relayout the container, as
      in 1.6, and no warning is given.
  - **Gain:** walks per drawn frame 2.00 → 1.00 (text-details-panel,
    text-flex-mount-same and -new) and 1.03 → 1.00 (text-virtual-row); text
    `loaded` events heard 5 → 0, 20 → 0 and 1.9 → 0; flex passes (C before →
    after) 32.0 → 21.0 (both mounts), 2.3 → 1.9 (virtual-row), 3.0 → 3.0
    (details panel; arm B 7.0); frames to the final layout 1.0 → 0.0 (mounts,
    virtual-row: the layout is done in the microtask, before the first
    frame); framework KiB per op 27.30 → 20.39 (mount-same), 27.02 → 20.56
    (mount-new), 2.74 → 2.50 (details panel), the per-text `_layoutOnLoad`
    closures gone. page-mount and page-swap are unchanged: their texts sit in
    plain views. Time is rough, from a run under heavy load: C/B 1.14 → 0.98
    (details panel), 0.81 → 0.65 (mount-new).
  - **Demo app:** none found. There is no text `loaded` handler, no
    `el.lng.<text prop>` write, and no `el.lng` animation of a text in
    `solid-demo-app-1.7/src`. Solid's own `primitives/Marquee.tsx` (the demo's
    `components/ContentBlock.tsx` uses it) has an `onEvent.loaded` on a text
    in an `onLayout` view; it keeps working on both renderers, because the
    listener hears `measure()`'s layout and every later size.
  - **Upgrade step:** write or animate text props on the element
    (`el.fontSize`, a `transition`, `el.animate()`), not on `el.lng`.
- **2.2 Eager layout of text under hidden or out-of-bounds ancestors (decision
  5.2).**
  - **What changes:** text in a layout container is measured at mount and on
    every change, even when an ancestor has alpha 0 or is outside the bounds
    margin. Such containers have their final size before they are shown, and
    showing them costs one walk. Before 1.7 they stayed unlaid until visited.
    - **Fonts.** A text whose font is not loaded waits, then lays out once. If
      the font comes through `loadFonts()`, text under culled ancestors is
      laid out when the font loads. A font loaded with `renderer.loadFont()`
      directly still lays out culled text only when it is shown, as in 1.6.
    - **Cost.** One text layout per such text, plus pressure on the
      renderer's text layout cache (`textLayoutCacheSize`, 250 entries by
      default): a page whose texts in layout containers outnumber the cache
      thrashes it. Whether to change the size is an open decision, measured
      in `docs/perf/log.md` (stream T, open item).
  - **Gain:** none; this is the cost decision 5.2 accepted. text-flex-mount-new
    and -same make 40 text layouts per op instead of 20 (the 20 culled tiles'
    texts are laid out at mount, all cache misses in -new); text-flex-mount-new
    renderer allocation 49.78 → 131.95 KiB/op, a noisy figure (145.01 on an
    earlier base).
  - **Demo app:**
    - `pages/LeftNavWrapper.tsx:116-133`, the debug widget column with
      `hidden={!showWidgets()}`: its `lastKey()` text is measured on every key
      while hidden. That is a cache hit after the first time.
    - `index.tsx:236`, `KeepAliveRoute` browse: flex texts on the kept-alive
      page are measured while it is hidden.
    - `components/NavDrawer/NavDrawer.tsx`: NavButton texts at alpha 0 are not
      in a layout container, so nothing changes there.
  - **Upgrade step:** none.
- **DOM renderer: `measure()` and `destroyed`.**
  - **What changes:**
    - `DOMText.measure()` sizes a text synchronously with
      `getBoundingClientRect`, while `document.fonts.check` reports its font
      loaded. A text in a flex container on the DOM renderer is laid out in
      the post-mutation microtask, not after the DOM renderer's timer or
      `fonts.ready`.
    - A web font that loads after its text was measured (the check is true
      for a family no font face names yet, so the text took the fallback
      font's size) still relays out the container when the DOM renderer
      measures again, as in 1.6.
    - `loaded` on a DOM text fires whenever its size differs from the last one
      it told; a `contain` change re-measures a flex text.
    - `el.destroyed` on the DOM renderer now returns a boolean; it was
      `undefined`. As in renderer v2, it is true for a destroyed node and for
      every node under it.
  - **Gain:** none; the DOM renderer is not the performance target. Each
    measured text costs a synchronous `getBoundingClientRect` (a reflow).
  - **Demo app:** none. **Upgrade step:** none.

### Primitives

- **Row and Column cache the merged `transition`.**
  - **What changes:** after a press, a Row's or Column's `transition` is a
    merged object cached per element and direction (it was a new object per
    press, re-spread from the base every time). An in-place edit of the base
    `transition` object after a press in that direction is not seen, and an
    in-place edit of `row.transition` persists for that direction; assigning a
    new object is picked up as before. Rows never share these objects.
  - **Gain:** one object less per press by construction; the bench could not
    resolve it (rows-lr-auto framework KiB/op 1.85 → 1.86, one run).
  - **Demo app:** `src/components/index.tsx` passes `transition` as a prop
    only.
  - **Upgrade step:** assign a new `transition` object instead of mutating it.
- **Virtual and VirtualGrid lay out once per shift.**
  - **What changes:** they set an `onLayout` on their node that calls the
    app's `onLayout`, so `row.onLayout` reads back the wrapper; a window shift
    shares one flex pass.
  - **Gain:** virtual-row flex passes 1.9 → 0.9 and node writes 26.1 → 15.2;
    virtual-grid flex passes 2.0 → 1.0 and node writes 179.0 → 96.5.
  - **Demo app:** none. **Upgrade step:** none.

### Nodes

- **A removed element does not lay out its old parent.**
  - **What changes:** in 1.6, when a removed element that was not yet
    destroyed changed size (most often a text inside a hidden
    `Preserve`/`KeepAlive` root finishing its load and resizing that flex
    root; also a texture or text loading on an element an app removed
    itself), its old parent's flex layout and `onLayout` ran. Now the old
    parent is not queued, and a removed `<text>` is out of the tree for
    measuring too: a change to it does not lay out its old parent. Its layout
    result is the same, since the removed element is no longer among its
    children; only its `onLayout` (and what chains from it, such as a Row's
    scroll or a Marquee's clip width) runs less often. A removed element still
    keeps its `parent`, and keys and events from a removed subtree still
    bubble through it, as in 1.6.
  - **Demo app:** none found (`onLayout` users lay out live children).
  - **Upgrade step:** none.
- **Prop accessors and `TextNode` fields (design 3.6.5, 3.6.6): no
  app-visible change.** The accessor names on `ElementNode.prototype` are the
  same and still non-enumerable; `TextNode` has the same three own fields in
  the same order. The accessor change is kept pending the Checkpoint 2 series
  (1.6 M reads 16 ms → 1.1 ms and 400 k writes 15 ms → 1.5 ms in an isolated
  micro-benchmark; scenario time could not resolve it; +764 B gzip). If that
  series shows no win it is reverted, still with no app-visible effect. Demo
  app: none. Upgrade step: none.

### Packaging and renderer compatibility

- **2.6 Renderer 2.0 breaks absorbed in Solid (decision 5.6).**
  - **What changes:** `Config.rendererOptions.renderEngine` and `.fontEngines`
    are dropped from a copy of the options before the renderer is constructed,
    with one `console.warn` each
    (`[solid] Config.rendererOptions.<name> was removed in @solidtv/renderer 2.0 and is ignored`);
    `renderer.stage.shManager` is defined on the WebGL renderer as a getter
    that returns the renderer, so
    `renderer.stage.shManager.registerShaderType(name, type)` keeps working,
    with one `console.warn` on first use
    (`[solid] renderer.stage.shManager was removed in @solidtv/renderer 2.0: use renderer.registerShaderType`).
    The warnings are in every build, not only dev (the maintainer asked to
    just warn that they have been removed). The imports of
    `@solidtv/renderer/webgl` and `/canvas` cannot be absorbed: they fail at
    module resolution.
  - **Demo app:** `src/index.renderer1.tsx:193-197` (the removed options) and
    `:218-226` (`renderer.stage.shManager`) are the only users; `src/index.tsx`
    is already ported. No gain: compatibility.
  - **Upgrade step:** delete the two options; call
    `renderer.registerShaderType(name, type)`. Types:
    `renderer.stage.shManager` is not in `@solidtv/renderer`'s types, so
    TypeScript code reading it needs a cast (the alias is a runtime
    compatibility shim). `docs/essentials/render.md` shows the 2.0 setup.
- **Renderer API additions: `TextNode.measure()`, a text-keyed layout cache,
  `Node.insertBefore` (R1, R2, R4).** None of them changes what an app does.
  - `TextNode.measure()` (R1) lays a text out before the walk and returns
    `false` until the font's description has arrived. Solid uses it to size a
    text in a layout container (Layout and flex, above).
  - The text-keyed `LayoutCache` (R2) changes only speed: widths and lines are
    bit-identical (a layout hit 0.386-0.427 µs / 845 B → 0.016-0.017 µs / 0 B
    for a title; description 0.767-0.833 µs / 1121 B → 0.016-0.018 µs / 0 B).
  - `Node.insertBefore(child, before)` (R4) is what Solid's draw order uses
    (B19 in section 3): `insertChild` calls it, so use a renderer build that
    carries it. It keeps siblings sorted by `zIndex`: if `before`'s `zIndex`
    differs from the child's, the child goes to the nearest place that keeps
    them sorted.
  - **R3 is held back.** R3 (typed-array advance and kerning tables in the
    line breaker; line breaking 3.1× faster for a title, `layoutText` about
    22-26% faster; bit-identical widths and lines) pushes the renderer's
    bundle 101 B gzip over the CI ceiling (54,373 vs 54,272 B; 53,844 B
    without it), so it is not integrated. It is a decision for Checkpoint 2
    (raise the ceiling, or drop R3); it changes nothing an app can see either
    way.
  - **Demo app:** none. **Upgrade step:** none.

### Build

- **Recommended app build setting: terser `reduce_funcs: false`.**
  - **What changes:** build with `build.minify: 'terser'` and
    `build.terserOptions.compress.reduce_funcs = false`
    ([Building for TVs](docs/deploy/build.md) has the Vite, webpack and CLI
    forms). With the demo app's terser settings, renderer 2.0's scene walk
    allocates on every visited node, and terser also turns Solid's own
    single-use helpers into per-call closures.
  - **Gain:** renderer KiB per press 56.7 → 3.4 (rows-ud-auto, a scrolling
    Column), 67.7 → 8.6 (virtual-grid), 8.6 → 4.0 (thumbnail-focus), 49.6 →
    21.0 (text-flex-mount-same); Solid's key dispatch (`propagateKeyPress`)
    allocates 185-247 B per press under terser's defaults and 24 B with
    `reduce_funcs: false`. One run each, alloc mode. See
    `docs/superpowers/specs/renderer-proposals.md`, P3.
  - **Demo app:** `vite.config.js` (Phase 3).
  - **Upgrade step:** set the option in your build. `compress` stays on, so
    `__DEV__` and `SOLIDTV_DOM_RENDERING` still fold away.

## 3. Bugs fixed in 1.7 that change behaviour

Found while pinning the contract (Phase 1). Each had a skipped test
(`it.skip('BUG: …')`) with the correct behaviour that its fix turns on. The
maintainer approved fixing all 21 (B1-B21) at Checkpoint 1, including the ones
marked **layout** or **scroll** in the design spec, section 5.8 (B5-B14),
which change flex or scroll results. B18 (stream S) is pending.

### Keys and focus

- **B3: per-element `throttleInput` no longer applies to key releases.**
  - **What changes:** like the global `Config.throttleInput`, an element's
    `throttleInput` applies to key-downs only.
    - A release within `throttleInput` ms of a handled press now reaches
      `on<Key>Release`/`onCapture<Key>Release`. Before, it was dropped, which
      broke `useHold` on a throttled node: a tap waited for the hold timer.
    - A release the node handles no longer starts a throttle window. Before, a
      handled release outside the window restarted it and dropped the next
      press.
  - **Demo app:** `src/pages/TMDB.tsx:75` and `src/pages/Benchmark.tsx:1018`
    set `throttleInput`, but no release handler is on those paths.
    `src/pages/KeyHandling.tsx:27-46` has release handlers but no
    `throttleInput`. No visible change.
  - **Upgrade step:** none.
- **B4: `{ Name: null }` in a key map unmaps that name's keys.**
  - **What changes:** `useFocusManager({ Left: null })` now removes every key
    mapped to `Left`, defaults included. Before, it removed nothing. The old
    by-key form (`{ ArrowLeft: null }` removing the `ArrowLeft` entry) still
    works.
  - **Demo app:** `src/pages/App.tsx:8` has no `null` values. No change.
  - **Upgrade step:** none.

### States and styles

- **B2: `states.remove('focus')` and `toggle('focus')` match `'$focus'`.**
  - **What changes:** `remove(name)` without `$` removes `$name` when the bare
    `name` is not present, as `has(name)` already matched it. Before, it did
    nothing. So `toggle('focus')` while `$focus` is on turns it off. Before, it
    did nothing.
  - **Demo app:** `src/pages/ButtonsMaterial.tsx:8`
    (`this.states.toggle("disabled")`) is unchanged unless the node carries
    `$disabled` and not `disabled`. `src/components/NavDrawer/NavDrawer.tsx:47`
    (`states.remove("$focus")`) is unaffected.
  - **Upgrade step:** none.

<!-- S: pending -->

### Layout and flex

- **B5: an unsized `<text flexItem={false}>` no longer blocks its container's
  layout.** Demo app: none (its `flexItem={false}` nodes are views:
  `ContentBlock.tsx:84`, `NavDrawer.tsx:75`, `Nested.tsx:48-49`,
  `FlexMenu.tsx:26`, `TextCentering.tsx:55`). Upgrade step: none.
- **B6: `justifyContent="center"` with padding centres inside the padding**
  (it was shifted by `paddingStart`). Demo app: the status boxes of
  `pages/ImagePerformance.tsx:139-147`,
  `pages/TextureCompressionPerformance.tsx:136-144`,
  `pages/MixedImagePerformance.tsx:174-182` and
  `pages/LargeImagePerformance.tsx` (`padding={[0, 20]}`): their text
  moves 20 px left, now centred. Upgrade step: drop compensating offsets, if
  any.
- **B7: cross-axis `alignItems`/`alignSelf` `center` and `flexEnd` stay inside
  the cross padding** (center was offset by `paddingTop`, flexEnd overflowed by
  it). Demo app: the cards of `pages/ComplexFlex.tsx` and
  `pages/ComplexFlexCaps.tsx` (a 180-wide column with `alignItems: center`
  and `padding: [0, 10]`): their title and button move 10 px left, now centred
  in the padded box. Upgrade step: drop compensating offsets, if any.
- **B8: a `flexGrow` item is sized from its own size on every layout.** It
  shrinks back when a sibling grows and returns to its own size when no space
  is left (it kept its largest grown size). On a flexGrow item with a
  transition on its main-axis size, a size the app writes while the item is
  grown is not kept as its own size on a later parent relayout (before 1.7 it
  was). Demo app: `pages/FlexGrow.tsx` and `pages/Text.tsx:128-130` (grow bars
  next to text) now follow their siblings. Upgrade step: none.
- **B9: a wrapping container with no cross size places wrapped items on their
  lines** (they overlapped the first line). Demo app: none (its wrap rows and
  columns get a size at render). Upgrade step: none.
- **B10: `flexWrap="wrap-reverse"` wraps, first line at the end** (it was one
  unwrapped line in `flexLayout.ts`, negative `y` in `flex.ts`). Demo app:
  none. Upgrade step: none.
- **B11: a `contain` text with no size subtracts its right and bottom margins
  from the computed `maxWidth`/`maxHeight`** (`marginRight`/`marginBottom`,
  else the `margin` array, as flex reads them; they were ignored). Demo app:
  none (no contain text without a size has those margins). Upgrade step: none.
- **B12: `maxLines={1}` with a `lineHeight` of 3 or less gives
  `maxHeight = lineHeight * fontSize`** (it was the bare multiplier, a 1.2 px
  tall text in flex). Demo app: none (its line heights are in px). Upgrade
  step: none.

### Primitives

- **B1: a wrap Row/Column whose children are all `skipFocus` no longer
  hangs.** Focusing it selects nothing (`selected` -1, as without wrap) and the
  container keeps focus itself; a key press bubbles. With wrap and no children
  a press leaves `selected` alone (it became -1 through a NaN index). Demo app:
  no wrap Row/Column with only skipFocus children (`wrap` appears only on
  TitleRow's VirtualRow). Upgrade step: none.
- **B13: VirtualRow/VirtualColumn with `scroll="none"` or `"center"` reach
  every item.** The mounted window now follows the cursor (one item kept
  mounted on each side of it); the row itself still never scrolls, so as with a
  Row `scroll="none"` the focus can move past the visible area. With `wrap` the
  window is modular, as in the other wrap modes: Right past the last item
  reaches the first, and with fewer items than `displaySize + bufferSize` each
  item is mounted once. `"center"` is still not implemented by VirtualRow and
  behaves as `"none"`. Demo app: TitleRow (`src/components/index.tsx`) uses
  auto/edge/always only. Upgrade step: none; apps wanting centring should use
  another mode.
- **B14: VirtualRow/VirtualColumn always shift by one unscaled slot (item size
  plus gap); `factorScale` no longer has an effect.** With `factorScale` and a
  scaled focus (`$focus: { scale }`), a window shift moved the row by the
  scaled size, so the focused item drifted `(scale - 1) * size` per shift (40
  px for a 200-wide item at 1.2) on the default path; the shift is now the
  distance flex moves the items, so the focused item keeps its screen position
  on every path. Demo app: no `factorScale` (TitleRow,
  `src/components/index.tsx`). Upgrade step: none; `factorScale` can be removed
  (it is still accepted, and marked `@deprecated` in its type).
- **B15: VirtualGrid `selected` is a child index.** The node's `selected` is a
  child index into the mounted window: set once at mount from the `selected`
  prop, then kept by navigation and the selected effect (a reactive `selected`
  no longer writes the data index onto the node). Autofocus with an initial
  `selected` focuses that item; `selected` back to the first row scrolls back;
  Down with nothing below bubbles and leaves `selected` alone; Down from the
  last row bubbles when the item count is a multiple of `columns` (it moved to
  the last item). An initial `selected` scrolls the grid to that item's row,
  with or without autofocus and also when the items arrive after mount, the
  same `y` as reaching it by navigation. `onSelectedChanged`'s `lastIdx` after
  a reactive `selected` is the previous child index, in the previous window (it
  was the new data index). Demo app: `src/pages/Browse.tsx` VirtualGrid passes
  no `selected`; `updateContentBlock` uses the first argument only. Upgrade
  step: code that read `grid.selected` as a data index should read
  `grid.cursor`.
- **B16: LazyRow/LazyColumn with `buffer={0}` or `buffer={1}` lose no
  presses.** A buffer below 2 acts as 2 when deciding to mount on a press, so
  the next item mounts one press earlier; mounting with a buffer of 2 or more
  and the initial mount are unchanged. Demo app: LazyRow/LazyColumn in
  `src/pages/TMDB.tsx`, `Benchmark.tsx` and `Virtual.tsx` pass `bufferSize`
  (not a Lazy prop; their buffers are the defaults, 2 or more). Upgrade step:
  none.

### Nodes

- **B17: `fontWeight` and `fontFamily` resolve the family in either order.**
  - **What changes:** before, `fontWeight` before `fontFamily` (JSX attribute
    order, a style or state applying `fontFamily` after `fontWeight`, or a
    reactive `fontFamily` that changes after render) dropped the weight:
    `<text fontWeight="bold" fontFamily="Roboto">` drew `Roboto`. Now it draws
    `Roboto700` in either order. Setting `fontWeight` back to `undefined` (for
    example a `$focus: { fontWeight }` undone on blur) now writes the plain
    `fontFamily` instead of `"<family>undefined"`. On a text with no
    `fontFamily` of its own, taking its family from `Config.fontSettings`, the
    reset used to write `"<Config family>undefined"` (in 1.6, a family no font
    provides); it now writes `Config.fontSettings.fontFamily` plus
    `Config.fontSettings.fontWeight` as read at the first text render.
  - **Demo app:** the only styles that set both put `fontFamily` first
    (`theme.ts` typography, `styles.ts` peopleBio, `components/ContentBlock.tsx`,
    `components/stories/Typography.stories.tsx`); the other `fontWeight` uses
    (13 files under `pages/`, `components/stories/Flex.stories.tsx`) take the
    family from `Config.fontSettings`, so no visible change. No state block
    (`$focus`, `$active`, …) sets `fontWeight`.
  - **Upgrade step:** an app that depended on the weight being dropped must
    load the weighted family (for example `Roboto700`) or remove the
    `fontWeight`.
- **B19: draw order follows the child order.**
  - **What changes:** overlapping siblings with equal `zIndex` now draw in
    their JSX/`children` order after every update, on both renderers. Affected
    updates: a `<Show>` that appears between siblings, a `<For>` that adds in
    the middle or reorders, and a Virtual row/grid window shift that moves a
    tile. Before, such a node was drawn after all its siblings, or kept its old
    place. Visible change: a scaled `$focus` tile, or an overlay inserted
    before an anchor, is now covered by its later siblings exactly as on first
    render. An adjacent `<For>` swap with later siblings also keeps the
    declared order now: `[head, a, x, y, b, tail]` with the list swapped to
    `[a, y, x, b]` used to give `children` = `head, a, x, b, tail, y`, so `y`
    was drawn over `tail`, laid out after it by flex, and reached after it in
    focus order; those items' flex positions and focus order now follow the
    declared order. Caveat: when the anchor has a different `zIndex`, the
    renderer places the node at the nearest place that keeps siblings sorted by
    `zIndex`, so among equal-`zIndex` siblings its order can differ from
    `children`.
  - **Demo app:** `components/index.tsx` posters (`$focus: { scale: 1.05 }`),
    `styles.ts` (`$focus` scale 1.1), `components/Keyboard.tsx`,
    `pages/Matrix.tsx`.
  - **Upgrade step:** none, unless an app relied on an inserted node drawing
    last; give it a higher `zIndex`.
- **B20: text props on a non-text element; `absX`/`absY`/`destroyed` writes.**
  Text-only props (`fontSize`, `lineHeight`, `maxWidth`, `maxHeight`, `text`,
  `contain`, `textAlign`, …) and the font family written to a `<view>` are kept
  on the ElementNode: `view.fontSize` reads back what was written (now also
  after render, on both renderers), but the renderer node (`view.lng`) no
  longer has them. Writing `absX`, `absY` or `destroyed` on an element is
  ignored (it threw a `TypeError` on renderer v2, where they are getter-only);
  reading them is unchanged. No visible change: neither renderer draws text
  props on a view. Demo app: no writes of `absX`/`absY`/`destroyed` and no
  reads of text props through `.lng`. Upgrade step: none.

### Packaging

- **B21: `@solidtv/solid/focusManager` is exported; `@solidtv/solid/shaders`
  resolves again.**
  - **What changes:** `@solidtv/solid/focusManager` is now an export (source
    `src/core/focusManager.ts`, built `dist/src/core/focusManager.js`);
    `@solidtv/solid/shaders` named `src/shaders/index.ts`, deleted in
    `cf3b1e0`, and now names `src/core/shaders.ts`. The runtime names of
    `/focusManager`: `focusPath`, `getFocusHistory`, `printFocusHistory`,
    `releaseKeySuppression`, `setActiveElementCore`, `setFocusPath`,
    `suppressKeyUntilRelease`, `useFocusManager`; `KeyMap` and `KeyHoldMap`
    are type-only exports. `/shaders` has the 17 `defaultShader*` and
    `registerDefaultShader*` names that `@solidtv/solid` also exports.
  - **Demo app:** `src/pages/App.tsx:5`
    (`import { KeyMap, KeyHoldMap } from "@solidtv/solid/focusManager"`) now
    resolves; nothing in the demo imports `@solidtv/solid/shaders`. (Decision
    5.5 removes the demo's `KeyHoldMap` use in Phase 3.)
  - **Upgrade step:** none.
