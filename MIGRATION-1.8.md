# Migrating to @solidtv/solid 1.8

1.8 rewrites Solid's internals to use less CPU and allocate less per key press:
one flex engine, text measured before the frame, draw order that follows the
child order, compiled state styles, and one reactive flush per focus change.
Apps written against `<view>`, `<text>` and the primitives keep their code,
except where this file says otherwise.

It needs `@solidtv/renderer` 2.0.7 or later (as 1.7.1 did): Solid sizes text
with the renderer's `TextNode.measure()` and orders siblings with
`Node.insertBefore`. The renderer 2.0 breaks themselves came with Solid 1.7;
see the renderer's `docs/upgrade-1.x-to-2.0.md`.

The measurements behind each change are in `docs/perf/log.md`.

## Layout and flex

- **One flex engine.**
  - **What changes:** `src/core/flex.ts` and `VITE_USE_NEW_FLEX` are gone;
    every build runs the CSS-aligned engine (`flexLayout.ts`). It allocates
    nothing during a layout pass and writes only the values that changed.
    Apps that did not set the variable now get, where the engines differed:
    - a number `padding` also offsets the cross axis (rows start at
      `paddingTop` with `alignItems` or wrapping);
    - padding arrays and `paddingLeft`/`Top`/`Right`/`Bottom` work (the old
      engine produced NaN), and the `margin` array works;
    - wrapped lines start at the cross padding, and the height adds the end
      padding;
    - `flexShrink` shrinks overflowing items and `flexBasis` replaces the
      width or height for positioning (the old engine ignored both);
    - a container whose items only have `flexShrink` gets
      `flexBoundary: 'fixed'`, so it no longer sizes itself to its items;
    - no `console.warn` when `flexGrow` has no free space;
    - positions are float64 (no float32 rounding such as 109.70999908).
  - **Upgrade step:** delete `VITE_USE_NEW_FLEX` from `.env` (it is ignored).
    If your app ran on the old engine, check the layouts above.
- **Text in a layout container is sized by Solid, before the frame.**
  - **What changes:** a `<text>` whose parent has `display="flex"` or an
    `onLayout` is measured with the renderer's `measure()` in Solid's
    post-mutation pass. The container's flex and `onLayout` run in that
    microtask, before the frame, instead of after the text's `loaded` in a
    later frame. Final positions are the same, and they are right in the first
    frame that shows the change. A change that leaves a text's size unchanged
    lays nothing out.
    - **Reads right after mount see the laid-out values.** Code that reads a
      flex-derived position or size in the same task as the mount (an
      `onFocus` that fires at mount, an effect, a `ref` callback) now gets the
      laid-out value. Before, it got the pre-layout value, often 0, so
      something positioned from it may move to where it was meant to be.
    - **`loaded`.** An `onEvent.loaded` on such a text still fires once per
      layout, now after the container's relayout. On the DOM renderer it fires
      for every new size, as before.
    - **Animations.** A `transition` on a text's `fontSize`, `lineHeight`,
      `width` or `height`, and `el.animate()` of its layout props, still lay
      the container out on every animated frame, and it ends where the final
      size puts it.
    - **Writes that bypass Solid.** Layout props written or animated on the
      renderer node (`el.lng.text = …`, `el.lng.fontSize = …`,
      `el.lng.animate({ fontSize })`) no longer lay out the container: the
      renderer lays the text out again, but Solid is not told. Development
      builds warn when this happens.
  - **Upgrade step:** write or animate text props on the element
    (`el.fontSize`, a `transition`, `el.animate()`), not on `el.lng`.
- **Text under hidden or out-of-bounds ancestors is laid out eagerly.**
  - **What changes:** text in a layout container is measured at mount and on
    every change, even when an ancestor has alpha 0 or is outside the bounds
    margin, so such containers have their final size before they are shown.
    Before, they stayed unlaid until visible.
    - A text whose font is not loaded yet waits, then lays out once. A font
      loaded with `loadFonts()` lays out culled text when it arrives; one
      loaded with `renderer.loadFont()` directly lays it out when shown, as
      before.
    - It costs one text layout per such text, and more use of the renderer's
      text layout cache (`textLayoutCacheSize`, 250 entries by default). A
      page whose texts in layout containers outnumber the cache thrashes it;
      raise the size for such pages.
  - **Upgrade step:** none.
