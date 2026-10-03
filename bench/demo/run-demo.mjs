// Runs the demo app's #/benchmark for the solid 1.7 benchmark arms in
// Playwright Chromium (new headless, hardware WebGL) under CDP CPU throttling.
//
//   node bench/demo/run-demo.mjs [--arms A,B,C] [--runs N] [--throttle 6] [--interleave]
//                                [--skip-build] [--query displaySize=20&posterScale=0.5]
//                                [--tmdb fixtures|live] [--out docs/perf/results]
//                                [--timeout 300] [--cooldown 2] [--headed]
//
// Arms (see bench/prepare-arms.mjs and the demo's scripts/benchArms.js):
//   A  solid 1.6.4 on renderer 1.9.3        B  1.6.4 + lockstep patch on renderer v2
//   C  this working tree on ../renderer-v2-solid
//
// Unless --skip-build: prepares the arms, then builds each into
// ../solid-demo-app-1.7/dist-bench/<arm> with `BENCH_ARM=<arm> vite build`, and
// checks from the sourcemaps that it bundled the arm's solid and renderer and
// one copy each of solid-js and @solidtv/renderer.
//
// Each run is a fresh browser context with empty storage: throttle on a blank
// same-origin page, load `/?<query>&arm=<arm>#/benchmark`, wait for the page's
// result log, read `localStorage.benchmarkRuns` (exactly one entry), and write
// <out>/demo-<date>-<arm>-<n>.json. The page drives the presses itself
// (synthetic ArrowDown/ArrowUp, 500ms apart) and times the handler and its
// microtask tail; see the demo's BENCHMARKING.md for every field.
//
// --tmdb fixtures (default) answers api.themoviedb.org with deterministic
// synthetic data (lib.mjs), offline and identical for every arm. --tmdb live
// uses the network and needs the TMDB token in the demo's gitignored
// src/api/key.ts before the build.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { bundleCopies } from './bundle-copies.mjs';
import {
  demoRoot,
  launchChromium,
  routeTmdbFixtures,
  serveDir,
  solidRoot,
} from './lib.mjs';

