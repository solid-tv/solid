# Store-direct binding: results against the design targets

The targets of section 7 of the design
([store-direct renderer binding](../../../superpowers/specs/2026-10-19-store-direct-renderer-binding-design.md)),
measured on this branch. Methodology and the meaning of every number:
[docs/perf/README.md](../../README.md).

| File                                                                 | What                                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [summary.md](summary.md)                                             | The full series: time, alloc and count modes, arms A and C interleaved, 3 runs      |
| [warmup-x10/summary.md](warmup-x10/summary.md)                       | Alloc mode only, the eight scenarios of the garbage row, `--warmup-scale 10`, 1 run |
| [size.json](size.json)                                               | `bench/size.mjs` on arm C                                                           |
| [../2026-10-19-baseline/size.json](../2026-10-19-baseline/size.json) | `bench/size.mjs` on arm A (Task 0)                                                  |

Commands (all from the repository root):

```sh
node bench/run.mjs --arms A,C --modes time,alloc,count --runs 3 --out docs/perf/results/2026-10-19-store-direct
node bench/run.mjs --arms A,C --modes alloc --runs 1 --warmup-scale 10 --skip-build \
  --scenarios rows-lr-noshift,rows-lr-auto,rows-lr-always,rows-ud-auto,rows-ud-always,thumbnail-focus,navdrawer-toggle,virtual-row \
  --out docs/perf/results/2026-10-19-store-direct/warmup-x10
node bench/size.mjs --out docs/perf/results/2026-10-19-store-direct/size.json
```

## Environment

- Arm A: Solid `e63c88d` (`v2` before the store-direct rewrite) on
  `@solidtv/renderer` 2.0.6 (npm). Arm C: Solid `a686923` (this branch, all
  fixes below included) on the linked renderer 2.1.0-0.
- Arm R (1.8 on renderer 2.0) is **not run**: 1.8 runs on renderer 1.x, and
  `bench/prepare-arms.mjs` prepares one Solid source per arm against the
  renderer bootstrap of its major version, so 1.8 on renderer 2.0 is not a
  build this harness can make cheaply.
- Chromium 141.0.7390.37 (Playwright), headless, GPU ANGLE Metal (Apple M4
  Pro), crossOriginIsolated, clock resolution 5.0 µs, 6x CPU throttling.
- 1-minute load average at run start: 1.0–27.1 over the series. 13 of the
  324 runs started above 5: the alloc runs of thumbnail-focus (runs 2 and 3,
  both arms, 19.9–27.1) and virtual-row (6.1–18.1), whose byte counts do not
  depend on load (their run ranges are within 1%), and rows-lr-noshift's
  time runs 2 and 3 (5.6–7.2), whose range is wide (below). The warmup-x10
  series: 1.7–4.7.

## The table of section 7

Each cell: median over runs (min–max over runs). Times are the per-run mean
`total` in ms under 6x throttling; bytes are per op.

