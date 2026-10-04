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

### 2026-10-03: Stream T (flex text measured with `TextNode.measure()`)

Arm C ran on renderer `renderer-v2-solid` as linked (R1 and R2 merged). "C
before → after" is the worktree at `6552a03` (post-N) and at the T commit.
Runs `bench-T-before` and `bench-T-after`: arms B,C, count, alloc and time, 1
run at 6x. The after run ran under heavier load than the before run (arm B
itself was 2-4x slower), so only C/B within one run says anything about time.

- **T1, Solid measures flex text with `TextNode.measure()` before the frame
  (`bcf31d2`).**
  - What changed:
    - A `<text>` whose parent lays out (`display="flex"` or an `onLayout`)
      is measured in the post-mutation pass, before the parent's flex and
      before the frame. No persistent `loaded` listener; the parent is queued
      only when the measured size changed.
    - Texts that flex sized (`flexGrow`, `flexShrink`, `minWidth`) are
      measured again after each sweep, capped at 16 sweeps.
    - A text whose font is missing waits on one shared listener and on
      `loadFonts()`'s promise, then lays out once.
    - Text under culled or alpha-0 ancestors is laid out at mount (decision
      5.2).
    - Per-text state is one `TextMeasure` record, made when a text is first
      queued or measured.
  - Scenarios: text-details-panel, text-flex-mount-same, text-flex-mount-new,
    text-virtual-row, page-mount, page-swap.
  - Count mode, per op, C before → after (arm B in brackets):

    | scenario             | flex passes        | walks / drawn frame | `loaded` text emitted / heard | text layout calls | layout cache hit rate | frames to final layout | node writes\*      |
    | -------------------- | ------------------ | ------------------- | ----------------------------- | ----------------- | --------------------- | ---------------------- | ------------------ |
    | text-details-panel   | 3.0 → 3.0 [7.0]    | 2.00 → 1.00 [2.00]  | 5/5 → 0/0 [5/5]               | 7.0 → 7.0         | 1.00 → 1.00           | 1.0 → 1.0              | 10.0 → 15.0 [54.4] |
    | text-flex-mount-same | 32.0 → 21.0 [42.0] | 2.00 → 1.00         | 20/20 → 0/0                   | 20 → 40           | 1.00 → 1.00           | 1.0 → 0.0              | 21.0 → 82.0 [91.0] |
    | text-flex-mount-new  | 32.0 → 21.0 [42.0] | 2.00 → 1.00         | 20/20 → 0/0                   | 20 → 40           | 0.00 → 0.00           | 1.0 → 0.0              | 21.0 → 82.0 [91.0] |
    | text-virtual-row     | 2.3 → 1.9 [4.2]    | 1.03 → 1.00 [1.03]  | 1.9/1.9 → 0/0                 | 1.9 → 1.9         | 1.00 → 1.00           | 1.0 → 0.0              | 14.7 → 15.5 [29.7] |
    | page-mount           | 4.0 → 4.0          | 1.00 → 1.00         | 0/0 → 0/0                     | 31.5 → 31.5       | 1.00 → 1.00           | 1.0 → 1.0              | 74.0 → 74.0        |
    | page-swap            | 8.0 → 8.0          | 1.00 → 1.00         | 0/0 → 0/0                     | 63.0 → 63.0       | 1.00 → 1.00           | 1.0 → 1.0              | 149.0 → 149.0      |
    - Targets: walks 1, `loaded` heard 0, flex passes 21 for a mount and 3 for
      the details panel (target 4): met.
    - Text layouts double in the mounts (20 → 40): the 20 culled tiles' texts
      are now laid out at mount (5.2), all cache misses in -new.
    - Frames to final layout 0.0: the final layout is in place before the
      op's first frame, computed in the microtask.
    - \*Node writes rose because they are now all counted, not because more
      are made. The probe skips writes made with renderer code on the stack,
      and before T1 the flex that a `loaded` triggered ran inside the frame
      (stream L's footnote). Arm B shows the same from the other side: 91
      writes, 70 of them in frames. Details panel: 15.0 is L1's comparable
      figure.
    - page-mount and page-swap do not exercise the change: their tile texts
      sit in plain views, so Solid measures none of the 287 texts.

  - Allocation, KiB/op, C before → after:

    | scenario             | total           | framework       | renderer        | user            |
    | -------------------- | --------------- | --------------- | --------------- | --------------- |
    | text-details-panel   | 8.35 → 8.57     | 2.74 → 2.50     | 3.69 → 4.12     | 0 → 0           |
    | text-flex-mount-same | 77.97 → 69.21   | 27.30 → 20.39   | 15.44 → 13.26   | 17.33 → 17.64   |
    | text-flex-mount-new  | 112.05 → 188.07 | 27.02 → 20.56   | 49.78 → 131.95  | 17.33 → 17.64   |
    | text-virtual-row     | 27.92 → 31.41   | 3.74 → 3.37     | 21.57 → 25.43   | 0 → 0           |
    | page-mount           | 339.07 → 319.46 | 103.04 → 101.89 | 98.38 → 78.79   | 71.73 → 72.76   |
    | page-swap            | 670.63 → 672.42 | 197.18 → 197.51 | 201.21 → 200.26 | 141.11 → 143.29 |
    - Framework: the per-text `_layoutOnLoad` closures are gone, -6.9 KiB/op
      on each mount, and the `_layoutOnLoad` site (7,040 B/op) left the top 5.
    - text-flex-mount-new renderer is up because the culled tiles' texts are
      laid out at mount, every one a miss (5.2). The figure is noisy: the same
      code measured 145.01 KiB at `969b7d8` and 49.78 at `6552a03`. The other
      renderer movements are sampling noise at 1 run; in the details panel
      the top renderer sites are the walk's `emit` and the visit's transform
      IIFE, not text.

  - Time, ms per op, B / C: rough.

    | scenario             | C/B before | C/B after | before B / C   | after B / C     |
    | -------------------- | ---------- | --------- | -------------- | --------------- |
    | text-details-panel   | 1.14       | 0.98      | 0.248 / 0.283  | 1.116 / 1.095   |
    | text-flex-mount-new  | 0.81       | 0.65      | 1.797 / 1.456  | 3.448 / 2.250   |
    | text-flex-mount-same | 0.88       | 0.80      | 0.778 / 0.688  | 1.870 / 1.492   |
    | text-virtual-row     | 0.90       | 0.74      | 0.432 / 0.387  | 1.172 / 0.870   |
    | page-mount           | 1.06       | 0.94      | 5.032 / 5.341  | 7.248 / 6.808   |
    | page-swap            | 0.93       | 0.86      | 10.056 / 9.340 | 12.118 / 10.455 |
    - text-details-panel's frame part went from C/B 0.80 to 0.32: the second
      walk is gone. The tail grew, because the measure moved into the
      microtask.

  - **Kept.**

- **T1 variant, dropped: measurement state in four `ElementNode` fields.**
  - V8 boxes double fields at construction, about 32 B on every node and every
    view. page-mount framework + user +9.4 KiB/op, page-swap +23.4 KiB/op
    (`bench-T-after-fields-partial`): framework 108.12 and user 76.04, and
    211.74 and 149.97, against 101.89 and 197.51 with the record.
  - Replaced by the per-text `TextMeasure` record before the commit.
- **T1 fix round 1 (`f2c8bf8`, `f298320`, `9d8716a`).**
  - What changed:
    - DOM `loaded` against the last size told.
    - A text's layout transition or `animate()` relays out its container
      (1.6's result), through one shared listener.
    - Queue throw-safety; dropping the remaining texts at the sweep cap (it
      had started over in a microtask loop that hung the page).
    - `contain` marks a text dirty.
    - A DOM late re-measure listener; a sweep of the font-waiting list.
  - Scenarios: the six above, arm C, count and alloc (`bench-T-fix1`).
  - Counts identical to `bcf31d2`: flex passes 3.0 / 21.0 / 21.0 / 1.9 / 4.0 /
    8.0, walks 1.00 everywhere, `loaded` 0 / 0, text layouts 7 / 40 / 40 / 1.9
    / 31.5 / 63. Framework KiB/op 2.49 / 21.09 / 20.55 / 3.37 / 102.92 /
    196.05 (details panel, mount-same, mount-new, virtual-row, page-mount,
    page-swap), within noise of `bcf31d2`. No scenario animates a text's
    layout props, so the new path costs nothing here.
  - Deferred to the renderer: two `loaded` events for one text, the first
    with stale dimensions, when it is measured in two post-mutation runs
    before one frame (renderer proposal P5).
  - **Kept.**
- **T1 fix round 2 (`f51c63c`, `44a15a3`).**
  - What changed: no sweep of the font-waiting list while it is being
    measured; a text Solid animated through the element keeps one `loaded`
    listener for its lifetime (the module list and the controller tracking
    are gone); DOM `destroyed` is true for the descendants of a destroyed
    node.
  - Scenarios: the six above, arm C, count mode (`bench-T-fix2`). Counts
    unchanged from round 1; no scenario animates a text's layout props.
  - Accepted allocation: because of that listener, renderer v2's
    `TextNodes.lay()` allocates the `loaded` payload (2 objects) on each later
    layout of such a text. That is per text change, with no extra walk, and
    only for texts animated through the element. Production WebGL builds do
    not allocate it for any other text; development builds, which carry a
    warning listener on every measured text, and the DOM renderer, which
    carries a `loaded` listener on every measured text, queue `loaded` for
    each layout.
  - **Kept.**
- **T1 fix round 3 (`5a47510`).** Tests only: the font-waiting cases moved to
  `tests/fontWaiting.test.ts`, each in a fresh module instance. No measured
  change.

#### Open item: layout cache size (`textLayoutCacheSize`), for the user

Eager measuring (5.2) is kept. The default (250) is unchanged in code and in
the docs; nothing here sets a new value.

- **Experiment, not committed.** `PageTile`'s view gets a no-op `onLayout`, so
  every tile text (title and meta) is measured: 283 texts per page. Count
  mode, 1 run at 6x. Arm B, which has no eager measuring, makes 31.5
  (page-mount) and 63.0 (page-swap) text layouts per op at hit rate 1.00 and
  0.270 / 0.266 ms per op. Arm C makes 141.5 and 283.0 layouts per op, the
  approved cost of 5.2, at:

  | `textLayoutCacheSize` | run                                    | page-mount hit rate | page-swap hit rate | page-mount layout ms/op | page-swap layout ms/op |
  | --------------------- | -------------------------------------- | ------------------- | ------------------ | ----------------------- | ---------------------- |
  | 250 (default)         | `bench-T-pagetiles-measured`           | 0.00                | 0.01               | 2.350                   | 5.043                  |
  | 512                   | `bench-T-pagetiles-measured-cache512`  | 1.00                | 0.01               | 0.266                   | 5.131                  |
  | 1024                  | `bench-T-pagetiles-measured-cache1024` | 1.00                | 1.00               | 0.134                   | 0.217                  |

  Layout ms are from the count build, which is instrumented.

- **Why.** A page measures 283 strings, more than 250. An LRU scanned in a
  cycle longer than its size never hits, whatever its size. At 512 one page
  fits, so remounting the same page hits, but swapping between two pages
  cycles 566 distinct strings and thrashes as at 250. At 1024 both fit. A
  cache helps an app that cycles between screens only when it holds every
  string of the screens it cycles through.
- **Memory for a full cache**, estimated from
  `docs/perf/text-flex-alternatives.md` (about 1.5 kB per title layout and
  about 12.6 kB per description layout; not measured in this stream):

  | entries | all title-like (about 1.5 kB) | all description-like (about 12.6 kB) |
  | ------- | ----------------------------- | ------------------------------------ |
  | 250     | 0.37 MB                       | 3.1 MB                               |
  | 512     | 0.75 MB                       | 6.3 MB                               |
  | 1024    | 1.5 MB                        | 12.6 MB                              |

  The bench pages' texts are all title-like (titles and one-line meta), so
  283 entries are about 0.42 MB. A details page adds a few descriptions, about
  12.6 kB each.

- **Options raised, none taken.**
  - Raise the size when the app sets none. Solid could do it in
    `createRenderer` (`lightningInit.ts`) with no renderer change, or the
    renderer's default could change.
  - Measure only texts whose layout container is visible or in the margin.
    This needs a visibility read from the renderer, gives back part of 5.2
    (including the fix for a container whose visibility depends on its own
    text, `docs/perf/text-flex-alternatives.md` section 1.3), and keeps the
    second walk on scroll.
  - Renderer proposal P6: size the cache in bytes, or make it scan-resistant.
- Numbers are desktop Node/V8, from single runs; TV hardware was not measured.

### 2026-10-03: Stream S (compiled style plans, diffed state application, B18 shader-prop resets)

Arm C is the `1.7-styles` worktree from `44e2b76`; arm B is the frozen lockstep
port. Single 6x runs (alloc, count, time), profile 1-3 runs. Arm B's bundle
charges framework and renderer both to `user`, so B's framework share is the sum
of its sampled sites in the framework's line range of `user.js` (`toVec4`
excluded: renderer code bundled there). "S's sites" are the functions this
stream replaced. The framework bytes that remain in C are stream F's (the focus
manager, `States` `merge`/`add`/species construction), not S's.

