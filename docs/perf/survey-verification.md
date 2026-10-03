# Verification of the 2026-10-03 survey leads

Read-only check of every lead in the brief's "Phase 2 → Leads from the
2026-10-03 survey", against:

- `solid-1.7` at `517094d` (solid 1.6.4 + renderer-v2 lockstep patch; `src/` unchanged by this work);
- `renderer-v2-solid` at `faf4b9f`;
- `solid-js` 1.9.3 (`node_modules/solid-js/dist/solid.js`, `universal/dist/universal.js`);
- `@solid-primitives/list` 0.1.2.

Line numbers are current as of those commits. Nothing in `src/` was changed.

## Method

- **Code reading** of the whole ArrowRight path, Solid and renderer.
- **Instrumentation probe** (jsdom, DOM renderer, `isDev` true as in all vitest
  runs). It lives outside the repo, in the scratchpad
  (`.../scratchpad/probe/keypress.probe.tsx`, run with
  `npx vitest run --config .../scratchpad/probe/vitest.probe.config.mjs keypress`
  from `solid-1.7`). It:
  - wraps `ElementNode` methods to count them;
  - counts `States[Symbol.species]` reads and setter calls on the DOM handle;
  - emulates v2's `reprocessUpdates` on the DOM stage (one stored callback, run
    at "frame" time), so it can see which `runPostMutation` run does the work.

  The counts below come from it. They are counts, not timings.