const { values: opt } = parseArgs({
  options: {
    arms: { type: 'string', default: 'A,B,C' },
    runs: { type: 'string', default: '1' },
    throttle: { type: 'string', default: '6' },
    interleave: { type: 'boolean', default: false },
    'skip-build': { type: 'boolean', default: false },
    query: { type: 'string', default: 'displaySize=20&posterScale=0.5' },
    tmdb: { type: 'string', default: 'fixtures' },
    out: { type: 'string', default: join(solidRoot, 'docs/perf/results') },
    timeout: { type: 'string', default: '300' },
    cooldown: { type: 'string', default: '2' },
    headed: { type: 'boolean', default: false },
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
const runs = Math.max(1, parseInt(opt.runs, 10));
const throttle = parseFloat(opt.throttle);
const timeoutMs = parseFloat(opt.timeout) * 1000;
const outDir = resolve(opt.out);
const rendererC = resolve(solidRoot, '../renderer-v2-solid');
const EXPECT = {
  A: {
    solid: join(solidRoot, 'bench/.arms/solid-a'),
    renderer: join(solidRoot, 'bench/.arms/renderer-a'),
  },
  B: {
    solid: join(solidRoot, 'bench/.arms/solid-b'),
    renderer: join(solidRoot, 'bench/.arms/renderer-b'),
  },
  C: { solid: solidRoot, renderer: rendererC },
};
for (const a of arms) if (!EXPECT[a]) throw new Error(`unknown arm ${a}`);
if (!['fixtures', 'live'].includes(opt.tmdb))
  throw new Error('--tmdb is fixtures or live');

const distOf = (arm) => join(demoRoot, 'dist-bench', arm);
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

// ── build ────────────────────────────────────────────────────────────────
if (!opt['skip-build']) {
  const { prepareArms } = await import('../prepare-arms.mjs');
  prepareArms({ skipC: !arms.includes('C') });
  for (const arm of arms) {
    console.log(
      `\n── building arm ${arm} → ${relative(process.cwd(), distOf(arm))}`,
    );
    execFileSync(
      join(demoRoot, 'node_modules/.bin/vite'),
      ['build', '--sourcemap=true', '--logLevel', 'warn'],
      {
        cwd: demoRoot,
        env: { ...process.env, BENCH_ARM: arm },
        stdio: 'inherit',
      },
    );
  }
}

function verifyBuild(arm) {
  const copies = bundleCopies(distOf(arm));
  const only = (name) => {
    const roots = copies.get(name);
    if (!roots || roots.size !== 1) {
      throw new Error(
        `arm ${arm}: ${name} bundled from ${roots ? [...roots.keys()].join(', ') : 'nowhere'}`,
      );
    }
    return [...roots.keys()][0];
  };
  const build = {
    solidJs: only('solid-js'),
    solid: only('@solidtv/solid'),
    renderer: only('@solidtv/renderer'),
  };
  for (const k of ['solid', 'renderer']) {
    if (build[k] !== EXPECT[arm][k])
      throw new Error(
        `arm ${arm}: bundled ${k} ${build[k]}, expected ${EXPECT[arm][k]}`,
      );
  }
  const html = readFileSync(join(distOf(arm), 'index.html'), 'utf8');
  return {
    ...build,
    entryChunk: /src="\/assets\/(index-[^"]+\.js)"/.exec(html)?.[1] ?? null,
    solidVersion: JSON.parse(
      readFileSync(join(build.solid, 'package.json'), 'utf8'),
    ).version,
    rendererVersion: JSON.parse(
      readFileSync(join(build.renderer, 'package.json'), 'utf8'),
    ).version,
    solidRev: arm === 'C' ? rev(solidRoot) : readPin(build.solid),
    rendererRev: arm === 'C' ? rev(rendererC) : readPin(build.renderer),
    demoRev: rev(demoRoot),
  };
}
function readPin(dir) {
  const f = join(dir, '.bench-pin');
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : null;
}

const builds = {};
for (const arm of arms) {
  if (!existsSync(join(distOf(arm), 'index.html')))
    throw new Error(`no build for arm ${arm}: drop --skip-build`);
  builds[arm] = verifyBuild(arm);
  console.log(
    `arm ${arm}: solid ${builds[arm].solidVersion} (${builds[arm].solidRev}) on renderer ` +
      `${builds[arm].rendererVersion} (${builds[arm].rendererRev}); one solid-js, one renderer`,
  );
}

// ── run ──────────────────────────────────────────────────────────────────
const order = [];
if (opt.interleave)
  for (let r = 0; r < runs; r++) for (const arm of arms) order.push(arm);
else for (const arm of arms) for (let r = 0; r < runs; r++) order.push(arm);

const servers = {};
for (const arm of arms) servers[arm] = await serveDir(distOf(arm));
const browser = await launchChromium({ headed: opt.headed });
mkdirSync(outDir, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fixed busy loop (~15ms unthrottled on an M4 Pro, long enough to span the
// throttler's time slices), timed in the page: its ratio with and without
// throttling shows the throttle took. Best of three.
const calibrate = (page) =>
  page.evaluate(() => {
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const t = performance.now();
      let x = 0;
      for (let i = 0; i < 3e7; i++) x += Math.sqrt(i);
      best = Math.min(best, performance.now() - t + (x < 0 ? 1 : 0));
    }
    return best;
  });

function nextFile(arm) {
  for (let n = 1; ; n++) {
    const f = join(outDir, `demo-${date}-${arm}-${n}.json`);
    if (!existsSync(f)) return f;
  }
}

async function runOnce(arm, seq) {
  const server = servers[arm];
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const unknownTmdb = new Set();
  if (opt.tmdb === 'fixtures')
    await routeTmdbFixtures(context, server.origin, (p) => unknownTmdb.add(p));
  const page = await context.newPage();
  const errors = [];
  let finished;
  const done = new Promise((r) => (finished = r));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().split('\n')[0]);
    if (m.text().includes('BENCHMARK PERFORMANCE RESULTS')) finished();
  });
  page.on('pageerror', (e) =>
    errors.push(`pageerror: ${e.message.split('\n')[0]}`),
  );

  await page.goto(`${server.origin}/__blank`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  const gl = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('webgl');
    const ext = ctx && ctx.getExtension('WEBGL_debug_renderer_info');
    return ctx
      ? ctx.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : ctx.RENDERER)
      : null;
  });
  const cdp = await context.newCDPSession(page);
  const unthrottledMs = await calibrate(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const throttledMs = await calibrate(page);

  const url = `${server.origin}/?${opt.query ? `${opt.query}&` : ''}arm=${arm}#/benchmark`;
  const loadavgStart = os.loadavg();
  const t0 = Date.now();
  await page.goto(url);
  let timer;
  const finishedInTime = await Promise.race([
    done.then(() => true),
    new Promise((r) => (timer = setTimeout(() => r(false), timeoutMs))),
  ]);
  clearTimeout(timer);
  const wallMs = Date.now() - t0;
  const loadavgEnd = os.loadavg();
  if (!finishedInTime) {
    await context.close();
    throw new Error(
      `arm ${arm}: no benchmark result after ${opt.timeout}s` +
        (errors.length
          ? `; console errors:\n  ${[...new Set(errors)].slice(0, 10).join('\n  ')}`
          : '') +
        (opt.tmdb === 'live'
          ? '\n(--tmdb live needs the TMDB token in the demo src/api/key.ts before the build)'
          : ''),
    );
  }
  // The page logs the result, then stores it: let the store land.
  await page.waitForFunction(
    () => (localStorage.getItem('benchmarkRuns') || '[]').length > 2,
    null,
    {
      timeout: 10000,
    },
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('benchmarkRuns') || '[]'),
  );
  if (stored.length !== 1)
    throw new Error(
      `arm ${arm}: expected 1 stored run, found ${stored.length}`,
    );
  const postRunThrottledMs = await calibrate(page);
  const page2 = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    crossOriginIsolated: self.crossOriginIsolated,
    innerWidth,
    innerHeight,
    devicePixelRatio,
  }));
  await context.close();

  const record = {
    schema: 'solid-demo-benchmark/1',
    arm,
    seq,
    date: new Date(t0).toISOString(),
    url,
    storedUrl: stored[0].url,
    throttle,
    tmdb: opt.tmdb,
    build: builds[arm],
    env: {
      chromium: browser.version(),
      gl,
      ...page2,
      host: `${os.cpus()[0]?.model} x${os.cpus().length}, ${os.platform()} ${os.release()}`,
      loadavgStart,
      loadavgEnd,
      throttleCheck: {
        unthrottledMs: +unthrottledMs.toFixed(2),
        throttledMs: +throttledMs.toFixed(2),
        postRunThrottledMs: +postRunThrottledMs.toFixed(2),
        ratio: +(throttledMs / unthrottledMs).toFixed(2),
      },
    },
    wallMs,
    consoleErrors: [...new Set(errors)],
    tmdbUnknownPaths: [...unknownTmdb],
    results: stored[0].results,
  };
  const file = nextFile(arm);
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  return { record, file };
}

