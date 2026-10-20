# Store-direct binding: results against the design targets

The targets of section 7 of the design
([store-direct renderer binding](../../../superpowers/specs/2026-10-19-store-direct-renderer-binding-design.md)),
measured on this branch. Methodology and the meaning of every number:
[docs/perf/README.md](../../README.md).

| File                                                                 | What                                                                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [summary.md](summary.md)                                             | The full series: time, alloc and count modes, arms A and C interleaved, 3 runs                                                               |
| [warmup-x10/summary.md](warmup-x10/summary.md)                       | Alloc mode only, the eight scenarios of the garbage row, `--warmup-scale 10`, 1 run                                                          |
| [warmup-x40/summary.md](warmup-x40/summary.md)                       | The same with `--warmup-scale 40`: the five rows scenarios (the series was stopped before thumbnail-focus, navdrawer-toggle and virtual-row) |
| [sites.md](sites.md)                                                 | Every framework site in each garbage scenario's top 30, arm C, all three series                                                              |
| [size.json](size.json)                                               | `bench/size.mjs` on arm C                                                                                                                    |
| [../2026-10-19-baseline/size.json](../2026-10-19-baseline/size.json) | `bench/size.mjs` on arm A (Task 0)                                                                                                           |

Commands (all from the repository root):

```sh
node bench/run.mjs --arms A,C --modes time,alloc,count --runs 3 --out docs/perf/results/2026-10-19-store-direct
node bench/run.mjs --arms A,C --modes alloc --runs 1 --warmup-scale 10 --skip-build \
  --scenarios rows-lr-noshift,rows-lr-auto,rows-lr-always,rows-ud-auto,rows-ud-always,thumbnail-focus,navdrawer-toggle,virtual-row \
  --out docs/perf/results/2026-10-19-store-direct/warmup-x10
# the same with --warmup-scale 40 --out .../warmup-x40 (stopped after the rows scenarios)
node bench/size.mjs --out docs/perf/results/2026-10-19-store-direct/size.json
```

## Environment

- Arm A: Solid `e63c88d` (`v2` before the store-direct rewrite) on
  `@solidtv/renderer` 2.0.6 (npm). Arm C on the linked renderer 2.1.0-0:
  time and count modes ran at Solid `a686923`; the alloc results of the
  eight garbage scenarios (all three series) at `5d2892c`, after the fix
  round below, and the other ten scenarios' alloc at `a686923`. Each JSON
  records its source.
- Arm R (1.8 on renderer 2.0) is **not run**: 1.8 runs on renderer 1.x, and
  `bench/prepare-arms.mjs` prepares one Solid source per arm against the
  renderer bootstrap of its major version, so 1.8 on renderer 2.0 is not a
  build this harness can make cheaply.
- Chromium 141.0.7390.37 (Playwright), headless, GPU ANGLE Metal (Apple M4
  Pro), crossOriginIsolated, clock resolution 5.0 µs, 6x CPU throttling.