- **S1: compiled style plans, diffed state application, shader-prop writes from
  cached parses, B18 resets (`c8ed9df`, with `d6d59af`).** Scenarios
  thumbnail-focus, navdrawer-toggle, rows-lr-noshift, portal-focus-text, arm B →
  arm C at `d6d59af`.
  - Allocation, KiB per op:

    | scenario          | B total | C total | B framework | C framework | S's sites on B | S's sites on C |
    | ----------------- | ------- | ------- | ----------- | ----------- | -------------- | -------------- |
    | thumbnail-focus   | 12.29   | 10.95   | 2.63        | 1.52        | 1.34           | 0              |
    | navdrawer-toggle  | 22.29   | 14.50   | 14.91       | 7.29        | 7.95           | 0              |
    | rows-lr-noshift   | 3.45    | 3.20    | 1.72        | 1.53        | 0.23           | 0              |
    | portal-focus-text | 25.93   | 25.77   | 1.58        | 1.67        | 0.21           | 0              |

    S's sites on B: thumbnail-focus `parseAndAssignShaderProps` 0.48, its
    `Object.entries`/`forEach` closure 0.63, `_stateChanged` 0.23;
    navdrawer-toggle `_stateChanged` 3.91, its closures 1.24, the
    `forwardStates` `slice()` (species `States` + `_super`) 2.80;
    rows-lr-noshift and portal-focus-text `_stateChanged` only. No S function is
    among C's sampled allocation sites in any scenario: state application and
    shader-prop writes allocate nothing per press.

  - Counts per op, B → C: node writes thumbnail-focus 0 → 0, navdrawer-toggle
    25.0 → 23.0, rows-lr-noshift 2.0 → 2.0, portal-focus-text 6.0 → 6.0; shader
    writes 6.2 → 8.2, 2.0 → 1.0, 0 → 0, 0 → 0; animations unchanged (2, 2, 0,
    3). Thumbnail-focus shader writes go up by the B18 resets on blur
    (`border-gap` 4 → 0 is a real change; `border-align` resolves to the value
    it holds, so the v2 facade drops it without a repack). Every other
    sub-prop there changes on each focus and blur, so the diff saves nothing in
    that scenario; it saves writes where focus and base share sub-prop values
    (navdrawer 2 → 1).
  - Inclusive CPU of `_stateChanged`, µs per op, B → C (each sample weighted by
    its run's median interval, because the sampler stalled 0.7-1.5 ms under
    load): thumbnail-focus 49.0 → 37.6 (1 run), navdrawer-toggle 98.4 → 73.8 (1
    run), rows-lr-noshift 13.8 → 12.1 (3 runs), portal-focus-text 14.2 → 11.4 (3
    runs). Inside thumbnail-focus: B's `parseAndAssignShaderProps` 14.8, C's
    `writeShaderValue` 12.5 (both include the renderer facade writes, which
    dominate).
  - Time, ms per press total, B → C: 0.648 → 0.653, 1.006 → 0.784, 0.535 →
    0.631, 0.632 → 0.681. Not evidence either way: arm B alone ranged 0.63-0.95
    on portal-focus-text across the day's runs.
  - Targets (design 6): framework bytes per press from state application → 0,
    met for S's part in all four scenarios. navdrawer-toggle ≤ 1 KiB framework:
    7.29, none of it S's (`States.merge` through `forwardStates` is 3.5 KiB/op,
    stream F's).
  - **Kept.**

