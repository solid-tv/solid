# Migrating to @solidtv/solid 1.7

Solid 1.7 runs on `@solidtv/renderer` 2.0 (WebGL and SDF text only) and
rewrites Solid's internals for less CPU per key press. Apps written against
`<view>`, `<text>` and the primitives keep their code, except where this file
says otherwise.

> **Status: draft at Checkpoint 1.** Section 1 is final (the renderer's
> breaks). Sections 2 and 3 are proposals waiting for the maintainer's
> approval; nothing in them is implemented yet.

Every entry gives what breaks, the solid-demo-app files it hits, the measured
gain that justifies it (for Solid's own breaks), and the upgrade step.

## 1. Breaks inherited from @solidtv/renderer 2.0

These come with renderer 2.0 and cannot be avoided by Solid. The full list,
with the renderer's numbered behaviour changes, is the renderer's
`docs/upgrade-1.x-to-2.0.md` and section 14 of its design
(`docs/superpowers/specs/2026-09-29-renderer-v2-architecture-design.md`). The ones an app built on Solid meets:

| What breaks                                                                                                                                                            | solid-demo-app                                                                                                      | Upgrade step                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@solidtv/renderer/webgl` and `/canvas` are gone (`WebGlCoreRenderer`, `SdfTextRenderer`, `CanvasCoreRenderer`, `CanvasTextRenderer`)                                  | `src/index.tsx:22-23`                                                                                               | Delete the imports. `@solidtv/renderer/webgl/shaders` stays as an alias of `/shaders` for 2.x.                                  |
| `Config.rendererOptions.renderEngine` and `.fontEngines` are removed: WebGL and SDF text are the only engines                                                          | `src/index.tsx:187-193`                                                                                             | Delete them. A `?mode=canvas` switch no longer does anything.                                                                   |
| `renderer.stage.shManager.registerShaderType` is gone                                                                                                                  | `src/index.tsx:213-221`                                                                                             | `renderer.registerShaderType(name, type)`. (Proposed in section 2.6: Solid keeps `stage.shManager` working with a dev warning.) |
| Text is SDF only. A web font (`fontUrl`) no longer draws on the WebGL renderer; every family needs an MSDF/SSDF font loaded or aliased, the default family included    | `src/fonts.ts:44,48` (web fonts, DOM mode only)                                                                     | Load an SDF font for each family the app uses on WebGL.                                                                         |
| A text whose font family is not loaded is no longer an error: it draws nothing (1.9 threw and the rest of the page failed)                                             | `src/styles.ts:155`, `src/pages/gridStyles.ts:35` (`fontWeight` `normal` and `600` build families no font provides) | Load the families the app names, or add the weights to `Config.fontWeightAlias`.                                                |
| SDF text draws above a later quad without a `zIndex` (it used to be under a scrim drawn after it)                                                                      | to check on device                                                                                                  | Give the covering quad a `zIndex`.                                                                                              |
| The minimum browser is **Chrome 47** (1.9: Chrome 38). webOS 3.x (Chromium 38) is below the floor                                                                      | `BENCHMARKING.md` (`LGWhite`)                                                                                       | Target Chrome 47+.                                                                                                              |
| `renderer.stage.options` is gone                                                                                                                                       | `src/pages/Benchmark.tsx:28-36, 57-66, 97-108` (guarded, falls back)                                                | Read `renderer.settings`; write with `renderer.setOptions`.                                                                     |
| `stage.txMemManager.getMemoryInfo()` is gone                                                                                                                           | none (Solid's `FPSCounter` is updated)                                                                              | `renderer.memoryInfo()`.                                                                                                        |
| `el.lng.id` is the node's slot in the renderer's store (0 for the root, reused after a destroy, -1 once destroyed)                                                     | none found                                                                                                          | Use `el.lng.uid` for a stable id.                                                                                               |
| `loaded` for text arrives between the walks of the frame that lays it out; `idle` fires in the frame that drew the last change, and can fire while textures still load | `src/pages/Benchmark.tsx` (waits for idle)                                                                          | Wait for `renderer.pendingTextures === 0` at an `idle` to wait for every texture.                                               |
| `Image` with a placeholder: the image's download starts once the placeholder shows (1.6 started both at once)                                                          | none found                                                                                                          | None.                                                                                                                           |
| Shaders: `el.lng.shader` reads `null` without one; `createShader` of an unregistered type returns `null` with a warning                                                | `src/pages/ButtonsMaterial.tsx` (`RoundedRectangle` is not registered, on every arm)                                | Register the type.                                                                                                              |

## 2. Solid 1.7 changes that need approval (proposed)

Each proposal states the measured gain that justifies it. A proposal without
a measured gain is not allowed; the numbers come from Phase 2 and are filled
in when the change is made. See the design spec,
`docs/superpowers/specs/2026-10-03-solid-1.7-design.md`, section 5.

Proposed at Checkpoint 1 (design spec, section 5); none approved yet:

| Proposal                                             | What changes for apps                                                                                                                                                            | solid-demo-app                                       | Expected gain (to be measured)                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| 2.1 One reactive flush per focus change              | effects triggered by signal writes in `onFocus`/`onBlur`/`onFocusChanged` run after the last callback of the change, not after each write; callback order is unchanged           | `pages/Portal.tsx`, `components/NavDrawer/*`         | reactive passes per focus change: one, instead of one per write + 2 |
| 2.2 Eager layout of flex text under culled ancestors | a flex container's text is laid out at mount even when an ancestor is out of bounds or at alpha 0; visible results identical                                                     | Browse/TMDB rows (tiles beyond the bounds margin)    | 1 walk per text change instead of 2                                 |
| 2.3 One flex engine (`flexLayout.ts`)                | apps on the default build (`flex.ts`) get `flexLayout.ts` results where the two differ: cross-axis padding, array padding, the `margin` array, wrap with padding, `wrap-reverse` | none (it already runs `flexLayout.ts`)               | one engine to keep allocation-free; smaller bundle                  |
| 2.4 The hold contract                                | none if `useHold` is kept (recommended); the demo's `on<Name>Hold` handlers move to `useHold`                                                                                    | `pages/App.tsx:5, 32-38`, `pages/KeyHandling.tsx:49` | n/a (a contract decision)                                           |
| 2.5 `states.slice()` returns an `Array`              | `Array` methods on `states` return plain arrays instead of `States`                                                                                                              | none found                                           | no `States` construction per `remove`                               |
| 2.6 `renderer.stage.shManager` kept working          | none: Solid absorbs the renderer break with a dev warning                                                                                                                        | `src/index.tsx:213` would keep working               | n/a (compatibility)                                                 |

**Recommended app build setting:** `build.terserOptions.compress.reduce_funcs = false`.
With the demo app's terser settings, renderer 2.0's scene walk allocates on
every visited node (measured: 56.7 → 3.4 KiB per press in a scrolling
Column). See `docs/superpowers/specs/renderer-proposals.md`, P3.

## 3. Bugs fixed in 1.7 that change behaviour (proposed)

Found while pinning the contract (Phase 1). Each has a skipped test with the
correct behaviour (`it.skip('BUG: …')`) that the fix turns on.

The 21 bugs and their files are listed in the design spec, section 5.8
(B1-B21). Each entry moves here, with its behaviour change, when its fix
lands. Those marked **layout** or **scroll** there change flex or scroll
results and need explicit approval: B5-B14.
