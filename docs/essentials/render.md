## Introduction to Rendering in SolidTV

In this snippet, we are utilizing SolidTV to render a simple "Hello World" text on the screen. SolidTV is a declarative JavaScript library for creating user interfaces, renowned for its performance and fine-grained reactivity. SolidTV is a framework for building high-performance, animated TV applications. By combining these technologies, we can create dynamic and visually appealing interfaces optimized for TV environments.

```jsx
import { render } from '@solidtv/solid';

render(() => <text>Hello World</text>);
```

## Understanding the Integration of SolidJS & SolidTV

It's very important to understand the concepts of SolidJS as that is the primary library for building the UI. SolidJS provides the foundation for creating reactive and efficient user interfaces, while the SolidTV integration merely links SolidJS with the SolidTV Renderer to create Canvas drawing. This combination allows for the creation of high-performance TV applications with smooth animations and responsive designs.

### Key Concepts in SolidJS

To effectively use this integration, familiarize yourself with the core concepts of SolidJS:

- **Reactivity**: SolidJS uses fine-grained reactivity to update the DOM. This means that only the parts of the DOM that need to change are updated, resulting in highly efficient rendering.
- **Components**: Components are the building blocks of a SolidJS application. They are functions that return JSX and can manage their own state and lifecycle.
- **JSX**: SolidJS uses JSX, a syntax extension for JavaScript that allows you to write HTML-like code within JavaScript. This makes it easy to define UI components declaratively.
- **State Management**: SolidJS provides reactive primitives such as signals, stores, and context to manage state within your application.

