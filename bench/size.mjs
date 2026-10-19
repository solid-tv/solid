// Bundle size of the package: `node bench/size.mjs [--out file.json]`.
//
// Two entries, each built with Vite in lib mode with solid-js, the renderer,
// the router and @solid-primitives external, then minified with terser and
// gzipped at level 9:
//   every export       src/index.ts + src/primitives/index.ts (both entries)
//   typical app slice  createRenderer, Config, Row, Column, useFocusManager
//                      and one <view>/<text> (the intrinsic element path)
// Scratch builds go under bench/.size (gitignored).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { minify } from 'terser';
import { build } from 'vite';
import solidPlugin from 'vite-plugin-solid';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const scratch = join(here, '.size');

const { values: args } = parseArgs({ options: { out: { type: 'string' } } });

const external = [
  /^solid-js(\/.*)?$/,
  /^@solidtv\/renderer(\/.*)?$/,
  /^@solidjs\/router(\/.*)?$/,
  /^@solid-primitives\/.*/,
  /^@solidjs\/universal(\/.*)?$/,
  /^@solidjs\/web(\/.*)?$/,
];

rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

// The slice imports the package by name, as an app does; the aliases below
// send that to src/, as vitest.config.ts does.
const sliceEntry = join(scratch, 'slice.tsx');
writeFileSync(
  sliceEntry,
  `import { createRenderer, Config } from '@solidtv/solid';
import { Row, Column, useFocusManager } from '@solidtv/solid/primitives';

export { createRenderer, Config, Row, Column, useFocusManager };

export function Slice() {
  return (
    <view>
      <text>slice</text>
    </view>
  );
}
`,
);

const ENTRIES = [
  {
    name: 'every export',
    files: [join(root, 'src/index.ts'), join(root, 'src/primitives/index.ts')],
  },
  { name: 'typical app slice', files: [sliceEntry] },
];

async function bundle(entry, index) {
  const outDir = join(scratch, `out-${index}`);
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    // SOLIDTV_DOM_RENDERING: arm A's tree (e63c88d) still reads it; arm C does not.
    define: { __DEV__: false, SOLIDTV_DOM_RENDERING: false },
    plugins: [
      solidPlugin({
        hot: false,
        solid: {
          moduleName: '@solidtv/solid',
          generate: 'universal',
          builtIns: [],
        },
      }),
    ],
    resolve: {
      conditions: ['@solidtv/source', 'browser'],
      alias: [
        {
          find: /^@solidtv\/solid$/,
          replacement: join(root, 'src/index.ts'),
        },
        {
          find: /^@solidtv\/solid\/primitives$/,
          replacement: join(root, 'src/primitives/index.ts'),
        },
      ],
    },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: entry.files,
        formats: ['es'],
        fileName: (_format, name) => `${name}.js`,
      },
      rollupOptions: { external },
    },
  });
  return outDir;
}

// Every emitted chunk counts (a lib build with two entries shares code in a
// common chunk), so the files are summed.
async function measure(outDir) {
  const { readdirSync } = await import('node:fs');
  let minified = 0;
  let gzip = 0;
  for (const f of readdirSync(outDir).filter((f) => f.endsWith('.js'))) {
    const code = readFileSync(join(outDir, f), 'utf8');
    const result = await minify(code, {
      compress: true,
      mangle: true,
      module: true,
    });
    minified += Buffer.byteLength(result.code);
    gzip += gzipSync(result.code, { level: 9 }).length;
  }
  return { minified, gzip };
}

const results = [];
for (const [i, entry] of ENTRIES.entries()) {
  results.push({
    entry: entry.name,
    ...(await measure(await bundle(entry, i))),
  });
}

const kb = (n) => (n / 1000).toFixed(1).padStart(7) + ' kB';
console.log(
  `${'entry'.padEnd(20)}${'minified'.padStart(12)}${'gzip'.padStart(12)}`,
);
for (const r of results) {
  console.log(
    `${r.entry.padEnd(20)}${kb(r.minified).padStart(12)}${kb(r.gzip).padStart(12)}`,
  );
}
if (args.out) {
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
  console.log(`wrote ${out}`);
}
