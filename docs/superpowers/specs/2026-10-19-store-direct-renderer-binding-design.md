# Store-direct renderer binding: SolidTV 2.0 on renderer 2.1

Status: design, awaiting approval. Covers two repositories: `@solidtv/solid`
(`/Users/chris.lorenzo/Code/solid`, branch `v2`) and `@solidtv/renderer`
(`/Users/chris.lorenzo/Code/renderer`, branch `v2`, published 2.0.6). The
renderer changes exist to serve the binding, so one document holds both.

Decisions the user made are stated as decisions. Everything marked **(call)**
is the author's choice: a sensible builder could have chosen otherwise, and
the user can overrule it by editing this document.

## 1. Intent

Rewrite how Solid talks to the renderer so that there is one node object,
one vocabulary and one write per prop, while porting the 1.8 branch's
allocation-free layout and style work onto the Solid 2.0 line.

Today a `width` write from JSX crosses three layers. `ElementNode.width`
writes `this.w`; the `w` accessor checks `transition` and writes `this.lng.w`;
`lng` is a plain props bag before render and the renderer's `Node` handle
after it (a four-way union, cast at every use); the handle's `w` setter
stores into `NodeStore`'s typed arrays and marks dirty. The renderer side is
already lean: node state lives in `Float64Array` and `Int32Array` records,
its setters allocate nothing, and `Node` is `id` plus 98 prototype
accessors. The fat is the middle: 71 forwarded accessors on `ElementNode`
(11 of them names the renderer never had), the bag-to-handle swap at render,
alias lookups for transitions, a `width` getter that means `maxWidth || w`,
and shader props written twice.

The renderer's own plan (`docs/superpowers/plans/2026-10-18-renderer-v2-node-api-shrink.md`)
names this shape and sets it aside as "a rewrite of Solid's renderer binding
against the store's offsets". This document is that rewrite.

Measured on 2026-10-19 (`v2` of both repos, terser, gzip level 9):

| Bundle                                       | Minified |    Gzip |
| -------------------------------------------- | -------: | ------: |
| Solid, every export (incl. the DOM renderer) |   118 kB | 38.6 kB |
| Solid, a typical app's tree-shaken slice     |    38 kB | 13.5 kB |
| Renderer core entry                          |   171 kB | 55.3 kB |
| of which the `Node`/`TextNode` handle layer  |   ~24 kB |  5–7 kB |

## 2. Goals, non-goals, anti-goals

**Goals**

1. One node object. `ElementNode` is the handle: it holds the store id and
   reads and writes the renderer's typed arrays directly. No props bag, no
   `lng`, no render-time swap.
2. One vocabulary. `width` and `height` are the field names in the store, in
   the renderer's API, in Solid and in JSX. `w` and `h` are gone, not
   aliased.
3. Minimum garbage. Zero framework allocation in the steady state for a key
   press, a focus change, a state toggle, a flex pass and a transition start
   on an unshaded node. The 1.8 branch's measured work (flex engine, style
   plans, post-mutation queue, Row/Column/Virtual fixes) ports onto this line.
4. Smaller framework, without heroics: the handle layer leaves the
   renderer's core entry, Solid drops its dead props, duplicate paths and
   the DOM renderer. Measured, not golfed.
5. Clean TypeScript: no `any` in `src/`, no index signature on `ElementNode`,
   no `as` cast that papers over a union, types that describe the shapes that
   exist.
6. The JSX apps write stays recognisable (section 5.6).

**Non-goals**

- Moving flex layout into the renderer's scene pass (renderer proposal P1).
  Flex stays in Solid; it reads the arrays directly instead.
- Changing the focus manager's model, the key map, the router, the
  announcer, or any primitive's observable behaviour beyond the bug fixes
  1.8 already made.
- Any backend other than WebGL 1 (the renderer invariant).
- Reaching the renderer's original 22 kB gzip budget.

**Anti-goals** (a failure even if it works)

- An app-facing break that is not listed in section 5.6.
- A per-node field on the renderer side of the binding (CLAUDE.md: handles
  never carry per-node state).
