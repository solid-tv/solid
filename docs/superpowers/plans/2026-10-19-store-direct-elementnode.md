# Store-direct `ElementNode` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ElementNode` becomes the renderer handle: it holds a store slot and reads and writes `@solidtv/renderer` 2.1's typed arrays directly, with one vocabulary (`width`/`height`), no props bag, no DOM renderer, and the 1.8 branch's allocation-free flex, post-mutation and style work ported onto Solid 2.0.

**Architecture:** The 2,055-line `src/core/elementNode.ts` is replaced by a `src/core/node/` directory: one file per concern (the class and lifecycle, the store accessors, text props, shader props, transitions, styles and states, the post-mutation queues), each built and unit-tested against a headless `RendererCore` before the cut-over task swaps `solidOpts.ts` and `render.ts` onto it and moves the test host off the DOM renderer. The 1.8 ports follow as their own tasks, each with the 1.8 tests that travel with them.

**Tech Stack:** SolidJS 2.0 (`solid-js` 2.0.0-rc.1, universal renderer), `@solidtv/renderer` 2.1.0-beta (the binding of the renderer plan), vitest + jsdom on headless `RendererCore`, TypeScript 7, oxlint, the `bench/` harness.

**Spec:** `docs/superpowers/specs/2026-10-19-store-direct-renderer-binding-design.md`, sections 3 and 5–8. Renderer half: `/Users/chris.lorenzo/Code/renderer/docs/superpowers/plans/2026-10-19-renderer-2.1-store-binding.md` (its Tasks 1–5 must be merged, and installed here as the `@solidtv/renderer` dependency, before Task 2 of this plan).

## Global Constraints

