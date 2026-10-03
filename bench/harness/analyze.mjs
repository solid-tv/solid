// Turns raw page data into per-run results, and result files into
// docs/perf/results/<date>/summary.md. No browser here.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Chunk of a script URL: the bundle's fixed chunk names (bench/vite.config.ts). */
export function chunkOf(url) {
  if (url === '' || url === undefined) {
    return null;
  }
  if (url.endsWith('bench-probe.js')) {
    return 'harness';
  }
  const m = /\/assets\/([a-z-]+)\.js(\?|$)/.exec(url);
  if (m !== null) {
    const name = m[1];
    if (
      name === 'framework' ||
      name === 'reactivity' ||
      name === 'renderer' ||
      name === 'user'
    ) {
      return name;
    }
  }
  return 'other';
}

export const BUCKETS = [
  'framework',
  'reactivity',
  'renderer',
  'user',
  'harness',
  'other',
];

const siteName = (frame, chunk) =>
  `${frame.functionName === '' ? '(anonymous)' : frame.functionName} (${chunk}:${
    frame.lineNumber + 1
  })`;

/**
 * Sampling heap profile → bytes by chunk and by allocating function. As in
 * the renderer's alloc-probe: each node's bytes go to the innermost frame
 * with a script URL on its stack (builtins and natives have none).
 */
export function chargeAllocations(head) {
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  buckets.unattributed = 0;
  const sites = new Map();
  const visit = (node, owner) => {
    const frame = node.callFrame.url !== '' ? node.callFrame : owner;
    if (node.selfSize > 0) {
      if (frame === null) {
        buckets.unattributed += node.selfSize;
      } else {
        const chunk = chunkOf(frame.url);
        buckets[chunk] += node.selfSize;
        const key = siteName(frame, chunk);
        sites.set(key, (sites.get(key) ?? 0) + node.selfSize);
      }
    }
    for (const child of node.children) {
      visit(child, frame);
    }
  };
  visit(head, null);
  return { buckets, sites };
}

const SPECIAL = new Set([
  '(root)',
  '(program)',
  '(idle)',
  '(garbage collector)',
]);

/**
 * CPU profile → self time (ms) by chunk and by function. A sample's time is
 * the gap to the next sample (DevTools' rule); `(idle)` is left out of the
 * total, `(program)` and `(garbage collector)` are kept as buckets. A native
 * function (no script URL: a WebGL call, a builtin) is charged to the chunk
 * of its nearest caller with one, and named `fn [native]`.
 */
export function chargeProfile(profile) {
  const byId = new Map();
  const parent = new Map();
  for (const n of profile.nodes) {
    byId.set(n.id, n);
    for (const c of n.children ?? []) {
      parent.set(c, n.id);
    }
  }
  const ownerChunk = (id) => {
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) {
      const url = byId.get(p).callFrame.url;
      if (url !== '') {
        return chunkOf(url);
      }
    }
    return 'native';
  };
  const self = new Map();
  const samples = profile.samples;
  const deltas = profile.timeDeltas;
  let t = profile.startTime;
  const stamps = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    t += deltas[i];
    stamps[i] = t;
  }
  for (let i = 0; i < samples.length; i++) {
    const next = i + 1 < samples.length ? stamps[i + 1] : profile.endTime;
    const dt = Math.max(0, next - stamps[i]);
    self.set(samples[i], (self.get(samples[i]) ?? 0) + dt);
  }
  const chunks = {};
  const fns = new Map();
  let total = 0;
  for (const [id, us] of self) {
    const node = byId.get(id);
    const frame = node.callFrame;
    let chunk;
    let key;
    if (SPECIAL.has(frame.functionName) && frame.url === '') {
      if (frame.functionName === '(idle)') {
        continue;
      }
      chunk = frame.functionName;
      key = frame.functionName;
    } else if (frame.url === '') {
      chunk = ownerChunk(id);
      key = `${frame.functionName === '' ? '(anonymous)' : frame.functionName} [native] (${chunk})`;
    } else {
      chunk = chunkOf(frame.url);
      key = siteName(frame, chunk);
    }
    const ms = us / 1000;
    total += ms;
    chunks[chunk] = (chunks[chunk] ?? 0) + ms;
    fns.set(key, (fns.get(key) ?? 0) + ms);
  }
  return { total, chunks, fns };
}

/** mean, median, p95, min, max of the numbers in `xs` (nulls dropped). */
export function stats(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) {
    return null;
  }
  v.sort((a, b) => a - b);
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  const mid = v.length >> 1;
  const median = v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return {
    n: v.length,
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    median,
    p95: at(0.95),
    min: v[0],
    max: v[v.length - 1],
  };
}

