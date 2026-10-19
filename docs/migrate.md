# Migrating from @lightningtv/solid

SolidTV moved from [github.com/lightning-tv/solid](https://github.com/lightning-tv/solid) to [github.com/solid-tv/solid](https://github.com/solid-tv/solid), and its npm packages were renamed. `@lightningtv/solid@3.2.5` is the last release under the old name. All new releases ship as `@solidtv/solid`.

<p id="migrate-continue" hidden></p>

Moving an app over is mostly a rename. The steps below cover the packages, imports and build config.

## 1. Swap the packages

| Old                                                                                                 | New                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `@lightningtv/solid`                                                                                | `@solidtv/solid`                                  |
| `@lightningjs/renderer`, `@lightningtv/renderer` or an alias like `npm:@lightningtv/renderer@3.3.0` | `@solidtv/renderer`                               |
| `@lightningtv/vite-hex-transform`                                                                   | unchanged, keep `@lightningtv/vite-hex-transform` |

```bash
npm uninstall @lightningtv/solid @lightningjs/renderer @lightningtv/renderer
npm install @solidtv/solid @solidtv/renderer@^1.10.1
```

!> Install the renderer version that `@solidtv/solid` lists as its peer dependency, not `@solidtv/renderer@latest`. The `latest` tag on the renderer can be a newer major line than the current `@solidtv/solid` supports. Check with `npm view @solidtv/solid peerDependencies`.

## 2. Update imports

Every subpath keeps its name, so a plain find and replace covers it:

- `@lightningtv/solid` → `@solidtv/solid` (also `/primitives`, `/devtools`, `/shaders`, `/jsx-runtime`)
- `@lightningjs/renderer` → `@solidtv/renderer` (also `/webgl`, `/canvas`, `/inspector`)

```js
// before
import { render, Config } from '@lightningtv/solid';
import { Row, Column } from '@lightningtv/solid/primitives';
import { WebGlCoreRenderer } from '@lightningjs/renderer/webgl';

// after
import { render, Config } from '@solidtv/solid';
import { Row, Column } from '@solidtv/solid/primitives';
import { WebGlCoreRenderer } from '@solidtv/renderer/webgl';
```

To do it from the shell (macOS and Linux), run this from the project root. It rewrites `src`, the Vite config and `tsconfig.json`:

```bash
grep -rlE '@lightningtv/solid|@lightningjs/renderer' src vite.config.* tsconfig.json 2>/dev/null | xargs perl -pi -e 's#\@lightningtv/solid#\@solidtv/solid#g; s#\@lightningjs/renderer#\@solidtv/renderer#g'
```

## 3. Update build config

Point `vite-plugin-solid` at the new package and update `dedupe` and `optimizeDeps`. Drop `@lightningtv/core` if it is still listed; it is not used anymore.

```js
// vite.config.js
solidPlugin({
  solid: {
    moduleName: '@solidtv/solid',
    generate: 'universal',
  },
}),

resolve: {
  dedupe: ['solid-js', '@solidtv/solid', '@solidtv/renderer'],
},
optimizeDeps: {
  exclude: ['@solidtv/solid', '@solidtv/renderer'],
},
```

A few less common settings were renamed too:

| Where                                  | Old                         | New                       |
| -------------------------------------- | --------------------------- | ------------------------- |
| `tsconfig.json` `jsxImportSource`      | `@lightningtv/solid`        | `@solidtv/solid`          |
| Custom import condition (`conditions`) | `@lightningtv/source`       | `@solidtv/source`         |
| Vite `define` to turn off shaders      | `LIGHTNING_DISABLE_SHADERS` | `SOLIDTV_DISABLE_SHADERS` |

?> The old `LIGHTNING_*` defines are ignored without a warning. The DOM renderer and its define were removed in 2.0: see [DOM Renderer](/articles/domrenderer.md).

## 4. Renderer changes since the fork

`@solidtv/renderer` 1.0 was the `@lightningtv/renderer` 3.3 fork under a new name. Later releases removed a few features, such as render-to-texture (`rtt`), the `inBounds` and `outOfBounds` events and some build defines. Read [Upgrading to Renderer 1.9](/articles/renderer-1.9-upgrade.md) for the full list, and [SolidTV Renderer](/articles/solidtv_renderer.md) for the build defines that are still supported.

## 5. Optional: lowercase elements

`<View>` and `<Text>` still work but are deprecated. Prefer the `<view>` and `<text>` intrinsic elements:

```jsx
// before
<View x={20}><Text>Hello</Text></View>

// after
<view x={20}><text>Hello</text></view>
```

## Starting fresh

The [starter template](https://github.com/solid-tv/solid-starter-template) and the [demo app](https://github.com/solid-tv/solid-demo-app) now live in the `solid-tv` org:

```bash
npx degit solid-tv/solid-starter-template my-app
```

Old docs links on `lightning-tv.github.io/solid` redirect here. Questions go to the #SolidTV channel on the [SolidJS Discord](https://discord.com/invite/solidjs).