- 1-minute load average at run start: 1.0–7.2 over the full series (the
  high-load alloc runs of the first pass were replaced by the fix round's);
  rows-lr-noshift's time runs 2 and 3 started at 5.6–7.2, and their range is
  wide (below). warmup-x10: 1.2–3.6; warmup-x40: 1.1–2.9.

## The table of section 7

Each cell: median over runs (min–max over runs). Times are the per-run mean
`total` in ms under 6x throttling; bytes are per op.

| Target                       | Metric                                     | Pass                                         | A                                                    | C                                                                                                                | Met                                          | Cause when not met                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------ | -------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steady-state garbage         | framework bytes per op, alloc mode         | 0 for the eight scenarios below              | 994–12549                                            | 248–3147 (default warmup); 122–1739 (warmup x10); 84 on the five rows scenarios (warmup x40)                     | **NOT MET**                                  | Residual per scenario below. With the code optimized (warmup x40) every rows scenario is down to 84 B, all three of them parked limits (fresh `focusPath` copy 40, `queueMicrotask` record 32, key-down clock 12); thumbnail-focus adds the ShaderNode swap; virtual-row adds `@solid-primitives/list`'s reconciliation and Virtual's own microtask and clock |
| Press cost                   | `total` per scenario                       | ≤ R, and ≥ 1.5x below A where 1.8 reached it | table below                                          | table below                                                                                                      | **not evaluated**                            | R not run (above). C ≤ A in 14 of 18 scenarios; ≥ 1.5x below A in 2 (rows-lr-noshift, text-flex-mount-same)                                                                                                                                                                                                                                                   |
| Flex passes                  | per press, count mode                      | 1 per affected container (1.8's numbers)     | table below                                          | table below                                                                                                      | **yes, but text-virtual-row**                | C equals 1.8's count in 17 of 18 scenarios; text-virtual-row is 2.3 (1.8: 1.9, A: 3.2): an extra row pass on 24 of 56 presses (cause in the flex section)                                                                                                                                                                                                     |
| Walks                        | per drawn frame                            | 1                                            | 1.00, 2.00 in the three text-mount/details scenarios | 1.00 in every scenario                                                                                           | **yes**                                      |                                                                                                                                                                                                                                                                                                                                                               |
| Node creation                | poster-mount, text-flex-mount-\* `total`   | ≤ A                                          | 1.794 / 2.477 / 2.063                                | 1.826 / 1.836 / 1.269                                                                                            | **text yes; poster-mount no (within noise)** | poster-mount C is 1.8% above A, the run ranges overlap (A 1.759–1.796, C 1.681–1.867); framework bytes per mount went up (below)                                                                                                                                                                                                                              |
| Node creation (renderer)     | renderer `bench-create` ≤ its 2.0.6 figure |                                              |                                                      |                                                                                                                  | **not measured here**                        | The renderer repository's row                                                                                                                                                                                                                                                                                                                                 |
| Framework size, app slice    | minified / gzip                            | ≤ 32 kB / 11.5 kB                            | 32.1 kB / 11.4 kB                                    | 65.3 kB / 19.0 kB                                                                                                | **no**                                       | The binding layer moved into Solid (below)                                                                                                                                                                                                                                                                                                                    |
| Framework size, every export | minified / gzip                            | ≤ 80 kB / 27 kB                              | 108.1 kB / 36.9 kB                                   | 108.3 kB / 35.2 kB                                                                                               | **no**                                       | The DOM renderer left, the binding layer came in (below)                                                                                                                                                                                                                                                                                                      |
| Renderer core entry          | `pnpm size`                                | ≤ 150 kB / 50 kB                             | 171 kB / 55.3 kB (2.0.6)                             | measured by the renderer plan: 168.3 kB / 56.4 kB (target 150/50, missed, reported)                              | **no**                                       | The renderer's row: reported, not this repository's                                                                                                                                                                                                                                                                                                           |
| Contract                     | `pnpm test`, type-checks, lint, VRT        | green                                        |                                                      | `pnpm test` 779 passed, 71 skipped; `pnpm tsc` exit 0; `pnpm lint` exit 0 (Prettier clean, oxlint warnings only) | **yes (this repo)**                          | VRT and the renderer's suite are the renderer repository's                                                                                                                                                                                                                                                                                                    |

The size rows are targets, not gates (the user's decision in section 7): the
misses are reported with their cause.

## Steady-state garbage: NOT MET

`framework` is the `assets/framework.js` chunk: this repository's `src/`
plus `@solid-primitives`. The sampling interval is 1 byte, so 0 means no
allocation at all (there is no sampling floor). Three series, all on Solid
`5d2892c`:

- **Default warmup** ([summary.md](summary.md), 3 runs): the scenario's own
  warmup (18 to 30 ops). Code run once per press is still in V8's baseline
  tiers there, where a double read from a typed array or crossing a call is
  a 12-byte heap number and a `pop` that empties an array drops its store.
- **Warmup x10** ([warmup-x10/summary.md](warmup-x10/summary.md), 1 run).
- **Warmup x40** ([warmup-x40/summary.md](warmup-x40/summary.md), 1 run):
  the five rows scenarios only (stopped there at the user's request).

Alloc bytes vary by under 1% between runs (the 3-run ranges below), so the
1-run series stand on one run. Per-site numbers: [sites.md](sites.md).

| scenario         | A default           | C default        | A x10 | C x10    | A x40 | C x40  | C residual, and what it is                                                                                                                                                                                                        |
| ---------------- | ------------------- | ---------------- | ----- | -------- | ----- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rows-lr-noshift  | 994 (993–995)       | 299 (298–304)    | 984   | 210      | 904   | **84** | parked limits only: `focusPath` copy 40, `queueMicrotask` 32, key-down clock 12                                                                                                                                                   |
| rows-lr-auto     | 1051 (1050–1053)    | 321 (321–336)    | 1006  | 227      | 936   | **84** | the same three                                                                                                                                                                                                                    |
| rows-lr-always   | 1052 (1052–1052)    | 323 (323–323)    | 1025  | 228      | 936   | **84** | the same three                                                                                                                                                                                                                    |
| rows-ud-auto     | 1594 (1592–1596)    | 396 (396–397)    | 1544  | 234      | 1477  | **84** | the same three                                                                                                                                                                                                                    |
| rows-ud-always   | 1601 (1599–1617)    | 400 (398–409)    | 1564  | 233      | 1484  | **84** | the same three                                                                                                                                                                                                                    |
| thumbnail-focus  | 1366 (1366–1374)    | 248 (247–248)    | 1365  | **209**  | —     | —      | at x10: the three limits (`updateFocusPath` 65, of which the copy is 36 and the rest tier; 32; 12), the ShaderNode swap (`convertToShader` 25, `hasBorderWidth` 4), `mergeIntoBag` 60 (not resolved, x40 not run), small sites 11 |
| navdrawer-toggle | 12549 (12537–12557) | 514 (509–528)    | 12487 | **122**  | —     | —      | at x10: parked limits only (`focusPath` copies 62, `queueMicrotask` 48 = 1.5 per press, key-down clock 12) plus `resolveStateValue` 0.5                                                                                           |
| virtual-row      | 5354 (5343–5367)    | 3147 (3144–3151) | 4218  | **1739** | —     | —      | at x10: `@solid-primitives/list` 1414, Virtual's slice 61, `queueMicrotask` 61 (1.9 per press) + Virtual's own 32, the `focusPath` copy, the key-down clock and Virtual's clock read; Virtual's shift numbers (tier, below)       |

### Every remaining framework site

Bytes per op, arm C (default / x10 / x40; — where not in the top 30 or not
run). Line numbers are of the `5d2892c` bundle.

| Site                                                                                                                                                                                                                                                           | Source                                                                | Bytes                                              | Disposition                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updateFocusPath (framework:819)`                                                                                                                                                                                                                              | `src/core/focusManager.ts`                                            | 36–62 / 40–65 / 40                                 | **Parked: the fresh `focusPath` array.** One exact-size copy per focus change (navdrawer makes more than one change per press)                                                                                                                                                  |
| `schedulePostMutation (framework:965)`, and `setFocus`/`queueLayout` where it inlines                                                                                                                                                                          | `src/core/node/postMutation.ts`                                       | 32–48 / 32–61 / 32                                 | **Parked: the `queueMicrotask` task record.** 32 B per scheduled pass: 1 per press on the rows scenarios, 1.5 on navdrawer-toggle (48 B), 1.9 on virtual-row (61 B), where the List's inserts schedule a second pass after the first ran                                        |
| `propagateKeyPress (framework:860)`                                                                                                                                                                                                                            | `src/core/focusManager.ts`                                            | 4–12 / 12 / 12                                     | **Parked: the key-down clock read.** The key-up read is fixed (`f6f3b00`)                                                                                                                                                                                                       |
| `convertToShader`, `hasBorderWidth` (thumbnail-focus)                                                                                                                                                                                                          | `src/core/node/shader.ts`                                             | 24 / 29 / —                                        | **Parked: the ShaderNode swap** (the thumbnail's border width crosses 0 on every focus change)                                                                                                                                                                                  |
| `(anonymous) (framework:3177)`, `updateKeyedMap (framework:3175)` (virtual-row)                                                                                                                                                                                | `@solid-primitives/list`                                              | 1394 / 1414 / —                                    | **Parked: `@solid-primitives/list`'s reconciliation**                                                                                                                                                                                                                           |
| `computeSlice (framework:3415)` (virtual-row)                                                                                                                                                                                                                  | `src/primitives/Virtual.tsx`                                          | 61 / 61 / —                                        | The window slice: a fresh array for `List`'s `each` (the List's input, part of the List limit)                                                                                                                                                                                  |
| `onSelectedChanged (framework:3565)` (virtual-row)                                                                                                                                                                                                             | `src/primitives/Virtual.tsx`                                          | — / 56 / —                                         | `queueMicrotask(applyShift)`: Virtual's own microtask record, 32 B (the queueMicrotask limit); the rest is tier (a scratch x40 run, not kept: 32)                                                                                                                               |
| `applyShift (framework:3495)` (virtual-row)                                                                                                                                                                                                                    | `src/primitives/Virtual.tsx`                                          | 72 / 72 / —                                        | `performance.now()` for the shift's duration, 12 B (a clock read like the key-down one: proposed as the same limit); the rest is tier (scratch x40: 12)                                                                                                                         |
| `(anonymous) (framework:2983)` and the `x`/`width`/`y`/`height`/`scale` getters (`framework:1952/1963/1974/1987/2011`)                                                                                                                                         | `src/primitives/utils/withScrolling.ts`, `src/core/node/accessors.ts` | 74–97 + 8–24 each / 78–93 + 4–24 each / **0**      | **Tier artifact.** Gone at x40 on all five rows scenarios. The named-access rewrite the review proposed (and direct store reads) were measured and reverted: at x40 the keyed and named versions both read 0 (scratch runs), and at x10 neither moved (direct reads were worse) |
| `value (framework:415)` (`States.add`)                                                                                                                                                                                                                         | `src/core/states.ts`                                                  | 76–338 / 31 (rows-lr-noshift), 0 elsewhere / **0** | Fixed for optimized code (`0abfa82`): at the default warmup an unoptimized `pop` to empty still drops the store; the x40 series shows 0                                                                                                                                         |
| `mergeIntoBag (framework:211)` (thumbnail-focus)                                                                                                                                                                                                               | `src/core/node/shader.ts`                                             | 60 / 60 / —                                        | Down from 212 (`40c44e3`); the rest not resolved (x40 not run)                                                                                                                                                                                                                  |
| `layout (framework:586)` (virtual-row)                                                                                                                                                                                                                         | `src/core/flex.ts`                                                    | 1083 / — / —                                       | Tier artifact: not in the top 30 at x10 (smallest 50 B)                                                                                                                                                                                                                         |
| `get states (framework:1625)` 1–8.5, `(anonymous) (framework:2875)` 2.2 (render.ts's active-element effect), `compileBlock` 4.1, `liftSuppression` 1.4, `writeWidth` 31 and `set states` 6 (navdrawer, default only), `resolveStateValue` 0.5, `keyNameId` 0.1 | various                                                               | default / x10 only                                 | Small sites, not at x40 where measured; tier artifacts by that evidence, not traced one by one                                                                                                                                                                                  |
| `runPostMutation` 9 B (first pass), the scale getter 12 B, virtual-row's ~174 B beyond its top 30 (first pass)                                                                                                                                                 |                                                                       |                                                    | Gone: `runPostMutation`'s was the setActiveElementCore IIFE (`c698315`); the scale getter is in the withScrolling row above; virtual-row's x10 sites sum to within 76 B of its framework total, each unlisted site under the 30th site's 50 B                                   |

`reactivity` (solid-js) is about 540 B per press in every rows scenario in
both arms, and the `renderer` column is the renderer's: both out of scope.

### Fixed in this task

| Commit                    | Site                                                                                                        | Before → after (arm C)                                                                      | Test                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `0abfa82` perf(states)    | `States.add`/`merge`: an Array subclass loses its store when it empties                                     | navdrawer-toggle States 1026 B/op (merge 684 + add 342, a scratch x20 run before) → 0 (x10) | `tests/states.test.tsx` "States is a plain Array"                                |
| `c698315` perf(focus)     | `setActiveElementCore` IIFE, `updateFocusPath`'s `[]`+push and closure, `Config.setActiveElement`'s closure | rows-lr-noshift 0.53 → 0.32 KiB/op (default, with the two around it)                        | `tests/contract-focus.test.tsx`: fresh array per change; re-entrant change       |
| `a2f9726` perf(nodes)     | `setFocus()` IIFE                                                                                           | (in the above)                                                                              | contract-focus (behaviour); no unit test can pin terser's output                 |
| `f6f3b00` perf(focus)     | the clock read on key release                                                                               | 12 → 0 B per release                                                                        | `tests/contract-keys.test.tsx`: a release does not read the clock                |
| `40c44e3` perf(shader)    | `mergeIntoBag`'s `CHANGED.length = 0` drops the store                                                       | thumbnail-focus 212 → 60, navdrawer-toggle 88 → 0 B/op (x10)                                | none possible (an array's store); behaviour pinned by the shader tests           |
| `1e52c60` perf(styles)    | a state block of numbers only made a double array; each read boxed                                          | navdrawer-toggle `resolveStateValue` 18 → 0.5 B/op (x10)                                    | none possible (elements kind)                                                    |
| `b10bc24` perf(animation) | a stop-hook closure per new transition controller (Row/Column switch settings with the direction)           | rows-lr-auto 8 → 0 B/op (x40)                                                               | `tests/node/transition.test.tsx`: the new controller's `onStop` is the old one's |
| `f112692` perf(nodes)     | unguarded `log(msg, node, ...args)` in insert/remove/replaceText: a rest array per call                     | virtual-row 10 → 0 B/op (x10)                                                               | none possible (`isDev` is a build constant, true under test)                     |

Pin without a fix: `28a4bc7` test(row-column), a press mid-transition
scrolls on from the target (the withScrolling rewrite it was written for was
reverted, see above). Harness commits: `a2d4baa` (the nav probes read arm
C's nodes; the alloc window ends before the end-state probe), `a686923` and
`5d2892c` (`--warmup-scale`, a positive integer).

The flex question of design section 9 (accessors or inline array reads):
flex's allocation is a tier artifact (1.1 KB per op on virtual-row at the
default warmup, out of the top 30 at x10). The accessors stay; the inline
variant was not needed and was not measured.

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

Every run range is a single value. text-virtual-row's extra passes: each
press makes 2 or 3 (A: 3 or 4); the final layout is in the handler or
tail on every press, and 24 of 56 presses (run 1) take the third. From the
code order: the press focuses the next tile (the post-mutation pass is
scheduled), then Virtual queues its shift (`queueMicrotask(applyShift)`).
The post-mutation pass runs first and its focus update flushes the List,
which rewrites the recycled tile's texts and schedules another pass;
`applyShift` then lays the row out (its window changed); the new pass lays
out the tile, and when the new text changed the tile's size it queues the
row again: a second row pass. 1.8 measured 1.9, 2 per shifting press. This
is inferred from the code, not instrumented; ordering the shift after the
pass would remove it.

The 1.8 column is arm C of 1.8's
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

- Garbage (NOT MET): the parked limits (the `focusPath` copy, the
  `queueMicrotask` records, the key-down clock, `@solid-primitives/list`, the
  ShaderNode swap); Virtual's own microtask and clock read (proposed as the
  same limits); `mergeIntoBag`'s remaining 60 B on thumbnail-focus; the x40
  series for thumbnail-focus, navdrawer-toggle and virtual-row was not run.
- Flex: text-virtual-row's second row pass (order the shift after the
  post-mutation pass).
- Arm R: needs 1.8 built against renderer 2.0, not prepared by this harness.
- Count hooks for renderer 2.1 (node writes, animations, created, loaded).
- Device measurement: none of this is on a TV.