const TIME_FIELDS = [
  'handler',
  'tail',
  'frame',
  'total',
  'frames',
  'animCpu',
  'undrawnCpu',
  'otherRaf',
  'cpu',
  'settle',
  'frameDelay',
  'keyup',
];

/** The ops of each kind (Scenario.opKind), or null when they have none. */
const byKind = (ops, f) => {
  const kinds = new Map();
  for (const o of ops) {
    if (o.kind === null || o.kind === undefined) {
      return null;
    }
    if (!kinds.has(o.kind)) {
      kinds.set(o.kind, []);
    }
    kinds.get(o.kind).push(o);
  }
  const out = {};
  for (const [k, list] of kinds) {
    out[k] = f(list);
  }
  return out;
};

/** Per-run statistics of a time-mode op list, overall and by kind. */
export function timeStats(ops) {
  const out = timeStatsOf(ops);
  out.byKind = byKind(ops, timeStatsOf);
  return out;
}

function timeStatsOf(ops) {
  const out = {};
  for (const f of TIME_FIELDS) {
    out[f] = stats(ops.map((o) => o[f]));
  }
  out.noFrame = ops.filter((o) => o.frame === null).length;
  out.tailCut = ops.filter((o) => o.tailCut).length;
  out.timedOut = ops.filter((o) => o.timedOut).length;
  return out;
}

/** Per-run statistics of a count-mode op list, overall and by kind. */
export function countStats(ops, flexHooked) {
  const out = countStatsOf(ops, flexHooked);
  out.byKind = byKind(ops, (list) => countStatsOf(list, flexHooked));
  return out;
}

/** Per op, summed over the ops. */
function countStatsOf(ops, flexHooked) {
  const sum = (k) => ops.reduce((a, o) => a + o.counts[k], 0);
  const n = ops.length;
  const frames = ops.reduce((a, o) => a + o.frames, 0);
  const hits = sum('cacheHits');
  const misses = sum('cacheMisses');
  return {
    flexPasses: flexHooked ? sum('flex') / n : null,
    writes: sum('writes') / n,
    shaderWrites: sum('shaderWrites') / n,
    frameWrites: sum('frameWrites') / n,
    animations: sum('animations') / n,
    walks: sum('walks') / n,
    walksPerFrame:
      frames > 0 ? ops.reduce((a, o) => a + o.frameWalks, 0) / frames : null,
    drawnFrames: frames / n,
    loadedText: sum('loadedText') / n,
    loadedOther: sum('loadedOther') / n,
    textLayouts: sum('textLayouts') / n,
    textLayoutMs: sum('textLayoutMs') / n,
    cacheHitRate: hits + misses > 0 ? hits / (hits + misses) : null,
    cacheLookups: (hits + misses) / n,
    finalLayoutFrame: stats(ops.map((o) => o.finalLayoutFrame)),
    finalLayoutMs: stats(ops.map((o) => o.finalLayoutMs)),
  };
}

// ---------------------------------------------------------------------------
// Summary

const median = (xs) => {
  const s = stats(xs);
  return s === null ? null : s.median;
};
const fmt = (x, digits = 2) =>
  x === null || x === undefined || Number.isNaN(x) ? 'n/a' : x.toFixed(digits);
/** "median (min–max)" over runs. */
const cell = (xs, digits = 2) => {
  const s = stats(xs);
  if (s === null) {
    return 'n/a';
  }
  if (s.n === 1) {
    return fmt(s.median, digits);
  }
  return `${fmt(s.median, digits)} (${fmt(s.min, digits)}–${fmt(s.max, digits)})`;
};
const ratio = (a, b) =>
  a === null || b === null || b === 0 ? 'n/a' : (a / b).toFixed(2);
const kb = (b) => (b === null ? null : b / 1024);

/** Reads every `<scenario>.<arm>.<mode>.<run>.json` in `dir`. */
export function readResults(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!/^[^.]+\.[^.]+\.(time|alloc|profile|count)\.\d+\.json$/.test(f)) {
      continue;
    }
    out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  }
  return out;
}

const ARM_ORDER = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The op kinds (Scenario.opKind) seen in these runs' stats, sorted. */
const kindsOf = (runs) => {
  const kinds = new Set();
  for (const r of runs) {
    for (const k of Object.keys(r.stats.byKind ?? {})) {
      kinds.add(k);
    }
  }
  return [...kinds].sort();
};