| Target                       | Metric                                     | Pass                                         | A                                                    | C                                                                                                                | Met                                          | Cause when not met                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------ | -------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steady-state garbage         | framework bytes per op, alloc mode         | 0 for the eight scenarios below              | 1002–12537                                           | 323–3217 (default warmup); 238–1781 (warmup x10)                                                                 | **no**                                       | Per scenario below. Platform and API costs left on every focus change (about 130 B); Row/Column scroll arithmetic boxes doubles (about 90–130 B); the shaded thumbnail and NavDrawer nodes are outside the rule by goal 3; virtual-row's window move runs `@solid-primitives/list`'s keyed reconciliation |
| Press cost                   | `total` per scenario                       | ≤ R, and ≥ 1.5x below A where 1.8 reached it | table below                                          | table below                                                                                                      | **not evaluated**                            | R not run (above). C ≤ A in 14 of 18 scenarios; ≥ 1.5x below A in 2 (rows-lr-noshift, text-flex-mount-same)                                                                                                                                                                                               |
| Flex passes                  | per press, count mode                      | 1 per affected container (1.8's numbers)     | table below                                          | table below                                                                                                      | **yes, but text-virtual-row**                | C equals 1.8's count in 17 of 18 scenarios; text-virtual-row is 2.3 (1.8: 1.9, A: 3.2)                                                                                                                                                                                                                    |
| Walks                        | per drawn frame                            | 1                                            | 1.00, 2.00 in the three text-mount/details scenarios | 1.00 in every scenario                                                                                           | **yes**                                      |                                                                                                                                                                                                                                                                                                           |
| Node creation                | poster-mount, text-flex-mount-\* `total`   | ≤ A                                          | 1.794 / 2.477 / 2.063                                | 1.826 / 1.836 / 1.269                                                                                            | **text yes; poster-mount no (within noise)** | poster-mount C is 1.8% above A, the run ranges overlap (A 1.759–1.796, C 1.681–1.867); framework bytes per mount went up (below)                                                                                                                                                                          |
| Node creation (renderer)     | renderer `bench-create` ≤ its 2.0.6 figure |                                              |                                                      |                                                                                                                  | **not measured here**                        | The renderer repository's row                                                                                                                                                                                                                                                                             |
| Framework size, app slice    | minified / gzip                            | ≤ 32 kB / 11.5 kB                            | 32.1 kB / 11.4 kB                                    | 65.3 kB / 19.0 kB                                                                                                | **no**                                       | The binding layer moved into Solid (below)                                                                                                                                                                                                                                                                |
| Framework size, every export | minified / gzip                            | ≤ 80 kB / 27 kB                              | 108.1 kB / 36.9 kB                                   | 108.3 kB / 35.2 kB                                                                                               | **no**                                       | The DOM renderer left, the binding layer came in (below)                                                                                                                                                                                                                                                  |
| Renderer core entry          | `pnpm size`                                | ≤ 150 kB / 50 kB                             | 171 kB / 55.3 kB (2.0.6)                             | measured by the renderer plan: 168.3 kB / 56.4 kB (target 150/50, missed, reported)                              | **no**                                       | The renderer's row: reported, not this repository's                                                                                                                                                                                                                                                       |
| Contract                     | `pnpm test`, type-checks, lint, VRT        | green                                        |                                                      | `pnpm test` 777 passed, 71 skipped; `pnpm tsc` exit 0; `pnpm lint` exit 0 (Prettier clean, oxlint warnings only) | **yes (this repo)**                          | VRT and the renderer's suite are the renderer repository's                                                                                                                                                                                                                                                |

The size rows are targets, not gates (the user's decision in section 7): the
misses are reported with their cause.

## Steady-state garbage

`framework` is the `assets/framework.js` chunk: this repository's `src/`
plus `@solid-primitives`. The sampling interval is 1 byte, so 0 means no
allocation at all (there is no sampling floor). Two measurements:

- **Default warmup** ([summary.md](summary.md), 3 runs): the scenario's own
  warmup (18 to 30 ops). Code that runs once per press is still in V8's
  baseline tiers there, where a double read from a typed array or crossing a
  call is a 12-byte heap number and where a `pop` that empties an array
  drops its backing store.
- **Warmup x10** ([warmup-x10/summary.md](warmup-x10/summary.md), 1 run;
  alloc bytes vary by under 1% between runs in the 3-run series): the same
  measured ops after ten times the warmup, with that code optimized. What
  remains there is the steady-state garbage.

| scenario         | A, default          | C, default       | A, warmup x10 | C, warmup x10 |
| ---------------- | ------------------- | ---------------- | ------------- | ------------- |
| rows-lr-noshift  | 1002 (1000–1002)    | 323 (322–323)    | 984           | 238           |
| rows-lr-auto     | 1053 (1050–1068)    | 353 (353–354)    | 1005          | 258           |
| rows-lr-always   | 1052 (1051–1060)    | 357 (355–361)    | 1023          | 261           |
| rows-ud-auto     | 1594 (1594–1596)    | 429 (429–429)    | 1541          | 267           |
| rows-ud-always   | 1601 (1600–1603)    | 431 (431–432)    | 1564          | 266           |
| thumbnail-focus  | 1365 (1365–1377)    | 407 (406–408)    | 1341          | 339           |
| navdrawer-toggle | 12537 (12530–12551) | 640 (633–657)    | 12487         | 252           |
| virtual-row      | 5348 (5325–5358)    | 3217 (3205–3223) | 4138          | 1781          |

None reads 0. Arm C before this task's fixes, for reference (a scratch
alloc run of the tree at `1ef33ad` with the probe fix, 1 run, default
warmup, not kept; KiB as printed by the runner, which still charged about
8 B of end-state probe reads): rows-lr-noshift 0.53, rows-lr-auto 0.56,
rows-ud-always 0.67, thumbnail-focus 0.62, navdrawer-toggle 1.92,
virtual-row 3.36 KiB.

### Top framework sites, arm C, warmup x10

From each JSON's `topSites` (bytes per op; `framework:N` is the line in
`bench/dist/C/assets/framework.js`).

