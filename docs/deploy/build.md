# Building for TVs

## Minifying with terser

Build with terser, and turn off its `reduce_funcs` option:

```js
// vite.config.js
export default defineConfig({
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        // Keeps terser from inlining the renderer's single-use helper
        // functions into its scene walk.
        reduce_funcs: false,
      },
    },
  },
});
```

`compress` stays on (the other options keep their defaults), so build-time defines such as `__DEV__` and `SOLIDTV_DOM_RENDERING` still fold away. The same option goes to other bundlers' terser plugins, for example `new TerserPlugin({ terserOptions: { compress: { reduce_funcs: false } } })` in webpack, or `--compress reduce_funcs=false` on the terser command line.

### Why

With terser's defaults, `@solidtv/renderer` 2.0's scene walk allocates for every node it visits. Terser inlines a single-use helper of the walk, the one that computes a node's world transform, into `ScenePass.visit` as an immediately-invoked function (`!function (s, id, parent) {…}(s, id, parent)`). The function is created again for each dirty node the walk visits, on every frame.

Set `reduce_funcs: false` and the walk keeps calling the helper. The renderer's allocations for one key press, measured in the SolidTV benchmark (`docs/perf`, allocation mode, every allocation sampled), fall:

| Scenario                                 | Renderer allocations per press, terser defaults | With `reduce_funcs: false` |
| ---------------------------------------- | ----------------------------------------------- | -------------------------- |
| `rows-ud-auto` (move focus between rows) | 56.7 KiB                                        | 3.4 KiB                    |
| `virtual-grid`                           | 67.7 KiB                                        | 8.6 KiB                    |

SolidTV's own allocations per press are the same in both builds. Each figure is one run, and the bundle-size difference was not measured.

The measurements are in [`docs/perf/results/2026-10-03/profiles.md`](../perf/results/2026-10-03/profiles.md), section "Terser inlining in the renderer's walk".
