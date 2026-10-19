# DOM Renderer

The DOM Renderer is gone in SolidTV 2.0. `@solidtv/renderer` 2.x has one engine (WebGL) and one text engine (SDF), and `ElementNode` reads and writes the renderer's node store directly, so there is no second renderer to switch to. The `SOLIDTV_DOM_RENDERING` define, `Config.domRendererEnabled`, `DOMRendererMain`, `DOMNode`, `isDomRenderer` and `isDomRendererActive` were removed. See the [migration guide](/articles/migration-1x-to-2.0.md) for the full list.

## Testing without a canvas

Tests that used the DOM Renderer to run in jsdom use a headless `RendererCore` from `@solidtv/renderer` instead. It is the real node store, scene pass, text layout, shader packing and animation step, with no canvas and no WebGL. Pass it to `createRenderer`:

```ts
import { RendererCore } from '@solidtv/renderer';
import { createRenderer, registerDefaultShaders } from '@solidtv/solid';

const core = new RendererCore({ appWidth: 1920, appHeight: 1080 });
registerDefaultShaders(core);
export const renderer = createRenderer({ core });

// Drive one frame: advance animations 16 ms, update the scene, deliver events.
export const tick = () => {
  core.step(16);
  core.update();
  core.events.flush();
};
```

Text needs a font loaded into the core before it lays out; this repository's own setup (`tests/setup.ts` and `tests/fonts.ts`) loads a small fixed-width font and is a working example.