const records = [];
try {
  for (let i = 0; i < order.length; i++) {
    const arm = order[i];
    process.stdout.write(
      `\nrun ${i + 1}/${order.length}: arm ${arm} (throttle ${throttle}x) ... `,
    );
    const { record, file } = await runOnce(arm, i + 1);
    records.push(record);
    const d = record.results.inputDispatch;
    console.log(
      `press mean ${d.meanMs}ms, total ${d.totalMs}ms over ${d.keyPresses} presses ` +
        `(throttle ×${record.env.throttleCheck.ratio}, load ${record.env.loadavgStart[0].toFixed(1)}) → ${relative(process.cwd(), file)}`,
    );
    if (record.consoleErrors.length)
      console.log(`  console errors: ${record.consoleErrors.join(' | ')}`);
    if (i < order.length - 1) await sleep(parseFloat(opt.cooldown) * 1000);
  }
} finally {
  await browser.close();
  for (const s of Object.values(servers)) await s.close();
}

// ── summary ──────────────────────────────────────────────────────────────
const METRICS = [
  ['press mean ms', (r) => r.inputDispatch.meanMs],
  ['press total ms', (r) => r.inputDispatch.totalMs],
  ['handler total ms', (r) => r.inputDispatch.handlerTotalMs],
  ['press max ms', (r) => r.inputDispatch.maxMs],
  ['presses', (r) => r.inputDispatch.keyPresses],
  ['update total ms', (r) => r.frameWorkSplit.totalUpdateMs],
  ['render total ms', (r) => r.frameWorkSplit.totalRenderMs],
  ['upload total ms', (r) => r.frameWorkSplit.totalUploadMs],
  ['anim fps', (r) => r.frameRateAndSmoothness.avgAnimatedFps],
  ['anim p95 ms', (r) => r.frameRateAndSmoothness.animP95Ms],
  ['initial render ms', (r) => r.benchmark.initialRenderTimeMs],
  ['textures uploaded', (r) => r.assetsAnimationsGeometry.uploadedTextures],
];
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
const cell = (xs) => {
  const v = xs.filter((x) => typeof x === 'number');
  if (!v.length) return '-';
  if (v.length === 1) return fmt(v[0]);
  return `${fmt(median(v))} [${fmt(Math.min(...v))}–${fmt(Math.max(...v))}]`;
};
const cols = arms.map((arm) => records.filter((r) => r.arm === arm));
const rows = [
  ['metric', ...arms.map((a, i) => `${a} (n=${cols[i].length})`)],
  ...METRICS.map(([name, get]) => [
    name,
    ...cols.map((rs) => cell(rs.map((r) => get(r.results)))),
  ]),
];
const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
console.log(
  `\n${opt.query || 'default scene'}, throttle ${throttle}x, tmdb ${opt.tmdb}` +
    (runs > 1 ? '; median [min–max]' : ''),
);
for (const [i, r] of rows.entries()) {
  console.log(
    r
      .map((c, j) => (j ? c.padStart(widths[j]) : c.padEnd(widths[j])))
      .join('  '),
  );
  if (i === 0) console.log(widths.map((w) => '-'.repeat(w)).join('  '));
}