| scenario         | sites                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rows-lr-noshift  | `(anonymous) (framework:2980)` 72, `updateFocusPath (framework:823)` 40, `schedulePostMutation (framework:969)` 32, `value (framework:419)` 31, `propagateKeyPress (framework:864)` 24, `resolveStateValue (framework:1272)` 12 |
| rows-lr-auto     | `(anonymous) (framework:2980)` 92, `updateFocusPath` 40, `schedulePostMutation` 32, `propagateKeyPress` 24, `get (framework:1971)` 21, `get (framework:1949)` 16                                                                |
| rows-lr-always   | `(anonymous) (framework:2980)` 89, `updateFocusPath` 40, `schedulePostMutation` 32, `propagateKeyPress` 24, `get (framework:1971)` 21, `get (framework:1949)` 16                                                                |
| rows-ud-auto     | `(anonymous) (framework:2980)` 93, `updateFocusPath` 40, `schedulePostMutation` 32, `propagateKeyPress` 24, `get (framework:1984)` 24, `get (framework:1960)` 20                                                                |
| rows-ud-always   | `(anonymous) (framework:2980)` 93, `updateFocusPath` 40, `schedulePostMutation` 32, `propagateKeyPress` 24, `get (framework:1984)` 24, `get (framework:1960)` 20                                                                |
| thumbnail-focus  | `mergeIntoBag (framework:211)` 212, `updateFocusPath` 39, `schedulePostMutation` 32, `propagateKeyPress` 24, `convertToShader (framework:224)` 20                                                                               |
| navdrawer-toggle | `mergeIntoBag (framework:211)` 88, `updateFocusPath` 62, `schedulePostMutation` 48, `propagateKeyPress` 24, `resolveStateValue` 18, `hasRoundedProps (framework:201)` 12                                                        |
| virtual-row      | `(anonymous) (framework:3174)` 1357, `applyShift (framework:3492)` 72, `computeSlice (framework:3412)` 61, `schedulePostMutation` 61, `onSelectedChanged (framework:3562)` 56                                                   |

What each site is, and why it is left:

