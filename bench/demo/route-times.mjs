// Times how long each demo-app route takes to appear: from the hash change to
// the page settling, per arm, under CDP CPU throttling. The routes are
// check-routes.mjs's (lib.mjs ROUTES).
//
//   node bench/demo/route-times.mjs [--arms A,B,C] [--visits 3] [--throttle 6]
//       [--only a,b] [--quiet 500] [--timeout 20] [--tmdb fixtures|live]
//       [--out docs/perf/results/routes-<date>] [--dist-bench <dir>] [--verbose]
//
// The arms are the demo's `dist-bench/<arm>` builds (`node bench/demo/run-demo.mjs`
// builds them; its --skip-build reuses a current build).
//
// One visit is a fresh browser context: load the app on a start route
// (`#/does-not-exist`, an empty page inside the app's nav drawer) unthrottled,
// wait until it has settled, throttle, then set `location.hash` to the route
// and time that to the page settling. Every route is therefore created from
// the same state, in a page that has run no other route (a first visit: its
// lazy chunk is fetched, its code is cold).
//
// Settled: no drawn frame for `--quiet` ms and no request in flight. A drawn
// frame is a requestAnimationFrame callback in which `gl.clear` ran (both
// renderer majors clear once per drawn frame; the same test as the harness's
// probe, bench/harness/probe.mjs). The demo's bundle exposes no handle to the
// renderer, so its `idle` event is not used: the renderer is idle when it
// draws nothing, which is what "no drawn frame" says. The route's time
// (`settleMs`) is from the hash change to the end of its last drawn frame.
// Wall time to settle includes timers and animations, so each visit also
// records `busyMs`: the main thread's task time (CDP `TaskDuration`) over the
// same window, sampled at the last drawn frame. Both are throttled times.
//
// The renderer's fps heartbeat is switched off: the demo's nav wrapper shows an
// fps counter that renderer 1.x updates every 300 ms for ever, even when the
// scene is idle, so arm A would never go quiet. The visit's server response
// for the app's entry chunk has `fpsUpdateInterval: 300` replaced by 0 (the
// demo already hides the counter on #/benchmark for the same reason). The
// counter's text updates are not route work in any arm.
//
// A route still drawing after `--timeout` s (an animation, a ticking page) has
// no settle time and is left out of the sums. Timers that fire later than
// `--quiet` after the last frame (a page that fills in after a second) are not
// seen.
//
// Per route and arm: `--visits` visits, interleaved (route by route, visit by
// visit, A B C in turn) so that load on the machine falls on every arm alike;
// the median is reported, with min and max. Writes <out>.json and <out>.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PINS } from '../prepare-arms.mjs';
import {
  ROUTES,
  demoRoot,
  launchChromium,
  routeTmdbFixtures,
  serveDir,
  solidRoot,
} from './lib.mjs';

