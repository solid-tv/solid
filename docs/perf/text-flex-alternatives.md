# Text measurement and flex layout: alternatives review

Draft section for the Checkpoint 1 design spec
(`docs/superpowers/specs/<date>-solid-1.7-design.md`), written 2026-10-03.
It answers the brief's "Text measurement and flex layout" section: how it
works today, alternatives 1 to 9, and a recommendation.

Code read: `solid-1.7` at `517094d` (solid 1.6.4 + the renderer-v2 lockstep
patch, arm B/C), `renderer-v2-solid` at `faf4b9f`, and renderer 1.9.3 (arm A,
`bench/.arms/renderer-a`) for comparison. Line numbers are at those commits.

**All numbers are indicative.** They come from short runs on a shared
14-core Apple M4 Pro (48 GB; load average 3 to 5 while other agents ran),
Node 24.13.0, and Playwright 1.56 headless Chromium with SwiftShader. No CPU
throttling. Chromium's `performance.now()` resolution there is 100 µs (I
measured it), so the per-press millisecond figures from the browser are
averaged over many presses and remain coarse. The structural counts are
exact: walks, `loaded` events, flex passes and layouts. The coordinator's
throttled benchmark suite should confirm the CPU figures.

## Summary

- **Today, a text change inside a flex container costs two scene walks per
  frame.** The text is laid out in walk 1. Its `loaded` event runs Solid's
  flex between the walks, and the flex writes force walk 2.
- **Flex runs once per `loaded` event, not once per container.** In a
  details-panel scenario (title, description, metadata row with badges),
  one press ran **12 flex passes over 4 containers**: the panel 4 times and
  the metadata row 4 times.
- **Text under a culled ancestor is never laid out, so its flex container
  waits.** The ancestor may be out of bounds or have world alpha 0. In a
  Row of 20 flex tiles, 11 tiles (22 texts) are never laid out until they
  scroll into the bounds margin. Arm A gates text layout the same way.
- **A synchronous `TextNode.measure()` fixes this.** It lays the text out
  into the same `LayoutCache` that the walk reads. I prototyped it in
  scratch copies: about 60 lines in the renderer and 45 in Solid. Solid
  calls it in its post-mutation pass, before flex.
  - Details panel: **1 walk instead of 2**, **0 `loaded` events instead of
    6**, **5 flex passes instead of 12**, and **0 layouts in the walk**,
    because the walk reuses the measured layouts.
  - Final positions are identical.
  - Ordering the layout queue by depth would bring this to 1 flex pass per
    affected container.
- **Cheaper text measurement inside the renderer.** Both changes stay within
  the brief's "text measurement" boundary:
  - A cache keyed by the text string, with the other props compared field
    by field: **0.02 µs instead of 0.36 to 0.71 µs per lookup, and no
    allocation instead of 0.9 to 1.1 kB.**
  - Typed-array advance and kerning tables for the line breaker: **3.2×
    faster for a title and 2.3× faster for a description.** Lines and widths
    are bit-identical in 17,100 cases.
- **Rejected:**
  - A separate width-only fast path, because the walk would then lay the
    text out a second time.
  - Size estimates before the font description loads, because they are
    13% to 26% wrong.
  - Flex inside the renderer walk, which touches `ScenePass` (out of
    bounds). It goes to `renderer-proposals.md`.
  - Yoga, Taffy and css-layout: wasm (Chrome 57+), 80 kB gzip for asm.js,
    or different semantics.

---

## 1. How it works today, verified

### 1.1 The brief's claims

