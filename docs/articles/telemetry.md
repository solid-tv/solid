# Render Telemetry for Production

A production dashboard needs a small number of fields that say whether a viewer
is having a good time. The renderer's `fpsUpdate` payload is not that: it is a
diagnostic payload with 25+ fields, several of which are traps if you pool them
wrong. This page shows how to reduce it to two numbers per interaction and how
to wire them into a SolidTV app.

The two numbers:

| Field            | Question it answers                                                               |
| ---------------- | --------------------------------------------------------------------------------- |
| `PAGE_SETTLE_MS` | How long from a route change until the new page was fully drawn, images included. |
| `ANIMATED_FPS`   | How smooth motion was while something was actually moving.                        |

Everything else in the payload exists to explain a bad number after the fact, on
a bench, on a device. It does not belong in a fleet dashboard.

## The two renderer signals this is built on

**`idle` fires once per active-to-idle transition.** The stage is not idle while
the scene graph is dirty _or_ while textures are still queued, so the first
`idle` after a route change is the moment the new page's burst of nodes is on
screen with its images uploaded. That is a settle time you can measure with no
instrumentation inside your components.

```js
renderer.on('idle', () => {
  /* the scene just went quiet */
});
```

It is a transition, not a heartbeat: it does not fire again until the scene
renders something and goes quiet a second time. That makes it the natural
boundary for both metrics, and it bounds your event volume to real interactions
rather than to wall clock.

**`animatedFps`, not `fps`.** `fps` covers every rendered frame. A screen that
draws one frame for a late texture load and then sits still posts a dreadful
`fps` that no viewer ever perceived. `animatedFps` is restricted to frames where
something was moving, which is the only time smoothness is observable.

## Setup

Sampling is off unless `fpsUpdateInterval` is set. Since renderer 1.9 it is the
single switch for frame sampling and it is honored in production builds.

```js
Config.rendererOptions = {
  fpsUpdateInterval: 1000,
};
```

One second is a good production value. It is the pooling granularity, not the
reporting granularity: reports are emitted on `idle`, so a 400ms button
animation still produces one report.

Label the samples so a report can name the screen it came from:

```js
renderer.setTelemetrySegment('home');
```

`setTelemetrySegment` closes the sample in progress, so no interval ever spans
two screens. Keep the labels low cardinality. Use the first path part of the
route, so `/hub/date-night` and `/hub/family-night` both report as `hub`. A raw
pathname puts a distinct segment on every title and hub, which is unbounded
cardinality on a facet meant for grouping.

## The tracker

Dependency free apart from the renderer handle and an `emit` callback, so it can
be unit tested on plain objects.

```ts
// src/telemetry/renderPerformance.ts
import { getRenderer } from '@solidtv/solid';
import type { FpsUpdatePayload, RendererMain } from '@solidtv/renderer';

export interface RenderPerformanceReport {
  segment: string;
  /** Route change to renderer quiet. `0` when this burst was not a page load. */
  settleMs: number;
  /** sum(animatedFrames) / sum(animatedMs) over the burst. `0` when unmeasured. */
  animatedFps: number;
  animatedFrames: number;
  /** Longest animated frame in the burst. The jank number. */
  worstFrameMs: number;
}

/** Bursts shorter than this are twitches, not measurements. */
const MIN_ANIMATED_FRAMES = 10;
/** A page that never stops animating has no settle time to report. */
const SETTLE_TIMEOUT_MS = 8000;
/** A permanently animating scene never goes idle. Report anyway. */
const MAX_SAMPLES = 30;
/** Backstop against a pathological session. */
const SESSION_CAP = 200;

/** First path part only, so parameterised routes collapse to one label. */
export const routeToSegment = (pathname: string): string => {
  const trimmed = pathname.charAt(0) === '/' ? pathname.slice(1) : pathname;
  const end = trimmed.indexOf('/');
  const head = end === -1 ? trimmed : trimmed.slice(0, end);
  return head === '' ? 'root' : head.toLowerCase();
};

export const createRenderPerformance = (
  emit: (report: RenderPerformanceReport) => void,
) => {
  const renderer = getRenderer() as RendererMain;

  let segment = '';
  let navStart = 0;
  let samples = 0;
  let animatedFrames = 0;
  let animatedMs = 0;
  let worstFrameMs = 0;
  let emitted = 0;

  const report = (settleMs: number): void => {
    const measured = animatedFrames >= MIN_ANIMATED_FRAMES && animatedMs > 0;
    if ((settleMs > 0 || measured === true) && emitted < SESSION_CAP) {
      emitted += 1;
      emit({
        segment,
        settleMs,
        // sum(frames) / sum(ms), never a mean of the per-sample rates.
        animatedFps:
          measured === true
            ? Math.round((animatedFrames * 1000) / animatedMs)
            : 0,
        animatedFrames,
        worstFrameMs: Math.round(worstFrameMs),
      });
    }
    samples = 0;
    animatedFrames = 0;
    animatedMs = 0;
    worstFrameMs = 0;
  };

  renderer.on('fpsUpdate', (_target: RendererMain, s: FpsUpdatePayload) => {
    samples += 1;
    animatedFrames += s.animatedFrames;
    animatedMs += s.animatedMs;
    if (s.animatedMaxFrameTime > worstFrameMs) {
      worstFrameMs = s.animatedMaxFrameTime;
    }
    if (samples >= MAX_SAMPLES) {
      report(0);
    }
  });

  renderer.on('idle', () => {
    let settleMs = 0;
    if (navStart !== 0) {
      const ms = Date.now() - navStart;
      navStart = 0;
      // A page that keeps animating would otherwise report its first idle,
      // minutes later, as a settle time.
      settleMs = ms <= SETTLE_TIMEOUT_MS ? ms : 0;
    }
    report(settleMs);
  });

  return {
    /** Call on route commit, before the new page mounts its nodes. */
    page: (label: string): void => {
      report(0); // close the previous page's motion under its own label
      segment = label;
      renderer.setTelemetrySegment(label);
      navStart = Date.now();
    },
  };
};
```