- **A `loaded` relayout runs between the renderer's walks.**
  - **What changes:** an autosize node's `loaded` queues its parent's layout
    for the post-mutation pass instead of laying it out inside the event, and
    a `loaded` that leaves the size unchanged lays nothing out. An app's
    `onEvent.loaded` handler on such a node now runs before the parent's
    relayout. On the DOM renderer the relayout is one microtask after the
    event.
  - **Upgrade step:** read the parent's layout from its `onLayout`, not from a
    child's `loaded` handler.
- **Post-mutation scheduling is a microtask only.**
  - **What changes:** Solid no longer asks the renderer for an in-frame run,
    and a frame, on every mutation. Nodes an app inserts or removes inside a
    renderer callback that runs between the walks (its own `onEvent`
    handler, `loaded` included) are laid out one frame later.
  - **Upgrade step:** none.
- **A `flexGrow` container calls `onLayout` once per layout,** after its grown
  children are laid out again. Before, it was called twice, the first time
  before the children were laid out. **Upgrade step:** do not count on two
  calls.
- **DOM renderer: `measure()`.** `DOMText.measure()` sizes a text
  synchronously with `getBoundingClientRect` once `document.fonts.check`
  reports its font loaded, so a flex text is laid out in the post-mutation
  microtask, not after the DOM renderer's timer. A web font that loads after
  its text was measured still lays the container out again. **Upgrade step:**
  none.

### Flex bugs fixed

- **B5:** an unsized `<text flexItem={false}>` no longer blocks its
  container's layout.
- **B6:** `justifyContent="center"` with padding centres inside the padding
  (it was shifted by the start padding). Drop compensating offsets, if any.
- **B7:** cross-axis `alignItems`/`alignSelf` `center` and `flexEnd` stay
  inside the cross padding (center was offset by `paddingTop`, flexEnd
  overflowed by it). Drop compensating offsets, if any.
- **B8:** a `flexGrow` item is sized from its own size on every layout: it
  shrinks back when a sibling grows, and returns to its own size when no space
  is left (it kept its largest grown size).
- **B9:** a wrapping container with no cross size places wrapped items on
  their own lines (they overlapped the first line).
- **B10:** `flexWrap="wrap-reverse"` wraps, first line at the end.
- **B11:** a `contain` text with no size subtracts its right and bottom
  margins from the computed `maxWidth`/`maxHeight`.
- **B12:** `maxLines={1}` with a `lineHeight` of 3 or less reads it as a
  multiplier: `maxHeight = lineHeight * fontSize` (it was the bare multiplier,
  a 1.2 px tall text).

## Keys and focus

- **One reactive flush per focus change.**
  - **What changes:** `onFocus`, `onBlur` and `onFocusChanged` run in the same
    order, but the whole focus change (the callbacks, `focusPath`,
    `activeElement`) runs in one Solid `batch`.
    - An effect or JSX binding triggered by a signal written in one of these
      callbacks runs once, after the last callback of the change, instead of
      right after each write. Memos read inside the callbacks are still
      current.
    - Effects on `focusPath` run in the same flush as those on
      `activeElement`.
    - A callback that writes a signal and then reads a node prop that an
      effect sets from that signal sees the old value until the change ends.
    - A focus change made from inside a focus callback no longer publishes the
      intermediate `activeElement`/`focusPath` to effects: they see only the
      final one.
    - If a focus callback throws, the effects queued by earlier callbacks of
      that change are dropped. The exception still propagates.
  - **Upgrade step:** if a focus callback relied on an effect having run after
    its own signal write, read the signal instead.

## States and styles

- **`states` Array methods return plain arrays.** `states.slice()`,
  `filter()`, `map()`, `splice()` and the other `Array` methods return a plain
  `Array`, not a `States`. `States` itself is still an `Array` subclass.
  **Upgrade step:** call `has`/`add`/`toggle` on `node.states`, not on a copy.
- **B2: `states.remove('focus')` and `toggle('focus')` match `'$focus'`,** as
  `has('focus')` already did. Before, they did nothing when only `'$focus'` was
  in the list. **Upgrade step:** none.
