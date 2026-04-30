# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

SolidTV (`@solidtv/solid`) — a SolidJS-based UI framework for building TV applications over WebGL/Canvas (not DOM). Navigation is directional (arrow keys/remote), not pointer-based. UI is built with `<View>`, `<Text>`, `<Row>`, `<Column>` — never DOM elements like `<div>`.

## Commands

```sh
npm run build          # Clean build (rm -rf dist && tsc + copy jsx-runtime.d.ts)
npm run tsc            # TypeScript compile only
npm test               # Run vitest (jsdom, non-watch)
npm run test:browser   # Run vitest in Playwright/Chromium
npm run lint           # Prettier check + ESLint
npm run lint:fix       # Auto-fix both
npm run release        # release-it (bumps version, tags, publishes to npm, creates GitHub release)
```

Run a single test file: `npx vitest tests/flex.spec.ts`

## Architecture

### Rendering Pipeline

- `src/render.ts` — Creates a SolidJS universal renderer (`solid-js/universal`) with custom node operations (`solidOpts.ts`). Exports `View`, `Text`, `Dynamic`, `createRenderer`, and re-exports SolidJS flow components (`For`, `Show`, `Switch`, etc.).
- `src/core/elementNode.ts` — `ElementNode` is the core node abstraction. Manages properties, children, flex layout, focus, states, animations, and syncs to the underlying `@solidtv/renderer` INode.
- `src/core/focusManager.ts` — Handles keyboard/remote input, focus path traversal, and key mapping. Focus walks the component tree via `onUp`/`onDown`/`onLeft`/`onRight`/`onEnter` handlers.
- `src/core/config.ts` — Runtime `Config` object (debug flags, animation settings, font defaults, focus state key).
- `src/core/flex.ts` / `src/core/flexLayout.ts` — Two flex layout implementations; toggled by `VITE_USE_NEW_FLEX` env var.

### Build-Time Globals

- `SOLIDTV_DOM_RENDERING` — enables DOM renderer instead of WebGL (used in tests)
- `SOLIDTV_DISABLE_SHADERS` — disables shader processing
- `__DEV__` — development mode flag

### Entry Points (package exports)

- `@solidtv/solid` — main: View, Text, renderer, core node types
- `@solidtv/solid/primitives` — layout components (Row, Column, Grid, Virtual, VirtualGrid), focus utilities, announcer, router helpers, Lazy/KeepAlive/Preserve
- `@solidtv/solid/devtools` — devtools integration
- `@solidtv/solid/shaders` — shader exports

### Peer Dependencies

- `solid-js` — reactivity and component model
- `@solidtv/renderer` — WebGL/Canvas rendering engine (INode, ITextNode, animations)
- `@solidjs/router` — optional, for routing primitives

### Test Setup

Tests use jsdom with `SOLIDTV_DOM_RENDERING: true` (DOM renderer). `tests/setup.ts` creates a renderer with mocked `ResizeObserver`/`MutationObserver`/`document.fonts`. Vitest uses `vite-plugin-solid` with `generate: 'universal'` to compile JSX.

### Custom Condition

The `@solidtv/source` custom import condition resolves to source `.ts` files instead of compiled `.js` — used in vitest and vite configs for dev/test.

## Framework Rules (from AI_CODING_GUIDELINES.md)

- All nodes are `position: absolute` by default. Position with `x`, `y`, `width`, `height`.
- Colors must be 8-char hex strings (e.g., `"#ff0000ff"`). No named colors.
- Use `color` not `background`. Use object structures for `border`/`shadow`.
- No `style={{}}`, no CSS classes, no DOM elements.
- Flex: `display: "flex"` activates it. Only single `padding` number (no `paddingLeft` etc.). Margins, gap, alignItems, justifyContent all supported.
- Focus: `onFocusChanged`, `onFocus`, `onBlur`, `onEnter`, `onUp`/`onDown`/`onLeft`/`onRight`. One item should have `autofocus`. `Row`/`Column` manage child focus automatically.
