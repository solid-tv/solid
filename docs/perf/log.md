# Performance log

Every Phase 2 change is measured before and after with `npm run bench` and
logged here: the scenario, arms, runs, the numbers, and whether it was kept
(it must beat the noise floor or remove allocations).

## 2026-10-03: Phase 0 baseline

- Arms A (1.6.4 on renderer 1.9.3), B (lockstep port on renderer v2 `faf4b9f`)
  and C (= B today), 16 scenarios, 6x throttle.
- Time: 3 runs per arm; alloc and count: 1 run; profile: 1-2 runs per arm.
- Results: `results/2026-10-03/summary.md` and `profiles.md`; the demo app's
  `#/benchmark`: `results/demo-2026-10-03-*.json`.
- Analysis: `docs/superpowers/specs/2026-10-03-solid-1.7-design.md`,
  sections 1 and 2.

## 2026-10-03: terser `reduce_funcs` (build setting, not a code change)

- Arm B rebuilt with `BENCH_TERSER_COMPRESS='{"reduce_funcs":false}'`, alloc
  mode, 1 run, 4 scenarios: renderer KiB per press 56.7 → 3.4
  (rows-ud-auto), 67.7 → 8.6 (virtual-grid), 8.6 → 4.0 (thumbnail-focus),
  49.6 → 21.0 (text-flex-mount-same). Framework unchanged.