A navigation emits one report with both fields. Any other burst, a rail scroll
or a focus animation, emits one with `settleMs: 0`. If your backend prefers two
metric names, split the `emit` call in two at the call site. Nothing structural
changes.

## Wiring it up

Create the tracker once, after the renderer exists, and drive `page()` from the
router:

```jsx
import { createEffect } from 'solid-js';
import { useLocation } from '@solidjs/router';
import {
  createRenderPerformance,
  routeToSegment,
} from './telemetry/renderPerformance';

const App = (props) => {
  const perf = createRenderPerformance((report) => {
    logger.info('render_performance', {
      SEGMENT: report.segment,
      SETTLE_MS: report.settleMs,
      ANIMATED_FPS: report.animatedFps,
      ANIMATED_FRAMES: report.animatedFrames,
      WORST_FRAME_MS: report.worstFrameMs,
    });
  });

  const location = useLocation();
  createEffect(() => perf.page(routeToSegment(location.pathname)));

  return <view>{props.children}</view>;
};
```

If your app does not use the router, call `perf.page(label)` wherever it commits
a screen change. Where you place that call decides what the settle time
contains: call it when the page starts mounting nodes and you measure render
burst alone; call it at route commit and you also capture the data fetch that
precedes the mount. Both are defensible. Pick one, name the metric for it, and
keep it consistent across screens or the numbers are not comparable.

## Reading the numbers

- **`ANIMATED_FPS`** is the smoothness number. On a 60Hz panel with
  `targetFPS: 60`, healthy is 55+. Watch its p10 across a segment rather than
  its mean: the mean is dominated by the many short, cheap bursts.
- **`WORST_FRAME_MS`** is the jank number. `animatedMaxFrameTime` is exact, so a
  single 300ms hitch is visible here even when the FPS for the burst looks fine.
  Frame time percentiles would be more rigorous, but they need the histogram and
  the arithmetic that comes with it, and the peak catches the cases users
  complain about.
- **`PAGE_SETTLE_MS`** is the page load number. Compare it per segment and watch
  its p95. Because idle waits on the texture queue, a regression here is usually
  image work rather than node count.
- **`ANIMATED_FRAMES`** is context, not a metric. It is there so you can tell a
  10 fps reading over 12 frames from one over 400.

When one of these goes red, this data has done its job. Reproduce the segment on
device and profile there. The renderer's phase fields (`updateMs`, `renderMs`,
`uploadMs` and their `max*` peaks) exist for exactly that step, which is why
they are not worth shipping to a dashboard: nothing on the dashboard acts on
them.

## Gotchas

- **A permanently animating screen never goes idle.** A looping spinner or an
  attract loop reports no settle time and reports its FPS through the
  `MAX_SAMPLES` path instead. That is a real gap, not an implementation detail.
  If a screen matters and always animates, give it a deliberate quiet state.
- **`Date.now()`, not `performance.now()`.** On TV targets the high resolution
  clock is clamped to 1ms and costs several times more per read. A settle time
  is hundreds of milliseconds, so nothing is lost.
- **The DOM renderer emits neither event.** `Config.domRendererEnabled` builds
  produce no reports. Guard the setup call if you ship both.
- **Numbers from before renderer 1.8 are not comparable.** Production builds
  used to sample the idle poll cadence and report a meaningless constant around
  60 to 70.
- **`fps` and `sampledFrames` are deliberately absent here.** If you add them
  back, the numerator paired with `renderedMs` is `sampledFrames`, never
  `renderedFrames`. The two differ by one frame per rendering burst and the
  larger one overstates the rate.

## See also

- [FPS Counter](/primitives/fpscounter.md) for the on-screen development overlay
  and the full payload notes.
- [Upgrading to Renderer 1.9](/articles/renderer-1.9-upgrade.md) for what
  changed in the telemetry payload.
- [Real World Performance](/articles/realworldperformance.md) for what to do
  once a number goes red.
