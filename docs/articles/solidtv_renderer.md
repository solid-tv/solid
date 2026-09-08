# SolidTV Renderer

The SolidTV Renderer is a fork of the official SolidTV Renderer optimized to be 50% faster during render loop. It is designed to be easily swapped with the standard SolidTV version to provide an immediate performance boost for your applications.

## Installation

The renderer is available on NPM under the `@solidtv/renderer` package. You can install it via your package manager:

```bash
npm install @solidtv/renderer
```

Or edit your package.json with:

```json
"@solidtv/renderer": "^1.9.0",
```

## Configuration (Vite Defines)

The SolidTV Renderer exposes several flags that can be configured via Vite defines in your `vite.config.ts`. These allow you to fine-tune the renderer's behavior for development, debugging, and production environments.

```js
// vite.config.ts
define: {
      __DEV__: mode !== 'production',
      __enableInspector__: mode !== 'production',
      __enableCompressedTextures__: false,
      __renderTextBatching__: true,
      __emitBoundsEvents__: false,
    },
```

**Leaving a flag undefined is not the same as setting it to its default.** An
undefined global leaves a runtime `typeof` check that no bundler can fold, so the
guarded branch — and every module it imports — stays in the bundle even when the
flag's default is `false`. Defining all five is worth roughly 11.6 kB minified
(3.7 kB gzipped) on a WebGL build, most of it from `__enableCompressedTextures__`
dropping the PVR/KTX/ASTC parser.

> Note for esbuild users: esbuild does not do the cross-module constant
> propagation this relies on, so the constants fold but the dead branches and
> their imports remain. Rollup, and therefore Vite, does strip them.

### `__DEV__`

**Type:** `boolean` | **Default:** `false`

Toggles development mode. When set to `true`, it enables development-specific features, warnings, and unoptimized paths useful for debugging. In production, this should be `false`.

### `__enableInspector__`

**Type:** `boolean` | **Default:** `!isProductionEnvironment`

Enables the DOM inspector hooks in the renderer. Pair it with the `inspector`
renderer option to actually mount the inspector.

### `__enableCompressedTextures__`

**Type:** `boolean` | **Default:** `false`

Enables support for compressed texture formats. Using compressed textures can significantly reduce memory usage and improve loading times, especially on constrained devices. However most folks are not using compressed textures, so this is disabled by default. ktx, pvr are the two supported formats for compressed textures.

Turning it on is only half of what a `.ktx`/`.pvr` build needs — neither
extension is in Vite's default asset list, so add `assetsInclude: ['**/*.pvr', '**/*.ktx']`
and import the asset so you get an emitted URL back.

### `__renderTextBatching__`

**Type:** `boolean` | **Default:** `true`

Enables batching for text rendering. When enabled, the renderer batches text draw calls together, reducing overall overhead and improving text-heavy application performance. This will place Text on top of other elements. If you find Text over an element that should be on top of Text, add a zIndex to create a new layer for text.

This is a performance feature that defaults on. Define it as `true` to fold the
branch, not to turn anything off.

### `__emitBoundsEvents__`

**Type:** `boolean` | **Default:** `false`

Gates the `inViewport` / `outOfViewport` node events. Set it to `true` if your app
listens to them — see [Events](/essentials/events.md).

## Removed flags

These were removed in the 1.8 / 1.9 releases. Defining them has no effect, and
they should be deleted from your bundler config.

| Flag                  | Removed in | Notes                                                                                                                    |
| --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `__RTT__`             | 1.8.0      | Render-to-texture was removed in full, along with the `rtt` prop and the `RenderTexture` texture type. No replacement.   |
| `__enableAutosize__`  | 1.8.0      | `autosize` is now texture-only and always on for that case. It no longer sizes a container to its children.              |
| `__dirtyQuadBuffer__` | 1.8.3      | The quad buffer is now rebuilt and uploaded in full every frame; the surgical upload path it gated is gone.              |
| `__calculateFps__`    | 1.9.0      | `fpsUpdateInterval` is the single switch for frame telemetry (`renderUpdate` included), and it is honored in production. |