| #   | Claim (brief)                                                                                                                                     | Verdict                                                     | Evidence and corrected description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | `flex.ts` (~l.32) gives up on the whole container pass when a text child has text but no width/height                                             | **Confirmed**                                               | `src/core/flex.ts:32-34`, `src/core/flexLayout.ts:64-66`: `if (isElementText(c) && c.text && !(c.width \|\| c.height)) return false`. The pass returns before any write and does not propagate up. `width` is `maxWidth \|\| w` (`elementNode.ts:887-901`), so text with a `maxWidth` (`contain`) never bails. **Extra finding:** the bail is tested _before_ `flexItem === false` (`flex.ts:36`, `flexLayout.ts:68`), so an unsized text with `flexItem={false}` blocks the whole container. Both implementations behave the same; the demo app uses `flexLayout.ts` (`solid-demo-app/.env`: `VITE_USE_NEW_FLEX=true`), while the tests and the default build use `flex.ts` (`elementNode.ts:22-24`).                                                         |
| b   | `_layoutOnLoad` listens for `loaded`, schedules the post-mutation pass and calls `parent.updateLayout()` synchronously: two flex passes per load? | **Partly**                                                  | `elementNode.ts:1140-1145`. The listener is registered at render when the parent requires layout and the text lacks `maxWidth` or `maxHeight` (`:1639-1643`; also `:1726-1728` for `autosize`). `schedulePostMutation()` (`:93-100`) adds **nothing** to `layoutQueue`, so it does not cause a second pass of the same container. Each load runs **one synchronous pass of the parent**. If the parent's size changed, `updateLayout` queues the grandparent (`:1387-1389`), and the post-mutation pass runs it, and so on up the tree. **The real multiplier is per text:** a container with _k_ texts that relaid gets _k_ synchronous passes in one frame. Measured: per details-panel press, panel ×4, metadata row ×4, badges ×2-4, for 12 passes (§1.2). |
| c   | The listener is never removed                                                                                                                     | **Confirmed**                                               | No `off(` anywhere in `src/core` (only the DOM renderer's own `once`). The listener lives as long as the node. It fires on **every** relayout of that text, whether or not the size changed: `TextNodes.ts:107-112` queues `loaded` whenever a layout is made and a listener exists. It also fires if the parent later stops requiring layout.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| d   | Text children are re-concatenated (`getText`) on every insert and update                                                                          | **Confirmed**, cheap                                        | `elementNode.ts:1147-1156`; called from `solidOpts.ts:20-26` (`replaceText`), `:43-46` (`insertNode`), `:58-61` (`removeNode`) and `render()` (`elementNode.ts:1591`). A single child returns its string without allocating; _n_ children build one new string per update, which is O(n²) at mount. In practice n is 2-3 (`{votes} reviews`). The cost is tens of ns. The only consequence worth noting: each update makes a fresh string object, whose hash a text-keyed cache must compute once (0.11 µs instead of 0.02 µs, §2.4).                                                                                                                                                                                                                          |
| e   | v2 lays text out inside the scene pass, during the node's visit, once the font description is there; the atlas is not needed                      | **Confirmed**                                               | `ScenePass.ts:350-364`: `DIRTY_LAYOUT` is handled first in the visit, before the transform and before the node's own culling. `TextNodes.ts:83-90` waits for `font.font` (the description); atlas readiness gates only drawing (`:115-123`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| f   | `loaded {type:'text', dimensions}` is queued and delivered between walks; Solid's flex writes re-run the walk (up to 3)                           | **Confirmed**                                               | Queued in `TextNodes.ts:107-112` only when a listener exists; the payload allocates 2 objects. Delivered at `RendererCore.ts:572` (`textEvents.flush()`), then the `reprocessUpdates` callback at `:574-578`. The walk repeats while `writesDuringPass > 0 \|\| postUpdate !== null`, up to 3 walks (`:580-584`). Writes are counted by `markDirty` (`NodeStore.ts:472-492`). The in-walk layout size uses `applySizeInVisit`, which does not count (`NodeStore.ts:573-581`).                                                                                                                                                                                                                                                                                  |
| g   | A text whose size changes in a flex container costs a walk, the layout, the event, a flex pass and a second walk                                  | **Confirmed, refined**                                      | The second walk happens **only when the flex pass writes**. Setters ignore equal values (`Node.ts:116-123`). If a relayout keeps its size, the event and the flex pass still run, but the frame has one walk: the handler's `reprocessUpdates(cb)` is consumed in the same iteration. A third walk needs a layout in walk 2, for example flex writing `width` on a text child (`flexGrow`, `minWidth`), which becomes `maxWidth` and a relayout. Sequence and counts: §1.2.                                                                                                                                                                                                                                                                                    |
| h   | Layouts are cached in an LRU (`textLayoutCacheSize`, default 250), keyed by a string `layoutKey` builds on each lookup                            | **Confirmed**                                               | Default 250: `RendererCore.ts:65`. Shared by every node, keyed by content. The LRU is a `Map` with delete and re-set on every hit (`TextLayout.ts:957-966`), trimmed on insert and at idle `maintain` (`Renderer.ts:617`). `layoutKey` (`TextLayout.ts:991-1017`) concatenates the font id and 10 props, text last. "Per lookup" means per relayout of a stale node in its visit (`TextNodes.ts:93-99`), **not per frame**. It costs 0.36 µs for a title and 0.71 µs for a description, plus 0.9-1.1 kB of garbage: the cons-string chain and its flattening (§2.4).                                                                                                                                                                                           |
| i   | After creation, `w`/`h` on a text node map to `maxWidth`/`maxHeight`                                                                              | **Confirmed**                                               | `TextNode.ts:136-147`. In `createTextNode`'s props, `w` and `h` are the size before the first layout (`applyTextProps`, `:474-479`, `setSize` `:377-384`). For Solid, a flex write of `width` on a text child (`flexGrow`, `minWidth`) sets `maxWidth`, which triggers a relayout and possibly wrapping.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| j   | Is text the walk does not visit (culled, hidden, alpha 0) ever laid out? Solid's flex waits for it                                                | **Confirmed, with a nuance**; it waits, usually not forever | See §1.3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 1.2 A text change in a flex container on v2, traced and measured

Here is the sequence for one key press that changes texts in nested flex
containers. The scenario is shaped like the demo app's `ContentBlock`: a
flex column panel with a title, a description (`contain="width"`,
`maxLines={3}`) and a flex row of metadata, which holds two texts and
2-3 badges, each a flex view with a text.

1. **Key handler.**
   - Solid effects run `replaceText`, then `parent.text = getText()`, then
     the renderer's `text` setter.
   - The setter marks the node stale (`DIRTY_LAYOUT`) and schedules a frame.
   - No Solid layout is queued for a text change. Only new nodes (here, new
     badges) queue their parent from `render()` (`elementNode.ts:1523-1525`).
2. **Microtask.** `runPostMutation` runs the queued containers. A new badge
   bails because its text has no size yet.
3. **rAF frame, `RendererCore.update()`**, iteration 1:
   1. Walk 1 lays out every visited stale text and queues one `loaded` per
      text (6 here).
   2. `textEvents.flush()` runs Solid's handler per text:
      `schedulePostMutation()`, which calls `reprocessUpdates(runPostMutation)`
      and `queueMicrotask`, then a synchronous `parent.updateLayout()`. That
      is a flex pass, and it writes x, y and the container size.
   3. The `postUpdate` callback, `runPostMutation`, runs ancestors whose size
      changed.
4. **Iteration 2.** `writesDuringPass > 0`, so walk 2 runs. The stream is
   rewound and every visible node is visited and emitted again, glyphs
   included. No new layouts, so the loop stops.
5. **After the rAF callback.** The microtask `runPostMutation` queued in
   step 3 runs. It is a no-op, a second run of the same pass. The same
   double scheduling happens on every `schedulePostMutation` (focus changes
   too): one run is consumed by the renderer callback, the other by the
   microtask.

Measured with Solid on the real renderer v2 (WebGL, SDF Lato), counters
wrapped around `renderer.update`, `textEvents.queue` and
`ElementNode.prototype.updateLayout`. Median of 60 presses:

| Scenario                                      | Walks in the frame | `loaded` | Flex passes (bails) | Layouts in the walk | Frame `update()` (desktop, mean) |
| --------------------------------------------- | ------------------ | -------- | ------------------- | ------------------- | -------------------------------- |
| S1 details panel press (5-6 texts change)     | **2**              | 6        | **12** (2)          | 6                   | 0.13-0.21 ms                     |
| S2 Row of 20 flex tiles (2 texts each), mount | **2**              | 18       | **40** (20)         | 18 of 40            | about 0.33 ms                    |

These are the flex passes for one S1 press, in order:
`badge, meta, panel, panel, panel, meta, meta, badge, meta, panel`
(and 12 on the next press). Only 4 containers changed.

The re-walk costs roughly a whole frame's walk and emission. v2 rewinds the
stream and re-emits every visible quad and glyph (`RendererCore.ts:567-569`).
HANDOFF's host frame times give the scale: 0.05 to 0.34 ms per drawn frame
on a laptop for stress-tv tiers 1-4. A text-heavy details page sits at the
upper end, and a TV is much slower.

### 1.3 Text the walk does not visit

- **The text node's own culling does not stop its layout.**
  - Layout runs first in its visit (`ScenePass.ts:350-364`), before its own
    bounds and alpha are derived.
  - So a text that is itself out of bounds or alpha 0, under a visible
    parent, is laid out. Marquee's `hidden` texts are an example.
- **A text under a culled ancestor is not visited at all.**
  - Culled means out of bounds including the bounds margin, or world alpha 0
    (`ScenePass.ts:558-562`, and `:272-274` where children are not pushed).
  - Its `DIRTY_LAYOUT` stays pending, so there is no layout and no `loaded`.
  - Solid's flex for its container bails and leaves the children where they
    were.
  - `forceLoad` is the only escape: `TextNodes.drainForced`, `:133-148`,
    lays the text out before every walk.
  - Spec §6 step 5 states the rule ("lay out first if their font is ready
    and their parent is visible").
- **Arm A is the same.** In renderer 1.9.3, `CoreTextNode.allowTextGeneration`
  (`CoreTextNode.ts:122-131`) requires the parent's `worldAlpha > 0` and the
  parent in bounds, unless `forceLoad`. So this is not a v2 regression.
- **Measured (S2):** tiles 9-19 of the 20-tile Row sit beyond the margin.
  - Their 22 texts are never laid out.
  - `tile19` keeps height 10, the row's, where a laid-out tile is 77.12.
  - In S3, a flex container under an alpha-0 view, and one at x = 3000, both
    keep their sibling square at x = 0 through a text change: no `loaded`,
    no flex pass.
  - When they are shown: 2 `loaded`, 2 flex passes, 2 walks. The final
    position is x = 425.44, the same in every arm.
- **Does it wait forever?** Only when the app makes visibility depend on
  that size. For example:
  - a container revealed from `onLayout` or `onEvent.loaded` once a child
    text has a size;
  - a container whose in-bounds position comes from a flex pass that waits
    on its own text.

  Otherwise it waits until the ancestor is visited. On the key-press path
  that means the frame that scrolls a tile into the margin pays the second
  walk.

### 1.4 Related findings

- **`flexItem={false}` text blocks the container.** Bail before the
  `flexItem` test, `flex.ts:32` vs `:36` (and the same in `flexLayout.ts`).
  It is a bug candidate, and fixing it changes layout results only for that
  case.
- **`contain` plus `maxLines={1}` sets `maxHeight` from `lineHeight || fontSize`**
  (`elementNode.ts:1618-1621`).
  - A multiplier `lineHeight` (≤ 3, for example 1.2) becomes
    `maxHeight = 1.2`.
  - The `height` getter then reports 1.2 (`maxHeight || h`), and a flex
    column stacks the next sibling 1.2 px below.
  - It predates 1.7 and is the same in arm A's semantics. It needs a test
    before it is fixed, because it is a layout-result change.
- **Flex pass allocations confirmed.** Per pass: an index array, 7
  `Float32Array`s and the `doCrossAlign` closure. That is about 2.1 kB of JS
  heap per pass, plus off-heap backing stores above 16 children (§2.5).
  `flex.ts:160-162` still has a production `console.warn`.
- **Text color and alpha never reach layout.** On the renderer side only the
  layout props call `relayout` (`TextNode.ts:108-112` and the setters); color
  goes through `setC` and raises `DIRTY_COLOR` only. Solid's state styles
  that change only color or alpha queue no layout.
- **The DOM renderer measures asynchronously.**
  - `scheduleUpdateDOMTextMeasurement` (`domRenderer.ts:1204-1231`) runs on
    `setTimeout`, or on `document.fonts.ready`.
  - It emits `loaded` only the first time or when the size changed
    (`:1143-1153`).
  - Its stage has no `reprocessUpdates` (optional in `domRendererTypes.ts:31`),
    so Solid uses only the microtask there.

---

## 2. Alternatives reviewed

Per-op costs measured in Node, on the renderer's own compiled text code (a
scratch copy of `renderer-v2-solid`), with the demo app's
`Lato-Regular.msdf.json` (123 glyphs, 1,427 kerning pairs, fractional
advances). The corpus has 25 titles of 20-40 characters and 25 synthesized
descriptions of 200-400 characters, laid out at `maxWidth` 900 with
`maxLines` 3. Medians of 7 rounds.

Allocations come from V8's sampling heap profiler at a 1-byte interval,
collected objects included: the method of the renderer's
`test/allocations.ts`. I subtracted the harness's 16 B.

| Operation (desktop, Node 24)                                      | µs/op           | Bytes/op                                           |
| ----------------------------------------------------------------- | --------------- | -------------------------------------------------- |
| `layoutText` title, 30 px, 1 line, no `maxWidth`                  | 1.37-1.56       | about 1,460                                        |
| `layoutText` description, 24 px, `maxWidth` 900, `maxLines` 3     | 13.4-14.8       | about 12,600                                       |
| `mapTextLayout` only (lines and size, no glyph runs), title       | 0.60-0.63       | n/a                                                |
| `mapTextLayout` only, description                                 | 6.5-7.0         | n/a                                                |
| `layoutKey` + `LayoutCache.get` (hit), title                      | 0.36-0.39       | about 850-900                                      |
| `layoutKey` + `LayoutCache.get` (hit), description                | 0.71-0.78       | about 1,120                                        |
| `layoutKey` string build alone, description                       | 0.045           | 40 (cons strings; flattening happens in `Map.get`) |
| Text-keyed `Map` + field compare (hit), title or description      | **0.018-0.020** | **0**                                              |
| Same, with a freshly built text string (hash not cached yet)      | 0.11            | 0 (the bench builds the string)                    |
| `sdfFont.measureText`, whole title                                | 0.52-0.55       | 0                                                  |
| Typed-array advance + kerning measure, whole title                | **0.07-0.15**   | **0**                                              |
| Width-only `fastSize` (w and h, no glyph runs), title             | 0.15            | 0                                                  |
| `measure` on a cache miss (key + get + `layoutText` + set), title | 2.5             | about 2,500 (includes the bench's unique string)   |
| Chromium: prototype `TextNode.measure()`, miss / hit, title       | 2.1 / 0.6       | n/a                                                |

### 2.1 Alternative 1: the status quo (event-driven)

These are the figures of §1.2:

- 2 walks on every frame where a text in a flex container changes size;
- one `loaded` event per relaid text, with a payload of 2 objects;
- one synchronous flex pass of the parent per event (12 passes for 4
  containers in S1);
- flex containers under culled ancestors left unlaid;
- the post-mutation pass scheduled twice per schedule.

It fails the brief's target for a text change in a flex container: one walk
per frame and one flex pass per affected container. **Rejected.**

### 2.2 Alternative 2: synchronous measurement in the renderer (prototyped)

**Renderer side.** About 60 lines, in a scratch copy only; `ScenePass` is
untouched:

```ts
// TextNode (handle accessor surface): a method, no handle field.
measure(): boolean {
  return this.id === NULL ? false : this.renderer.textNodes.measure(this.id);
}

// TextNodes (text measurement; shares layoutText's cache and loaded queue).
measure(id: number): boolean {
  const s = this.nodes;
  const t = s.texts[id] as TextState;
  const font = this.fonts.get(t.fontFamily);
  if (font === undefined || font.font === null) return false; // no description yet
  if (t.stale === false && t.layout !== null && t.font === font) return true; // nothing due
  t.stale = false;
  t.font = font;
  const key = layoutKey(font.id, t);
  let layout = this.cache.get(key) ?? null;
  if (layout === null) {
    layout = layoutText(t, font.font, this.baselineMode);
    this.cache.set(key, layout);
  }
  t.layout = layout;
  s.applySize(id, layout.width, layout.height); // DIRTY_LOCAL | DIRTY_SHADER, composed by the next walk
  s.markDirty(id, DIRTY_LAYOUT); // the visit still places the block and derives readiness
  const node = s.handles[id] as EventEmitter;
  if (node.hasListener('loaded') === true) {
    this.loadedEvents.queue(node, 'loaded', {
      type: 'text',
      dimensions: { w: layout.width, h: layout.height },
    });
  }
  return true;
}
```

**The walk reuses the layout without any change to the walk.**
`TextNodes.layoutText`, the visit hook, already skips the layout when the
text is not stale and the font is the same (`TextNodes.ts:93`). So the visit
only places the block and derives readiness. Measured: **0 layouts in the
walk** after a measure.

**Solid side.** About 45 lines, behind a flag:

- `render()` calls `measure()` instead of registering `_layoutOnLoad`.
  - If `measure()` returns false (no description yet), a one-shot `loaded`
    listener re-queues the parent once.
- A `text` write on a measured text queues its flex parent.
- `updateLayout()` measures the due text children before `calculateFlex`.

Measured with Solid on the real renderer, same harness and scenarios as
§1.2:

| Scenario                    | Arm  | Walks | `loaded` | Flex passes (bails) | Layouts: measure / walk | Final positions                         |
| --------------------------- | ---- | ----- | -------- | ------------------- | ----------------------- | --------------------------------------- |
| S1 details panel press      | now  | 2     | 6        | 12 (2)              | 0 / 6                   | reference                               |
| S1 details panel press      | sync | **1** | **0**    | **5** (0)           | 6 / **0**               | **identical**                           |
| S2 Row of 20 tiles, mount   | now  | 2     | 18       | 40 (20)             | 0 / 18 (22 never)       | tiles 9-19 unlaid                       |
| S2 Row of 20 tiles, mount   | sync | **1** | **0**    | **21** (0)          | 40 / **0**              | all 20 laid out                         |
| S3 culled container, change | now  | n/a   | 0        | 0                   | 0                       | stale until shown, then 2 walks         |
| S3 culled container, change | sync | n/a   | 0        | 2                   | 2 / 0                   | correct while culled; 1 walk when shown |

**CPU.** Per S1 press, three runs each, desktop, means of 55 presses:

| Arm  | Frame `update()`   | Microtask (Solid post-mutation) | Total        |
| ---- | ------------------ | ------------------------------- | ------------ |
| now  | 0.135-0.211 ms     | 0.144-0.164 ms                  | 0.28-0.38 ms |
| sync | **0.055-0.085 ms** | 0.204-0.224 ms                  | 0.27-0.30 ms |

- The frame loses the second walk, the 6 handlers and 7 flex passes.
- The microtask gains the 6 layouts, which move out of the frame.
- On this small scene (about 20 nodes) the net is within noise to about
  −20%. The walk saved grows with visible nodes and glyphs; the layouts moved
  do not.
- At S2 mount the sync arm lays out 22 more texts: the offscreen tiles.
  `measure()` costs 2.1 µs per title on a miss in Chromium.

The 5 flex passes in sync S1 are `panel, badge, badge, meta, panel`. The
panel ran twice because the queue ran it before the metadata row whose size
then changed. Processing the queue deepest first gives 4, one per affected
container (§2.5).

**Boundaries.**

- `TextNode.ts` is node and text-node accessors; `TextNodes.measure`,
  `LayoutCache` and the `loaded` queue are text measurement and `loaded`
  delivery for text. Both are in bounds.
- No handle field: state stays in `TextState`.
- Setters still only store and mark.
- Sizes go through `applySize`, as CLAUDE.md requires for any size written
  outside the visit.

**Verdict: adopt.** It is the core of the recommendation.

### 2.3 Alternative 3: a width-only fast path for single-line text

- **Prototype.** Per-font `Float64Array` advances indexed by code unit
  (`Float64Array` because Lato's advances are fractional), kerning in a
  `Map` or an open-addressed `Int32Array`/`Float64Array` hash keyed by
  `second * K + first`, and `letterSpacing`.
- **Parity.** w and h are bit-identical to `layoutText` for unwrapped text
  in 360 of 360 cases: titles, kerning pairs, digits, curly quotes, missing
  glyphs (fallback), ZWSP and invisible characters, astral characters, runs
  of spaces; 6 variants of size, `letterSpacing` and `lineHeight`.
- **With `maxWidth` set,** the 1.10 breaker measures word by word
  (`wrapLine`). A whole-line sum then differs in 42 of 59 cases by up to
  3.4e-13 px, from summation order. So a width-only path is valid only for
  `maxWidth === 0`, or it must replicate the word-by-word sum.
- **Speed:** 0.15 µs against 1.4 µs for the full layout of a title (9×).
- **Why reject it as a separate path:**
  - Every measured text that is also drawn would pay the fast path _and_
    the full layout in the walk.
  - It adds a second width function to keep in parity with the pinned 1.10
    breaker.
  - It covers only single-line text.
- **Keep instead: the same tables inside the existing breaker.**
  - `mapTextLayout` takes its width function as a parameter. Plugging the
    typed-array measure into it gave **bit-identical lines and widths in
    17,100 cases**: 25 titles, 10 edge strings and 60 descriptions, × 4
    font sizes × 3 `letterSpacing` values × 5 `maxWidth`/`maxLines` pairs
    × 3 `wordBreak` modes.
  - Line breaking: **0.63 → 0.20 µs for a title (3.2×), 7.0 → 3.1 µs for a
    description (2.3×).**
  - This speeds up both `measure()` and the walk's layout with one source of
    truth. In bounds: line breaking and measurement in `TextLayout.ts`.
  - Build the tables lazily per `SdfFont` from the description. That is
    read access. Building them in `parseSdfFont` changes `sdfFont.ts`
    beyond read access, so that would need the user's call.
- **A related option, lazy glyph runs.**
  - `mapTextLayout` is 43% to 45% of `layoutText`; glyph runs are the rest.
  - `measure()` could store lines and size and build glyph runs on first
    draw.
  - That halves the cost of text measured but never drawn: the offscreen
    tiles that eager measuring now lays out.
  - Defer it until a profile shows offscreen measuring.

**Verdict:** reject the separate width-only path. Adopt the typed-array
tables in the breaker (a follow-up commit). Keep lazy glyph runs in reserve.

### 2.4 Alternative 4: cheaper caching

- **Keys that build no string per lookup.**
  - `layoutKey` builds a 21-part cons string; `Map.get` flattens and hashes
    it.
  - That costs 0.36 µs (title) and 0.71 µs (description), plus 0.9-1.1 kB of
    garbage.
  - The prototype uses a per-font-record `Map` keyed by the node's own text
    string, with a chain of entries comparing the other 10 props field by
    field and an LRU by use stamp. Each string object caches its own hash.
  - It costs **0.018 µs and 0 B per hit**, or 0.11 µs for a newly built text
    string, whose hash is computed once.
  - Correctness: there is no hash of the props, so no collisions. The text
    is compared by `Map` equality and the props by `===`.
  - It must keep `LayoutCache`'s contract: bounded to
    `textLayoutCacheSize`, least recently used out first, trimmed at idle.
    Its tests change with it.
  - It is worth one focused renderer commit. The gain per relayout is small
    in µs, but it removes about 1 kB of garbage per text change (priority 4
    in the brief).
- **A per-font map of text to width.**
  - `LayoutCache` already shares whole layouts by content across nodes.
  - A separate width map adds nothing once `measure()` fills the shared
    cache. Not needed.
- **Measurements shared across nodes; virtual lists remount the same titles.**
  - Already true: the cache is keyed by content, not by node.
  - The risk is capacity. With eager measuring (§2.2), offscreen tiles fill
    the cache too.
  - A browse page with 7 rows × 20 tiles × 2 texts is 280 entries, above the
    default of 250.
  - Memory: about 1.5 kB per title layout and about 12.6 kB per description.
  - Measure the hit rate in the benchmark suite's VirtualRow text scenario
    before changing the default.

**Verdict:** adopt the text-keyed cache. No separate width map. Revisit the
cache size with data.

### 2.5 Alternative 5: dirty-tracked layout in Solid

- **Re-run flex only on containers whose children changed size, propagated
  up the tree.**
  - Today `loaded` drives it, with one pass per text: S1 runs the panel and
    the metadata row 4× each.
  - With `measure()`, a text change queues its parent once (`Set`).
  - The queue must run **deepest first**, children before parents. Then a
    parent whose child's size changed is not run before that child.
  - Measured order `panel, badge, badge, meta, panel` would become
    `badge, badge, meta, panel`.
  - Propagation upward already happens only when a pass changed the
    container's size (`updateLayout`'s return, `elementNode.ts:1387-1389`).
- **Skip the relayout when the measured size did not change.**
  - With `measure()`, compare `w` and `h` before and after, and queue the
    parent only on change.
  - Today the event fires and flex runs even when the size is the same
    (§1.1 c, g).
- **Never let a text color or alpha change reach layout.** Already true
  (§1.4).
- **Cost of a flex pass**, as a scale for what fewer passes save:
  - Plain mock nodes in Node: 1.4-1.5 µs for a row of 20 tiles; 0.29-0.36 µs
    for a tile with 2 texts; about 2.1 kB of JS heap per pass in both
    implementations.
  - The real stack in Chromium, with `ElementNode` accessors and v2 setters,
    no writes: **7.3-12.3 µs** for the 20-tile row and **1.2-1.4 µs** for a
    tile.
  - Accessors and setters cost 5-8× the algorithm itself.
  - In S1, going from 12 passes to 4 saves about 8 passes (about 10-15 µs
    desktop) and about 17 kB of garbage per press.

**Verdict:** adopt the depth-ordered queue and the unchanged-size skip. The
`Float32Array` and closure allocations belong to the flex rewrite (the
brief's "Layout" lead), outside this section.

### 2.6 Alternative 6: not waiting on text that cannot affect layout

- **Text with a fixed width and `contain`.**
  - Solid already registers no listener when both `maxWidth` and
    `maxHeight` are known (`elementNode.ts:1640`).
  - Flex does not bail when `width` (`maxWidth`) is known.
  - A multi-line `contain="width"` text still needs its height in a column,
    so it rightly waits.
- **`flexItem={false}`.** Fix the order in `flex.ts` and `flexLayout.ts`:
  skip the child before the text bail, and do not measure it or listen for
  it. This changes results only where it unblocks a container that is
  blocked today. Pin it with a test.
- **Containers whose size and positions do not depend on that child.**
  - For example, the last child of a `flexBoundary="fixed"` row with
    `flexStart`.
  - The gain is marginal and needs per-mode dependency rules. Not
    recommended: with synchronous measuring nothing waits anyway.

**Verdict:** adopt the `flexItem` fix (a bug fix, recorded in
`MIGRATION-1.7.md`). Nothing else.

### 2.7 Alternative 7: before fonts load

- **Today (both arms):** hold.
  - Text waits for the font's description; flex bails; the first walk after
    the description arrives lays the text out and the `loaded` path runs.
  - `loadFonts` resolves only once the atlas is uploaded
    (`FontRegistry.ts:324-326`). The description, about 141 kB of JSON for
    Lato, lands first (`:246-247`).
- **Estimation.**
  - Average advance × length is off by **−12.6% to +25.8%** (median +21%)
    on the corpus with Lato's own average advance.
  - With a font-agnostic 0.5 em it is off by −16.5% to +20.2%.
  - Without the description only the font-agnostic guess is available.
  - Every correction moves siblings visibly. If they have `transition` set,
    the correction animates, and each correction is one more flex pass and
    one more walk.
- **Recommendation: hold.**
  - `measure()` returns false until the description is there.
  - Solid then falls back once to a one-shot `loaded` listener (prototyped),
    the old path but only for the first layout.
  - Apps preload with `loadFonts` at startup, so the window is the first
    screen only.

**Verdict:** hold, as today. Reject estimation.

### 2.8 Alternative 8: flex inside the renderer's walk (on paper)

- **What it would buy.** Text size is known in the visit; no event, no
  re-walk, no Solid pass.
- **Why not for 1.7:**
  1. It changes `ScenePass`, which is out of bounds, and the `NodeStore`
     layout (flex props per node in new typed arrays), also out of bounds.
  2. Flex with content-sized containers needs a bottom-up measure and a
     top-down placement. That breaks the renderer's "one scene pass per
     frame" invariant: either two walks or a separate pre-pass. A pre-pass
     over dirty containers before the walk is what Solid's post-mutation
     pass plus `measure()` already is, without moving flex into the
     renderer.
  3. Solid's flex semantics would have to move into the renderer, along
     with every behaviour of today's flex:
     - `flexBoundary`, `flexCrossBoundary`, `flexItem`, `flexOrder` and
       `preFlexwidth`/`preFlexheight`;
     - `_calcHeight` and `_containsFlexGrow`;
     - two implementations;
     - `onLayout` callbacks and Row/Column scroll-on-layout. These are user
       code, so they would have to run between walks anyway, which is again
       an event and a re-walk.
  4. The DOM renderer would need the same engine.
- **Gain over Alternative 2 plus a depth-ordered queue:** none on the walk
  count (one walk in both). Only Solid's per-pass accessor overhead would
  shrink, and the flex rewrite can address that inside Solid.

**Verdict:** reject for 1.7. File it in `renderer-proposals.md` as "layout
inside the scene pass", with the evidence above. Prerequisite: the measured
cost of Solid's flex after its rewrite.

### 2.9 Alternative 9: third-party layout engines

| Engine                        | Format                                                                                           | Size (min / gzip, bundlephobia)            | Chrome 38 / 47                                                      | Notes                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `yoga-layout` 3.2.1           | wasm embedded in an ES module; `loadYoga()` is async (`yoga-layout/load` for no top-level await) | 127 kB / 52 kB                             | **No.** WebAssembly needs Chrome 57.                                | asm.js dropped in 3.0                                                                                                |
| `yoga-layout-prebuilt` 1.10.0 | asm.js (emscripten), CommonJS                                                                    | 365 kB / 80 kB                             | Runs as plain JS. Chrome 38/47 do not compile asm.js ahead of time. | Unmaintained since 2022. Yoga 1.x semantics. Larger than all of renderer v2 (165 kB / 52 kB).                        |
| `taffy-layout` 3.0.0          | Rust → wasm + JS glue                                                                            | 29 kB / 7 kB JS + **598 kB / 213 kB wasm** | **No** (wasm)                                                       |                                                                                                                      |
| `stretch-layout` 0.3.2        | Rust → wasm                                                                                      | about 182 kB unpacked                      | **No** (wasm)                                                       | Unmaintained since 2022                                                                                              |
| `css-layout` 1.1.1            | pure ES5 JS (Facebook, 2015)                                                                     | 9.9 kB / 3.2 kB                            | Yes                                                                 | No `gap`. Defaults differ (column direction, stretch alignment), so results would differ from Solid's. Unmaintained. |

- **Interop cost per node (estimated, not measured).**
  - A wasm engine mirrors the `ElementNode` tree in its own nodes (create,
    insert, remove, free).
  - Each layout pass crosses the JS↔wasm boundary about 15-25 times per
    node: one call per style prop (Solid's flex reads about 6-12), 4 reads
    back (x, y, w, h), and for text a measure callback from wasm back into
    JS.
  - At embind-call costs that is roughly microseconds per node on desktop,
    against Solid's 0.07 µs per child on plain objects and 0.4-0.6 µs per
    child on the real stack.
- **Every option also changes layout results**, which is app-facing: Solid's
  `flexBoundary` and the content-sizing rules are not CSS.

**Verdict: reject**, for size (the asm.js build), browser floor (wasm) and
semantics (all of them).

---

## 3. Recommendation

### 3.1 What to implement in 1.7

1. **Renderer, commit 1: `TextNode.measure(): boolean`.**
   - It lays the text out now when its layout is stale, into the shared
     `LayoutCache`.
   - It sizes the node with `applySize` and leaves `DIRTY_LAYOUT` for the
     visit to place the block.
   - It queues `loaded` for real listeners only (apps, Marquee).
   - It returns false while the font's description is missing.
   - It needs no `ScenePass` change.
   - It also updates `publicApi.test.ts`, `docs/upgrade-1.x-to-2.0.md`,
     and the text unit tests: measure then walk reuses the layout; no
     description returns false; `loaded` still reaches listeners.
2. **Renderer, commit 2: text-keyed `LayoutCache`.** It replaces the
   per-lookup `layoutKey` string with a per-font `Map` keyed by text plus a
   field compare, under the same size and LRU contract and its tests.
3. **Renderer, commit 3 (optional, after measuring): typed-array advance and
   kerning tables** for `mapTextLayout`'s width function, built lazily per
   font. They must stay bit-identical; the pinned 1.10 tests and the
   17,100-case check guard that.
4. **Solid: measure in the post-mutation pass, before flex.**
   - **No persistent `loaded` listener.**
   - A one-shot fallback while the description is missing.
   - Writes to layout-affecting text props queue the flex parent: `text`,
     `fontFamily`/`fontWeight`, `fontSize`, `lineHeight`, `letterSpacing`,
     `maxWidth`/`width`, `maxHeight`/`height`, `maxLines`, `wordBreak` and
     `overflowSuffix`.
5. **Solid: a depth-ordered layout queue.**
   - Children run before parents.
   - Propagate up only when a container's size changed.
   - Skip queueing when the measured size is unchanged.
6. **Solid: the `flexItem={false}` fix** in `flex.ts` and `flexLayout.ts`, or
   in the one implementation the flex rewrite keeps.
7. **Before fonts: hold**, as today.

### 3.2 Expected effect

| Metric (per text change in a flex container) | Today (arm B)                              | 1.7, measured with the prototype             | 1.7 with items 5 and 6               |
| -------------------------------------------- | ------------------------------------------ | -------------------------------------------- | ------------------------------------ |
| Walks per frame                              | 2 (3 if flex resizes a text)               | **1**                                        | 1                                    |
| `loaded` events (no app listener)            | 1 per relaid text                          | **0**                                        | 0                                    |
| Flex passes                                  | 1 per relaid text, plus ancestors (S1: 12) | 1 per queued container, plus re-runs (S1: 5) | **1 per affected container** (S1: 4) |
| Layouts in the walk                          | 1 per relaid text                          | **0**: done in `measure()`, reused           | 0                                    |
| Cache lookup per relayout                    | 0.36-0.71 µs and about 1 kB of garbage     | same                                         | **0.02 µs and 0 B** (commit 2)       |
| Flex containers under culled ancestors       | unlaid until visited                       | laid out at mount or change                  | same                                 |

This meets the brief's starting target: "one walk per frame and one flex
pass per affected container".

### 3.3 Renderer changes and boundaries

- All three commits are inside "the surface Solid touches" (`TextNode.ts`
  accessors) and "text measurement" (`TextNodes`' measure and `loaded`
  queue; `LayoutCache` and `layoutKey`; read access to the font
  description).
- None touches `ScenePass`, `NodeStore`'s layout, `TextEmitter`, the atlas,
  shaders or textures.
- `renderer-proposals.md` items:
  - (a) Layout inside the scene pass (§2.8), rejected for 1.7.
  - (b) If lazy glyph runs (§2.3) turn out to need anything outside
    `TextLayout.ts` or `TextNodes.ts`, it goes there too.
  - (c) If building the tables in `parseSdfFont` is preferred over the lazy
    build, the `sdfFont.ts` change needs the user's decision, because it is
    beyond read access.

### 3.4 What the DOM renderer must mirror

- `DOMText.measure(): boolean`, synchronous.
  - It calls `updateDOMTextSize(this, false)` (a `getBoundingClientRect`
    measurement) when `document.fonts` reports the font loaded, and returns
    true.
  - Otherwise it returns false and keeps today's async path, which emits
    `loaded` for the one-shot fallback.
- Add `measure?(): boolean` to `IRendererTextNode` in `domRendererTypes.ts`.
- **Under jsdom, sizes are 0, as today.** The text-flex results must be
  tested on the real renderer: Vitest browser mode with WebGL
  (`vitest.webgl.config.ts`, already set up in this worktree by another
  agent).

### 3.5 Behaviour changes that need the user's approval at Checkpoint 1

1. **Eager layout of flex text under culled ancestors.**
   - Arm B leaves flex containers unlaid until they are visited (S2:
     tiles 9-19; S3).
   - With `measure()` they are laid out at mount or change.
   - Visible results are identical: in S1 the final positions match; in S3
     the square ends at x = 425.44 in both arms.
   - Results for never-visited containers differ, and a container now has
     its size before it is shown. This removes the forever case of §1.3.
   - Cost:
     - about 2 µs desktop per extra title layout at mount (S2: 22 extra
       layouts);
     - more `LayoutCache` pressure;
     - text for hidden `KeepAlive` pages is laid out while hidden.
   - The alternative, keeping laziness, would need a visibility read from
     the renderer and keeps the second walk on scroll.
2. **The `flexItem={false}` fix** unblocks containers that are blocked
   today.
3. **Flex results arrive one step earlier.** They are computed in the
   microtask before the frame instead of between walks. Positions within
   the frame are the same, and `onLayout` runs before the frame, as it
   already does for layouts without text.

### 3.6 Risks

- **Parity with 1.10 line breaking.**
  - `measure()` calls the same `layoutText` with the same `TextState`
    props, so lines are identical by construction. The pinned text-layout
    tests do not change with commit 1.
  - Commit 2 changes only how a layout is found. Commit 3 changes the width
    function: it must stay bit-identical, and the pinned tests plus the
    17,100-case check guard it.
- **Missed invalidations.** If a layout-affecting write bypasses Solid's
  setters, the walk relays the text and Solid's flex is not re-run. Examples:
  - a raw `el.lng.fontSize = …` write;
  - a renderer animation of `fontSize`;
  - a font reloaded under the same name.

  Today the `loaded` listener catches these. Mitigation: route every
  layout-affecting text prop through `ElementNode` setters (they already
  are), document raw `lng` writes as layout-blind (already true for
  non-text props), and keep a **dev-only** listener that warns when a
  layout made in the walk changes the size of a measured text. It stays off
  the production path, in line with the brief's preference for dev-only
  shims.

- **Flex writing a text's `width`** (`flexGrow`/`minWidth` on a text child)
  sets `maxWidth`, which makes the text stale; measuring and flexing again
  can loop. It is bounded by `runPostMutation`'s queue loop and
  `_containsFlexGrow`. Test it explicitly.
- **Cache pressure from eager measuring**, against the default of 250.
  Measure the hit rate in the VirtualRow and browse scenarios before
  raising it. The memory cost is about 1.5 kB per title and about 12.6 kB
  per description.
- **Re-entrancy.**
  - A `measure()` inside a `loaded` listener or a `reprocessUpdates`
    callback (between walks) goes through `applySize`. That counts as a
    write and costs a re-walk, which is correct.
  - Inside a walk it would also count; nothing calls it there.
- **`loaded` semantics for apps** are kept: `measure()` queues `loaded` for
  listeners, delivered between the walks of the next frame. Marquee's
  `onEvent.loaded` keeps working.
- **The DOM renderer** is synchronous `getBoundingClientRect` per measured
  text. That forces a browser reflow per text, which is acceptable for the
  DOM mode and the tests, but slower than today's batched `setTimeout` on
  a DOM-rendered app.

### 3.7 Tests to add (Phase 1 and the implementation)

All on the real renderer (Vitest browser mode with WebGL), asserting
behaviour rather than internals:

- final positions of the S1 and S2 shapes after fonts load, matching arm B
  for the visible content;
- walks per frame equal to 1 for a text change in a flex container
  (`renderer.updateIterations`);
- `loaded` still reaching an `onEvent` listener after a text change;
- the `flexItem={false}` text case;
- a font whose description arrives after mount (the one-shot fallback);
- a flex write to a text's `width`.

---

## Appendix: method and reproduction

The scratch prototypes live in this session's scratchpad. They are **not
committed**, and nothing under `src/` in any repository was changed.

- **`textflex/renderer-proto`.** `git archive HEAD` of `renderer-v2-solid`,
  then `pnpm install` and `pnpm build`. The prototype adds `TextNodes.measure`
  and `TextNode.measure` plus three counters (+62 lines).
- **`textflex/solid-proto`.** `git archive HEAD` of `solid-1.7`, with
  `node_modules` symlinked. The prototype is behind
  `Config.syncTextMeasure` (+46 lines in `elementNode.ts`).
  - `vitest.trace.config.ts` aliases `@solidtv/renderer` to the scratch
    renderer build.
  - `trace/textflex.test.tsx` holds scenarios S1-S3 and S5.
  - Run:
    `TRACE_MODE=baseline|measure npx vitest run --config vitest.trace.config.ts`
- **`textflex/bench`.**
  - `text-micro.mjs` (`node --expose-gc text-micro.mjs [--alloc]`): layout,
    cache keys, width paths, unwrapped parity.
  - `fastmeasure-parity.mjs`: the typed-array measure through
    `mapTextLayout`, 17,100 cases.
  - `maplayout-micro.mjs`: line breaking against the full layout.
  - `flex-micro.mjs`: Solid's `flex.ts` and `flexLayout.ts` bundled with a
    stub `utils`, on mock nodes.
  - `estimate.mjs`: the Alternative 7 estimate error.
  - `alloc-probe.mjs`: allocation sanity checks.
- **Allocation method.** V8 sampling heap profiler at a 1-byte interval,
  collected objects included, the inspector session's frames excluded (as
  in the renderer's `test/allocations.ts`), after a 2,000-call warm-up. The
  harness's own boxing (16 B) is subtracted.
