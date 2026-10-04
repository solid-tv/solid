// The benchmark runner: `npm run bench` (node bench/run.mjs). Builds each arm,
// serves it with COOP/COEP (so performance.now() has a 5 µs clock), and
// drives one fresh Chromium per run with CDP CPU throttling. Methodology and
// the meaning of every number: docs/perf/README.md.
//
//   node bench/run.mjs [--arms A,B,C] [--scenarios id,...] [--runs 3]
//     [--modes time,alloc,profile,count] [--throttle 6] [--skip-build]
//     [--quick] [--out dir] [--gpu metal|swiftshader|default] [--no-chunks]
//     [--flex new|old] [--alloc-interval 1] [--profile-interval 50]
//     [--idle-timeout 10000] [--summarize dir]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { cpus, loadavg } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { ARMS, PINS, prepareArms } from './prepare-arms.mjs';
import { pageProbe } from './harness/probe.mjs';
import {
  BUCKETS,
  chargeAllocations,
  chargeProfile,
  countStats,
  timeStats,
  writeSummary,
} from './harness/analyze.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const solidRoot = resolve(here, '..');
const distRoot = join(here, 'dist');
const require = createRequire(import.meta.url);

const { values: args } = parseArgs({
  options: {
    arms: { type: 'string', default: 'A,B,C' },
    scenarios: { type: 'string' },
    runs: { type: 'string', default: '3' },
    modes: { type: 'string', default: 'time,alloc,profile,count' },
    throttle: { type: 'string', default: '6' },
    'skip-build': { type: 'boolean', default: false },
    quick: { type: 'boolean', default: false },
    out: { type: 'string' },
    gpu: {
      type: 'string',
      default: process.platform === 'darwin' ? 'metal' : 'default',
    },
    'no-chunks': { type: 'boolean', default: false },
    flex: { type: 'string', default: 'new' },
    'alloc-interval': { type: 'string', default: '1' },
    'profile-interval': { type: 'string', default: '50' },
    'save-profiles': { type: 'boolean', default: false },
    'idle-timeout': { type: 'string', default: '10000' },
    summarize: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .slice(0, 10)
      .join('\n'),
  );
  process.exit(0);
}

if (args.summarize !== undefined) {
  console.log(`wrote ${writeSummary(resolve(args.summarize))}`);
  process.exit(0);
}

const arms = args.arms.split(',').map((a) => a.trim().toUpperCase());
for (const a of arms) {
  if (!(a in ARMS)) {
    throw new Error(`unknown arm ${a}: one of ${Object.keys(ARMS).join(', ')}`);
  }
}
const modes = args.modes.split(',').map((m) => m.trim());
for (const m of modes) {
  if (!['time', 'alloc', 'profile', 'count'].includes(m)) {
    throw new Error(`unknown mode ${m}`);
  }
}
const runs = Number(args.runs);
const throttle = Number(args.throttle);
const chunks = !args['no-chunks'];
if (args.flex !== 'new' && args.flex !== 'old') {
  throw new Error(
    '--flex: new (src/core/flexLayout.ts, the demo app) or old (flex.ts)',
  );
}
const flexOld = args.flex === 'old';
const today = new Date().toISOString().slice(0, 10);
const outDir = resolve(args.out ?? join(solidRoot, 'docs/perf/results', today));
mkdirSync(outDir, { recursive: true });

/** dist/<arm>[-count][-flexold][-nochunks], as bench/vite.config.ts names them. */
const buildName = (arm, instrument) =>
  arm +
  (instrument ? '-count' : '') +
  (flexOld ? '-flexold' : '') +
  (chunks ? '' : '-nochunks');
/** The arm as results label it: B, or B-flexold / B-nochunks for a variant. */
const label = (arm) =>
  arm + (flexOld ? '-flexold' : '') + (chunks ? '' : '-nochunks');

// ---------------------------------------------------------------------------
// Build

function build(arm, instrument) {
  const vite = join(
    dirname(require.resolve('vite/package.json')),
    'bin/vite.js',
  );
  console.log(`build ${buildName(arm, instrument)}`);
  const r = spawnSync(
    process.execPath,
    [
      vite,
      'build',
      '--config',
      join(here, 'vite.config.ts'),
      '--logLevel',
      'warn',
    ],
    {
      cwd: solidRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        BENCH_ARM: arm,
        BENCH_INSTRUMENT: instrument ? '1' : '0',
        BENCH_CHUNKS: chunks ? '1' : '0',
        BENCH_FLEX: args.flex,
      },
    },
  );
  if (r.status !== 0) {
    throw new Error(`build of arm ${arm} failed`);
  }
}

