# Renderer proposals from the solid 1.7 work

Changes that would help `@solidtv/solid` 1.7 but fall outside what the 1.7
brief lets Solid's work change in `@solidtv/renderer` (the surface Solid
touches, and text measurement). None is implemented. Each gives the evidence
and what it would take.

## P1. Layout inside the scene pass

**Idea.** Run Solid's flex layout in the renderer's walk, where text sizes are
known in the node's visit, so a text change costs no `loaded` event and no
second walk.

**Why not in 1.7.**

- It changes `ScenePass` and adds flex props to `NodeStore`'s typed arrays,
  both out of bounds.
- Content-sized containers need a bottom-up measure and a top-down placement:
  two walks, or a pre-pass over dirty containers. Solid's post-mutation pass
  plus a synchronous `TextNode.measure()` (in bounds, adopted for 1.7) is that
  pre-pass already, and reaches one walk per text change without moving flex.
- Solid's flex semantics (`flexBoundary`, `flexCrossBoundary`, `flexItem`,
  `flexOrder`, `onLayout`, the Row and Column scroll on layout) would move into
  the renderer, and `onLayout` callbacks are app code that must run between
  walks anyway.

**Evidence.** `docs/perf/text-flex-alternatives.md`, section 2.8. With
`measure()` and a depth-ordered queue the walk count is already 1; the only
remaining gain is Solid's per-pass accessor overhead, which the 1.7 flex
rewrite addresses inside Solid.

**Prerequisite for revisiting.** The measured cost of Solid's flex after the
1.7 rewrite, on device.

## P2. Known open risks this brief's workloads hit (measure, do not fix)

From the renderer's `HANDOFF.md`. The 1.7 benchmark suite reports both; the
decisions stay with the renderer.

- **Every glyph is re-uploaded each drawn frame** (spec 10.3). Text-heavy
  scenarios (`text-details-panel`, `text-flex-mount-*`, `text-virtual-row`,
  `portal-focus-text`) pay it on every animation frame of a press.
- **Animated shader props, or `w`/`h` on a shaded node, allocate a params
  block per frame** (about 350-470 B per animated node per frame). Hit by the
  `$focus` scale with a border (`thumbnail-focus`, `poster-*`) and the
  NavDrawer width transition (`navdrawer-toggle`).

## P3. Keep bundlers from inlining the walk's helpers as closures

**Measured.** The demo app's production build (terser with `compress` on,
`mangle` off) inlines `ScenePass`'s single-use world-transform helper into
`visit` as an IIFE, `!function(s, id, parent){…}(s, id, parent)`, which
allocates on every dirty node the walk visits, every frame. The solid 1.7
benchmark (arm B, alloc mode, every allocation sampled) charges up to 68 KiB
per key press to it. Rebuilt with `compress: { reduce_funcs: false }`, the
IIFE is gone and the renderer's allocations per press drop from 56.7 to
3.4 KiB (rows-ud-auto), 67.7 to 8.6 KiB (virtual-grid), 8.6 to 4.0 KiB
(thumbnail-focus) and 49.6 to 21.0 KiB (text-flex-mount-same)
(`docs/perf/results/2026-10-03/profiles.md`). Three other renderer helpers
are inlined the same way (`bench/dist/B/assets/renderer.js`: the setter
helper near line 1328, a UV helper near 2434, and one at 4454).

**Why it is a proposal.** The fix in the renderer is in `ScenePass` (out of
bounds): keep the helper from being a single-use top-level function, for
example a `ScenePass` method or a `/*@__NOINLINE__*/` call-site annotation,
and add a check to the renderer's size or allocation tooling that builds with
a terser config like the demo's. Until then an app's build sets
`reduce_funcs: false` (proposed for solid-demo-app in Phase 3, and for
Solid's docs).

## P4. Idle maintenance's `gl.getError()` after every press

**Measured.** Every press that ends in idle runs the renderer's idle
maintenance, whose out-of-memory probe calls `gl.getError()` (a GPU sync).
In the 6x profiles it costs 0.6-0.9 ms per op on renderer v2 against about
0.18 ms on 1.9.3. It runs after the frame that shows the press, so it does
not delay that frame, but it is main-thread CPU on every isolated key press.

**Why it is a proposal.** It is in `Renderer.maintain` and `GlContext`, not
the surface Solid touches. Options for the renderer: probe less often (every
Nth idle transition, or on a timer), or only after frames that uploaded
textures. Needs a device measurement first (a TV's driver may make the sync
cheaper or far more expensive).

<!-- Further items are added during Phase 2 when a measured win needs a change outside the boundaries. -->
