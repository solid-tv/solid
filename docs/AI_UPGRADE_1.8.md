# Upgrading an app from @solidtv/solid 1.7 to 1.8: checklist for AI agents

**System role:** You are upgrading a TV app built on `@solidtv/solid` from 1.7.x
to 1.8. Work through the steps below in order. Each step names what to search
the app for, what a match means, and what to change. Most apps need only a few
of them. Do not change code a step does not point to. When a match is unclear,
leave the code as it is and list it for the developer.

The full description of every change is `MIGRATION-1.8.md`, at the package root
(`node_modules/@solidtv/solid/MIGRATION-1.8.md`) and in the repository. Read it
when a step needs more detail.

Search commands use `rg` (ripgrep). Run them from the app's root, on its own
sources only (not `node_modules` or build output). `grep -rnE` takes the same
patterns.

## 1. Dependencies

- Set `@solidtv/solid` to `^1.8.0`.
- `@solidtv/renderer` must be `^2.0.7` or later. 1.8 sizes text with the
  renderer's `TextNode.measure()` and orders siblings with `Node.insertBefore`.
  Check the peer range with `npm view @solidtv/solid@1.8 peerDependencies`.
- Reinstall, then confirm the app builds before going on.

## 2. Flex: one engine

1.8 has one flex engine, the one 1.7 used only when `VITE_USE_NEW_FLEX` was set.

```sh
rg -n "VITE_USE_NEW_FLEX" --hidden -g '!node_modules'
```

- **Found:** delete it from `.env` files and the Vite config; it is ignored.
  The app already ran on this engine, so its layouts do not change from the
  engine switch. Skip to step 3.
- **Not found:** the app ran on the old engine. Its flex layouts can move.
  Check each flex container for the cases below.

```sh
rg -n "display[=:]\s*[\"'{]*flex" src
```

For each flex container, look for:

- **A number `padding` together with `alignItems`, `alignSelf` or
  `flexWrap`.** The padding now also offsets the cross axis: rows start at
  `paddingTop`, and wrapped lines start at the cross padding. If the app added
  its own offset to make up for the missing cross padding, remove that offset.
- **`flexShrink` on items.** It now shrinks overflowing items (the old engine
  ignored it). A container whose items only have `flexShrink` no longer sizes
  itself to its items; give it an explicit size if it needs one.
- **`flexBasis` on items.** It now replaces the item's width or height for
  positioning (it was ignored).
- **Padding arrays, `paddingLeft`/`paddingTop`/`paddingRight`/`paddingBottom`,
  or a `margin` array.** These now work. The old engine produced NaN for them,
  so if the app avoided them with workarounds, the workarounds can stay or be
  simplified. Do not simplify without being asked.
- **Code that reads flex positions and expects float32 rounding** (such as
  `109.70999908`). Positions are float64 now.

## 3. Flex bug fixes that move layouts

These apply to every app, whichever engine it used.

| Search for                                                                                     | What changed                                                                                                                           | What to change                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `justifyContent` `"center"` on a container with `padding`                                      | Items are centred inside the padding (they were shifted by the start padding).                                                         | Remove offsets the app added to re-centre them.                                                                                         |
| `alignItems` or `alignSelf` `"center"` or `"flexEnd"` on a container with cross-axis `padding` | Items stay inside the cross padding (center was offset by `paddingTop`; flexEnd overflowed by it).                                     | Remove compensating offsets.                                                                                                            |
| `flexGrow` items                                                                               | A grown item is sized from its own size on every layout: it shrinks back when a sibling grows. It used to keep its largest grown size. | Usually nothing. A size the app writes to an item while it is grown is not kept on the next layout; list such writes for the developer. |
| `flexWrap` on a container with no cross size (no `height` in a row, no `width` in a column)    | Wrapped items are placed on their own lines (they overlapped the first line).                                                          | Nothing, unless the app worked around the overlap.                                                                                      |
| `flexWrap="wrap-reverse"`                                                                      | It wraps now, first line at the end.                                                                                                   | Nothing, unless the app worked around it.                                                                                               |
| `maxLines={1}` with a `lineHeight` of 3 or less                                                | `lineHeight` is read as a multiplier: `maxHeight = lineHeight * fontSize`.                                                             | Nothing, unless the app set `maxHeight` to make up for a 1.2 px tall text.                                                              |
| `contain` text with no size, and `marginRight`/`marginBottom` or a `margin` array              | The computed `maxWidth`/`maxHeight` subtracts those margins.                                                                           | Nothing.                                                                                                                                |
| `<text flexItem={false}>` with no size                                                         | It no longer blocks its container's layout.                                                                                            | Nothing.                                                                                                                                |
| `onLayout` on a container that has `flexGrow` children                                         | `onLayout` runs once per layout, with the final layout. It used to run twice.                                                          | Remove code that counts calls or skips the first one.                                                                                   |