You can learn more about SolidJS from their [documentation](https://docs.solidjs.com/).

## Configuring the Renderer

Before calling the Render function, you can set rendererOptions.

```jsx
import { render, Config } from '@solidtv/solid';
import { WebGlCoreRenderer, SdfTextRenderer } from '@solidtv/renderer/webgl';
import { Inspector } from '@solidtv/renderer/inspector';

Config.rendererOptions = {
  fpsUpdateInterval: logFps ? 1000 : 0,
  fontEngines: [SdfTextRenderer],
  renderEngine: WebGlCoreRenderer,
  inspector: Inspector,
  // textureMemory: {
  //   criticalThreshold: 80e6,
  // },
  numImageWorkers, // temp fix for renderer bug
  // Set the resolution based on window height
  // 720p = 0.666667, 1080p = 1, 1440p = 1.5, 2160p = 2
  deviceLogicalPixelRatio: 1,
  devicePhysicalPixelRatio: 1,
};
render(() => <text>Hello World</text>);
```

For the latest renderer options read the official [renderer documentation](https://www.solid-tv.github.io/solid//api/renderer/interfaces/Renderer.RendererMainSettings.html)

### Config.rendererOptions

- **appWidth**: Authored logical pixel width of the application.
  - _Default_: `1920`

- **appHeight**: Authored logical pixel height of the application.
  - _Default_: `1080`

- **txMemByteThreshold**: Texture Memory Byte Threshold. When the GPU VRAM used by textures exceeds this threshold, non-visible textures are freed. Set to `0` to disable.

- **boundsMargin**: Bounds margin to extend the boundary for adding a CoreNode as Quad. Can be a single number or an array of four numbers.

- **deviceLogicalPixelRatio**: Factor to convert app-authored logical coordinates to device logical coordinates. Supports auto-scaling for different resolutions.
  - _Default_: `1`

- **devicePhysicalPixelRatio**: Factor to convert device logical coordinates to device physical coordinates. Controls the number of physical pixels used per logical pixel.
  - _Default_: `window.devicePixelRatio`

- **clearColor**: RGBA encoded number for the background color.
  - _Default_: `0x00000000`

- **Texture Memory Manager Settings**:
  textureMemory?: Partial<TextureMemoryManagerSettings>;

- **fpsUpdateInterval**: Interval in milliseconds for receiving FPS updates. Set to `0` to disable.
  - _Default_: `0`

- **enableContextSpy**: Includes WebGL context call information in FPS updates. Significantly impacts performance.
  - _Default_: `false`

- **numImageWorkers**: Number of image workers to use. Improves image loading on multi-core devices. Set to `0` to disable.
  - _Default_: `2`

- **inspector**
  Optional. Allows inspection of the state of Nodes in the renderer, replicating the node state.
  Type: `typeof Inspector | false`.

- **renderEngine**
  Defines the rendering engine (WebGL or Canvas). WebGL is more performant, while Canvas is more broadly supported.
  Type: `typeof CanvasCoreRenderer | typeof WebGlCoreRenderer`.

- **quadBufferSize**
  Specifies the quad buffer size in bytes.
  Default: `4 * 1024 * 1024`.

- **fontEngines**
  Defines font engines for text rendering (CanvasTextRenderer for Canvas, SdfTextRenderer for WebGL). Enables tree shaking for unused engines.
  Default: `[]`. Type: `(typeof SdfTextRenderer | typeof CanvasTextRenderer)[]`.

### Additional Solid-Specific Configurations

Besides `rendererOptions`, the `Config` object exposes several properties specific to `@solidtv/solid` runtime behavior:

- **debug**: `boolean` (Default: `false`)
  Enables general debug logging.
- **focusDebug**: `boolean` (Default: `false`)
  Logs focus management events to help debug spatial navigation.
- **keyDebug**: `boolean` (Default: `false`)
  Logs all key input events.
- **animationsEnabled**: `boolean` (Default: `true`)
  Global toggle to enable or disable animations.
- **animationSettings**: `AnimationSettings`
  Default configurations for animations.
  - _Default_: `{ duration: 250, easing: 'ease-in-out' }`
- **fontSettings**: `Partial<TextProps>`
  Default settings for all `<text>` nodes globally.
  - _Default_: `{ fontFamily: 'Ubuntu', fontSize: 100 }`
- **fontWeightAlias**: `Record<string, number | string>`
  Maps font-weight names to specific font files or numeric values (e.g., `{ thin: 100, bold: 700 }`).
- **taskDelay**: `number`
  Delay interval in milliseconds for the Task Scheduler.
  - _Default_: `50`
- **focusStateKey**: `string`
  The property key used to identify the focused state styling.
  - _Default_: `'$focus'`
- **domRendererEnabled**: `boolean` (Default: `false`)
  Whether the DOM renderer should be used instead of the SolidTV Canvas renderer.
- **simpleAnimationsEnabled**: `boolean`
  Allows simple CSS-like transition properties without full engine overhead.
- **throttleInput**: `number`
  Rate-limiting for key handling in milliseconds.
- **lockStyles**: `boolean` (Default: `true`)
  Enables locking on styles to prevent unintended overrides.
- **convertToShader**: `(node: ElementNode, v: StyleEffects) => IRendererShader`
  A customizable function that determines how styling effects translate to shaders on an ElementNode.

## Handling Renderer Events

The SolidTV renderer is an `EventEmitter`. Bootstrap it with `createRenderer`, which returns the `renderer` instance, and subscribe to its lifecycle and error events with the standard `renderer.on(event, handler)` API:

```jsx
import { createRenderer } from '@solidtv/solid';

const { renderer, render } = createRenderer();

render(() => <App />);
```

Two of these events signal unrecoverable GPU conditions the application is responsible for handling: `contextLost` and `outOfMemory`. In both cases the engine cannot rebuild its in-flight GL resources in place, so the supported recovery is for the app to reload.

### `contextLost`

Fired when the underlying WebGL context is lost — e.g. on low-RAM devices running Chromium 123+ after the app has been backgrounded. The render loop stops and the scene graph is dead, so reload to rebuild it.

```ts
renderer.on('contextLost', () => {
  // A lost WebGL context leaves a dead scene graph that cannot recover in
  // place. Reload to rebuild it. If the viewer was deep in a route that won't
  // survive a reload (e.g. a full-screen player), send them somewhere safe
  // first.
  const redirect = resolveContextLostRedirect(window.location.hash);
  if (redirect != null) {
    window.location.hash = redirect;
  }
  window.location.reload();
});
```

### `outOfMemory`

Fired when the renderer detects a real `GL_OUT_OF_MEMORY` from the GPU (probed once per frame). This is the only certain signal that the texture-memory estimate has overshot the device's real VRAM budget: a texture upload has already failed and the driver may soon drop the context. The renderer deliberately does **not** change anything itself — recovery is application policy.

The recommended response is to lower the texture-memory `criticalThreshold`, persist it, and reload so the next launch calibrates to the device's real budget. The event payload carries `memUsed` (estimated texture memory in use at the moment of failure) and `criticalThreshold` (the threshold currently in effect). Because the upload failed, the real budget is at or below `memUsed`, which makes it a good basis for the next threshold.

```ts
// Namespace the storage key per app. TV devices that run from the filesystem
// (file://) have a null/opaque origin, so a bare key can collide across apps —
// including the path keeps each app's calibration separate.
const STORAGE_KEY = `myapp:criticalThreshold:${location.pathname}`;

// Never calibrate so low the UX breaks. Pick a floor that matches your app.
const DEFAULT_CRITICAL = 200e6;
const MIN_THRESHOLD = Math.round(DEFAULT_CRITICAL * 0.7);

let handlingOOM = false;
renderer.on('outOfMemory', (_target, { memUsed, criticalThreshold }) => {
  if (handlingOOM) {
    return; // debounce — several uploads can fail in the same burst
  }
  handlingOOM = true;

  // The OOM proves the real budget is <= memUsed. Drop to 90% of the lower of
  // (estimate, current threshold), but never below the floor.
  const ceiling = Math.min(memUsed, criticalThreshold);
  const next = Math.max(Math.round(ceiling * 0.9), MIN_THRESHOLD);

  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch (e) {
    // storage may be blocked (e.g. file:// with storage disabled); reload
    // anyway with the in-memory budget.
  }
  window.location.reload();
});
```

Read the persisted threshold back when you configure the renderer, so each launch starts from the calibrated value:

```jsx
function readCriticalThreshold(): number {
  const raw =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY)
      : null;
  const stored = raw !== null ? parseInt(raw, 10) : NaN;
  if (!Number.isNaN(stored) && stored > 0) {
    return Math.max(stored, MIN_THRESHOLD);
  }
  return DEFAULT_CRITICAL;
}

Config.rendererOptions = {
  textureMemory: {
    criticalThreshold: readCriticalThreshold(),
  },
};
```