| Site                                                                   | Source                                                                                                       | Bytes                                                                  | Cause                                                                                                                                            | Left because                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updateFocusPath`                                                      | `src/core/focusManager.ts`                                                                                   | 40 per focus change                                                    | The exact-size copy of the path published to `focusPath`                                                                                         | The signal's value must be a fresh array: readers keep it (1.8 kept the copy for the same reason); reusing it is an API change                                                   |
| `schedulePostMutation`                                                 | `src/core/node/postMutation.ts`                                                                              | 32 per scheduled pass                                                  | `queueMicrotask`'s task record (V8/Blink)                                                                                                        | The post-mutation pass is a microtask by design (Task 10); one per press                                                                                                         |
| `propagateKeyPress`                                                    | `src/core/focusManager.ts`                                                                                   | 12 per key event (down and up)                                         | `performance.now()` returns a heap number                                                                                                        | Reading the clock only when a throttle is configured would stop recording `_lastAnyKeyPressTime` for elements without `throttleInput`: an observable change, left for a decision |
| `(anonymous) (framework:2980)`, `get (framework:1949/1960/1971/1984)`  | `src/primitives/utils/withScrolling.ts`; the `x`/`y`/`width`/`height` getters (`src/core/node/accessors.ts`) | 72–93, plus 16–24 per getter                                           | Doubles crossing calls: the scroll arithmetic reads node getters and writes `x`/`y` through setters it does not inline, each value a heap number | Removing it means reading the store arrays in withScrolling; not attempted in this task                                                                                          |
| `resolveStateValue`                                                    | `src/core/node/styles.ts`                                                                                    | 12–18                                                                  | A boxed value in the state resolution (not pinned down further)                                                                                  | Small; not traced to a line                                                                                                                                                      |
| `value (framework:419)`                                                | `States.add` (`src/core/states.ts`)                                                                          | 31 (rows-lr-noshift, warm), 76 at the default warmup, 0 elsewhere warm | A `pop` to empty in unoptimized code drops the array's store, the next `push` allocates it                                                       | Fixed for optimized code (the fix below); the cold tier is V8's                                                                                                                  |
| `mergeIntoBag`, `convertToShader`, `hasBorderWidth`, `hasRoundedProps` | `src/core/node/shader.ts`                                                                                    | 212 (thumbnail), 112 (navdrawer)                                       | The thumbnail's `border`/`borderRadius` and the NavDrawer's rounded nodes are shaded: their state change rebuilds the shader props               | Goal 3 of the design is zero garbage "on an unshaded node"; the shaded path is outside it by design                                                                              |
| `(anonymous) (framework:3174)`                                         | `@solid-primitives/list` (`List` with `recycle`, used by `src/primitives/Virtual.tsx`)                       | 1357                                                                   | Each window move reconciles the slice: a `Map`, temporary arrays and a row-setter closure per item                                               | Third-party code in the framework chunk; replacing `List` is out of this task's scope                                                                                            |
| `computeSlice`, `applyShift`, `onSelectedChanged`                      | `src/primitives/Virtual.tsx`                                                                                 | 61, 72, 56                                                             | The new window slice (a fresh array for `List`'s `each`), and the shift's numbers                                                                | The slice must be a new array for `List` to see it                                                                                                                               |

`reactivity` (solid-js) is about 540 B per press in every rows scenario in
both arms (signal writes of the focus path and the active element): out of
scope, reported. The `renderer` column is out of scope.

### Fixed in this task

| Commit                 | Site                                                                                                                                                                                                                                            | Before → after                                                                                                | Test                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0abfa82` perf(states) | `States.add` / `merge` (`src/core/states.ts`): States was an Array subclass, and on a subclass V8's generic path drops the store whenever the list empties, so each add allocated 17 slots (76 B; 10 per navdrawer press through forwardStates) | navdrawer-toggle 1.87 KiB/op (scratch run, warmup x20, before) → 0.25 KiB/op (warmup x10, with the two below) | `tests/states.test.tsx` "States is a plain Array" (the initial prototype, own non-enumerable methods, emptied and refilled)                                                 |
| `c698315` perf(focus)  | `setActiveElementCore` inlined as an IIFE (a closure per change); `updateFocusPath`'s `[]` + push + publishing closure; `Config.setActiveElement`'s closure                                                                                     | rows-lr-noshift 0.53 → 0.32 KiB/op (default warmup, with the other two)                                       | `tests/contract-focus.test.tsx`: a fresh array per change with kept paths intact; a re-entrant focus change from an `onFocus` builds its own path (fails without the guard) |
| `a2f9726` perf(nodes)  | `setFocus()` called a single-use helper with locals, inlined as an IIFE: a closure (32 B) per press                                                                                                                                             | (in the above)                                                                                                | Behaviour pinned by the contract-focus tests; terser's output is not unit-testable (the bench bundle shows no IIFE)                                                         |