const { values: opt } = parseArgs({
  options: {
    arms: { type: 'string', default: 'A,B,C' },
    visits: { type: 'string', default: '3' },
    throttle: { type: 'string', default: '6' },
    only: { type: 'string' },
    quiet: { type: 'string', default: '500' },
    timeout: { type: 'string', default: '20' },
    tmdb: { type: 'string', default: 'fixtures' },
    out: { type: 'string' },
    'dist-bench': { type: 'string', default: join(demoRoot, 'dist-bench') },
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (opt.help) {
  console.log(
    readFileSync(new URL(import.meta.url), 'utf8').split('\nimport ')[0],
  );
  process.exit(0);
}

const arms = opt.arms.split(',').map((a) => a.trim().toUpperCase());
const visits = Math.max(1, parseInt(opt.visits, 10));
const throttle = parseFloat(opt.throttle);
const quietMs = parseFloat(opt.quiet);
const timeoutMs = parseFloat(opt.timeout) * 1000;
const date = new Date().toISOString().slice(0, 10);
const outBase = resolve(
  opt.out ?? join(solidRoot, 'docs/perf/results', `routes-${date}`),
);
if (!['fixtures', 'live'].includes(opt.tmdb))
  throw new Error('--tmdb is fixtures or live');
const only = opt.only?.split(',');
const routes = ROUTES.filter((r) => !only || only.includes(r));
// Every route starts from this one; it starts from START_FOR_NEUTRAL.
const START = 'does-not-exist';
const START_FOR_NEUTRAL = 'versions';
const POLL_MS = 40;
const FPS_HEARTBEAT = 'fpsUpdateInterval: 300,';
let fpsPatched = true;

// ── page side ────────────────────────────────────────────────────────────
// Injected before the app's first script. Must not close over anything.
function frameTracker() {
  const perf = window.performance;
  const raf = window.requestAnimationFrame.bind(window);
  let clears = 0;
  const glTypes = [window.WebGLRenderingContext, window.WebGL2RenderingContext];
  for (let g = 0; g < glTypes.length; g++) {
    const type = glTypes[g];
    if (type === undefined) continue;
    const clear = type.prototype.clear;
    type.prototype.clear = function (mask) {
      clears++;
      clear.call(this, mask);
    };
  }
  const T = {
    drawn: 0,
    lastDrawEnd: 0,
    t0: 0,
    firstEnd: 0,
    frames0: 0,
    maxGap: 0,
  };
  const wrappers = new WeakMap();
  window.requestAnimationFrame = function (callback) {
    let wrapped = wrappers.get(callback);
    if (wrapped === undefined) {
      wrapped = function (time) {
        const c0 = clears;
        callback(time);
        if (clears !== c0) {
          const end = perf.now();
          T.drawn++;
          if (T.t0 !== 0) {
            const gap = end - (T.lastDrawEnd > T.t0 ? T.lastDrawEnd : T.t0);
            if (T.firstEnd !== 0 && gap > T.maxGap) T.maxGap = gap;
            if (T.firstEnd === 0) T.firstEnd = end;
          }
          T.lastDrawEnd = end;
        }
      };
      wrappers.set(callback, wrapped);
    }
    return raf(wrapped);
  };
  window.__routeTimes = {
    /** Starts the clock and changes the route. */
    go(hash) {
      T.t0 = perf.now();
      T.firstEnd = 0;
      T.frames0 = T.drawn;
      T.maxGap = 0;
      window.location.hash = hash;
      return T.t0;
    },
    snapshot() {
      return {
        now: perf.now(),
        t0: T.t0,
        drawn: T.drawn,
        lastDrawEnd: T.lastDrawEnd,
        firstEnd: T.firstEnd,
        frames: T.drawn - T.frames0,
        maxGap: T.maxGap,
      };
    },
  };
}

// ── builds ───────────────────────────────────────────────────────────────
const distOf = (arm) => join(resolve(opt['dist-bench']), arm);
const git = (dir, ...args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
};
const rev = (dir) => {
  const head = git(dir, 'rev-parse', '--short', 'HEAD');
  return (
    head &&
    `${head}${git(dir, 'status', '--porcelain', '--', 'src') ? '+dirty' : ''}`
  );
};
const sourceOf = (arm) =>
  arm === 'A'
    ? { solid: PINS.solidA, renderer: `npm ${PINS.rendererA}` }
    : arm === 'B'
      ? { solid: PINS.solidB, renderer: PINS.rendererB }
      : {
          solid: rev(solidRoot),
          renderer: rev(resolve(solidRoot, '../renderer-v2-solid')),
        };
const builds = {};
for (const arm of arms) {
  const index = join(distOf(arm), 'index.html');
  if (!existsSync(index))
    throw new Error(
      `no build for arm ${arm} in ${distOf(arm)}: node bench/demo/run-demo.mjs builds it`,
    );
  builds[arm] = {
    dist: distOf(arm),
    builtAt: statSync(index).mtime.toISOString(),
    source: sourceOf(arm),
    demo: rev(demoRoot),
  };
}

// ── run ──────────────────────────────────────────────────────────────────
const servers = {};
for (const arm of arms) servers[arm] = await serveDir(distOf(arm));
const browser = await launchChromium();
const gl = await (async () => {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('webgl');
      const e = c && c.getExtension('WEBGL_debug_renderer_info');
      return c
        ? c.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : c.RENDERER)
        : null;
    });
  } finally {
    await page.close();
  }
})();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Main-thread task time so far, in seconds (CDP Performance.getMetrics). */
async function taskDuration(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  for (const m of metrics) if (m.name === 'TaskDuration') return m.value;
  throw new Error('Performance.getMetrics has no TaskDuration');
}