- Hot-path code that allocates a closure, an object or a string per call
  under terser's default `reduce_funcs` (the 1.8 lesson: single-use helpers
  become per-call closures).
- A Solid test suite that no longer exercises the real renderer logic.

## 3. Constraints

- **Chrome 38 floor**, both packages: no `Proxy`, `Object.assign`,
  `Array.from`, `includes`, generators or `async` in `src/`; class fields
  are transpiled, so hot classes assign in the constructor and keep one
  shape (renderer `CLAUDE.md`; Solid's `LazyImport.ts` comments).
- **Solid 2.0 semantics**: writes batch to a microtask; signal writes inside
  key handlers need `ownedWrite`; effects take a compute and an effect
  function (`docs/articles/migration-1x-to-2.0.md`).
- **Renderer invariants** stay: node state in `NodeStore`; setters store and
  mark dirty, nothing else; every size write goes through `applySize`; one
  scene pass per frame; params blocks immutable and shared.
- **Two repositories, one release line.** Decision (user): the renderer
  ships this as 2.1.0, not a major. The `width`/`height` rename and the
  handle's move out of the core entry break anyone using the renderer
  directly, so the 2.1 release notes say so under "breaking changes". Solid
  2.0.0 declares the peer `^2.1.0`. Neither is published until both pass
  (section 8).
- **Contract tests pin behaviour.** `tests/contract-*.test.tsx` on `v2`
  describe the 1.7 behaviour apps depend on; they are the regression net.
  The assertion changes this document makes (section 5.6) land on `v2`
  first, on today's host; the host itself changes with the rewrite
  (section 6).

## 4. The renderer side (2.1)

### 4.1 `width` and `height`, everywhere

- `NodeLayout.ts`: `F_W`/`F_H` become `F_WIDTH`/`F_HEIGHT`. Offsets stay
  (0 and 1). Everything that reads them follows the rename.
- `NodeStore.applySize(id, width, height)` and `applySizeInVisit` keep their
  roles and take the new names.
- `Dimensions` is `{ width, height }`; the `loaded` payload, `measureText`'s
  return, `Viewport`, `RectWithValid` and the animation FAST table all use
  it. `CoreSettings.appWidth`/`appHeight` already do.
- The `Node` handle (section 4.3) gains `width`/`height` setters and loses
  `w`/`h`. **(call)** No deprecation period for `w`/`h`: 2.1 is the break,
  and an alias would be the double vocabulary this rewrite exists to end.
- The shader prop vocabulary follows the same rule **(call)**: the Box
  shader type's `border-w` key (`src/core/shaders/builtin/Box.ts`) becomes
  `border-width`; the per-side aliases `border-top/right/bottom/left` stay.
  Direct renderer users who write `shader.props['border-w']` break; it is
  listed in the 2.1 notes with the rest of the rename.
- The 85 example pages and the visual-regression snapshots follow the
  rename; snapshots must be bit-identical (the rename changes no number).

### 4.2 The binding surface

The binding is what Solid imports. It is the existing `RendererCore` plus
functions keyed by node id in place of the handle's setters. Nothing in it
is new logic; it is the handle's setter bodies, exported as functions, so a
caller that owns an id can do what the handle did.

**(call)** The surface is exported from the core entry `@solidtv/renderer`
as plain exports, not a separate `/binding` entry: Solid is the one consumer
and tree-shaking keeps unused pieces out of apps.

Exported:

- `RendererCore` (exists) with `nodes`, `clips`, `animationManager`,
  `shaders`, `fonts`, `textNodes`, `textureNodes`, `textEvents`, `events`,
  `root`, `createShader`, `loadFont`, `requestRender`, `reprocessUpdates`,
  `step`, `update`. `Renderer` (the GL loop over a core) is unchanged.
- `NodeLayout` constants (`F_STRIDE`, `F_WIDTH`, …, `I_STRIDE`, `I_DIRTY`,
  …), `NodeFlags` (`DIRTY_*`, `ST_*`), `NULL`.
- On `NodeStore` (exist): `alloc()`, `free(id)`, `appendChild`,
  `insertBefore(child, before)` (made public on the store; the handle method
  of the same name wraps it), `unlink`, `setZIndex`, `markDirty`,
  `applySize`, and the typed arrays `f64`, `i32`, `u32`, `f32`, `prev`,
  `next` with the side arrays.
- `createTextState(id)`, `textStateOf(id)`, `relayoutText(id)`,
  `reboxText(id)`, `measureText(id): boolean`: the bodies of
  `RendererCore.createTextNode` (minus the handle) and of `TextNode`'s
  `relayout`, `rebox` and `measure`. `TextState` stays the record; its
  fields are written by the caller (Solid's text accessors), then one of
  these is called, exactly as the handle's setters do today.
- `setShader(id, shader | null)`, `setSrc(id, src | null)`,
  `setTexture(id, texture | null)`, `setTextureOptions(id, opts)`,
  `setClipping(id, value)`, `setData(id, data)`, `setParent(id, parent)`:
  the bodies of the corresponding `Node` setters, taking an id.
- `destroySubtree(core, id)` and `releaseNode` (exist in `destroy.ts` and
  `RendererCore`).
- `createAnimation(core, slot, props, settings)` and `animateProp`'s logic as
  a function. Today `Animation` reads `node.id`, `node.renderer.nodes` and
  `node.shader` on every write; it is changed to take `(core, slot)` and to
  read the shader through `shaderRefs[slot]`, so it never touches the owner
  on the array path. Its "setter track" fallback (a prop that is not an
  array field: a text node's size) writes through the owner contract's
  `writeProp` (below), never through a transition-aware setter.
- `Animation.onStop: (() => void) | null` **(call)**: a field on the
  animation, not on a node, called once when the animation stops for any
  reason (completion, `stop()`, the owning node's destruction). A retarget
  without a stop (`animateProp` reusing a controller) does not fire it; the
  final stop does. This is the one addition to the animation step, and the
  exception to 4.4.
- **The owner contract.** `nodes.handles[slot]` holds the owner object:
  today the `Node` handle, after this the `ElementNode`. The renderer
  defines what it needs of an owner as an interface **(call, named by the
  builder)**: `slot: number` (the store slot, set to `NULL` by
  `destroySubtree` where it writes `handle.id = NULL` today),
  `hasListener(name)`, `emit(name, payload)`, `removeAllListeners()`, and
  `writeProp(name, value)` (a plain write of a named prop with no
  transition logic, for the setter track). The handle in 4.3 implements it
  with `slot` as its store id; `ElementNode` implements it in section 5.5.
  Nothing else in the renderer reads a field off an owner; `destroy.ts`,
  `Animation.ts`, `FrameEvents` and `boundsEvents` are the call sites to
  change.

### 4.3 The handle moves

`Node` and `TextNode` move to a second entry, `@solidtv/renderer/node`
**(call)**, rebuilt on the binding above (the same functions, called with
`this.id`). The renderer's tests, examples and inspector keep using them.
`RendererCore.createNode`/`createTextNode` move with them (they construct a
handle); the core keeps `allocNode()` returning an id. The inspector's DOM
mirror reads `handles[id]` as an object with `id` and the accessors the
mirror lists; it is adjusted to read the store directly where it listed a
handle accessor.

The parity aliases in the shrink plan's task 2 go with this: `width`/`height`
read-only getters (replaced by the real setters), `renderState`,
`clippingRect`; `srcX`/`srcY`/`srcWidth`/`srcHeight`/`imageType` fold into
`TextureOptions`; `componentName`/`componentLocation` move to `data`.
`absX`/`absY` stay as reads of the world-transform fields (Solid's mouse
support and click inspector read them).

### 4.4 What the renderer does not change

The scene pass, the GL backend, textures, fonts, shader packing, the
animation step (except `onStop`, 4.2), the loop. Shader types change only
by the `border-width` rename (4.1). The known allocating path (a params block per
frame while a shader prop or a shaded node's size animates) is out of
scope, as the 1.7 brief left it; it is measured and reported, not fixed.

## 5. The Solid side (2.0)

### 5.1 `ElementNode` is the handle

Construction (`createElement(name, staticProps)` in `solidOpts.ts`):

1. `new ElementNode(core, kind)` allocates `slot = core.nodes.alloc()` at
   once, stores `core.nodes.handles[slot] = this`, and for a `<text>` calls
   `createTextState(slot)`. Every prop write from the first one lands in the
   store. There is no pre-render bag, and `rendered` no longer routes
   props; it stays as the lifecycle flag of section 5.2. The store slot is
   `slot`, never `id`: `id` is the app's string id prop (`KeepAlive`, the
   focus manager and `getChildById` key on it) and keeps that meaning.
2. The constructor assigns every own field, in one order, so each node has
   one hidden class. The fields are: `slot`, `core`, `_type`, `parent`,
   `children`, `rendered`, `_set` (which props the app wrote explicitly,
   section 5.3: about 38 store- and text-state-backed props, so two 32-bit
   words or a small `Uint8Array`, the builder's choice), `_states`,
   `_style`, `_theme`, `_shader`, `_shaderProps`, `_textProps`,
   `_transition`, `_animationSettings`, `_onEvent`, `_flexX`, `_flexY`,
   `_flexWidth`, `_flexHeight`, `_queueDelete`, `_layoutDepth`, and the flex
   props as plain fields (`flexGrow`, `margin`, … are not renderer state and
   never were).
3. The 2.0 compiler's `staticProps` object is applied through the same
   setters, in declaration order (already the case on `v2`).

Accessors: one written-out accessor per renderer prop (the 1.8 shape,
`elementNode.ts:2768` on `1.8`), each reading or writing one constant
offset:

```ts
get x(): number { return this.core.nodes.f64[this.id * F_STRIDE + F_X]!; }
set x(v: number) {
  if (this._transition === undefined || !this._animate('x', F_X, v)) {
    setF(this, F_X, v, DIRTY_LOCAL);
  }
}
```

`width`/`height` call `applySize`. Colours use the u32 view. A getter of a
field the node has not set returns the store default, which is what a
freshly allocated record holds (`alpha` 1, `scale` 1, `color` white, and so
on): a store-backed prop never reads back `undefined`. Section 5.3 says
what that means for style undo. The 11 forwarded names the renderer never
had are deleted (`worldX`, `worldY`, `zIndexLocked`, `scrollable`,
`scrollY`, `strictBounds`, `fontStretch`, `textBaseline`, `textOverflow`,
`textRendererOverride`, `wordWrap`). `absX`/`absY` are getters over the
world-transform fields.

Text props: on a `<text>`, each accessor writes the `TextState` field and
calls `relayoutText` or `reboxText`; on a `<view>` they land in `_textProps`
(1.8's B20 fix) and draw nothing. On a `<text>` the size props keep their
text meaning, pinned by `contract-text`: the `width`/`height` setters write
`maxWidth`/`maxHeight` once the node is attached (as `TextNode` does
today), and the getters return `maxWidth || <laid-out width>` and
`maxHeight || <laid-out height>`, so a `contain: 'width'` text is a flex
item of its `maxWidth`. That is a text rule, not a translation layer, and it
lives in the text branch of the two accessors. The `contain` translation
stays Solid-side.

Writes that bypass `transition` (Virtual's window shift, Marquee, the flex
engine's "write only what changed" check) go through a `setNow(name, v)`
**(call, name is the builder's)** on `ElementNode` that writes the field
without consulting `transition`. Nothing outside `ElementNode` touches the
arrays.

### 5.2 Linking replaces render

Solid inserts inside-out: a child is inserted into its parent before the
parent is anywhere near the root, so "link time" is two moments, as it is
today (`render()`'s "inserted from the inside out, then rendered from the
outside in").

`insertNode(parent, node, anchor)` in `solidOpts.ts` links at once:
`core.nodes.insertBefore(node.slot, anchor.slot)` or `appendChild`. A
detached subtree is linked below a detached parent; the scene pass only
walks from the root, so linking early costs nothing and draw order equals
child order from the start (1.8's B19 fix).

**Attach** is the outside-in walk, run when a subtree becomes connected to
the root (the parent's `rendered` is true at insert, or the parent is being
attached): it is today's `render()` without the bag. For each node, parent
before children:

1. Resolve the parent-dependent defaults once (section 5.3) for props the
   app did not set.
2. Create the shader if `_shaderProps` is set and none exists (section
   5.4).
3. Set `rendered = true`, start the text layout wait if any, run `onCreate`.

`rendered` stays a public read with its current meaning ("attached to the
rendered tree", false on a fresh `new ElementNode`), and `contract-nodes`'
pinned order (`onCreate` parent-first) holds; what goes is its use for
routing prop writes.

`removeNode` unlinks and queues the delete; the post-mutation pass (ported
from 1.8: delete flush, depth-bucketed layout, focus) frees the slot through
`destroySubtree`. A removed-then-reinserted node keeps its slot, as the
queue already allows.

The `Dynamic` component, `render.ts`'s `createRenderer` and the root node
follow: the root `ElementNode` wraps `core.root`'s id.

### 5.3 Shortcuts and defaults

Decision (user): the app-author shortcuts stay. They are sugar over the real
fields, with the semantics they have on `v2`:

- `hidden` sets `alpha` to 0 or 1 and reads back from it.
- `right`, `bottom`, `center`, `centerX`, `centerY` are resolved against the
  parent's size at link time, once, into `x`/`y`/`mountX`/`mountY`, and are
  not reactive afterwards (as today; documented).
- `rounded` is an alias of `borderRadius`.
- `onCreate` and `onRender` both keep firing where they fire today.
- Default `width`/`height`: the parent's size minus the node's offset, at
  link time, when the app set neither (today's rule). Default `color`:
  transparent, or white when `src` is set first (today's rule). "The app set
  it" is the `_set` bitmask, written by the accessors; it replaces the
  `=== undefined` reads of the bag, including the `style` setter's "a JSX
  prop wins over the style" rule.
- Style undo **(call)**: for a key the last state application wrote, undo
  writes `theme[key]`, else `style[key]`, as today; with no base value
  anywhere it writes the prop's renderer default (`alpha` 1, `color`
  transparent-as-Solid-defaults-it, `fontSize` 16, …) from a small table on
  the Solid side, since a store-backed prop cannot hold `undefined`. The
  visible result is the same as today (an undone `alpha` draws at 1 either
  way); what changes is that `node.alpha` reads 1 afterwards instead of
  `undefined`. `contract-states` pins the old read and is updated (section
  5.6 lists it).

### 5.4 Shaders and effects

`border`, `borderTop/Right/Bottom/Left`, `shadow`, `borderRadius`,
`linearGradient`, `radialGradient` keep their JSX and style keys. Each write
parses the object once per object identity (1.8's `stylePlan.ts`
`shaderParse`, ported) into the flattened facade keys (`border-w` becomes
`border-width` **(call)**, the one rename on this path) and writes them to
the node's `ShaderNode` facade. The raw object is kept only in
`_shaderProps` for the getter and for style undo; it is no longer written to
the shader as well. The shader is created at link time from the feature
bits (`rounded`, `roundedWithBorder`, …, the existing `convertToShader`)
and swapped when a border width crosses 0 (`_syncShaderType`, kept).
`effects` goes: it was the same thing with a second entry point. `holePunch`
gets its accessor or leaves the types; the builder picks after checking the
demo app **(builder)**.

### 5.5 Transitions, animations, events

- `transition` keeps its shape. A transitioned write calls
  `createAnimation(core, id, …)` through a per-node cache keyed by the
  settings object identity, as the renderer's `animateProp` does, so a
  repeated write with the same settings reuses its controller and allocates
  nothing. The `{}` fallback settings object becomes one shared frozen
  constant (1.8).
- `animate()`, `chain()`, `start()` keep their API over `createAnimation`.
- `onAnimation.stopped` fires from the animation's `onStop` hook (4.2), not
  a `setTimeout` **(call)**: the renderer knows when the animation ended;
  the timer was a DOM-renderer-era approximation. With a cached controller
  the hook is set once per controller, not per write.
- `ElementNode` implements the owner contract of 4.2: `slot`,
  `hasListener`/`emit` over the `onEvent` map (one array per event name,
  created on first `on`), `removeAllListeners`, and `writeProp` as the
  `setNow` write of 5.1. The renderer's `loaded`, `failed`, `freed` and
  bounds events are delivered to it. No `EventEmitter` base class.

### 5.6 The app-facing line

Kept, unchanged in syntax: `<view>`, `<text>`, `width`, `height`, `x`, `y`,
`color`, `alpha`, `scale`, `rotation`, `mount*`, `pivot*`, `zIndex`,
`clipping`, `src`, `texture`, `textureOptions`, `border*`, `shadow`,
`borderRadius`/`rounded`, `linearGradient`, `radialGradient`, `style`,
`theme`, `states`, `$state` blocks, `transition`, `animationSettings`,
`onAnimation`, every `on*` handler, `autofocus`, `forwardFocus`,
`forwardStates`, `skipFocus`, `display: 'flex'` and the flex props, `id`,
`data`, the text props, the shortcuts in 5.3, `ref`, `Row`, `Column`, `Grid`,
`Virtual*`, `Lazy*`, `KeepAlive`, `Portal`, the router, the announcer,
`useFocusManager`, `useFocusStack`, `useMouse`, `useHold`.

Removed (the 2.0 migration guide lists each with its replacement):

- `w` and `h` as JSX props and as style keys (`width`/`height`).
- `node.lng` and `_rendererProps`. (`node.rendered` stays, section 5.2.)
- A store-backed prop reading `undefined`: after a style undo with no base
  value, or before any write, `node.alpha` and friends read the renderer
  default (section 5.3). Visually nothing changes.
- `effects` (write the `border`/`shadow`/`borderRadius` keys).
- The 11 names in 5.1 that never reached the renderer.
- `DOMRendererMain`, `DOMNode`, `isDomRenderer`, `isDomRendererActive`,
  `Config.domRendererEnabled`, the `SOLIDTV_DOM_RENDERING` define.
- `renderer.stage.shManager` and the other 1.x renderer shims noted in the
  1.7 design (5.6 there).

`Config.rendererOptions` becomes `CoreSettings` plus the GL loop's options,
passed through; the builder maps the existing keys **(builder)**.

### 5.7 Ported from 1.8 as-is, then re-pointed at the arrays

Each item is a commit range on `1.8` (`git log main..1.8`), ported in the
order below, with its 1.8 tests:

1. Flex engine: `1.8:src/core/flexLayout.ts` replaces `v2:src/core/flex.ts`
   (`v2`'s is a stripped copy of it). Scratch typed arrays grown on the cold
   branch, children walked by index, no closure, write-only-what-changed
   with the `_flex*` last-written values, the nested-pass guard. Its reads
   of child sizes become direct array reads through the accessors.
2. Post-mutation pass: depth-bucketed layout queue, text measure queue,
   font-waiting sweep, `reprocessUpdates` only for the font fallback.
3. Styles and states: `stylePlan.ts`, `states.ts` (species, by-index copy),
   the `_stateChanged` rewrite. Decision carried over from the 1.7 checkpoint
   (user, 2026-10-04): B18 is not fixed; border and shadow writes merge as
   in 1.6.
4. Nodes: written-out accessors, `insertChild`/`removeChild` scanning from
   the tail, O(n) `cleanChildren`, B20.
5. Primitives: Row/Column (cached merged transitions, inputs read once,
   B1), Virtual/VirtualGrid (already on `v2` from 1.7; the `.lng` writes
   become `setNow`), Grid handler caching, Lazy B16, Image.
6. Text: `TextNode.measure()` use (renderer R1, already on `v2`), the
   `fontFamily`/`fontWeight` template (B17).

Not ported: `flex.ts` (old engine), the DOM-renderer mirrors of each change,
the B18 base-record machinery.

### 5.8 TypeScript

Rules for the rewritten core, enforced by `oxlint` type-aware rules already
configured (`.oxlintrc.json`) and by `tsc` under `strict`:

- `ElementNode` is a class with declared members; the `[key: string]:
unknown` index signature goes. `$state` blocks live on `_style`, handlers
  in `_onEvent`, flex outputs in named fields.
- No `any` in `src/` (`oxlint` `no-explicit-any` as an error). Where a value
  is genuinely open, it is `unknown` and narrowed.
- No `as` cast across the old `lng` union, because the union is gone. The
  remaining casts are the ones TypeScript needs for typed-array index math
  and `this`-typed prototype accessors, each with a one-line reason.
- Public types: `NodeProps`, `TextProps`, `NodeStyles`, `TextStyles`,
  `ElementNode`, `TextNode`, the renderer's `CoreSettings`, `ShaderNode`,
  `AnimationSettings`, and the JSX namespace. The `Intrinsic*` aliases
  marked deprecated go. `tests/contract-types.tsx` pins the list.
- The renderer's binding functions are typed on `RendererCore` and `number`
  ids; `handles[id]` is typed as the owner interface (`hasListener`,
  `emit`), not `object | null`.

## 6. Tests

Decision (user): the DOM renderer is dropped.

**(call)** The jsdom suite runs on the renderer's headless `RendererCore`:
no canvas, no WebGL, but the real store, scene pass (`core.update()`), text
layout, shader packing and animation step. `tests/setup.ts` constructs
`createRenderer({ core: new RendererCore({ appWidth: 1920, appHeight: 1080 }) })`
and the tests drive frames with `core.step(dt); core.update()` where they
drove `requestAnimationFrame` before. Text tests load the renderer's own
test font fixture (`src/core/text/sdfFont.test.ts` shows how) through
`core.loadFont`. The three `tests/webgl/*` files stay the browser-bound
ones.

Shape-coupled tests are rewritten against the real shapes:
`borderShaderType` asserts the `ShaderNode`'s type name; `contract-nodes`
asserts store fields; `contract-text` lets the core lay text out instead of
emitting `loaded` by hand; `publicApi` drops the DOM names; `loadFontToDom`
goes. The `contract-*` behaviour tests do not change their assertions
except where this document changes the behaviour (section 5.6); those
changes are made first, on `v2`, on the DOM host, so the net is in place
before `ElementNode` is rewritten.

The host moves in phase 2, together with the rewrite **(call)**. Running
today's `ElementNode` on a bare `RendererCore` first would need a throwaway
adapter (it is built through `RendererMain` with a canvas and reads
`renderer.stage` and `lng.on`), so the suite cannot separate a rewrite
regression from a host difference on its own. The separation comes from
elsewhere: arm A's benchmark numbers (section 7), the renderer's own suite
on the binding (phase 1), and the shape-coupled tests being rewritten as
their own commits before the behaviour tests run on the new host.

The renderer's suite, visual regression (184 snapshots, bit-identical) and
`bench-create` gate the renderer change; Solid's contract suite and the
benchmark harness (section 7) gate Solid's.

## 7. Success criteria and measurement

Harness: `bench/` on `v2` (1.8's: arms built from source, CDP profiling and
allocation sampling, per-scenario JSON), with three arms: **A** = `v2`
before this work, **B** = this work, **R** = `1.8` on renderer 2.0 for the
scenarios it shares. Chromium headless, 6x throttle, n ≥ 3 interleaved.

| Target                                       | Metric                                         | Pass                                                                                           |
| -------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Steady-state garbage                         | framework bytes per op, allocation mode        | **0** for rows-lr-noshift, thumbnail-focus, rows-\*-auto/always, navdrawer-toggle, virtual-row |
| Press cost                                   | `total` per scenario                           | ≤ **R**, and ≥ 1.5x below **A** where 1.8 reached it                                           |
| Flex passes                                  | per press, count mode                          | 1 per affected container (1.8's numbers)                                                       |
| Walks                                        | per drawn frame                                | 1                                                                                              |
| Node creation                                | poster-mount, text-flex-mount-\* `total`       | ≤ **A**; renderer `bench-create` ≤ its 2.0.6 figure                                            |
| Framework size (app slice, section 1 method) | minified / gzip                                | ≤ 32 kB / 11.5 kB (A is 38 / 13.5)                                                             |
| Framework size (every export)                | minified / gzip                                | ≤ 80 kB / 27 kB (A is 118 / 38.6, 36 kB of it DOM renderer)                                    |
| Renderer core entry                          | `pnpm size`                                    | ≤ 150 kB / 50 kB (2.0.6 is 171 / 55.3; the handle moves out)                                   |
| Contract                                     | `pnpm test` both repos, type-checks, lint, VRT | green                                                                                          |

Decision (user): the size rows are targets, not gates. They are set from
the measurement with the removal of the DOM renderer and the handle layer
already counted; the release records the measured sizes against them, and
a miss is reported with its cause, not blocked on. A result far under them
is not a goal in itself.

## 8. Phases and versioning

Branches: both repositories on their `v2` branch. Versions:
`@solidtv/renderer` 2.1.0 (decision, user), `@solidtv/solid` 2.0.0 with
peer `^2.1.0`. Pre-releases as `2.1.0-beta.N` / `2.0.0-beta.N` on the
`beta` dist-tag, published together.

0. **Baseline.** Arm A measured and recorded in `docs/perf/results`
   (the directory exists on `1.8`, not on `v2`; it is created). The
   contract-test assertion changes of section 5.6 land on `v2` first.
1. **Renderer 2.1.** The rename (4.1), the binding exports (4.2), the
   handle's move to `/node` with the alias removals (4.3), inspector and
   examples updated, VRT bit-identical, `bench-create` recorded. Ships as a
   beta the Solid phase consumes.
2. **Solid core.** `ElementNode` as the handle (5.1–5.5), `solidOpts.ts`,
   `render.ts`, the DOM renderer deleted, `tests/setup.ts` on headless
   `RendererCore`, the shape-coupled tests rewritten. Gate: contract suite
   green.
3. **1.8 ports** in the order of 5.7, each with its measurement.
4. **Primitives, types, size.** The `.lng` call sites, `publicApi` and
   `contract-types` pinned, the sizes measured against section 7, the migration guide
   (`docs/articles/migration-1x-to-2.0.md` extended with this release's
   section).
5. **Release.** Both betas, the demo app ported, the TV runbook items from
   the renderer's `HANDOFF.md` that the binding touches (node creation on
   LGWhite, the stress scenes).

## 9. Left to the builder

- The exact split of `Node.ts` setter bodies into id-keyed functions, and
  where each lives (`NodeStore`, `TextNodes`, `TextureNodes`,
  `ShaderRegistry`).
- Whether flex reads child sizes through the accessors or through the arrays
  inline; measure both on `virtual-grid` and `text-flex-mount-*`.
- The `_set` bitmask's bit assignment and whether `color`'s "white when
  `src`" rule stays a link-time default or a `src` setter side effect (as
  today).
- `holePunch`.
- `Config.rendererOptions` → `CoreSettings` key mapping.
- The test font fixture and how text tests wait for layout.
- The inspector's reads once the handle is gone from `handles[slot]`.
- `rootNode` in `render.ts` is created at module import today; with a
  `core` required at construction it becomes lazy (created by
  `createRenderer`), and `createElement` reaches the core through a module
  singleton `createRenderer` sets.
- The exact owner-interface name and the split of the `Animation` change.

## 10. Builder-check questions and their answers

A fresh reviewer read the draft as the engineer who would plan from it and
raised six questions. Each is answered above; this is the index.

1. `id` collides: the store id is `slot` on both sides, and the renderer
   defines an owner contract (4.2, 5.1, 5.5).
2. Inside-out insertion: link at insert, attach outside-in, `rendered` kept
   as the lifecycle flag (5.2).
3. A store prop cannot be `undefined`: undo writes the default from a Solid
   table; text `width`/`height` keep their `maxWidth`/`maxHeight` meaning
   (5.1, 5.3, 5.6).
4. Test-host order: assertion changes first on the DOM host, the host moves
   with the rewrite (3, 6).
5. `onAnimation.stopped` needs a renderer hook: `Animation.onStop`, in
   scope (4.2, 4.4, 5.5).
6. `border-w` → `border-width` is the renderer's rename (4.1).

No question needs the user; the calls are marked where they are made.