## 4. Text in flex containers

A `<text>` inside a `display="flex"` container, or one with an `onLayout`, is
now measured by Solid right after the change, before the frame.

1. **Text props written or animated on the renderer node.** Solid is not told
   about these, so the container keeps the old size.

   ```sh
   rg -n "\.lng\.(text|fontSize|fontFamily|fontStyle|fontWeight|lineHeight|letterSpacing|maxWidth|maxHeight|maxLines|contain|wordWrap|wordBreak|overflowSuffix)\s*=" src
   rg -n "\.lng\.animate\(" src
   ```

   Change each match to write or animate on the element instead:
   `el.fontSize = 40`, a `transition`, or `el.animate({ fontSize: 40 })`.
   Development builds log this warning when it happens, so run the app and
   check the console:

   ```text
   [solid] A text in a flex container was laid out at a size Solid did not measure
   ```

2. **Workarounds for layout that arrived late.** Before 1.8, a flex container
   with text was laid out after the text's `loaded` event, a frame later. Code
   that reads a flex-derived `x`, `y`, `width` or `height` at mount (in an
   `onFocus` that fires at mount, an effect, or a `ref` callback) now gets the
   laid-out value instead of 0. Look for code that waited for layout before
   reading it:

   ```sh
   rg -n "onEvent=\{\{[^}]*loaded|loaded:\s*\(" src
   rg -n "(setTimeout|requestAnimationFrame|queueMicrotask)\(" src
   ```

   - A `loaded` handler on a text, or on an autosize node, that reads its
     parent's layout: it now runs before the parent's relayout. Read the
     layout in the parent's `onLayout` instead.
   - A `setTimeout` or `requestAnimationFrame` that only waits for flex before
     reading positions: it still works. List it for the developer as
     removable; do not remove it unasked.
   - Code that positions something from a value read at mount, and was tuned
     for that value being 0, can now place the element in a different spot.
     Check such screens in the running app.

3. **Text under hidden or culled ancestors** (alpha 0, outside the bounds
   margin, kept-alive pages) is now measured eagerly. No code change. A page
   with more measured texts than the renderer's `textLayoutCacheSize` (250 by
   default) thrashes the cache; if such a page is slow, raise
   `textLayoutCacheSize` in `Config.rendererOptions`.

## 5. States and style objects

1. **Style objects changed in place.** A `$state` block (`$focus`, `$active`,
   …), and a `border` or `shadow` object, is read once and cached by object
   identity. Changing it later is not seen.

   ```sh
   rg -n "\.\\\$[a-zA-Z]+\.[a-zA-Z]+\s*=" src
   rg -n "\.(border|borderTop|borderRight|borderBottom|borderLeft|shadow)\.[a-zA-Z]+\s*=" src
   ```

   For each match that changes an object the app later assigns again (or that
   a style already holds), assign a new object instead:
   `node.border = { ...node.border, width: 4 }`. A getter in a `$state` block
   (`get color() { … }`) is still read every time, so a match inside a getter
   is fine.

2. **Row and Column `transition` changed in place.** After a key press, a
   Row's or Column's `transition` is a merged object cached per direction. An
   in-place edit of the base `transition` is not seen.

   ```sh
   rg -n "\.transition\.[a-zA-Z]+\s*=" src
   ```

   Assign a new `transition` object instead.

