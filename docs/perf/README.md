# Performance measurement: methodology

How `npm run bench` measures the CPU cost of SolidTV on its two benchmark
arms, and what each number means.

## Running it

```sh
npm run bench                                   # every scenario, arms A,C, 3 runs, all modes
npm run bench -- --scenarios thumbnail-focus --runs 5 --modes time
npm run bench -- --scenarios smoke --runs 1 --quick   # harness smoke test
node bench/run.mjs --summarize docs/perf/results/<date>   # rebuild summary.md only
node bench/harness/inclusive.mjs docs/perf/results/<date> # inclusive time (needs --save-profiles)
```

| Option               | Default                    | Meaning                                                                                                                                                              |
| -------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--arms`             | `A,C`                      | Arms to run, interleaved within each run set (A, C, A, C, …)                                                                                                         |
| `--scenarios`        | every scenario but `smoke` | Scenario ids (`bench/src/scenarios`)                                                                                                                                 |
| `--runs`             | 3                          | Page loads per scenario, arm and mode                                                                                                                                |
| `--modes`            | `time,alloc,profile,count` | Measurement modes; each is its own page load                                                                                                                         |
| `--throttle`         | 6                          | CDP `Emulation.setCPUThrottlingRate`                                                                                                                                 |
| `--quick`            | off                        | At most 5 warmup and 10 measured ops: for checking the harness, not for numbers                                                                                      |
| `--skip-build`       | off                        | Use the existing `bench/dist`. Count mode reads `dist/<arm>-count`, which only a count-mode run builds: after a source change, run count without `--skip-build` once |
| `--out`              | `docs/perf/results/<date>` | Result directory                                                                                                                                                     |
| `--gpu`              | `metal` on macOS           | `metal`, `swiftshader` or `default` (ANGLE's choice)                                                                                                                 |
| `--flex`             | `new`                      | `new`: `src/core/flexLayout.ts`, as the demo app; `old`: `src/core/flex.ts` (labelled `-flexold`)                                                                    |
| `--no-chunks`        | off                        | Single-chunk build (labelled `-nochunks`): to check that chunking does not move timings                                                                              |
| `--alloc-interval`   | 1                          | Heap sampling interval in bytes (1: every allocation)                                                                                                                |
| `--profile-interval` | 50                         | CPU profiler sampling interval in µs                                                                                                                                 |
| `--save-profiles`    | off                        | Also write each profile run's raw CPU profile as `<result>.cpuprofile` (DevTools format)                                                                             |
| `--idle-timeout`     | 10000                      | ms to wait for an op to settle before marking it `timedOut`                                                                                                          |

Each run writes `<out>/<scenario>.<arm>.<mode>.<run>.json` (every op's raw
record plus the run's statistics and environment), and the runner then
regenerates `<out>/summary.md` from **every** result file in `<out>`. The raw
JSON is large and gitignored, as are the `.cpuprofile` files; `summary.md` is
the part of a series to commit. Runs whose page threw are kept as JSON
(`errors`) and left out of the summary, and the runner exits 1.

`node bench/harness/inclusive.mjs <dir> [scenario …]` reads the raw profiles
that `--modes profile --save-profiles` writes and prints, per scenario and
arm, the inclusive time per op of a list of named Solid and renderer
functions (key dispatch, Row/Column navigation, flex, focus change, state
styles, node creation, the renderer frame).

Run the measured series on a quiet machine: the summary records the
1-minute load average at the start of each run.

## Arms and builds

| Arm | Solid                      | Renderer                                                       |
| --- | -------------------------- | -------------------------------------------------------------- |
| A   | 1.6.4 (`71c170f`)          | npm 1.9.3                                                      |
| C   | this working tree (`src/`) | the installed `@solidtv/renderer` (`node_modules`), its `dist` |

`bench/prepare-arms.mjs` prepares arm A under `bench/.arms` (a `git archive`
of the pinned commit, and `npm pack` of the pinned renderer); arm C is the
working tree and whatever `node_modules/@solidtv/renderer` resolves to (its
version is read from its `package.json` and recorded in each result).
`bench/vite.config.ts` builds one arm (`BENCH_ARM=A|C`): Solid compiled from
the arm's source, the renderer from its `dist`, terser without mangling,
`chrome64` target, as the demo app's modern bundle. The renderer bootstrap
(engines, shader registration) is `bench/src/arm-v1.ts`, picked by the
renderer's major version. The build uses the arms' real paths: the bundler's
module ids are real paths, so through a symlinked `bench/.arms` nothing would
match a chunk or the flex hook. The runner rebuilds every arm it runs unless
`--skip-build`, and records each arm's source (`source` in each JSON; C is
marked `+dirty` when `src/` has uncommitted changes).

While `src/` is unchanged from 1.6.4, **A and C run the same Solid code**, so
A/C (the ratios in the summary) is the in-session noise floor, plus whatever
differs between the two renderer versions: check `source.renderer` in the
results when the installed renderer is not 1.9.3. After a change to `src/`,
A/C is the change's effect (above 1: C is faster or allocates less).

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

- **Chromium** from Playwright (1.56, `channel: 'chromium'`: the full browser
  in new headless mode; `npx playwright install chromium` once), one fresh
  browser per run, viewport 1920×1080 at device scale 1 (the app's size, so
  the canvas is 1:1).
- **Hardware GPU.** On macOS, headless Chromium can use the GPU through
  ANGLE's Metal backend (`--use-angle=metal`, the default there): the WebGL
  renderer string then names the GPU (`ANGLE Metal Renderer: Apple M4 Pro`).
  The default headless shell uses SwiftShader, software GL that burns
  CPU in the GPU process and competes with the page for cores. Each result
  records the renderer string, and the runner warns on SwiftShader. On a TV
  the GL calls are what costs CPU: those are serialized into the command
  buffer on the page's main thread, inside the timed frame, whatever the GPU.
- **Cross-origin isolation.** The runner's static server sends
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`, so `crossOriginIsolated` is
  true and `performance.now()` has a 5 µs resolution (100 µs otherwise). Each
  result records the measured resolution (`env.clockResolutionUs`); the runner
  warns when it is coarser than 20 µs.