/**
 * Polls until the page has drawn at least one frame since `drawnBefore`, then
 * nothing for quietMs, with nothing in flight; or until `limitMs` of page time
 * have passed since `from`. With a `cdp` session it also samples the task time
 * whenever a poll sees a new last drawn frame, so that `task` is the task time
 * at about the last drawn frame, not at the end of the quiet wait.
 */
async function settle(page, cdp, pending, from, limitMs, drawnBefore) {
  let seen = -1;
  let task = 0;
  for (;;) {
    const s = await page.evaluate(() => window.__routeTimes.snapshot());
    if (cdp !== null && s.lastDrawEnd !== seen) {
      seen = s.lastDrawEnd;
      task = await taskDuration(cdp);
    }
    const quiet = s.now - Math.max(s.lastDrawEnd, from) >= quietMs;
    if (quiet && pending.size === 0 && s.drawn > drawnBefore)
      return { ...s, task, timedOut: false };
    if (s.now - from > limitMs) return { ...s, task, timedOut: true };
    await sleep(POLL_MS);
  }
}

async function visit(arm, route) {
  const server = servers[arm];
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  try {
    const unknown = new Set();
    if (opt.tmdb === 'fixtures')
      await routeTmdbFixtures(context, server.origin, (p) => unknown.add(p));
    const pending = new Set();
    context.on('request', (r) => pending.add(r));
    context.on('requestfinished', (r) => pending.delete(r));
    context.on('requestfailed', (r) => pending.delete(r));
    await context.addInitScript({
      content: `(${frameTracker.toString()})();`,
    });
    await context.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      const res = await route.fetch();
      const code = await res.text();
      if (!code.includes(FPS_HEARTBEAT)) fpsPatched = false;
      await route.fulfill({
        response: res,
        body: code.replace(FPS_HEARTBEAT, 'fpsUpdateInterval: 0,'),
      });
    });
    const page = await context.newPage();
    const errors = new Set();
    page.on('console', (m) => {
      if (m.type() === 'error')
        errors.add(`console: ${m.text().split('\n')[0]}`);
    });
    page.on('pageerror', (e) =>
      errors.add(`pageerror: ${e.message.split('\n')[0]}`),
    );
    page.on('requestfailed', (r) =>
      errors.add(`requestfailed: ${r.url()} ${r.failure()?.errorText}`),
    );
    page.on('response', (r) => {
      if (r.status() >= 400) errors.add(`http ${r.status()}: ${r.url()}`);
    });

    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const start = route === START ? START_FOR_NEUTRAL : START;
    await page.goto(`${server.origin}/#/${start}`);
    const boot = await settle(page, null, pending, 0, 30000, 0);
    if (boot.timedOut) throw new Error(`arm ${arm}: #/${start} did not settle`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const task0 = await taskDuration(cdp);
    const t0 = await page.evaluate(
      (hash) => window.__routeTimes.go(hash),
      `#/${route}`,
    );
    const s = await settle(page, cdp, pending, t0, timeoutMs, boot.drawn);
    return {
      settleMs: s.timedOut ? null : s.lastDrawEnd - t0,
      busyMs: s.timedOut ? null : (s.task - task0) * 1000,
      firstDrawMs: s.firstEnd > 0 ? s.firstEnd - s.t0 : null,
      frames: s.frames,
      maxGapMs: s.maxGap,
      timedOut: s.timedOut,
      errors: [...errors],
      unknownTmdb: [...unknown],
    };
  } finally {
    await context.close();
  }
}