export function writeSummary(dir) {
  const results = readResults(dir);
  const by = new Map(); // scenario -> arm -> mode -> [result]
  const meta = {
    gpu: new Set(),
    throttle: new Set(),
    load: [],
    quick: false,
    chrome: new Set(),
    coi: new Set(),
    clock: [],
    flex: new Set(),
  };
  const failed = [];
  for (const r of results) {
    if (r.errors.length > 0) {
      failed.push(`${r.scenario}.${r.arm}.${r.mode}.${r.run}`);
      continue;
    }
    if (!by.has(r.scenario)) {
      by.set(r.scenario, new Map());
    }
    const arms = by.get(r.scenario);
    if (!arms.has(r.arm)) {
      arms.set(r.arm, { time: [], alloc: [], profile: [], count: [] });
    }
    arms.get(r.arm)[r.mode].push(r);
    if (r.env !== undefined) {
      meta.gpu.add(r.env.gpu);
      meta.chrome.add(r.env.chrome);
      meta.coi.add(r.env.crossOriginIsolated);
      meta.clock.push(r.env.clockResolutionUs);
    }
    meta.throttle.add(r.throttle);
    meta.flex.add(r.flex);
    meta.load.push(r.loadAvg);
    meta.quick = meta.quick || r.quick === true;
  }
  const L = [];
  L.push(`# Benchmark summary`);
  L.push('');
  L.push(
    `Generated by \`node bench/run.mjs\` from the ${results.length} result files in this directory. Methodology: [docs/perf/README.md](../../README.md).`,
  );
  L.push('');
  L.push(`- CPU throttling: ${[...meta.throttle].join(', ')}x`);
  L.push(`- GPU: ${[...meta.gpu].join('; ')}`);
  L.push(`- Flex: ${[...meta.flex].join(', ')}`);
  L.push(`- Chromium: ${[...meta.chrome].join(', ')}`);
  L.push(
    `- crossOriginIsolated: ${[...meta.coi].join(', ')}; clock resolution ${fmt(Math.max(...meta.clock), 1)} µs at worst`,
  );
  L.push(
    `- 1-minute load average at run start: ${fmt(Math.min(...meta.load), 1)}–${fmt(Math.max(...meta.load), 1)}`,
  );
  if (failed.length > 0) {
    L.push(
      `- **Left out, with errors** (see their JSON): ${failed.join(', ')}`,
    );
  }
  if (meta.quick) {
    L.push('- **Some runs used `--quick`** (fewer ops): smoke numbers only.');
  }
  L.push('');
  L.push(
    'Each cell is the median over runs of the per-run value, with the min–max over runs in parentheses. Times are ms of wall clock under CPU throttling. The per-run value of a time is its **mean over ops**: the throttler is a duty cycle (at 6x about 0.17 ms running, 0.85 ms suspended), so a sub-millisecond interval reads either unthrottled or one suspension longer, and only the mean estimates rate × CPU (see the README).',
  );
  L.push('');

  const scenarios = [...by.keys()].sort();
  // Scenario.probe: the state after the measured ops against the state after
  // the warmup (whole cycles: equal), and the final state across arms.
  const stateNotes = [];
  for (const s of scenarios) {
    const finals = new Map();
    for (const [a, modesOf] of by.get(s)) {
      for (const r of [
        ...modesOf.time,
        ...modesOf.alloc,
        ...modesOf.profile,
        ...modesOf.count,
      ]) {
        if (r.state === undefined) {
          continue;
        }
        if (r.state.cycleOk !== true) {
          stateNotes.push(
            `${s} ${a} ${r.mode} #${r.run}: the state after the measured ops differs from the state after the warmup`,
          );
        }
        if (r.mode === 'time' && !finals.has(a)) {
          finals.set(a, JSON.stringify(r.state.end));
        }
      }
    }
    if (new Set(finals.values()).size > 1) {
      stateNotes.push(
        `${s}: the final state differs between arms (${[...finals.keys()].sort().join(', ')}); see \`state.end\` in the time results`,
      );
    }
  }
  if (stateNotes.length > 0) {
    L.push('## State checks (Scenario.probe)');
    L.push('');
    for (const n of stateNotes) {
      L.push(`- ${n}`);
    }
    L.push('');
  }
  // Time
  L.push('## Time per op (ms, per-run mean over ops)');
  L.push('');
  L.push(
    '`total` = handler + tail + frame (keydown to the end of the frame that shows it); `cpu` adds every later frame until idle; `p95 total` is the per-run 95th percentile.',
  );
  L.push('');
  L.push(
    '| scenario | arm | handler | tail | frame | total | p95 total | cpu | drawn frames | settle | runs |',
  );
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of scenarios) {
    const arms = by.get(s);
    for (const a of [...arms.keys()].sort(ARM_ORDER)) {
      const t = arms.get(a).time;
      if (t.length === 0) {
        continue;
      }
      for (const kind of [null, ...kindsOf(t)]) {
        const st = (r) => (kind === null ? r.stats : r.stats.byKind?.[kind]);
        const m = (f, k = 'mean') => t.map((r) => st(r)?.[f]?.[k] ?? null);
        L.push(
          `| ${s} | ${a}${kind === null ? '' : ` [${kind}]`} | ${cell(m('handler'), 3)} | ${cell(m('tail'), 3)} | ${cell(m('frame'), 3)} | ${cell(m('total'), 3)} | ${cell(m('total', 'p95'), 3)} | ${cell(m('cpu'), 3)} | ${cell(m('frames'), 1)} | ${cell(m('settle'), 1)} | ${t.length} |`,
        );
      }
    }
  }
  L.push('');
  // Ratios
  L.push('## Ratios (medians over runs)');
  L.push('');
  L.push(
    'A/B: shipping 1.6.4 on renderer 1.9.3 over the lockstep port on renderer v2. B/C: the same code today, so B/C is the in-session noise floor.',
  );
  L.push('');
  L.push(
    '| scenario | A/B total | B/C total | A/B handler | B/C handler | A/B frame | B/C frame | A/B bytes/op | B/C bytes/op | A/B writes/op | B/C writes/op |',
  );
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of scenarios) {
    const arms = by.get(s);
    const tm = (a, f) =>
      arms.has(a)
        ? median(arms.get(a).time.map((r) => r.stats[f]?.mean ?? null))
        : null;
    const al = (a) =>
      arms.has(a)
        ? median(arms.get(a).alloc.map((r) => r.bytesPerOp.total))
        : null;
    const wr = (a) =>
      arms.has(a) ? median(arms.get(a).count.map((r) => r.stats.writes)) : null;
    L.push(
      `| ${s} | ${ratio(tm('A', 'total'), tm('B', 'total'))} | ${ratio(tm('B', 'total'), tm('C', 'total'))} | ${ratio(tm('A', 'handler'), tm('B', 'handler'))} | ${ratio(tm('B', 'handler'), tm('C', 'handler'))} | ${ratio(tm('A', 'frame'), tm('B', 'frame'))} | ${ratio(tm('B', 'frame'), tm('C', 'frame'))} | ${ratio(al('A'), al('B'))} | ${ratio(al('B'), al('C'))} | ${ratio(wr('A'), wr('B'))} | ${ratio(wr('B'), wr('C'))} |`,
    );
  }
  L.push('');
  // Allocation
  L.push(
    '## Allocation per op (KiB, sampling heap profiler, collected objects included)',
  );
  L.push('');
  L.push(
    "`total` is the app: framework + reactivity + renderer + user. `harness` (the op loop) and `no script` (allocations with no script frame on the stack, mostly Blink objects such as the harness's own MessageEvents) are shown beside it, not in it.",
  );
  L.push('');
  L.push(
    '| scenario | arm | total | framework | reactivity | renderer | user | harness | no script | runs |',
  );
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const tops = [];
  for (const s of scenarios) {
    const arms = by.get(s);
    for (const a of [...arms.keys()].sort(ARM_ORDER)) {
      const al = arms.get(a).alloc;
      if (al.length === 0) {
        continue;
      }
      const b = (k) => al.map((r) => kb(r.bytesPerOp[k]));
      L.push(
        `| ${s} | ${a} | ${cell(b('total'), 2)} | ${cell(b('framework'), 2)} | ${cell(b('reactivity'), 2)} | ${cell(b('renderer'), 2)} | ${cell(b('user'), 2)} | ${cell(b('harness'), 2)} | ${cell(b('unattributed'), 2)} | ${al.length} |`,
      );
      const sites = new Map();
      for (const r of al) {
        for (const [k, v] of r.topSites) {
          sites.set(k, (sites.get(k) ?? 0) + v / al.length);
        }
      }
      tops.push([
        s,
        a,
        [...sites.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5),
      ]);
    }
  }
  L.push('');
  if (tops.length > 0) {
    L.push(
      'Top allocating functions (bytes per op, mean over runs; harness excluded):',
    );
    L.push('');
    for (const [s, a, list] of tops) {
      L.push(
        `- ${s} ${a}: ${list.map(([k, v]) => `\`${k}\` ${v.toFixed(0)}`).join(', ') || 'none'}`,
      );
    }
    L.push('');
  }
  // Count
  L.push('## Counts per op (instrumented build; its timings are not reported)');
  L.push('');
  L.push(
    "`node writes` and `shader writes` count setter calls on renderer nodes and on shader `props`; `in frames` is the part of both made inside rAF callbacks (renderer v1 steps animations through the setters, v2 writes its arrays directly; Solid's flex on `loaded` runs there too). `loaded` counts events delivered to nodes that listen for them.",
  );
  L.push('');
  L.push(
    '| scenario | arm | flex passes | node writes | shader writes | in frames | animations | walks/drawn frame | drawn frames | loaded (text) | loaded (other) | runs |',
  );
  L.push(
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  const textRows = [];
  for (const s of scenarios) {
    const arms = by.get(s);
    for (const a of [...arms.keys()].sort(ARM_ORDER)) {
      const c = arms.get(a).count;
      if (c.length === 0) {
        continue;
      }
      for (const kind of [null, ...kindsOf(c)]) {
        const st = (r) => (kind === null ? r.stats : r.stats.byKind?.[kind]);
        const v = (k) => c.map((r) => st(r)?.[k] ?? null);
        L.push(
          `| ${s} | ${a}${kind === null ? '' : ` [${kind}]`} | ${cell(v('flexPasses'), 1)} | ${cell(v('writes'), 1)} | ${cell(v('shaderWrites'), 1)} | ${cell(v('frameWrites'), 1)} | ${cell(v('animations'), 1)} | ${cell(v('walksPerFrame'), 2)} | ${cell(v('drawnFrames'), 1)} | ${cell(v('loadedText'), 1)} | ${cell(v('loadedOther'), 1)} | ${c.length} |`,
        );
      }
      const v = (k) => c.map((r) => r.stats[k]);
      if (c[0].text === true) {
        textRows.push(
          `| ${s} | ${a} | ${cell(v('textLayouts'), 1)} | ${cell(v('textLayoutMs'), 3)} | ${cell(v('cacheHitRate'), 2)} | ${cell(
            c.map((r) => r.stats.finalLayoutFrame?.median ?? null),
            1,
          )} | ${cell(
            c.map((r) => r.stats.finalLayoutMs?.median ?? null),
            1,
          )} |`,
        );
      }
    }
  }
  L.push('');
  if (textRows.length > 0) {
    L.push('### Text metrics per op (count mode)');
    L.push('');
    L.push(
      '| scenario | arm | text layout calls | text layout ms | layout cache hit rate | frames to final layout | ms to final layout |',
    );
    L.push('| --- | --- | --- | --- | --- | --- | --- |');
    L.push(...textRows);
    L.push('');
  }
  // Profile
  const profRows = [];
  for (const s of scenarios) {
    const arms = by.get(s);
    for (const a of [...arms.keys()].sort(ARM_ORDER)) {
      const p = arms.get(a).profile;
      if (p.length === 0) {
        continue;
      }
      const chunks = new Map();
      const fns = new Map();
      for (const r of p) {
        for (const [k, v] of Object.entries(r.selfPerOp.chunks)) {
          chunks.set(k, (chunks.get(k) ?? 0) + v / p.length);
        }
        for (const [k, v] of r.selfPerOp.top) {
          fns.set(k, (fns.get(k) ?? 0) + v / p.length);
        }
      }
      profRows.push([
        s,
        a,
        chunks,
        [...fns.entries()].sort((x, y) => y[1] - x[1]).slice(0, 20),
      ]);
    }
  }
  if (profRows.length > 0) {
    L.push('## Profile: self time per op (ms, mean over runs)');
    L.push('');
    for (const [s, a, chunks, fns] of profRows) {
      L.push(`### ${s} ${a}`);
      L.push('');
      L.push(
        `By chunk: ${[...chunks.entries()]
          .sort((x, y) => y[1] - x[1])
          .map(([k, v]) => `${k} ${v.toFixed(3)}`)
          .join(', ')}`,
      );
      L.push('');
      L.push('| # | function (chunk:line) | self ms/op |');
      L.push('| --- | --- | --- |');
      fns.forEach(([k, v], i) =>
        L.push(`| ${i + 1} | \`${k}\` | ${v.toFixed(3)} |`),
      );
      L.push('');
    }
  }
  writeFileSync(join(dir, 'summary.md'), L.join('\n'));
  return join(dir, 'summary.md');
}
