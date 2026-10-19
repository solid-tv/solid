# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

SolidTV (`@solidtv/solid`) — a SolidJS-based UI framework for building TV applications over WebGL/Canvas (not DOM). Navigation is directional (arrow keys/remote), not pointer-based. UI is built with `<view>`, `<text>`, `<Row>`, `<Column>` — never DOM elements like `<div>`.

## Code Writing Rules

1. Don’t assume. Don’t hide confusion. Surface tradeoffs.
2. Minimum code that solves the problem. Nothing speculative.
3. Touch only what you must. Clean up only your own mess.
4. Define success criteria. Loop until verified.

## Commands

```sh
pnpm build          # Clean build (rm -rf dist && tsc + copy jsx-runtime.d.ts)
pnpm tsc            # TypeScript compile only (src, plus the type-level contract in tests/contract-types.tsx)
pnpm test           # Run vitest (jsdom, headless RendererCore, non-watch)
pnpm test:webgl     # Real-renderer tests (tests/webgl) in headless Chromium through WebGL
pnpm test:browser   # Run the jsdom suite in Playwright/Chromium
pnpm lint           # Prettier check + oxlint (no-explicit-any is an error in src/)
pnpm lint:fix       # Auto-fix both
pnpm release        # release-it (bumps version, tags, publishes to npm, creates GitHub release)
```

Run a single test file: `npx vitest tests/flex.spec.ts`

## Architecture

### Rendering Pipeline

- `src/render.ts` — Creates a SolidJS universal renderer (`solid-js/universal`) with custom node operations (`solidOpts.ts`). Exports `Dynamic`, `createRenderer` (it returns `rootNode` lazily: there is no `rootNode` before `createRenderer`), and re-exports SolidJS flow components (`For`, `Show`, `Switch`, etc.). The core `<view>` and `<text>` intrinsic elements are registered with the renderer.
- `src/core/renderer.ts` — `startRenderer(options)` makes the `@solidtv/renderer` `Renderer` (canvas, GL loop) or adopts a headless `RendererCore`; `loadFonts`, `renderer`/`getRenderer`, and `RendererOptions` (`CoreSettings` plus the GL loop's options).
- `src/core/node/ElementNode.ts` — `ElementNode` is the renderer handle: it holds a slot in the `@solidtv/renderer` node store and reads and writes the renderer's typed arrays through the 2.1 binding. Every prop is an accessor on the class (no index signature, nothing reads `undefined`); children, focus, states, `animate`/`chain`, `onEvent` and flex layout live on it. The rest of `src/core/node/`:
  - `lifecycle.ts` — linking (`insertChild`/`removeChild`), attach (`rendered`, `onCreate`), `destroy`
  - `accessors.ts` — the written-out accessor per numeric/colour prop, `setNow`, `width`/`height`
  - `defaults.ts` — the store-backed prop table: offsets, the `_set` bitmask, the defaults an undone style falls back to
  - `textProps.ts` — the `<text>` props over the renderer's `TextState` (a `<view>` keeps them in `_textProps`)
  - `shader.ts` — `border*`, `shadow`, `borderRadius`, gradients, `holePunch`: one `ShaderNode` per node, parsed once per object
  - `animation.ts` — `transition`, `animationSettings`, `animate`/`chain`/`start`, `onAnimation`, `onEvent`
  - `stylePlan.ts` / `styles.ts` — `style`, `theme`, `states` and `$state` blocks, compiled once per object
  - `postMutation.ts` — the flush after a mutation: delete, text measure, depth-bucketed flex layout, focus
- `src/core/focusManager.ts` — Handles keyboard/remote input, focus path traversal, and key mapping. Focus walks the component tree via `onUp`/`onDown`/`onLeft`/`onRight`/`onEnter` handlers.
- `src/core/config.ts` — Runtime `Config` object (debug flags, animation settings, font defaults, focus state key, `rendererOptions`).
- `src/core/flex.ts` — Flex layout engine: the one CSS-aligned implementation (scratch typed arrays, write-only-what-changed).
- `src/core/states.ts` — `States`, the node's state set. `src/core/fontLoaded.ts` — tells `postMutation` a font has loaded.

### Build-Time Globals

- `SOLIDTV_DISABLE_SHADERS` — disables shader processing
- `__DEV__` — development mode flag

### Entry Points (package exports)

- `@solidtv/solid` — main: `<view>`/`<text>` intrinsic elements, renderer, core node types
- `@solidtv/solid/primitives` — layout components (Row, Column, Grid, Virtual, VirtualGrid), focus utilities, announcer, router helpers, Lazy/KeepAlive/Preserve
- `@solidtv/solid/devtools` — devtools integration
- `@solidtv/solid/shaders` — shader exports

### Peer Dependencies

- `solid-js` — reactivity and component model
- `@solidtv/renderer` — WebGL/Canvas rendering engine (INode, ITextNode, animations)
- `@solidjs/router` — optional, for routing primitives

### Test Setup

Tests use jsdom over a headless `RendererCore` (the real node store, scene pass, text layout, shader packing and animation step; no canvas, no WebGL). `tests/setup.ts` creates the core, registers the default shaders, calls `createRenderer({ core })` and loads the Box font fixture (`tests/fonts.ts`, every glyph advances 8 at design size 10) under `Config.fontSettings`' family. `tick()` runs one 16 ms frame; `waitForUpdate()` settles the post-mutation microtask pass, then ticks. Vitest uses `vite-plugin-solid` with `generate: 'universal'` to compile JSX. `tests/contract-types.tsx` pins the public type names (checked by `pnpm tsc`), `tests/publicApi.test.ts` the runtime export names.

### Custom Condition

The `@solidtv/source` custom import condition resolves to source `.ts` files instead of compiled `.js` — used in vitest and vite configs for dev/test.

## Framework Rules (from AI_CODING_GUIDELINES.md)

- All nodes are `position: absolute` by default. Position with `x`, `y`, `width`, `height` (there is no `w`/`h`).
- Colors must be 8-char hex strings (e.g., `"#ff0000ff"`). No named colors.
- Use `color` not `background`. Use object structures for `border`/`shadow`.
- No `style={{}}`, no CSS classes, no DOM elements.
- Flex: `display: "flex"` activates it. Only single `padding` number (no `paddingLeft` etc.). Margins, gap, alignItems, justifyContent all supported.
- Focus: `onFocusChanged`, `onFocus`, `onBlur`, `onEnter`, `onUp`/`onDown`/`onLeft`/`onRight`. One item should have `autofocus`. `Row`/`Column` manage child focus automatically.
