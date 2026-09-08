# Upgrading to Renderer 1.9

`@solidtv/solid` now requires `@solidtv/renderer` 1.9. The 1.8 release was a
breaking one: four features were removed or changed shape, the telemetry payload
was reworked, and three build-time defines disappeared. This page covers what an
app built on `@solidtv/solid` has to change.

Bump the peer dependency and install:

```json
"@solidtv/renderer": "^1.9.0"
```

## Render-to-texture (`rtt`) is gone

The `rtt` prop, the `RenderTexture` texture type and the `__RTT__` build define
were removed in full. There is no replacement and no compatibility shim.

```jsx
// before
<view rtt>...</view>

// after — nothing to migrate to
<view>...</view>
```

If a subtree relied on being flattened into a texture, the honest options are to
drop the effect, or to pre-render the subtree as an image asset and use that.

Two framework primitives used `rtt` internally and no longer do:

- **`FadeInOut`** flattened the subtree before its fade-out animation. Alpha is
  now composited per node, so children that overlap each other can show seams
  through the fade.
- **`Marquee`** rendered its scrolling text copies through a texture. They are
  now drawn directly.

The `createTag` primitive, which existed only to build RTT textures, was removed
from `@solidtv/solid/primitives`.

## Bounds and viewport

### `boundsMargin` is a stage setting, not a node prop

The per-node `boundsMargin` prop is gone. The renderer setting remains, but is
now a single `number` — the `[top, right, bottom, left]` array form still parses
(the largest edge wins, with a console warning) and should be replaced.

**Its default changed from `0` to `200`.** An app that never set it now gets a
200px preload margin it did not have before. That is intended — its only job is
to load textures ahead of a node scrolling into view — but it does raise peak
texture memory.

```js
Config.rendererOptions = {
  boundsMargin: 200,
};
```

### `inBounds` / `outOfBounds` events were replaced

Use `inViewport` and `outOfViewport`. `outOfViewport` fires when a node leaves
the viewport, covering both the `InViewport -> InBounds` and
`InViewport -> OutOfBounds` transitions.

```jsx
// before
<view onEvent={{ inBounds: onEnter, outOfBounds: onLeave }} />

// after
<view onEvent={{ inViewport: onEnter, outOfViewport: onLeave }} />
```

A listener on `inBounds` was firing one step earlier than viewport entry. If it
was starting a load, that job now belongs to `boundsMargin`; if it was showing
something, it was already too early and `inViewport` is what you wanted.

Both events carry a `{ previous, current }` payload of `CoreNodeRenderState`
values, and both are gated behind `__emitBoundsEvents__` — set that define to
`true` if your app listens to them.

### `renderOnlyInViewport` was removed

Its `true` behavior is now unconditional. An app that set it to `false` was
drawing everything regardless of viewport and will now draw only what is in
view.

## `autosize` is texture-only

`autosize` now means only "take the texture's intrinsic dimensions when it
loads". It no longer sizes a node to its children, and it is a no-op on `<text>`
nodes.

- A node with `src` and no children: unchanged.
- A container relying on `autosize` to measure its content: this silently stops
  resizing and keeps whatever `w`/`h` it was given, frequently `0`, so the
  subtree can disappear or stop clipping. Use flex (`display: 'flex'`) to size
  containers, or set the size yourself.
- A `<text>` node: remove the prop.

## Texture and image loading

- **`numImageWorkers` is clamped to at most 1** and defaults to `1` (was `2`).
  Passing `2` or `4` silently yields `1`. The pool measured 99.7% idle, so this
  is not a regression to work around; set it to `1`, or `0` to keep image
  loading on the main thread.
- **`quadBufferSize` defaults to `1048576`** (was `1310720`). Set it explicitly
  if your app relied on the old default and draws an unusually large number of
  quads in one frame.
- **Blob and ImageData texture sources now get a cache key.** Two textures from
  the same source object share one entry, so mutating a Blob in place and
  re-creating the texture no longer forces a fresh upload.

## Build defines

Three defines are gone and should be deleted — `__RTT__`, `__enableAutosize__`
and `__calculateFps__` — along with `__dirtyQuadBuffer__`, removed in 1.8.3.
Make the five surviving flags explicit; an undefined flag leaves a runtime
`typeof` check the bundler cannot fold, so the guarded branch and its imports
stay in the bundle.

```js
// vite.config.js
define: {
  __DEV__: false,
  __enableInspector__: false,
  __emitBoundsEvents__: false,          // true if you listen to viewport events
  __enableCompressedTextures__: false,  // true only if you ship .ktx/.pvr
  __renderTextBatching__: true,
}
```

See [SolidTV Renderer](/articles/solidtv_renderer.md) for what each one guards.

## Telemetry

Only relevant if your app subscribes to `fpsUpdate`, `frameTick` or
`renderUpdate` — see the [FPS Counter](/primitives/fpscounter.md) page for the
full payload notes. In short:

- `fpsUpdateInterval` is now the single switch for frame sampling, `renderUpdate`
  included, and it is honored in production builds.
- `fps` measures rendering only and is `0` over an entirely idle interval, so a
  dashboard alerting on "fps below N" will fire on a quiet screen. Read
  `idleTicks` alongside it.
- `capabilities` left the payload; call `renderer.getCapabilities()` once at
  startup.
- `frameTick.time` is `performance.now()`, measured from page load rather than
  the Unix epoch.

FPS series recorded from production builds before 1.8 are not comparable with
1.8+ numbers.

## Frame rate cap

`targetFPS` now defaults to `60` when left undefined. On TV targets an uncapped
loop draws every catch-up rAF the browser fires under GPU load, which measured
around 140fps on a 60Hz panel. Set `targetFPS: 0` to run uncapped.

## What to check after upgrading

- **Scrolling rows**: nodes appear with textures already loaded, nothing pops in
  late or renders blank at the edges.
- **Every container that had `autosize`**: it still has a size, still clips, and
  its children are positioned.
- **Anything that used `rtt`**: whatever replacement you settled on.
- **Viewport listeners**: entry and exit both fire, and `__emitBoundsEvents__` is
  `true`.
- **Text**: letter spacing and font style measurement were fixed in 1.8, so
  spaced text is measured the way it is drawn. Expect small layout shifts in text
  using `letterSpacing`, and treat them as corrections.