- **Transforms** in the scratchpad (`.../scratchpad/classfields/`):
  - rolldown 1.1.5 `transformSync` (the demo app's), with target `chrome64` and
    `assumptions.setPublicClassFields`;
  - then `@babel/preset-env` 8.0.2 with targets `chrome 38` and the demo's
    `legacy()` assumptions;
  - and `babel-preset-solid` 1.9.5 (universal) on `Row`, `Column`, `Virtual`,
    `VirtualGrid` and `Grid`, to see the compiled spreads.

### The concrete case

Every per-press number below is for this case unless it says otherwise.

- **Tree:** `Column scroll="auto"` › 10 × `Row scroll="auto"` › 20 ×
  `<view style={Thumbnail}>`.
- **Thumbnail:** the demo's `styles.Thumbnail`:
  - `$focus: { scale: 1.1, border: { color, width: 6, gap: 4, align: 'outside' } }`;
  - `transition: { scale }`;
  - `borderRadius`;
  - `border: { width: 0, color: 0 }`.
- **Focus path depth D = 4:** tile, Row, Column, App root. Demo pages are
  deeper (page wrappers, LeftNavWrapper, …), and every per-path cost below
  scales with D.
- **The press:** ArrowRight within a Row, in steady state:
  - both tiles have been focused before;
  - the previous press went the same direction;
  - no app key handlers, and the announcer is off;
  - production build (`isDev` false);
  - renderer v2, animations on.

### Counting allocations

"Allocations" counts the JS heap objects that framework code creates on the
path: objects, arrays (an array plus its backing store counts as 1 unless
noted), closures, strings and typed arrays. V8 may escape-analyse a few of the
short-lived ones (for example, a result object returned from an inlined
function), so the totals are upper-bound estimates.

### Counts measured by the probe

Both columns are per press, in the probe's terms.

| Count                                               | Right within a Row  | VirtualRow press that shifts the window |
| --------------------------------------------------- | ------------------- | --------------------------------------- |
| `setFocus`                                          | 1                   | 1                                       |
| `reprocessUpdates()` registrations                  | 1                   | 1                                       |
| `queueMicrotask(runPostMutation)`                   | 1                   | 1                                       |
| `runPostMutation` that did work (microtask)         | 1                   | 1                                       |
| `runPostMutation` no-op (frame callback)            | 1                   | 1                                       |
| `_stateChanged`                                     | 2                   | 2                                       |
| `States` species constructions                      | 1                   | 1                                       |
| `_writeShaderTarget` (border sets)                  | 2                   | 2                                       |
| animated-prop writes (`_sendToLightningAnimatable`) | 3 (x, scale, scale) | 18 (scale ×2, x ×16)                    |
| flex passes (`updateLayout` on a flex container)    | **0**               | **2**                                   |
| `insertChild` / `removeChild` / `render`            | 0                   | 2 / 3 / 2 (all moves, no node created)  |
| `activeElement` effect runs                         | 1                   | 1                                       |
| renderer handle writes (DOM renderer)               | 5                   | 23                                      |
| other microtasks                                    | 0                   | 1 (Virtual's own)                       |

For ArrowDown to the next Row, the probe counted 4 `_stateChanged` (the two
Rows gain and lose `$focus` too) and 2 species constructions.

---

## 1. Verdicts at a glance

| #   | Lead                                                              | Verdict                                                                                                                       |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| K1  | closure + `runWithOwner` per key event                            | Confirmed (keydown **and** keyup)                                                                                             |
| K2  | `keyIdentities` array                                             | Confirmed (keydown and keyup)                                                                                                 |
| K3  | `performance.now()`                                               | Partly: a call per event, not reliably a heap allocation                                                                      |
| K4  | `_pendingHistoryKey` built with history off                       | Confirmed (per keydown **and** per focus change)                                                                              |
| K5  | template-string handler names                                     | Confirmed (2 strings per event; built once per event, not per element)                                                        |
| K6  | `{ handled, lastHandlerSeen }` per bubble level                   | Partly: one per bubble pass, not per level                                                                                    |
| K7  | capture walk over the whole path                                  | Confirmed (keydown and keyup)                                                                                                 |
| K8  | handlers are per-instance expandos, megamorphic                   | Confirmed                                                                                                                     |
| K9  | `chainFunctions` rest-args arrays                                 | Confirmed (only when 2 or more functions are chained)                                                                         |
| K10 | `Config.focusDebug` not dev-gated                                 | Confirmed                                                                                                                     |
| R1  | per-press transition object                                       | Confirmed (and it is never read on Virtual)                                                                                   |
| R2  | infinite loop, `wrap` with every child `skipFocus`                | Confirmed                                                                                                                     |
| R3  | `style?.focus` instead of `$focus`; `style` getter allocates `{}` | Partly: the bug is real; in v2 the withScrolling branch is unreachable; live in `Virtual.computeSize`                         |
| R4  | `absX` recursion                                                  | Partly: O(depth), but only on a Row's first scroll                                                                            |
| R5  | a Row with `selected` re-scrolls on every layout                  | Confirmed                                                                                                                     |
| F1  | every focus change schedules two runs                             | Partly: two registrations; one run does the work, the frame run is a measured no-op                                           |
| F2  | `updateFocusPath` walks every ancestor                            | Confirmed                                                                                                                     |
| F3  | lazy `States` plus bound callback per ancestor                    | Partly: once per node lifetime, not per press                                                                                 |
| F4  | fresh path array per change                                       | Confirmed                                                                                                                     |
| F5  | O(depth²) `indexOf` diff                                          | Confirmed                                                                                                                     |
| F6  | `States extends Array` species construction                       | Confirmed (1 per blur; and probably slow generic builtins, see §3)                                                            |
| F7  | unbatched `onFocus` / `onBlur` / `onFocusChanged`                 | Confirmed                                                                                                                     |
| F8  | two reactive flushes                                              | Partly: two `runUpdates` passes always; only `setActiveElement` has effects by default                                        |
| G1  | spread re-runs reallocate handlers                                | Partly: Virtual and VirtualGrid re-run but keep their handlers; Grid reallocates 5 handlers on vertical moves                 |
| G2  | `SliceState` plus slice array per press                           | Partly: `SliceState` every press; the slice array only when the window moves                                                  |
| G3  | `List` diff cost, `indexOf`, `getNextSibling`                     | Confirmed (3 `indexOf`s per move, not 2; plus a `Map` and `Uint8Array` per diff)                                              |
| G4  | at least two flex passes per window move                          | Confirmed (measured: 2)                                                                                                       |
| S1  | `set states` has no unchanged check                               | Confirmed                                                                                                                     |
| S2  | recompute and `Object.assign` of every key, no diff               | Confirmed                                                                                                                     |
| S3  | quadratic multi-state merge                                       | Confirmed                                                                                                                     |
| S4  | undo allocates objects and closures                               | Confirmed                                                                                                                     |
| S5  | `keyExists` uses `in`                                             | Confirmed                                                                                                                     |
| S6  | `forwardStates` overwrites the children's states                  | Confirmed                                                                                                                     |
| S7  | `parseAndAssignShaderProps` allocates                             | Confirmed (about 11 allocations per border write)                                                                             |
| S8  | gradients create a shader per set                                 | Confirmed                                                                                                                     |
| S9  | `onAnimation.stopped` makes a `setTimeout` per prop               | Confirmed                                                                                                                     |
| L1  | per-pass index array, 7 `Float32Array`s, closure                  | Confirmed (both implementations)                                                                                              |
| L2  | unconditional `x`/`y` writes                                      | Confirmed (measured: 16 writes for 2 passes over 8 children)                                                                  |
| L3  | production `console.warn`                                         | Confirmed (`flex.ts` only)                                                                                                    |
| L4  | two implementations; `flexLayout.ts` untested                     | Partly: tests and the bench run `flex.ts`, but **the demo app runs `flexLayout.ts`**                                          |
| L5  | a `$focus` width/height change does not reflow                    | Confirmed                                                                                                                     |
| N1  | `ElementNode` size (24 `_` fields, 11-key bag, expandos)          | Confirmed (27 own fields at construction; tile +3, Row +18, Column +19 expandos)                                              |
| N2  | unknown names written to the v2 handle                            | Confirmed: the paths exist (§4.4)                                                                                             |
| N3  | child-list `indexOf`/`splice`; `cleanChildren` O(n²)              | Confirmed                                                                                                                     |
| N4  | class-field emit for `ElementNode`                                | Refuted for `ElementNode` (it has no class fields). `TextNode` and `States` do, and their emit depends on the tsconfig (§4.5) |

**Totals: 34 Confirmed, 10 Partly, 1 Refuted (45 leads).**

The pointer "Layout → Text" is covered in §6. Its leads are confirmed there,
but not counted here.

---

## 2. Trace of one ArrowRight within a Row

Each step gives its file and line, then what it allocates. Unless a path says
otherwise, it is under `src/`.

Abbreviations:

- `fm` = `core/focusManager.ts`
- `en` = `core/elementNode.ts`
- `hn` = `primitives/utils/handleNavigation.ts`
- `ws` = `primitives/utils/withScrolling.ts`
- `sj` = `solid-js/dist/solid.js`
- `rv2` = `renderer-v2-solid/src`

### A. keydown task

1. **The `document` keydown listener.** `keyPressHandler`, fm:635-643. It calls
   `ownerContext(() => {...})` (fm:623-625).
   - Allocates **1 closure**.
2. **`runWithOwner(owner, cb)`**, sj:550 → `runUpdates(fn, true)`, sj:850-856.
   - `Effects = []`: **1 array**.
   - This batches the effects (but not the memos) of signal writes made inside
     the handler until it returns.
3. **`handleKeyEvents`**, fm:537-555.
   - `keyIdentities(keydown)` (fm:449-460): **1 array plus its backing store**,
     holding `'ArrowRight'` and `39`.
   - `liftSuppression` → `findSuppression`: a `for…of` and 2 `Map.get`s.
   - `keyMapEntries[e.key]` → `'Right'`.
4. **`propagateKeyPress`**, fm:380-440.
   - `performance.now()` (fm:385).
   - `_pendingHistoryKey = { keyPressed, mappedKey }` (fm:410): **1 object**.
   - `focusPath()`: a signal read; nothing tracks it.
5. **`runCapturePhase`**, fm:297-324.
   - `` `onCapture${keyBase}${isUp ? 'Release' : ''}` `` (fm:307): **1 string**.
     It is not interned, so each keyed lookup goes through the string table.
   - Loops over **all D path elements**. Each one does
     `isElementThrottled` (`elm.throttleInput`: a miss through the prototype
     chain), `elm[captureEvent]` and `elm[captureKey]`: **3 keyed misses**.
6. **`runBubblePhase`**, fm:328-378.
   - `` `on${mappedEvent}` `` (fm:340): **1 string**.
   - On the tile: throttle check, `tile.onRight` misses, `tile.onKeyPress`
     misses.
   - On the Row: `Row.onRight` is found.
   - Returns `{ handled: true, lastHandlerSeen }` (fm:374): **1 object**, which
     may be escape-analysed away.
   - `elm._lastAnyKeyPressTime = currentTime` (fm:373) stores a double.
7. **`Row.onRight`** = `handleNavigation('right')` (Row.tsx:32,42; hn:125-162).
   `chainFunctions(undefined, onRight)` returns `onRight` itself, so there is
   no wrapper.
   - `el.transitionRight` and `el.transition` are expando reads.
   - `merged = { ...directional, ...el._navBaseTransition }` (hn:152):
     **1 object**. It is stored in `el.transition` and `el._navLastMerged`.
8. **`moveSelection`** (hn:190-221) → `findFirstFocusableChildIdx` (hn:37-53),
   which reads `children[i]?.skipFocus` (a miss) → `selectChild` (hn:55-74).
   - `el.selected = index` (an expando store).
   - `lng.isFocused(child)` → `child.states.has('$focus')` (core/utils.ts:219-221).
     The first time a child is touched, the `states` getter allocates a
     `States`, a bound `_stateChanged`, and 3 arrays from
     `Object.entries({}).filter().map()` (en:1278-1281, states.ts:11-21).
     That is once per node lifetime, so 0 in steady state.
9. **`child.setFocus()`** (en:1112-1138). `forwardFocus` misses, then
   `nextActiveElement = this`, then `schedulePostMutation()` (en:93-100).
   1. `'reprocessUpdates' in renderer.stage`: the `stage` getter returns the
      renderer (rv2 `Renderer.ts`, `RendererCore.ts:322`).
   2. `renderer.reprocessUpdates(runPostMutation)` (rv2 `RendererCore.ts:503-510`)
      sets `postUpdate = cb` and `frameRequested = true`, then
      `onFrameRequest()` → `loop.schedule()` (`Renderer.ts:331-337`).
      - Allocates nothing.
   3. `queueMicrotask(runPostMutation)`.
      - Allocates **1 microtask entry** (V8-internal).
10. **`el.onSelectedChanged(index, el, child, lastSelected)`** (hn:71). With no
    app handler this is `scrollRow` itself (Row.tsx:51-56). It runs the
    `withScrolling` closure (ws:63-242):
    - About **25 property reads** on the Row and the tile, many of them misses
      on expandos that are absent (`scrollIndex`, `endOffset`, `onScrolled`,
      `scrollStopLast`, `upCount`, `centerScroll`, …).
    - `lng.stage.root.w` is 2 getter calls.
    - `selectedElement.scale` → `ElementNode` accessor → v2 `Node.scale`
      (rv2 `Node.ts:307-309`), which always returns `scaleX`, a number. So
      `style?.focus` (ws:127) is never evaluated.
    - Then `componentRef.x = nextPosition` (ws:238), `_targetPosition`, and
      `offset`.
11. **The `x` write.** `ElementNode` accessor (en:1772-1781) →
    `_sendToLightningAnimatable('x', v)` (en:993-1032).
    - Reads `this.transition`, `Config.animationsEnabled`,
      `this.transition.x` and `getPropertyAlias`, then
      `'animateProp' in this.lng`.
    - → `lng.animateProp('x', v, transition.x)` (rv2 `Node.ts:922-967`). The
      settings object is the same as last time (`defaultTransitionForward.x`),
      so the controller is reused: `retarget` plus `start()`.
    - If the previous run had finished, `start()` allocates a **Promise, its
      executor closure and its resolving functions** (rv2
      `Animation.ts:440-451`; a finished run calls `stop()` at :626, which
      clears the promise).
    - If the direction changed (Left after Right), the settings object
      differs. Then `stop()` and a **new `Animation`** (about 12 objects: 4
      typed arrays and 4 arrays at `Animation.ts:270-278`), plus
      `{ [name]: value }` and a slot object (`Node.ts:957-965`).
    - Then `_fireAnimationEvents`: `this.onAnimation` misses, so it returns.
12. **The handler returns `true`.** `Config.preventDefaultOnHandledKeys` is
    false. `runWithOwner` completes: `completeUpdates`, with nothing queued.

### B. Microtask: `runPostMutation` (en:102-138)

13. `postMutationQueued = false`. The delete and layout queues are empty.
    Then the focus phase: `setActiveElementCore(tile)` (fm:212-222).
14. **`updateFocusPath(tile, prev)`** (fm:226-280).
    - `fp = []` plus pushes: **1 array plus its backing store**.
    - Walks up D ancestors. Each one gets `current.states.has($focus)`
      (`indexOf` on an `Array` subclass, states.ts:28-40), and `parent`
      getter reads.
    - On the new tile:
      - `states.add` → `push` → `onChange` = bound `_stateChanged`
        (step 15).
      - Then `onFocus` and `onFocusChanged` lookups (both miss).
    - The previous path is diffed with `fp.indexOf(elm)` for each of its D
      elements: **D² = 16 comparisons**.
    - On the old tile:
      - `states.remove` (states.ts:93-99) → `splice` → **species construction**
        `new States(1)`: a `States` instance and `Object.entries({})`,
        `.filter`, `.map` (**4 allocations**).
      - Then `_stateChanged` (step 16), then `onBlur` and `onFocusChanged`
        lookups.
    - `if (Config.focusDebug)` (fm:275).
    - `_signalWrapper(() => setFocusPath(fp))` (fm:279): **1 closure**, plus
      `runWithOwner` → `Effects = []` (**1 array**). `focusPath` has no
      observers unless the announcer is used.
15. **Tile gains `$focus`.** `_stateChanged` (en:1405-1505).
    - `forwardStates` misses.
    - `_undoStyles` is `[]` from the last blur, so `keyExists(this, states)`
      (core/utils.ts:69-79) runs: `'$focus' in tile` is true.
    - One state, so `newStyles = this['$focus']`, the static object, without
      a copy.
    - `this._undoStyles = Object.keys(newStyles)` (en:1493): **1 array**.
    - `Object.assign(this, newStyles)` (en:1500). It takes two keys:
      - **`scale`** → accessor → `animateProp('scale', 1.1, transition.scale)`.
        The controller is reused, plus a renderer Promise if the last run had
        finished.
      - **`border`** → `shaderAccessor('border').set` (en:1830-1866).
        - `lng.shader.props`: the v2 facade (rv2 `ShaderNode.ts:76-78`).
        - `transition.border` misses, then `parseAndAssignShaderProps`
          (en:175-204), which allocates:
          - the `borderSideMap` literal (**1**);
          - `Object.entries(obj)` with its 4 pairs (**5**);
          - the `forEach` closure (**1**);
          - 4 template keys `border-color`, `border-w`, `border-gap` and
            `border-align` (**4**).
          - That is **11 allocations** in Solid.
        - Each keyed store goes into a facade setter (rv2
          `ShaderRegistry.ts:1003-1016`). `border-w` goes through `vec4Prop`'s
          `resolve` → `toVec4`: a **new 4-array** (rv2 `borderGeometry.ts:5-9`).
          It always stores and marks, because it is an object.
        - `border-color`, and `border-gap` on the first focus, mark
          `DIRTY_SHADER` through `markUsers` → `markDirty` (rv2
          `NodeStore.ts:472-492`).
        - `props.border = obj` (en:193) adds an own `border` field to the
          facade object (§4.4).
        - `_writeShaderTarget` (en:837-848) does nothing on v2.
16. **Old tile loses `$focus`.** `_stateChanged`.
    - `stylesToUndo = {}` (en:1439): **1**.
    - `_undoStyles.forEach(closure)` (en:1440): **1**. It reads `this.theme`
      (en:1221-1224; allocates `{}` once per node) and `this.style`.
    - `numStates === 0` → `Object.assign(this, stylesToUndo)`:
      - `scale`: `animateProp`, reused.
      - `border` (`{ width: 0, color: 0 }`): `parseAndAssignShaderProps` again
        (**7 allocations**), plus 1 renderer `toVec4`.
    - `this._undoStyles = []` (en:1459): **1**.
17. **History.** `recordFocusHistory` is gated by `isDev`.
    `_pendingHistoryKey = {…}` (fm:218) is **not** gated: **1 object**.
18. **`Config.setActiveElement(tile)`** → `ownerContext(() => setActiveElementSignal(elm))`
    (fm:630-631): **1 closure**.
    - `runWithOwner` → `Effects = []`: **1**.
    - `writeSignal` (sj:687-717) → `runUpdates(closure, false)`: **1 closure
      and `Updates = []`**.
    - `completeUpdates` → `runUpdates(() => runEffects(e))`: **1 closure and
      1 array**.
    - It runs the framework's own render effect (render.ts:76-83: reads
      `activeElement()` and sets `tasksEnabled = false`), plus every app
      effect on `activeElement`.

### C. The next rAF: `Renderer.frame` (rv2 `Renderer.ts:340+`)

19. `step(dt)` advances the `x` and `scale` tracks.
20. `update()` (rv2 `RendererCore.ts:535-590`):
    - `scene.run` resets `writes` (`ScenePass.ts:243`) and walks once.
    - `textEvents.flush()` follows.
    - `cb = postUpdate` → `runPostMutation` runs **as a no-op**: every queue is
      empty (measured). It writes nothing, so `writesDuringPass` is 0 and
      there is **no re-walk**: `updateIterations = 1`.
21. `backend.draw`. The following frames, for about 250 ms of `scale` and
    180 ms of `x`, each step, walk and draw. That is renderer cost, after the
    frame that "shows the result".

### D. keyup task

22. Steps 1-6 repeat with `isUp = true`:
    - a closure, `Effects = []`, `keyIdentities` (array plus backing store),
      and `performance.now()`;
    - the strings `onCaptureRightRelease` and `onRightRelease`;
    - a **full capture walk (D × 3 keyed misses)**;
    - a **full bubble walk** (D × 2 misses; there is no `onKeyPress` fallback
      for keyup);
    - `{ handled: false, lastHandlerSeen }`.

    Nothing handles it in the common case. That is about **8 allocations and
    about 5·D property misses** for nothing.

### Totals (steady state, modern bundle, Solid framework only)

| Phase                            | Allocations  | Main work                                                                                                                                                |
| -------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| keydown dispatch and navigation  | about 10     | capture D·3 and bubble about 6 keyed loads; about 35 property reads in navigation and scroll; 1 animated write                                           |
| microtask: focus, states, styles | about 38     | D-ancestor walk, D² diff, 2 `_stateChanged`, 2 `animateProp`, 2 shader parses (6 facade writes), 1 species construction, 2 `runUpdates` and 1 effect run |
| frame callback                   | 0            | a no-op `runPostMutation`, 1 walk                                                                                                                        |
| keyup                            | about 8      | capture D·3 and bubble D·2 keyed loads                                                                                                                   |
| **Total**                        | **about 56** | **0 flex passes**, 3 `animateProp`s, about 4-6 renderer `markDirty`s plus the animation tracks                                                           |

The renderer adds, per press:

- 2 `toVec4` arrays;
- up to 3 Promises with their closures (about 12 objects) from
  `Animation.start()` restarting finished animations;
- on a change of direction, a new `Animation` (about 15 objects).

On the **legacy bundle** (Chrome < 64), add about 25 more. Babel helpers do it
(§4.5):

- two `_objectSpread` calls for the transition merge: each does `Object.keys`,
  `getOwnPropertySymbols`, a `forEach` closure and `Object.defineProperty` per
  key;
- `_createForOfIteratorHelper` in `keyExists`;
- the `States` species construction through `_wrapNativeSuper` and the
  `Reflect.construct` fallback: `_toConsumableArray`, `[].concat` and a
  `setPrototypeOf` per instance;
- `.concat()` for every template string.

---

## 3. Lead-by-lead evidence

### Key dispatch (`src/core/focusManager.ts`)

**K1, closure plus `runWithOwner`: Confirmed.** fm:635-652. It happens on
**both** keydown and keyup.

```ts
const keyPressHandler = (event: KeyEventLike) =>
  ownerContext(() => { if (handleKeyEvents(event as KeyboardEvent, undefined) && ...
```

- `ownerContext` = `runWithOwner(owner, cb)` → `runUpdates(fn, true)`, which
  allocates `Effects = []` (sj:855).
- Cost: 2 allocations per event, so **4 per press**.
- This wrapper is also the only batching on the keydown path. It defers the
  _effects_ of signal writes in handlers until the handler returns. It does
  not defer memos.

**K2, `keyIdentities` array: Confirmed.** fm:449-460, called at fm:542 and
fm:560.

- 1 array plus backing store per event, so **about 4 per press**.

**K3, `performance.now()`: Partly.** fm:385, on every event.

- It is an embedder call, and the double result may be boxed.
- It is not reliably a heap allocation in optimised code. Count it as call
  cost: 2 per press.

**K4, `_pendingHistoryKey` built with history off: Confirmed.** It is
**2 objects per press**:

- fm:410, per keydown;
- fm:218, per focus change.

Only `recordFocusHistory` itself checks `isDev && Config.focusHistoryDebug`
(fm:137).

**K5, template-string handler names: Confirmed.**

- `` `onCapture${keyBase}${isUp ? 'Release' : ''}` `` (fm:307);
- `` `on${mappedEvent}Release` `` / `` `on${mappedEvent}` `` (fm:339-340).

They are built once per event, not per element: **4 strings per press**. The
strings are not internalised. Every `elm[name]` lookup is then a keyed
megamorphic load with a non-internalised key: a string-table probe, with its
hash cached after the first.

**K6, result object per bubble level: Partly.** There is one
`{ handled, lastHandlerSeen }` per `runBubblePhase` call (fm:351, 374, 377).
That is 2 per press, and it may be escape-analysed away.

**K7, capture walk over the whole path: Confirmed.** fm:310-322 walks root to
leaf over every element, with 3 keyed loads each (`throttleInput`,
`captureEvent`, `captureKey`).

- For keyup, the bubble walk is also full (fm:348-376), because no handler
  answers `on…Release`.
- Per press: about `2 × 3D + 2 + 2D` loads, which is **32 for D = 4** and
  grows linearly with page depth.

**K8, handler storage: Confirmed.**

- `setProperty` is `node[name] = value` (solidOpts.ts:27-29).
- Of the handlers, only `onLayout` has a prototype accessor (en:1349-1360).
  Every `on*` handler is an own expando.
- Measured expandos:
  - Row: `transitionLeft`, `transitionRight`, `scroll`, `selected`, `onLeft`,
    `onRight`, `forwardFocus`, `scrollToIndex`, `onSelectedChanged`, `gap`,
    `preFlexwidth`, `_navBaseTransition`, `transition`, `_navLastMerged`,
    `_initialPosition`, `_screenOffset`, `offset`, `_targetPosition`
    (18 in a prod build);
  - Column: 19;
  - tile: `transition`, `$focus`, `item`.
- They are added in component-specific orders, so the hidden classes vary,
  and every handler lookup is a keyed load (K5). The lookup sites are
  megamorphic.

**K9, `chainFunctions` rest-args arrays: Confirmed.** chainFunctions.ts:23-25
(creation) and 49 and 57 (`...innerArgs` on each call).

- With fewer than 2 functions it returns the original function
  (chainFunctions.ts:41-42).
- So the per-call array only appears when the app passes its own `onLeft`,
  `onSelectedChanged`, and so on.
- `Grid` re-creates chains on spread re-runs (G1).

**K10, `Config.focusDebug` not dev-gated: Confirmed.**

- `if (Config.focusDebug) addFocusDebug(prevFp, fp)` (fm:275-277).
- `addFocusDebug` and its CSS (fm:51-94) ship in production.
- Cost per press: 1 property load. The rest is bundle size.

### Row and Column (`handleNavigation.ts`, `withScrolling.ts`)

**R1, per-press transition object: Confirmed.** hn:139-155:

```ts
const merged = { ...(directional as object), ...el._navBaseTransition };
el.transition = merged;
el._navLastMerged = merged;
```

This is 1 object per press. On the legacy bundle it is two `_objectSpread`
calls, each with `defineProperty` per key.

- For Row and Column, the `x`/`y` write in `scrollRow` reads it.
- **On Virtual and VirtualRow it is never read.** Virtual moves the row with
  `this.lng[axis] = …` and `this.animate(...)` (Virtual.tsx:463-471), not
  through the `x` accessor. So it is pure waste there.

**R2, infinite loop: Confirmed.** See §4.2.

**R3, the `style` getter and `.focus`: Partly.** There are two sites:

- ws:125-128:
  ```ts
  selectedElement.scale ?? (selectedElement.style?.focus as Styles)?.scale ?? 1;
  ```
  On v2, `selectedElement.scale` is the v2 `scale` getter, which returns
  `scaleX` (rv2 `Node.ts:307-309`, the same as 1.10). So `??` never reaches
  `style`, there is **no `{}` allocation**, and the `.focus` typo is latent.
- Virtual.tsx:104, in `computeSize`:
  ```ts
  const focusStyle = prevSelectedChild.style?.focus;
  ```
  This one is live:
  - it runs whenever `cachedScaledSize` is empty, or when
    `uniformSize === false`;
  - `style` allocates `{}` when there is no style (en:1207-1209);
  - `.focus` never finds a `$focus` block, so `factorScale` uses the
    _current_ scale.

**R4, `absX`: Partly.**

- v2 `absX` and `absY` recurse through the `parent` getter (rv2
  `Node.ts:876-895`), so they are O(depth), with 2 getter calls per level.
- They run only when `_screenOffset === undefined` (ws:87-98), which is a
  Row's first scroll. That is once per Row, not per press.

**R5, layout re-scroll: Confirmed.**

- Row.tsx:45-50 sets `onLayout = props.selected ? chainFunctions(props.onLayout, scrollRow) : …`.
  Column.tsx:46-51 does the same.
- `updateLayout` calls `onLayout` after every flex pass (en:1384-1385).
- `scrollRow(node)` with `lastSelected === undefined` takes the
  `'always'`/`'center'` path, and may write `x`.
- This applies only when `selected` is truthy at creation.

### Focus change

**F1, two runs per focus change: Partly.** The registrations are as the survey
says (en:93-100):

```ts
if ('reprocessUpdates' in renderer.stage && renderer.stage.reprocessUpdates) {
  renderer.stage.reprocessUpdates(runPostMutation);
}
queueMicrotask(runPostMutation);
```

What actually runs is in §4.1.

- The microtask always wins for key-originated work and does everything.
- The frame callback runs once, finds every queue empty and writes nothing
  (measured as a no-op on every press).
- Under v2 semantics it causes **no re-walk**.

The real costs are smaller than the survey implies:

- an extra function call per frame;
- `frameRequested = true`, which forces a walk and a draw even when the
  change wrote nothing to the store (for example a focus move between
  unstyled nodes);
- extra registrations whenever `runPostMutation` itself re-schedules (layout
  → `addToLayoutQueue(parent)`, or deferred `setFocus`).

**F2, `updateFocusPath` walks every ancestor: Confirmed.** fm:235-257.

- It visits every ancestor up to the root.
- Each one pays `states.has`, `onFocus`/`onFocusChanged` lookups and the
  `parent` getter.
- Every wrapper gets `$focus` added and removed when focus enters or leaves
  its subtree. That runs `_stateChanged` on the wrapper: 4 runs for a Down
  press (measured).

**F3, lazy `States` per ancestor: Partly.**

- The `states` getter (en:1278-1281) allocates a `States`, a `.bind`, and
  3 arrays from the default `{}` initial state.
- That happens once per node lifetime. In steady state it is 0 per press.
- The same applies to `isFocused(child)` in `selectChild` (hn:66).

**F4, fresh path array: Confirmed.** fm:234: `const fp: ElementNode[] = [];`.
That is 2 allocations per change.

**F5, O(depth²) diff: Confirmed.** fm:260-262 runs `fp.indexOf(elm)` for each
element of the previous path.

**F6, `States extends Array`: Confirmed.**

- `remove` → `this.splice(...)` (states.ts:96). `splice` and `slice` create
  their result through `ArraySpeciesCreate`, which calls `new States(1)`.
- With the default `initialState = {}`, that runs
  `Object.entries({}).filter().map()` (states.ts:17-21).
- Measured: 1 species construction per Right press, 2 per Down press.
- It also leaves `onChange = 1`, a number, on the throwaway instance. That
  changes the field representation of the `States` map once.
- `forwardStates` calls `this.states.slice()` (en:1421): another species
  construction.

Beyond the survey: V8's fast paths for `indexOf`, `push` and `splice` check
for the initial `Array.prototype`. So on `States` instances, `has`, `add` and
`remove` probably all run the generic, slow builtins. This is a hypothesis to
confirm in the CPU profile: look for generic `ArrayPrototypeSplice` and
`Runtime_ArrayIndexOf` frames.

**F7, unbatched callbacks: Confirmed.**

- `updateFocusPath` runs inside the `runPostMutation` microtask, without
  `batch` or `runWithOwner`.
- Every signal write in `onFocus`, `onBlur` or `onFocusChanged` (for example
  Portal-style reactive text colours) runs
  `runUpdates(..., false)` → `completeUpdates(false)`. That flushes its
  effects immediately, one write at a time.

**F8, two reactive flushes: Partly.** `setFocusPath` (fm:279) and
`Config.setActiveElement` (fm:221, 630-631) each go through
`runWithOwner` → `runUpdates` → `completeUpdates`.

- `focusPath` has observers only when the announcer is used
  (`announcer/index.ts:15`). Otherwise it is an empty pass, which still costs
  a closure and an `Effects` array.
- `activeElement` always has at least one observer: Solid's own render effect
  (render.ts:76-83), plus app effects. The demo pages read `activeElement`.

### Grid, Virtual and VirtualGrid

**G1, spread re-runs: Partly.** From the compiled output (babel-preset-solid,
universal):

- **Virtual.**

  ```js
  _$spread(_el$, _$mergeProps(props, keyHandlers, { get wrap(){…}, get selected(){…}, get cursor(){ return cursor(); }, "forwardFocus": …, … }), true)
  ```

  - `keyHandlers` (Virtual.tsx:583-606) and the `@once` props are static.
    `ref` is evaluated outside the effect.
  - So a `cursor` change re-runs `spreadExpression`'s single render effect
    (universal.js:208-216). It walks about 22 props (measured expandos:
    `each`, `displaySize`, `bufferSize`, `scroll`, `wrap`, `cursor`, …),
    re-evaluates every getter, and writes only `cursor`.
  - It **does not** reallocate handler closures.
  - Measured: 1 `cursor` write per press.

- **VirtualGrid** is the same: `cursor` is written on every press
  (VirtualGrid.tsx:102), even within a row.
- **Grid** is the exception, and reallocates.
  `onUp`, `onDown`, `onLeft`, `onRight` and `onFocus` are compiled as
  **getters** that call `chainFunctions(props.onX, () => moveFocus(...))`
  (Grid.tsx:129-133; there is no `@once`).
  - The spread re-runs when `scrollY()` or `height` changes, which is every
    vertical move.
  - Each re-run allocates 5 rest arrays, 5 arrow closures (plus 5 wrappers
    and 5 arrays when the app passes handlers), and writes 5 new handler
    expandos.

**G2, per-press slice allocation: Partly.**

- Virtual.tsx:427-435 runs on every press:
  - the `setCursor(c => …)` closure;
  - `computeSlice` returns a new `SliceState` (Virtual.tsx:347-355);
  - `setSlice(newState)`.
- The `items().slice()` array is allocated only when `start` changes
  (Virtual.tsx:338-345).
- Because `setSlice` always gets a new object, `List` re-runs even when the
  window does not move:
  - `new Array(n)`, `new Map()` and `new Uint8Array(…)`
    (`@solid-primitives/list` index.js:30, 45-46);
  - a new `mapped` array, which re-runs the `insert` effect:
    `normalizeIncomingArray` allocates a new array, and `reconcileArrays`
    calls `getNextSibling` and makes an O(L) comparison pass.
- VirtualGrid allocates the slice only on a row change (VirtualGrid.tsx:103-105).

**G3, `List` diff cost: Confirmed, with corrections.**

- `@solid-primitives/list` is _unkeyed_. A one-step window shift **recycles**
  nodes: L-1 items match by value and keep their nodes, and the leaving item's
  node takes the new value through `batch(changeBoth)` (list index.js:98).
  **No `ElementNode` is created per shift** (measured: `render` 2× and both
  are early returns for already-rendered nodes).
- The diff allocates `temp`, a `Map`, a `Uint8Array`, and **one `[j]` array
  per unmatched item** (index.js:49; L of them on a shift).
- Then the rotation `[n0..nL-1] → [n1..nL-1, n0]` goes through
  `reconcileArrays` (universal.js:114-170). It allocates a `Map`, then calls
  `replaceNode(n1, n0)` → `insertNode` + `removeNode`, then
  `insertNode(n0, after)`.
- `insertChild(node, before)` (en:930-957) does:
  - `node.parent.removeChild(node)`: `indexOf` and `splice`;
  - `spliceItem(children, node, 1)`: **another `indexOf`, which misses after
    a full scan**;
  - `spliceItem(children, before, 0, node)`: `indexOf`, `splice`, and a rest
    array.

  That is **3 `indexOf`s**, not 2.

- `removeChild` does not clear `node.parent`. So re-inserting `n0` pays one
  more full-scan miss.
- `getNextSibling` (solidOpts.ts:69-76) is `indexOf`, called at least once per
  reconcile (universal.js:120).
- Measured per shift: `insertChild` 2, `removeChild` 3.

**G4, at least two flex passes: Confirmed (measured: 2).**

1. Pass 1: `removeChild` and `render(true)` queue the view, and
   `runPostMutation` phase 2 runs layout (en:117-124).
2. Pass 2: Virtual's own microtask calls `elm.updateLayout()`
   (Virtual.tsx:451-452). VirtualGrid does the same (VirtualGrid.tsx:118-120).

Each pass writes every child's `x`: 8 children × 2 = 16 accessor writes,
mostly unchanged values. Text tiles can add a third, in-frame pass (§6).

### States and styles

**S1, no unchanged check: Confirmed.** en:1269-1276:

```ts
set states(states: NodeStates) {
  this._states = this._states ? this._states.merge(states) : new States(this._stateChanged.bind(this), states);
  if (this.rendered) { this._stateChanged(); }
```

**S2, recompute and re-apply: Confirmed.**

- `Object.assign(this, newStyles)` (en:1500) runs every key through its
  setter.
- Animated keys call `animateProp` even when the value is unchanged. That
  retargets to the same value, resets `progress` to 0, and requests frames.
- So adding a second state while `$focus` is active restarts the `scale`
  transition.

**S3, quadratic multi-state merge: Confirmed.** en:1486-1489:

```ts
newStyles = sortedStates.reduce((acc, state) => {
  const styles = this[state];
  return styles ? { ...acc, ...styles } : acc;
```

A `slice().sort()` with a closure is added when `stateOrder` is set
(en:1473-1483). With 1 state and a prior undo, it allocates
`{ ...stylesToUndo, ...newStyles }` (en:1466-1468).

**S4, undo allocations: Confirmed.**

- `stylesToUndo = {}` and a `forEach` closure (en:1439-1453);
- `_undoStyles = Object.keys(...)` (en:1493), and `= []` (en:1459, 1502);
- the `theme` getter allocates `{}` once per node (en:1221-1224).

**S5, `keyExists` uses `in`: Confirmed.** core/utils.ts:69-79.

- On nodes without state styles (Rows, Columns, wrappers), `in` misses after
  walking the instance, `ElementNode.prototype` and `Object.prototype`.
- It runs only when `_undoStyles` is empty, which is once per `_stateChanged`.

**S6, `forwardStates` overwrites: Confirmed.**

- en:1419-1425 assigns `c.states = this.states.slice()`.
- `merge` with an array does `this.length = 0; this.push(...newStates)`
  (states.ts:69-71), which replaces the child's own states.
- Each child then runs a full `_stateChanged` with no change detection (S1).

**S7, `parseAndAssignShaderProps`: Confirmed.** en:175-204. Per call it
allocates:

- the `borderSideMap` literal (en:183-188);
- `Object.entries` with its pairs (en:194);
- a `forEach` closure;
- one template key per entry (en:202).

That is **11 allocations** for the 4-key `$focus` border and **7** for the
2-key base border. On v2 each key is then a facade setter, and `border-w`
allocates a `toVec4` array (see §4.4 for the stray `border` field).

**S8, gradients: Confirmed.**

- `linearGradient` and `radialGradient` use `createRawShaderAccessor`
  (en:1808-1818): `this.shader = [key, value]`, which allocates an array.
- Then `renderer.createShader(...shaderProps)` (en:985-991) creates a **new
  `ShaderNode`** on every set: a values object, a facade and a slot lookup.

**S9, `setTimeout` per prop: Confirmed.** en:1045-1048. Every animated prop
write on a node that has `onAnimation.stopped` schedules a timer plus a
closure.

### Layout (`flex.ts` and `flexLayout.ts`)

**L1, allocations per pass: Confirmed** in both files. Per pass:

| Allocation                   | `flex.ts`  | `flexLayout.ts` |
| ---------------------------- | ---------- | --------------- |
| index array plus growth      | :25        | :56             |
| 7 `Float32Array`s            | :98-104    | :137-143        |
| `doCrossAlign` closure       | :179-202   | :259 / :279     |
| `preFlex${dim}` template key | :247, :268 | :326, :347      |

On V8, typed arrays up to 64 bytes are on-heap; with 17 or more children they
move to off-heap backing stores.

**L2, unconditional writes: Confirmed.** Every child's `x`/`y` is assigned
through the accessor:

- `flex.ts` :237, :254, …;
- `flexLayout.ts`, in the same places.

`_sendToLightningAnimatable` then:

- either writes directly, and v2's `setF` returns early on an equal value
  (rv2 `Node.ts:116-123`);
- or, on a child with `transition` covering `x`/`y`, calls `animateProp` and
  **restarts a transition to the same value**.

**L3, production `console.warn`: Confirmed.** `flex.ts:160-162`.
`flexLayout.ts` has none.

**L4, two implementations: Partly. This one matters for the benchmark plan.**

- elementNode.ts:22-24 chooses with `import.meta.env?.VITE_USE_NEW_FLEX`.
- `solid-demo-app-1.7/.env` sets `VITE_USE_NEW_FLEX=true`. So **the demo app,
  the compatibility oracle, runs `flexLayout.ts`.**
- The vitest suite runs `flex.ts`: `solid-1.7/.env` has no such variable.
  `tests/contract-flex.test.tsx:9` only logs the variable.
- So does `bench/`, as of this read: its root is `bench/`, it has no `.env`,
  and `bench/vite.config.ts` defines no such variable.
- The A/B/C bench numbers and the demo's `#/benchmark` therefore exercise
  different layout code.

**L5, `$focus` width/height does not reflow: Confirmed.**

- The `w`/`h` setters and `_stateChanged` never call `updateLayout` or
  `addToLayoutQueue` (en:887-901, 993-1032, 1405-1505).

### Nodes

**N1, `ElementNode` size: Confirmed.** The constructor (en:779-825) assigns
**27 own properties**:

- `_type`, `rendered`, `lng`, `children`;
- 23 underscore fields, so 24 counting `_type`. `_calcWidth`, `_calcHeight`
  and `_fontWeight` are among them, though the interface does not declare
  them.

It also allocates the 11-key `lng` bag (`w`, `h`, `x`, `y`, `alpha`, `color`,
`shader`, `clipping`, `text`, `ignoreParentAlpha`, `placeholderColor`) and
the `children` array. That is **3 heap objects per construction**. The bag
becomes garbage at render, when it is replaced by the handle (en:1705), and
`_rendererProps` keeps it in dev only.

Measured own keys after a few presses, in the probe (`isDev`, which adds
`_rendererProps`):

| Node         | Own keys | Expandos (prod) |
| ------------ | -------- | --------------- |
| tile         | 31       | 3               |
| Row          | 46       | 18              |
| Column       | 47       | 19              |
| Virtual view | —        | 21              |

The Virtual view's expandos include `each`, the whole items array, which the
spread writes to the node.

**N2, unknown names written to the v2 handle: Confirmed.** See §4.4.

**N3, child-list cost: Confirmed.**

- `insertChild` and `removeChild` use `spliceItem` (`indexOf` + `splice` +
  a rest array) (en:930-969; core/utils.ts:81-92).
- `cleanChildren` in the universal renderer
  (`while ((removed = getFirstChild(parent))) removeNode(...)`,
  universal.js:171-176) removes index 0 each time. Each removal shifts the
  array, so clearing n children is O(n²). Each removal also adds to the
  layout queue and enqueues a delete.

**N4, class fields: Refuted for `ElementNode`.** See §4.5.

---

## 4. The specific checks

### 4.1 `schedulePostMutation` and v2 `reprocessUpdates`

How v2 behaves:

- `reprocessUpdates(cb)` (rv2 `RendererCore.ts:503-510`) **stores one
  callback; the last one wins**. It sets `frameRequested` and schedules the
  loop.
- `update()` (rv2 `RendererCore.ts:535-590`) runs, per walk:
  `drainPreloads`/`drainForced` → `scene.run` (which zeroes `nodes.writes`) →
  `textEvents.flush()` → `cb = postUpdate; postUpdate = null; cb()`.
- It loops while `writesDuringPass > 0 || postUpdate !== null`, up to
  3 walks. `writes` counts every `markDirty` since the walk began, including
  the callback's own.

Per press, as measured by the probe with v2 semantics emulated:

- **`runPostMutation` runs exactly twice.**
  1. **The microtask** at the end of the keydown task. It does all the work:
     the delete flush, layout (0 passes for a Row press, 2 for a Virtual
     shift), and focus (`updateFocusPath`, states, styles).
  2. **The frame callback.** It finds `postMutationQueued` already false and
     every queue empty, so it is a **no-op**. It writes nothing, so the walk
     is not repeated (`updateIterations` = 1).
- Its only effect is `frameRequested = true`. That is redundant when the press
  already wrote to the store. When the focus change wrote nothing, it forces a
  walk and a draw that v2 would otherwise skip.
- **When the frame callback does real work:** when `schedulePostMutation` is
  first called _during_ a frame. A text `loaded` listener (`_layoutOnLoad`,
  en:1140-1145) is the case. Then:
  1. the listener also calls `parent.updateLayout()` synchronously, which
     writes and so forces a re-walk;
  2. the callback lays out the parents that the first pass queued;
  3. the microtask queued alongside runs after the frame, as a no-op.

  So text changes in flex containers cost 2 or 3 walks. That is consistent
  with the brief's text section.

- **Extra registrations happen** whenever the microtask run re-enters
  `schedulePostMutation`: `updateLayout` → `addToLayoutQueue(parent)`, or a
  deferred `setFocus`. Each one adds one more no-op microtask and one more
  `reprocessUpdates` call.

### 4.2 The infinite loop in `findFirstFocusableChildIdx`

hn:37-53, exactly:

```ts
function findFirstFocusableChildIdx(el, from = 0, delta = 1): number {
  for (let i = from; ; i += delta) {
    if (!idxInArray(i, el.children)) {
      if (el.wrap) {
        i = (i + el.children.length) % el.children.length;
      } else break;
    }
    if (!el.children[i]?.skipFocus) {
      return i;
    }
  }
  return -1;
}
```

**The loop.** With `el.wrap` truthy and every child `skipFocus`:

- the `for` has no condition;
- out-of-range indices wrap back into range, so `break` is never reached;
- `return i` is never reached either.

It spins forever. The `ArrowRight` keydown task never returns, so the TV
hangs.

**How it is reached:**

- `moveSelection` (hn:194), on every arrow press of a `wrap` Row, Column or
  Virtual (`wrap={effectiveWrap()}`);
- `navigableForwardFocus` (hn:114), on `setFocus` of such a container;
- `spatialForwardFocus` (hn:282).

**A related edge case:** `wrap` with **zero** children computes `(i + 0) % 0`,
which is `NaN`. `children[NaN]?.skipFocus` is `undefined`, so the function
returns `NaN`, not -1. It does not hang. `selectChild(el, NaN)` then sets
`selected = -1` and returns false.

### 4.3 `insertChild(before)` and draw order

Solid's `insertChild` reorders only its own `children` array (en:947-956). It
reaches the renderer only through the `parent` setter (en:880-885), which
assigns `this.lng.parent = p.lng`. v2's `parent` setter (rv2 `Node.ts:468-488`)
does this:

```ts
if (old === next) { return; }            // same parent: nothing moves
if (old !== NULL) { s.unlink(id); ... }
if (next !== NULL) { s.appendChild(next, id); }   // appended at the end, zIndex-sorted
```

So the renderer is never told about `before`:

- **A move within the same parent never reorders renderer siblings.** This
  covers `For` and `List` reorders, and the Virtual rotation `n0 → end`.
- **A node inserted before an anchor is appended at the end.** This covers
  `<Show>` toggling a node in front of a sibling, and a not-yet-rendered node
  created through `render()` (en:1544, `props.parent = parent.lng`).

**Does draw order make this matter?** Yes.

- In v2, sibling order **is** z-order (spec §5.3: "The list order is the draw
  order"). `zIndex` only sorts stably at attach time and when it changes.
- Flex positions come from Solid's `children`, so the layout stays right. But
  overlapping siblings with the same `zIndex` draw in the wrong order.
- Example: after a few Virtual shifts the renderer order is arbitrary relative
  to the visual order. A focused `Thumbnail` (`zIndex: 2` like its neighbours,
  `scale: 1.1`, border `align: 'outside'`) then draws _under_ the neighbour on
  one side.
- Example: a `<Show>` overlay inserted before a sibling draws on top of it.

**Renderer API.** There is no public `insertBefore`. `NodeStore` has a
**private** `insertAfter(parent, child, after)` (rv2 `NodeStore.ts:506-509`),
which `appendChild` and `setZIndex` use (:498, :583). A public `insertBefore`
built on it would be inside the brief's allowed integration surface.

### 4.4 Unknown names written to the v2 handle (spec §13.4)

**Paths that write to `this.lng`, the handle, after render:**

| Path                                                                                              | Writes                                                                                        | Unknown names that can reach a `<view>` handle (`Node`)                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LightningRendererNumberProps` accessors (en:225-253, 1772-1781)                                  | `_sendToLightningAnimatable` → `this.lng[name] = value` (en:1030-1031) or `animateProp(name)` | `fontSize`, `lineHeight` (they are `TextNode` accessors only)                                                                                                                                                            |
| `LightningRendererNonAnimatingProps` accessors (en:258-289, 1783-1792)                            | `this.lng[key] = v`                                                                           | `contain`, `forceLoad`, `fontStyle`, `letterSpacing`, `maxHeight`, `maxLines`, `maxWidth`, `offsetY`, `overflowSuffix`, `text`, `textAlign`, `verticalAlign`, `wordBreak` (`TextNode`-only accessors, rv2 `TextNode.ts`) |
| `set fontWeight` (en:903-915), `set fontFamily` (en:921-924)                                      | `this.lng.fontFamily = …`                                                                     | `fontFamily`                                                                                                                                                                                                             |
| `replaceText` (solidOpts.ts:20-26)                                                                | `parent.text = parent.getText()`                                                              | `text`, when a string child sits directly in a `<view>` (the `insertNode` guard at :43-46 does not apply to `replaceText`)                                                                                               |
| `set src`, `set shader`, `_writeShaderTarget`, the `parent` setter, `render()` `child.lng.parent` | known names                                                                                   | none                                                                                                                                                                                                                     |
| Virtual, VirtualGrid, Marquee: `lng[axis]`, `lng.y`, `lng.x`                                      | known names                                                                                   | none                                                                                                                                                                                                                     |

**Getter-only names in the non-animating list:** `absX`, `absY` and
`destroyed` are getter-only on the v2 `Node` (rv2 `Node.ts:233, 876, 886`).
Writing them on a rendered node **throws a TypeError**, because ES modules are
strict. That is a bug, but only if an app sets them.

**How app code reaches the unknown names on a `<view>`:**

- reactive JSX props, for example `maxWidth={…}` on a view;
- state blocks such as `$focus: { fontSize }` applied to a view;
- style objects that mix text props into a view's style.

Before render the same names sit in the creation bag, and `applyNodeProps`
ignores them (rv2 `applyProps.ts:153-155`). So only post-render writes add
fields. A non-renderer key cannot reach the handle through `setProperty`:
that writes to the `ElementNode` (solidOpts.ts:27-29).

**The shader facade.** This is not the node handle, but the same hidden-class
concern applies.

- `parseAndAssignShaderProps` writes `props[actualPrefix] = obj` (en:193): the
  name `border`, or `shadow`.
- The v2 facade has no such prop. Its props are `border-w`, `border-color`, …,
  and `shadow-*` (rv2 `Box.ts:73-100`).
- So every `ShaderNode` facade grows an own `border` or `shadow` data field.

### 4.5 Class-field emit

Transforms of `src/core/elementNode.ts`, `nodeTypes.ts` and `states.ts` are in
`.../scratchpad/classfields/*.js`:

- **modern:** rolldown 1.1.5 `transformSync`, target `chrome64`,
  `assumptions: { setPublicClassFields: true, noDocumentAll: true }`, as in
  the demo's `rolldownOptions.transform`;
- **legacy:** that output, then Babel `preset-env` 8.0.2 with targets
  `chrome 38` and the demo's `legacy()` assumptions.

**`ElementNode` has no class fields.** Its members are declared on the merged
`interface ElementNode` (en:309-775). The class body starts with the
constructor.

- In every variant (esnext, modern, legacy) the constructor is the same
  **27 plain `this.x = …` assignments**.
- There are **no `defineProperty` calls, no `_defineProperty` and no
  `__publicField`**.
- Legacy wraps the class in `_createClass(function ElementNode(name){…})`, and
  defines the prototype accessors once, at module load.
- The demo's comment in its `vite.config.js` ("ElementNode alone has ~70
  fields") is inaccurate for current Solid.

**`TextNode` has 3 class fields** (nodeTypes.ts:10-17): `_type = 'text'`,
`parent = undefined`, and `text: string`. One `TextNode` is created per JSX
text child. Its emit depends on the tsconfig:

- With the assumption applied: `this._type = "text"; this.parent = undefined;
this.text = void 0; this.text = text;`. The redundant `void 0` comes from
  `useDefineForClassFields`, which defaults to true for `target: ESNext` in
  `solid-1.7/tsconfig.json`.
- **When rolldown resolves `solid-1.7/tsconfig.json`**, which it does when
  given the real file path, the tsconfig wins over
  `assumptions.setPublicClassFields`. The output is then **three
  `_defineProperty(this, …)` helper calls per `TextNode`**, in the modern
  bundle and in the legacy one (verified: same source, basename versus full
  path versus `tsconfig: false`).
- Whether Vite 8's `vite:oxc` plugin resolves the tsconfig this way for
  `@solidtv/source` files was **not verified**: the demo app was not built.
  Grep the built demo bundle for `_defineProperty(this, "_type"`.
- Setting `"useDefineForClassFields": false` in `solid-1.7/tsconfig.json`
  would make the output plain assignments either way. It does not affect
  `ElementNode`.

**`States`** has `private onChange` (states.ts:9). That emits
`this.onChange = void 0` after `super()`, or `_defineProperty` under the same
tsconfig condition.

In legacy, `class States extends Array` becomes `_wrapNativeSuper(Array)`.
On Chrome 38 (no `Reflect.construct`), every construction then goes through:

- `_construct` → `new (Array.bind.apply(Array, [null, …]))()`;
- `setPrototypeOf(instance, States.prototype)`;
- the `_super` closure, `_args`, `[].concat` and `_toConsumableArray`.

`Object.entries` needs a polyfill on Chrome below 54.

Chrome below 51 has no `Symbol.species`, so `splice` there makes plain
arrays. On Chrome 51-63, which also gets the legacy bundle, the species path
runs and costs about 10 allocations plus `setPrototypeOf` per blur.

**Legacy assumptions that could pay off on the hot path.** The demo's
`legacy()` assumptions do not include `setSpreadProperties`,
`iterableIsArray` or `skipForOfIteratorClosing`. Without them:

- object spread compiles to `_objectSpread` with `_defineProperty` per key
  (the transition merge on every press, and `combineStyles`);
- `for…of` compiles to `_createForOfIteratorHelper` (`keyExists` on every
  `_stateChanged`).

That is a demo build-config option, not a Solid change.

### 4.6 Field counts

- `ElementNode` own fields at construction: **27**, of which 24 start with
  `_`. It also allocates the 11-key `lng` bag and a `children` array.
- Expandos added at runtime, measured: tile **+3** (`transition`, `$focus`,
  `item`), Row **+18**, Column **+19**, Virtual view **+21** (§3, N1).
- V8 hazard: own-property additions through _keyed_ stores, which is what
  `setProperty` does, normalise an object to dictionary mode once its
  out-of-object fields exceed `max(12, in-object count)`. For `ElementNode`
  that threshold is about 27 or more. The heavy containers are under it today.
  Worth checking with `%HasFastProperties` on a deep page.

### 4.7 Handler storage and lookups

- `onUp`, `onDown`, `onLeft`, `onRight`, `onEnter`, `onFocus`, `onBlur`,
  `onFocusChanged`, `onSelectedChanged` and the custom `on<Key>` handlers are
  **per-instance own properties**, written by `setProperty` → `node[name] = value`.
- `onLayout` is the only accessor (en:1349-1360). `onRender`, `onCreate` and
  `onRemove` are plain properties too.
- Dispatch lookups are `elm[eventHandlerKey]` and `elm[captureEvent]`. Their
  keys are template strings **built per key event** (fm:307, 339-340), shared
  across the elements of the walk.
- `updateFocusPath` uses static names (`onFocus`, `onBlur`, `onFocusChanged`),
  but on varied hidden classes.
- `emit()` builds `` `on${…}` `` per call (en:1098). It is not on the key path.

---

## 5. A Virtual window shift

The case is a VirtualRow with `displaySize` 6, `bufferSize` 2 (8 children)
and Thumbnail tiles, pressing ArrowRight when `computeSlice` moves `start`.
The steps are in order.

1. **Keydown dispatch** runs as in §2, A1-6. `onRight` is
   `handleNavigation('right')`, with no wrapper. The per-press transition is
   allocated and unused (R1).
2. **`selectChild`** → `child.setFocus()`, which schedules
   `runPostMutation` twice. Then Virtual's `onSelectedChanged`
   (Virtual.tsx:402-476):
   - the `setCursor` updater closure;
   - `computeSlice` → `SliceState` and `items().slice()`;
   - `setSlice`.

   These are signal writes inside the handler's `runWithOwner`. The `List`
   memo runs synchronously; the effects wait until the handler returns. The
   handler also does `queueMicrotask(() => {…})` (Virtual.tsx:451): 1 closure.

3. **The handler returns.** Effects then run:
   - the **spread effect** re-runs over about 22 props and writes `cursor`
     (G1);
   - the **`insert` effect** reconciles the rotation (G3).

     Allocations: `normalizeIncomingArray`, a `Map`, `splice` results, rest
     arrays, `[j]` arrays ×8, `temp`, a `Map` and a `Uint8Array` in the list.

     Calls: `insertNode` ×2 → `insertChild`; `removeNode` ×1 →
     `removeChild` ×3 in total; `render(true)` ×2, both early returns that
     add to the layout queue; `enqueueDelete` ×3; the recycled tile's
     `item()` setter runs its reactive props.

4. **Microtask 1, `runPostMutation`:**
   - delete flush: nothing is destroyed;
   - **flex pass 1** over 8 children, with `[...layoutQueue]`, 7 typed
     arrays, the index array and the closure;
   - the focus phase as in §2 B (about 38 allocations).
5. **Microtask 2, Virtual's own:**
   - **flex pass 2**, which is redundant;
   - `computeSize` returns the cached value, or else the `style?.focus` path
     (R3);
   - `this.lng.x = …` directly;
   - `this.animate({ [axis]: target }, { ...this.animationSettings, duration })`
     (Virtual.tsx:465-471), with `performance.now()`. That is **2 objects and
     a new `Animation` every shift**, about 12 objects plus a Promise. Unlike
     `animateProp`, it never reuses the controller.
6. **The frame.** The `reprocessUpdates` callback is a no-op, and there is
   1 walk. If tiles contain text whose content changed on the recycled node,
   layout, `loaded` and `_layoutOnLoad` can add a third flex pass and a second
   walk (§6).

**Total:** roughly 150 framework allocations per shift.

- **2 flex passes**, each with about 20 property reads per child, and 16
  accessor `x` writes;
- 3 `indexOf`-based list operations, plus `getNextSibling` scans;
- 1 new `Animation`;
- no `ElementNode` or renderer-node creation.

A press _within_ the window still costs, on top of the plain-Row press:

- a `SliceState`;
- the `setCursor` closure;
- the `List` diff: `temp`, a `Map`, a `Uint8Array(0)` and a `splice` result;
- `normalizeIncomingArray`, and `reconcileArrays` with one `getNextSibling`
  scan;
- the spread re-run.

That is about 10 more allocations and about 3·L more loop iterations than a
plain Row press.

---

## 6. Text leads (the pointer from Layout)

- `flex.ts:32-34` and `flexLayout.ts:64-66` return early, without layout, when
  a text child has `text` but no `width` and no `height`. **Confirmed.**
- `_layoutOnLoad` (en:1140-1145) is registered at render when the parent
  requires layout and the text lacks `maxWidth` or `maxHeight` (en:1639-1643),
  or for `autosize` (en:1726-1728).
  - On every `loaded` it calls `schedulePostMutation()` **and**
    `this.parent!.updateLayout()` synchronously, so up to 2 flex passes per
    load.
  - It is **never removed** (there is no `off`).
  - **Confirmed.**
- `getText` re-concatenates on every insert, remove and replace
  (solidOpts.ts:25, 45, 60; en:1147-1156). **Confirmed.**

---

## 7. What the survey missed on the key-press path

1. **keyup doubles the dispatch work, for nothing.** It repeats the closure,
   `runWithOwner`, `Effects`, `keyIdentities`, `performance.now()` and
   2 strings. It runs a full capture walk _and_ a full bubble walk, because
   nothing handles `on<Key>Release`, and allocates a result object. That is
   about 8 allocations and about 5·D keyed misses per press (fm:556-566,
   644-652).
2. **Solid's own render effect on `activeElement`** (render.ts:76-83) runs on
   every focus change: `cleanNode` and a re-subscribe.
3. **`Config.setActiveElement` costs about 6 allocations per change** under
   `useFocusManager`: an arrow closure, `runWithOwner`'s `Effects`, and
   `writeSignal`'s `runUpdates` closure, `Updates` array and `runEffects`
   closure (fm:630-631; sj:550, 687-717, 850-866). `_signalWrapper` adds a
   closure and an `Effects` array for `setFocusPath` (fm:279).
4. **v2 `animateProp` allocates a Promise each time it restarts a finished
   animation** (rv2 `Animation.ts:440-451`, cleared at :453-457 and :626).
   That is up to 3 per Row press: `x`, `scale` in, `scale` out. Solid never
   reads it on the transition path.
5. **Changing direction recreates the `x` controller.** `animateProp` reuses
   a controller only when given the identical settings object (rv2
   `Node.ts:942-956`). `handleNavigation` makes `transition.x` alternate
   between `defaultTransitionBack.x` and `defaultTransitionForward.x`. So
   every Left↔Right change pays `stop()`, a new `Animation` (about 12 objects,
   4 of them typed arrays) and a slot object.
6. **The `border-w` facade write always allocates and always repacks.** v2
   `vec4Prop.resolve` → `toVec4` returns a new array, and object values
   always store and mark (rv2 `Box.ts:41-44`, `ShaderRegistry.ts:1003-1016`).
   So each `$focus` apply or undo with a border allocates and marks
   `DIRTY_SHADER` even when the width is unchanged. The next visit rebuilds
   the params key string.
7. **`$focus` undo restores only the keys the base style has, a behaviour
   bug.** `border-gap` and `border-align` written by `$focus` are not reset,
   because the base `border` object lacks them. After the first focus and
   blur, an unfocused tile keeps `gap: 4`. That is invisible with
   `width: 0`, but visible with a non-zero base border (en:1438-1459 with
   en:175-204). Pin it with a test before the rewrite.
8. **The Virtual transition merge is dead work** (R1, §5).
9. **Virtual animates the row with `this.animate(...)` per shift, never with
   `animateProp`.** That is a new controller plus a settings spread each time
   (Virtual.tsx:465-471).
10. **The `States` array-subclass methods probably run V8's generic
    builtins** (F6). Confirm it in the profile.
11. **Megamorphic misses through the prototype chain.** `withScrolling` reads
    about 25 properties per press, and several more are misses in
    `selectChild`, `moveSelection` and the dispatch walks: `throttleInput`,
    `skipFocus`, `plinko`, `forwardFocus`, `onFocus`, `onBlur`,
    `onFocusChanged`, `scrollIndex`, `centerScroll`, `onScrolled`, …
    `ElementNode.prototype` holds about 60 accessors, so each miss walks it.
12. **The bench and the demo use different flex code** (L4).
13. **`removeChild` leaves `node.parent` set.** The next `insertChild` of that
    node then pays a full `indexOf` miss in `node.parent.removeChild(node)`
    (en:936-937, 959-969).
14. **`'reprocessUpdates' in renderer.stage`** is checked on every
    `schedulePostMutation` call, through the `stage` getter (en:96).

---

## 8. Bugs found

1. **Infinite loop.** `primitives/utils/handleNavigation.ts:42-51`, with
   `wrap` and every child `skipFocus` (§4.2). Reached from `moveSelection`,
   `navigableForwardFocus` and `spatialForwardFocus`.
2. **`style?.focus` should be `$focus`.**
   - `primitives/utils/withScrolling.ts:127` is latent on v2: `scale` always
     reads `scaleX`.
   - `primitives/Virtual.tsx:104` is live. `factorScale` never sees the
     `$focus` scale, and the `style` getter allocates `{}` when there is no
     style.
3. **Draw order diverges from Solid's child order.** It happens after any
   `insertChild(node, before)` or same-parent move (en:930-957 with rv2
   `Node.ts:468-488`). Overlapping siblings with equal `zIndex` draw out of
   order, which hits Virtual rows with a scaled `$focus` and `<Show>` before
   an anchor. There is no public renderer `insertBefore`.
4. **Text-only names written to a `<view>` handle after render** add own
   fields to the v2 `Node` handle (§4.4; en:225-289, 903-924, 1030,
   1789; solidOpts.ts:25). This violates the spec §13.4 invariant whenever an
   app sets them.
5. **Getter-only renderer props in the forwarded list.** `absX`, `absY` and
   `destroyed` are in `LightningRendererNonAnimatingProps` (en:259-260, 267).
   Writing them on a rendered node throws a TypeError on v2.
6. **`$focus` undo leaves shader sub-props set** that the base style does not
   name, for example `border-gap` and `border-align` (§7, item 7).
7. **`findFirstFocusableChildIdx` returns `NaN`, not -1,** when `wrap` is set
   and there are no children (hn:45). This is benign today.
8. **Measurement validity, not a `src` bug.** The bench runs `flex.ts`; the
   demo runs `flexLayout.ts` (`solid-demo-app-1.7/.env`,
   `VITE_USE_NEW_FLEX=true`).

---

## 9. Likely top costs per key press

These are estimates from code reading and the probe counts, for the coordinator
to check against CPU profiles. Solid framework only.

### ArrowRight within a Row

1. **State styles on focus change.** Two `_stateChanged` calls (en:1405-1505)
   do:
   - `Object.assign` through accessors;
   - 2 shader-prop parses, about 18 allocations with non-internalised keyed
     stores into the facade;
   - v2 facade setters, `toVec4` and `DIRTY_SHADER` marks;
   - 2 `animateProp` calls with Promise restarts;
   - the species construction on `remove` (4 allocations, generic `splice`);
   - the undo bookkeeping.

   This is about 30 of the about 56 framework allocations.

2. **Reactive work per focus change.** It includes:
   - `Config.setActiveElement` and `setFocusPath`, which are 2
     `runWithOwner`/`runUpdates` passes (about 9 allocations);
   - Solid's own `activeElement` effect;
   - **every app effect on `activeElement`**;
   - unbatched signal writes in `onFocus`, `onBlur` and `onFocusChanged`,
     each flushing on its own. In the demo, Portal-style reactive text colours
     each flush separately.
3. **Key dispatch, doubled by keyup.** Two `runWithOwner` passes,
   2 `keyIdentities` arrays, 4 template strings, and capture walks over the
   full path on both events plus a full bubble walk on keyup. That is about
   32 keyed megamorphic misses for D = 4, linear in page depth.
4. **`updateFocusPath`.** The D-ancestor walk with `states.has` on an
   `Array` subclass (probably the generic `indexOf`), 3 handler lookups per
   element, the O(D²) diff, the fresh `fp` array, and the add/remove
   bookkeeping on the ancestors. Down/Up also runs `_stateChanged` on 2 Rows.
5. **`scrollRow`/`withScrolling` plus the `x` write.** About 25 property
   reads, many of them prototype-chain misses; `_sendToLightningAnimatable`'s
   transition lookups and `in` check; `animateProp`, which on a change of
   direction makes a new `Animation` with typed arrays.
6. **The `handleNavigation` transition merge.** 1 object per press, or 2
   `_objectSpread` calls with `defineProperty` per key on the legacy bundle.
7. **Hidden-class and megamorphic overhead** on every `ElementNode` property
   access. Containers carry 18-21 expandos in varied orders; handlers and
   state blocks are expandos read with computed keys.
8. **Allocation pressure overall:** about 56 framework allocations plus about
   15 renderer allocations per press in the modern bundle, about 80 more in
   legacy. The GC cost is amortised, but it shows as dropped frames on TVs.
9. **`schedulePostMutation` double registration.** The microtask plus
   `reprocessUpdates`: the frame run is a no-op that still forces a frame.
   Small per press.
10. **Renderer side, for the first frame:** one full walk of the visible tree,
    shader repacks for 2 tiles (the params key string), then about 15
    animation frames, each with a walk and a draw.

### VirtualRow or VirtualGrid press that moves the window

The Row costs above, plus, in about this order:

1. 2 flex passes, each with 7 typed arrays, the index array, the closure,
   about 20 property reads per child and an accessor write per child.
2. `List` diff and reconcile: a `Map`, a `Uint8Array`, a `[j]` array per item,
   3 `indexOf`s per move, `getNextSibling` scans and `splice` results.
3. The full spread re-run on `cursor`.
4. A new `Animation` from `this.animate` per shift.
5. `SliceState`, the `setCursor` closure and the `slice` array.

Node creation is **not** on this path: `List` recycles nodes.

---

## 10. Uncertain, or not verified here

- Timings: none were taken, per the shared rules. The probe counts calls.
- The V8 generic-builtin behaviour of the `States` `Array` subclass
  (`indexOf`, `push`, `splice`) is inferred from V8's fast-path conditions.
  Confirm it in a CPU profile.
- Whether the demo's modern bundle emits `_defineProperty` for `TextNode` and
  `States` depends on Vite 8 resolving `solid-1.7/tsconfig.json` for source
  files. Not built (§4.5).
- Allocation counts are upper bounds; V8 escape analysis may remove the
  short-lived result objects and closures in optimised code.
- The probe ran on the DOM renderer, which has no `animateProp`. So `animate`
  and `animateProp` reuse on v2, Promise restarts and facade writes come from
  code reading of `renderer-v2-solid`, not from measurement.
