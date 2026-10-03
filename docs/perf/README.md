# Performance measurement: methodology

How `npm run bench` measures the CPU cost of SolidTV on the three benchmark
arms, what each number means, and how the numbers map to the metrics of the
1.7 brief (`docs/superpowers/specs/2026-10-03-solid-1.7-rewrite-brief.md`,
Priorities and Phase 0).

## Running it

```sh
npm run bench                                   # every scenario, A,B,C, 3 runs, all modes
npm run bench -- --scenarios thumbnail-focus --runs 5 --modes time
npm run bench -- --scenarios smoke --runs 1 --quick   # harness smoke test
node bench/run.mjs --summarize docs/perf/results/2026-10-03   # rebuild summary.md only
```

| Option               | Default                    | Meaning                                                                                           |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `--arms`             | `A,B,C`                    | Arms to run, interleaved within each run set (A, B, C, A, B, C, …)                                |
| `--scenarios`        | every scenario but `smoke` | Scenario ids (`bench/src/scenarios`)                                                              |
| `--runs`             | 3                          | Page loads per scenario, arm and mode                                                             |
| `--modes`            | `time,alloc,profile,count` | Measurement modes; each is its own page load                                                      |
| `--throttle`         | 6                          | CDP `Emulation.setCPUThrottlingRate`                                                              |
| `--quick`            | off                        | At most 5 warmup and 10 measured ops: for checking the harness, not for numbers                   |
| `--skip-build`       | off                        | Use the existing `bench/dist`                                                                     |
| `--out`              | `docs/perf/results/<date>` | Result directory                                                                                  |
| `--gpu`              | `metal` on macOS           | `metal`, `swiftshader` or `default` (ANGLE's choice)                                              |
| `--flex`             | `new`                      | `new`: `src/core/flexLayout.ts`, as the demo app; `old`: `src/core/flex.ts` (labelled `-flexold`) |
| `--no-chunks`        | off                        | Single-chunk build (labelled `-nochunks`): to check that chunking does not move timings           |
| `--alloc-interval`   | 1                          | Heap sampling interval in bytes (1: every allocation)                                             |
| `--profile-interval` | 50                         | CPU profiler sampling interval in µs                                                              |
| `--idle-timeout`     | 10000                      | ms to wait for an op to settle before marking it `timedOut`                                       |

Each run writes `<out>/<scenario>.<arm>.<mode>.<run>.json` (every op's raw
record plus the run's statistics and environment), and the runner then
regenerates `<out>/summary.md` from **every** result file in `<out>`. Runs
whose page threw are kept as JSON (`errors`) and left out of the summary.

Run the measured series on a quiet machine: the summary records the
1-minute load average at the start of each run.

## Arms and builds

| Arm | Solid                                    | Renderer                    |
| --- | ---------------------------------------- | --------------------------- |
| A   | 1.6.4 (`71c170f`)                        | npm 1.9.3                   |
| B   | 1.6.4 + renderer v2 lockstep (`f1c8ab0`) | v2 `faf4b9f`                |
| C   | this working tree (`src/`)               | `../renderer-v2-solid` dist |

`bench/prepare-arms.mjs` prepares them under `bench/.arms`;
`bench/vite.config.ts` builds one arm (`BENCH_ARM=A|B|C`): Solid compiled from
the arm's source, the renderer from its `dist`, terser without mangling,
`chrome64` target, as the demo app's modern bundle. The runner rebuilds every
arm it runs unless `--skip-build`, and records the arm's source revisions
(`source` in each JSON; C is marked `+dirty` when `src/` has uncommitted
changes). While C is unchanged, **B and C are the same code**, so B/C is the
in-session noise floor.

**Flex.** solid-demo-app sets `VITE_USE_NEW_FLEX=true`, so apps run
`src/core/flexLayout.ts`. Every arm is built that way by default (the define
`import.meta.env.VITE_USE_NEW_FLEX = 'true'` folds the choice at build time;
the bundle contains only `flexLayout`'s code). `--flex old` builds `flex.ts`
into `dist/<arm>-flexold`. Each result records `flex`, and the page reports
the flex it was built with; the runner refuses a mismatch.

**Chunks.** The bundle is split into four fixed-name chunks, so that a
profiler sample or an allocation is charged to its owner by script URL:

| Chunk           | Contents                                                      |
| --------------- | ------------------------------------------------------------- |
| `framework.js`  | the arm's `@solidtv/solid` source and its `@solid-primitives` |
| `reactivity.js` | `solid-js`                                                    |
| `renderer.js`   | the arm's `@solidtv/renderer`                                 |
| `user.js`       | the entry: `bench/src` (main, arm bootstrap, scenarios)       |

The harness's own in-page code is injected as `bench-probe.js` and is
reported as `harness`, never as app cost. Cross-chunk calls go through ES
module imports instead of scope-hoisted locals; `--no-chunks` builds the
single-chunk variant to check that this does not move timings (see "Noise"
below).

## The browser

- **Chromium 141** (Playwright 1.56, `channel: 'chromium'`: the full browser in
  new headless mode), one fresh browser per run, viewport 1920×1080 at device
  scale 1 (the app's size, so the canvas is 1:1).
- **Hardware GPU.** On this Mac, headless Chromium can use the GPU through
  ANGLE's Metal backend (`--use-angle=metal`): the WebGL renderer string is
  `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`. The default headless
  shell uses SwiftShader, software GL that burns CPU in the GPU process and
  competes with the page for cores. The hardware GPU is used; each result
  records the renderer string, and the runner warns on SwiftShader. On a TV
  the GL calls are what costs CPU (renderer CLAUDE.md, cost model): those are
  serialized into the command buffer on the page's main thread, inside the
  timed frame, whatever the GPU.
- **Cross-origin isolation.** The runner's static server sends
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`, so `crossOriginIsolated` is
  true and `performance.now()` has a 5 µs resolution (100 µs otherwise). Each
  result records the measured resolution (`env.clockResolutionUs`, 5.0 µs
  here); the runner warns when it is coarser.
- `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`
  and `--disable-backgrounding-occluded-windows` keep headless timers honest.
- Headless Chromium runs `requestAnimationFrame` at 120 Hz on this machine.
  Renderer v2 caps at its target frame rate, so every other callback is an
  undrawn tick (counted as `undrawnCpu`, a few µs).

### CPU throttling is a duty cycle

`Emulation.setCPUThrottlingRate` (6x by default, the brief's TV proxy) does not
slow the main thread evenly: it lets it run for about 0.17 ms, then suspends
it for about 0.85 ms (measured here at 6x: 16% of wall time running). An
interval much shorter than a millisecond therefore reads either unthrottled or
about one suspension longer, depending on where it fell. Two consequences:

- the **median** of sub-millisecond intervals is close to the unthrottled
  time, and says little about the throttled cost;
- the **mean** is an unbiased estimate of rate × CPU time, with a per-op
  spread of up to ±0.43 ms that averages down over many ops.

So every time in the summary is a per-run **mean over ops** (means also add
up: `total` = handler + tail + frame). The JSON keeps median, p95, min and
max per field. Use `--throttle 1` for an unthrottled run when you need
precise sub-millisecond medians (for example to profile a single function);
report throttled means as the result.

## The scenario contract

`bench/src/scenario.ts`. A scenario is an `App` plus `step(i)`: a key name
(dispatched by the runner as a keydown, keyup pair on `document`) or `null`
(the step did its work itself: node creation, a state toggle, a text change).
`warmup` (default 30) and `measured` (default 60) ops per page load. Optional:
`ready()` (default: the scene is mounted when no frame has been drawn for
300 ms after the fonts load), `probe()` (a JSON state snapshot) and
`opKind(i)` (a label per op; the summary adds one row per kind, so an
alternating create/destroy workload is not reported as one bimodal number).

## One operation (all modes)

`bench/harness/probe.mjs` is injected before the app's first script. It wraps
`requestAnimationFrame` (each callback timed with `performance.now()` into
preallocated typed arrays; a callback that ran `gl.clear` drew a frame, and
both renderer majors clear once per drawn frame) and listens for the
renderer's `idle` event (both majors emit it). For each op:

1. **Alignment.** The op starts in a task right after a rendering step (a rAF,
   then a `MessageChannel` message), so the next frame is a full vsync away.
2. **`handler`.** `step(i)` runs; a key name returned is dispatched as a
   `KeyboardEvent` on `document`, and only `dispatchEvent` is timed. A non-key
   step is timed as a whole.
3. **`tail`.** From the handler's end to the start of the first task after
   the microtask checkpoint: a `MessageChannel` message posted at the handler's
   end. This catches microtasks that queue more microtasks (Solid's
   post-mutation pass, queued renderer work), which the demo app's
   `queueMicrotask` bracket (`#/benchmark`) misses. If a frame runs before the
   message, the tail ends where that frame starts (`tailCut` in the op record).
4. **`frame`.** The CPU time (callback duration) of the first drawn renderer
   frame after the op: the frame that shows the result. It includes what the
   framework does inside the frame (Solid's flex on text `loaded`, and on
   renderer v2 the `idle` listeners, which v2 emits inside the last drawn
   frame). `total` = handler + tail + frame: the brief's "keydown dispatch to
   the end of the renderer frame that shows the result".
5. **Frames until idle.** Every later callback until the renderer's `idle`
   event: `frames` (drawn), `animCpu` (drawn frames after the first:
   transitions), `undrawnCpu` (renderer callbacks that drew nothing: v1's idle
   polls, v2's capped ticks and upload-only frames), `otherRaf` (callbacks that
   are not the renderer's). `cpu` = handler + tail + all of those.
   `settle` = wall time from the op's start to the end of its last drawn frame.
   `frameDelay` = from the tail's end to the first frame's start.
6. **Idle.** The op is over at the renderer's `idle` event followed by 50 ms
   with no drawn frame (Solid's idle tasks and late image uploads can draw
   again: then it waits for the next `idle`), or after 50 ms with no drawn
   frame at all (an op that changes nothing draws nothing, and no `idle`
   follows), or after `--idle-timeout` (`timedOut`).
7. **Keyup.** Sent only once the op is idle, so it never lands in the op's
   frames; its handler is timed as `keyup`, and the probe waits for idle again
   (`keyupFrames`) before the next op.

Work outside the handler, the microtask tail and rAF callbacks (timers, image
decode callbacks, the renderers' idle maintenance) is not in the time-mode
numbers; the profile mode sees it.

## Modes

Each mode is a separate page load, so instrumentation never touches the
timings. The warmup ops run first in every mode; only the measured ops are
recorded.

### `time`

The op records above. No instrumentation beyond the rAF wrap and the
`gl.clear` counter (one wrapped call per drawn frame), the same in every arm.

### `alloc`: bytes per op

As the renderer's `test/allocations.ts` and `visual-regression/src/alloc-probe.ts`:
CDP `HeapProfiler.startSampling` around the measured ops with
`includeObjectsCollectedByMajorGC` and `…MinorGC` (objects that die young
count), sampling interval 1 byte by default (every allocation). Each node's
bytes are charged to the innermost frame with a script URL on its stack
(builtins have none), and that frame's chunk names the owner:

- `framework`, `reactivity`, `renderer`, `user`: the app; `total` is their sum;
- `harness`: the probe (op loop, `KeyboardEvent`s), reported, not counted;
- `no script`: allocations with no script on the stack (Blink's own objects,
  mostly the harness's `MessageEvent`s), reported, not counted.

V8 charges a callee it inlined to the function it was inlined into, so a
renderer function inlined into a framework function counts as framework (the
renderer's probe has the same caveat). The JSON lists the top 30 allocating
functions (`function (chunk:line)`, bytes per op; line numbers are of the
beautified bundle in `bench/dist/<arm>/assets`). The brief's goal of zero
framework allocations in the steady state reads off the `framework` column.

### `profile`: self time

CDP `Profiler` at a 50 µs sampling interval over the measured ops. Self time
per function (`function (chunk:line)`) and per chunk, per op; a native
function (a WebGL call, a builtin) is charged to its nearest caller's chunk
and named `fn [native] (chunk)`. `(program)` and `(garbage collector)` are
kept as their own buckets, `(idle)` is dropped. Under throttling the
suspended time lands on whatever was on the stack, so self times are in
throttled ms, like the time mode. The window includes everything between the
ops too: for example both renderers' idle-maintenance `gl.getError()` (the
out-of-memory probe), which shows up as `getError [native] (renderer)`.

### `count` (instrumented build, its timings are not reported)

Built separately (`BENCH_INSTRUMENT=1` into `dist/<arm>-count`). Per op:

| Count                    | Hook                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| flex passes              | Build time: the default export of the arm's `src/core/flex.ts` and `flexLayout.ts` is wrapped (`bench/vite.config.ts`, `countFlexPasses`); one call is one container laid out. `n/a` if the hook did not install.                                            |
| node writes              | Runtime: every configurable setter on the renderer node prototypes (from `renderer.root`, and every node `createNode`/`createTextNode` returns) is wrapped. Per-prop counts in `topWrites.node`.                                                             |
| shader writes            | Runtime: each shader node's `props` (v1: per-node own accessors; v2: a facade with non-configurable prototype accessors) is swapped for a counting forwarder, at `createShader` and for existing nodes.                                                      |
| in frames                | The writes of both kinds made inside rAF callbacks: renderer v1 steps animations through the node setters, v2 writes its arrays directly, so compare the writes outside frames across majors.                                                                |
| animations               | Calls of `animate`/`animateProp` on node prototypes.                                                                                                                                                                                                         |
| walks per drawn frame    | v2: `renderer.scene.run` (one `ScenePass.run` per walk; `RendererCore.update` walks up to 3 times). v1: iterations of `Stage.drawFrame`'s update loop (counted through reads of `stage.reprocessFrame`).                                                     |
| loaded (text / other)    | `emit('loaded', …)` on nodes that have a `loaded` listener (both majors keep listeners in `eventListeners`); text when the payload's `type` is `'text'`.                                                                                                     |
| text layout calls and ms | v2: `renderer.textNodes.layoutText` (every visit of a text node with `DIRTY_LAYOUT`, cache lookup included). v1: `stage.textRenderers.sdf.renderText` (cache lookup and layout). Timed in the instrumented build.                                            |
| layout cache hit rate    | v2: `renderer.textNodes.cache.get` hits over lookups. v1: `renderText` returning a layout object it returned before (a hit) or a new one (a miss); layouts made before the counters were installed count as a miss on first sight, which the warmup absorbs. |
| frames to final layout   | The index (1 = the first drawn frame, 0 = during the handler or tail) of the last renderer frame in which a flex pass, a text layout or a text `loaded` happened; `ms to final layout` is from the op's start to that frame's end (instrumented timing).     |

Hook points by arm: arms A and B are frozen, so their hooks are exact. Arm C
will change: every hook is looked up by name at runtime and reports what it
found (`hooks` in the count JSON: `walkHook`, `textHook`, `cacheHook`,
`nodeAccessors`, `flexHooks`); a hook that no longer matches reports `n/a`
rather than a wrong number. If C's rewrite moves one of these points, prefer
a small opt-in probe hook in C's source over guessing.

## Noise

- **In-session control:** B and C are the same code; their ratio in the
  summary is the noise floor of that series. A difference between A and B (or
  later B and C) smaller than the B/C spread is not a result.
- **The brief's rule:** a "faster" claim needs n ≥ 3 runs that beat the noise
  floor. Use more runs (`--runs 5`) for effects near it.
- **Throttling** adds up to ±0.43 ms per op (above); means over 60 ops reduce
  it to roughly ±0.05 ms per run.
- **Machine load** shows directly in the numbers: other processes take the
  cores the GPU process and the compositor need. The summary prints the load
  average range; measure on a quiet machine.
- **Chunking check:** see the results of `--no-chunks` in the smoke notes of
  the first series (a single-chunk build of B against the chunked one).

## How the numbers map to the brief

| Brief metric (Phase 0)                     | Where                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------- |
| JS time per press: handler, tail, frame    | time mode: `handler`, `tail`, `frame`, `total` (and `cpu` until idle) |
| bytes allocated per press                  | alloc mode: `total`, split framework / reactivity / renderer / user   |
| flex passes per press                      | count mode: `flex passes`                                             |
| renderer writes per press                  | count mode: `node writes`, `shader writes` (`in frames` part)         |
| walks per frame (text)                     | count mode: `walks/drawn frame`                                       |
| `loaded` events per press (text)           | count mode: `loaded (text)`                                           |
| time spent measuring text                  | count mode: `text layout ms` (instrumented)                           |
| layout cache hit rate                      | count mode: `layout cache hit rate`                                   |
| time from setting the text to final layout | count mode: `frames to final layout`, `ms to final layout`            |
| where the time goes                        | profile mode: self time per chunk, top 20 functions                   |

The demo app's own `#/benchmark` (Phase 0 step 3) and the on-device method
are in `solid-demo-app/BENCHMARKING.md`; this harness is the in-browser,
per-scenario complement, not the TV gate.