- **A state change writes only the keys whose value changed.**
  - **What changes:** a key still resolves to the active state of highest
    precedence that sets it, else `theme[key]`, else `style[key]`, else
    `undefined`, but it is written only when that value differs from the one
    the last state change wrote. Before, every state change, and every undo,
    re-wrote every key of every active state.
    - Adding a second state no longer restarts the first state's transition
      (a `$focus` `scale` keeps animating when `$active` is added).
    - A value the app writes to a key a state sets survives a later state
      change that leaves that key's value unchanged.
    - The border keys (`border`, `borderTop`, `borderRight`, `borderBottom`,
      `borderLeft`) are the exception: when a state change writes one of them,
      it writes all of them again in order, as before, so the sides and the
      whole border combine as they did.
    - The undo is a state change too: when a key's base value (`theme`, else
      `style`) is `===` the value the state wrote, the undo skips it.
  - **Upgrade step:** code that relied on a state change to overwrite its own
    write to a key the state sets must write the key again.
- **Assigning an unchanged `states` list does nothing.** An array or string
  with the same states in the same order, or an object that adds and removes
  nothing, is a no-op. With `forwardStates`, a child that changed its own
  states keeps them until the parent's list changes. And
  `node.states = node.states` no longer empties the list. **Upgrade step:**
  none.
- **A `$state` block, and a `border` or `shadow` object, are read once per
  object.**
  - **What changes:** their keys and values are compiled the first time they
    are used and cached by object identity. Changing such an object afterwards
    (`style.$focus.color = x`, or `myBorder.width = 4` and assigning the same
    object again) is not seen. A getter in a `$state` block is still read each
    time the block is applied; an object with a getter is not cached.
  - **Upgrade step:** assign a new object instead of mutating one, or use a
    getter.
- **Setting `linearGradient` or `radialGradient` again updates the node's
  gradient shader** in place, instead of making a new one. A gradient shader
  shared between nodes is updated for all of them. **Upgrade step:** none.

## Primitives

- **Row and Column cache the merged `transition`.** After a press, a Row's or
  Column's `transition` is a merged object cached per element and direction.
  An in-place edit of the base `transition` object is not seen. **Upgrade
  step:** assign a new `transition` object instead of mutating it.

## Nodes

- **B19: draw order follows the child order.**
  - **What changes:** overlapping siblings with equal `zIndex` draw in their
    `children` order after every update, on both renderers: a `<Show>` that
    appears between siblings, a `<For>` that adds in the middle or reorders,
    and a Virtual window shift. Before, such a node was drawn after all its
    siblings. An adjacent `<For>` swap also keeps the declared order now, for
    flex positions and focus order too (a child inserted before itself stays
    in place). When the anchor has a different `zIndex`, the renderer places
    the node at the nearest place that keeps siblings sorted by `zIndex`.
  - **Upgrade step:** if an app relied on an inserted node drawing last, give
    it a higher `zIndex`.
- **B20: text props on a non-text element; `absX`/`absY`/`destroyed`
  writes.** Text-only props (`fontSize`, `lineHeight`, `maxWidth`,
  `maxHeight`, `text`, `contain`, `textAlign`, …) written to a `<view>` stay on
  the ElementNode and no longer reach `view.lng`. Writing `absX`, `absY` or
  `destroyed` on an element is ignored; it threw a `TypeError` on renderer 2.0.
  **Upgrade step:** none.
- **A removed element does not lay out its old parent.** When a removed,
  not yet destroyed element changes size (a text in a hidden
  `Preserve`/`KeepAlive` root finishing its load, say), its old parent's flex
  and `onLayout` no longer run. A removed element still keeps its `parent`,
  and keys and events from a removed subtree still bubble through it.
  **Upgrade step:** none.

## Build

- **Recommended: terser `reduce_funcs: false`.** With terser's default
  `reduce_funcs`, renderer 2.0's scene walk allocates on every node it visits.
  Build with `build.minify: 'terser'` and
  `build.terserOptions.compress.reduce_funcs = false`;
  [Building for TVs](docs/deploy/build.md) has the Vite, webpack and CLI
  forms. **Upgrade step:** set the option in your build.