3. **`States` methods on a copy.** `states.slice()`, `filter()`, `map()`,
   `splice()` and other `Array` methods now return a plain `Array`, without
   `has`, `add` or `toggle`.

   ```sh
   rg -n "states\.(slice|filter|map|concat|splice|reduce|flat)\(" src
   ```

   If the result is used as a `States` (`.has(`, `.add(`, `.toggle(`,
   `.remove(`), call those methods on `node.states` instead.

4. **`remove` or `toggle` with a bare name.** `states.remove('focus')` and
   `states.toggle('focus')` now act on `'$focus'` when only `'$focus'` is in
   the list. Before, they did nothing.

   ```sh
   rg -n "states\.(remove|toggle)\(\s*[\"'][a-zA-Z]" src
   ```

   Check each match: if the node can carry the `$`-prefixed state, the call
   now changes it. That is usually what the code meant.

5. **A state change writes only the keys whose value changed.**
   - Adding a second state no longer restarts the first state's transition.
   - A value the app writes to a key that a state also sets survives a later
     state change that leaves that key's value unchanged. Before, the next
     state change overwrote it.
   - Search for imperative writes to keys a `$state` block sets on the same
     node (`color`, `alpha`, `scale`, `border`, `shadow`, …). If the code
     relied on a later state change to put the state's value back, write the
     value again itself. The border keys (`border`, `borderTop`, …) are still
     rewritten together when a state change writes one of them.

6. **Re-assigning an unchanged `states` list does nothing.**

   ```sh
   rg -n "states\s*=\s*[a-zA-Z_.]*states\b" src
   ```

   `node.states = node.states` used to empty the list and re-apply the
   styles; it is now a no-op. With `forwardStates`, assigning the parent an
   unchanged list no longer resets the children's own states. If the code used
   either to re-apply styles, set the states it wants explicitly.

7. **Shared gradient shaders.** Setting `linearGradient` or `radialGradient`
   again now updates the node's shader in place. If the app assigned one
   node's `lng.shader` to another node and then set the gradient again, both
   nodes change. Give each node its own gradient.

## 6. Focus callbacks

The whole focus change (`onFocus`, `onBlur`, `onFocusChanged`, `focusPath`,
`activeElement`) runs in one Solid `batch`. Effects triggered by signals the
callbacks write run once, after the last callback.

```sh
rg -n "on(Focus|Blur|FocusChanged)=" src
```

Look inside each handler for a signal write followed by a read of a node prop
that an effect sets from that signal. That read now sees the old value. Read
the signal itself, or move the read into the effect. Handlers that only write
signals, or only read props, need no change.

## 7. Draw order

Overlapping siblings with equal `zIndex` now draw in their `children` order
after every update, as on first render. Before, a node added later (a `<Show>`
that appears, a `<For>` item added or moved, a Virtual window shift) was drawn
after all its siblings.

- An overlay, badge or popup shown with `<Show>` or added by `<For>`, that
  must draw over later siblings, needs a higher `zIndex`.
- A focused tile with a `$focus` `scale` is now covered by its later siblings,
  as on first render. Give the focused state a `zIndex` if it should draw on
  top.

## 8. Removed and ignored writes

```sh
rg -n "\.(absX|absY|destroyed)\s*=" src
```

Writes to `absX`, `absY` and `destroyed` are ignored (they threw on renderer
2.0). Remove them. Text props written to a `<view>` (`fontSize`, `text`, …)
stay on the element and no longer reach `view.lng`; read them from the
element.

## 9. Build setting

Find the bundler config (`vite.config.*`, `webpack.config.*`). With terser's
default `reduce_funcs`, renderer 2.0's scene walk allocates on every node it
visits. Set:

```js
build: {
  minify: 'terser',
  terserOptions: { compress: { reduce_funcs: false } },
},
```

Install terser if it is missing (`npm i -D terser`). For webpack:
`new TerserPlugin({ terserOptions: { compress: { reduce_funcs: false } } })`.

## 10. Verify

1. Build the app and run its tests.
2. Run it in development mode and check the console for `[solid]` warnings.
3. Open the screens with flex layouts, focus styles and overlays changed or
   listed in steps 2 to 7, and compare them with the 1.7 build.
4. Report what you changed, and list every match you left alone with the
   reason.