- **Inline the single-use helpers terser turns into closures (`d6d59af`).**
  navdrawer-toggle alloc, 1 run: C framework 7.97 → 7.29 KiB/op (`set states`
  0.69 KiB/op → 0). With terser's default `reduce_funcs` a single-use helper
  becomes a closure per call; the demo app builds with it off, other apps may
  not. **Kept.**
- **Gradient accessors reuse their shader (`a395219`).** Not measured: no
  scenario sets a gradient twice. It removes a `createShader` (a shader, its
  facade, its values, a program-slot lookup) per set after the first. Behaviour
  checked against a fresh shader on renderer v2
  (`tests/webgl/shader-props.test.tsx`). **Kept.**
- **B18 fix rounds: base record, replay of the effective objects, targeted
  fixes (`7044c7f`, `4229c56`, `18e3b93`, `b891864`, `baea932`, `51daf91`,
  `9d5fffc`..`9ce36ee`, `f9aee19`..`e4ddeea`).** These change what a state undo
  writes, not the hot path's shape. Each round re-ran the alloc check on arm C
  (6x, 1 run), KiB per press, total (framework):

  | run                | source    | thumbnail-focus | navdrawer-toggle |
  | ------------------ | --------- | --------------- | ---------------- |
  | `bench-S-s1-final` | `d6d59af` | 10.95 (1.52)    | 14.50 (7.29)     |
  | `bench-S-fix1`     | `7044c7f` | n/a (1.51)      | n/a (7.30)       |
  | `bench-S-fix2`     | `4229c56` | 11.13 (1.52)    | 14.53 (7.29)     |
  | `bench-S-fix3b`    | `b891864` | 11.03 (1.51)    | 14.65 (7.27)     |
  | `bench-S-r4`       | `baea932` | 11.07 (1.53)    | 14.65 (7.30)     |
  | `bench-S-r5`       | `51daf91` | 10.97 (1.53)    | 14.66 (7.28)     |
  | `bench-S-pb`       | `9ce36ee` | 10.92 (1.53)    | 14.70 (7.28)     |
  | `bench-S-pb2`      | `e4ddeea` | 11.02 (1.52)    | 14.67 (7.28)     |

  Arm B in the `bench-S-r4` run: 12.41 and 22.19 total. Counts, re-checked in
  the first three rounds, stayed at 8.2 and 1.0 shader writes and 0 and 23 node
  writes per press. In every run no S
  function is among the sampled sites; the framework bytes are stream F's. Three
  times the check caught a terser closure in a single-use helper (fixed by
  inlining it or making it a method), and the bundle was checked for a `try`:
  - `18e3b93`: 64 B per thumbnail-focus press in the border accessor and 64 B
    in `writeShaderValue` (three round-3 helpers; framework 1.64), gone in
    `b891864` (1.51).
  - `baea932`: a single-use `borderOrder` inlined as a function expression in
    `writeShaderGroup`, 64 B per press (framework 1.59), fixed by reading the
    cache inline.
  - `9ce36ee`: the group write after a state change, left with one call site
    by the `_applyStates` split (`66630bd`), was a function expression in
    `_applyStates`' `finally` (1.59, navdrawer 7.30); as the method
    `_writeShaderGroups` it is 1.53 and 7.28.
    The grep for `(function(` and `!function(` misses the
    `0 !== mask && function(...) {...}(this, mask)` form.
  - The bundle's `_stateChanged` has no `try`: `66630bd` moved the
    `try`/`finally` that keeps the group write after a throwing setter into
    `_applyStates`, because `_stateChanged` runs for every element of every
    focus change and Crankshaft (the Chrome 47 floor) does not optimise a
    function with `try`/`finally`.
  - **Kept** (correctness: the undo equals a never-focused node, each case
    checked against the 1.6 export; the differences from 1.6 are listed in
    `MIGRATION-1.7.md`, B18).