Harness commits: `a2d4baa` (the nav probes read arm C's nodes, which have
no `lng`; the alloc window ends before the end-state probe, whose getter
reads were charged to arm C's framework bytes), `a686923`
(`--warmup-scale`).

The flex question of design section 9 (accessors or inline array reads):
flex's allocation is a tier artifact. At the default warmup `layout`
allocates about 1.1 KB per op on virtual-row (0.9 passes) and 1.2 KB per
op on text-details-panel (3 passes): boxed doubles at the accessor reads.
With the code optimized (warmup x10) it is gone from virtual-row's top 30
sites (the 30th is 52 B), whose framework total (1781 B) is mostly the
`List` site above. The accessors
stay; the inline variant was not needed for the steady state and was not
measured.

## Press cost: `total` per op, C vs A

R not run (above), so "≤ R" and "where 1.8 reached it" cannot be evaluated.

| scenario             | A total (ms)           | C total (ms)           | A/C  | ≥ 1.5x |
| -------------------- | ---------------------- | ---------------------- | ---- | ------ |
| navdrawer-toggle     | 1.478 (1.476–1.484)    | 1.090 (1.011–1.104)    | 1.36 | no     |
| page-mount           | 20.811 (20.725–21.331) | 16.585 (16.466–17.290) | 1.25 | no     |
| page-swap            | 39.165 (33.775–39.351) | 32.749 (31.990–33.517) | 1.20 | no     |
| portal-focus-text    | 0.653 (0.533–0.676)    | 0.600 (0.488–0.625)    | 1.09 | no     |
| poster-mount         | 1.794 (1.759–1.796)    | 1.826 (1.681–1.867)    | 0.98 | no     |
| poster-swap          | 2.490 (2.447–2.885)    | 2.682 (2.657–3.156)    | 0.93 | no     |
| rows-lr-always       | 0.499 (0.480–0.539)    | 0.405 (0.400–0.448)    | 1.23 | no     |
| rows-lr-auto         | 0.533 (0.414–0.549)    | 0.416 (0.381–0.515)    | 1.28 | no     |
| rows-lr-noshift      | 0.576 (0.465–0.609)    | 0.354 (0.304–0.513)    | 1.63 | yes    |
| rows-ud-always       | 0.630 (0.521–0.654)    | 0.465 (0.324–0.494)    | 1.36 | no     |
| rows-ud-auto         | 0.402 (0.396–0.715)    | 0.404 (0.330–0.404)    | 1.00 | no     |
| text-details-panel   | 0.870 (0.782–0.941)    | 0.729 (0.702–0.868)    | 1.19 | no     |
| text-flex-mount-new  | 2.477 (2.036–2.612)    | 1.836 (1.661–2.044)    | 1.35 | no     |
| text-flex-mount-same | 2.063 (1.982–2.103)    | 1.269 (1.266–1.282)    | 1.63 | yes    |
| text-virtual-row     | 1.003 (0.973–1.085)    | 0.976 (0.935–1.067)    | 1.03 | no     |
| thumbnail-focus      | 1.081 (1.063–1.171)    | 1.072 (0.967–1.093)    | 1.01 | no     |
| virtual-grid         | 1.948 (1.926–2.051)    | 1.803 (1.712–1.837)    | 1.08 | no     |
| virtual-row          | 0.810 (0.809–0.969)    | 0.868 (0.834–0.924)    | 0.93 | no     |

C is slower than A on poster-mount, poster-swap and virtual-row (0.93–0.98),
each inside or near the run ranges. The rows-lr-noshift ranges are wide
(its runs 2 and 3 started at load 5.6–7.2).

## Flex passes and walks (count mode)

| scenario              | A flex passes | C flex passes | 1.8 flex passes | A walks/drawn frame | C walks/drawn frame |
| --------------------- | ------------- | ------------- | --------------- | ------------------- | ------------------- |
| navdrawer-toggle      | 0.0           | 0.0           | 0.0             | 1.00                | 1.00                |
| page-mount            | 4.0           | 4.0           | 4.0             | 1.00                | 1.00                |
| page-swap             | 8.0           | 8.0           | 8.0             | 1.00                | 1.00                |
| portal-focus-text     | 0.0           | 0.0           | 0.0             | 1.00                | 1.00                |
| poster-mount          | 0.5           | 0.5           | 0.5             | 1.00                | 1.00                |
| poster-swap           | 1.0           | 1.0           | 1.0             | 1.00                | 1.00                |
| rows-\* (5 scenarios) | 0.0           | 0.0           | 0.0             | 1.00                | 1.00                |
| text-details-panel    | 7.0           | 3.0           | 3.0             | 2.00                | 1.00                |
| text-flex-mount-new   | 40.0          | 21.0          | 21.0            | 2.00                | 1.00                |
| text-flex-mount-same  | 40.0          | 21.0          | 21.0            | 2.00                | 1.00                |
| text-virtual-row      | 3.2           | 2.3           | 1.9             | 1.01                | 1.00                |
| thumbnail-focus       | 0.0           | 0.0           | 0.0             | 1.00                | 1.00                |
| virtual-grid          | 1.0           | 1.0           | 1.0             | 1.00                | 1.00                |
| virtual-row           | 0.9           | 0.9           | 0.9             | 1.00                | 1.00                |

Every run range is a single value. The 1.8 column is arm C of 1.8's
`docs/perf/results/2026-10-04/summary.md` (on the `1.8` branch), for
reference only. On arm C the count hooks that wrap renderer node setters,
`animate` and `emit` see nothing (renderer 2.1 writes the store from
Solid's accessors): `node writes`, `shader writes` and `loaded` read 0.0,
and `animations`, `created` and `creation props` read n/a, in
[summary.md](summary.md). Those columns are not measurements of arm C;
the hooks need the 2.1 names.

## Node creation

| scenario             | A total (ms)        | C total (ms)        | A framework (B/op) | C framework (B/op) |
| -------------------- | ------------------- | ------------------- | ------------------ | ------------------ |
| poster-mount         | 1.794 (1.759–1.796) | 1.826 (1.681–1.867) | 6756               | 10339              |
| text-flex-mount-new  | 2.477 (2.036–2.612) | 1.836 (1.661–2.044) | 53271              | 29186              |
| text-flex-mount-same | 2.063 (1.982–2.103) | 1.269 (1.266–1.282) | 53281              | 28720              |

Framework bytes per mount went up where the node is a view
(poster-mount, page-mount 98.5 → 124.3 KB, page-swap): the `ElementNode`
constructor is the top site (it declares every field, one hidden class, and
holds what the renderer's node held before); `createElement`, `insertChild`
and `mergeIntoBag` follow. Text mounts went down.

## Sizes

| Entry             | A (`e63c88d`)      | C                  | Target            | Met |
| ----------------- | ------------------ | ------------------ | ----------------- | --- |
| Typical app slice | 32,140 / 11,366 B  | 65,320 / 18,967 B  | ≤ 32 kB / 11.5 kB | no  |
| Every export      | 108,124 / 36,853 B | 108,254 / 35,225 B | ≤ 80 kB / 27 kB   | no  |

Cause. The binding layer that 2.0.6's renderer held behind its node handle
(a setter per prop, the text props, the shader props of border, shadow and
radius) is in Solid now: `src/core/node/accessors.ts`, `textProps.ts`,
`shader.ts`, `defaults.ts`, `animation.ts`. They are installed on
`ElementNode.prototype` at load, so no bundler can drop the parts an app
does not use, and the slice carries all of them (in the unminified slice,
the regions of those modules are about 37 of its 102 kB). In the every-export
bundle that addition about cancels the DOM renderer's removal (the 36 kB
the design counted on). The renderer's core entry did not shrink by the
same amount (the renderer's row). A's slice target was set before the
handle layer was counted in Solid's slice; it is not reachable with the
accessors installed unconditionally.

## What is left

- Garbage: the sites above. Each has a named cause; the ones a later change
  could remove are withScrolling's double arithmetic (read the store
  arrays), the clock read in `propagateKeyPress` (a decision on
  `_lastAnyKeyPressTime`), and virtual-row's `List` reconciliation (a
  recycle path without `@solid-primitives/list`).
- Arm R: needs 1.8 built against renderer 2.0, not prepared by this harness.
- Count hooks for renderer 2.1 (node writes, animations, created, loaded).
- Device measurement: none of this is on a TV.