- `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`
  and `--disable-backgrounding-occluded-windows` keep headless timers honest.

### CPU throttling is a duty cycle

`Emulation.setCPUThrottlingRate` (6x by default, a TV proxy) does not slow the
main thread evenly: it lets it run for about 0.17 ms, then suspends it for
about 0.85 ms (measured at 6x: 16% of wall time running). An interval much
shorter than a millisecond therefore reads either unthrottled or about one
suspension longer, depending on where it fell. Two consequences:

- the **median** of sub-millisecond intervals is close to the unthrottled
  time, and says little about the throttled cost;
- the **mean** is an unbiased estimate of rate × CPU time, with a per-op
  spread of up to ±0.43 ms that averages down over many ops.

So every time in the summary is a per-run **mean over ops** (means also add
up: `total` = handler + tail + frame). The JSON keeps median, p95, min and
max per field. Report throttled means as the result.

**Do not use `--throttle 1` for comparisons on a Mac.** Unthrottled, the
page's main thread is idle most of the time, and macOS runs it on an
efficiency core or at a low clock: on an M4 Pro every op read about 5x
_slower_ at 1x than the median of the same op at 6x, and the factor moved
with the machine's load. At 6x the throttler keeps a core busy, so the slices
the page runs in are at full speed. Consequences:

- the 6x **mean** is the TV proxy (6 × full-speed CPU, tails included: GC
  pauses, deoptimisations);
- the 6x per-op **median**, pooled over runs, approximates the full-speed CPU
  of a typical op shorter than about 0.17 ms (at the clock's 5 µs
  resolution).

## The scenario contract