## 2026-10-04: Checkpoint 2 series

Branch `1.7` at `8886583`, renderer `6392ce4`. Time for A, B, C in one
interleaved series (3 runs, 6x); alloc and count for C (count for B re-run
alongside); profiles for C on four scenarios. Results:
`docs/perf/results/2026-10-04/summary.md`, demo `#/benchmark` (A 0.52 / B 0.57
/ C 0.48 ms press mean) and `docs/perf/results/routes-2026-10-04.md`. The
per-scenario comparison against the design §6 targets, the allocation and
count tables, and the bundle sizes are in
`docs/superpowers/specs/2026-10-04-checkpoint-2-report.md`.

## 2026-10-04: B18 removed (user decision)

Branch `1.7-styles` at `249e4bc`, on `1.7` at `9b53edf`. Checkpoint 2 decided
that B18 (undoing a state's border or shadow should leave the node equal to a
never-focused one) goes back to 1.6.4 behaviour and is a known bug again; the
rest of stream S stays. Removed: the per-node base record and the group replay
(`ShaderBase`, `baseWrite`, `foldBase`, `replayGroup`, `writeShaderGroup`, the
`SHADER_BIT` masks, `_applyStates` with its try/finally, the radius-to-fresh
reset on the animated path, the per-type `ShaderTypeInfo`). A border or shadow
write merges its cached parse into the shader props, the later write winning,
and skips a sub-prop the props already hold; a state undo writes the fallback
object through the same setter, as 1.6 did.