const results = routes.map((route) => ({
  route,
  start: route === START ? START_FOR_NEUTRAL : START,
  arms: Object.fromEntries(arms.map((a) => [a, { visits: [] }])),
}));
const loadavgStart = os.loadavg();
const t0 = Date.now();
try {
  for (const [ri, r] of results.entries()) {
    for (let v = 0; v < visits; v++) {
      for (const arm of arms) {
        const rec = await visit(arm, r.route);
        if (opt.verbose) console.log(`  ${arm} ${JSON.stringify(rec)}`);
        r.arms[arm].visits.push(rec);
      }
    }
    console.log(
      `${String(ri + 1).padStart(2)}/${results.length} #/${r.route}  ` +
        arms
          .map((a) => `${a} ${cellOf(r.arms[a].visits, 'settleMs')}`)
          .join('  '),
    );
  }
} finally {
  await browser.close();
  for (const s of Object.values(servers)) await s.close();
}
const loadavgEnd = os.loadavg();

// ── report ───────────────────────────────────────────────────────────────
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function stat(vs, key) {
  const xs = vs
    .filter((v) => !v.timedOut)
    .map((v) => v[key])
    .filter((x) => typeof x === 'number');
  // A route with fewer than two settled visits has no median worth printing.
  if (xs.length < Math.min(2, vs.length)) return null;
  return {
    median: median(xs),
    min: Math.min(...xs),
    max: Math.max(...xs),
    n: xs.length,
  };
}
function cellOf(vs, key) {
  const s = stat(vs, key);
  return s === null ? 'no idle' : String(Math.round(s.median));
}
for (const r of results)
  for (const arm of arms) {
    r.arms[arm].settle = stat(r.arms[arm].visits, 'settleMs');
    r.arms[arm].busy = stat(r.arms[arm].visits, 'busyMs');
    r.arms[arm].firstDraw = stat(r.arms[arm].visits, 'firstDrawMs');
  }
// A route counts in the sums when every arm has a settle time for it.
const counted = results.filter((r) =>
  arms.every((a) => r.arms[a].settle !== null),
);
const sums = {};
for (const arm of arms) {
  sums[arm] = {
    settleMs: counted.reduce((t, r) => t + r.arms[arm].settle.median, 0),
    busyMs: counted.reduce((t, r) => t + r.arms[arm].busy.median, 0),
  };
}
const record = {
  schema: 'solid-route-times/1',
  date: new Date(t0).toISOString(),
  wallMs: Date.now() - t0,
  arms,
  visits,
  throttle,
  quietMs,
  timeoutMs,
  tmdb: opt.tmdb,
  fpsHeartbeat: fpsPatched
    ? 'off'
    : 'on (the entry chunk has no fpsUpdateInterval: 300)',
  start: START,
  startForNeutral: START_FOR_NEUTRAL,
  builds,
  env: {
    chromium: browser.version(),
    gl,
    host: `${os.cpus()[0]?.model} x${os.cpus().length}, ${os.platform()} ${os.release()}`,
    loadavgStart,
    loadavgEnd,
  },
  counted: counted.map((r) => r.route),
  sums,
  routes: results,
};
writeFileSync(`${outBase}.json`, JSON.stringify(record, null, 2) + '\n');

const f0 = (x) => String(Math.round(x));
const cellMd = (s) =>
  s === null ? 'no idle' : `${f0(s.median)} (${f0(s.min)}-${f0(s.max)})`;
const ratio = (a, b) =>
  a === null || b === null ? '-' : (a.median / b.median).toFixed(2);