- Not adopted in the bench (it mirrors the demo app's build); proposed for the
  demo app in Phase 3 and as renderer proposal P3.

## Phase 2: per-stream entries

These are single 6x runs, arms B (frozen lockstep port) and C (each stream's
worktree), taken while other agents ran benchmarks on the same machine (load
average 4-26). Time is rough guidance; allocation (bytes per op) and counts
(flex passes, node writes, walks) are the evidence. Entries read "before arm B
→ after arm C" unless they say "C before → C after". The Checkpoint 2 series
(idle machine, n >= 3, every arm built with terser `reduce_funcs: false`)
replaces them.

Two harness caveats. Arm B's by-owner allocation split from a worktree run put
everything under `user` (framework and renderer 0.00) until the bench fix
below: totals, counts and times were not affected, so compare totals or sites
by function name. And on renderer `6392ce4` count mode was broken for text
scenarios in arm C (fixed below); stream L's text counts come from a scratch
build of renderer `faf4b9f`.

### 2026-10-03: Stream M (package exports, renderer-break absorption, terser note)

- B21 and decision 5.6 run once at startup, and the terser note cites the
  2026-10-03 profile above. No measured change; the bench was not run.

### 2026-10-03: Stream F (key dispatch, `States`, focus change)

#### F1, key dispatch without per-event allocation (`8b5a5ad`)

- What changed:
  - Handler prop names cached per key name (no template strings per event).
  - One reused listener per event type (no closure per event).
  - Key identities as two locals (no `keyIdentities` array, no `for…of` in
    `findSuppression`).
  - No result object from the bubble walk; `_pendingHistoryKey` updated in
    place.
  - (The walk skip measured here was removed in fix round 1; see the
    fix-round entry below for the numbers without it.)
- Scenarios: rows-lr-noshift, rows-lr-auto, virtual-row; arms B,C; alloc,
  count, time; 1 run, 6x.
- Alloc, total KiB/op, B → C: rows-lr-noshift 3.46 → 2.78, rows-lr-auto
  13.27 → 12.58, virtual-row 21.67 → 21.00 (−0.67 to −0.69 each).
  - Gone from the top sites: `keyIdentities` 200 B/op, `findSuppression` 168,
    per-event closures 176.
  - `propagateKeyPress` 220 → 185. The rest is terser `reduce_funcs` IIFE
    closures; with `reduce_funcs: false` it is 24 B/op.
- Counts unchanged. Time (rough): rows-lr-noshift total 0.790 → 0.693 ms;
  rows-lr-auto and virtual-row within noise.
- Kept.

#### F2, `States` without species construction (`14e84c7`)

- What changed:
  - `States[Symbol.species]` is `Array`.
  - `remove`/`merge` shift in place.
  - B2 fix; no class-field emit; no `Object.entries`.
- Measured together with the focus-path change below.
- Gone: `States` 200–216 B/op per navigation op.
- navdrawer-toggle: `States` 3810 + `_super` 1143 B/op removed, `merge`
  3519 → 920 B/op.
- Kept.

#### F2, O(depth) focus-path diff and one reactive flush per focus change (`560717f`)

- What changed:
  - Generation-stamped path diff (no `indexOf`), a reused build buffer with
    one `slice` per change.
  - 5.1: the focus phase runs in one `batch`.
  - No closures per focus change.
- Scenarios: rows-lr-noshift, thumbnail-focus, portal-focus-text,
  navdrawer-toggle; arms B,C; alloc, count, time; 1 run, 6x. C includes F1
  and the `States` change.
- Alloc, total KiB/op, B → C:

  | scenario          | B     | C     | change |
  | ----------------- | ----- | ----- | ------ |
  | rows-lr-noshift   | 3.46  | 2.27  | −34%   |
  | thumbnail-focus   | 12.64 | 11.21 |        |
  | portal-focus-text | 26.01 | 24.34 |        |
  | navdrawer-toggle  | 22.08 | 14.15 | −36%   |

- Reactivity KiB/op: portal-focus-text 1.80 → 1.08, rows-lr-noshift
  0.83 → 0.71.
- `updateFocusPath` (148 B/op) is gone from the top sites.
- Counts unchanged. Time (rough), total ms B → C:

  | scenario          | B     | C     |
  | ----------------- | ----- | ----- |
  | rows-lr-noshift   | 0.748 | 0.542 |
  | thumbnail-focus   | 0.717 | 0.613 |
  | portal-focus-text | 0.949 | 0.734 |
  | navdrawer-toggle  | 0.987 | 0.935 |

- With terser `reduce_funcs: false` (alloc, rows-lr-noshift and
  portal-focus-text):

  | scenario          | B KiB/op | C KiB/op |
  | ----------------- | -------- | -------- |
  | rows-lr-noshift   | 3.05     | 1.93     |
  | portal-focus-text | 10.69    | 9.06     |

  No dispatch or focus-path site remains above 76 B/op.

- These numbers include F1's walk skip, removed in fix round 1. Without it:
  rows-lr-noshift 2.33, portal-focus-text 24.31 KiB/op (next entry).
- Kept.

#### F1 fix round 1, capture and key-up walks always run again (`7cbdbc7`)

- What changed: the walk skip (module flags raised from `setProperty`) is
  removed. Handlers from `style`, `theme`, `$state` blocks or refs never fired
  under it. Everything else in F1 and F2 is unchanged.
- Scenarios: rows-lr-noshift, portal-focus-text; arms B,C; alloc; 1 run, 6x.
- Alloc, total KiB/op, B → C:

  | scenario          | B     | C     | with skip (C) |
  | ----------------- | ----- | ----- | ------------- |
  | rows-lr-noshift   | 3.45  | 2.33  | 2.27          |
  | portal-focus-text | 26.06 | 24.31 | 24.34         |

  So the skip was worth at most about 0.06 KiB/op, within noise for
  portal-focus-text.

- `propagateKeyPress` 185 → 247 B/op under the bench's default terser
  settings. Both walks now run on every event, and terser `reduce_funcs`
  inlines each walk as an IIFE closure. With `reduce_funcs: false` the walks
  are plain calls and allocate nothing.
- Kept (correctness).

### 2026-10-03: Stream P (Row, Column, Grid, Virtual, VirtualGrid, Lazy)

- **Row/Column transition cache, withScrolling read-once, Grid handlers once
  (P1; `4a044c3`, `e3c54c7`, `1f25922`).** Scenarios rows-lr-auto,
  rows-ud-auto, rows-lr-always. Framework bytes/op C 1.85 → 1.86, 2.40 → 2.39,
  1.86 → 1.88 (B has no framework bucket; totals B 13.24/59.79/13.18 vs C
  13.22/59.93/13.28): no measurable change at one run (the merged transition
  was one small object per press). Flex 0 → 0, node writes 2.0 → 2.0. Time
  total C 0.438 → 0.583, 0.770 → 0.455, 0.566 → 0.602 while B moved
  0.472 → 0.511, 0.657 → 0.522, 0.527 → 0.543: noise. **Kept** (removes a
  per-press allocation and repeated accessor reads by construction; no
  regression in counts or bytes).
- **Virtual: one SliceState, items signal, cursor out of the spread, one flex
  pass per shift, no closure per press (`704063c`).** virtual-row: flex passes
  1.9 → 0.9, node writes 26.1 → 15.2, framework 8.35 → 5.82 KiB/op
  (`calculateFlex` 4733 → 2341 B; the `onSelectedChanged` 152 B and
  `computeSlice` 145 B sites gone), total 21.72 → 19.17 KiB; time C
  1.004 → 0.964 (B 1.058 → 0.880). text-virtual-row: flex 4.2 → 3.2, writes
  29.7 → 20.7, framework 9.93 → 8.80 KiB, total 38.75 → 37.90; time C
  1.185 → 1.001 (B 1.100 → 1.037). **Kept.**
- **VirtualGrid: one flex pass per row change, cursor out of the spread, no
  closure per press (`dc7117c`).** virtual-grid: flex 2.0 → 1.0, node writes
  179.0 → 96.5, total 37.85 → 35.25 KiB (renderer 20.74 → 18.24), framework
  11.17 → 11.29 KiB (flat: list reconcile and flex scratch dominate); time C
  1.618 → 1.252 (B 1.403 → 1.590). **Kept.**
- **Virtual reuses the shift animation's props/settings (`c2b0e95`).**
  virtual-row (renderer `6392ce4`): framework 5.96 → 5.93 KiB/op, the
  `applyShift` site (116 B/op) leaves the top sites; flex 0.9, writes 15.2
  unchanged. **Kept.**
- **Grid `y` in its own effect (`728fcb5`).** No bench scenario has a Grid; the
  contract test shows an unrelated prop getter read 4 times over three
  vertical moves before, once (mount) after. **Kept.**
- The fix rounds (B14, B15, B13 with wrap, the per-element transition cache)
  change no hot-path work and were not re-benchmarked.

### 2026-10-03: Stream L (one flex engine, layout queue)

Arm C ran on renderer `faf4b9f` (arm B's renderer) for these entries.

- **L1, one allocation-free flex engine, write only what changed (`23e9f94`,
  `59ab929`).** Scenarios text-details-panel, text-flex-mount-same/-new,
  virtual-row, virtual-grid; arm B → arm C. Node writes per op: 54.4 → 15.0,
  91.0 → 50.0, 91.0 → 50.0, 26.1 → 15.2, 179.0 → 51.9. Bytes charged to the
  flex function per op: 9,725 → 1,284 (details panel), 28,884 → below the top 5
  (mount), 4,728 → 1,878 (virtual-row), 2,256 → below the top 5
  (virtual-grid). Framework KiB per op (C before → after): 12.05 → 3.62,
  55.04 → 28.04, 64.24 → 28.03, 8.37 → 5.58, 12.55 → 8.62. Flex passes
  unchanged (7, 42, 42, 1.9, 2.0). Time within noise. Micro-benchmark:
  2.1 KB → 0-2 B per pass with integral values. **Kept.**
- **L2, depth-ordered layout queue; `loaded` queues the parent; microtask-only
  scheduling (`31e6c78`).** text-details-panel flex passes 7.0 → **3.0**;
  text-flex-mount-same/-new 42.0 → **32.0**; virtual-row/-grid unchanged (1.9,
  2.0); walks per drawn frame 2.00 and loaded 5/5, 20/20 unchanged (T's);
  frames to final layout 1.0 (same frame as before). Time (rough): details
  panel C 0.889 → 0.796 ms, mount-new 2.473 → 1.455 ms (noisy). WebGL test:
  first render of a 3-text row, flex passes on the row 4 → 2. **Kept.**
- **Transition-aware flex writes, reentrancy guard, one write loop (`57bb69a`,
  `89a54f0`).** Correctness fixes; allocation (bytes per op charged to the
  flex function, arm C, `faf4b9f`): text-details-panel 1,316 → 1,761,
  virtual-row 1,896 → 1,492, virtual-grid below the top 30 sites before and
  after (5,344 in between, fixed by `89a54f0`). Flex passes and node writes
  unchanged. **Kept.**
- **flexGrow container: one onLayout after its children, its second pass
  inline (`8513151`).** No bench scenario has flexGrow; no measured change.
  **Kept.**
- **Grown auto-sizing child: no rewrite on relayout (`08d7647`).**
  Correctness/write-count fix, no bench scenario has flexGrow. Two relayouts:
  4 width writes and 2 extra child passes → 0 and 0. **Kept.**
- **Per-justify write loops back (`a69c3b6`).** text-details-panel flex-pass
  bytes per op 1,771 → 1,496 (L2: 1,490); virtual-row 1,513 → 1,842
  (L2: 1,896); virtual-grid unchanged (below the top 30). **Kept.** The
  residual 1.3-1.9 KB/op charged to the flex function is number boxing in the
  accessor paths, not engine scratch.

### 2026-10-03: Stream N (nodes: accessors, handle hygiene, draw order)

- **N1 / B17 + B20 + 3.6.5 (`e33db56`, `7d40658`, `d342c37`).** fontWeight and
  fontFamily resolved in one place; text-only props of non-text elements kept
  on the ElementNode; absX/absY/destroyed writes ignored; TextNode fields
  assigned in the constructor. Scenarios rows-lr-auto, virtual-row,
  portal-focus-text, text-virtual-row. Framework bytes/op 1897 → 1897,
  8536 → 8565, 1952 → 1970, 10181 → 10160 (no change); counts identical; time
  B/C 1.13–1.17 → 0.80–1.19 (noise). Bundle +185 B gzip. Kept (bug fixes).
- **N1 / 3.6.6 written-out accessors (`d33c789`).** One getter/setter per
  forwarded prop with a constant name; direct store unless `transition`. Same
  scenarios. Framework bytes/op virtual-row 8565 → 9307 (+733 B from a
  terser-inlined IIFE of the now single-use `getPropertyAlias`), others ±1 %.
  Time B/C 0.89–1.30 (noise). Superseded by the next entry.
- **N1 / 3.6.6 + alias inline (`a2666f2`).** Same, `getPropertyAlias` written
  inline. Scenarios as above + virtual-grid. Framework bytes/op vs fixes:
  1897 → 1915, 8565 → 8596, 1970 → 1951, 10160 → 10179 (neutral). Time B/C
  0.94–1.33 (noise). Profile, C, shared accessor self time µs/op vs fixes:
  virtual-grid 126 → 0, text-virtual-row 81 → 0, virtual-row 19 → 0,
  portal-focus-text 18 → 0. Isolated (real v2 handles, unthrottled),
  `npx vitest run --config=bench/micro/vitest.config.ts --reporter=verbose`
  (`bench/micro/accessors.test.tsx`, best of 15; six runs per version, the
  `elementNode.ts` of `d342c37` vs `a2666f2`/`3bbe034`): 1.6 M reads
  15.9–16.3 → 1.00–1.20 ms, 400 k writes 14.7–15.5 → 1.40–1.60 ms. Bundle
  20 967 → 21 731 B gzip (+764). **Kept pending the Checkpoint 2 series:**
  allocations are neutral and scenario time could not resolve it from the
  noise; revert `a2666f2` and `d33c789` if the series shows no win.
- **N2, B19 draw order and an allocation-free child list (`d5db836`,
  `f611469`).** Scenarios virtual-row, virtual-grid, poster-swap (alloc,
  count; C before = `71fb38b`, C after = `f611469`; B frozen; renderer
  `6392ce4`).
  - Framework B/op: virtual-row 8570 → 8511, virtual-grid 11412 → 11116,
    poster-swap 13776 → 13555. The `spliceItem` sites (121, 401, 440 B/op) are
    gone.
  - Node writes/op: 26.15 → 24.8 and 179.0 → 171.1. The removed `parent`
    writes became `insertBefore` calls, which the probe does not count.
  - Flex passes and drawn frames are unchanged.
  - Kept (bug fix plus child-list cost).

### 2026-10-03: Stream R (renderer: `measure()`, text-keyed cache, `insertBefore`)

- **R1, `TextNode.measure()`.**
  - Unit evidence: layouts in the walk after `measure()` 0, `updateIterations`
    1, `loaded` once for a listener, text under culled parents sized.
  - Solid scenarios: not measured here; stream T wires it in. The expected
    numbers are text-flex-alternatives §2.2's prototype: details panel walks
    2 → 1, `loaded` 6 → 0, layouts in the walk 6 → 0.
  - Kept.
- **R2, text-keyed `LayoutCache`.**
  - Renderer micro-benchmark, per hit:
    - title 0.386-0.427 µs / 845 B → 0.016-0.017 µs / 0 B;
    - description 0.767-0.833 µs / 1121 B → 0.016-0.018 µs / 0 B;
    - newly built text string 0.410 → 0.120 µs.
  - Miss path unchanged within noise (+96 B per insert).
  - Kept.
- **R3, typed-array width tables in the line breaker.** Held back, not
  integrated.
  - Renderer micro-benchmark, line breaking: title 0.665-0.709 → 0.210-0.224 µs
    (3.1×); description 7.34-7.54 → 3.36-4.25 µs (1.8-2.2×).
  - `layoutText`: title 1.69-1.77 → 1.30-1.32 µs; description 16.2-17.8 →
    13.6-14.4 µs.
  - Parity: 17,100 cases, plus 6,840 whole layouts, bit-identical.
  - Bundle +1,076 / +516 B: with R1-R4 the renderer is 171,955 / 54,373 B
    against CI's 172,032 / 54,272 B ceiling, 101 B gzip over; without R3
    170,881 / 53,844 B.
  - Kept in the renderer's history as `770c80f`, reverted pending the user's
    bundle-budget decision at Checkpoint 2.
- **R4, public `insertBefore`.**
  - Draw order follows the insertion order (unit test on emitted quads).
  - The Solid draw-order fix and its scenarios are stream N's (N2 above).
  - Bundle +540 / +206 B.
  - Kept.
- Numbers are desktop Node/V8; TV hardware was not measured.

### 2026-10-03: Stream B (page-creation baseline)

- New scenarios page-mount and page-swap: a Browse-like page, a Column of 7
  Rows x 20 Poster tiles (poster.tsx's tile + subtitle + badge), 582 nodes,
  5893 creation props, text: true. Arms A, B, C (C = B, `src` unchanged since
  `44e2b76`), 6x, time 3 runs, alloc and count 1 run, in
  `results/2026-10-03/summary.md`.
- page-mount create (B → C, same code): total 11.26 → 12.92 ms (noise, B/C
  spread 14%); destroy 0.95 → 1.22 ms; alloc (mean over the create and destroy
  ops) 332.5 → 332.5 KiB/op (framework 109.2 → 108.8, renderer 94.9 → 95.8).
  A: create 14.55 ms, 959.5 KiB/op (renderer 721). The scenario puts 78% of its
  texts out of bounds, so it over-weights decision 5.2's eager-layout cost
  relative to real routes (Virtual).
- page-swap (B → C): total 12.32 → 12.21 ms; alloc 688.4 → 689.9 KiB/op
  (framework 207.8 → 207.8, reactivity 131.4, user 121.4); A: 14.64 ms,
  1893 KiB/op. Counts per swap: 8 flex passes, 156 node writes, 4 shader
  writes, 582 created, 12.6 drawn frames, 63 text layouts (all cache hits).
- Per-route timing: `bench/demo/route-times.mjs`,
  `results/routes-2026-10-03.md`. Sum over 51 routes, main-thread busy ms:
  A 3289, B 3163, C 3162 (settle 17273 / 17664 / 17600, timer-dominated).
- Kept: these are the baselines the Phase 2 changes are measured against.

### 2026-10-03: Bench fix (count mode on renderer v2's text path)

- Not a Solid change. Two causes: the cache hook forwarded only its first
  argument, so `LayoutCache.get(font, props)` threw inside renderer v2's frame
  loop, which swallowed it (arm C text scenarios drew nothing in count mode);
  and a worktree's symlinked `bench/.arms` built arm B (and A) without chunks
  and without the flex hook. Fixed in `cc75282` and `f348e6c` (`adbbbc8` for the
  review round): hooks forward `arguments`, count `TextNodes.lay`, count
  `insertBefore` as a node write, report `n/a` for a hook that found nothing,
  and fail the run on a hook error.
- Scenarios text-details-panel and text-flex-mount-same, count mode. C before →
  after (full op counts): text-details-panel flex passes 0.0 → 7.0, writes /
  in frames 10.0 / 0.0 → 54.4 / 44.4, walks per drawn frame n/a → 2.00, drawn
  frames 0.0 → 1.0, loaded text emitted / heard 0.0 / 0.0 → 5.0 / 5.0, text
  layout calls 0.0 → 7.0 (hit rate n/a → 1.00); text-flex-mount-same flex
  passes 21.0 (handler only) → 42.0, writes / in frames 21.0 / 0.0 → 91.0 /
  70.0, loaded 0.0 / 0.0 → 20.0 / 20.0, text layout calls 0.0 → 20.0.
- B before → after: flex passes n/a → 7.0 (text-details-panel), 42.0
  (text-flex-mount-same), 0.0 (rows-lr-noshift). After the fix B and C are
  identical on every count that does not depend on time (text-details-panel
  7.0 flex, 54.4 writes, 2.00 walks per drawn frame, 5 / 5 loaded, 7.0 text
  layouts; text-virtual-row 4.2 flex, 29.7 writes), and arm A matches the
  2026-10-03 baseline.
- Kept. Earlier by-owner B splits from worktree runs (framework 0.00,
  renderer 0.00) are not valid; re-measure them in the Checkpoint 2 series.