- Alloc, framework B/op, Checkpoint 2 series → `bench-noB18` (one 6x run):
  thumbnail-focus 178 → 171, navdrawer-toggle 1,504 → 1,500, rows-lr-noshift
  260 → 260, portal-focus-text 310 → 303. The bundle's `_stateChanged`,
  `_writeStates` and the shader accessor hold no function expression (checked
  in `bench/dist/C/assets/framework.js`).
- Counts per press, unchanged but for the shader writes: navdrawer-toggle 23
  node writes and 1 shader write, portal-focus-text 6 and 0, rows-lr-noshift 2
  and 0; thumbnail-focus shader writes 6.0 → 5.2 (B 6.2): the `$focus`
  border's `gap` stays 4 after blur (B18) and is not written again on the next
  focus; `align` is (`'outside'` against the facade's resolved 1).
- Size: `elementNode.ts` minified+gzip 11,277 → 8,631 B (−2,646 B; the
  Checkpoint 2 figure of 11,268 came from another esbuild build); the bench
  framework chunk terser+mangled+gzip 22,106 → 19,695 B (−2,411 B). Stream S's
  +3.9 kB becomes about +1.3 kB by the same measure.
- Verification: the 83 reviewer probes of the S rounds against the 1.6.4
  export: 76 equal; RS4 differs in floating point mid-animation only; W1 and
  W2 make fewer facade writes with the same result; PG, PH, M1 and ST2 differ
  by design 3.3.2's diffed writes (a key whose resolved value did not change
  is not rewritten), described in MIGRATION §2. `npx vitest run` 722 passed,
  2 skipped (the B18 test is `it.skip('BUG: B18 …')` again), `pnpm test:webgl`
  60 passed, `pnpm tsc` and `pnpm lint` clean.