function table(key, label) {
  const L = [];
  const head = ['route', ...arms];
  if (arms.includes('B') && arms.includes('C')) head.push('C/B');
  if (arms.includes('A') && arms.includes('B')) head.push('B/A');
  L.push(`| ${head.join(' | ')} |`);
  L.push(`| ${head.map(() => '---').join(' | ')} |`);
  for (const r of results) {
    const row = [`#/${r.route}`, ...arms.map((a) => cellMd(r.arms[a][key]))];
    if (arms.includes('B') && arms.includes('C'))
      row.push(ratio(r.arms.C[key], r.arms.B[key]));
    if (arms.includes('A') && arms.includes('B'))
      row.push(ratio(r.arms.B[key], r.arms.A[key]));
    L.push(`| ${row.join(' | ')} |`);
  }
  const sumRow = [
    `**sum of ${counted.length} routes**`,
    ...arms.map((a) => `**${f0(sums[a][label])}**`),
  ];
  if (arms.includes('B') && arms.includes('C'))
    sumRow.push((sums.C[label] / sums.B[label]).toFixed(2));
  if (arms.includes('A') && arms.includes('B'))
    sumRow.push((sums.B[label] / sums.A[label]).toFixed(2));
  L.push(`| ${sumRow.join(' | ')} |`);
  return L;
}
const excluded = results.filter((r) => !counted.includes(r));
const L = [];
L.push('# Route creation times');
L.push('');
L.push(
  `Generated by \`node bench/demo/route-times.mjs\` (${record.date.slice(0, 10)}). Method: the header of [bench/demo/route-times.mjs](../../../bench/demo/route-times.mjs).`,
);
L.push('');
L.push(
  `- Arms: ${arms.map((a) => `${a} (solid ${builds[a].source.solid}, renderer ${builds[a].source.renderer})`).join('; ')}; demo ${builds[arms[0]].demo}`,
);
L.push(
  `- ${visits} visits per route and arm, each in a fresh page started on \`#/${START}\`; CPU throttling ${throttle}x; TMDB ${opt.tmdb}; fps heartbeat ${fpsPatched ? 'off' : 'ON (not patched)'}; settled = no drawn frame for ${quietMs} ms and no request in flight, at most ${timeoutMs / 1000} s`,
);
L.push(
  `- ${record.env.chromium}, ${gl}; 1-minute load average ${loadavgStart[0].toFixed(1)} at the start, ${loadavgEnd[0].toFixed(1)} at the end`,
);
L.push('');
L.push(
  '## Time from the hash change to the page settling (ms, median of the visits, min-max in parentheses)',
);
L.push('');
L.push(...table('settle', 'settleMs'));
L.push('');
L.push(
  excluded.length === 0
    ? 'Every route settled in every arm.'
    : `Left out of the sums (no settle time in at least one arm): ${excluded.map((r) => `#/${r.route}`).join(', ')}.`,
);
L.push('');
L.push(
  '## Main-thread busy time over the same window (ms of task time, throttled; median, min-max)',
);
L.push('');
L.push(
  'The settle time includes timers and animations (a debounce, a 250 ms transition): it is what a person waits. The busy time is what the page spends on the main thread (CDP `TaskDuration`, sampled at the last drawn frame): script, renderer frames, GC. It is the figure to compare between arms.',
);
L.push('');
L.push(...table('busy', 'busyMs'));
L.push('');
const errs = results.flatMap((r) =>
  arms.flatMap((a) =>
    [...new Set(r.arms[a].visits.flatMap((v) => v.errors))].map(
      (e) => `#/${r.route} ${a}: ${e}`,
    ),
  ),
);
if (errs.length) {
  L.push('## Errors logged while timing');
  L.push('');
  for (const e of errs) L.push(`- ${e}`);
  L.push('');
}
writeFileSync(`${outBase}.md`, L.join('\n'));
console.log(
  `\nsum of ${counted.length} routes, settle: ${arms.map((a) => `${a} ${f0(sums[a].settleMs)} ms`).join(', ')}; busy: ${arms.map((a) => `${a} ${f0(sums[a].busyMs)} ms`).join(', ')}`,
);
console.log(
  `wrote ${relative(process.cwd(), outBase)}.json and ${relative(process.cwd(), outBase)}.md`,
);