`bench/src/scenario.ts`. A scenario is an `App` plus `step(i)`: a key name
(dispatched by the runner as a keydown, keyup pair on `document`) or `null`
(the step did its work itself: node creation, a state toggle, a text change).
`warmup` (default 30) and `measured` (default 60) ops per page load. Optional:
`ready()` (default: the scene is mounted when no frame has been drawn for
300 ms after the fonts load), `cycle` (ops per cycle of the workload:
`--quick` rounds its op counts up to whole cycles, so warm-cache scenarios
stay warm), `probe()` (a JSON state snapshot: recorded after mount, after the
warmup and after the measured ops; the summary flags a run whose last two
snapshots differ, and a scenario whose final state differs between arms) and
`opKind(i)` (a label per op; the summary adds one row per kind, so an
alternating create/destroy workload is not reported as one bimodal number).
Scenarios use only the public `@solidtv/solid` API both arms share, never the
renderer directly.

The scenarios (`bench/src/scenarios`): `nav` (Row/Column presses with every
`scroll` mode, a `$focus` thumbnail row, VirtualRow and VirtualGrid windows,
a NavDrawer `states` toggle, `onFocusChanged` driving text colours, Poster
and whole-page mount and swap) and `text` (text in flex containers: mount,
text changes in a details panel, a VirtualRow of text tiles). `smoke` only
checks the harness.

## One operation (all modes)

`bench/harness/probe.mjs` is injected before the app's first script. It wraps
`requestAnimationFrame` (each callback timed with `performance.now()` into
preallocated typed arrays; a callback that ran `gl.clear` drew a frame: the
renderer clears once per drawn frame) and listens for the renderer's `idle`
event. For each op:

1. **Alignment.** The op starts in a task right after a rendering step (a rAF,
   then a `MessageChannel` message), so the next frame is a full vsync away.
2. **`handler`.** `step(i)` runs; a key name returned is dispatched as a
   `KeyboardEvent` on `document`, and only `dispatchEvent` is timed. A non-key
   step is timed as a whole.
3. **`tail`.** From the handler's end to the start of the first task after
   the microtask checkpoint: a `MessageChannel` message posted at the handler's
   end. This catches microtasks that queue more microtasks (Solid's
   post-mutation pass, queued renderer work). If a frame runs before the
   message, the tail ends where that frame starts (`tailCut` in the op
   record).
4. **`frame`.** The CPU time (callback duration) of the first drawn renderer
   frame after the op: the frame that shows the result. It includes what the
   framework does inside the frame (Solid's flex on a text's `loaded` event).
   `total` = handler + tail + frame: keydown dispatch to the end of the
   renderer frame that shows the result.