- Branch `v2`; package version `2.0.0-beta.N` on release; `peerDependencies["@solidtv/renderer"]` becomes `^2.1.0`.
- Chrome 38 floor in `src/` (spec 3): no `Proxy`, `Object.assign`, `Array.from`, `includes`, generators, `async`; hot classes assign every field in the constructor and keep one hidden class; no single-use helper on a hot path (terser's default `reduce_funcs` turns it into a per-call closure: spec 2 anti-goals).
- Solid 2.0 semantics: signal writes batch to a microtask; signals written from key handlers carry `{ ownedWrite: true }`; effects are `createEffect(compute, effect)` and never return a value.
- Steady-state garbage: zero framework allocation per key press, focus change, state toggle, flex pass and transition start on an unshaded node (spec 2 goal 3); the bench's allocation mode is the measure (Task 14).
- TypeScript: `oxlint` `no-explicit-any` as an error for `src/`; no index signature on `ElementNode`; each remaining `as` carries a one-line reason (spec 5.8).
- App-facing API: only the removals of spec 5.6; every shortcut of spec 5.3 keeps working.
- Gates per task: `pnpm test`, `pnpm tsc`, `pnpm lint`. The `tests/contract-*` suite is the regression net.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A child's `width` written before its parent is attached must survive attach: the parent-size default applies only to props the app never wrote (Task 8 pins it: `attach.test.tsx` "an explicit width on a detached child is kept at attach").
2. A node removed and re-inserted in the same microtask keeps its slot and its store values, and is neither freed nor re-attached (Task 8: `attach.test.tsx` "remove and re-insert in one tick keeps the slot").
3. A read on a destroyed `ElementNode` (slot `NULL`) must not index the arrays at a negative offset: getters return the prop's default and setters are ignored (Task 3: `accessors.test.ts` "a destroyed node reads defaults and ignores writes").
4. A transitioned write while the same prop's animation is running with the same settings object must retarget, allocate nothing and fire `onAnimation.stopped` once at the end (Task 6: `transition.test.tsx` "a repeated write retargets and stops once").
5. `width` set on a `<text>` before attach lands as `maxWidth` at attach, and a `contain: 'width'` text is a flex item of its `maxWidth` (Task 4: `textProps.test.tsx` "width before attach becomes maxWidth"; `contract-text` "contain 'width': flex uses maxWidth as the item width" stays green at Task 8).

---

### Task 0: Baseline arm and the size script

**Files:**

- Modify: `bench/prepare-arms.mjs:30-45` (`PINS`, `ARMS`)
- Create: `bench/size.mjs`
- Create: `docs/perf/results/2026-10-19-baseline/` (the runner's `--out`)

**Interfaces:**

- Produces: arm `A` = this repo at commit `e63c88d` (`v2` before this plan) on `@solidtv/renderer` 2.0.6; arm `C` = the working tree (unchanged meaning). `node bench/size.mjs` prints, for the two entries of spec section 1 (every export; a typical app slice: `createRenderer`, `<view>`, `<text>`, `Row`, `Column`, `useFocusManager`), the terser-minified and gzip-9 byte counts with `solid-js`, `@solidtv/renderer`, `@solidjs/router`, `@solid-primitives/*` external.

- [ ] **Step 1: Re-pin arm A**

In `prepare-arms.mjs` set `PINS.solidA = 'e63c88d'` and `PINS.rendererA = '2.0.6'`; update the header comment (lines 3–4).

- [ ] **Step 2: Write `bench/size.mjs`**

`node bench/size.mjs [--out json]`: builds both entries with Vite in lib mode (the repo's `vite-plugin-solid` with `generate: 'universal'`, `moduleName: '@solidtv/solid'`, the `@solidtv/source` condition, `__DEV__: false`), minifies the output with `terser --compress --mangle --module`, gzips at level 9, prints a table. Scratch builds go under `bench/.size/` (gitignored).

- [ ] **Step 3: Record the baseline**

Run: `node bench/run.mjs --arms A --modes time,alloc,count --runs 3 --out docs/perf/results/2026-10-19-baseline && node bench/size.mjs --out docs/perf/results/2026-10-19-baseline/size.json`
Expected: the JSONs exist; `size.json` shows about 118 kB / 38.6 kB and 38 kB / 13.5 kB (spec 1).

- [ ] **Step 4: Commit**

```bash
git add bench/prepare-arms.mjs bench/size.mjs .gitignore docs/perf/results/2026-10-19-baseline
git commit -m "bench: arm A is v2 before the store-direct rewrite; a size script"
```

---

### Task 1: Contract assertion changes that the spec makes, on today's host

**Files:**

- Modify: `tests/contract-states.test.tsx:476, 481-493, 793` (undo with no base value)
- Modify: `tests/publicApi.test.ts` (the DOM names `DOMRendererMain`, `DOMNode`, `isDomRenderer`, `isDomRendererActive` leave the pinned lists; `effects` leaves the `ElementNode` prop pins if listed)
- Modify: `tests/contract-types.tsx` (the `Intrinsic*` aliases and `DomRendererMainSettings` leave the pinned type list)
- Modify: `tests/**` any JSX `w=`/`h=` prop or `w:`/`h:` style key (`grep -rn "\bw=\|\bh=\|\bw:\|\bh:" tests` — texture and layout payloads excluded)

**Interfaces:**

- Produces: assertions that describe the 2.0 behaviour of spec 5.3/5.6 while still passing on today's code where they can; the ones that cannot pass on the DOM host are marked `v.it.skip` with the comment `// 2.0: passes from Task 8` and un-skipped there.

- [ ] **Step 1: Rewrite the undo assertions**

`contract-states` 481–493: after the undo, `node.alpha` is `1` (the renderer default), not `undefined`; 476 and 793 likewise for `color` (`0x00000000`, Solid's transparent default) and `alpha`. These cannot pass on the DOM host: skip them with the marker.

- [ ] **Step 2: Drop the DOM names and `w`/`h` from the pins**

As in Files. `publicApi.test.ts`'s count titles change with the lists.

- [ ] **Step 3: Run the suite**

Run: `pnpm test`
Expected: pass, with the marked skips counted.

- [ ] **Step 4: Commit**

```bash
git add tests
git commit -m "test: contract assertions for 2.0's store-backed props and export surface"
```

---

### Task 2: The renderer 2.1 dependency and `startRenderer`

**Files:**

- Modify: `package.json` (`@solidtv/renderer` devDependency and peer to the 2.1.0-beta; during development `pnpm link ../renderer` after `pnpm build` there)
- Create: `src/core/renderer.ts` (replaces `src/core/lightningInit.ts` at Task 8; both exist until then)
- Modify: `src/core/config.ts:63` (`rendererOptions` type)
- Test: `tests/renderer.test.ts` (create)

**Interfaces:**

- Produces, in `src/core/renderer.ts`:

```ts
export interface RendererOptions extends Partial<CoreSettings> {
  canvas?: HTMLElement | string;
  core?: RendererCore; /* the GL loop's options of @solidtv/renderer's Renderer, passed through */
}
export let core: RendererCore; // the one core of the app, set by startRenderer
export function startRenderer(options: RendererOptions): {
  core: RendererCore;
  renderer: Renderer | null;
};
export function loadFonts(fonts: FontLoadOptions[]): Promise<void>;
```

- `startRenderer` with `options.core` uses it headless (no `Renderer`, no canvas); without it, constructs `new Renderer(options, canvas)` as `startLightningRenderer` does today and uses its core. `Config.rendererOptions` is typed `RendererOptions`; the keys of today's `RendererMainSettings` map 1:1 (`appWidth`, `appHeight`, `boundsMargin`, `deviceLogicalPixelRatio`, `devicePhysicalPixelRatio`, `textLayoutCacheSize`, …); `renderEngine`, `fontEngines`, `domRendererEnabled` and the `renderer.stage.shManager` shim (if present on `v2`) are dropped with a dev warning.
- `createRenderer` itself changes at Task 8, when the new `ElementNode` exists to wrap `core.root`.

- [ ] **Step 1: Write the failing test**

`tests/renderer.test.ts`: `startRenderer({ core })` returns that core and `renderer === null`; `startRenderer({ core, renderEngine: {} })` warns once in dev (`console.warn` spy) and ignores the key; calling `startRenderer` twice returns the first core and warns.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/renderer.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `renderer.ts`**

The GL path is `startLightningRenderer`'s body (`src/core/lightningInit.ts:79-160`) minus the DOM branch; `loadFonts` moves across minus its DOM branch (`:166-180`).

- [ ] **Step 4: Run the suite and the type-check**

Run: `pnpm test && pnpm tsc`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/core/renderer.ts src/core/config.ts tests/renderer.test.ts
git commit -m "feat(core): startRenderer on a RendererCore, headless when given one"
```

---

### Task 3: `src/core/node/ElementNode.ts` and `accessors.ts`: the class on a slot

**Files:**

- Create: `src/core/node/ElementNode.ts`, `src/core/node/accessors.ts`, `src/core/node/defaults.ts`
- Test: `tests/node/accessors.test.ts` (create)

**Interfaces:**

- Consumes (renderer 2.1 core entry): `RendererCore`, `NodeStore`, `SlotOwner`, `F_STRIDE`, `F_X`, `F_Y`, `F_WIDTH`, `F_HEIGHT`, `F_ALPHA`, `F_SCALE_X`, `F_SCALE_Y`, `F_ROTATION`, `F_MOUNT_X`, `F_MOUNT_Y`, `F_PIVOT_X`, `F_PIVOT_Y`, `F_Z_INDEX`, `I_STRIDE`, `I_COLOR_TL`, `I_COLOR_TR`, `I_COLOR_BL`, `I_COLOR_BR`, `I_PLACEHOLDER_COLOR`, `NULL`, `DIRTY_LOCAL`, `DIRTY_COLOR`, `setField`, `setColor`, `setZIndex`, `setClipping`, `setRtl`, `setData`, `setSrc`, `setTexture`, `setTextureOptions`, `absX`, `absY`.
- Produces:

```ts
export class ElementNode implements SlotOwner {
  constructor(
    core: RendererCore,
    type: NodeType /* Element | TextNode (text element) */,
    slot?: number,
  ); // allocates core.allocNode() / allocTextNode() unless slot is given; handles[slot] = this
  slot: number;
  readonly core: RendererCore;
  readonly _type: NodeType;
  parent: ElementNode | undefined;
  children: SolidNode[];
  rendered: boolean;
  _set: Uint8Array; // one byte per SET_* index (defaults.ts), 0/1
  // the fields of spec 5.1 item 2, all assigned in the constructor, in this order
  hasListener(name: string): boolean;
  emit(name: string, data: unknown): void;
  removeAllListeners(): void;
  writeProp(name: string, value: number): void; // = setNow
  setNow(name: StoreProp, value: number): void; // store write with no transition check
  static fromSlot(core: RendererCore, slot: number): ElementNode;
}
```

- `accessors.ts` installs, with `Object.defineProperties(ElementNode.prototype, …)`, one written-out accessor per store prop: `x`, `y`, `width`, `height`, `alpha`, `scale`, `scaleX`, `scaleY`, `rotation`, `mount`, `mountX`, `mountY`, `pivot`, `pivotX`, `pivotY`, `zIndex`, `color`, `colorTop`, `colorBottom`, `colorLeft`, `colorRight`, `colorTl`, `colorTr`, `colorBl`, `colorBr`, `placeholderColor`, `clipping`, `rtl`, `data`, `src` (also the "white when first" colour rule of today's `elementNode.ts:1392-1400`), `texture`, `textureOptions`, `absX` (get), `absY` (get), `hidden` (alpha 0/1). The animatable ones consult `_transition` through `_animate(name, value): boolean` (Task 6; until then a stub returning `false`). Each setter sets its `_set` byte. A getter on `slot === NULL` returns `defaults.ts`'s value; a setter on `slot === NULL` returns.
- The position shortcuts `right`, `bottom`, `center`, `centerX`, `centerY` are plain fields (`_right`, …) the attach of Task 8 resolves once; their accessors store the request and set the `_set` byte of the prop they resolve to. The non-store props apps write (`id` as the string id, `autofocus`, `forwardFocus`, `skipFocus`, `onCreate`, `onRender`, `onDestroy`, `onLayout`, `updateLayoutOn`, the `on*` key handlers, `flex*`, `margin*`, `padding*`, `gap`, `justifyContent`, `alignItems`, `display`, `direction`) are declared fields on the class with no accessor.
- `defaults.ts`: `export type StoreProp = 'x' | 'y' | 'width' | 'height' | 'alpha' | … (every name above that lives in the store)`; `SET_X`, `SET_Y`, … indexes; `DEFAULT: Record<StoreProp, number>` (`alpha` 1, `scale` 1, `color` 0x00000000, `width`/`height` 0, …) used by destroyed reads and by style undo (Task 7).
- The 11 names of spec 5.1 do not exist on the class.

- [ ] **Step 1: Write the failing tests**

`tests/node/accessors.test.ts` on `new RendererCore()`:

- "x writes the store and marks DIRTY_LOCAL".
- "width goes through applySize" (DIRTY_SHADER raised).
- "color writes u32 and marks DIRTY_COLOR".
- "hidden is alpha": `hidden = true` → `alpha === 0`, `hidden === true`.
- "a destroyed node reads defaults and ignores writes": `slot = NULL`, `alpha === 1`, `x = 5` throws nothing and writes nothing.
- "the forwarded names the renderer never had are absent": `'scrollY' in node === false`, same for the other ten.
- "one hidden class": two nodes constructed differently have the same own keys in the same order (`Object.keys` equality).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/node/accessors.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the three files**

The constructor's field order is the spec's list. `setNow(name, v)` is a `switch` over the store prop names to the matching `setField`/`setColor` call (one site, monomorphic per case).

- [ ] **Step 4: Run them**

Run: `pnpm vitest run tests/node/accessors.test.ts && pnpm tsc`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/node tests/node/accessors.test.ts
git commit -m "feat(node): ElementNode on a store slot with written-out accessors"
```

---

### Task 4: Text props on the text state

**Files:**

- Create: `src/core/node/textProps.ts`
- Modify: `src/core/node/ElementNode.ts` (`_textProps`, `text`, `getText()`), `src/core/nodeTypes.ts` (the string `TextNode` keeps its shape)
- Test: `tests/node/textProps.test.tsx` (create)

**Interfaces:**

- Consumes: `textStateOf`, `relayoutText`, `reboxText`, `core.textNodes.measure(slot)`, `core.allocTextNode()`.
- Produces: accessors `text`, `fontFamily`, `fontWeight`, `fontSize`, `fontStyle`, `lineHeight`, `textAlign`, `verticalAlign`, `contain`, `maxWidth`, `maxHeight`, `maxLines`, `overflowSuffix`, `wordBreak`, `letterSpacing`, `offsetY`, `forceLoad`. On a `<text>` element each writes the `TextState` field and calls `relayoutText` (or `reboxText` for `contain`, `verticalAlign`, `offsetY`); on a `<view>` they land in `_textProps` (B20). `fontFamily`/`fontWeight`/`Config.fontWeightAlias` resolve to one family string as today (`elementNode.ts:1062-1081`, 1.8's template, B17). On a `<text>`: `set width(v)` writes `maxWidth` when `rendered`, else stores the value for attach (Task 8 applies it); `get width()` returns `maxWidth || laid-out width` (`F_WIDTH`), `height` likewise. `measureText(): boolean` calls `core.textNodes.measure(slot)`.

- [ ] **Step 1: Write the failing tests**

`textProps.test.tsx` on a headless core with the Box font loaded (the renderer's `test/sdfFonts.ts` fixture through `core.loadFont`, the way `src/core/RendererCore.text.test.ts` does; put the loader in `tests/fonts.ts`):

- "fontSize on a text writes the state and marks stale".
- "fontWeight before fontFamily still yields 'Family Bold'" (B17).
- "text props on a view land in \_textProps and not in the store".
- "width before attach becomes maxWidth".
- "contain 'width' reads width as maxWidth".
- "measureText lays out synchronously": after `text = 'ab'` and `measureText()`, `width > 0` without an update.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/node/textProps.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `textProps.ts`**

- [ ] **Step 4: Run and commit**

Run: `pnpm vitest run tests/node && pnpm tsc`
Expected: PASS.

```bash
git add src/core/node tests/node tests/fonts.ts
git commit -m "feat(node): text props write the renderer's text state"
```

---

### Task 5: Shader props: one parse, one facade write

**Files:**

- Create: `src/core/node/shader.ts` (from `elementNode.ts:178-310, 937-979, 1146-1153, 1960-2055` and `1.8:src/core/stylePlan.ts`'s `shaderParse`)
- Modify: `src/core/shaders.ts` (registration only; the DOM branch at 125–177 goes)
- Test: `tests/node/shader.test.tsx` (create), `tests/borderShaderType.test.tsx` (rewrite to the `ShaderNode` type name)

**Interfaces:**

- Consumes: `setShader(core, slot, shader)`, `core.createShader(name, props)`, `ShaderNode` (`.props` facade, `.type.name` or equivalent for the type name).
- Produces: accessors `border`, `borderTop`, `borderRight`, `borderBottom`, `borderLeft`, `shadow`, `borderRadius`, `rounded` (alias), `linearGradient`, `radialGradient`, `shader`; `shaderParse(key, obj): ShaderParse` (1.8, with `width` → `border-width`); `convertToShader(node): void` creating the rounded family shader from the feature bits (`_shaderFeatures`) at attach or on the first shader prop after attach; `syncShaderType(node)` swapping the type when a border width crosses 0; `Config.convertToShader` stays swappable. The raw objects live in `_shaderProps` for the getters and undo; only the flattened keys are written to the facade.

- [ ] **Step 1: Write the failing tests**

`shader.test.tsx`:

- "border width 0 gives the rounded shader; above 0 roundedWithBorder; back to 0 swaps back".
- "a border object is parsed once per identity" (`shaderParse` returns the same object twice).
- "the facade receives flattened keys only": `shader.props['border-width']` set, `shader.props.border` undefined.
- "linearGradient replaces the rounded shader" (one slot).
- "border transition animates through the shader track" (Task 6 fills the animation; here only that the props reach the facade).
  `borderShaderType.test.tsx`: the 12 cases assert `node.shader.type.name` (or the renderer's name accessor) instead of `lng.shader.shaderType`.

- [ ] **Step 2–4: Fail, implement, pass, commit**

Run: `pnpm vitest run tests/node/shader.test.tsx tests/borderShaderType.test.tsx && pnpm tsc`

```bash
git add src/core/node/shader.ts src/core/shaders.ts tests
git commit -m "feat(node): shader props parsed once and written to the facade once"
```

---

### Task 6: Transitions, `animate`, `onAnimation`, events

**Files:**

- Create: `src/core/node/animation.ts` (from `elementNode.ts:1155-1260, 1990-2027`)
- Modify: `src/core/node/accessors.ts` (`_animate` real), `src/core/node/ElementNode.ts` (`_onEvent`, `on`, `off`, `emit`, `hasListener`, `removeAllListeners`)
- Test: `tests/node/transition.test.tsx` (create), `tests/node/events.test.tsx` (create)

**Interfaces:**

- Consumes: `createAnimation(core, owner, props, settings)`, `animateSlotProp(core, owner, name, value, settings)`, `Animation.onStop`, `Animation.retarget`, `Animation.stop`.
- Produces: `transition` (shape unchanged), `animationSettings`, `animate(props, settings?)`, `chain(...)`, `start()`, `onAnimation: { animating?, stopped? }`; `_animate(name, value): boolean` returns true when it started or retargeted an animation; the no-settings fallback is one frozen constant `NO_SETTINGS`; `onAnimation.animating` fires synchronously as today, `stopped` from `Animation.onStop` (set once per controller, calling the node's handler with the prop name). Events: `on(name, fn)`, `off`, `emit`, `hasListener` over a `Record<string, Function[]>` created on first `on`; the JSX `onEvent` prop maps to them.

- [ ] **Step 1: Write the failing tests**

`transition.test.tsx` on a headless core, stepping with `core.step(dt); core.update()`:

- "a transitioned x write starts an animation and the store reaches the target after the duration".
- "a repeated write retargets and stops once": two writes 10 ms apart with the same settings object; `onAnimation.stopped` called once with `'x'`.
- "a different settings object stops the old controller and starts a new one".
- "no transition writes the store directly".
- "the settings fallback allocates nothing": `Config.animationSettings = undefined`; two transitioned writes; the controller's settings is the same frozen object.
  `events.test.tsx`: `on('loaded', fn)` makes `hasListener('loaded')` true; `emit` calls it with `(node, payload)`; `removeAllListeners` clears.

- [ ] **Step 2–4: Fail, implement, pass, commit**

```bash
git add src/core/node tests/node
git commit -m "feat(node): transitions and animate through the renderer's animations; node events"
```

---

### Task 7: Styles and states (the 1.8 port)

**Files:**

- Create: `src/core/node/stylePlan.ts` (from `1.8:src/core/stylePlan.ts`, minus `shaderParse` which is in Task 5), `src/core/node/styles.ts` (from `1.8:src/core/elementNode.ts` `trackKeys`, `styleFallback`, `resolveStateValue`, `set style`, `set theme`, `set states`, `_stateChanged` and its state loops: lines 520–615 and 1945–2470 on 1.8), `src/core/states.ts` (from `1.8:src/core/states.ts`)
- Test: `tests/stylePlan.test.ts` (from 1.8), `tests/states.test.tsx` (from 1.8), `tests/contract-states.test.tsx`, `tests/contract-styles.test.tsx` (the 1.8 additions merged in; the Task 1 skips un-skipped)

**Interfaces:**

- Consumes: `DEFAULT` from `defaults.ts`, the accessors, `_set`.
- Produces: `style`, `theme`, `states`, `forwardStates`, `stateOrder` with the 1.8 semantics (spec 5.7 item 3; B18 not fixed: border and shadow writes merge as in 1.6); undo per key: `theme[key]`, else `style[key]`, else `DEFAULT[key]` (spec 5.3); the `style` setter's "JSX wins" uses `_set`; `_stateChanged` allocates nothing for a repeated state set.

- [ ] **Step 1: Port the tests first**

Copy `tests/stylePlan.test.ts` and `tests/states.test.tsx` from `1.8` (`git show 1.8:tests/stylePlan.test.ts > tests/stylePlan.test.ts`); merge the `contract-states`/`contract-styles` additions from `1.8` (`git diff main 1.8 -- tests/contract-states.test.tsx tests/contract-styles.test.tsx`) except the B18 cases; add "undo with no base value writes the default and the node reads it".

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/stylePlan.test.ts tests/states.test.tsx tests/contract-states.test.tsx tests/contract-styles.test.tsx`
Expected: FAIL (modules missing; the contract files still run on the old node until Task 8, so run the two unit files only for the fail check).

- [ ] **Step 3: Port the code**

`git show 1.8:src/core/stylePlan.ts`, `1.8:src/core/states.ts`, and the `elementNode.ts` ranges above, re-pointed: `this.lng[key]` reads become the accessors; `UNWRITTEN` undo becomes `DEFAULT[key]`.

- [ ] **Step 4: Run the unit tests and commit**

Run: `pnpm vitest run tests/stylePlan.test.ts tests/states.test.tsx && pnpm tsc`

```bash
git add src/core/node src/core/states.ts tests
git commit -m "feat(node): compiled style plans and states from 1.8"
```

---

### Task 8: Cut-over: link, attach, `solidOpts`, `render.ts`, the test host, the DOM renderer deleted

**Files:**

- Create: `src/core/node/lifecycle.ts` (`attach`, `detach`, `destroy`, `insertChild`, `removeChild`, children ops from `elementNode.ts:930-1013` and 1.8's tail-scanning versions), `src/core/node/postMutation.ts` (the current `elementNode.ts:60-130` queues; the 1.8 queues come in Task 10)
- Modify: `src/solidOpts.ts`, `src/render.ts:1-50` (`createRenderer`, `rootNode`), `src/core/index.ts`, `src/index.ts`, `src/core/config.ts` (`domRendererEnabled` gone), `src/core/focusManager.ts:211, 218` (`lng.div` → `core.nodes.handles` inspector read through `data`), `src/core/utils.ts` (`isINode` gone), `tests/setup.ts`, `vitest.config.ts` (`SOLIDTV_DOM_RENDERING` define gone), `vitest.webgl.config.ts`, `vitest.browser.config.ts`
- Delete: `src/core/elementNode.ts`, `src/core/lightningInit.ts`, `src/core/dom-renderer/` (3 files), `tests/loadFontToDom.test.ts`
- Modify: `tests/contract-nodes.test.tsx:24, 155-205` (store fields instead of `DOMNode`), `tests/contract-text.test.tsx:500-515` (let the core lay out instead of emitting `loaded`), `tests/publicApi.test.ts`
- Test: `tests/node/attach.test.tsx` (create); the whole suite

**Interfaces:**

- Produces, in `lifecycle.ts`:

```ts
export function insertChild(
  parent: ElementNode,
  node: SolidNode,
  before?: SolidNode,
): void; // links in the store at once (insertBefore / appendChild), attaches if parent.rendered
export function removeChild(parent: ElementNode, node: SolidNode): void; // unlink, enqueueDelete(node, -1)
export function attach(node: ElementNode): void; // outside-in: defaults (spec 5.3) for props without a _set byte, right/bottom/center*, the text width→maxWidth, convertToShader, rendered = true, autofocus, onCreate and onRender where each fires today; then the children
export function cleanChildren(node: ElementNode): void; // O(n), as 1.8
export function destroy(node: ElementNode): void; // onDestroy, then core.destroySlot(slot)
```

- `solidOpts.ts`: `createElement(name, staticProps)` → `new ElementNode(core, type)` + the static props through the setters; `insertNode`/`removeNode` call `insertChild`/`removeChild`; `setProperty` unchanged; `getParentNode`/`getFirstChild`/`getNextSibling` as 1.8 (tail scan).
- `render.ts`: `createRenderer(options?: RendererOptions, node?: HTMLElement | string)` calls `startRenderer`, creates `rootNode = ElementNode.fromSlot(core, core.root.slot)` with `rendered = true` (no module-import `rootNode`), and returns the same object as today (`render`, `rootNode`, the renderer). Test in `tests/renderer.test.ts`: `createRenderer({ core })` returns a `rootNode` whose `slot === core.root.slot` and whose `width === 100` for a 100-wide core.
- `tests/setup.ts`: `const core = new RendererCore({ appWidth: 1920, appHeight: 1080 }); export const renderer = createRenderer({ core }); export const tick = () => { core.step(16); core.update(); core.events.flush(); }` plus the font loader of Task 4; `waitForUpdate` becomes `await microtasks; tick()`.
- The public API: `src/index.ts` exports `ElementNode`, `TextNode`, `createRenderer`, `Config`, the flow components, `loadFonts`, `convertToShader`, and no DOM name; `publicApi.test.ts` pins the new list.

- [ ] **Step 1: Write the failing tests**

`attach.test.tsx`:

- "insert links in the store before the parent is attached" (`i32[child * I_STRIDE + I_PARENT] === parent.slot`, `rendered === false`).
- "attach runs parent-first and sets rendered" (`onCreate` order).
- "an explicit width on a detached child is kept at attach".
- "a child without width takes the parent's width minus its x at attach".
- "right/bottom/center resolve once at attach".
- "remove and re-insert in one tick keeps the slot" (`slot` unchanged, `destroySlot` not called: spy on `core.destroySlot`).
- "remove then a microtask frees the slot".
- "draw order follows child order after insert before an anchor" (the store's `next`/`prev`).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/node/attach.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `lifecycle.ts`, `postMutation.ts`, and switch `solidOpts.ts`/`render.ts`; delete the old files; rewrite the shape-coupled tests; move `tests/setup.ts`**

Order within the step: lifecycle + postMutation (the attach tests pass), then the switch and deletions, then the host and the shape-coupled tests, then run the whole suite and fix behaviour regressions against the contract tests one file at a time (`pnpm vitest run tests/contract-focus.test.tsx`, …). The Task 1 skips are un-skipped here.

- [ ] **Step 4: Run everything**

Run: `pnpm test && pnpm tsc && pnpm lint`
Expected: pass; `grep -rn "\.lng\b\|DOMNode\|domRenderer" src tests` returns only `src/primitives` (Task 12) .

- [ ] **Step 5: Commit**

```bash
git add -A src tests vitest.config.ts vitest.webgl.config.ts vitest.browser.config.ts
git commit -m "feat(core)!: ElementNode is the renderer handle; the DOM renderer is gone; tests run on headless RendererCore"
```

---

### Task 9: Flex engine from 1.8

**Files:**

- Modify: `src/core/flex.ts` (replaced by `1.8:src/core/flexLayout.ts`, renamed), `src/core/node/accessors.ts` if flex reads inline
- Test: `tests/flex.spec.ts`, `tests/flex_min_size.spec.ts`, `tests/flex.performance.spec.ts`, `tests/contract-flex.test.tsx` (the 1.8 diff merged), `tests/layoutQueue.test.tsx` (from 1.8, the flex parts)

**Interfaces:**

- Consumes: the accessors, `setNow` (the engine's write-only-what-changed path writes through the transition-aware setters as 1.8 does, keeping `_flexX`, `_flexY`, `_flexWidth`, `_flexHeight`).
- Produces: `export default function flex(node: ElementNode): boolean` with 1.8's semantics (scratch typed arrays, `flexOrder` by index, B5–B10 fixes as 1.8 made them, the nested-pass guard), `_flexW`/`_flexH` renamed `_flexWidth`/`_flexHeight`.

- [ ] **Step 1: Port the tests, run them red, port the engine, run green**

`git diff main 1.8 -- tests/flex.spec.ts tests/flex_min_size.spec.ts tests/flex.performance.spec.ts tests/contract-flex.test.tsx` applied on top of the current files (keep the single-engine shape `v2` already has); `git show 1.8:src/core/flexLayout.ts > src/core/flex.ts` then the rename of `w`/`h` names and `animates(c, 'w', 'width')` to the single names.

Run: `pnpm vitest run tests/flex.spec.ts tests/flex_min_size.spec.ts tests/contract-flex.test.tsx`
Expected: PASS; `flex.performance.spec.ts` allocation assertion (0 B per pass in the steady state) passes.

- [ ] **Step 2: Commit**

```bash
git add src/core/flex.ts tests
git commit -m "perf(flex): the 1.8 allocation-free engine, on store-backed sizes"
```

---

### Task 10: Post-mutation queues and text measurement from 1.8

**Files:**

- Modify: `src/core/node/postMutation.ts` (from `1.8:src/core/elementNode.ts:76-350`: `enqueueDelete`, `schedulePostMutation`, `runPostMutation`, `enqueueLayout`, `queueLayout`, `measureQueuedTexts`, `fontWaitHeard`, `sweepFontWaiting`, `TextMeasure`), `src/core/fontLoaded.ts` (from 1.8)
- Test: `tests/layoutQueue.test.tsx`, `tests/fontWaiting.test.ts` (from 1.8), `tests/contract-text.test.tsx` (the 1.8 diff merged)

**Interfaces:**

- Produces: `enqueueDelete(node, n)`, `enqueueLayout(node)` (depth-bucketed, deepest first, a container re-queued only when its own size changed), `measureText` before flex for text under a loaded font, `reprocessUpdates` only for the font fallback; the three phases keep their order.

- [ ] **Step 1: Port tests red, port code green, commit**

Run: `pnpm vitest run tests/layoutQueue.test.tsx tests/fontWaiting.test.ts tests/contract-text.test.tsx && pnpm test`

```bash
git add src/core tests
git commit -m "perf(core): the 1.8 post-mutation queues and text measurement"
```

---

### Task 11: Draw order, images, node misc from 1.8

**Files:**

- Modify: `src/core/node/lifecycle.ts` (`_drawInOrder` equivalent is the store's `insertBefore`; keep 1.8's `drawOrder` tests), `src/primitives/Image.tsx` (1.8 diff), `src/core/nodeTypes.ts` (1.8 diff)
- Test: `tests/drawOrder.test.tsx`, `tests/image.test.tsx`, `tests/nodeTypes.test.ts` (from 1.8)

- [ ] **Step 1: Port tests red, port code green, commit**

```bash
git commit -am "feat(node): draw order follows child order; Image and nodeTypes from 1.8"
```

---

### Task 12: Primitives off `.lng`

**Files:**

- Modify: `src/primitives/Virtual.tsx:429-612` (`viewRef.lng[axis]` → `viewRef.setNow(axis, …)` / reads through the accessor), `src/primitives/VirtualGrid.tsx:178`, `src/primitives/Marquee.tsx:79-83` (`text.setNow('x', …)`, `text.animate(...)`), `src/primitives/FadeInOut.tsx:21-26` (`el.animate`), `src/primitives/useMouse.ts:166-314` (`node.absX`), `src/primitives/utils/withScrolling.ts:37, 85` (`inBounds(core.nodes, node.slot)` and `core.root.width`/`height` for the screen size), `src/primitives/utils/handleNavigation.ts`, `src/primitives/Grid.tsx`, `src/primitives/Lazy.tsx` (1.8 diffs: cached merged transitions, B1, B16, Grid handler caching)
- Test: `tests/contract-row-column.test.tsx`, `tests/contract-lazy.test.tsx`, `tests/contract-grid.test.tsx`, `tests/contract-virtual*.test.tsx` (the 1.8 diffs merged where they describe behaviour `v2` does not already have), `tests/useMouse.test.tsx`

- [ ] **Step 1: Merge the 1.8 primitive tests, run red, port, run green, commit**

Run: `pnpm test && pnpm tsc && grep -rn "\.lng\b" src` (expected: no output)

```bash
git commit -am "refactor(primitives): no node reaches the renderer except through ElementNode"
```

---

### Task 13: Types, public API, lint rules, docs

**Files:**

- Modify: `src/core/intrinsicTypes.ts` (the `Intrinsic*` aliases go; `NodeProps`/`TextProps`/`NodeStyles`/`TextStyles` lose `w`/`h`, `effects`, the 11 names; `holePunch` gets its accessor in `shader.ts` or leaves the type — decided by `grep -rn holePunch` in `../solid-demo-app` if present, else removed), `src/types.ts`, `.oxlintrc.json` (`no-explicit-any: error` for `src/`), `CLAUDE.md` (architecture section: the `src/core/node/` files, "ElementNode is the renderer handle", the DOM renderer and `SOLIDTV_DOM_RENDERING` gone, `pnpm` commands), `docs/flow/layout.md` ("New Flex Engine Toggle" removed), `docs/essentials/styling.md` and `docs/essentials/elementnode.md` (`w`/`h` gone, `rendered`/`attach`), `docs/articles/migration-1x-to-2.0.md` (a "Renderer binding" section listing spec 5.6's removals with replacements and the undo-reads-default note), `docs/_sidebar.md`
- Test: `tests/contract-types.tsx`, `tests/publicApi.test.ts`

- [ ] **Step 1: Pin the types and API, make lint an error, write the docs**

Run: `pnpm tsc && pnpm lint && pnpm test`
Expected: pass with `no-explicit-any` at error level; `grep -rn ": any\|as any" src` returns nothing.

- [ ] **Step 2: Commit**

```bash
git commit -am "docs(2.0): the store-direct binding; types pinned; no any in src"
```

---

### Task 14: Measure against the spec's targets

**Files:**

- Create: `docs/perf/results/2026-10-19-store-direct/` (bench output), `docs/perf/results/2026-10-19-store-direct/README.md` (the table of spec 7 filled in)

- [ ] **Step 1: Run the arms**

Run: `node bench/run.mjs --arms A,C --modes time,alloc,count --runs 3 --out docs/perf/results/2026-10-19-store-direct && node bench/size.mjs --out docs/perf/results/2026-10-19-store-direct/size.json`

- [ ] **Step 2: Fill the table**

For each row of spec section 7: the measured value, the target, met or not, and the cause when not. The allocation rows must read 0 framework bytes for the listed scenarios; a non-zero value is a defect to fix in the owning file before this task closes (name the allocating function from the JSON's top-30 list).

- [ ] **Step 3: Commit**

```bash
git add docs/perf/results/2026-10-19-store-direct
git commit -m "perf: store-direct results against the design targets"
```

---

### Task 15: Beta release

**Files:**

- Modify: `package.json` (version `2.0.0-beta.1`, peer `@solidtv/renderer ^2.1.0-beta.1`, devDependency pinned to the published beta; the `pnpm link` removed), `pnpm-lock.yaml`

- [ ] **Step 1: Install the published renderer beta, run everything, tag**

Run: `pnpm install && pnpm test && pnpm tsc && pnpm lint && pnpm build`
Then `pnpm release` per the repo's `release-it` setup with `--preRelease=beta` (the user runs the publish).

- [ ] **Step 2: Commit**

```bash
git commit -am "Release 2.0.0-beta.1"
```