if (!args['skip-build']) {
  prepareArms();
  for (const arm of arms) {
    if (modes.some((m) => m !== 'count')) {
      build(arm, false);
    }
    if (modes.includes('count')) {
      build(arm, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Serve: COOP/COEP make the page cross-origin isolated (5 µs clock).

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function serve(root) {
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname,
    );
    let file = normalize(join(root, path));
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (file.endsWith(sep)) {
      file += 'index.html';
    }
    let body;
    try {
      body = readFileSync(file);
    } catch {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'same-origin',
      'cache-control': 'no-store',
    });
    res.end(body);
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

// ---------------------------------------------------------------------------
// Browser

const GPU_ARGS = {
  // The hardware GPU through ANGLE's Metal backend (headless new mode).
  metal: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'],
  // Software GL: burns CPU in the GPU process; for comparison only.
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  default: [],
};
if (!(args.gpu in GPU_ARGS)) {
  throw new Error(`--gpu: one of ${Object.keys(GPU_ARGS).join(', ')}`);
}

const launch = () =>
  chromium.launch({
    channel: 'chromium',
    headless: true,
    args: [
      ...GPU_ARGS[args.gpu],
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

const probeOptions = (mode) => ({
  mode,
  gapMs: 50,
  quietMs: 50,
  idleTimeoutMs: Number(args['idle-timeout']),
});

const git = (dir, ...a) => {
  try {
    return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

/** What each arm is, for the record. */
function armSource(arm) {
  if (arm === 'A') {
    return { solid: PINS.solidA, renderer: `npm ${PINS.rendererA}` };
  }
  if (arm === 'B') {
    return { solid: PINS.solidB, renderer: PINS.rendererB };
  }
  const dirty = (dir, paths) =>
    (git(dir, 'status', '--porcelain', '--', ...paths) ?? '') !== '';
  return {
    solid: `${git(solidRoot, 'rev-parse', '--short', 'HEAD')}${dirty(solidRoot, ['src']) ? '+dirty' : ''}`,
    renderer: `${git(ARMS.C.renderer, 'rev-parse', '--short', 'HEAD')}${dirty(ARMS.C.renderer, ['src']) ? '+dirty' : ''}`,
  };
}

/**
 * Ops per page load. --quick takes at most 5 warmup and 10 measured ops,
 * rounded up to whole cycles (Scenario.cycle) so that a warm-cache scenario
 * stays warm.
 */
const opCounts = (info) => {
  if (!args.quick) {
    return { warmup: info.warmup, measured: info.measured };
  }
  const cycle = info.cycle;
  const whole = (n) =>
    cycle === null ? n : Math.max(cycle, Math.ceil(n / cycle) * cycle);
  return {
    warmup: whole(Math.min(info.warmup, 5)),
    measured: whole(Math.min(info.measured, 10)),
  };
};

/** One page load: one scenario, one arm, one mode. */
async function runOnce({ origin, arm, scenario, mode, run }) {
  const instrument = mode === 'count';
  const url = `${origin}/${buildName(arm, instrument)}/index.html?scenario=${encodeURIComponent(scenario)}`;
  const browser = await launch();
  const errors = [];
  const record = {
    scenario,
    arm: label(arm),
    mode,
    run,
    throttle,
    quick: args.quick,
    gpuFlag: args.gpu,
    chunks,
    flex: flexOld ? 'old (src/core/flex.ts)' : 'new (src/core/flexLayout.ts)',
    loadAvg: loadavg()[0],
    cpu: cpus()[0]?.model,
    date: new Date().toISOString(),
    source: armSource(arm),
  };
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      // A failed load is reported below with its URL.
      if (
        m.type() === 'error' &&
        !m.text().startsWith('Failed to load resource')
      ) {
        errors.push(`console: ${m.text()}`);
      }
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) {
        errors.push(`http ${res.status()}: ${res.url()}`);
      }
    });
    await page.addInitScript({
      content: `(${pageProbe.toString()})(${JSON.stringify(probeOptions(mode))});\n//# sourceURL=bench-probe.js`,
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.goto(url);
    await page.waitForFunction(
      () => window.__bench !== undefined && window.__benchProbe !== undefined,
      undefined,
      { timeout: 30000 },
    );
    await page.evaluate(() => window.__benchProbe.ready(30000));
    const info = await page.evaluate(() => window.__benchProbe.info());
    const { warmup, measured } = opCounts(info);
    record.title = info.title;
    record.text = info.text;
    record.warmup = warmup;
    record.measured = measured;
    record.cycle = info.cycle;
    record.env = {
      chrome: browser.version(),
      gpu: info.gpu,
      crossOriginIsolated: info.crossOriginIsolated,
      clockResolutionUs: info.clockResolutionUs,
      rendererMajor: info.rendererMajor,
      instrumented: info.instrumented,
      flex: info.flex,
    };
    if (info.flex !== args.flex) {
      throw new Error(
        `the build runs ${info.flex} flex, not ${args.flex}: rebuild`,
      );
    }
    if (mode === 'count') {
      record.hooks = await page.evaluate(() =>
        window.__benchProbe.installCounters(),
      );
    }
    const state = () => page.evaluate(() => window.__benchProbe.state());
    const states = { start: await state() };
    await page.evaluate((n) => window.__benchProbe.runOps(0, n, false), warmup);
    states.afterWarmup = await state();
    if (mode === 'count') {
      await page.evaluate(() => window.__benchProbe.resetCountDetails());
    }
    if (mode === 'alloc') {
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.startSampling', {
        samplingInterval: Number(args['alloc-interval']),
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
    } else if (mode === 'profile') {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', {
        interval: Number(args['profile-interval']),
      });
      await cdp.send('Profiler.start');
    }
    const ops = await page.evaluate(
      ([first, n]) => window.__benchProbe.runOps(first, n, true),
      [warmup, measured],
    );
    record.ops = ops;
    states.end = await state();
    if (states.start !== null) {
      // With whole cycles of ops, the state after the measured ops is the
      // state after the warmup.
      states.cycleOk =
        JSON.stringify(states.afterWarmup) === JSON.stringify(states.end);
      record.state = states;
    }
    if (mode === 'time') {
      record.stats = timeStats(ops);
    } else if (mode === 'alloc') {
      const { profile } = await cdp.send('HeapProfiler.stopSampling');
      const { buckets, sites } = chargeAllocations(profile.head);
      const perOp = {};
      for (const b of BUCKETS) {
        perOp[b] = buckets[b] / measured;
      }
      perOp.unattributed = buckets.unattributed / measured;
      // The app's bytes: the four chunks. The harness (the op loop, the key
      // events), other scripts and allocations with no script on the stack
      // (Blink's own: the harness's MessageEvents, event dispatch) are
      // reported beside it.
      perOp.total =
        perOp.framework + perOp.reactivity + perOp.renderer + perOp.user;
      record.bytesPerOp = perOp;
      record.allocInterval = Number(args['alloc-interval']);
      record.topSites = [...sites.entries()]
        .filter(([k]) => !k.includes('(harness:'))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([k, v]) => [k, v / measured]);
    } else if (mode === 'profile') {
      const { profile } = await cdp.send('Profiler.stop');
      const { total, chunks: byChunk, fns } = chargeProfile(profile);
      const perChunk = {};
      for (const [k, v] of Object.entries(byChunk)) {
        perChunk[k] = v / measured;
      }
      record.profileInterval = Number(args['profile-interval']);
      record.selfPerOp = {
        total: total / measured,
        chunks: perChunk,
        top: [...fns.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 40)
          .map(([k, v]) => [k, v / measured]),
      };
      if (args['save-profiles']) {
        // Written beside the result as <result>.cpuprofile (Chrome DevTools
        // format), for inclusive-time analysis; not kept in the JSON.
        record.rawProfile = profile;
      }
    } else {
      const details = await page.evaluate(() =>
        window.__benchProbe.countDetails(),
      );
      // What the hooks learned over the run, beside what they found at
      // install; a hook that threw, or could not install, fails the run.
      record.hooks.shaderUnwrapped = details.shaderUnwrapped;
      record.hooks.errors = details.hookErrors;
      for (const [hook, count] of details.hookErrors) {
        errors.push(`count hook ${hook} threw ${count} time(s)`);
      }
      record.stats = countStats(ops, record.hooks);
      const perOp = (list) =>
        list
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([k, v]) => [k, v / measured]);
      record.topWrites = {
        node: perOp(details.nodeWrites),
        shader: perOp(details.shaderWrites),
      };
    }
  } catch (e) {
    errors.push(`runner: ${e.message}`);
  } finally {
    await browser.close();
  }
  record.errors = errors;
  return record;
}

// ---------------------------------------------------------------------------
// Main

const server = await serve(distRoot);
const origin = `http://127.0.0.1:${server.address().port}`;

let scenarios;
if (args.scenarios !== undefined) {
  scenarios = args.scenarios.split(',').map((s) => s.trim());
} else {
  // The build's own list (main.tsx), less the harness smoke test.
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(
    `${origin}/${buildName(arms[0], modes[0] === 'count')}/index.html?scenario=smoke`,
  );
  await page.waitForFunction(() => window.__bench !== undefined);
  const list = await page.evaluate(() => window.__bench.scenarios);
  await browser.close();
  scenarios = list.map((s) => s.id).filter((id) => id !== 'smoke');
  if (scenarios.length === 0) {
    throw new Error(
      'no scenarios registered besides smoke: pass --scenarios smoke',
    );
  }
}

console.log(
  `arms ${arms.join(',')}; scenarios ${scenarios.join(',')}; modes ${modes.join(',')}; ${runs} run(s); throttle ${throttle}x; gpu ${args.gpu}; flex ${args.flex}${chunks ? '' : '; no chunks'}${args.quick ? '; quick' : ''}`,
);
console.log(`results: ${outDir}`);

let failures = 0;
for (const mode of modes) {
  for (const scenario of scenarios) {
    for (let run = 1; run <= runs; run++) {
      // Arms interleaved within a run set: A, B, C, A, B, C, ...
      for (const arm of arms) {
        const r = await runOnce({ origin, arm, scenario, mode, run });
        const file = join(
          outDir,
          `${scenario}.${label(arm)}.${mode}.${run}.json`,
        );
        if (r.rawProfile !== undefined) {
          writeFileSync(
            file.replace(/\.json$/, '.cpuprofile'),
            JSON.stringify(r.rawProfile),
          );
          r.rawProfile = undefined;
        }
        writeFileSync(file, JSON.stringify(r, null, 1));
        let line = `${mode} ${scenario} ${label(arm)} #${run}:`;
        if (r.errors.length > 0) {
          failures++;
          line += ` ERRORS ${r.errors.slice(0, 3).join(' | ')}`;
        }
        if (mode === 'time' && r.stats !== undefined) {
          const s = r.stats;
          line += ` handler ${s.handler.mean.toFixed(3)} tail ${s.tail.mean.toFixed(3)} frame ${s.frame?.mean.toFixed(3) ?? 'n/a'} total ${s.total.mean.toFixed(3)} cpu ${s.cpu.mean.toFixed(3)} ms (mean of ${r.measured})`;
          if (s.timedOut > 0) {
            line += ` ${s.timedOut} op(s) timed out`;
          }
        } else if (mode === 'alloc' && r.bytesPerOp !== undefined) {
          const b = r.bytesPerOp;
          line += ` ${(b.total / 1024).toFixed(2)} KiB/op (framework ${(b.framework / 1024).toFixed(2)}, reactivity ${(b.reactivity / 1024).toFixed(2)}, renderer ${(b.renderer / 1024).toFixed(2)}, user ${(b.user / 1024).toFixed(2)})`;
        } else if (mode === 'profile' && r.selfPerOp !== undefined) {
          line += ` ${r.selfPerOp.total.toFixed(3)} ms self/op; top ${r.selfPerOp.top[0]?.[0]}`;
        } else if (mode === 'count' && r.stats !== undefined) {
          const s = r.stats;
          line += ` flex ${s.flexPasses?.toFixed(1) ?? 'n/a'} writes ${s.writes?.toFixed(1) ?? 'n/a'} shader ${s.shaderWrites?.toFixed(1) ?? 'n/a'} walks/frame ${s.walksPerFrame?.toFixed(2) ?? 'n/a'} loaded ${s.loadedText?.toFixed(1) ?? 'n/a'}/${s.loadedOther?.toFixed(1) ?? 'n/a'} per op`;
        }
        if (r.env !== undefined) {
          if (
            r.env.crossOriginIsolated !== true ||
            r.env.clockResolutionUs > 20
          ) {
            line += ` WARNING clock ${r.env.clockResolutionUs.toFixed(1)} µs, isolated ${r.env.crossOriginIsolated}`;
          }
          if (
            /SwiftShader/i.test(r.env.gpu ?? '') &&
            args.gpu !== 'swiftshader'
          ) {
            line += ' WARNING software GL';
          }
        }
        console.log(line);
      }
    }
  }
}
server.close();
console.log(`wrote ${writeSummary(outDir)}`);
if (failures > 0) {
  console.log(`${failures} run(s) had errors (see "errors" in their JSON)`);
  process.exitCode = 1;
}
