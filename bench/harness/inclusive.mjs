// Inclusive CPU time per named function, from the raw profiles that
// `node bench/run.mjs --modes profile --save-profiles` writes beside its
// results (<scenario>.<arm>.profile.<run>.cpuprofile).
//
//   node bench/harness/inclusive.mjs <results dir> [scenario ...]
//
// For each scenario and arm: µs per op of every function in WATCH (a sample
// counts once per function however deep the recursion), averaged over the
// runs found, plus the self time per chunk. Functions nest (a Row's onRight
// runs inside the key dispatch), so the rows do not add up.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkOf } from './analyze.mjs';

/** [label, chunk, function-name pattern] */
const WATCH = [
  ['key event (Solid listener)', 'framework', /^handleKeyEvents$/],
  ['  dispatch walk', 'framework', /^propagateKeyPress$/],
  ['    capture phase', 'framework', /^runCapturePhase$/],
  ['    bubble phase', 'framework', /^runBubblePhase$/],
  [
    'Row/Column navigation',
    'framework',
    /^(handleNavigation|moveSelection|selectChild|navigableHandleNavigation)$/,
  ],
  ['  scroll', 'framework', /^(withScrolling|scrollToIndex(\$\d)?)$/],
  ['post-mutation pass', 'framework', /^runPostMutation$/],
  ['  flex layout', 'framework', /^(updateLayout|calculateFlex)$/],
  ['focus change', 'framework', /^setActiveElementCore$/],
  ['  focus path', 'framework', /^updateFocusPath$/],
  ['state styles', 'framework', /^_stateChanged$/],
  [
    '  States ops',
    'framework',
    /^(has|add|remove|merge|toggle|States|_super)$/,
  ],
  ['prop writes to the renderer', 'framework', /^_sendToLightningAnimatable$/],
  ['  animateProp', 'renderer', /^animateProp$/],
  [
    'shader prop writes',
    'framework',
    /^(set|_writeShaderTarget|parseAndAssignShaderProps)$/,
  ],
  ['Solid setProp/spread', 'framework', /^(setProp|setProperty|spread)$/],
  ['node creation', 'framework', /^(render|createElement|insertNode)$/],
  ['  renderer createNode', 'renderer', /^(createNode|createTextNode)$/],
  ['reactivity (solid-js)', 'reactivity', /./],
  ['renderer frame', 'renderer', /^(frame|tick)$/],
  ['  scene walk', 'renderer', /^(run|visit)$/],
  ['  draw', 'renderer', /^(draw|drawQuads|flush)$/],
];

const dir = process.argv[2];
const only = new Set(process.argv.slice(3));
if (dir === undefined) {
  console.error('usage: node bench/harness/inclusive.mjs <dir> [scenario ...]');
  process.exit(1);
}

const groups = new Map();
for (const f of readdirSync(dir)) {
  const m = /^(.+)\.([A-Z][a-z0-9-]*)\.profile\.(\d+)\.cpuprofile$/.exec(f);
  if (m === null || (only.size > 0 && !only.has(m[1]))) continue;
  const result = JSON.parse(
    readFileSync(join(dir, f.replace(/\.cpuprofile$/, '.json')), 'utf8'),
  );
  const key = `${m[1]} ${m[2]}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({
    profile: JSON.parse(readFileSync(join(dir, f), 'utf8')),
    measured: result.measured,
  });
}

function analyze({ profile, measured }) {
  const byId = new Map();
  const parent = new Map();
  for (const n of profile.nodes) {
    byId.set(n.id, n);
    for (const c of n.children ?? []) parent.set(c, n.id);
  }
  const incl = new Map(WATCH.map(([label]) => [label, 0]));
  const self = new Map();
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i++) {
    const dt = (timeDeltas[i + 1] ?? timeDeltas[i]) / 1000; // ms
    const leaf = byId.get(samples[i]);
    const leafChunk =
      chunkOf(leaf.callFrame.url) ?? leaf.callFrame.functionName;
    self.set(leafChunk, (self.get(leafChunk) ?? 0) + dt);
    const seen = new Set();
    for (let id = samples[i]; id !== undefined; id = parent.get(id)) {
      const cf = byId.get(id).callFrame;
      const chunk = chunkOf(cf.url);
      for (const [label, wantChunk, re] of WATCH) {
        if (seen.has(label) || chunk !== wantChunk) continue;
        if (re.test(cf.functionName)) {
          seen.add(label);
          incl.set(label, incl.get(label) + dt);
        }
      }
    }
  }
  const perOp = (m) =>
    new Map([...m].map(([k, v]) => [k, (v * 1000) / measured])); // µs/op
  return { incl: perOp(incl), self: perOp(self) };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
for (const [key, runs] of [...groups].sort()) {
  const results = runs.map(analyze);
  console.log(`\n## ${key} (${runs.length} run(s), µs per op)`);
  for (const [label] of WATCH) {
    const v = mean(results.map((r) => r.incl.get(label)));
    if (v >= 0.5) console.log(`${label.padEnd(32)} ${v.toFixed(1)}`);
  }
  const chunks = new Set(results.flatMap((r) => [...r.self.keys()]));
  const selfLine = [...chunks]
    .map((c) => [c, mean(results.map((r) => r.self.get(c) ?? 0))])
    .filter(([, v]) => v >= 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `${c} ${v.toFixed(1)}`)
    .join(', ');
  console.log(`self by chunk: ${selfLine}`);
}
