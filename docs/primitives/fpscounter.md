### FPS Counter Component

This component displays the current frames per second (FPS) of the application.

To use, import FPSCounter and add it to your component tree. import { setupFPS } from '@solidtv/solid'; On your canvas element add renderer option: fpsUpdateInterval: 200 and ref={(root) => setupFPS(root)}

`fpsUpdateInterval` is required — since renderer 1.9 it is the single switch for
both the `fpsUpdate` and `renderUpdate` events, and it works in production
builds. The `__calculateFps__` build flag that used to gate them is gone.

```jsx
import { FPSCounter, setupFPS } from '@solidtv/solid/primitives';
import { renderer } from '@solidtv/solid';

//inside App component

setupFPS({ renderer });

<FPSCounter mountX={1} x={1910} y={10} />;
```

## Reading the numbers

Renderer 1.8 reworked the `fpsUpdate` payload:

- `fps` now measures **rendering only** and is `0` when the interval was
  entirely idle, so a quiet screen reads as 0 rather than as a stall. Read
  `idleTicks` alongside it to tell the two apart. `FPSCounter` ignores samples
  at or below 5 fps for this reason.
- `capabilities` was removed from the payload. Call `renderer.getCapabilities()`
  once at startup instead; the `RendererCapabilities` type is exported from
  `@solidtv/renderer`.
- `frameTick.time` now comes from `performance.now()`, measured from page load
  rather than the Unix epoch.
- New fields worth having: `animatedFps` (the rate over frames where something
  was actually moving), `frameTimeBuckets` and `maxFrameTime` for percentiles,
  and `updateMs` / `renderMs` / `uploadMs` to attribute a regression to a phase.
  `renderer.setTelemetrySegment('home')` labels a sample so an interval never
  spans two screens.

FPS series recorded from production builds before renderer 1.8 are not
comparable with these numbers: production builds used to sample the idle poll
cadence and report a meaningless constant around 60-70.