5. **Frames until idle.** Every later callback until the renderer's `idle`
   event: `frames` (drawn), `animCpu` (drawn frames after the first:
   transitions), `undrawnCpu` (renderer callbacks that drew nothing: the
   renderer's idle polls), `otherRaf` (callbacks that are not the
   renderer's). `cpu` = handler + tail + all of those. `settle` = wall time
   from the op's start to the end of its last drawn frame. `frameDelay` = from
   the tail's end to the first frame's start.
6. **Idle.** The op is over at the renderer's `idle` event followed by 50 ms
   with no drawn frame (Solid's idle tasks and late image uploads can draw
   again: then it waits for the next `idle`), or after 50 ms with no drawn
   frame at all (an op that changes nothing draws nothing, and no `idle`
   follows), or after `--idle-timeout` (`timedOut`).
7. **Keyup.** Sent only once the op is idle, so it never lands in the op's
   frames; its handler is timed as `keyup`, and the probe waits for idle again
   (`keyupFrames`) before the next op.

Work outside the handler, the microtask tail and rAF callbacks (timers, image
decode callbacks, the renderer's idle maintenance) is not in the time-mode
numbers; the profile mode sees it.

## Modes

Each mode is a separate page load, so instrumentation never touches the
timings. The warmup ops run first in every mode; only the measured ops are
recorded.

### `time`

The op records above. No instrumentation beyond the rAF wrap and the
`gl.clear` counter (one wrapped call per drawn frame), the same in every arm.

### `alloc`: bytes per op

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
renderer function inlined into a framework function counts as framework. The
JSON lists the top 30 allocating functions (`function (chunk:line)`, bytes
per op; line numbers are of the beautified bundle in
`bench/dist/<arm>/assets`). Zero framework allocations in the steady state
reads off the `framework` column.

### `profile`: self time

CDP `Profiler` at a 50 µs sampling interval over the measured ops. Self time
per function (`function (chunk:line)`) and per chunk, per op; a native
function (a WebGL call, a builtin) is charged to its nearest caller's chunk
and named `fn [native] (chunk)`. `(program)` and `(garbage collector)` are
kept as their own buckets, `(idle)` is dropped. Under throttling the
suspended time lands on whatever was on the stack, so self times are in
throttled ms, like the time mode. The window includes everything between the
ops too: for example the renderer's idle-maintenance `gl.getError()` (the
out-of-memory probe), which shows up as `getError [native] (renderer)`.
`--save-profiles` keeps the raw profile for `bench/harness/inclusive.mjs`.

### `count` (instrumented build, its timings are not reported)

Built separately (`BENCH_INSTRUMENT=1` into `dist/<arm>-count`). Per op:

| Count                    | Hook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| flex passes              | Build time: the default export of the arm's `src/core/flex.ts` and `flexLayout.ts` is wrapped (`bench/vite.config.ts`, `countFlexPasses`); one call is one container laid out. `n/a` if the hook did not install (the build warns).                                                                                                                                                                                                                                                                                                                                           |
| node writes              | Runtime: every configurable setter on the renderer node prototypes (from `renderer.root`, and every node `createNode`/`createTextNode` returns) is wrapped. Only **app writes** count: a setter call made while renderer code is on the stack is skipped (a renderer frame's callback, `createNode`/`createTextNode`/`createShader`/`animate`, another setter, a non-node emitter's dispatch such as a texture's), while the app's listeners the renderer calls (`loaded` and other node events, the renderer's `idle`) run as app code. Per-prop counts in `topWrites.node`. |
| shader writes            | Runtime: each shader node's `props` (the node's own `definedProps`: one non-enumerable accessor per prop) is swapped for a counting forwarder, at `createShader` and for existing nodes. App writes only, as above.                                                                                                                                                                                                                                                                                                                                                           |
| in frames                | The app writes (both kinds) made during a renderer frame: Solid's work in listeners the frame calls, such as flex on a text's `loaded`. The renderer steps animations through its setters; that does not count.                                                                                                                                                                                                                                                                                                                                                               |
| created, creation props  | Nodes created through `createNode`/`createTextNode`, and the keys with a defined value in the props bag passed to them (the renderer applies the bag in its constructor; never counted as writes).                                                                                                                                                                                                                                                                                                                                                                            |
| animations               | App calls of `animate`/`animateProp` on node prototypes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| walks per drawn frame    | Iterations of `Stage.drawFrame`'s update loop (counted through reads of `stage.reprocessFrame`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| loaded (emitted / heard) | `emit('loaded', …)` on nodes, text when the payload's `type` is `'text'`: every emit, and the ones a listener hears (listeners are in `eventListeners`). Renderer 1.x emits on every text layout and texture load whether or not anything listens.                                                                                                                                                                                                                                                                                                                            |
| text layout calls and ms | `stage.textRenderers.sdf.renderText` (cache lookup and layout), timed in the instrumented build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| layout cache hit rate    | `renderText` returning a layout object it returned before (a hit) or a new one (a miss); layouts made before the counters were installed count as a miss on first sight, which the warmup absorbs.                                                                                                                                                                                                                                                                                                                                                                            |
| frames to final layout   | The index (1 = the first drawn frame, 0 = during the handler or tail) of the last renderer frame in which a flex pass, a text layout or a text `loaded` happened; `ms to final layout` is from the op's start to that frame's end (instrumented timing).                                                                                                                                                                                                                                                                                                                      |

Hooks. Every one is looked up by name at runtime (the flex wrap at build
time) and the page reports what it found (`hooks` in the count JSON):

| Hook (`hooks.<key>`)                    | Feeds                                            | Renderer 1.x                                 |
| --------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| `flexHooks` (build time)                | flex passes, frames to final layout              | default export of `flex.ts`, `flexLayout.ts` |
| `nodeAccessors`                         | node writes, in frames                           | node prototype setters                       |
| shader `props` swap (`shaderUnwrapped`) | shader writes                                    | `definedProps` accessors                     |
| `createHook`                            | created, creation props                          | `createNode`, `createTextNode`               |
| `animateHooks`                          | animations                                       | `animate`, `animateProp`                     |
| `walkHook`                              | walks, walks/drawn frame                         | `Stage.drawFrame` loop iterations            |
| `drawHook`                              | drawn frames, walks/drawn frame                  | `gl.clear`                                   |
| `loadedHook`                            | loaded (emitted / heard), frames to final layout | `emit` on the node prototype chain           |
| `textHook`                              | text layout calls and ms, frames to final layout | `SdfTextRenderer.renderText`                 |
| `cacheHook`                             | layout cache hit rate                            | `renderText` layout identity                 |
| `loopHook`                              | (errors only, below)                             | `stage.options.handleLoopError`              |

The probe also carries the hooks for `@solidtv/renderer` 2.x (`ScenePass.run`,
`TextNodes.lay`, `LayoutCache.get`, `insertBefore`, `settings.handleLoopError`),
each labelled "v2" in `probe.mjs`: they install only when the renderer has
those names, so on 1.x they never run.

A count whose hook found nothing is **`n/a`, never 0**: the hook stays `null`
in the page (for node writes, animations and shader writes: no setter or
method wrapped, or a shader whose `props` could not be swapped), and
`countStats` (`bench/harness/analyze.mjs`) reports what it feeds as `n/a`.
A `n/a` in a cell means the hook needs updating for that renderer: look for
its renamed function and add it next to the others in `installCounters`
(`bench/harness/probe.mjs`). Frames to final layout is `n/a` unless the flex,
text and `loaded` hooks are all there, since it reads their sum.

A hook that **throws** is an error, not a zero. Each hook forwards every
argument it is called with, and an exception that passes through one is
counted per hook (`hooks.errors`: name, times, first stack), logged once with
`console.error` and added to the run's `errors`; so is a hook whose install
threw (`<hook> (install)`). The run is kept as JSON, left out of the summary
and the runner exits 1. The renderer's frame loop swallows what a frame or a
listener it calls throws and hands it to `handleLoopError`, a no-op by
default (`stage.options.handleLoopError`, a copy of the setting made when the
Stage is built, so the setting itself is not read again): the frame is not
drawn and is tried again, which reads as zero drawn frames and zero counts.
So the probe also counts what reaches it (`renderer frame loop`). An
exception is charged once, to the innermost hook that saw it.

## Noise

- **In-session control:** while `src/` is unchanged, A and C are the same
  Solid code; their ratio in the summary is the noise floor of that series
  (with the renderer-version caveat above). An effect smaller than that
  spread is not a result.
- **Runs:** a "faster" claim needs n ≥ 3 runs that beat the noise floor. Use
  more runs (`--runs 5`) for effects near it.
- **Throttling** adds up to ±0.43 ms per op (above); means over 60 ops reduce
  it to roughly ±0.05 ms per run.
- **Machine load** shows directly in the numbers: other processes take the
  cores the GPU process and the compositor need. The summary prints the load
  average range; measure on a quiet machine.
- **Chunking:** the chunked build's calls between chunks are real module
  imports. Compare it with `--no-chunks` on a quiet machine before relying on
  sub-10% effects.
- **Machine cost:** a throttled page keeps about one core busy in the
  Chromium renderer process even when the page is idle. Do not run two
  series at once.

## Where each metric is

| Metric                                     | Where                                                                 |
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
| inclusive time of named functions          | `bench/harness/inclusive.mjs` on `--save-profiles` output             |

This harness is the in-browser, per-scenario measurement on a desktop CPU
under throttling; it is not a substitute for measuring on a device.
